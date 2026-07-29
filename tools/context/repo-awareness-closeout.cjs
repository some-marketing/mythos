#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  closeoutRepoAwareness,
  formatCloseoutSummary
} = require('./repo-awareness.cjs');

function readPayload() {
  try {
    const raw = require('fs').readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const out = {
    sessionId: '',
    source: 'session-end',
    scope: 'system',
    handoffPath: '',
    recommendedNextCommand: '',
    json: false,
    root: process.cwd()
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--session-id') {
      out.sessionId = next || '';
      i += 1;
    } else if (arg === '--source') {
      out.source = next || out.source;
      i += 1;
    } else if (arg === '--scope') {
      out.scope = next || out.scope;
      i += 1;
    } else if (arg === '--handoff-path') {
      out.handoffPath = next || '';
      i += 1;
    } else if (arg === '--recommended-next-command') {
      out.recommendedNextCommand = next || '';
      i += 1;
    } else if (arg === '--root') {
      out.root = next || out.root;
      i += 1;
    } else if (arg === '--json') {
      out.json = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = readPayload();
  const projectRoot = path.resolve(args.root);
  const result = closeoutRepoAwareness(projectRoot, {
    sessionId: args.sessionId || payload.session_id || payload.sessionId || undefined,
    source: args.source,
    scope: args.scope,
    handoffPath: args.handoffPath,
    recommendedNextCommand: args.recommendedNextCommand
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, paths: result.paths, closeout: result.closeout }, null, 2)}\n`);
  } else {
    process.stdout.write(formatCloseoutSummary(result));
  }
}

if (require.main === module) main();

module.exports = { main, parseArgs, readPayload };
