#!/usr/bin/env node
'use strict';

/**
 * twilio-call.js — Place or announce calls via Twilio REST API.
 *
 * SECURITY: Credentials are resolved at runtime via tools/lib/resolve-credential.cjs
 * (env / macOS Keychain / 1Password / env-file). Operator phone number is NEVER
 * hardcoded in this file. Zero secrets in argv.
 *
 * Usage:
 *
 *   # Credential smoke test (no call placed):
 *   node tools/notify/twilio-call.js --smoke
 *
 *   # Announce call: calls operator, speaks text, hangs up
 *   node tools/notify/twilio-call.js --say "Hello, this is Mythos."
 *
 *   # Announce to specific number:
 *   node tools/notify/twilio-call.js --to +15551234567 --say "Hello."
 *
 *   # Conversational call: <Gather speech> loop via inline TwiML
 *   node tools/notify/twilio-call.js --converse --say "Mythos here. What would you like to do?"
 *
 *   # Conversational with external webhook (your own server or Twilio Function URL):
 *   node tools/notify/twilio-call.js --converse --webhook-url https://your-server/twilio-gather
 *
 * Environment overrides (all optional — see SETUP.md for the full resolution chain):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_API_KEY_SID       (alternative auth, SK... prefix)
 *   TWILIO_API_KEY_SECRET
 *   TWILIO_FROM_NUMBER       (your Twilio phone number, E.164)
 *   TWILIO_OPERATOR_PHONE    (operator's personal number, E.164)
 *
 * Multi-provider interface: this tool is the `twilio` provider for the
 * generic `notify call` surface. Other providers (e.g., vonage, bandwidth)
 * would implement the same CLI flags.
 */

const { resolveCreds, buildAuth } = require('./twilio-creds');
const { discoverAccountSid, listIncomingNumbers, getAccount, createCall } = require('./twilio-api');

// ─── TwiML builders ───────────────────────────────────────────────────────────

/**
 * Simple announce TwiML: speak text and hang up.
 */
function announceTwiml(text) {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${safe}</Say></Response>`;
}

/**
 * Conversational TwiML: Gather speech input, then redirect to a webhook.
 * If webhookUrl is not provided, uses a simple self-contained gather that
 * reads the input back and hangs up (useful as a test or one-shot confirm).
 *
 * For a REAL conversation loop, use --webhook-url pointing to:
 *   - A Twilio Serverless Function (tools/notify/twilio-function-handler.js)
 *   - Or the Express webhook server (tools/notify/twilio-webhook-server.js)
 */
function converseTwiml(openingText, webhookUrl) {
  const safe = openingText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (webhookUrl) {
    // Gather with action pointing to external handler
    const repromptUrl = webhookUrl.replace(/\/gather\b.*$/, '/reprompt?n=1');
    return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
      `<Gather input="speech" speechTimeout="auto" timeout="8" action="${webhookUrl}" method="POST">` +
      `<Say voice="alice">${safe}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">${repromptUrl}</Redirect>` +
      `</Response>`;
  } else {
    // Inline gather — reads back whatever was heard, then hangs up.
    // This is a smoke-level test of the speech path. For a real loop,
    // provide --webhook-url.
    return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
      `<Gather input="speech" speechTimeout="auto">` +
      `<Say voice="alice">${safe}</Say>` +
      `</Gather>` +
      `<Say voice="alice">No input received. Ending call.</Say>` +
      `</Response>`;
  }
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    smoke: false,
    converse: false,
    say: null,
    to: null,       // override operator phone
    webhookUrl: null,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--smoke':     opts.smoke = true;        break;
      case '--converse':  opts.converse = true;     break;
      case '--verbose':   opts.verbose = true;      break;
      case '--say':       opts.say = args[++i];     break;
      case '--to':        opts.to = args[++i];      break;
      case '--webhook-url': opts.webhookUrl = args[++i]; break;
      default:
        if (!args[i].startsWith('--')) {
          // positional: treat as --say text
          opts.say = args[i];
        } else {
          console.error(`Unknown flag: ${args[i]}`);
          process.exit(1);
        }
    }
  }
  return opts;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!opts.smoke && !opts.say) {
    console.error('Usage: twilio-call.js --smoke | --say "<text>" [--converse] [--to +E164] [--webhook-url <url>]');
    process.exit(1);
  }

  // 1. Resolve credentials
  const creds = resolveCreds();
  const auth  = buildAuth(creds);

  if (!auth) {
    console.error('ERROR: No usable Twilio credentials found.');
    console.error('Need one of:');
    console.error('  - Account SID + Auth Token');
    console.error('  - Account SID + API Key SID + API Key Secret');
    console.error('  - API Key SID + API Key Secret (Account SID will be discovered)');
    console.error('See SETUP.md for how to seed these via env, Keychain, or 1Password.');
    process.exit(2);
  }

  if (opts.verbose) {
    console.log(`[twilio-call] Auth method: ${auth.method}`);
    console.log(`[twilio-call] Account SID known: ${auth.accountSid ? 'yes' : 'no (will discover)'}`);
    console.log(`[twilio-call] From number in creds: ${creds.fromNumber ? 'yes' : 'no'}`);
    console.log(`[twilio-call] Operator phone in creds: ${creds.operatorPhone ? 'yes' : 'no'}`);
  }

  // 2. Discover Account SID if needed
  let accountSid = auth.accountSid;
  if (!accountSid) {
    if (opts.verbose) console.log('[twilio-call] Discovering Account SID via /Accounts.json ...');
    try {
      accountSid = await discoverAccountSid(auth);
      if (opts.verbose) console.log('[twilio-call] Account SID discovered OK');
    } catch (e) {
      console.error(`ERROR: Could not discover Account SID: ${e.message}`);
      process.exit(2);
    }
  }

  // 3. Smoke mode: validate creds + list numbers, no call
  if (opts.smoke) {
    console.log('--- Twilio Smoke Test ---');

    // Account status
    let account;
    try {
      account = await getAccount(accountSid, auth);
      console.log(`Account SID:    ${account.sid}`);
      console.log(`Account name:   ${account.friendly_name}`);
      console.log(`Account status: ${account.status}`);
      console.log(`Balance:        ${account.balance} ${account.currency || ''}`);
    } catch (e) {
      console.error(`Account fetch FAILED: ${e.message}`);
      if (e.statusCode === 401) console.error('  → Auth credentials rejected by Twilio');
      process.exit(2);
    }

    // Owned numbers
    let numbers;
    try {
      numbers = await listIncomingNumbers(accountSid, auth);
      if (numbers.length === 0) {
        console.log('Phone numbers:  NONE owned');
      } else {
        console.log(`Phone numbers (${numbers.length}):`);
        numbers.forEach(n => {
          const caps = [];
          if (n.capabilities?.voice) caps.push('voice');
          if (n.capabilities?.sms)   caps.push('sms');
          if (n.capabilities?.mms)   caps.push('mms');
          console.log(`  ${n.phone_number}  friendly="${n.friendly_name}"  caps=[${caps.join(',')}]`);
        });
      }
    } catch (e) {
      console.error(`Number list FAILED: ${e.message}`);
    }

    // Operator phone presence
    const toNumber = opts.to || creds.operatorPhone;
    console.log(`Operator phone: ${toNumber ? 'configured' : 'NOT SET (required for calls)'}`);
    if (!toNumber) {
      console.log('  → Set TWILIO_OPERATOR_PHONE (env, Keychain, or 1Password field) — see SETUP.md');
    }

    const fromNumber = creds.fromNumber || (numbers && numbers.find(n => n.capabilities?.voice)?.phone_number);
    console.log(`From number:    ${fromNumber ? 'configured' : 'NOT SET (required for calls)'}`);

    console.log('--- Smoke PASSED ---');
    return;
  }

  // 4. Determine from/to numbers
  const toNumber = opts.to || creds.operatorPhone;
  if (!toNumber) {
    console.error('ERROR: No destination number. Use --to +E164 or set TWILIO_OPERATOR_PHONE — see SETUP.md.');
    process.exit(2);
  }

  // Discover a voice-capable from-number if not set in creds
  let fromNumber = creds.fromNumber;
  if (!fromNumber) {
    if (opts.verbose) console.log('[twilio-call] fromNumber not in creds, looking up owned numbers...');
    const numbers = await listIncomingNumbers(accountSid, auth);
    const voiceNum = numbers.find(n => n.capabilities?.voice);
    if (!voiceNum) {
      console.error('ERROR: No voice-capable Twilio number found on this account. Purchase one at console.twilio.com.');
      process.exit(2);
    }
    fromNumber = voiceNum.phone_number;
    if (opts.verbose) console.log(`[twilio-call] Using first voice-capable number as From`);
  }

  // 5. Build TwiML
  const text = opts.say || 'Hello from Mythos.';
  let twiml;
  if (opts.converse) {
    twiml = converseTwiml(text, opts.webhookUrl || null);
    if (opts.verbose && !opts.webhookUrl) {
      console.log('[twilio-call] --converse without --webhook-url: single-gather inline TwiML (operator can speak but response is not looped back to the assistant)');
      console.log('[twilio-call] For a real loop: start twilio-webhook-server.js or deploy a Twilio Serverless Function');
    }
  } else {
    twiml = announceTwiml(text);
  }

  // 6. Place call
  if (opts.verbose) {
    console.log(`[twilio-call] Calling ${toNumber} from ${fromNumber}`);
    console.log(`[twilio-call] Mode: ${opts.converse ? 'converse' : 'announce'}`);
  }

  let call;
  try {
    // Build auth for call creation — Twilio requires Account SID as username
    // when using auth token; or API Key SID when using API Key auth.
    const callAuth = {
      username: auth.method === 'account+authtoken' ? accountSid : auth.username,
      password: auth.password,
    };
    call = await createCall(
      { To: toNumber, From: fromNumber, Twiml: twiml },
      accountSid,
      callAuth
    );
  } catch (e) {
    console.error(`ERROR placing call: ${e.message}`);
    if (e.twilioCode) console.error(`  Twilio error code: ${e.twilioCode}  ${e.twilioMore || ''}`);
    process.exit(2);
  }

  console.log(`Call initiated: SID=${call.sid} status=${call.status}`);
  console.log(`  To:   ${call.to}`);
  console.log(`  From: ${call.from}`);
  if (opts.converse && opts.webhookUrl) {
    console.log(`  Webhook: ${opts.webhookUrl}`);
  }
}

main().catch(e => {
  console.error(`Unhandled error: ${e.message}`);
  process.exit(1);
});
