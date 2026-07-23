#!/usr/bin/env node
/**
 * Mythos Trace Normalizer
 *
 * Imports existing proto-trace surfaces into the unified trace event format.
 * Surfaces: run-log.jsonl, archive.jsonl, local-first-routing.jsonl, closed signals.
 *
 * Usage:
 *   node tools/trace/normalize-existing.js [--surface <name>] [--output <path>] [--dry-run]
 *
 * Surfaces: run-log, archive, routing, signals, all (default: all)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUTPUT = path.join(ROOT, '_dev/traces/normalized-events.jsonl');

// --- Event ID generator ---
function eventId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// --- Normalizers for each source surface ---

function normalizeRunLog(line) {
  try {
    const d = JSON.parse(line);
    return {
      event_id: eventId('vrf'),
      session_id: d.run_id || null,
      timestamp: d.timestamp,
      event_type: 'verification_run',
      source_surface: 'autonomy/run-log',
      actor: 'system',
      scope: d.framework_id || d.profile_id || 'unknown',
      payload: {
        profile_id: d.profile_id,
        run_id: d.run_id,
        framework_id: d.framework_id,
        verdict: d.verdict,
        duration_ms: d.duration_ms,
        check_summary: d.check_summary || null,
        signal_path: d.signal_path || null
      }
    };
  } catch { return null; }
}

function normalizeArchive(line) {
  try {
    const d = JSON.parse(line);
    return {
      event_id: eventId('arc'),
      session_id: null,
      timestamp: d.ts,
      event_type: 'artifact_lifecycle',
      source_surface: 'logs/archive',
      actor: d.operator || 'system',
      scope: d.surface || 'unknown',
      payload: {
        action: d.event,
        source_path: d.source,
        destination_path: d.destination,
        reason: d.reason,
        artifact_count: 1,
        dry_run: d.dry_run || false
      }
    };
  } catch { return null; }
}

function normalizeRouting(line) {
  try {
    const d = JSON.parse(line);
    return {
      event_id: eventId('rte'),
      session_id: null,
      timestamp: d.timestamp,
      event_type: 'routing_decision',
      source_surface: 'logs/local-first-routing',
      actor: 'system',
      scope: d.scope || 'unknown',
      payload: {
        action: d.action,
        risk_class: d.risk_class,
        reason: d.reason,
        artifact_count: d.artifact_count || 0,
        artifacts_reviewed: d.artifacts_reviewed || 0,
        locally_accepted: d.locally_accepted || false,
        duration_ms: d.total_latency_ms || null
      }
    };
  } catch { return null; }
}

function normalizeClosedSignal(filePath) {
  try {
    const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (d.schema !== 'HandoffSignal/1.0') return null;
    return {
      event_id: eventId('sig'),
      session_id: null,
      timestamp: d.timestamp,
      event_type: 'signal_lifecycle',
      source_surface: 'signals/closed',
      actor: d.source || 'unknown',
      scope: d.scope || path.basename(filePath, '.json'),
      payload: {
        signal_type: d.signal_type,
        lifecycle_transition: `${d.lifecycle_state || 'unknown'} (closed)`,
        artifacts: d.artifacts || [],
        reason: d.validation?.summary || null,
        recommended_next_actor: d.recommended_next_actor || null,
        recommended_next_command: d.recommended_next_command || null
      }
    };
  } catch { return null; }
}

// --- File readers ---

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim().length > 0);
}

function readClosedSignals(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(dirPath, f));
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  const surface = args.includes('--surface') ? args[args.indexOf('--surface') + 1] : 'all';
  const outputPath = args.includes('--output') ? args[args.indexOf('--output') + 1] : DEFAULT_OUTPUT;
  const dryRun = args.includes('--dry-run');

  const events = [];

  // Run log
  if (surface === 'all' || surface === 'run-log') {
    const lines = readJsonl(path.join(ROOT, '_dev/autonomy/run-log.jsonl'));
    for (const line of lines) {
      const ev = normalizeRunLog(line);
      if (ev) events.push(ev);
    }
    console.log(`  run-log: ${lines.length} lines → ${events.length} events`);
  }

  // Archive log
  const preArchiveCount = events.length;
  if (surface === 'all' || surface === 'archive') {
    const lines = readJsonl(path.join(ROOT, '_dev/logs/archive.jsonl'));
    for (const line of lines) {
      const ev = normalizeArchive(line);
      if (ev) events.push(ev);
    }
    console.log(`  archive: ${lines.length} lines → ${events.length - preArchiveCount} events`);
  }

  // Routing log
  const preRoutingCount = events.length;
  if (surface === 'all' || surface === 'routing') {
    const lines = readJsonl(path.join(ROOT, '_dev/logs/local-first-routing.jsonl'));
    for (const line of lines) {
      const ev = normalizeRouting(line);
      if (ev) events.push(ev);
    }
    console.log(`  routing: ${lines.length} lines → ${events.length - preRoutingCount} events`);
  }

  // Closed signals
  const preSignalCount = events.length;
  if (surface === 'all' || surface === 'signals') {
    const signalFiles = readClosedSignals(path.join(ROOT, '_dev/reports/signals/closed'));
    for (const f of signalFiles) {
      const ev = normalizeClosedSignal(f);
      if (ev) events.push(ev);
    }
    console.log(`  signals: ${signalFiles.length} files → ${events.length - preSignalCount} events`);
  }

  // Sort by timestamp
  events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  console.log(`\nTotal: ${events.length} normalized events`);

  // Gap analysis
  const typeCounts = {};
  for (const ev of events) {
    typeCounts[ev.event_type] = (typeCounts[ev.event_type] || 0) + 1;
  }
  console.log('\nEvent type distribution:');
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Check for gaps
  console.log('\nGap analysis:');
  const missingTypes = [
    'task_plan', 'task_outcome', 'framework_execution',
    'lessons_capture', 'operator_correction'
  ].filter(t => !typeCounts[t]);
  if (missingTypes.length > 0) {
    console.log(`  Missing event types (no data yet): ${missingTypes.join(', ')}`);
    console.log('  These will be populated by Workstream B (task planning) and future instrumentation.');
  } else {
    console.log('  All event types have data.');
  }

  if (dryRun) {
    console.log('\n[dry-run] Would write to:', outputPath);
    console.log('[dry-run] First event:', JSON.stringify(events[0], null, 2));
    return;
  }

  // Write output
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const output = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`\nWrote ${events.length} events to ${outputPath}`);
}

main();
