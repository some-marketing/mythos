#!/usr/bin/env node
'use strict';

/**
 * memory-vault.js
 * Standalone Node.js resolver for orchestrator memory entries.
 * No external dependencies — uses only Node.js built-ins.
 *
 * Why this exists
 *   The orchestrator's memory entries live in the 1Password vault
 *   "Sam's Memories" (see tools/memory/remember-via-vault.sh for the writer
 *   path and .claude/skills/mythos-remember/SKILL.md for the operator
 *   contract). The vault is reachable only on darwin via the `op` CLI; the
 *   Cowork Linux sandbox cannot run `op` and cannot reach the macOS
 *   Keychain. A resolver that only knows about the vault therefore cannot
 *   serve future Cowork sessions.
 *
 *   This file mirrors the multi-source pattern in
 *   tools/dart-integration/lib/dart-api.js#resolveToken and (when present)
 *   tools/auth/github-token.js: an ordered list of sources, each tried in
 *   turn, with typed errors and a clear diagnostic on miss.
 *
 * Source priority (read path)
 *   1. process.env.SMOS_MEMORY_OVERRIDE_DIR
 *      — if set, treat as a directory of plaintext memory files. Primary
 *        path for Cowork sandbox sessions: the operator pre-stages a copy
 *        of the relevant memories into a sandbox-readable directory and
 *        the resolver reads from there. No `op` required.
 *   2. Local plaintext shadow at ~/.claude/projects/-Users-admin-Documents-GitHub-mythos/memory/
 *      — the dual-write surface from mythos-remember (operator-readable
 *        copy of every vault item). Primary path for desktop Claude Code
 *        sessions where the shadow exists.
 *   3. 1Password vault "Sam's Memories" via `op item get --format=json` on darwin
 *      — canonical durable copy. Requires:
 *        - operator's `op` CLI signed in
 *        - operator vault item titled "Service Account Auth Token: sam"
 *          (Employee vault) holding the service-account credential
 *        - SAM_MEMORIES vault scope on the service account
 *      The Sam service-account token is fetched the same way
 *      tools/memory/remember-via-vault.sh fetches it: by item title, never
 *      by ID, into a shell-local var that this process zeroes on exit.
 *
 *   On any non-darwin platform without SMOS_MEMORY_OVERRIDE_DIR set and
 *   without a readable shadow at the standard path, this resolver raises
 *   `MEMORY_VAULT_UNREACHABLE` with a clear diagnostic instead of silently
 *   shelling out to `op`.
 *
 * Token-byte invariant
 *   This file never logs, transmits, or returns the 1Password
 *   service-account token. The token is fetched into a process-local
 *   string, used for the duration of one `op` call, and the variable is
 *   overwritten with an empty string before this function returns. The
 *   frontier (this Node process's caller, e.g. an orchestrator session)
 *   sees only memory body bytes, never credential bytes.
 *
 * Self-test
 *   node tools/memory/memory-vault.js list
 *   node tools/memory/memory-vault.js read MEMORY.md
 *   node tools/memory/memory-vault.js read MEMORY.md --source override:/tmp/staged-memory
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SHADOW_DIR = path.join(
  os.homedir(),
  '.claude',
  'projects',
  '-Users-admin-Documents-GitHub-mythos',
  'memory'
);

const SAM_TOKEN_ITEM_TITLE = 'Service Account Auth Token: sam';
const SAM_TOKEN_OPERATOR_VAULT = 'Employee';
const SAM_MEMORIES_VAULT = "Sam's Memories";

class MemoryVaultError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MemoryVaultError';
    this.code = code;
    this.details = details;
  }
}

function err(code, message, details = {}) {
  return new MemoryVaultError(code, message, details);
}

// ---------------------------------------------------------------------------
// Source 1: SMOS_MEMORY_OVERRIDE_DIR
// ---------------------------------------------------------------------------

function readFromOverride(name, env = process.env) {
  const dir = env.SMOS_MEMORY_OVERRIDE_DIR;
  if (!dir) return null;
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return null;
  return { source: 'override-dir', source_path: p, body: fs.readFileSync(p, 'utf8') };
}

function listOverride(env = process.env) {
  const dir = env.SMOS_MEMORY_OVERRIDE_DIR;
  if (!dir || !fs.existsSync(dir)) return null;
  return {
    source: 'override-dir',
    source_path: dir,
    entries: fs.readdirSync(dir).filter((n) => !n.startsWith('.'))
  };
}

// ---------------------------------------------------------------------------
// Source 2: local plaintext shadow
// ---------------------------------------------------------------------------

function readFromShadow(name) {
  const p = path.join(SHADOW_DIR, name);
  if (!fs.existsSync(p)) return null;
  return { source: 'shadow', source_path: p, body: fs.readFileSync(p, 'utf8') };
}

function listShadow() {
  if (!fs.existsSync(SHADOW_DIR)) return null;
  return {
    source: 'shadow',
    source_path: SHADOW_DIR,
    entries: fs.readdirSync(SHADOW_DIR).filter((n) => !n.startsWith('.'))
  };
}

// ---------------------------------------------------------------------------
// Source 3: 1Password vault (darwin only)
// ---------------------------------------------------------------------------

function platformSupportsVault(platform = process.platform) {
  return platform === 'darwin';
}

function opAvailable(runCmd = execSync) {
  try {
    runCmd('command -v op', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function fetchSamServiceAccountToken(runCmd = execSync) {
  // Source priority for the sam service-account token:
  //   1. process.env.OP_SERVICE_ACCOUNT_TOKEN — already exported by caller.
  //   2. macOS Keychain item smos-sam-automation-token / Mythos — durable
  //      headless cache mirroring the smos-1p-automation-token pattern.
  //      Enables fully headless operation with NO interactive op signin.
  //   3. op item get "Service Account Auth Token: sam" (Employee vault) —
  //      the original personal-signin fallback, unchanged.
  //
  // Token-byte invariant preserved: the value is returned into a
  // process-local string, never logged, and the shell invocation reads it
  // from Keychain via -w (stdout of a child), never echoed by this process.

  // Source 1: environment.
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    return String(process.env.OP_SERVICE_ACCOUNT_TOKEN);
  }

  // Source 2: macOS Keychain (headless, no signin).
  try {
    const cached = String(
      runCmd(
        'security find-generic-password -a Mythos -s smos-sam-automation-token -w',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    ).trim();
    if (cached) return cached;
  } catch (_) {
    // Keychain item missing or unreadable; fall through to 1Password lookup.
  }

  // Source 3: personal-signin fallback (unchanged).
  let raw;
  try {
    raw = String(
      runCmd(
        `op item get "${SAM_TOKEN_ITEM_TITLE}" --vault "${SAM_TOKEN_OPERATOR_VAULT}" --reveal --fields credential --format json`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      )
    );
  } catch (e) {
    throw err(
      'MEMORY_VAULT_TOKEN_UNREACHABLE',
      `op item get "${SAM_TOKEN_ITEM_TITLE}" failed: operator op CLI not signed in, item missing, or Employee vault unreachable.`,
      { stderr: e && e.stderr ? String(e.stderr) : '' }
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw err('MEMORY_VAULT_TOKEN_PARSE_FAIL', 'op returned non-JSON for service-account token lookup.');
  }
  const value = parsed && parsed.value ? String(parsed.value) : '';
  if (!value) {
    throw err('MEMORY_VAULT_TOKEN_EMPTY', 'service-account token came back empty.');
  }
  return value;
}

function readFromVault(name, options = {}) {
  const platform = options.platform || process.platform;
  if (!platformSupportsVault(platform)) {
    throw err(
      'MEMORY_VAULT_UNREACHABLE',
      `Platform ${platform} cannot read 1Password directly. Set SMOS_MEMORY_OVERRIDE_DIR or run on darwin with op CLI.`,
      { platform }
    );
  }
  const runCmd = options.runCmd || execSync;
  if (!opAvailable(runCmd)) {
    throw err('MEMORY_VAULT_OP_MISSING', 'op CLI not found on PATH.');
  }
  let token = fetchSamServiceAccountToken(runCmd);
  try {
    // op item list with sm_os_memory_file filter — we look up by filename.
    // Tags aren't enough because multiple memories can share a tag; the
    // sm_os_memory_file field is the unique key (set by remember-via-vault.sh).
    const listRaw = String(
      runCmd(`op item list --vault "${SAM_MEMORIES_VAULT}" --format=json`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { OP_SERVICE_ACCOUNT_TOKEN: token })
      })
    );
    const items = JSON.parse(listRaw);
    if (!Array.isArray(items)) {
      throw err('MEMORY_VAULT_LIST_PARSE_FAIL', 'op vault list returned non-array.');
    }
    let matchedId = null;
    for (const candidate of items) {
      const cidRaw = String(
        runCmd(`op item get "${candidate.id}" --vault "${SAM_MEMORIES_VAULT}" --format=json`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: Object.assign({}, process.env, { OP_SERVICE_ACCOUNT_TOKEN: token })
        })
      );
      const item = JSON.parse(cidRaw);
      const fileField = (item.fields || []).find(
        (f) => f.label === 'sm_os_memory_file' && f.value === name
      );
      if (fileField) {
        const notesField = (item.fields || []).find((f) => f.label === 'notesPlain');
        if (!notesField) {
          throw err('MEMORY_VAULT_ITEM_MISSING_NOTES', `Item for ${name} has no notesPlain field.`);
        }
        return {
          source: 'vault',
          source_path: `op://Sam%27s%20Memories/${item.id}`,
          body: notesField.value || ''
        };
      }
      matchedId = matchedId; // satisfy lint, no-op
    }
    return null;
  } finally {
    // Zero the token before this function exits, regardless of success/error.
    // Strings are immutable in JS so we can't shred bytes — we drop the
    // reference so the next gc pass collects it. Caller never sees it.
    token = '';
  }
}

function listFromVault(options = {}) {
  const platform = options.platform || process.platform;
  if (!platformSupportsVault(platform)) {
    throw err('MEMORY_VAULT_UNREACHABLE', `Platform ${platform} cannot read 1Password directly.`);
  }
  const runCmd = options.runCmd || execSync;
  if (!opAvailable(runCmd)) {
    throw err('MEMORY_VAULT_OP_MISSING', 'op CLI not found on PATH.');
  }
  let token = fetchSamServiceAccountToken(runCmd);
  try {
    const listRaw = String(
      runCmd(`op item list --vault "${SAM_MEMORIES_VAULT}" --format=json`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { OP_SERVICE_ACCOUNT_TOKEN: token })
      })
    );
    const items = JSON.parse(listRaw);
    return {
      source: 'vault',
      source_path: `op://Sam%27s%20Memories/`,
      entries: items.map((i) => i.title || i.id)
    };
  } finally {
    token = '';
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * read(name, options)
 * Resolves a memory entry by name, trying override → shadow → vault in order.
 * @param {string} name  Memory filename, e.g. "MEMORY.md" or "cowork_grounding.md"
 * @param {Object} [options]
 * @param {string[]} [options.sources]  Restrict source list (subset of ['override','shadow','vault'])
 * @returns {{ source: string, source_path: string, body: string }}
 * @throws  MemoryVaultError with code MEMORY_NOT_FOUND if no source has it.
 */
function read(name, options = {}) {
  const sources = Array.isArray(options.sources) && options.sources.length > 0
    ? options.sources
    : ['override', 'shadow', 'vault'];
  const tried = [];
  for (const src of sources) {
    let result = null;
    try {
      if (src === 'override') result = readFromOverride(name, options.env || process.env);
      else if (src === 'shadow') result = readFromShadow(name);
      else if (src === 'vault') result = readFromVault(name, options);
    } catch (e) {
      tried.push({ source: src, error: e.code || 'UNKNOWN', message: e.message });
      continue;
    }
    if (result) return result;
    tried.push({ source: src, error: 'NOT_FOUND' });
  }
  throw err('MEMORY_NOT_FOUND', `Memory "${name}" not found in any source.`, { tried });
}

/**
 * list(options) — same source priority. Returns the FIRST source that yields
 * a non-null entries list, NOT the union. (Override / shadow / vault are
 * meant to be in-sync; reading the union would hide drift.)
 */
function list(options = {}) {
  const sources = Array.isArray(options.sources) && options.sources.length > 0
    ? options.sources
    : ['override', 'shadow', 'vault'];
  for (const src of sources) {
    let result = null;
    try {
      if (src === 'override') result = listOverride(options.env || process.env);
      else if (src === 'shadow') result = listShadow();
      else if (src === 'vault') result = listFromVault(options);
    } catch (_) {
      continue;
    }
    if (result) return result;
  }
  throw err('MEMORY_NOT_FOUND', 'No memory source produced an entry list.');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function help() {
  console.log(`
memory-vault — read Mythos orchestrator memory from override / shadow / 1Password.

Usage:
  node tools/memory/memory-vault.js read <memory-filename> [--source override|shadow|vault]
  node tools/memory/memory-vault.js list                     [--source override|shadow|vault]
  node tools/memory/memory-vault.js sources                  # diagnostic — show what's available

Source priority (when --source not specified):
  1. SMOS_MEMORY_OVERRIDE_DIR (env-pointed directory of plaintext .md files)
  2. ~/.claude/projects/-Users-admin-Documents-GitHub-mythos/memory/ (operator-readable shadow)
  3. 1Password vault "Sam's Memories" via op CLI (darwin only)

Writes are NOT supported here — use bash tools/memory/remember-via-vault.sh for vault writes.
`.trim());
}

function cli(argv) {
  const args = parseArgs(argv.slice(2));
  const sub = args._[0];
  const sources = typeof args.source === 'string' ? [args.source] : undefined;

  if (!sub || args.help) { help(); process.exit(sub ? 0 : 1); }

  try {
    if (sub === 'read') {
      const name = args._[1];
      if (!name) { console.error('read: <memory-filename> required'); process.exit(2); }
      const result = read(name, { sources });
      if (args.json) console.log(JSON.stringify({ source: result.source, source_path: result.source_path, length: result.body.length }, null, 2));
      else process.stdout.write(result.body);
      return;
    }
    if (sub === 'list') {
      const result = list({ sources });
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else { console.log(`source: ${result.source} (${result.source_path})`); for (const e of result.entries) console.log(`  ${e}`); }
      return;
    }
    if (sub === 'sources') {
      const report = {
        platform: process.platform,
        override: { configured: Boolean(process.env.SMOS_MEMORY_OVERRIDE_DIR), dir: process.env.SMOS_MEMORY_OVERRIDE_DIR || null, exists: process.env.SMOS_MEMORY_OVERRIDE_DIR ? fs.existsSync(process.env.SMOS_MEMORY_OVERRIDE_DIR) : false },
        shadow: { dir: SHADOW_DIR, exists: fs.existsSync(SHADOW_DIR) },
        vault: { reachable: platformSupportsVault() && opAvailable(), vault_name: SAM_MEMORIES_VAULT, token_item: SAM_TOKEN_ITEM_TITLE }
      };
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.error(`unknown subcommand: ${sub}`);
    help();
    process.exit(1);
  } catch (e) {
    if (e && e.name === 'MemoryVaultError') {
      console.error(`ERROR ${e.code}: ${e.message}`);
      if (args.json && e.details) console.error(JSON.stringify(e.details, null, 2));
      process.exit(3);
    }
    throw e;
  }
}

if (require.main === module) cli(process.argv);

module.exports = {
  read,
  list,
  readFromOverride,
  readFromShadow,
  readFromVault,
  listOverride,
  listShadow,
  listFromVault,
  fetchSamServiceAccountToken,
  platformSupportsVault,
  opAvailable,
  MemoryVaultError,
  SAM_MEMORIES_VAULT,
  SAM_TOKEN_ITEM_TITLE,
  SAM_TOKEN_OPERATOR_VAULT,
  SHADOW_DIR
};
