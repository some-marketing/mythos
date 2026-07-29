#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  createActorAwarenessPacket,
  formatActorPacketSummary
} = require('./repo-awareness.cjs');

function parseArgs(argv) {
  const out = {
    actorId: '',
    role: 'actor',
    task: '',
    model: '',
    desiredState: '',
    source: 'pre-agent',
    includeBoundaryDetails: false,
    json: false,
    root: process.cwd()
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--actor-id') {
      out.actorId = next || '';
      i += 1;
    } else if (arg === '--role') {
      out.role = next || out.role;
      i += 1;
    } else if (arg === '--task' || arg === '--command') {
      out.task = next || '';
      i += 1;
    } else if (arg === '--model' || arg === '--mind') {
      out.model = next || '';
      i += 1;
    } else if (arg === '--desired-state') {
      out.desiredState = next || '';
      i += 1;
    } else if (arg === '--source') {
      out.source = next || out.source;
      i += 1;
    } else if (arg === '--include-boundary-details') {
      out.includeBoundaryDetails = true;
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
  const projectRoot = path.resolve(args.root);
  const result = createActorAwarenessPacket(projectRoot, {
    actorId: args.actorId,
    role: args.role,
    task: args.task || 'bounded actor work',
    model: args.model,
    desiredState: args.desiredState,
    source: args.source,
    includeBoundaryDetails: args.includeBoundaryDetails
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, paths: result.paths, packet: result.packet }, null, 2)}\n`);
  } else {
    process.stdout.write(formatActorPacketSummary(result));
  }
}

if (require.main === module) main();

module.exports = { main, parseArgs };
