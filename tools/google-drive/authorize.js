#!/usr/bin/env node
'use strict';
// ONE-TIME OAuth consent (operator runs this once). Uses the modern installed-app
// loopback flow (no deprecated OOB). Captures the auth code on localhost,
// exchanges it for a refresh token, and saves it to .oauth-creds.json (mode 600,
// gitignored).
//
// Prereqs (operator, one time):
//   1. Google Cloud Console -> enable the Google Drive API.
//   2. Create an OAuth 2.0 Client ID of type "Desktop app".
//   3. Add http://localhost:4173 to the client's Authorized redirect URIs.
//   4. Export the client id/secret, then run this script:
//        GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//          node authorize.js
//   5. A browser opens; sign in as the Google account this Drive automation
//      should act as, and approve.

const http = require('http');
const https = require('https');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { URL, URLSearchParams } = require('url');
const {
  SCOPE,
  normalizeProfile,
  profileCredsFile,
  profileOnePasswordLocation,
  resolveCreds,
  saveToOnePassword
} = require('./config');

const USAGE = `Usage: node authorize.js [options]

Mint and store a Google Drive OAuth refresh token.

Options:
  --profile <name>       Use a named credential profile. Names may contain
                         letters, digits, hyphens, and underscores.
  --client-json <path>   Read the OAuth client id/secret from a Google Cloud
                         Desktop or Web client JSON download.
  -h, --help             Show this help without resolving credentials.

Examples:
  node authorize.js
  node authorize.js --client-json /path/to/oauth-client.json
  node authorize.js --profile somemarketing --client-json /path/to/oauth-client.json

Explicit GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment
variables take precedence over --client-json and stored profile values.`;

function parseArgs(argv) {
  const options = { help: false, profile: null, clientJson: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--profile' || arg === '--client-json') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--profile') options.profile = normalizeProfile(value);
      else options.clientJson = value;
      i += 1;
    } else {
      throw new Error('AUTH_ARGUMENT_INVALID: Unknown option. Run with --help for supported options.');
    }
  }
  return options;
}

// Client id/secret come from env, or fall back to whatever resolveCreds() finds
// (e.g. an OAuth client you've already stored). Lets you run with no pasting.
// Optional: read the client id/secret straight from the JSON Google Cloud Console
// hands you ("Download JSON" on the OAuth client). Desktop clients nest under
// "installed"; web clients under "web".
function fromClientJson(p, readFile = fs.readFileSync) {
  if (!p) return {};
  try {
    const raw = JSON.parse(readFile(p, 'utf8'));
    const o = raw.installed || raw.web || raw;
    if (!o.client_id || !o.client_secret) throw new Error('missing OAuth client fields');
    return { clientId: o.client_id, clientSecret: o.client_secret };
  } catch {
    const error = new Error('AUTH_CLIENT_JSON_INVALID: OAuth client JSON could not be read or validated.');
    error.code = 'AUTH_CLIENT_JSON_INVALID';
    throw error;
  }
}

function resolveClientInputs(profile, fromJson, env = process.env, resolver = resolveCreds) {
  const explicitClientId = env.GOOGLE_OAUTH_CLIENT_ID || fromJson.clientId;
  const explicitClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET || fromJson.clientSecret;
  const resolved = explicitClientId && explicitClientSecret ? {} : resolver(profile);
  return {
    clientId: explicitClientId || resolved.clientId,
    clientSecret: explicitClientSecret || resolved.clientSecret
  };
}

function saveLocalCredentials(creds, profile, fileSystem = fs) {
  const credsFile = profileCredsFile(profile);
  const payload = JSON.stringify({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken
  }, null, 2);
  fileSystem.writeFileSync(credsFile, payload, { mode: 0o600 });
  fileSystem.chmodSync(credsFile, 0o600);
  return credsFile;
}

function persistCredentials(creds, profile, dependencies = {}) {
  const saveOnePassword = dependencies.saveToOnePassword || saveToOnePassword;
  try {
    return { storage: 'one-password', location: saveOnePassword(creds, profile) };
  } catch {
    return {
      storage: 'local-file',
      location: saveLocalCredentials(creds, profile, dependencies.fs || fs)
    };
  }
}

function openBrowser(authUrl, execute = execFileSync) {
  try {
    execute('open', [authUrl], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const PORT = 4173;
const redirectUri = `http://localhost:${PORT}`;

function exchangeCode(code, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString();
    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function startAuthorization({ profile, clientId, clientSecret }, dependencies = {}) {
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent'
    }).toString();

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, redirectUri);
      const code = u.searchParams.get('code');
      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Waiting for OAuth code...');
        return;
      }
      const tok = await exchangeCode(code, clientId, clientSecret);
      if (!tok.refresh_token) {
        res.end('No refresh_token returned. Revoke prior access at myaccount.google.com/permissions and retry (prompt=consent is already set).');
        console.error('Google did not return a refresh token; no credential was stored.');
        server.close();
        return;
      }
      const creds = { clientId, clientSecret, refreshToken: tok.refresh_token };
      const persisted = persistCredentials(creds, profile, dependencies);
      if (persisted.storage === 'one-password') console.log(`Saved Drive credential to 1Password: ${persisted.location}`);
      else console.log(`1Password write was unavailable; saved to ${persisted.location} instead.`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorized. Drive credential stored. You can close this tab.');
      const location = profileOnePasswordLocation(profile);
      console.log(`   Profile: ${profile || 'default'}`);
      console.log(`   Preferred vault item: ${location.vault} / ${location.item}`);
      console.log('   Test it:  node share.js --file <id> --list');
      server.close();
    } catch {
      res.end('Authorization failed; no credential was stored. See the terminal for retry guidance.');
      console.error('Google Drive authorization failed; no credential was stored.');
      server.close();
    }
  });

  server.listen(PORT, () => {
    console.log('Open this URL in a browser signed in as the Drive account this tool should act as:\n\n' + authUrl + '\n\nListening for the redirect on ' + redirectUri + ' ...');
    openBrowser(authUrl, dependencies.execFileSync || execFileSync);
  });
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const log = dependencies.log || console.log;
  const errorLog = dependencies.error || console.error;
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    errorLog(error.message);
    errorLog(`\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }

  let fromJson;
  try {
    fromJson = fromClientJson(options.clientJson, dependencies.readFileSync || fs.readFileSync);
  } catch (error) {
    errorLog(error.message);
    return 1;
  }
  let clientId;
  let clientSecret;
  try {
    ({ clientId, clientSecret } = resolveClientInputs(
      options.profile,
      fromJson,
      dependencies.env || process.env,
      dependencies.resolveCreds || resolveCreds
    ));
  } catch {
    errorLog('AUTH_STORED_CREDENTIAL_RESOLUTION_FAILED: Stored OAuth client credential resolution failed for the selected profile.');
    return 1;
  }
  if (!clientId || !clientSecret) {
    errorLog('AUTH_CLIENT_CREDENTIAL_MISSING: No OAuth client id/secret was found for the selected profile.');
    return 1;
  }
  (dependencies.startAuthorization || startAuthorization)({ profile: options.profile, clientId, clientSecret }, dependencies);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  USAGE,
  parseArgs,
  fromClientJson,
  resolveClientInputs,
  saveLocalCredentials,
  persistCredentials,
  openBrowser,
  main
};
