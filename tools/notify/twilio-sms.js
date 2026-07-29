#!/usr/bin/env node
'use strict';

/**
 * twilio-sms.js — Send an SMS to the operator via Twilio REST. Lands on the
 * phone's Messages app and mirrors to a paired watch — the reliable
 * "wristwatch" notification path.
 *
 * SECURITY: creds resolved at runtime via tools/lib/resolve-credential.cjs;
 * operator number never hardcoded. Zero secrets in argv.
 *
 * Usage:
 *   node tools/notify/twilio-sms.js --smoke                 # creds check, no send
 *   node tools/notify/twilio-sms.js --body "Mythos: come check — plan gate"
 *   node tools/notify/twilio-sms.js --to +15551234567 --body "..."
 *
 * Env overrides (see SETUP.md for the full env/Keychain/1Password chain):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_OPERATOR_PHONE
 */

const { resolveCreds, buildAuth } = require('./twilio-creds');
const { discoverAccountSid, listIncomingNumbers, twilioPost } = require('./twilio-api');

function parseArgs(argv) {
  const a = { smoke: false, to: null, body: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--smoke') a.smoke = true;
    else if (t === '--to') a.to = argv[++i];
    else if (t === '--body') a.body = argv[++i];
    else if (t === '--help' || t === '-h') { a.help = true; }
  }
  return a;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) { console.log('Usage: twilio-sms.js [--smoke] [--to +E164] --body "text"'); return 0; }

  const creds = resolveCreds();
  const auth = buildAuth(creds);

  let accountSid = auth.accountSid;
  if (!accountSid) accountSid = await discoverAccountSid(auth);

  const to = opts.to || creds.operatorPhone;
  let from = creds.fromNumber;
  if (!from) {
    const nums = await listIncomingNumbers(accountSid, auth);
    from = (nums && nums.find(n => n.capabilities?.sms)?.phone_number) || null;
  }

  if (opts.smoke) {
    console.log(`[twilio-sms] account: ${accountSid ? 'ok' : 'MISSING'}`);
    console.log(`[twilio-sms] from (sms): ${from || 'NOT SET'}`);
    console.log(`[twilio-sms] operator to: ${to || 'NOT SET — set TWILIO_OPERATOR_PHONE, see SETUP.md'}`);
    console.log(from && to ? '--- Smoke PASSED (ready to text) ---' : '--- Smoke: needs from + operator number ---');
    return from && to ? 0 : 1;
  }

  if (!to) { console.error('ERROR: no operator number. --to +E164 or set TWILIO_OPERATOR_PHONE.'); return 1; }
  if (!from) { console.error('ERROR: no SMS-capable from-number resolvable.'); return 1; }
  if (!opts.body) { console.error('ERROR: --body required.'); return 1; }

  const res = await twilioPost(
    `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    { To: to, From: from, Body: opts.body },
    auth
  );
  console.log(`[twilio-sms] sent sid=${res.sid || '?'} status=${res.status || '?'}`);
  return 0;
}

main().then(code => process.exit(code || 0)).catch(e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
