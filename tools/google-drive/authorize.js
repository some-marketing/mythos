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
const { execSync } = require('child_process');
const { URL, URLSearchParams } = require('url');
const { CREDS_FILE, SCOPE, resolveCreds, saveToOnePassword, OP_VAULT, OP_ITEM } = require('./config');

// Client id/secret come from env, or fall back to whatever resolveCreds() finds
// (e.g. an OAuth client you've already stored). Lets you run with no pasting.
// Optional: read the client id/secret straight from the JSON Google Cloud Console
// hands you ("Download JSON" on the OAuth client). Desktop clients nest under
// "installed"; web clients under "web".
function fromClientJson() {
  const i = process.argv.indexOf('--client-json');
  if (i < 0) return {};
  const p = process.argv[i + 1];
  if (!p) { console.error('--client-json needs a file path'); process.exit(1); }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const o = raw.installed || raw.web || raw;
    return { clientId: o.client_id, clientSecret: o.client_secret };
  } catch (e) {
    console.error(`Could not read --client-json "${p}": ${e.message}`);
    process.exit(1);
  }
}

const resolved = resolveCreds();
const fromJson = fromClientJson();
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || fromJson.clientId || resolved.clientId;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || fromJson.clientSecret || resolved.clientSecret;
if (!clientId || !clientSecret) {
  console.error('No OAuth client id/secret found. Pass --client-json <downloaded file>, or set GOOGLE_OAUTH_CLIENT_ID / _SECRET.');
  process.exit(1);
}

const PORT = 4173;
const redirectUri = `http://localhost:${PORT}`;

function exchangeCode(code) {
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
  const u = new URL(req.url, redirectUri);
  const code = u.searchParams.get('code');
  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Waiting for OAuth code...');
    return;
  }
  try {
    const tok = await exchangeCode(code);
    if (!tok.refresh_token) {
      res.end('No refresh_token returned. Revoke prior access at myaccount.google.com/permissions and retry (prompt=consent is already set).');
      console.error('Token response:', tok);
      server.close();
      return;
    }
    const creds = { clientId, clientSecret, refreshToken: tok.refresh_token };
    let storedAt = '';
    try {
      storedAt = saveToOnePassword(creds);
      console.log(`Saved Drive credential to 1Password: ${storedAt}`);
    } catch (opErr) {
      // 1Password unavailable -> fall back to the gitignored local file (mode 600).
      fs.writeFileSync(CREDS_FILE, JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: tok.refresh_token }, null, 2), { mode: 0o600 });
      console.log(`1Password write failed (${opErr.message}); saved to ${CREDS_FILE} instead.`);
      storedAt = CREDS_FILE;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authorized. Drive credential stored. You can close this tab.');
    console.log(`   Vault: ${OP_VAULT} / Item: ${OP_ITEM}`);
    console.log('   Test it:  node share.js --file <id> --list');
    server.close();
  } catch (e) {
    res.end('Error: ' + e.message);
    console.error(e);
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('Open this URL in a browser signed in as the Drive account this tool should act as:\n\n' + authUrl + '\n\nListening for the redirect on ' + redirectUri + ' ...');
  try { execSync(`open ${JSON.stringify(authUrl)}`); } catch { /* operator opens manually */ }
});
