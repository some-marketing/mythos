#!/usr/bin/env node
'use strict';
//
// tools/security/elevenlabs-keys/provision-key.js
//
// CLI for provisioning ElevenLabs workload API keys into the 1Password
// "Automation" vault, per elevenlabs-key-manifest.yaml.
//
// KEY CREATION IS NOT AUTOMATED. Creating an ElevenLabs key requires admin
// scope and is a human dashboard action. This tool operates on ALREADY-CREATED
// raw keys: storing them safely and validating their live scopes.
//
// Subcommands:
//   check-manifest            Parse + enforce all security invariants. Exit 1 on any violation.
//   map [--out <file>]        Emit the profile -> vault_path JSON map (no secrets).
//   store --profile <name>    Read a raw key from STDIN (never argv) and store it into the
//                             Automation vault at the profile's vault_path with metadata.
//                             If `op` is not authenticated, print the exact operator-run
//                             command instead of failing.
//   validate --profile <name> [--deep]
//                             Read a key from STDIN and check its LIVE scopes against the
//                             profile via the ElevenLabs API (read-only unless --deep).
//
// Secret hygiene: the raw key is read ONLY from process.stdin. It never appears
// in argv, shell history, a committed env file, or a log line.
//
// Portability: cwd-independent. The manifest path defaults to the file next to
// this script and can be overridden with --manifest <path> or the
// ELEVENLABS_KEY_MANIFEST env var.

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const lib = require('./lib.cjs');

const SCRIPT_DIR = __dirname;
const DEFAULT_MANIFEST = path.join(SCRIPT_DIR, 'elevenlabs-key-manifest.yaml');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deep') out.deep = true;
    else if (a === '--profile') out.profile = argv[++i];
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else out._.push(a);
  }
  return out;
}

function manifestPath(args) {
  return args.manifest || process.env.ELEVENLABS_KEY_MANIFEST || DEFAULT_MANIFEST;
}

function repoRelative(abs) {
  // Best-effort display path relative to repo root (two levels above tools/).
  const root = path.resolve(SCRIPT_DIR, '../../..');
  const rel = path.relative(root, abs);
  return rel.startsWith('..') ? abs : rel;
}

// Read a secret from stdin without echoing. If stdin is a TTY, disable echo;
// otherwise consume piped input. Returns a Promise<string> (trimmed of a single
// trailing newline only).
function readSecretFromStdin(promptText) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (stdin.isTTY) {
      process.stderr.write(promptText || 'Paste the raw key and press Enter (input hidden): ');
      let buf = '';
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      const onData = (ch) => {
        if (ch === '\r' || ch === '\n' || ch === '') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          resolve(buf);
        } else if (ch === '') {
          stdin.setRawMode(false);
          stdin.pause();
          reject(new Error('aborted'));
        } else if (ch === '' || ch === '\b') {
          buf = buf.slice(0, -1);
        } else {
          buf += ch;
        }
      };
      stdin.on('data', onData);
    } else {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { data += c; });
      stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      stdin.on('error', reject);
    }
  });
}

// Minimal HTTPS JSON caller for `validate`. Returns { status, json }.
function httpElevenLabs(req) {
  return new Promise((resolve, reject) => {
    const url = new URL(lib.BASE_URL + req.path);
    const body = req.minimalBody ? '{}' : undefined;
    const options = {
      method: req.method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { 'xi-api-key': req.key, Accept: 'application/json' }
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const r = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        let json;
        try { json = data ? JSON.parse(data) : {}; } catch (_e) { json = { _raw: data.slice(0, 200) }; }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

function loadSafeManifest(args) {
  const mp = manifestPath(args);
  const manifest = lib.loadManifest(mp);
  return { manifest, mp };
}

function requireProfile(manifest, name) {
  if (!name) { console.error('error: --profile <name> is required'); process.exit(2); }
  const p = lib.getProfile(manifest, name);
  if (!p) { console.error(`error: no profile "${name}" in manifest`); process.exit(2); }
  return p;
}

async function cmdCheckManifest(args) {
  const { manifest, mp } = loadSafeManifest(args);
  const res = lib.assertManifestSafe(manifest, { throwOnFail: false });
  console.log(`manifest: ${repoRelative(mp)}`);
  console.log(`profiles: ${manifest.profiles.length} (skipped not_provisioned: ${res.skipped.join(', ') || 'none'})`);
  if (res.ok) {
    console.log('RESULT: PASS — all security invariants hold.');
    process.exit(0);
  }
  console.error('RESULT: FAIL');
  for (const v of res.violations) console.error('  - ' + v);
  process.exit(1);
}

async function cmdMap(args) {
  const { manifest } = loadSafeManifest(args);
  // Fail closed: never emit a map for a manifest that violates invariants.
  lib.assertManifestSafe(manifest, { throwOnFail: true });
  const map = lib.buildProfileMap(manifest);
  const out = JSON.stringify(map, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, out + '\n');
    console.error(`wrote map -> ${args.out}`);
  } else {
    process.stdout.write(out + '\n');
  }
}

async function cmdStore(args) {
  const { manifest } = loadSafeManifest(args);
  lib.assertManifestSafe(manifest, { throwOnFail: true });
  const profile = requireProfile(manifest, args.profile);
  if (!lib.isProvisioned(profile)) {
    console.error(`error: profile "${profile.profile}" is not_provisioned — create the key in the ElevenLabs dashboard first, then remove the not_provisioned status.`);
    process.exit(2);
  }

  const opRunner = lib.makeRealOpRunner();
  const opUp = lib.probeOpAvailable(opRunner);

  if (!opUp) {
    // Graceful degrade — DO NOT read the secret we cannot store.
    const cmd = lib.operatorRunStoreCommand(profile.profile, repoRelative(path.join(SCRIPT_DIR, 'provision-key.js')));
    console.error('`op` is not authenticated in this shell — nothing was read or stored.');
    console.error('');
    console.error('Run this in an authenticated op shell (the key is read from stdin, never argv):');
    console.error('  ' + cmd.display);
    console.error('');
    console.error(cmd.note);
    process.exit(3);
  }

  const vault = manifest.vault || lib.DESTINATION_VAULT;
  const rawKey = await readSecretFromStdin(`Paste the raw ElevenLabs key for "${profile.profile}" and press Enter (hidden): `);
  if (!rawKey) { console.error('error: empty key; nothing stored.'); process.exit(1); }

  let template = lib.buildOpItemTemplate(profile, rawKey, vault);
  try {
    // Secret travels via STDIN to op, never argv. `-` reads the JSON template.
    opRunner(['item', 'create', '--vault', vault, '-'], template);
  } finally {
    // Best-effort scrub of local references.
    template = null;
  }
  console.error(`stored: op://${vault}/${profile.vault_path} (profile "${profile.profile}")`);
  console.error(`verify presence (no value):  op item get "${profile.vault_path}" --vault ${vault} --format json`);
}

async function cmdValidate(args) {
  const { manifest } = loadSafeManifest(args);
  const profile = requireProfile(manifest, args.profile);
  if (!lib.isProvisioned(profile)) {
    console.error(`error: profile "${profile.profile}" is not_provisioned — nothing to validate.`);
    process.exit(2);
  }
  const rawKey = await readSecretFromStdin(`Paste the raw ElevenLabs key for "${profile.profile}" to validate (hidden): `);
  if (!rawKey) { console.error('error: empty key.'); process.exit(1); }

  const res = await lib.validateKeyScopes(profile, rawKey, httpElevenLabs, { deep: !!args.deep });
  console.log(`profile: ${profile.profile}`);
  console.log(`expected capabilities: ${res.expected.join(', ') || '(none)'}`);
  console.log(`deep over-privilege probes: ${args.deep ? 'ON' : 'off (pass --deep to enable, mutation-safe)'}`);
  if (res.ok) {
    console.log('RESULT: PASS — live scopes consistent with profile (within probe coverage).');
    process.exit(0);
  }
  console.error('RESULT: FINDINGS');
  for (const f of res.findings) console.error('  - ' + f);
  // Under/over-privilege and auth failures are hard fails; inconclusive is a warn.
  const hardFail = res.findings.some((f) => !/^INCONCLUSIVE/.test(f));
  process.exit(hardFail ? 1 : 0);
}

function usage() {
  console.log(`elevenlabs-keys — provision ElevenLabs workload keys into 1Password Automation vault

Usage:
  node provision-key.js check-manifest [--manifest <path>]
  node provision-key.js map [--out <file>] [--manifest <path>]
  node provision-key.js store --profile <name> [--manifest <path>]
  node provision-key.js validate --profile <name> [--deep] [--manifest <path>]

The raw key is read ONLY from stdin. Key CREATION is a human dashboard action.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (args.help || !cmd) { usage(); process.exit(cmd ? 0 : 2); }
  try {
    if (cmd === 'check-manifest') return await cmdCheckManifest(args);
    if (cmd === 'map') return await cmdMap(args);
    if (cmd === 'store') return await cmdStore(args);
    if (cmd === 'validate') return await cmdValidate(args);
    console.error(`error: unknown subcommand "${cmd}"`);
    usage();
    process.exit(2);
  } catch (err) {
    console.error('error: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { parseArgs, repoRelative };
