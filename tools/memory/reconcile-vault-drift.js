#!/usr/bin/env node
'use strict';

/**
 * reconcile-vault-drift.js
 * Diff the repo memory mirror (Mythos-memories/memory/*.md) against the
 * "Sam's Memories" 1Password vault and report which repo memories are MISSING
 * from the vault (present in repo, never written to the vault).
 *
 * Background
 *   Headless vault access was broken for a long window, so the /remember
 *   dual-write silently failed on the vault leg. The repo mirror kept growing
 *   while the vault went stale. This tool measures and (only under --apply)
 *   heals that drift.
 *
 * SAFETY — DRY-RUN BY DEFAULT
 *   With NO flags this tool performs ZERO writes. It prints the missing count
 *   and list and exits. Writes happen ONLY when --apply is passed explicitly,
 *   and each write is delegated to the audited tools/memory/remember-via-vault.sh
 *   writer (which is itself idempotent). This process never calls
 *   `op item create` / `op item edit` directly.
 *
 * Matching
 *   A repo memory file `foo.md` is considered present in the vault when some
 *   vault item carries a field `sm_os_memory_file == "foo.md"`. The
 *   idempotency key is the filename field, not the (human) title — the same
 *   key remember-via-vault.sh uses. MEMORY.md (the index) is excluded from the
 *   diff: it is a generated index, not a first-class vault memory.
 *
 * Token-byte invariant
 *   The service-account token is resolved via memory-vault.js's keychain-first
 *   fetchSamServiceAccountToken and is only ever passed to child `op` calls via
 *   the environment (never argv/stdout/logs). This file never prints it.
 *
 * Usage
 *   node tools/memory/reconcile-vault-drift.js            # dry-run: count + list, writes nothing
 *   node tools/memory/reconcile-vault-drift.js --json     # dry-run, machine-readable
 *   node tools/memory/reconcile-vault-drift.js --apply     # WRITE missing memories to the vault
 *   node tools/memory/reconcile-vault-drift.js --apply --limit 5   # bound an apply run
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const vaultLib = require('./memory-vault.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REPO_MEMORY_DIR = path.join(REPO_ROOT, 'Mythos-memories', 'memory');
const REMEMBER_SCRIPT = path.join(__dirname, 'remember-via-vault.sh');
const EXCLUDED_FILES = new Set(['MEMORY.md']);
const SAM_MEMORIES_VAULT = vaultLib.SAM_MEMORIES_VAULT;

class ReconcileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReconcileError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Repo side
// ---------------------------------------------------------------------------

/**
 * listRepoMemoryFiles(dir) — plaintext .md files in the repo memory mirror,
 * excluding dotfiles and the generated MEMORY.md index. Returns filenames only.
 */
function listRepoMemoryFiles(dir = REPO_MEMORY_DIR) {
  if (!fs.existsSync(dir)) {
    throw new ReconcileError('REPO_MEMORY_DIR_MISSING', `Repo memory dir not found: ${dir}`, { dir });
  }
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .filter((n) => !n.startsWith('.'))
    .filter((n) => !EXCLUDED_FILES.has(n))
    .sort();
}

// ---------------------------------------------------------------------------
// Vault side
// ---------------------------------------------------------------------------

/**
 * collectVaultMemoryFiles({ runCmd, token }) — the Set of `sm_os_memory_file`
 * field values present in the "Sam's Memories" vault. Reads each item's fields
 * (op item list only returns summaries) and extracts the filename key. Falls
 * back to the item title only when no filename field is present.
 */
function collectVaultMemoryFiles(options = {}) {
  const runCmd = options.runCmd || execSync;
  const token = options.token || vaultLib.fetchSamServiceAccountToken(runCmd);
  const childEnv = Object.assign({}, process.env, { OP_SERVICE_ACCOUNT_TOKEN: token });

  const listRaw = String(
    runCmd(`op item list --vault "${SAM_MEMORIES_VAULT}" --format=json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv
    })
  );
  const items = JSON.parse(listRaw);
  if (!Array.isArray(items)) {
    throw new ReconcileError('VAULT_LIST_PARSE_FAIL', 'op vault list returned non-array.');
  }

  const present = new Set();
  for (const candidate of items) {
    let fileValue = null;
    try {
      const detailRaw = String(
        runCmd(`op item get "${candidate.id}" --vault "${SAM_MEMORIES_VAULT}" --format=json`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: childEnv
        })
      );
      const item = JSON.parse(detailRaw);
      const field = (item.fields || []).find((f) => f.label === 'sm_os_memory_file');
      if (field && field.value) fileValue = String(field.value);
    } catch (_) {
      // Unreadable item — skip; it just won't count as present.
    }
    if (fileValue) present.add(fileValue);
    else if (candidate.title) present.add(String(candidate.title)); // title fallback
  }
  return present;
}

// ---------------------------------------------------------------------------
// Diff (pure — the testable core)
// ---------------------------------------------------------------------------

/**
 * computeMissing(repoFiles, vaultFiles) — repo memory filenames that are NOT
 * present in the vault. `vaultFiles` may be a Set or an array.
 * @returns {string[]} sorted list of missing filenames.
 */
function computeMissing(repoFiles, vaultFiles) {
  const present = vaultFiles instanceof Set ? vaultFiles : new Set(vaultFiles || []);
  return repoFiles.filter((f) => !present.has(f)).sort();
}

// ---------------------------------------------------------------------------
// Writer (only reachable under --apply)
// ---------------------------------------------------------------------------

function defaultWriteMemory(filename) {
  const filePath = path.join(REPO_MEMORY_DIR, filename);
  const res = spawnSync('bash', [REMEMBER_SCRIPT, filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { filename, status: res.status, ok: res.status === 0 };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * reconcile(options)
 * @param {boolean} [options.apply=false]  Only true actually writes.
 * @param {number}  [options.limit]        Cap the number of --apply writes.
 * @param {string[]} [options.repoFiles]   Override repo file list (tests).
 * @param {Set|string[]} [options.vaultFiles]  Precomputed vault set (tests).
 * @param {Function} [options.collectVault]  Vault collector (tests / injection).
 * @param {Function} [options.writeMemory]  Writer (tests / injection).
 * @returns {{ repoCount, vaultCount, missingCount, missing, applied, writes }}
 */
function reconcile(options = {}) {
  const apply = options.apply === true;

  const repoFiles = options.repoFiles || listRepoMemoryFiles(options.repoDir);

  let vaultFiles = options.vaultFiles;
  if (!vaultFiles) {
    const collect = options.collectVault || collectVaultMemoryFiles;
    vaultFiles = collect({ runCmd: options.runCmd, token: options.token });
  }
  const vaultSet = vaultFiles instanceof Set ? vaultFiles : new Set(vaultFiles || []);

  const missing = computeMissing(repoFiles, vaultSet);

  const result = {
    repoCount: repoFiles.length,
    vaultCount: vaultSet.size,
    missingCount: missing.length,
    missing,
    applied: false,
    writes: []
  };

  // HARD GUARD: no write path is reachable unless apply === true.
  if (!apply) return result;

  const writeMemory = options.writeMemory || defaultWriteMemory;
  const toWrite = typeof options.limit === 'number' ? missing.slice(0, options.limit) : missing;
  result.applied = true;
  for (const filename of toWrite) {
    result.writes.push(writeMemory(filename));
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [], apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--json') out.json = true;
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice('--limit='.length));
    else if (a.startsWith('--')) out[a.slice(2)] = true;
    else out._.push(a);
  }
  return out;
}

function cli(argv) {
  const args = parseArgs(argv.slice(2));
  try {
    const result = reconcile({ apply: args.apply, limit: args.limit });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`repo memories:  ${result.repoCount}`);
      console.log(`vault memories: ${result.vaultCount}`);
      console.log(`MISSING from vault (repo-only): ${result.missingCount}`);
      for (const f of result.missing) console.log(`  ${f}`);
      if (!result.applied) {
        console.log('');
        console.log('DRY-RUN: nothing written. Re-run with --apply to write missing memories.');
      } else {
        const okCount = result.writes.filter((w) => w.ok).length;
        console.log('');
        console.log(`APPLIED: ${okCount}/${result.writes.length} writes succeeded.`);
        for (const w of result.writes) {
          if (!w.ok) console.log(`  FAILED (${w.status}): ${w.filename}`);
        }
      }
    }
    process.exit(0);
  } catch (e) {
    if (e && e.name === 'ReconcileError') {
      console.error(`ERROR ${e.code}: ${e.message}`);
      process.exit(3);
    }
    if (e && e.name === 'MemoryVaultError') {
      console.error(`ERROR ${e.code}: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }
}

if (require.main === module) cli(process.argv);

module.exports = {
  listRepoMemoryFiles,
  collectVaultMemoryFiles,
  computeMissing,
  reconcile,
  defaultWriteMemory,
  parseArgs,
  ReconcileError,
  REPO_MEMORY_DIR,
  EXCLUDED_FILES
};
