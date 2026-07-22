'use strict';

const path = require('path');
const { getBooleanEnv, getEnv, loadLocalEnv } = require('../shared/env');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

const CREDS_CONFIG_PATH = path.join(__dirname, 'creds.config.json');

function loadMetaAdsConfig() {
  loadLocalEnv();

  // Secret field resolves through the shared 4-source chain (env -> macOS
  // Keychain -> 1Password -> env file) per creds.config.json.
  const creds = resolveCredentialsFromFile(CREDS_CONFIG_PATH);

  return {
    apiVersion: getEnv('META_API_VERSION', { defaultValue: 'v21.0' }),
    baseUrl: getEnv('META_GRAPH_BASE_URL', { defaultValue: 'https://graph.facebook.com' }),
    accessToken: creds.META_ACCESS_TOKEN,
    defaultAccountId: getEnv('META_AD_ACCOUNT_ID'),
    dryRun: getBooleanEnv('META_ADS_DRY_RUN', true)
  };
}

module.exports = {
  loadMetaAdsConfig
};
