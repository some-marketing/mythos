'use strict';
//
// Google Sheets API tool config. Credentials resolve through the shared
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

function loadSheetsConfig() {
  const creds = resolveCredentialsFromFile(CREDS_CONFIG_PATH);

  return {
    clientId: creds.SHEETS_CLIENT_ID,
    clientSecret: creds.SHEETS_CLIENT_SECRET,
    refreshToken: creds.SHEETS_REFRESH_TOKEN,
    dryRun: String(process.env.SHEETS_DRY_RUN || 'false').toLowerCase() === 'true',
  };
}

module.exports = { loadSheetsConfig };
