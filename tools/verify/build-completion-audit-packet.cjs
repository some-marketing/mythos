#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { assertRelativePath } = require('./lib/run-evidence-index.cjs');
const { assembleCompletionAuditPacket, readJsonBounded } = require('./lib/completion-audit-packet.cjs');

function help() { return `Usage:
  node tools/verify/build-completion-audit-packet.cjs --config <repo-relative-json> --output <repo-relative-json>

The config names one explicit task, plan, RunEvidenceIndex, VerdictEnvelope, criteria mapping file data, changed-file expectations, and test-receipt paths. Raw command/result strings are rejected.
`; }
function parse(argv) { const out = {}; for (let i = 2; i < argv.length; i++) { if (argv[i] === '--help') { out.help = true; continue; } if (!argv[i].startsWith('--')) continue; out[argv[i].slice(2)] = argv[++i]; } return out; }
function main() {
  const args = parse(process.argv); if (args.help) return process.stdout.write(help());
  const root = path.resolve(args.root || process.cwd());
  const config = readJsonBounded(root, args.config, 'config').value;
  const packet = assembleCompletionAuditPacket({ projectRoot: root, taskId: config.task_id, planPath: config.plan_path, runEvidencePath: config.run_evidence_path, verdictEnvelopePath: config.verdict_envelope_path, keyringPath: config.keyring_path, criteria: config.criteria, changedFiles: config.changed_files, testReceiptPaths: config.test_receipt_paths, blockers: config.blockers, rollbackEvidence: config.rollback_evidence, packetProducer: config.packet_producer, builtAt: config.built_at, rawCommand: config.command, rawResult: config.result });
  const output = assertRelativePath(args.output, 'output'); const target = path.join(root, output);
  if (fs.existsSync(target)) throw new Error('output already exists; refusing overwrite');
  try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error('output path is a symlink'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let existingParent = path.dirname(target);
  while (!fs.existsSync(existingParent) && existingParent !== root) existingParent = path.dirname(existingParent);
  const rootReal = fs.realpathSync(root); const existingReal = fs.realpathSync(existingParent);
  if (existingReal !== rootReal && !existingReal.startsWith(rootReal + path.sep)) throw new Error('output parent resolves outside project root');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(packet, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, output, packet_state: packet.packet_state }) + '\n');
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`build-completion-audit-packet: ${error.message}\n`); process.exit(1); } }
module.exports = { help, parse, main };
