'use strict';
// Resolves this tool's Google Drive OAuth credential (client id / client
// secret / refresh token) via the shared 4-source resolver in
// tools/lib/resolve-credential.cjs (env -> macOS Keychain -> 1Password ->
// env-file), declared in creds.config.json.
//
// On top of that shared chain, this tool keeps an additional fast path of
// its own: a local, gitignored .oauth-creds.json cache (or the isolated
// .oauth-creds.<profile>.json equivalent). It is checked first
// (cheaper than shelling out to `security`/`op`) and is what authorize.js
// falls back to writing if 1Password is unreachable at consent time. It is
// not part of the shared resolver contract -- just this tool's own
// convenience lane, kept because Drive credentials get minted interactively
// via authorize.js and re-checking Keychain/1Password on every invocation
// during a working session is unnecessary overhead.
//
// Mint the refresh token once via `node authorize.js` in this directory,
// optionally with `--profile <name>`,
// which writes it into 1Password (see saveToOnePassword) or, if 1Password is
// unreachable, into the local .oauth-creds.json cache.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveCredentials } = require('../lib/resolve-credential.cjs');

const CREDS_FILE = path.join(__dirname, '.oauth-creds.json'); // gitignored, optional local cache
const CREDS_CONFIG_PATH = path.join(__dirname, 'creds.config.json');
const SCOPE = 'https://www.googleapis.com/auth/drive';

// 1Password home for this tool's own credential. The shipped defaults are
// generic placeholders -- override with your own vault/item via env without
// touching creds.config.json.
const OP_VAULT = process.env.GDRIVE_OP_VAULT || 'Automation';
const OP_ITEM = process.env.GDRIVE_OP_ITEM || 'Mythos Google Drive';

function loadCredsConfig() {
  const config = JSON.parse(fs.readFileSync(CREDS_CONFIG_PATH, 'utf8'));
  // Apply the GDRIVE_OP_VAULT / GDRIVE_OP_ITEM override to every field so the
  // whole item can be relocated with two env vars instead of editing JSON.
  for (const fieldConfig of Object.values(config.fields)) {
    fieldConfig.opVault = OP_VAULT;
    fieldConfig.opItem = OP_ITEM;
  }
  return config;
}

function normalizeProfile(profile) {
  if (profile === undefined || profile === null || profile === '' || profile === 'default') return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) {
    throw new Error('Google Drive credential profile must use only letters, digits, hyphens, and underscores');
  }
  return String(profile).toLowerCase();
}

function profileCredsFile(profile) {
  const normalized = normalizeProfile(profile);
  return normalized
    ? path.join(__dirname, `.oauth-creds.${normalized}.json`)
    : CREDS_FILE;
}

function fromLocalFile(profile) {
  try {
    const raw = JSON.parse(fs.readFileSync(profileCredsFile(profile), 'utf8'));
    return {
      clientId: raw.client_id || '',
      clientSecret: raw.client_secret || '',
      refreshToken: raw.refresh_token || ''
    };
  } catch {
    return {};
  }
}

function profileCredsConfig(profile) {
  const normalized = normalizeProfile(profile);
  const config = loadCredsConfig();
  if (!normalized) return config;
  const envPrefix = `GDRIVE_PROFILE_${normalized.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const opItem = process.env[`${envPrefix}_OP_ITEM`] || `Mythos Google Drive (${normalized})`;
  const keychainService = `mythos-google-drive-${normalized}`;
  for (const [field, fieldConfig] of Object.entries(config.fields)) {
    const suffix = field.replace(/^GOOGLE_OAUTH_/, '');
    fieldConfig.envVar = `${envPrefix}_${suffix}`;
    fieldConfig.keychainService = keychainService;
    fieldConfig.opItem = opItem;
  }
  return config;
}

function resolveCreds(profile) {
  const normalized = normalizeProfile(profile);
  // Fast path: a fully-populated local cache skips the shared resolver chain
  // entirely.
  const local = fromLocalFile(normalized);
  if (local.clientId && local.clientSecret && local.refreshToken) {
    return local;
  }

  const resolved = resolveCredentials(profileCredsConfig(normalized), {
    optional: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']
  });
  const clientId = resolved.GOOGLE_OAUTH_CLIENT_ID || local.clientId || '';
  const clientSecret = resolved.GOOGLE_OAUTH_CLIENT_SECRET || local.clientSecret || '';
  const refreshToken = resolved.GOOGLE_OAUTH_REFRESH_TOKEN || local.refreshToken || '';
  return { clientId, clientSecret, refreshToken };
}

// Persist this tool's own credential into 1Password on-device (called by
// authorize.js after a successful consent). Upserts the item in OP_VAULT.
// This is a write path, which the shared resolver deliberately does not
// provide (it only reads) -- kept here as tool-specific logic.
function profileOnePasswordLocation(profile) {
  const normalized = normalizeProfile(profile);
  const config = profileCredsConfig(normalized);
  const field = config.fields.GOOGLE_OAUTH_REFRESH_TOKEN;
  return { vault: field.opVault, item: field.opItem };
}

function saveToOnePassword({ clientId, clientSecret, refreshToken }, profile, execute = execFileSync) {
  const { vault, item } = profileOnePasswordLocation(profile);
  const assignments = [
    `client_id[text]=${clientId}`,
    `client_secret[password]=${clientSecret}`,
    `refresh_token[password]=${refreshToken}`
  ];
  const exists = (() => {
    try {
      execute('op', ['item', 'get', item, '--vault', vault], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (exists) {
    execute('op', ['item', 'edit', item, '--vault', vault, ...assignments], { stdio: 'ignore' });
  } else {
    execute('op', ['item', 'create', '--category', 'API Credential', '--title', item, '--vault', vault, ...assignments], { stdio: 'ignore' });
  }
  return `op://${vault}/${item}`;
}

module.exports = {
  resolveCreds,
  saveToOnePassword,
  normalizeProfile,
  profileCredsConfig,
  profileCredsFile,
  profileOnePasswordLocation,
  CREDS_FILE,
  SCOPE,
  OP_VAULT,
  OP_ITEM
};
