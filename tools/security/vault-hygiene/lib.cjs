'use strict';
//
// tools/security/vault-hygiene/lib.cjs
//
// Shared, cwd-independent helpers for the vault-hygiene tools.
//
// ┌───────────────────────────────────────────────────────────────────────┐
// │ ABSOLUTE SAFETY CONTRACT                                               │
// │ This module NEVER reads, prints, logs, or returns a secret VALUE.      │
// │ It operates on 1Password METADATA ONLY: item titles, ids, vault names, │
// │ category, and existence. The `op` allow-list below HARD-REFUSES any    │
// │ invocation that could read a field/credential value (`op read`,        │
// │ `--fields`, `--field`, `--reveal`, `--otp`).                           │
// └───────────────────────────────────────────────────────────────────────┘
//
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DESTINATION_VAULT = 'Automation';

// ─── op allow-list (metadata only) ──────────────────────────────────────────
// Only these subcommand shapes may ever be dispatched to the real `op` binary.
const ALLOWED_OP_PREFIXES = [
  ['item', 'get'],   // metadata read: MUST be used with --format json only, no field selectors
  ['item', 'list'],  // metadata list
  ['item', 'move'],  // relocate item between vaults (no value exposure)
  ['vault', 'list'], // enumerate visible vaults
  ['vault', 'get']   // vault metadata
];

// Tokens that would (or could) surface a secret VALUE — hard-forbidden.
const FORBIDDEN_OP_TOKENS = ['read', '--fields', '--field', '--reveal', '--otp', 'inject', 'run'];

/**
 * Validate that an `op` argv is metadata-only. Throws on any value-read path.
 * @param {string[]} args argv passed after the `op` binary
 */
function assertSafeOpArgs(args) {
  if (!Array.isArray(args) || args.length < 2) {
    throw new Error(`vault-hygiene: refused unsafe/empty op invocation: ${JSON.stringify(args)}`);
  }
  for (const tok of args) {
    const t = String(tok).toLowerCase();
    if (FORBIDDEN_OP_TOKENS.includes(t)) {
      throw new Error(`vault-hygiene: SECRET-VALUE READ REFUSED — forbidden op token "${tok}" in ${JSON.stringify(args)}`);
    }
  }
  const prefixOk = ALLOWED_OP_PREFIXES.some(
    (p) => p[0] === args[0] && p[1] === args[1]
  );
  if (!prefixOk) {
    throw new Error(`vault-hygiene: refused op subcommand "${args[0]} ${args[1]}" — not on the metadata allow-list`);
  }
  // Belt-and-suspenders: `item get` must be JSON metadata, never a field pull.
  if (args[0] === 'item' && args[1] === 'get' && !args.includes('--format')) {
    throw new Error('vault-hygiene: `op item get` must include --format json (metadata only)');
  }
}

/**
 * Build the real `op` runner. Returns a function(args) -> stdout string.
 * Every call is validated by assertSafeOpArgs first. A timeout keeps the tool
 * from hanging forever when `op` blocks on an interactive auth prompt (e.g. an
 * in-session shell with no biometric/service-account) — it fails fast instead.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=12000]
 * @returns {(args: string[]) => string}
 */
function makeRealOpRunner(opts = {}) {
  const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 12000;
  return function realOpRunner(args) {
    assertSafeOpArgs(args);
    return execFileSync('op', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      maxBuffer: 8 * 1024 * 1024
    });
  };
}

/**
 * Preflight: is `op` usable (authenticated / reachable) right now?
 * Runs a single metadata-only `vault list`. Returns false on any error
 * (auth prompt/timeout/not-signed-in) so checks can WARN rather than misreport.
 * @param {(args:string[])=>string} opRunner
 */
function probeOpAvailable(opRunner) {
  try {
    opRunner(['vault', 'list', '--format', 'json']);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Load and lightly validate the manifest.
 * @param {string} manifestPath
 */
function loadManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const m = JSON.parse(raw);
  for (const key of ['class1_move', 'class1_already_automation', 'class2_anchors_never_move']) {
    if (!Array.isArray(m[key])) {
      throw new Error(`vault-hygiene: manifest missing required array "${key}"`);
    }
  }
  return m;
}

/** Set of class-2 anchor titles (the never-move hard exclusion). */
function anchorTitleSet(manifest) {
  return new Set(manifest.class2_anchors_never_move.map((a) => a.title));
}

/**
 * METADATA-ONLY existence probe. Returns { exists, meta } where meta holds
 * ONLY id/title/vault/category — never any field value.
 * A non-zero `op` exit (item not found) is treated as "does not exist".
 * @param {(args:string[])=>string} opRunner
 * @param {string} title
 * @param {string} vault
 */
function itemExistsInVault(opRunner, title, vault) {
  let out;
  try {
    out = opRunner(['item', 'get', title, '--vault', vault, '--format', 'json']);
  } catch (_err) {
    return { exists: false, meta: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (_err) {
    // Unparseable metadata — treat as not-verifiable rather than leaking anything.
    return { exists: false, meta: null };
  }
  // Read ONLY metadata fields. Deliberately ignore parsed.fields / .sections.
  const meta = {
    id: parsed.id || null,
    title: parsed.title || null,
    vault: (parsed.vault && (parsed.vault.name || parsed.vault.id)) || null,
    category: parsed.category || null
  };
  return { exists: true, meta };
}

module.exports = {
  DESTINATION_VAULT,
  ALLOWED_OP_PREFIXES,
  FORBIDDEN_OP_TOKENS,
  assertSafeOpArgs,
  makeRealOpRunner,
  probeOpAvailable,
  loadManifest,
  anchorTitleSet,
  itemExistsInVault,
  _resolvePath: (p) => path.resolve(p)
};
