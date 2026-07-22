'use strict';

const path = require('path');
const { getBooleanEnv, getEnv, loadLocalEnv } = require('../shared/env');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

const CREDS_CONFIG_PATH = path.join(__dirname, 'creds.config.json');

function loadDelesignConfig() {
  loadLocalEnv();

  // Secret field resolves through the shared 4-source chain (env -> macOS
  // Keychain -> 1Password -> env file) per creds.config.json.
  const creds = resolveCredentialsFromFile(CREDS_CONFIG_PATH);

  return {
    baseUrl: getEnv('DELESIGN_BASE_URL', { defaultValue: 'https://api.delesign.com' }),
    apiVersion: getEnv('DELESIGN_API_VERSION', { defaultValue: 'v1' }),
    accessToken: creds.DELESIGN_API_TOKEN,
    dryRun: getBooleanEnv('DELESIGN_DRY_RUN', true)
  };
}

module.exports = {
  loadDelesignConfig
};
