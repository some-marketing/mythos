'use strict';
//
// YouTube upload tool config. Credentials resolve through the shared
// tools/lib/resolve-credential.cjs 4-source chain (env -> macOS Keychain ->
// 1Password -> env file) per creds.config.json in this directory. Running
// via run-with-op.sh still works unchanged -- it pre-populates env vars,
// which the resolver's environment source picks up first, so both paths
// are compatible. Credential bytes never appear in argv or in any
// persistent file.
//

const path = require('path');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

const CREDS_CONFIG_PATH = path.join(__dirname, 'creds.config.json');

function getEnv(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def !== undefined) return def;
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function loadYouTubeConfig() {
  const creds = resolveCredentialsFromFile(CREDS_CONFIG_PATH);

  return {
    clientId: creds.YT_CLIENT_ID,
    clientSecret: creds.YT_CLIENT_SECRET,
    refreshToken: creds.YT_REFRESH_TOKEN,
    dryRun: String(process.env.YT_DRY_RUN || 'false').toLowerCase() === 'true',
  };
}

module.exports = { getEnv, loadYouTubeConfig };
