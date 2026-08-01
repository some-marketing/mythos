#!/usr/bin/env node
'use strict';
//
// ONE-TIME OAuth bootstrap — mint a YouTube refresh token for the your channel.
//
// THE OPERATOR RUNS THIS. It opens a Google consent flow; the operator signs in
// AS YOUR TARGET YOUTUBE ACCOUNT and grants the youtube.upload scope. Claude must
// NOT perform the sign-in (entering the account password) or grant the consent —
// those are operator-only actions.
//
// Prereq: a GCP project with "YouTube Data API v3" enabled and an OAuth client
// of type "Desktop app" (loopback redirect is auto-allowed). Put its id/secret
// in env before running:
//   export YT_CLIENT_ID=...           # OAuth client id  (.apps.googleusercontent.com)
//   export YT_CLIENT_SECRET=...       # OAuth client secret
//   node tools/mcp/youtube/bootstrap-oauth.js
//
// On success it prints the refresh token ONCE. Store all three on the vault item
// so run-with-op.sh can use them headlessly thereafter:
//   op item edit "YouTube Channel" --vault Automation \
//     "client id[text]=$YT_CLIENT_ID" \
//     "client secret[password]=$YT_CLIENT_SECRET" \
//     "refresh token[password]=<the-printed-token>"
//
const http = require('http');
const { OAuth2Client } = require('google-auth-library');

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const PORT = Number(process.env.YT_OAUTH_PORT || 53682);
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

(async () => {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set YT_CLIENT_ID and YT_CLIENT_SECRET in env first (Desktop-app OAuth client).');
    process.exit(1);
  }

  const oauth2 = new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT });
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-auth
    scope: SCOPES,
  });

  console.log('\n=== YouTube OAuth bootstrap (your channel) ===');
  console.log('1) In your browser, make sure you are signed in as your target YouTube account.');
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

  // Auto-store all three fields on the vault item. The refresh token is NEVER
  // printed to stdout — so this is safe to run even if piped back through an
  // assistant session. It is handed to `op` only via this child process.
  const { spawnSync } = require('child_process');
  const vault = process.env.YTOP_VAULT || 'Automation';
  const item = process.env.YTOP_ITEM || 'YouTube Channel';
  const r = spawnSync(
    'op',
    [
      'item', 'edit', item, '--vault', vault,
      `client id[text]=${clientId}`,
      `client secret[password]=${clientSecret}`,
      `refresh token[password]=${tokens.refresh_token}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] } // never echo the assignment (it contains the token)
  );
  if (r.status === 0) {
    console.log(`\n✅ Stored client id / client secret / refresh token on "${item}" (vault "${vault}"). Token not displayed.`);
    console.log('You can now run uploads via tools/mcp/youtube/run-with-op.sh — say "go".');
  } else {
    console.error(`\n[bootstrap-oauth] op item edit failed (exit ${r.status}). Token NOT printed for safety.`);
    console.error('Fix the op CLI / vault access and re-run this bootstrap (the consent step is quick).');
    process.exit(1);
  }
})().catch((e) => {
  console.error('[bootstrap-oauth] ERROR:', e.message);
  process.exit(1);
});
