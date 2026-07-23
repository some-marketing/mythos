'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_INTERVAL_SECONDS = 300;
const STATUS_SCHEMA = 'CodexListenerStatus/1.0';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function statusPathFor(projectRoot) {
  return path.join(projectRoot, '_dev', 'reports', 'analysis', 'codex-listener-status.json');
}

function logPathFor(projectRoot) {
  return path.join(projectRoot, '_dev', 'logs', 'codex-watch.log');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readListenerStatus(projectRoot) {
  const statusPath = statusPathFor(projectRoot);
  if (!fs.existsSync(statusPath)) {
    return {
      exists: false,
      active: false,
      statusPath
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    const pid = Number(parsed.pid || 0);
    const alive = isProcessAlive(pid);
    return {
      exists: true,
      active: Boolean(parsed.active) && alive,
      stale: Boolean(parsed.active) && !alive,
      pid,
      data: parsed,
      statusPath
    };
  } catch (err) {
    return {
      exists: true,
      active: false,
      stale: false,
      error: err.message,
      statusPath
    };
  }
}

function writeListenerStatus(projectRoot, data) {
  const statusPath = statusPathFor(projectRoot);
  ensureDir(path.dirname(statusPath));
  fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
  return statusPath;
}

function startCodexListener(projectRoot, opts = {}) {
  const intervalSeconds = Number(opts.intervalSeconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error('intervalSeconds must be a positive number');
  }

  const existing = readListenerStatus(projectRoot);
  if (existing.active) {
    return {
      started: false,
      alreadyActive: true,
      pid: existing.pid,
      statusPath: existing.statusPath,
      data: existing.data
    };
  }

  const logPath = logPathFor(projectRoot);
  ensureDir(path.dirname(logPath));
  const logFd = fs.openSync(logPath, 'a');
  const watchScript = path.join(projectRoot, 'tools', 'signals', 'watch-codex-bridge.js');
  const args = [watchScript, '--interval-seconds', String(intervalSeconds)];
  if (opts.model) {
    args.push('--model', opts.model);
  }

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);

  const now = new Date().toISOString();
  const data = {
    schema: STATUS_SCHEMA,
    listener: 'codex-watch',
    status: 'running',
    active: true,
    pid: child.pid,
    started_at: now,
    stopped_at: null,
    last_poll_at: null,
    error: null,
    interval_seconds: intervalSeconds,
    command: `${process.execPath} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`,
    log_path: path.relative(projectRoot, logPath)
  };
  const statusPath = writeListenerStatus(projectRoot, data);

  return {
    started: true,
    alreadyActive: false,
    pid: child.pid,
    statusPath,
    data
  };
}

function stopCodexListener(projectRoot) {
  const status = readListenerStatus(projectRoot);
  if (!status.exists) {
    return {
      stopped: false,
      reason: 'not_found',
      statusPath: status.statusPath
    };
  }

  const data = { ...(status.data || {}) };
  const pid = Number(data.pid || 0);
  const wasAlive = isProcessAlive(pid);

  if (wasAlive) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // fall through; status artifact still gets updated truthfully
    }
  }

  data.schema = STATUS_SCHEMA;
  data.listener = 'codex-watch';
  data.status = 'stopped';
  data.active = false;
  data.stopped_at = new Date().toISOString();
  data.stopped_reason = wasAlive ? 'operator_stop' : 'already_inactive';
  data.error = null;
  const statusPath = writeListenerStatus(projectRoot, data);

  return {
    stopped: true,
    wasAlive,
    pid,
    statusPath,
    data
  };
}

function updateListenerPoll(projectRoot) {
  const statusPath = statusPathFor(projectRoot);
  if (!fs.existsSync(statusPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    data.last_poll_at = new Date().toISOString();
    fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
    return statusPath;
  } catch {
    return null;
  }
}

function writeListenerError(projectRoot, errorMessage) {
  const statusPath = statusPathFor(projectRoot);
  let data = {};
  if (fs.existsSync(statusPath)) {
    try {
      data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch {
      // start fresh if parse fails
    }
  }
  data.schema = STATUS_SCHEMA;
  data.listener = 'codex-watch';
  data.status = 'error';
  data.active = false;
  data.stopped_at = new Date().toISOString();
  data.error = errorMessage;
  data.pid = data.pid || null;
  ensureDir(path.dirname(statusPath));
  fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
  return statusPath;
}

module.exports = {
  DEFAULT_INTERVAL_SECONDS,
  STATUS_SCHEMA,
  isProcessAlive,
  logPathFor,
  readListenerStatus,
  startCodexListener,
  statusPathFor,
  stopCodexListener,
  updateListenerPoll,
  writeListenerError,
  writeListenerStatus
};
