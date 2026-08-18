#!/usr/bin/env node
'use strict';

//
// run-meta-ads-tracker-refresh.cjs — durable launchd wrapper.
//
// Why node and not bash: macOS TCC blocks /bin/bash from reading files in
// ~/Documents when launched by launchd. Node (via /usr/bin/env node) has the
// inherited Full Disk Access grant, matching the precedent set by
// ca.somemarketing.smos.contextual-sweep.plist. This script spawns the
// existing tools/mcp/meta-ads/run-with-op.sh as a child process — by then
// we are already inside the repo and reads succeed.
//
// Responsibilities:
//   1. Resolve PATH so /opt/homebrew/bin (op, node, git) is reachable.
//   2. Exec the refresh through tools/mcp/meta-ads/run-with-op.sh (1Password
//      sources the Meta token; bytes never appear in argv).
//   3. Capture exit + duration; append a structured run record to runs.jsonl.
//   4. If the tracker file changed, auto-commit on the same branch (no push).
//   5. On non-zero exit OR a hard stopping-rule crossing (min-7d-window met),
//      write a ready-for-review CoordinationSignal/1.0.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');




const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');
const REPO_ROOT = resolveCanonicalRoot();
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state', 'meta-ads-tracker');
const RUNS_DIR = path.join(STATE_DIR, 'runs');
const RUNS_LOG = path.join(STATE_DIR, 'runs.jsonl');
const TRACKER = path.join(REPO_ROOT, 'clients', 'ECH', 'projects', 'meta-creative-iteration', 'outputs', '06-live-tracker', 'index.json');
const SIGNAL_DIR = path.join(REPO_ROOT, '_dev', 'reports', 'signals');

process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
process.env.HOME = process.env.HOME || '/Users/admin';
process.env.LC_ALL = process.env.LC_ALL || 'en_CA.UTF-8';

fs.mkdirSync(RUNS_DIR, { recursive: true });

const nowUtc = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const nowStamp = nowUtc.replace(/[-:]/g, '').replace('Z', 'Z');
const runOut = path.join(RUNS_DIR, `run__${nowStamp}.json`);
const runErr = `${runOut}.stderr`;

function sha256OrNull(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
}

const preHash = sha256OrNull(TRACKER);
const startMs = Date.now();

// Timeout + stdin ignored: an op call stuck on a TCC dialog / auth prompt must
// never hang this weekly job or block reading a nonexistent stdin. 5 min is
// generous headroom for the Graph API pull.
const REFRESH_TIMEOUT_MS = 300000;

const child = spawnSync('/bin/bash', [
  path.join(REPO_ROOT, 'tools', 'mcp', 'meta-ads', 'run-with-op.sh'),
  'node',
  path.join(REPO_ROOT, 'tools', 'mcp', 'meta-ads', 'refresh-live-tracker.js'),
  '--dry-print'
], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8', timeout: REFRESH_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });

const durationS = Math.round((Date.now() - startMs) / 1000);
const timedOut = Boolean(child.error && child.error.code === 'ETIMEDOUT');
const exit = child.status == null ? -1 : child.status;
fs.writeFileSync(runOut, child.stdout || '');
fs.writeFileSync(runErr, child.stderr || '');

const postHash = sha256OrNull(TRACKER);
const trackerChanged = preHash !== postHash;

let hardStops = 0;
let nullInsightsDetected = false;
let nullInsightsReason = null;
let parsedOut = null;
try {
  parsedOut = JSON.parse(child.stdout || '{}');
  for (const s of parsedOut.stops || []) {
    for (const f of (s.findings || [])) {
      if (f.min_window_met === true) hardStops += 1;
    }
  }
  // ran-but-null guard: refresh-live-tracker.js --dry-print now reports this
  // explicitly (and also exits non-zero), but parse it independently here too
  // so the run record is self-explanatory even if exit-code plumbing changes.
  if (parsedOut.nullInsightsDetected === true) {
    nullInsightsDetected = true;
    nullInsightsReason = parsedOut.nullInsightsReason || null;
  }
} catch { /* ignore */ }

fs.appendFileSync(RUNS_LOG, JSON.stringify({
  ts: nowUtc,
  exit,
  timed_out: timedOut,
  duration_s: durationS,
  tracker_changed: trackerChanged,
  hard_stops: hardStops,
  null_insights_detected: nullInsightsDetected,
  null_insights_reason: nullInsightsReason,
  run_out: path.relative(REPO_ROOT, runOut)
}) + '\n');

let commitOk = 'skipped';
if (trackerChanged) {
  const diffCheck = spawnSync('/opt/homebrew/bin/git', ['-C', REPO_ROOT, 'diff', '--quiet', '--', TRACKER], { encoding: 'utf8' });
  if (diffCheck.status === 0) {
    commitOk = 'no-diff-after-write';
  } else {
    spawnSync('/opt/homebrew/bin/git', ['-C', REPO_ROOT, 'add', TRACKER], { encoding: 'utf8' });
    const cm = spawnSync('/opt/homebrew/bin/git', [
      '-C', REPO_ROOT,
      '-c', 'user.name=SM_OS Tracker Refresh',
      '-c', 'user.email=get+tracker@somemarketing.ca',
      'commit',
      '-m', `chore(ech/meta-ads): weekly tracker refresh ${nowUtc}`,
      '--no-verify',
      '--', TRACKER
    ], { encoding: 'utf8' });
    commitOk = cm.status === 0 ? 'committed' : 'commit-failed';
  }
}

if (exit !== 0 || hardStops > 0 || nullInsightsDetected) {
  const reason = nullInsightsDetected
    ? `ran-but-null-${nullInsightsReason || 'unknown'}`
    : (timedOut
      ? `refresh-timeout-${REFRESH_TIMEOUT_MS}ms`
      : (exit !== 0 ? `refresh-exit-${exit}` : `hard-stop-rule-crossed-${hardStops}`));
  const signalPath = path.join(SIGNAL_DIR, `ready-for-review__${nowStamp}__meta-ads-tracker-refresh-ech.json`);
  const signal = {
    schema: 'CoordinationSignal/1.0',
    signal_type: 'ready-for-review',
    lifecycle_state: 'live',
    source: 'launchd:meta-ads-tracker-refresh-ech',
    scope: 'meta-ads-tracker-refresh-ech',
    timestamp: nowUtc,
    artifacts: [
      path.relative(REPO_ROOT, runOut),
      '_dev/state/meta-ads-tracker/runs.jsonl',
      'clients/ECH/projects/meta-creative-iteration/outputs/06-live-tracker/index.json'
    ],
    decision_context_artifacts: [
      'clients/ECH/projects/meta-creative-iteration/outputs/05a-preregistration/ech-halifax-open-house.json',
      'clients/ECH/projects/meta-creative-iteration/outputs/05a-preregistration/ech-bhm-may-2026.json',
      'clients/ECH/projects/meta-creative-iteration/outputs/05a-preregistration/hh-bhm-may-2026.json'
    ],
    validation: {
      ran: true,
      summary: `launchd weekly refresh: exit=${exit}, hard_stops=${hardStops}, commit=${commitOk}, reason=${reason}`
    },
    recommended_next_actor: 'operator',
    recommended_next_command: 'node tools/mcp/meta-ads/refresh-live-tracker.js --dry-print',
    next_step_detail: [
      `Read the run output at ${path.relative(REPO_ROOT, runOut)} before deciding next move.`,
      'If a hard stop fired, decide pause/scale; the 7-day window has been met.',
      ...(nullInsightsDetected
        ? ['Ran-but-null: the Graph API returned zero/all-null rows for every tracked ad. Check Meta system-user token validity (1Password) before trusting this tracker snapshot.']
        : [])
    ],
    blocked_by: [],
    ready_for_clear: false,
    grounding_mode: 'none',
    signal_scope: 'meta-ads-tracker-refresh-ech',
    run_outcome: {
      outcome: exit === 0 ? 'success' : 'failure',
      exitCode: exit,
      signal: null,
      success: exit === 0
    }
  };
  fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2) + '\n');
  process.stderr.write(`[run-meta-ads-tracker-refresh] wrote signal ${signalPath}\n`);
}

if (timedOut) {
  // Log, don't crash: the ready-for-review signal above already flags the
  // timeout for the operator; launchd should not record it as a job crash.
  process.stdout.write(`[run-meta-ads-tracker-refresh] WARN run-with-op.sh timed out after ${REFRESH_TIMEOUT_MS}ms; see ${runErr}\n`);
}
process.stdout.write(`[run-meta-ads-tracker-refresh] ts=${nowUtc} exit=${exit} timed_out=${timedOut} changed=${trackerChanged} hard_stops=${hardStops} commit=${commitOk}\n`);
process.exit(timedOut ? 0 : exit);
