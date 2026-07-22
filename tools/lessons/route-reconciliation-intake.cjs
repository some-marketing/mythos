#!/usr/bin/env node
'use strict';

/**
 * route-reconciliation-intake.cjs — actionable-item router for the lessons
 * loop.
 *
 * Genericized from a private-ops version that always posted findings into a
 * specific task tracker. This version: parses
 * lessons-reconciliation__<date>.expectation-failures.json artifacts,
 * collects findings with status "actionable" that have not been routed
 * before, writes an intake handoff document, and (best-effort) drops/
 * refreshes a per-scope session-boundary marker via
 * tools/sessions/write-boundary.cjs if that script exists in your repo — so
 * the next booted session can inherit the items as current state. If your
 * repo doesn't have that script (or a different session-lifecycle
 * mechanism), the boundary-marker step is skipped with a note; the handoff
 * document and routing state still get written either way.
 *
 * Task-tracker lane: this tool does NOT post to any task tracker itself. It
 * lists the items needing tasks in the handoff document; wire your own
 * task-creation step to read that document and mark routed_to_tracker.
 * Routing state lives at _dev/state/lessons-reconcile/routed.json
 * (idempotent re-runs).
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
    'Promotion to durable law/framework hardening REQUIRES distinct-intelligence',
    'validation — these are intake items, not law.',
    '',
    '## New this routing pass (need tracker tasks — post via your own task-tracker integration, then mark routed in _dev/state/lessons-reconcile/routed.json)',
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

// Best-effort: only attempts the boundary marker if your repo has a
// tools/sessions/write-boundary.cjs (or equivalent session-lifecycle
// mechanism). If it doesn't exist, this step is skipped with a clear note
// rather than failing — the handoff document above is the durable record
// either way.
function writeBoundaryMarker(freshCount, totalCount) {
  const writerPath = path.join(ROOT, 'tools', 'sessions', 'write-boundary.cjs');
  if (!fs.existsSync(writerPath)) {
    return { exit: 0, out: 'skipped (no tools/sessions/write-boundary.cjs in this repo — wire your own session-lifecycle marker here if you have one)' };
  }
  const payload = JSON.stringify({
    schema: 'SessionBoundary/1.0',
    scope: 'lessons-intake',
    handoff_path: path.relative(ROOT, HANDOFF_PATH),
    recommended_next_command: 'review ' + path.relative(ROOT, HANDOFF_PATH),
    summary: `${freshCount} new actionable lessons item(s) (${totalCount} total tracked) awaiting task-tracker routing + bounded task creation.`,
    written_by: 'tools/lessons/route-reconciliation-intake.cjs'
  });
  const child = spawnSync('node', [writerPath, '-'], {
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
        state.routed[it.key] = { routed_at: new Date().toISOString(), routed_to_tracker: false };
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
