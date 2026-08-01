#!/usr/bin/env node
'use strict';

// Launchd wrapper for tools/mcp/delesign/poll-deliverables.js.
// Mirrors run-meta-ads-tracker-refresh.cjs in shape.
//
// Why node not bash: launchd-spawned /bin/bash hits TCC FDA restrictions;
// node inherits the FDA grant.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state', 'delesign-poll');
const RUNS_DIR = path.join(STATE_DIR, 'launchd-runs');

process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
process.env.LC_ALL = process.env.LC_ALL || 'en_CA.UTF-8';

fs.mkdirSync(RUNS_DIR, { recursive: true });

const nowUtc = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const nowStamp = nowUtc.replace(/[-:]/g, '').replace('Z', 'Z');
const runOut = path.join(RUNS_DIR, `run__${nowStamp}.json`);
const runErr = `${runOut}.stderr`;

const startMs = Date.now();
const child = spawnSync('/bin/bash', [
  path.join(REPO_ROOT, 'tools', 'mcp', 'delesign', 'run-with-op.sh'),
  'node',
  path.join(REPO_ROOT, 'tools', 'mcp', 'delesign', 'poll-deliverables.js')
], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
const durationS = Math.round((Date.now() - startMs) / 1000);
const exit = child.status == null ? -1 : child.status;
fs.writeFileSync(runOut, child.stdout || '');
fs.writeFileSync(runErr, child.stderr || '');

let signalsWritten = 0;
try {
  const parsed = JSON.parse(child.stdout || '{}');
  signalsWritten = Number(parsed.signals_written || 0);
} catch { /* ignore */ }

fs.appendFileSync(path.join(STATE_DIR, 'launchd-runs.jsonl'), JSON.stringify({
  ts: nowUtc,
  exit,
  duration_s: durationS,
  signals_written: signalsWritten,
  run_out: path.relative(REPO_ROOT, runOut)
}) + '\n');

// Mechanical Drive asset sweep rides the same schedule (operator 2026-07-14:
// deliveries must be detected several times a day, mechanically).
try {
  const sweep = spawnSync('node', [path.join(REPO_ROOT, 'tools', 'mcp', 'delesign', 'asset-sweep.cjs')], { encoding: 'utf8', timeout: 120000 });
  process.stdout.write(`[delesign-asset-sweep] ${String(sweep.stdout || '').trim()}\n`);
} catch (e) {
  process.stdout.write(`[delesign-asset-sweep] WARN ${e.message}\n`);
}
process.stdout.write(`[delesign-poll] ts=${nowUtc} exit=${exit} signals=${signalsWritten}\n`);
process.exit(exit);
