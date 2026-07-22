#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  formatInitSummary,
  initRepoAwareness
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
  const out = { sessionId: '', source: 'session-start', json: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--session-id') {
      out.sessionId = next || '';
      i += 1;
    } else if (arg === '--source') {
      out.source = next || out.source;
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
  const result = initRepoAwareness(projectRoot, {
    sessionId: args.sessionId || payload.session_id || payload.sessionId || undefined,
    source: args.source
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, paths: result.paths, snapshot: result.snapshot }, null, 2)}\n`);
  } else {
    process.stdout.write(formatInitSummary(result));
  }
}

if (require.main === module) main();

module.exports = { main, parseArgs, readPayload };
