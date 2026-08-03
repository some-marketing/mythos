#!/usr/bin/env node
'use strict';

// S1: PostToolUse session write-ledger
// Wire into dispatch-posttool.cjs: on Write/Edit/MultiEdit/Bash-mutation,
// append the resolved written path to _dev/state/active-sessions/{session_id}/write_log.json.

const fs = require('fs');
const path = require('path');

function getProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '../../..');
}

function getSessionId(payload) {
  if (payload && payload.session_id) return payload.session_id;
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  if (process.env.CLAUDE_SESSION) return process.env.CLAUDE_SESSION;
  // Identity parity with pretool-git-custody-gate.cjs: fall back to the
  // active-session registry `_current-id` sidecar before the day bucket. The
  // codewhale harness registers a session but sets no CLAUDE_* env, so without
  // this its writes land in day-* and its own custody set stays empty.
  try {
    // Resolve relative to this hook (not CLAUDE_PROJECT_DIR), so the registry
    // lookup is stable under test fixtures that redirect the project dir.
    const registry = require(path.join(__dirname, '..', '..', 'sessions', 'lib', 'active-session-registry.js'));
    const id = registry.getCurrentSessionId();
    if (id) return id;
  } catch (_) { /* sidecar absent or registry unreadable — fall through */ }
  return 'day-' + new Date().toISOString().slice(0, 10);
}

function resolveWrittenPaths(payload) {
  const tool = (payload && payload.tool_name) || '';
  const input = payload && payload.tool_input;
  if (!input) return [];

  const paths = [];
  
  // Track top-level file_path (universal for Write/Edit/MultiEdit)
  if (input.file_path) {
    paths.push(input.file_path);
  }

  // Also support nested edits in MultiEdit payloads for complete coverage
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (edit.file_path) paths.push(edit.file_path);
    }
  }

  const projectRoot = getProjectRoot();
  return paths.map(p => path.isAbsolute(p) ? path.relative(projectRoot, p) : p)
    .filter(p => p && !p.startsWith('..')); // Only track repo-relative paths
}

function appendToWriteLog(sessionId, repoRelPaths, toolName) {
  if (!repoRelPaths || repoRelPaths.length === 0) return;

  const projectRoot = getProjectRoot();
  const sessionDir = path.join(projectRoot, '_dev', 'state', 'active-sessions', sessionId);
  const logFile = path.join(sessionDir, 'write_log.json');
  const tempFile = logFile + '.tmp.' + process.pid + '.' + Date.now();

  try {
    fs.mkdirSync(sessionDir, { recursive: true });

    let data = { paths: [] };
    if (fs.existsSync(logFile)) {
      try {
        data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      } catch (_) {}
    }

    if (!Array.isArray(data.paths)) data.paths = [];

    const existing = new Set(data.paths.map(e => (typeof e === 'string' ? e : e.path)));
    
    let added = false;
    const now = new Date().toISOString();
    
    for (const p of repoRelPaths) {
      if (!existing.has(p)) {
        data.paths.push({
          path: p,
          at: now,
          tool: toolName
        });
        existing.add(p);
        added = true;
      }
    }

    if (added) {
      // atomic temp+validate+rename
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2) + '\n');
      fs.renameSync(tempFile, logFile);
    }
  } catch (err) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (_) {}
    // fail-open
  }
}

function main(passedPayload) {
  const payload = passedPayload || {};
  const sessionId = getSessionId(payload);
  const paths = resolveWrittenPaths(payload);
  const tool = payload.tool_name || 'unknown';
  
  appendToWriteLog(sessionId, paths, tool);
}

if (require.main === module) {
  try {
    let payloadStr = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => payloadStr += chunk);
    process.stdin.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(payloadStr); } catch (_) {}
      main(payload);
      process.exit(0);
    });
  } catch (_) {
    process.exit(0);
  }
} else {
  module.exports = { main };
}
