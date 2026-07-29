'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '../../../..');
}

function readPayload() {
  try {
    const chunks = [];
    const fs = require('fs');
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toolName(payload) {
  return String(
    payload.tool_name ||
    payload.tool ||
    process.env.CLAUDE_TOOL_NAME ||
    ''
  );
}

function toolInput(payload) {
  if (payload && payload.tool_input && typeof payload.tool_input === 'object') {
    return payload.tool_input;
  }
  try {
    const parsed = JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function sessionId(payload) {
  return String(
    payload.session_id ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CLAUDE_SESSION ||
    'unknown-session'
  );
}

function appendHookEvent(entry) {
  try {
    const root = projectRoot();
    const mod = require(path.join(root, 'tools/claude/lib/hook-telemetry.cjs'));
    if (mod && typeof mod.appendHookEvent === 'function') mod.appendHookEvent(entry);
  } catch {
    // Telemetry must never break hook dispatch.
  }
}

function runNodeScript(relativeScript, args, payload, opts = {}) {
  const root = projectRoot();
  const script = path.join(root, relativeScript);
  const input = JSON.stringify(payload || {});
  const childEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: root,
    CLAUDE_TOOL_INPUT: JSON.stringify(toolInput(payload || {})),
    CLAUDE_TOOL_NAME: opts.toolName || toolName(payload || {})
  };
  const res = spawnSync(process.execPath, [script, ...(args || [])], {
    cwd: root,
    env: childEnv,
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.error) {
    process.stderr.write(`[compat-dispatch] ${relativeScript}: ${res.error.message}\n`);
    return 0;
  }
  return typeof res.status === 'number' ? res.status : 0;
}

function shouldEmit(payload, key) {
  try {
    const root = projectRoot();
    const mod = require(path.join(root, 'tools/kernel/hooks/lib/once-per-session.cjs'));
    return mod.shouldEmit(sessionId(payload), key);
  } catch {
    return true;
  }
}

function writeOut(text) {
  if (text) process.stdout.write(text);
}

function writeErr(text) {
  if (text) process.stderr.write(text);
}

function finish(status) {
  if (status === 2) process.exit(2);
  process.exit(0);
}

module.exports = {
  appendHookEvent,
  finish,
  projectRoot,
  readPayload,
  runNodeScript,
  sessionId,
  shouldEmit,
  toolInput,
  toolName,
  writeErr,
  writeOut
};
