#!/usr/bin/env node
'use strict';

// gmail-fetch-attachment.js — fetch an email attachment from a Gmail mailbox
// over IMAP and write it to disk, so a session can Read it (the connected
// Gmail MCP can list attachment IDs but exposes no download RPC).
//
// WHY: for when a needed email attachment is only reachable via Gmail IMAP
// (not in Drive, no local copy) and would otherwise have to be downloaded by
// hand. Mirrors the IMAP + instance-secrets pattern already used by
// gmail-home-imap-check.js.
//
// CREDENTIALS (resolved at runtime, never scanned/printed): an IMAP app
// password (not the account password). Resolution order:
//   1. env GMAIL_FETCH_EMAIL + GMAIL_FETCH_APP_PASSWORD
//   2. secrets/mythos.home.env keys GMAIL_FETCH_EMAIL / GMAIL_FETCH_APP_PASSWORD
//   3. same file's GOOGLE_HOME_EMAIL / GOOGLE_HOME_APP_PASSWORD (existing home account)
// To seed one: myaccount.google.com -> Security -> 2-Step -> App passwords,
// then add GMAIL_FETCH_APP_PASSWORD / GMAIL_FETCH_EMAIL to the secrets file.
//
// USAGE (from repo root):
//   node tools/local/gmail-fetch-attachment.js \
//     --subject "Marketing Proposal" --from someone@example.com \
//     --out-dir /tmp/attachment-fetch
//   # other selectors: --uid <n>  --since 2026-06-01  --mailbox "[Gmail]/All Mail"
//   #   --name <substring of filename to match>   --list  (just list attachments)

const tls = require('tls');
const fs = require('fs');
const path = require('path');

// ---- credential resolution -------------------------------------------------

function loadSecretFile() {
  try {
    const { loadHomeSecrets } = require('./lib/instance-secrets');
    return loadHomeSecrets().values;
  } catch (_e) {
    return {};
  }
}

function resolveCreds() {
  const file = loadSecretFile();
  const email = process.env.GMAIL_FETCH_EMAIL || file.GMAIL_FETCH_EMAIL || file.GOOGLE_HOME_EMAIL;
  const password = process.env.GMAIL_FETCH_APP_PASSWORD || file.GMAIL_FETCH_APP_PASSWORD || file.GOOGLE_HOME_APP_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'No Gmail IMAP credential found. Set GMAIL_FETCH_EMAIL + GMAIL_FETCH_APP_PASSWORD ' +
      '(env or secrets/mythos.home.env). Create an app password at ' +
      'myaccount.google.com -> Security -> App passwords.'
    );
  }
  return { email, password };
}

// ---- minimal IMAP client (TLS, tagged commands) ----------------------------

function escapeImapString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, minVersion: 'TLSv1.2' });
    socket.setEncoding('utf8');
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readUntil(socket, matcher, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`IMAP timeout waiting for ${matcher}`)); }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      socket.off('data', onData); socket.off('error', onError); socket.off('close', onClose);
    }
    function onData(chunk) {
      buffer += chunk;
      if ((matcher instanceof RegExp && matcher.test(buffer)) || (typeof matcher === 'string' && buffer.includes(matcher))) {
        cleanup(); resolve(buffer);
      }
    }
    function onError(e) { cleanup(); reject(e); }
    function onClose() { cleanup(); reject(new Error('IMAP socket closed early')); }
    socket.on('data', onData); socket.on('error', onError); socket.on('close', onClose);
  });
}

async function cmd(socket, tag, text, timeoutMs) {
  socket.write(`${tag} ${text}\r\n`);
  const resp = await readUntil(socket, new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)`, 'i'), timeoutMs);
  if (!new RegExp(`\\r?\\n${tag} OK`, 'i').test(resp)) throw new Error(`IMAP command failed (${text.split(' ')[0]}):\n${resp.slice(0, 400)}`);
  return resp;
}

// ---- MIME parsing (recursive; decodes base64/qp/7bit leaves) ----------------

function splitHeadersBody(raw) {
  const idx = raw.search(/\r?\n\r?\n/);
  if (idx === -1) return { headers: raw, body: '' };
  const sep = raw.slice(idx).match(/^\r?\n\r?\n/)[0];
  return { headers: raw.slice(0, idx), body: raw.slice(idx + sep.length) };
}

function headerValue(headers, name) {
  // unfold continuation lines, case-insensitive header match
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  const re = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  const m = unfolded.match(re);
  return m ? m[1].trim() : '';
}

function paramValue(headerVal, param) {
  const m = headerVal.match(new RegExp(`${param}\\s*=\\s*"([^"]*)"`, 'i')) ||
            headerVal.match(new RegExp(`${param}\\s*=\\s*([^;\\s]+)`, 'i'));
  return m ? m[1] : '';
}

function collectAttachments(raw, out = []) {
  const { headers, body } = splitHeadersBody(raw);
  const ctype = headerValue(headers, 'Content-Type');
  if (/^multipart\//i.test(ctype)) {
    const boundary = paramValue(ctype, 'boundary');
    if (!boundary) return out;
    const marker = `--${boundary}`;
    const parts = body.split(marker);
    for (const part of parts) {
      const trimmed = part.replace(/^\r?\n/, '');
      if (!trimmed || /^--\s*$/.test(trimmed)) continue;
      collectAttachments(trimmed, out);
    }
    return out;
  }
  // leaf part
  const disp = headerValue(headers, 'Content-Disposition');
  const filename = paramValue(disp, 'filename') || paramValue(ctype, 'name');
  if (!filename) return out;
  const enc = (headerValue(headers, 'Content-Transfer-Encoding') || '7bit').toLowerCase();
  let data;
  if (enc === 'base64') data = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  else if (enc === 'quoted-printable') data = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
  else data = Buffer.from(body, 'binary');
  out.push({ filename, mimeType: ctype.split(';')[0].trim(), size: data.length, data });
  return out;
}

// ---- args ------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) { args[key] = true; continue; }
    args[key] = val; i++;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const mailbox = args.mailbox || 'INBOX';
  const outDir = args['out-dir'] || '.';
  const { email, password } = resolveCreds();

  const socket = await connect('imap.gmail.com', 993);
  let raw;
  try {
    await readUntil(socket, /\* OK/i);
    await cmd(socket, 'A1', `LOGIN ${escapeImapString(email)} ${escapeImapString(password)}`);
    await cmd(socket, 'A2', `SELECT ${escapeImapString(mailbox)}`);

    // build search
    let uids;
    if (args.uid) {
      uids = [String(args.uid)];
    } else {
      const crit = [];
      if (args.subject) crit.push(`HEADER Subject ${escapeImapString(args.subject)}`);
      if (args.from) crit.push(`FROM ${escapeImapString(args.from)}`);
      if (args.since) crit.push(`SINCE ${args.since}`); // e.g. 01-Jun-2026 or YYYY-MM-DD handled below
      if (args.before) crit.push(`BEFORE ${args.before}`); // upper date bound (exclusive), same format as --since
      if (!crit.length) throw new Error('Provide a selector: --uid, or --subject/--from[/--since].');
      const searchResp = await cmd(socket, 'A3', `UID SEARCH ${crit.join(' ')}`);
      const m = searchResp.match(/\* SEARCH([0-9 ]*)/i);
      uids = m && m[1].trim() ? m[1].trim().split(/\s+/) : [];
      if (!uids.length) throw new Error('No message matched the search criteria.');
    }
    const uid = uids[uids.length - 1]; // most recent match
    const fetchResp = await cmd(socket, 'A4', `UID FETCH ${uid} (BODY.PEEK[])`, 120000);
    // strip the FETCH literal wrapper: "* n FETCH (...{size}\r\n<raw>...)"
    const litIdx = fetchResp.indexOf('{');
    const start = fetchResp.indexOf('}\r\n', litIdx);
    raw = start !== -1 ? fetchResp.slice(start + 3) : fetchResp;
    await cmd(socket, 'A5', 'LOGOUT').catch(() => {});
  } finally {
    socket.end();
  }

  const all = collectAttachments(raw);
  const wanted = args.name ? all.filter((a) => a.filename.toLowerCase().includes(String(args.name).toLowerCase())) : all;

  if (args.list) {
    console.log(JSON.stringify({ ok: true, mailbox, attachments: all.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })) }, null, 2));
    return;
  }
  if (!wanted.length) {
    console.log(JSON.stringify({ ok: false, mailbox, reason: 'no matching attachment', found: all.map((a) => a.filename) }, null, 2));
    process.exit(2);
  }
  fs.mkdirSync(path.resolve(outDir), { recursive: true });
  const written = [];
  for (const att of wanted) {
    const dest = path.join(path.resolve(outDir), att.filename);
    fs.writeFileSync(dest, att.data);
    written.push({ path: dest, mimeType: att.mimeType, bytes: att.size });
  }
  console.log(JSON.stringify({ ok: true, mailbox, written }, null, 2));
}

main().catch((e) => { console.error('[gmail-fetch-attachment] ERROR:', e.message); process.exit(1); });
