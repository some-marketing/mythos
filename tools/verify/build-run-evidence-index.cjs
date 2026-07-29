#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { snapshotRunEvidence, verifyRunEvidence, assertRelativePath } = require('./lib/run-evidence-index.cjs');

function help() {
  return `Usage:
  node tools/verify/build-run-evidence-index.cjs snapshot --run-state <repo-relative> --run-id <id> --criteria <json> --producer <json> --output <repo-relative>
  node tools/verify/build-run-evidence-index.cjs verify --receipt <repo-relative> --run-id <id> --verifier <json> --output <repo-relative>

Options:
  --root <path>          Project root (default cwd)
  --produced-at <iso>    Fixed snapshot timestamp
  --verified-at <iso>    Fixed verification timestamp
`;
}

function parse(argv) {
  const out = { mode: argv[2] || '' };
  for (let i = 3; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = argv[++i];
  }
  return out;
}

function readJson(root, relativePath, label) {
  const safe = assertRelativePath(relativePath, label);
  return JSON.parse(fs.readFileSync(path.join(root, safe), 'utf8'));
}

function writeOutput(root, relativePath, value) {
  const safe = assertRelativePath(relativePath, 'output');
  const target = path.join(root, safe);
  if (fs.existsSync(target)) throw new Error('output already exists; refusing overwrite');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
  return safe;
}

function main() {
  const args = parse(process.argv);
  if (args.mode === '--help' || args.mode === 'help' || !args.mode) {
    process.stdout.write(help());
    return;
  }
  const root = path.resolve(args.root || process.cwd());
  let result;
  if (args.mode === 'snapshot') {
    result = snapshotRunEvidence({
      projectRoot: root,
      runStatePath: args.runState,
      runId: args.runId,
      criteria: readJson(root, args.criteria, 'criteria'),
      producer: readJson(root, args.producer, 'producer'),
      producedAt: args.producedAt
    });
  } else if (args.mode === 'verify') {
    result = verifyRunEvidence({
      projectRoot: root,
      receipt: readJson(root, args.receipt, 'receipt'),
      runId: args.runId,
      verifier: readJson(root, args.verifier, 'verifier'),
      verifiedAt: args.verifiedAt
    });
  } else {
    throw new Error(`unknown mode: ${args.mode}`);
  }
  const output = writeOutput(root, args.output, result);
  process.stdout.write(JSON.stringify({ ok: true, mode: args.mode, output }) + '\n');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`build-run-evidence-index: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { parse, help, main };
