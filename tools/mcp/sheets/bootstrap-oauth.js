#!/usr/bin/env node
'use strict';
//
// ONE-TIME OAuth bootstrap — mint a Google Sheets refresh token for Mythos.
//
// THE OPERATOR RUNS THIS. It opens a Google consent flow; the operator signs in
// AS THE GOOGLE ACCOUNT THAT OWNS / CAN EDIT THE TARGET SHEETS and grants the
// spreadsheets + drive.file scopes. Claude must NOT perform the sign-in
// (entering the account password) or grant the consent — those are operator-only
// actions, and Claude must never see the credential bytes.
//
// Prereq: a GCP project with "Google Sheets API" (and "Google Drive API" for
// sheet creation) enabled, plus an OAuth client of type "Desktop app" (loopback
// redirect is auto-allowed). Put its id/secret in env before running:
//   export SHEETS_CLIENT_ID=...       # OAuth client id  (.apps.googleusercontent.com)
//   export SHEETS_CLIENT_SECRET=...   # OAuth client secret
//   node tools/mcp/sheets/bootstrap-oauth.js
//
// On success it prints the refresh token ONCE (and copies it to the clipboard
// when pbcopy is available), then prints STORE INSTRUCTIONS that never embed the
// token in any command's argv. Unlike the youtube bootstrap, this does NOT
// auto-write the token — the operator owns the credential write.
//
const http = require('http');
const { spawnSync } = require('child_process');
const { OAuth2Client } = require('google-auth-library');

/** Copy a value to the macOS clipboard via pbcopy (stdin — never argv). */
function copyToClipboard(value) {
  try {
    const r = spawnSync('pbcopy', { input: value });
    return r.status === 0;
  } catch {
    return false;
  }
}

// spreadsheets => read/write existing sheets; drive.file => create new sheets
// (and manage only files this app created).
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];
const PORT = Number(process.env.SHEETS_OAUTH_PORT || 53682);
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

(async () => {
  const clientId = process.env.SHEETS_CLIENT_ID;
  const clientSecret = process.env.SHEETS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set SHEETS_CLIENT_ID and SHEETS_CLIENT_SECRET in env first (Desktop-app OAuth client).');
    process.exit(1);
  }

  const oauth2 = new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT });
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-auth
    scope: SCOPES,
  });

  console.log('\n=== Google Sheets OAuth bootstrap (Mythos) ===');
  console.log('1) In your browser, make sure you are signed in AS THE ACCOUNT that owns/edits the sheets.');
  console.log('2) Open this URL and grant access:\n');
  console.log('   ' + authUrl + '\n');
  console.log(`(Listening on ${REDIRECT} for the redirect…)\n`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith('/oauth2callback')) {
        res.statusCode = 404;
        res.end('waiting');
        return;
      }
      const u = new URL(req.url, REDIRECT);
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.setHeader('Content-Type', 'text/plain');
      res.end(c ? 'Authorized. You can close this tab and return to the terminal.' : `Error: ${err || 'no code'}`);
      server.close();
      if (c) resolve(c);
      else reject(new Error(err || 'no authorization code'));
    });
    server.on('error', reject);
    server.listen(PORT);
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error('\nNo refresh_token returned. Revoke the prior grant at');
    console.error('https://myaccount.google.com/permissions and re-run (prompt=consent forces it).');
    process.exit(1);
  }

  // The operator owns the credential write. Print the bare token ONCE (this is
  // the operator's own terminal, not an assistant session) and copy it to the
  // clipboard, then print STORE INSTRUCTIONS that NEVER embed the token in any
  // command's argv (argv lands in shell history / process listings). Do NOT
  // auto-write.
  const token = tokens.refresh_token;
  const copied = copyToClipboard(token);
  console.log('\n✅ Refresh token minted. Store it with ONE of the methods below (operator runs these):\n');
  console.log('--- refresh token (copy this) -------------------------------------------------');
  console.log(token);
  console.log('-------------------------------------------------------------------------------');
  console.log(copied
    ? '(Also copied to your clipboard via pbcopy — paste it at the prompts below.)\n'
    : '(pbcopy unavailable — copy the value above manually.)\n');
  console.log('A) macOS Keychain — interactive, the token is typed at a prompt (never in argv):');
  console.log('   security add-generic-password -U -a mythos -s mythos-google-oauth-client-refresh-token -w');
  console.log('   …then paste the token at the "password:" prompt and press Return.\n');
  console.log('B) 1Password (Automation vault) — paste into the GUI, never into argv:');
  console.log('   Open item "mythos-google-oauth-client" → field "refresh token" → paste → save.');
  console.log('   (Do NOT pass the token on an `op item edit` command line — that lands it in');
  console.log('    shell history and process listings. Paste it into the GUI field instead.)\n');
  console.log('Also ensure the OAuth client id/secret live on the same 1Password item');
  console.log('(paste them into the "client id" / "client secret" fields in the 1Password GUI).\n');
  console.log('run-with-op.sh reads "client id" / "client secret" / "refresh token" from that item,');
  console.log('and falls back to the macOS Keychain entries if the 1Password fields are absent.');
})().catch((e) => {
  console.error('[bootstrap-oauth] ERROR:', e.message);
  process.exit(1);
});
