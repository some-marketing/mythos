#!/usr/bin/env node
// tools/kernel/heartbeat.js
//
// Kernel heartbeat — periodic self-check that writes a pulse record to disk
// so every session waking up can see when the kernel was last alive and what
// it saw. Runs via launchd on a schedule (see tools/launchd/services.json).
//
// Scope: READ-ONLY. Never writes, rotates, or mutates credentials or any other
// live state outside its own pulse file and log file. If a lane is broken, the
// heartbeat records it — it does not attempt to fix it.
//
// Authority:
//   - Canonical Discipline #5 (Host-State Proprioception): the kernel should
//     sense its own state, not wait for operator prompts to discover drift
//   - Canonical Discipline #1 (Cross-Verification Law): the heartbeat records
//     which lanes are available so cross-verification can route correctly
//   - check-yoself-routing.md: three-tier adapter architecture, same lanes
//
// Output artifacts:
//   - _dev/state/kernel-heartbeat.json — latest pulse (overwritten each tick)
//   - _dev/state/kernel-heartbeat-history.jsonl — append-only log of every pulse
//   - _dev/logs/kernel-heartbeat.log — launchd stdout/stderr for debugging
//
// Failure policy: the heartbeat must never throw. All lane probes are wrapped
// in try/catch. A failing probe becomes an anomaly in the pulse record, not a
// crash of the heartbeat itself. The heartbeat's only job is to observe and
// write; observation failures are themselves observations.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state');
const LOG_DIR = path.join(REPO_ROOT, '_dev', 'logs');
const PULSE_PATH = path.join(STATE_DIR, 'kernel-heartbeat.json');
const HISTORY_PATH = path.join(STATE_DIR, 'kernel-heartbeat-history.jsonl');
const LOG_PATH = path.join(LOG_DIR, 'kernel-heartbeat.log');

function ensureDirs() {
  for (const dir of [STATE_DIR, LOG_DIR]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
}

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch { /* swallow */ }
}

function safeExec(cmd, timeoutMs = 3000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return { __error: err.message.split('\n')[0] };
  }
}

function probeCodex() {
  const home = os.homedir();
  const authPath = path.join(home, '.codex', 'auth.json');
  const lane = { name: 'codex', state: 'unknown', detail: null };
  try {
    if (!fs.existsSync(authPath)) {
      lane.state = 'not-configured';
      lane.detail = 'auth.json missing';
      return lane;
    }
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    lane.auth_mode = auth.auth_mode || 'unknown';
    lane.last_refresh = auth.last_refresh || null;
    lane.has_cached_api_key = Boolean(auth.OPENAI_API_KEY);
    if (lane.auth_mode === 'chatgpt') {
      lane.state = 'configured-subscription';
      const status = safeExec('codex login status 2>&1');
      if (typeof status === 'string' && /Logged in using ChatGPT/i.test(status)) {
        lane.state = 'verified-live';
      } else if (status && status.__error) {
        lane.detail = 'codex login status failed: ' + status.__error;
      }
    } else if (lane.auth_mode === 'apikey') {
      lane.state = 'configured-apikey';
      lane.detail = 'expected chatgpt subscription auth, not apikey';
    } else {
      lane.state = 'configured-unknown';
      lane.detail = `unexpected auth_mode=${lane.auth_mode}`;
    }
  } catch (err) {
    lane.state = 'error';
    lane.detail = err.message;
  }
  return lane;
}

function probeGemini() {
  const home = os.homedir();
  const settingsPath = path.join(home, '.gemini', 'settings.json');
  const lane = { name: 'gemini', state: 'unknown', detail: null };
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const auth = settings?.security?.auth?.selectedType || null;
      if (auth) {
        lane.auth_type = auth;
        lane.state = auth === 'oauth-personal' ? 'configured-subscription' : 'configured-' + auth;
      } else {
        lane.state = 'configured-unknown';
      }
    }
    const envKey =
      process.env.GOOGLE_AI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    if (envKey) {
      lane.has_api_key = true;
    }
    if (lane.state === 'unknown' && !envKey) {
      lane.state = 'not-configured';
    }
  } catch (err) {
    lane.state = 'error';
    lane.detail = err.message;
  }
  return lane;
}

function probeOllama() {
  const lane = { name: 'ollama', state: 'unknown', detail: null };
  const result = safeExec('curl -sS --max-time 2 http://localhost:11434/api/tags 2>&1');
  if (typeof result === 'string' && /"models"/.test(result)) {
    lane.state = 'verified-live';
    try {
      const parsed = JSON.parse(result);
      lane.model_count = Array.isArray(parsed.models) ? parsed.models.length : 0;
    } catch { /* ignore */ }
  } else {
    lane.state = 'not-reachable';
    if (result && result.__error) lane.detail = result.__error;
  }
  return lane;
}

function probeOpenAIDirect() {
  const lane = { name: 'openai-direct', state: 'unknown', detail: null };
  if (process.env.OPENAI_API_KEY) {
    lane.state = 'env-key-present';
    lane.detail = 'OPENAI_API_KEY in env — if operator is on subscription auth, unset to avoid accidental per-token billing';
  } else {
    lane.state = 'not-configured';
  }
  return lane;
}

function probeAnthropic() {
  const lane = { name: 'anthropic', state: 'unknown', detail: null };
  if (process.env.ANTHROPIC_API_KEY) {
    lane.state = 'env-key-present';
  } else {
    lane.state = 'claude-code-native-session-expected';
    lane.detail = 'running under Claude Max subscription via Claude Code';
  }
  return lane;
}

function probeDiskSpace() {
  const result = safeExec('df -h / 2>&1 | tail -1');
  if (typeof result === 'string') {
    const parts = result.split(/\s+/);
    return { state: 'observed', used_percent: parts[4] || null, available: parts[3] || null };
  }
  return { state: 'error', detail: (result && result.__error) || 'df failed' };
}

function probeMemory() {
  // On macOS, os.freemem() reports only truly-free pages and is useless as a
  // pressure signal — the OS uses all RAM for caching by design. The correct
  // signal is kern.memorystatus_level, which reports the percent of memory
  // the OS considers actually available (includes inactive + purgeable + cache
  // eviction headroom). 100 = all free, 0 = critical pressure.
  const total = os.totalmem();
  const osFreePercent = safeExec('sysctl -n kern.memorystatus_level');
  let freePercent = null;
  if (typeof osFreePercent === 'string' && /^\d+$/.test(osFreePercent.trim())) {
    freePercent = parseInt(osFreePercent.trim(), 10);
  }
  return {
    state: 'observed',
    total_gb: (total / 1024 / 1024 / 1024).toFixed(1),
    os_reported_free_percent: freePercent,
    node_only_free_gb: (os.freemem() / 1024 / 1024 / 1024).toFixed(1),
    note: 'os_reported_free_percent is the metric that matters on macOS. node_only_free_gb is what Node.js os.freemem returns (only strictly-free pages, not useful for pressure)'
  };
}

function collectPulse() {
  const timestamp = new Date().toISOString();
  const lanes = [
    probeCodex(),
    probeGemini(),
    probeOllama(),
    probeOpenAIDirect(),
    probeAnthropic()
  ];

  const anomalies = [];
  for (const lane of lanes) {
    if (lane.state === 'error' || lane.state === 'configured-apikey') {
      anomalies.push(`${lane.name}: ${lane.state}${lane.detail ? ' — ' + lane.detail : ''}`);
    }
    if (lane.name === 'codex' && lane.has_cached_api_key) {
      anomalies.push('codex: OPENAI_API_KEY still cached in auth.json — minor hygiene');
    }
  }

  const memProbe = probeMemory();
  const freePct = memProbe.os_reported_free_percent;
  if (freePct === null) {
    anomalies.push('host-memory: could not read kern.memorystatus_level — pressure state unknown');
  } else if (freePct < 10) {
    anomalies.push(`host-memory: CRITICAL — OS reports only ${freePct}% free on ${memProbe.total_gb} GB host. Real kernel-panic risk.`);
  } else if (freePct < 20) {
    anomalies.push(`host-memory: WARN — OS reports ${freePct}% free on ${memProbe.total_gb} GB host. Close heavy apps before running more work.`);
  }
  // Values >= 20% free are healthy macOS operation — do not alarm.

  const verifiedLive = lanes.filter(l => l.state === 'verified-live').length;
  const configured = lanes.filter(l => l.state && l.state.startsWith('configured')).length;
  const notConfigured = lanes.filter(l => l.state === 'not-configured' || l.state === 'not-reachable').length;

  return {
    schema: 'KernelHeartbeat/1.0',
    timestamp,
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      uptime_hours: (os.uptime() / 3600).toFixed(1),
      memory: memProbe,
      disk: probeDiskSpace()
    },
    lanes,
    summary: {
      verified_live: verifiedLive,
      configured: configured,
      not_configured: notConfigured,
      anomaly_count: anomalies.length
    },
    anomalies,
    notes: [
      'No anomalies does NOT mean all lanes are healthy — the heartbeat reports what it could cheaply probe.',
      'Verified-live lanes made a successful test call. Configured lanes have config on disk but were not actively probed.',
      'This heartbeat is READ-ONLY. It observes and writes; it does not repair.'
    ]
  };
}

function writePulse(pulse) {
  const serialized = JSON.stringify(pulse, null, 2);
  fs.writeFileSync(PULSE_PATH, serialized + '\n');
  const line = JSON.stringify({ t: pulse.timestamp, summary: pulse.summary, anomalies: pulse.anomalies });
  try { fs.appendFileSync(HISTORY_PATH, line + '\n'); } catch { /* ignore */ }
}

async function probeDartAuth() {
  try {
    const dartApi = require(path.join(REPO_ROOT, 'tools/dart-integration/lib/dart-api.js'));
    const result = await dartApi.probeAuthState();
    return {
      ok: Boolean(result && result.ok),
      state: result && result.state ? result.state : 'unknown',
      source: result && result.source ? result.source : null,
      code: result && result.code ? result.code : null
    };
  } catch (err) {
    return { ok: false, state: 'probe-error', source: null, error: err && err.message };
  }
}

async function main() {
  ensureDirs();
  logLine('heartbeat tick start');
  let pulse;
  try {
    pulse = collectPulse();
  } catch (err) {
    logLine(`collectPulse FAILED: ${err.message}`);
    pulse = {
      schema: 'KernelHeartbeat/1.0',
      timestamp: new Date().toISOString(),
      error: err.message,
      anomalies: ['heartbeat collection itself failed — kernel proprioception is degraded']
    };
  }
  try {
    pulse.dart_auth = await probeDartAuth();
    if (pulse.dart_auth && pulse.dart_auth.ok === false) {
      pulse.anomalies = pulse.anomalies || [];
      pulse.anomalies.push(`dart_auth: ${pulse.dart_auth.state}${pulse.dart_auth.code ? ' (' + pulse.dart_auth.code + ')' : ''}`);
      if (pulse.summary) pulse.summary.anomaly_count = pulse.anomalies.length;
    }
  } catch (err) {
    logLine(`probeDartAuth FAILED: ${err.message}`);
    pulse.dart_auth = { ok: false, state: 'probe-error', error: err.message };
  }
  try {
    writePulse(pulse);
    logLine(`heartbeat tick wrote pulse: ${pulse.summary ? JSON.stringify(pulse.summary) : 'error'}`);
  } catch (err) {
    logLine(`writePulse FAILED: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
