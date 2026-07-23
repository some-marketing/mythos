#!/usr/bin/env node
'use strict';
const path = require('path');
const { parseArgs } = require('../workspace/lib/args');
const { runEndSessionCloseout } = require('./lib/end-session-closeout');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
function help() { return `Usage: node tools/maintenance/end-session-closeout.js (--system | --client CODE | --scope <workstream>)\n\nEmit an EndSessionCloseout/1.0 JSON + Markdown index for the selected scope.`; }
function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) { process.stdout.write(`${help()}\n`); return; }
  const closeout = runEndSessionCloseout(PROJECT_ROOT, { argv: process.argv.slice(2), system: Boolean(args.system), client: args.client || '', scope: args.scope || '' });
  const summary = { ok: true, ready_for_clear: closeout.ready_for_clear, blockers: closeout.blockers.map((blocker) => blocker.id), json_path: closeout.output_paths.json, md_path: closeout.output_paths.markdown };
  process.stdout.write(`${JSON.stringify(args.json ? closeout : summary, null, 2)}\n`);
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; } }
