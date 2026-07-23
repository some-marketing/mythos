#!/usr/bin/env node
'use strict';

/**
 * install-sweeper.js — cross-platform installer for the contextual-sweep job.
 *
 * Replaces the macOS-only install-sweeper.sh. Detects the OS and installs the
 * right scheduler so the 120s contextual sweep (tools/memory/contextual-sweep.js)
 * runs on macOS (launchd), Windows (Task Scheduler / schtasks), or Linux
 * (systemd --user timer, else a cron fallback note).
 *
 * Usage: node tools/memory/install-sweeper.js {install|uninstall|status|run-once}
 *
 * The job is per-node and optional: install it on hosts where you want ambient
 * contextual hints. Node stdlib only.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const SMOS_ROOT = path.resolve(__dirname, '..', '..');
const SWEEP_JS = path.join(SMOS_ROOT, 'tools', 'memory', 'contextual-sweep.js');
const HINTS_DIR = path.join(SMOS_ROOT, '_dev', 'state', 'contextual-hints');
const LABEL = 'ca.somemarketing.smos.contextual-sweep';
const INTERVAL_SEC = 120;
const PLATFORM = process.platform;

function nodeBin() {
  return process.execPath; // the running node, absolute path — works on every OS
}

function ensureDirs() {
  fs.mkdirSync(HINTS_DIR, { recursive: true });
}

function runOnce() {
  ensureDirs();
  const r = spawnSync(nodeBin(), [SWEEP_JS], { cwd: SMOS_ROOT, encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status || 0);
}

// ---------------------------------------------------------------------------
// macOS — launchd
// ---------------------------------------------------------------------------
function macPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}
function macInstall() {
  ensureDirs();
  const tmpl = path.join(__dirname, 'contextual-sweep.plist.template');
  const plist = fs.readFileSync(tmpl, 'utf8')
    .replace(/__SMOS_ROOT__/g, SMOS_ROOT)
    .replace(/__HOME__/g, os.homedir());
  const dest = macPlistPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, plist);
  try { execFileSync('launchctl', ['unload', dest], { stdio: 'ignore' }); } catch (_) {}
  execFileSync('launchctl', ['load', dest]);
  console.log('installed (launchd):', dest, `| interval ${INTERVAL_SEC}s`);
}
function macUninstall() {
  const dest = macPlistPath();
  if (fs.existsSync(dest)) {
    try { execFileSync('launchctl', ['unload', dest], { stdio: 'ignore' }); } catch (_) {}
    fs.unlinkSync(dest);
    console.log('uninstalled (launchd):', dest);
  } else console.log('not installed (no plist)');
}
function macStatus() {
  const out = spawnSync('launchctl', ['list'], { encoding: 'utf8' }).stdout || '';
  console.log(out.includes(LABEL) ? 'loaded (launchd)' : 'not loaded');
}

// ---------------------------------------------------------------------------
// Windows — Task Scheduler (schtasks). Repetition every 120s for 24h, re-armed
// at logon. Runs: node contextual-sweep.js in SMOS_ROOT.
// ---------------------------------------------------------------------------
function winInstall() {
  ensureDirs();
  // A small launcher .cmd so the working dir is correct and args stay simple.
  const cmdPath = path.join(SMOS_ROOT, '_dev', 'state', 'contextual-hints', '_run-sweep.cmd');
  fs.writeFileSync(cmdPath, `@echo off\r\ncd /d "${SMOS_ROOT}"\r\n"${nodeBin()}" "${SWEEP_JS}" >> "${path.join(HINTS_DIR, '_sweeper.stdout.log')}" 2>> "${path.join(HINTS_DIR, '_sweeper.stderr.log')}"\r\n`);
  // /sc minute /mo 2  ≈ every 120s (Task Scheduler's finest granularity is 1 min)
  const args = ['/create', '/tn', LABEL, '/tr', `"${cmdPath}"`, '/sc', 'minute', '/mo', '2', '/f'];
  const r = spawnSync('schtasks', args, { encoding: 'utf8' });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if (r.status === 0) console.log('installed (Task Scheduler):', LABEL, '| every 2 min');
  else process.exit(r.status || 1);
}
function winUninstall() {
  const r = spawnSync('schtasks', ['/delete', '/tn', LABEL, '/f'], { encoding: 'utf8' });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  console.log(r.status === 0 ? 'uninstalled (Task Scheduler)' : 'not installed');
}
function winStatus() {
  const r = spawnSync('schtasks', ['/query', '/tn', LABEL], { encoding: 'utf8' });
  console.log(r.status === 0 ? 'loaded (Task Scheduler)\n' + (r.stdout || '') : 'not loaded');
}

// ---------------------------------------------------------------------------
// Linux — systemd --user timer (preferred), else cron note.
// ---------------------------------------------------------------------------
function linuxUnitDir() { return path.join(os.homedir(), '.config', 'systemd', 'user'); }
function linuxInstall() {
  ensureDirs();
  if (spawnSync('systemctl', ['--user', '--version'], { stdio: 'ignore' }).status !== 0) {
    console.log('systemd --user unavailable. Add a cron line manually:');
    console.log(`  * * * * * cd ${SMOS_ROOT} && ${nodeBin()} ${SWEEP_JS} >> ${HINTS_DIR}/_sweeper.stdout.log 2>&1`);
    return;
  }
  fs.mkdirSync(linuxUnitDir(), { recursive: true });
  fs.writeFileSync(path.join(linuxUnitDir(), `${LABEL}.service`),
    `[Unit]\nDescription=Mythos contextual sweep\n[Service]\nType=oneshot\nWorkingDirectory=${SMOS_ROOT}\nExecStart=${nodeBin()} ${SWEEP_JS}\n`);
  fs.writeFileSync(path.join(linuxUnitDir(), `${LABEL}.timer`),
    `[Unit]\nDescription=Mythos contextual sweep every ${INTERVAL_SEC}s\n[Timer]\nOnBootSec=${INTERVAL_SEC}\nOnUnitActiveSec=${INTERVAL_SEC}\n[Install]\nWantedBy=timers.target\n`);
  execFileSync('systemctl', ['--user', 'daemon-reload']);
  execFileSync('systemctl', ['--user', 'enable', '--now', `${LABEL}.timer`]);
  console.log('installed (systemd --user timer):', `${LABEL}.timer | every ${INTERVAL_SEC}s`);
}
function linuxUninstall() {
  try { execFileSync('systemctl', ['--user', 'disable', '--now', `${LABEL}.timer`], { stdio: 'ignore' }); } catch (_) {}
  for (const f of [`${LABEL}.timer`, `${LABEL}.service`]) {
    const p = path.join(linuxUnitDir(), f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  console.log('uninstalled (systemd --user)');
}
function linuxStatus() {
  const r = spawnSync('systemctl', ['--user', 'is-active', `${LABEL}.timer`], { encoding: 'utf8' });
  console.log('timer:', (r.stdout || r.stderr || 'unknown').trim());
}

// ---------------------------------------------------------------------------
const DISPATCH = {
  darwin: { install: macInstall, uninstall: macUninstall, status: macStatus },
  win32: { install: winInstall, uninstall: winUninstall, status: winStatus },
  linux: { install: linuxInstall, uninstall: linuxUninstall, status: linuxStatus },
};

const cmd = process.argv[2];
if (cmd === 'run-once') { runOnce(); }
else {
  const d = DISPATCH[PLATFORM];
  if (!d) { console.error(`Unsupported platform: ${PLATFORM}`); process.exit(1); }
  if (cmd === 'install') d.install();
  else if (cmd === 'uninstall') d.uninstall();
  else if (cmd === 'status') d.status();
  else {
    console.log('Usage: node tools/memory/install-sweeper.js {install|uninstall|status|run-once}');
    console.log(`Platform: ${PLATFORM} | sweep: ${path.relative(SMOS_ROOT, SWEEP_JS)} | interval: ${INTERVAL_SEC}s`);
    process.exit(cmd ? 1 : 0);
  }
}
