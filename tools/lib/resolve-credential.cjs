'use strict';

/**
 * resolve-credential.cjs — the canonical bring-your-own-credential resolver.
 *
 * Every credential-needing tool in this tree resolves secrets the same way, in
 * the same order, so that no secret ever needs to transit an agent/LLM context:
 * each process reads its own secrets on-device at runtime.
 *
 * Resolution order (first hit wins):
 *   1. Environment variable          — CI / hosted runners / explicit export
 *   2. macOS Keychain                — headless, non-interactive contexts
 *        security find-generic-password -s <service> -a <account> -w
 *      Tried BEFORE 1Password so a hook running where `op` is not signed in
 *      resolves cleanly without ever invoking `op` (which would otherwise emit
 *      "could not read secret op://..." noise to stderr).
 *   3. 1Password                     — interactive shells with `op` available,
 *      via OP_SERVICE_ACCOUNT_TOKEN or a local Keychain-stored service-account
 *      token, then `op read op://<vault>/<item>/<field>`.
 *   4. Env file fallback             — repo-root .env.local / .env, then
 *      ~/.mythos/.env. Sandbox-friendly; gitignored by convention.
 *
 * Seed the headless Keychain source with:
 *   tools/boot/keychain-store.sh <service> <account>
 *
 * Distilled from tools/dart-integration/lib/dart-api.js (the 4-source chain,
 * the CredentialError taxonomy, QUIET_STDIO, presence-hint classification) and
 * refined with google-drive/config.js's per-field env-overridable
 * {envVar, keychainService, keychainAccount, opVault, opItem, opField} shape,
 * generalized so any tool can pass its own field config instead of hardcoding
 * one secret's names.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// Capture child stderr (never inherit) so a missing `op`/Keychain item does not
// leak "could not read secret op://..." lines to the console/log.
const QUIET_STDIO = Object.freeze(['ignore', 'pipe', 'pipe']);

const OP_AUTOMATION_TOKEN_SERVICE = 'mythos-1p-automation-token';
const OP_AUTOMATION_TOKEN_ACCOUNT = 'mythos';

function repoRoot() {
  // tools/lib/resolve-credential.cjs -> repo root is two levels up.
  return path.resolve(__dirname, '..', '..');
}

function defaultEnvFileCandidates() {
  return [
    path.join(repoRoot(), '.env.local'),
    path.join(repoRoot(), '.env'),
    path.join(os.homedir(), '.mythos', '.env'),
  ];
}

class CredentialError extends Error {
  constructor(field, code, message, details = {}) {
    super(message);
    this.name = 'CredentialError';
    this.field = field;
    this.code = code;
    this.details = details;
  }
}

function createCredentialError(field, code, message, details = {}) {
  return new CredentialError(field, code, message, details);
}

// ─── macOS Keychain ─────────────────────────────────────────────────────────

function buildSecurityReadCommand(service, account, mode = 'w') {
  return `security find-generic-password -s "${service}" -a "${account}" -${mode}`;
}

function sanitizeExecError(error) {
  return {
    status: typeof error.status === 'number' ? error.status : null,
    stdout: String(error && error.stdout ? error.stdout : '').trim(),
    stderr: String(error && error.stderr ? error.stderr : '').trim(),
  };
}

function classifyKeychainReadFailure(field, service, account, error, options = {}) {
  const details = sanitizeExecError(error || {});
  const combined = [details.stdout, details.stderr].filter(Boolean).join('\n');
  const hint = String(options.presenceHint || 'unknown').trim().toLowerCase() || 'unknown';
  const itemNotFound = /could not be found in the keychain/i.test(combined);
  const interactionBlocked = /interaction is not allowed|user interaction is not allowed|auth failed|permission denied|not permitted/i.test(combined);
  const verifyCommand = `security find-generic-password -s "${service}" -a "${account}"`;

  if (hint === 'absent' && itemNotFound) {
    return createCredentialError(
      field,
      `${field}_MISSING`,
      `${field} is not present in macOS Keychain for service=${service} account=${account}.`,
      { ...details, presenceHint: hint }
    );
  }

  if (interactionBlocked || itemNotFound) {
    return createCredentialError(
      field,
      `${field}_UNREADABLE`,
      `Unable to read ${field} from macOS Keychain from this runtime context. This does not prove the item is absent. `
        + `Verify presence directly with \`${verifyCommand}\` before treating it as missing.`,
      { ...details, presenceHint: hint }
    );
  }

  return createCredentialError(
    field,
    `${field}_UNREADABLE`,
    `Unable to read ${field} from macOS Keychain from this runtime context. Verify presence directly with `
      + `\`${verifyCommand}\` and treat this as unreadable until proven otherwise.`,
    { ...details, presenceHint: hint }
  );
}

/**
 * Soft Keychain read: returns { value, error } and never throws, so the
 * resolver chain can fall through to the next source on a miss. stderr is
 * captured (QUIET_STDIO) so a missing item never leaks console noise.
 */
function tryReadFromKeychain(field, service, account, runSecurity = execSync) {
  if (!service || !account) return { value: null, error: null };
  const attempts = ['w', 'g'];
  let lastError = null;

  for (const mode of attempts) {
    try {
      const output = String(
        runSecurity(buildSecurityReadCommand(service, account, mode), { encoding: 'utf8', stdio: QUIET_STDIO })
      );
      if (mode === 'g') {
        const match = output.match(/password:\s*"([^"]+)"/);
        if (match && match[1]) return { value: match[1].trim(), error: null };
      } else if (output.trim()) {
        return { value: output.trim(), error: null };
      }
    } catch (error) {
      lastError = error;
    }
  }

  return { value: null, error: classifyKeychainReadFailure(field, service, account, lastError) };
}

// ─── 1Password ──────────────────────────────────────────────────────────────

function buildAutomationTokenReadCommand() {
  return `security find-generic-password -s "${OP_AUTOMATION_TOKEN_SERVICE}" -a "${OP_AUTOMATION_TOKEN_ACCOUNT}" -w`;
}

function buildOpReadCommand(vault, item, field) {
  return `op read ${JSON.stringify(`op://${vault}/${item}/${field}`)}`;
}

function resolveServiceAccountToken(options = {}) {
  const env = options.env || process.env;
  const runCommand = options.runCommand || execSync;
  const fromEnv = String(env.OP_SERVICE_ACCOUNT_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    return String(
      runCommand(buildAutomationTokenReadCommand(), { encoding: 'utf8', stdio: QUIET_STDIO })
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Try 1Password for one field. `opField` may be a string or an array of
 * candidate field names to try in order (some items store a secret under
 * more than one plausible field label — e.g. "credential" as an alias).
 */
function tryReadFromOnePassword(fieldConfig, options = {}) {
  const { opVault, opItem, opField } = fieldConfig;
  if (!opVault || !opItem || !opField) return null;
  const runCommand = options.runCommand || execSync;
  const env = options.env || process.env;
  const serviceAccountToken = resolveServiceAccountToken(options);
  if (!serviceAccountToken) return null;

  const candidateFields = Array.isArray(opField) ? opField : [opField];
  for (const field of candidateFields) {
    try {
      const output = String(
        runCommand(buildOpReadCommand(opVault, opItem, field), {
          encoding: 'utf8',
          stdio: QUIET_STDIO,
          env: {
            ...process.env,
            ...env,
            OP_SERVICE_ACCOUNT_TOKEN: serviceAccountToken,
          },
        })
      ).trim();
      if (output) return output;
    } catch {
      // try the next candidate field
    }
  }
  return null;
}

// ─── Env file fallback ──────────────────────────────────────────────────────

/**
 * Read `envKey=value` out of the first matching env-file candidate. Handles
 * quoted values and `#` comments; does not evaluate shell expressions.
 */
function readFromEnvFile(envKey, options = {}) {
  const files = options.envFiles || defaultEnvFileCandidates();
  const exists = options.existsSync || fs.existsSync;
  const read = options.readFileSync || fs.readFileSync;

  for (const file of files) {
    let text;
    try {
      if (!exists(file)) continue;
      text = String(read(file, 'utf8'));
    } catch {
      continue;
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      if (line.slice(0, idx).trim() !== envKey) continue;
      let value = line.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  return null;
}

// ─── Public resolver ────────────────────────────────────────────────────────

/**
 * Resolve one credential field through the 4-source chain.
 *
 * @param {string} field - Logical field name, used to build error codes
 *   (`<FIELD>_MISSING` / `<FIELD>_UNREADABLE`) and default env var name.
 * @param {object} fieldConfig
 * @param {string} [fieldConfig.envVar=field] - Environment variable name.
 * @param {string} [fieldConfig.keychainService] - macOS Keychain `-s` value.
 * @param {string} [fieldConfig.keychainAccount] - macOS Keychain `-a` value.
 * @param {string} [fieldConfig.opVault] - 1Password vault name.
 * @param {string} [fieldConfig.opItem] - 1Password item title.
 * @param {string|string[]} [fieldConfig.opField] - 1Password field label(s) to try.
 * @param {string} [fieldConfig.envFileKey=envVar] - Key to look for in an env file.
 * @param {object} [options]
 * @param {boolean} [options.required=true] - Throw CredentialError if unresolved.
 * @param {object} [options.env=process.env]
 * @param {Function} [options.runSecurity], [options.runCommand]
 * @param {string[]} [options.envFiles]
 * @returns {{ value: string, source: string } | null}
 */
function resolveField(field, fieldConfig = {}, options = {}) {
  const env = options.env || process.env;
  const envVar = fieldConfig.envVar || field;
  const required = options.required !== false;

  const envValue = Object.prototype.hasOwnProperty.call(env, envVar)
    ? String(env[envVar] || '').trim()
    : '';
  if (envValue) {
    return { value: envValue, source: 'environment' };
  }

  const keychain = tryReadFromKeychain(
    field,
    fieldConfig.keychainService,
    fieldConfig.keychainAccount,
    options.runSecurity
  );
  if (keychain.value) {
    return { value: keychain.value, source: 'macos-keychain' };
  }

  const opValue = tryReadFromOnePassword(fieldConfig, options);
  if (opValue) {
    return { value: opValue, source: 'onepassword' };
  }

  const envFileValue = readFromEnvFile(fieldConfig.envFileKey || envVar, options);
  if (envFileValue) {
    return { value: envFileValue, source: 'env-file' };
  }

  if (!required) return null;

  const keychainCode = keychain.error && keychain.error.code === `${field}_MISSING`
    ? `${field}_MISSING`
    : `${field}_UNRESOLVED`;
  const seedHint = fieldConfig.keychainService && fieldConfig.keychainAccount
    ? ` Seed the headless Keychain source via \`tools/boot/keychain-store.sh ${fieldConfig.keychainService} ${fieldConfig.keychainAccount}\`.`
    : '';
  throw createCredentialError(
    field,
    keychainCode,
    `${field} not resolvable in this context — tried env (${envVar}), macOS Keychain, 1Password, `
      + `and env-file fallback, and all missed.${seedHint}`,
    { keychain: keychain.error ? keychain.error.details || {} : {} }
  );
}

/**
 * Resolve every field declared in a creds.config.json-shaped object.
 *
 * @param {{fields: Object<string, object>}|Object<string, object>} config -
 *   Either `{ fields: { <field>: fieldConfig, ... } }` (the on-disk
 *   creds.config.json shape) or a bare `{ <field>: fieldConfig, ... }` map.
 * @param {object} [options] - Same as resolveField; also accepts
 *   `options.optional` (array of field names that are not required).
 * @returns {Object<string, string>} Map of field name to resolved value.
 *   Fields that were optional and unresolved are omitted from the result.
 */
function resolveCredentials(config, options = {}) {
  const fields = config && config.fields ? config.fields : config || {};
  const optional = new Set(options.optional || []);
  const result = {};
  for (const [field, fieldConfig] of Object.entries(fields)) {
    const resolved = resolveField(field, fieldConfig, {
      ...options,
      required: !optional.has(field) && fieldConfig.required !== false
    });
    if (resolved) result[field] = resolved.value;
  }
  return result;
}

/**
 * Load a creds.config.json file from disk and resolve every field it declares.
 * @param {string} configPath - Path to the tool's creds.config.json.
 * @param {object} [options] - Same as resolveCredentials.
 * @returns {Object<string, string>}
 */
function resolveCredentialsFromFile(configPath, options = {}) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  return resolveCredentials(config, options);
}

module.exports = {
  CredentialError,
  resolveField,
  resolveCredentials,
  resolveCredentialsFromFile,
  defaultEnvFileCandidates,
  QUIET_STDIO
};
