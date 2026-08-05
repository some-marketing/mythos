#!/usr/bin/env node
'use strict';

/**
 * resolve-secret.cjs — the single canonical path every Mythos tool uses to get
 * a secret, built to make UNATTENDED runs possible.
 *
 * THE PROBLEM THIS KILLS AS A CLASS
 * ---------------------------------
 * A bare `op read` / `op item get` with no service-account token falls back to
 * 1Password *desktop* auth, which raises a macOS dialog. In an unattended
 * overnight run nobody is there to click it, so the run stalls forever. Dozens
 * of call sites each reimplemented their own resolution order, and several put
 * `op` FIRST — so the prompt fired even when the value was already sitting in
 * the Keychain.
 *
 * The fix is not "stop using op". `op` is fine when it cannot stop to ask a
 * human. So: this resolver NEVER invokes `op` without a service-account token
 * resolved from the Keychain first. No token means no `op` call at all (unless
 * the operator explicitly opts in via MYTHOS_ALLOW_OP_DESKTOP=1).
 *
 * RESOLUTION ORDER (first hit wins)
 * ---------------------------------
 *   1. env           process.env[name]
 *   2. keychain      security find-generic-password -a mythos -s <name> -w
 *   3. legacy        the same, for each caller-supplied legacy service name
 *   4. op            op read <opRef>, ONLY with a Keychain-sourced
 *                    OP_SERVICE_ACCOUNT_TOKEN (headless, never prompts)
 *   5. fail          a clear error naming exactly how to store the secret
 *
 * SAFETY INVARIANT (mirrors tools/memory/remember-via-vault.sh)
 * ------------------------------------------------------------
 * Credential VALUES never leave this module except as the function's return
 * value to the calling process. They are never logged, never echoed, never put
 * in argv, and never included in an error message. The stderr diagnostic names
 * the TIER that resolved and the value's LENGTH — never the value.
 *
 * No shell is used anywhere: every subprocess goes through execFileSync with an
 * argv array, so secrets cannot leak via shell tracing/history and no shell
 * metacharacter in a secret can ever be interpreted.
 *
 * USAGE (as a module)
 *   const { resolve } = require('<repo>/tools/credentials/resolve-secret.cjs');
 *   const key = resolve('OPENROUTER_API_KEY', {
 *     opRef: 'op://Automation/Open Router API/credential',
 *     legacyServices: ['openrouter-api-key'],
 *   });
 *
 * USAGE (as a CLI — prints the VALUE on stdout, diagnostic on stderr)
 *   node tools/credentials/resolve-secret.cjs OPENROUTER_API_KEY \
 *     --op-ref 'op://Automation/Open Router API/credential' \
 *     --legacy openrouter-api-key
 *   node tools/credentials/resolve-secret.cjs OPENROUTER_API_KEY --tier-only
 */

const { execFileSync } = require('child_process');

// Every subprocess: stdin ignored (so nothing can block on input), stdout and
// stderr piped (so a miss never leaks noise to the console).
const QUIET_STDIO = Object.freeze(['ignore', 'pipe', 'pipe']);

// Hard timeouts everywhere. An unattended run must never wait forever on a CLI.
const KEYCHAIN_TIMEOUT_MS = 5000;
const OP_TIMEOUT_MS = Number(process.env.MYTHOS_OP_TIMEOUT_MS || 15000);

const DEFAULT_KEYCHAIN_ACCOUNT = 'mythos';

/**
 * 1Password service-account token locations, probed in order.
 * Verified present on this host 2026-08-05 (presence only, values never read):
 *   smos-1p-automation-token      -> account sm_os
 *   smos-mythos-automation-token  -> account Mythos
 *   smos-sam-automation-token     -> account sm_os
 *   mythos-1p-automation-token    -> account mythos
 * Several call sites hardcoded the WRONG account for these items (e.g.
 * `-a Mythos -s smos-sam-automation-token`, which is stored under sm_os). The
 * lookup missed, the code fell through to bare `op`, and the operator got a
 * desktop prompt. Probing the pairs — and finally a service-only lookup —
 * makes that class of typo non-fatal.
 */
const OP_TOKEN_CANDIDATES = Object.freeze([
  { service: 'smos-1p-automation-token', account: 'sm_os' },
  { service: 'smos-mythos-automation-token', account: 'Mythos' },
  { service: 'smos-sam-automation-token', account: 'sm_os' },
  { service: 'mythos-1p-automation-token', account: 'mythos' },
]);

const OP_TOKEN_SERVICES = Object.freeze(
  OP_TOKEN_CANDIDATES.map((c) => c.service)
);

// Accounts to try for any given token service before falling back to a
// service-only lookup.
const OP_TOKEN_ACCOUNTS = Object.freeze(['sm_os', 'Mythos', 'mythos', 'sam']);

class SecretResolutionError extends Error {
  constructor(name, message, details = {}) {
    super(message);
    this.name = 'SecretResolutionError';
    this.secretName = name;
    this.details = details;
  }
}

// ─── diagnostics (tier + length only — never a value) ───────────────────────

function diag(name, message) {
  if (process.env.MYTHOS_RESOLVE_SECRET_QUIET === '1') return;
  process.stderr.write(`[resolve-secret] ${name}: ${message}\n`);
}

// ─── tier 2/3: macOS Keychain ───────────────────────────────────────────────

/**
 * Read one Keychain generic-password. Returns the value or null; never throws.
 * `-w` prints only the password to stdout of the child process, which we
 * capture into a process-local string.
 */
function keychainRead(service, account) {
  if (!service) return null;
  const args = ['find-generic-password'];
  if (account) args.push('-a', account);
  args.push('-s', service, '-w');
  try {
    const out = String(
      execFileSync('security', args, {
        encoding: 'utf8',
        stdio: QUIET_STDIO,
        timeout: KEYCHAIN_TIMEOUT_MS,
      })
    ).trim();
    return out || null;
  } catch (e) {
    return null;
  }
}

/**
 * Presence check that never reads the value (no -w). Used by verification and
 * by the ACL-readability probe.
 */
function keychainPresent(service, account) {
  if (!service) return false;
  const args = ['find-generic-password'];
  if (account) args.push('-a', account);
  args.push('-s', service);
  try {
    execFileSync('security', args, {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      timeout: KEYCHAIN_TIMEOUT_MS,
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ─── tier 4: 1Password, headless only ───────────────────────────────────────

/**
 * Find a 1Password service-account token in the Keychain.
 * Returns { token, service, account } or null. NEVER logs the token.
 */
function resolveServiceAccountToken(options = {}) {
  const env = options.env || process.env;
  const fromEnv = String(env.OP_SERVICE_ACCOUNT_TOKEN || '').trim();
  if (fromEnv) return { token: fromEnv, service: '(env)', account: '(env)' };

  // Exact known-good pairs first — one Keychain hit, no wasted probing.
  for (const cand of OP_TOKEN_CANDIDATES) {
    const v = keychainRead(cand.service, cand.account);
    if (v) return { token: v, service: cand.service, account: cand.account };
  }
  // Then the cross-product, in case an item was re-created under a different
  // account than the one recorded above.
  for (const service of OP_TOKEN_SERVICES) {
    for (const account of OP_TOKEN_ACCOUNTS) {
      const v = keychainRead(service, account);
      if (v) return { token: v, service, account };
    }
    const anyAccount = keychainRead(service, null);
    if (anyAccount) return { token: anyAccount, service, account: '(any)' };
  }
  return null;
}

/**
 * Read a secret from 1Password. Returns { value, tokenService } or null.
 *
 * CRITICAL: this refuses to run `op` at all without a service-account token.
 * Bare `op` is precisely what triggers the desktop-auth dialog that hangs an
 * unattended run. The operator can opt into the interactive path explicitly
 * with MYTHOS_ALLOW_OP_DESKTOP=1 when a human is present.
 */
function opRead(opRef, options = {}) {
  if (!opRef) return null;
  const env = options.env || process.env;
  const sa = resolveServiceAccountToken(options);
  const allowDesktop = String(env.MYTHOS_ALLOW_OP_DESKTOP || '') === '1';

  if (!sa && !allowDesktop) {
    return { blocked: 'no-service-account-token' };
  }

  const childEnv = {
    ...process.env,
    // Suppress the desktop-app handoff even if a token is somehow rejected.
    OP_BIOMETRIC_UNLOCK_ENABLED: 'false',
  };
  if (sa) childEnv.OP_SERVICE_ACCOUNT_TOKEN = sa.token;

  try {
    const out = String(
      execFileSync('op', ['read', opRef], {
        encoding: 'utf8',
        stdio: QUIET_STDIO,
        timeout: OP_TIMEOUT_MS,
        env: childEnv,
      })
    ).trim();
    if (!out) return null;
    return { value: out, tokenService: sa ? sa.service : '(desktop)' };
  } catch (e) {
    return null;
  }
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Resolve one secret through the five tiers.
 *
 * @param {string} name Canonical env-var-shaped name, e.g. OPENROUTER_API_KEY.
 *   Also the Keychain service name under `keychainAccount`.
 * @param {object} [opts]
 * @param {string}   [opts.opRef]           op:// reference for tier 4.
 * @param {string}   [opts.keychainAccount='mythos']
 * @param {string[]} [opts.legacyServices=[]] Legacy Keychain service names.
 * @param {boolean}  [opts.required=true]   Return null instead of throwing.
 * @param {string}   [opts.envVar=name]     Override the env var consulted.
 * @returns {string|null} The secret value.
 * @throws {SecretResolutionError} when required and unresolved.
 */
function resolve(name, opts = {}) {
  const detail = resolveWithTier(name, opts);
  return detail ? detail.value : null;
}

/**
 * Same as resolve(), but returns { value, tier, source } so callers and the
 * verification harness can assert WHICH tier fired without seeing the value.
 */
function resolveWithTier(name, opts = {}) {
  if (!name || typeof name !== 'string') {
    throw new SecretResolutionError(String(name), 'resolve() requires a secret name.');
  }
  const {
    opRef = null,
    keychainAccount = DEFAULT_KEYCHAIN_ACCOUNT,
    legacyServices = [],
    required = true,
    envVar = name,
  } = opts;
  const env = opts.env || process.env;

  // Tier 1 — environment.
  const fromEnv = String(env[envVar] || '').trim();
  if (fromEnv) {
    diag(name, `resolved via tier 1 (env ${envVar}), ${fromEnv.length} chars`);
    return { value: fromEnv, tier: 'env', source: `env:${envVar}` };
  }

  // Tier 2 — canonical Keychain entry.
  const canonical = keychainRead(name, keychainAccount);
  if (canonical) {
    diag(name, `resolved via tier 2 (keychain ${keychainAccount}/${name}), ${canonical.length} chars`);
    return { value: canonical, tier: 'keychain', source: `keychain:${keychainAccount}/${name}` };
  }

  // Tier 3 — legacy Keychain service names.
  for (const legacy of legacyServices) {
    const v = keychainRead(legacy, keychainAccount) || keychainRead(legacy, null);
    if (v) {
      diag(name, `resolved via tier 3 (legacy keychain ${legacy}), ${v.length} chars`);
      return { value: v, tier: 'keychain-legacy', source: `keychain:${legacy}` };
    }
  }

  // Tier 4 — 1Password, headless only.
  if (opRef) {
    const res = opRead(opRef, opts);
    if (res && res.value) {
      diag(name, `resolved via tier 4 (1Password, token ${res.tokenService}), ${res.value.length} chars`);
      return { value: res.value, tier: 'onepassword', source: `op:${res.tokenService}` };
    }
    if (res && res.blocked === 'no-service-account-token') {
      diag(name, 'tier 4 SKIPPED — no 1Password service-account token in Keychain; refusing to run bare `op` (would raise a desktop prompt and hang an unattended run). Set MYTHOS_ALLOW_OP_DESKTOP=1 to allow it interactively.');
    }
  }

  // Tier 5 — fail with instructions.
  if (!required) {
    diag(name, 'UNRESOLVED (optional) — all tiers missed');
    return null;
  }
  const tried = [
    `env ${envVar}`,
    `keychain ${keychainAccount}/${name}`,
    legacyServices.length ? `legacy keychain [${legacyServices.join(', ')}]` : null,
    opRef ? `1Password ${opRef}` : null,
  ].filter(Boolean);
  throw new SecretResolutionError(
    name,
    `${name} could not be resolved. Tried, in order: ${tried.join('; ')}.\n` +
      `Store it non-interactively with:\n` +
      `  bash tools/boot/keychain-store.sh ${name} ${keychainAccount}\n` +
      `(the script prompts for the value without it entering shell history), or add it to\n` +
      `tools/boot/port-keys-to-keychain.sh and re-run that script to port it from 1Password.`,
    { tried }
  );
}

/** Presence check that never reads a value. */
function isPresent(name, opts = {}) {
  const { keychainAccount = DEFAULT_KEYCHAIN_ACCOUNT, envVar = name } = opts;
  const env = opts.env || process.env;
  if (String(env[envVar] || '').trim()) return true;
  return keychainPresent(name, keychainAccount);
}

module.exports = {
  resolve,
  resolveWithTier,
  isPresent,
  keychainRead,
  keychainPresent,
  resolveServiceAccountToken,
  SecretResolutionError,
  DEFAULT_KEYCHAIN_ACCOUNT,
  OP_TOKEN_CANDIDATES,
};

// ─── CLI ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    process.stderr.write(
      'Usage: resolve-secret.cjs <NAME> [--op-ref <op://...>] [--legacy <svc>]... ' +
        '[--account <acct>] [--tier-only] [--optional]\n' +
        '  Prints the secret VALUE on stdout (use --tier-only to print just the tier).\n' +
        '  The stderr diagnostic always names the tier and length, never the value.\n'
    );
    process.exit(argv.length ? 0 : 2);
  }
  // Emit ONLY the 1Password service-account token, for shell wrappers that
  // then run their own `op read` calls. Exporting this into the wrapper's env
  // is what makes every downstream `op` invocation headless: `op` prefers
  // OP_SERVICE_ACCOUNT_TOKEN over desktop integration, so it can no longer
  // fall back to a macOS auth dialog.
  if (argv[0] === '--op-service-account-token') {
    const sa = resolveServiceAccountToken();
    if (!sa) {
      process.stderr.write(
        '[resolve-secret] no 1Password service-account token found in Keychain. ' +
          'Tried: ' + OP_TOKEN_CANDIDATES.map((c) => c.service + '/' + c.account).join(', ') + '.\n'
      );
      process.exit(1);
    }
    process.stderr.write(
      `[resolve-secret] op service-account token resolved from Keychain ` +
        `(${sa.service}/${sa.account}), ${sa.token.length} chars — op will run headless\n`
    );
    process.stdout.write(sa.token);
    process.exit(0);
  }

  const name = argv[0];
  const opts = { legacyServices: [] };
  let tierOnly = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--op-ref') opts.opRef = argv[++i];
    else if (a === '--legacy') opts.legacyServices.push(argv[++i]);
    else if (a === '--account') opts.keychainAccount = argv[++i];
    else if (a === '--tier-only') tierOnly = true;
    else if (a === '--optional') opts.required = false;
  }
  try {
    const res = resolveWithTier(name, opts);
    if (!res) process.exit(1);
    // --tier-only exists so verification can assert the tier without the value
    // ever crossing a process boundary into a log or transcript.
    process.stdout.write(tierOnly ? `${res.tier}\n` : res.value);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`[resolve-secret] ${e.message}\n`);
    process.exit(1);
  }
}
