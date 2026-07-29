#!/usr/bin/env node
'use strict';

/**
 * twilio-inbox.js — Poll Twilio's message log for INBOUND texts (operator -> assistant).
 *
 * The lightweight inbound channel: no webhook/server deploy needed. Twilio logs every
 * inbound SMS to our number; this reads them on demand. Not real-time push — poll it
 * (or loop it) to see replies.
 *
 * Usage:
 *   node tools/notify/twilio-inbox.js                 # last 15 inbound msgs
 *   node tools/notify/twilio-inbox.js --from +1902...  # filter by sender
 *   node tools/notify/twilio-inbox.js --limit 30 --json
 */

const { resolveCreds, buildAuth } = require('./twilio-creds');
const { twilioGet, discoverAccountSid } = require('./twilio-api');

function parseArgs(argv) {
  const a = { from: null, limit: 15, json: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--from') a.from = argv[++i];
    else if (t === '--limit') a.limit = parseInt(argv[++i], 10) || 15;
    else if (t === '--json') a.json = true;
  }
  return a;
}

async function main() {
  const opts = parseArgs(process.argv);
  const creds = resolveCreds();
  const auth = buildAuth(creds);
  let sid = auth.accountSid || await discoverAccountSid(auth);

  const r = await twilioGet(`/2010-04-01/Accounts/${sid}/Messages.json?PageSize=${opts.limit}`, auth);
  let msgs = (r.messages || [])
    .filter(m => String(m.direction || '').startsWith('inbound'))
    .filter(m => !opts.from || m.from === opts.from)
    .map(m => ({ date: m.date_sent || m.date_created, from: m.from, to: m.to, body: m.body, sid: m.sid }));

  if (opts.json) { console.log(JSON.stringify(msgs, null, 2)); return 0; }
  if (!msgs.length) { console.log('(no inbound messages)'); return 0; }
  console.log(`Inbound (${msgs.length}):`);
  for (const m of msgs) console.log(`  [${m.date}] ${m.from}: ${m.body}`);
  return 0;
}

main().then(c => process.exit(c || 0)).catch(e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
