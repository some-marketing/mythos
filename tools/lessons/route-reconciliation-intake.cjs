#!/usr/bin/env node
'use strict';

/**
 * route-reconciliation-intake.cjs — L6 of the lessons-loop mechanization
 * (convene 20260610T175230Z: actionable reconciliation items flow into BOTH
 * operator-visible intake (Dart) and next-session continuity (boundary
 * markers); automatic promotion to durable law stays forbidden).
 *
 * Mechanical tier: parses lessons-reconciliation__<date>.expectation-failures.json
 * artifacts, collects findings with status "actionable" that have not been
 * routed before, writes an intake handoff document, and drops/refreshes a
 * per-scope session-boundary marker (scope: lessons-intake) so the next booted
 * session inherits the items as Current State.
 *
 * Dart lane: this tool does NOT post to Dart (no MCP here). It lists the items
 * needing Dart tasks in the handoff document; a booted session with the Dart
 * MCP posts them and marks routed_to_dart. Routing state lives at
 * _dev/state/lessons-reconcile/routed.json (idempotent re-runs).
 *
 * USAGE
 *   node tools/lessons/route-reconciliation-intake.cjs [--json] [--dry-run]
 *
 * Exit 0 always unless catastrophically broken; never blocks a pipeline.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ANALYSIS_DIR = path.join(ROOT, '_dev', 'reports', 'analysis');
const STATE_FILE = path.join(ROOT, '_dev', 'state', 'lessons-reconcile', 'routed.json');
const HANDOFF_PATH = path.join(ANALYSIS_DIR, 'lessons-intake__current.md');

function loadRouted() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { routed: {} };
  }
}

function saveRouted(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function collectActionable() {
  let names;
  try {
    names = fs.readdirSync(ANALYSIS_DIR);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names) {
    const m = /^lessons-reconciliation__(\d{4}-\d{2}-\d{2})\.expectation-failures\.json$/.exec(name);
    if (!m) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(ANALYSIS_DIR, name), 'utf8'));
      for (const f of doc.findings || []) {
        if (String(f.status || '').toLowerCase() !== 'actionable') continue;
        items.push({
          key: `${m[1]}::${f.id}`,
          date: m[1],
          id: f.id,
          pattern: f.pattern || '',
          recommended_action: f.recommended_action || '',
          frequency: f.frequency || 1,
          source_artifact: path.join('_dev', 'reports', 'analysis', name)
        });
      }
    } catch {
      // unreadable artifact — skip, the reconciler owns its own validity
    }
  }
  return items.sort((a, b) => a.key.localeCompare(b.key));
}

function writeHandoff(fresh, alreadyRouted) {
  const lines = [
    '# Lessons Intake — actionable reconciliation items',
    '',
    `Generated: ${new Date().toISOString()} by tools/lessons/route-reconciliation-intake.cjs`,
    'Authority: convene 20260610T175230Z item L6. Promotion to durable law/framework',
    'hardening REQUIRES distinct-intelligence validation — these are intake items, not law.',
    '',
    '## New this routing pass (need Dart tasks — post via a booted session with Dart MCP, then mark routed_to_dart in _dev/state/lessons-reconcile/routed.json)',
    ''
  ];
  for (const it of fresh) {
    lines.push(`- **${it.key}** (freq ${it.frequency}): ${it.pattern}`);
    lines.push(`  - Action: ${it.recommended_action}`);
    lines.push(`  - Source: \`${it.source_artifact}\``);
  }
  if (fresh.length === 0) lines.push('- none');
  lines.push('', '## Previously routed (tracked, no action here)', '');
  for (const key of alreadyRouted) lines.push(`- ${key}`);
  if (alreadyRouted.length === 0) lines.push('- none');
  fs.writeFileSync(HANDOFF_PATH, lines.join('\n') + '\n');
  return HANDOFF_PATH;
}

function writeBoundaryMarker(freshCount, totalCount) {
  const payload = JSON.stringify({
    schema: 'SessionBoundary/1.0',
    scope: 'lessons-intake',
    handoff_path: path.relative(ROOT, HANDOFF_PATH),
    recommended_next_command: '/review-progress ' + path.relative(ROOT, HANDOFF_PATH),
    summary: `${freshCount} new actionable lessons item(s) (${totalCount} total tracked) awaiting Dart routing + bounded task creation.`,
    written_by: 'tools/lessons/route-reconciliation-intake.cjs'
  });
  const child = spawnSync('node', [path.join(ROOT, 'tools', 'sessions', 'write-boundary.cjs'), '-'], {
    cwd: ROOT,
    input: payload,
    encoding: 'utf8',
    timeout: 30000
  });
  return { exit: child.status == null ? -1 : child.status, out: (child.stdout || child.stderr || '').trim() };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');

  const state = loadRouted();
  const all = collectActionable();
  const fresh = all.filter((it) => !state.routed[it.key]);
  const alreadyRouted = Object.keys(state.routed).sort();

  let boundary = { exit: 0, out: 'skipped (dry-run or nothing new)' };
  let handoff = '';
  if (!dryRun && fresh.length > 0) {
    handoff = writeHandoff(fresh, alreadyRouted);
    boundary = writeBoundaryMarker(fresh.length, all.length);
    if (boundary.exit === 0) {
      for (const it of fresh) {
        state.routed[it.key] = { routed_at: new Date().toISOString(), routed_to_dart: false };
      }
      saveRouted(state);
    }
  }

  const result = {
    schema: 'LessonsIntakeRouting/1.0',
    actionable_total: all.length,
    fresh_routed: dryRun ? 0 : fresh.length,
    fresh_pending: dryRun ? fresh.length : 0,
    handoff_path: handoff ? path.relative(ROOT, handoff) : '',
    boundary_marker: boundary.out,
    boundary_exit: boundary.exit
  };
  process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n'
    : `actionable: ${result.actionable_total}, fresh: ${fresh.length}, boundary: ${boundary.out}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`route-reconciliation-intake failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { collectActionable, loadRouted };
