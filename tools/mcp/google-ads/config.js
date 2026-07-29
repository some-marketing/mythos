'use strict';

const path = require('path');
const { getBooleanEnv, getEnv, loadLocalEnv } = require('../shared/env');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

const CREDS_CONFIG_PATH = path.join(__dirname, 'creds.config.json');

function loadGoogleAdsConfig() {
  loadLocalEnv();

  // Secret/OAuth fields resolve through the shared 4-source chain (env ->
  // macOS Keychain -> 1Password -> env file) per creds.config.json. Customer
  // ids are not secrets and stay on the plain env loader.
  const creds = resolveCredentialsFromFile(CREDS_CONFIG_PATH);

  return {
    apiVersion: getEnv('GOOGLE_ADS_API_VERSION', { defaultValue: 'v22' }),
    developerToken: creds.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: creds.GOOGLE_ADS_CLIENT_ID,
    clientSecret: creds.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: creds.GOOGLE_ADS_REFRESH_TOKEN,
    loginCustomerId: normalizeId(creds.GOOGLE_ADS_LOGIN_CUSTOMER_ID || getEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID')),
    defaultCustomerId: normalizeId(creds.GOOGLE_ADS_CUSTOMER_ID || getEnv('GOOGLE_ADS_CUSTOMER_ID')),
    dryRun: getBooleanEnv('GOOGLE_ADS_DRY_RUN', true)
  };
}

function normalizeId(value) {
  if (!value) return value;
  return String(value).replace(/-/g, '');
}

module.exports = {
  loadGoogleAdsConfig
};
