#!/usr/bin/env node
'use strict';

/**
 * run-hygiene-sweep.cjs — launchd supervisor for the hygiene + self-healing lane
 * (plan step S3; review findings SH2/SH3/SH5c).
 *
 * Runs, in sequence, the deterministic cleanup + healer routines that previously
 * only ran when someone remembered, then the heartbeat consumer (controller) and
 * the manifest/schema drift sweep. Bounded, idempotent, exits after one pass —
 * launchd re-fires on StartInterval.
 *
 * Pattern cloned from run-lessons-reconcile-check.cjs (the proven launchd shape
 * in this repo): sequential child spawns, exit-code aggregation, a runs.jsonl
 * ledger capped at 200 records, launchd stdout/stderr truncated past 1MB, and a
 * file kill-switch.
 *
 * SAFETY (grounding A3): EVERY child here runs in dry-run / report mode. The
 * observation window must complete and be reviewed before anyone passes --apply
 * to rotate-jsonl, artifact-cleanup, homeostasis, or the heartbeat consumer. This
 * supervisor deliberately hard-codes the safe flags and has no way to pass
 * --apply through to a child.
 *
 * A missing child script or an unavailable interpreter is RECORDED; for
 * OPTIONAL children this is tolerated, but a missing/skipped REQUIRED child
 * forces success=false in the summary and runs.jsonl record.
 *
 * Kill-switch: _dev/state/hygiene-sweep/disabled
 *
 * USAGE
 *   node tools/launchd/run-hygiene-sweep.cjs            # one pass, human log
 *   node tools/launchd/run-hygiene-sweep.cjs --once     # explicit single pass
 *   node tools/launchd/run-hygiene-sweep.cjs --json     # emit run record as JSON
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state', 'hygiene-sweep');
const RUNS_LOG = path.join(STATE_DIR, 'runs.jsonl');
const KILL_SWITCH = path.join(STATE_DIR, 'disabled');

const DEFAULT_TIMEOUT_MS = 120000;

// The dry-run/report-mode child pipeline. Order matches plan step S3 (a..h).
// bin: interpreter; script: repo-relative path; args: SAFE flags only.
function defaultChildren() {
  return [
    { label: 'rotate-jsonl',            bin: 'node',    script: 'tools/state/rotate-jsonl.cjs',              args: [] /* dry-run default */ },
    { label: 'artifact-cleanup',        bin: 'node',    script: 'tools/artifacts/artifact-cleanup.js',       args: ['--dry-run'] },
    { label: 'homeostasis',             bin: 'python3', script: 'tools/fleet/homeostasis.py',                args: [] /* report mode default */ },
    { label: 'reconcile-task-outcomes', bin: 'node',    script: 'tools/planning/reconcile-task-outcomes.js', args: ['--report-only', '--json'] /* report-only: classifies, writes no staging files */ },
    { label: 'reconcile-vault-drift',   bin: 'node',    script: 'tools/memory/reconcile-vault-drift.js',     args: ['--json'] /* dry-run default */, timeout_ms: 30000 },
    { label: 'recover-btw',             bin: 'node',    script: 'tools/concepts/recover-btw.js',             args: ['--dry-run'] },
    { label: 'heartbeat-consumer',      bin: 'node',    script: 'tools/kernel/heartbeat-consumer.cjs',       args: ['--json'] /* dry-run default */ },
    { label: 'manifest-schema-sweep',   bin: 'node',    script: 'tools/verify/manifest-schema-sweep.cjs',    args: ['--json'] /* report-only */ }
  ];
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

function preview(text, max = 4000) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`;
}

/**
 * Run one child. Missing script or missing interpreter -> non-fatal 'skipped'.
 * Returns a result record with a normalized status.
 */
function runChild(child, root = REPO_ROOT) {
  const started = Date.now();
  const scriptAbs = path.isAbsolute(child.script) ? child.script : path.join(root, child.script);

  if (!fs.existsSync(scriptAbs)) {
    return {
      label: child.label, status: 'missing', exit_code: null, duration_s: 0,
      stdout_preview: '', stderr_preview: `script not found: ${child.script}`
    };
  }

  const timeout = child.timeout_ms || DEFAULT_TIMEOUT_MS;
  const proc = spawnSync(child.bin, [scriptAbs, ...(child.args || [])], {
    cwd: root, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe']
  });

  const duration_s = Math.round((Date.now() - started) / 1000);

  // Interpreter missing (e.g. no python3): ENOENT -> skipped, not fatal.
  if (proc.error && proc.error.code === 'ENOENT') {
    return {
      label: child.label, status: 'skipped', exit_code: null, duration_s,
      stdout_preview: '', stderr_preview: `interpreter unavailable: ${child.bin}`
    };
  }
  // Timed out.
  if (proc.error && proc.error.code === 'ETIMEDOUT') {
    return {
      label: child.label, status: 'timeout', exit_code: null, duration_s,
      stdout_preview: preview(proc.stdout || ''), stderr_preview: preview(proc.stderr || `timed out after ${timeout}ms`)
    };
  }

  const exit_code = proc.status == null ? -1 : proc.status;
  return {
    label: child.label,
    status: exit_code === 0 ? 'ok' : 'failed',
    exit_code,
    duration_s,
    stdout_preview: preview(proc.stdout || ''),
    stderr_preview: preview(proc.stderr || '')
  };
}

// Non-failing statuses for aggregation: a child that RAN and exited non-zero is
// a failure; a child we couldn't run (missing/skipped) is tolerated ONLY when it
// is optional (see REQUIRED_CHILDREN). Kept for backward compatibility.
const NON_FAILING = new Set(['ok', 'missing', 'skipped']);

// Required deterministic children: the healer core that must run every sweep for
// the pass to count as a success. A missing/skipped REQUIRED child is a real
// failure (its absence silently degrades the lane). Optional children are
// env-dependent (python3, network, client state) and their absence is tolerated.
// Any label not listed here is treated as optional.
const REQUIRED_CHILDREN = new Set([
  'rotate-jsonl', 'artifact-cleanup', 'heartbeat-consumer', 'manifest-schema-sweep'
]);

// A single step counts as "ok for aggregation" when: it ran and exited 0; or it
// was missing/skipped AND is optional. A ran-nonzero step (failed/timeout) is
// always a failure; a missing/skipped REQUIRED step is a failure.
function stepSucceeded(step) {
  if (step.status === 'ok') return true;
  if (step.status === 'missing' || step.status === 'skipped') {
    return !REQUIRED_CHILDREN.has(step.label);
  }
  return false; // failed, timeout, or any unexpected status
}

/**
 * Execute the pipeline. Exported so tests can drive it with synthetic children.
 */
function runSweep(children = defaultChildren(), { root = REPO_ROOT } = {}) {
  const startedAt = stamp();
  const steps = children.map((c) => runChild(c, root));
  return {
    schema: 'HygieneSweepLaunchdRun/1.0',
    ts: startedAt,
    success: steps.every(stepSucceeded),
    steps
  };
}

// Bounded growth: cap the run ledger at 200 records and truncate launchd's
// persistent stdout/stderr past 1MB (launchd has no rotation of its own).
function capLogs() {
  try {
    if (fs.existsSync(RUNS_LOG) && fs.statSync(RUNS_LOG).size > 256 * 1024) {
      const lines = fs.readFileSync(RUNS_LOG, 'utf8').trimEnd().split('\n');
      fs.writeFileSync(RUNS_LOG, lines.slice(-200).join('\n') + '\n');
    }
    for (const name of ['launchd.stdout.log', 'launchd.stderr.log']) {
      const p = path.join(STATE_DIR, name);
      if (fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024) {
        fs.truncateSync(p, 0);
      }
    }
  } catch {
    // log capping must never fail the run
  }
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  // --once is accepted for symmetry; a single bounded pass is the only mode.

  if (fs.existsSync(KILL_SWITCH)) {
    process.exit(0); // silent, reversible disable
  }

  const record = runSweep();

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(RUNS_LOG, JSON.stringify(record) + '\n');
  capLogs();

  if (asJson) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log(`hygiene-sweep ${record.ts} — success=${record.success}`);
    for (const s of record.steps) {
      console.log(`  ${s.status.padEnd(8)} ${s.label} (exit=${s.exit_code == null ? '-' : s.exit_code}, ${s.duration_s}s)`);
    }
  }

  process.exit(record.success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  runSweep,
  runChild,
  capLogs,
  defaultChildren,
  stepSucceeded,
  NON_FAILING,
  REQUIRED_CHILDREN,
  REPO_ROOT,
  STATE_DIR,
  KILL_SWITCH
};
