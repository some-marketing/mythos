#!/usr/bin/env node
'use strict';

// Launchd wrapper for tools/google-ads/lead-value-monitor.js — the canonical
// {CLIENT_NAME} lead-value clearance witness. (2026-06-02: repointed from the
// retired tools/mcp/google-ads/value-signal-witness.js after consolidation —
// lead-value-monitor.js has the correct per-day fix-date segmentation.)
//
// CONTEXT: Mazda lead_submit values were firing at $1 instead of tiered
// $250/$167/$100/$50; a config fix shipped (always_use_default_value=YES on
// T1-T4). Owner Decision 2 (owner-decisions-davebarrow__20260601.md) holds the
// Mazda budget bump until corrected values are witnessed firing across a clean
// window (~2026-06-10). This job runs the read-only witness daily inside that
// window and SELF-RETIRES the moment it reads LIKELY_FIXED (or the window ends).
//
// Date-gated + self-unloading so a monthly StartCalendarInterval can't turn
// into a permanent daily noise source. Read-only: never mutates the account.
//
// Why node not bash: launchd-spawned /bin/bash hits TCC restrictions; node
// inherits the grant (mirrors run-delesign-poll.cjs).
//
// Install:
//   cp tools/launchd/ca.somemarketing.smos.mazda-value-witness.plist ~/Library/LaunchAgents/
//   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ca.somemarketing.smos.mazda-value-witness.plist

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = '/Users/admin/dev/Mythos-recovered';
const LABEL = 'ca.somemarketing.smos.mazda-value-witness';
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state', 'mazda-value-witness');
const RUNS_LOG = path.join(STATE_DIR, 'runs.jsonl');
const DONE_MARKER = path.join(STATE_DIR, 'CLEARED.json');

const CUSTOMER_ID = '7902269227';        // {CLIENT_NAME}
const WINDOW_OPEN = '2026-06-10';         // clearance witness opens (fix + full 14d window)
const WINDOW_CLOSE = '2026-06-24';        // stop nagging after this; hand to operator

process.chdir(REPO_ROOT);
process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
process.env.HOME = process.env.HOME || '/Users/admin';
process.env.LC_ALL = process.env.LC_ALL || 'en_CA.UTF-8';
process.env.GOOGLE_ADS_DRY_RUN = 'false';  // live read required to witness

fs.mkdirSync(STATE_DIR, { recursive: true });

const nowUtc = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const today = nowUtc.slice(0, 10); // YYYY-MM-DD (UTC)

function log(entry) {
  fs.appendFileSync(RUNS_LOG, JSON.stringify({ ts: nowUtc, ...entry }) + '\n');
  process.stdout.write(`[mazda-value-witness] ts=${nowUtc} ${Object.entries(entry).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
}

function selfRetire(reason) {
  // Best-effort unload so this job stops firing once its purpose is served.
  const uid = process.getuid ? process.getuid() : null;
  if (uid != null) {
    spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
  }
  log({ phase: 'self-retire', reason });
}

// --- Already cleared on a prior run? Nothing to do. ---
if (fs.existsSync(DONE_MARKER)) {
  log({ phase: 'noop', reason: 'already-cleared' });
  selfRetire('already-cleared');
  process.exit(0);
}

// --- Before the window opens: wait. ---
if (today < WINDOW_OPEN) {
  log({ phase: 'waiting', window_open: WINDOW_OPEN });
  process.exit(0);
}

// --- After the window closes without a clear: hand to operator, stop nagging. ---
if (today > WINDOW_CLOSE) {
  log({ phase: 'window-expired', note: 'no LIKELY_FIXED clear observed in window; operator pickup' });
  selfRetire('window-expired');
  process.exit(0);
}

// --- In-window: run the read-only canonical lead-value monitor. ---
const outFile = path.join('clients', '{CLIENT_CODE}', 'shared', `lead-value-monitor__${today.replace(/-/g, '')}.json`);
const startMs = Date.now();
const child = spawnSync('node', [
  path.join(REPO_ROOT, 'tools', 'google-ads', 'lead-value-monitor.js'),
  '--customer-id', CUSTOMER_ID,
  '--date-range', 'LAST_14_DAYS',
  '--fix-date', '2026-05-27',
  '--out', outFile
], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
const durationS = Math.round((Date.now() - startMs) / 1000);
const exit = child.status == null ? -1 : child.status;

let verdict = 'UNKNOWN';
try {
  const parsed = JSON.parse(child.stdout || '{}');
  verdict = parsed.verdict || 'UNKNOWN';
} catch { /* leave UNKNOWN */ }

log({ phase: 'witness', exit, duration_s: durationS, verdict, out_file: outFile });

// lead-value-monitor verdict vocabulary: PASS / PARTIAL / FAIL / PENDING / CONFIG-FAIL.
// Clear only on a clean PASS (config OK + all post-fix firing-days carry value).
if (exit === 0 && verdict.startsWith('PASS')) {
  fs.writeFileSync(DONE_MARKER, JSON.stringify({
    cleared_at: nowUtc,
    verdict,
    out_file: outFile,
    note: 'Mazda lead-value signal PASSED (config OK + post-fix firings carry correct tiered value). Budget bump is witness-cleared pending a UI spot-check of individual conversions.'
  }, null, 2));
  log({ phase: 'cleared', verdict, out_file: outFile });
  selfRetire('cleared');
}

process.exit(exit === 0 ? 0 : exit);
