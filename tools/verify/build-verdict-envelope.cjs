#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { assertRelativePath } = require('./lib/run-evidence-index.cjs');
const { buildVerdictEnvelope } = require('./lib/verdict-envelope.cjs');

function help() {
  return `Usage:
  node tools/verify/build-verdict-envelope.cjs --task-id <id> --structural-index <file> [--semantic-receipt <file>] [--acceptance-receipt <file>] --output <file>

Options:
  --root <path>       Project root (default cwd)
  --keyring <file>    Public keyring (default tools/verify/keys/operator-public-keyring.json)
  --derived-at <iso>  Fixed derivation time
`;
}

function parse(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help') { out.help = true; continue; }
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return out;
}

function read(root, file, label, optional = false) {
  if (!file && optional) return null;
  const safe = assertRelativePath(file, label);
  return JSON.parse(fs.readFileSync(path.join(root, safe), 'utf8'));
}

function main() {
  const args = parse(process.argv);
  if (args.help) return process.stdout.write(help());
  const root = path.resolve(args.root || process.cwd());
  const result = buildVerdictEnvelope({
    taskId: args.taskId,
    structuralIndex: read(root, args.structuralIndex, 'structural_index'),
    semanticReceipt: read(root, args.semanticReceipt, 'semantic_receipt', true),
    acceptanceReceipt: read(root, args.acceptanceReceipt, 'acceptance_receipt', true),
    keyring: read(root, args.keyring || 'tools/verify/keys/operator-public-keyring.json', 'keyring'),
    derivedAt: args.derivedAt
  });
  const output = assertRelativePath(args.output, 'output');
  const target = path.join(root, output);
  if (fs.existsSync(target)) throw new Error('output already exists; refusing overwrite');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, output, aggregate_state: result.aggregate_state }) + '\n');
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`build-verdict-envelope: ${error.message}\n`); process.exit(1); }
}
module.exports = { help, parse, main };
