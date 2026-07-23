#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');
const { assertRelativePath } = require('./lib/run-evidence-index.cjs');
const { hash } = require('./lib/verdict-envelope.cjs');
const { appendPublicKey, acceptanceSubject, signAcceptanceReceipt, validateKeyring } = require('./lib/operator-acceptance-signature.cjs');

const SERVICE = 'MYTHOS_VERDICT_ACCEPTANCE_ED25519';
const DEFAULT_KEYRING = 'tools/verify/keys/operator-public-keyring.json';
const KEYCHAIN_HELPER = path.join(__dirname, 'keychain-secret.swift');

function help() { return `Usage:
  node tools/verify/stamp-verdict-acceptance.cjs init [--keyring <file>]
  node tools/verify/stamp-verdict-acceptance.cjs rotate [--keyring <file>]
  node tools/verify/stamp-verdict-acceptance.cjs stamp --task-id <id> --scope <scope> --decision <accept|reject> --actor-id <human> --structural-index <file> --semantic-receipt <file> --output <file> [--keyring <file>]

Private keys are generated and read only through macOS Keychain. init, rotate, and stamp require an interactive TTY.
`; }
function parse(argv) { const out = { mode: argv[2] || '' }; for (let i = 3; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; out[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]; } return out; }
function readJson(root, file) { const safe = assertRelativePath(file); return JSON.parse(fs.readFileSync(path.join(root, safe), 'utf8')); }
function requireTty() { if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('interactive operator TTY required before Keychain access'); }
async function confirm(message, expected) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const answer = await rl.question(`${message}\nType ${expected}: `); rl.close(); if (answer !== expected) throw new Error('operator confirmation did not match'); }
function keychainStore(fingerprint, privatePem) { const r = spawnSync('swift', [KEYCHAIN_HELPER, 'store', SERVICE, fingerprint], { input: privatePem, encoding: 'utf8' }); if (r.status !== 0) throw new Error('Keychain private-key write failed'); }
function keychainRead(fingerprint) { const r = spawnSync('swift', [KEYCHAIN_HELPER, 'read', SERVICE, fingerprint], { encoding: 'utf8' }); if (r.status !== 0 || !r.stdout) throw new Error('Keychain private key unavailable'); return r.stdout.trim(); }
function writeJsonAtomic(target, value) { const tmp = `${target}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, target); }

async function main() {
  const args = parse(process.argv);
  if (args.mode === '--help' || args.mode === 'help' || !args.mode) return process.stdout.write(help());
  if (['privateKey', 'secret', 'key'].some((name) => args[name])) throw new Error('caller-supplied private key material is forbidden');
  requireTty();
  const root = path.resolve(args.root || process.cwd());
  const keyringRel = assertRelativePath(args.keyring || DEFAULT_KEYRING, 'keyring');
  const keyringPath = path.join(root, keyringRel);
  const keyring = JSON.parse(fs.readFileSync(keyringPath, 'utf8'));
  if (!validateKeyring(keyring).ok) throw new Error('keyring is invalid');
  if (args.mode === 'init' || args.mode === 'rotate') {
    if (args.mode === 'init' && keyring.keys.length) throw new Error('keyring already initialized; use rotate');
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const next = appendPublicKey(keyring, publicPem, new Date().toISOString());
    const fingerprint = next.current_fingerprint;
    await confirm(`${args.mode} operator acceptance signing key ${fingerprint}`, `AUTHORIZE ${fingerprint}`);
    keychainStore(fingerprint, privatePem);
    writeJsonAtomic(keyringPath, next);
    return process.stdout.write(JSON.stringify({ ok: true, mode: args.mode, fingerprint, keyring: keyringRel }) + '\n');
  }
  if (args.mode !== 'stamp') throw new Error(`unknown mode: ${args.mode}`);
  const structural = readJson(root, args.structuralIndex);
  const semantic = readJson(root, args.semanticReceipt);
  const unsigned = {
    schema: 'HumanAcceptanceReceipt/1.0', task_id: args.taskId, acceptance_scope: args.scope, decision: args.decision,
    structural_index_sha256: hash(structural), semantic_receipt_sha256: hash(semantic),
    semantic_child_index_sha256: semantic.semantic_child_index_sha256 || null,
    public_key_fingerprint: keyring.current_fingerprint, actor_id: args.actorId, signed_at: new Date().toISOString()
  };
  const digest = hash(acceptanceSubject(unsigned));
  await confirm(`${args.decision} task ${args.taskId} in scope ${args.scope} using ${keyring.current_fingerprint}; subject ${digest}`, `SIGN ${digest}`);
  const receipt = signAcceptanceReceipt(unsigned, keychainRead(keyring.current_fingerprint));
  const output = assertRelativePath(args.output, 'output'); const target = path.join(root, output);
  if (fs.existsSync(target)) throw new Error('output already exists; refusing overwrite');
  fs.mkdirSync(path.dirname(target), { recursive: true }); writeJsonAtomic(target, receipt);
  process.stdout.write(JSON.stringify({ ok: true, output, decision: args.decision, fingerprint: keyring.current_fingerprint }) + '\n');
}
if (require.main === module) main().catch((error) => { process.stderr.write(`stamp-verdict-acceptance: ${error.message}\n`); process.exit(1); });
module.exports = { help, parse, requireTty, main };
