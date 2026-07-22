#!/usr/bin/env node
'use strict';
// Share a Google Drive file/folder -- a capability many connected Drive MCPs
// lack. Grants a user permission (or link-sharing) and can list current
// permissions.
//
// Usage:
//   node share.js --file <id> --email someone@example.com [--role reader|commenter|writer] [--notify]
//   node share.js --file <id> --anyone [--role reader]      # link-sharing
//   node share.js --file <id> --list                        # show current permissions
//   add --dry-run to preview without mutating
//
// Auth: see SETUP.md (run authorize.js once).

const { resolveCreds } = require('./config');
const { getAccessToken, createPermission, listPermissions } = require('./client');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

(async () => {
  const fileId = arg('file');
  if (!fileId) {
    console.error('Usage: node share.js --file <id> [--email user@example.com] [--role reader|commenter|writer] [--anyone] [--notify] [--list] [--dry-run]');
    process.exit(1);
  }

  const creds = resolveCreds();
  const accessToken = await getAccessToken(creds);

  if (arg('list')) {
    const r = await listPermissions({ accessToken, fileId });
    console.log(JSON.stringify(r.permissions || r, null, 2));
    return;
  }

  const email = arg('email');
  const anyone = arg('anyone') === true;
  if (!email && !anyone) {
    console.error('Provide --email <addr> (share with a person) or --anyone (link-sharing).');
    process.exit(1);
  }

  const role = typeof arg('role') === 'string' ? arg('role') : 'reader';
  const dryRun = arg('dry-run') === true;
  const notify = arg('notify') === true;

  const res = await createPermission({
    accessToken,
    fileId,
    role,
    type: anyone ? 'anyone' : 'user',
    emailAddress: anyone ? undefined : email,
    sendNotificationEmail: notify,
    dryRun
  });
  console.log(dryRun ? 'DRY RUN -- would share:' : 'shared:', JSON.stringify(res));
})().catch((e) => {
  console.error('FAIL:', e.message, e.body ? '\n' + String(e.body).slice(0, 500) : '');
  process.exit(1);
});
