#!/usr/bin/env node
'use strict';

/**
 * twilio-smoke.js — Credential and account validation. NO call is placed.
 *
 * Runs:
 *   1. Credential inspection (labels + presence, no values echoed)
 *   2. Auth method determination
 *   3. Account SID discovery (if needed)
 *   4. Account status + balance fetch
 *   5. Owned phone number listing with capability check
 *   6. Readiness verdict
 *
 * Output is written to stdout and mirrored to a status file.
 * The status file path is printed at the end.
 *
 * Usage:
 *   node tools/notify/twilio-smoke.js [--output <path>]
 */

const path = require('path');
const fs   = require('fs');
const { resolveCreds, buildAuth } = require('./twilio-creds');
const { discoverAccountSid, listIncomingNumbers, getAccount } = require('./twilio-api');

const DEFAULT_OUTPUT = path.join(__dirname, 'twilio-status.md');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { output: DEFAULT_OUTPUT };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output') opts.output = args[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const lines = [];
  const log = (s = '') => { console.log(s); lines.push(s); };

  log(`# Twilio Status — ${new Date().toISOString().slice(0, 10)}`);
  log('');
  log('## 1. Credential Inspection (labels + presence only)');
  log('');

  const creds = resolveCreds();

  const credFields = [
    { label: 'Account SID',    key: 'accountSid'    },
    { label: 'Auth Token',     key: 'authToken'      },
    { label: 'API Key SID',    key: 'apiKeySid'      },
    { label: 'API Key Secret', key: 'apiKeySecret'   },
    { label: 'From Number',    key: 'fromNumber'     },
    { label: 'Operator Phone', key: 'operatorPhone'  },
  ];

  for (const f of credFields) {
    const present = creds[f.key] !== null;
    log(`- ${f.label}: ${present ? 'PRESENT' : 'MISSING'}`);
  }

  log('');
  log('## 2. Auth Method');
  log('');

  const auth = buildAuth(creds);
  if (!auth) {
    log('**AUTH: NONE** — No usable credential combination.');
    log('Blockers:');
    if (!creds.accountSid)   log('- Account SID missing (required unless using API Key SID + Secret)');
    if (!creds.authToken)    log('- Auth Token missing');
    if (!creds.apiKeySid)    log('- API Key SID missing');
    if (!creds.apiKeySecret) log('- API Key Secret missing');
    fs.writeFileSync(opts.output, lines.join('\n') + '\n');
    console.error(`\nStatus written to: ${opts.output}`);
    process.exit(2);
  }

  log(`Auth method: **${auth.method}**`);
  log(`Account SID known at credential-read: ${auth.accountSid ? 'yes' : 'no'}`);

  log('');
  log('## 3. Account SID Discovery');
  log('');

  let accountSid = auth.accountSid;
  if (!accountSid) {
    log('Account SID not in credentials — discovering via /Accounts.json ...');
    try {
      accountSid = await discoverAccountSid(auth);
      log(`Discovered Account SID: ${accountSid.slice(0, 6)}...`);
    } catch (e) {
      log(`**FAILED:** ${e.message}`);
      if (e.statusCode === 401) log('→ Auth credentials rejected by Twilio (wrong token or key)');
      fs.writeFileSync(opts.output, lines.join('\n') + '\n');
      console.error(`\nStatus written to: ${opts.output}`);
      process.exit(2);
    }
  } else {
    log(`Account SID available (${accountSid.slice(0, 6)}...)`);
  }

  log('');
  log('## 4. Account Status');
  log('');

  let account;
  try {
    // For auth token method, use accountSid as username
    const callAuth = auth.method === 'account+authtoken'
      ? { username: accountSid, password: auth.password }
      : auth;
    account = await getAccount(accountSid, callAuth);
    log(`- Status: **${account.status}**`);
    log(`- Friendly name: ${account.friendly_name}`);
    log(`- Balance: ${account.balance} ${account.currency || ''}`);
    log(`- Type: ${account.type}`);
  } catch (e) {
    log(`**FAILED:** ${e.message}`);
    fs.writeFileSync(opts.output, lines.join('\n') + '\n');
    console.error(`\nStatus written to: ${opts.output}`);
    process.exit(2);
  }

  log('');
  log('## 5. Phone Numbers');
  log('');

  // For number listing, use same auth approach as account fetch
  const listAuth = auth.method === 'account+authtoken'
    ? { username: accountSid, password: auth.password }
    : auth;

  let numbers = [];
  try {
    numbers = await listIncomingNumbers(accountSid, listAuth);
    if (numbers.length === 0) {
      log('**No phone numbers owned.**');
      log('→ Purchase a voice-capable number at console.twilio.com to place calls.');
    } else {
      log(`Owned numbers (${numbers.length}):`);
      log('');
      for (const n of numbers) {
        const caps = [];
        if (n.capabilities?.voice) caps.push('voice');
        if (n.capabilities?.sms)   caps.push('sms');
        if (n.capabilities?.mms)   caps.push('mms');
        const voiceOk = n.capabilities?.voice ? '✓ voice' : '✗ no-voice';
        log(`- \`${n.phone_number}\`  friendly="${n.friendly_name}"  caps=[${caps.join(',')}]  ${voiceOk}`);
      }
    }
  } catch (e) {
    log(`Number list FAILED: ${e.message}`);
  }

  log('');
  log('## 6. Readiness Verdict');
  log('');

  const voiceNumbers = numbers.filter(n => n.capabilities?.voice);
  const toNumber = creds.operatorPhone;
  const fromNumber = creds.fromNumber || voiceNumbers[0]?.phone_number;

  const blockers = [];
  if (!toNumber) blockers.push('Operator phone NOT set — set TWILIO_OPERATOR_PHONE via env, Keychain, or 1Password (see SETUP.md)');
  if (!fromNumber) blockers.push('No voice-capable Twilio number — purchase one at console.twilio.com');
  if (account.status !== 'active') blockers.push(`Account status is "${account.status}" — needs to be "active"`);

  if (blockers.length === 0) {
    log('**READY TO CALL**');
    log('');
    log('## 7. Command to Place Live Conversational Call');
    log('');
    log('```sh');
    log('node tools/notify/twilio-call.js --converse --say "Mythos here. What would you like to do?"');
    log('```');
    log('');
    log('For a conversation loop with a response brain hosted on your own server:');
    log('```sh');
    log('# 1. Start webhook server on your own host:');
    log('# ssh <user>@<your-host> "cd ~/twilio-webhook && PORT=3100 node twilio-webhook-server.js"');
    log('');
    log('# 2. Place call pointing to your host:');
    log('node tools/notify/twilio-call.js --converse \\');
    log('  --say "Mythos here. What would you like to do?" \\');
    log('  --webhook-url https://<your-host>:3100/gather');
    log('```');
    log('');
    log('For announce-only (one-way):');
    log('```sh');
    log('node tools/notify/twilio-call.js --say "Hello from Mythos. This is a test call."');
    log('```');
  } else {
    log('**NOT READY** — blockers:');
    for (const b of blockers) log(`- ${b}`);
  }

  log('');
  log('---');
  log(`*Generated: ${new Date().toISOString()} by twilio-smoke.js*`);

  fs.writeFileSync(opts.output, lines.join('\n') + '\n');
  console.log(`\nStatus written to: ${opts.output}`);

  if (blockers.length > 0) process.exit(1);
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
