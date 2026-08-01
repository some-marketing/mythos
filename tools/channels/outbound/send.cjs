#!/usr/bin/env node
'use strict';

/**
 * send.cjs — Read an APPROVED outbound draft and transmit it via Messages.app.
 *
 * Refuses to run if invoked from inside an AI session (env-var check).
 * Sends only drafts that:
 *   1. Live in the approved/ directory (i.e., operator-CLI moved them)
 *   2. Have body_sha256 matching their current body bytes (tamper check)
 *   3. Have not been previously sent (one-shot)
 *
 * On success: moves the draft to sent/ and appends an audit entry.
 * On send failure: leaves draft in approved/ for retry, appends a failure entry.
 *
 * Usage:
 *   node tools/channels/outbound/send.cjs --id <draft-id>
 *   node tools/channels/outbound/send.cjs --all          # send all approved drafts
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const cfg = require('./lib/config.cjs');
const audit = require('./lib/audit.cjs');

const AI_VARS = [
  'CLAUDE_SESSION', 'CLAUDE_CODE_SESSION', 'CLAUDE_AGENT',
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
  'CODEX_SESSION', 'OPENAI_AGENT', 'ANTHROPIC_AGENT'
];

function refuseIfAiSession() {
  for (const v of AI_VARS) {
    if (process.env[v]) {
      console.error(`REFUSED: AI session detected via env var '${v}'. send.cjs is operator-only.`);
      process.exit(2);
    }
  }
}

function parseArgs(argv) {
  const args = { id: null, all: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') args.id = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--help' || a === '-h') { console.log('Usage: send.cjs --id <draft-id> | --all'); process.exit(0); }
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

function sendViaMessages(handle, body) {
  // AppleScript to send via Messages.app on macOS.
  // The handle goes via "buddy" lookup against the iMessage service.
  const script = `
on run argv
  set targetHandle to item 1 of argv
  set msgBody to item 2 of argv
  tell application "Messages"
    set targetService to first service whose service type = iMessage
    set targetBuddy to buddy targetHandle of targetService
    send msgBody to targetBuddy
  end tell
end run
`;
  // Use osascript with stdin to keep body off the command line (privacy + special chars)
  execFileSync('/usr/bin/osascript', ['-e', script, handle, body], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000
  });
}

function sendOne(filePath) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Tamper check: body bytes must match recorded sha256
  const actualSha = crypto.createHash('sha256').update(draft.body).digest('hex');
  if (actualSha !== draft.body_sha256) {
    audit.append({ type: 'send-refused-tamper', draft_id: draft.id, expected: draft.body_sha256, actual: actualSha });
    throw new Error(`Tamper check failed for ${draft.id}: body sha256 mismatch.`);
  }

  if (draft.state !== 'approved') {
    throw new Error(`Draft ${draft.id} is not in 'approved' state (state=${draft.state}).`);
  }

  try {
    sendViaMessages(draft.recipient_handle, draft.body);
  } catch (err) {
    audit.append({ type: 'send-failed', draft_id: draft.id, error: err.message });
    throw err;
  }

  // Move to sent/, mark sent
  draft.state = 'sent';
  draft.sent_at = new Date().toISOString();
  const sentPath = path.join(cfg.SENT_DIR, `${draft.id}.json`);
  fs.mkdirSync(cfg.SENT_DIR, { recursive: true });
  fs.writeFileSync(sentPath, JSON.stringify(draft, null, 2));
  fs.unlinkSync(filePath);

  audit.append({ type: 'sent', draft_id: draft.id, recipient: draft.recipient_handle, body_sha256: draft.body_sha256 });
  return { id: draft.id, sent_path: sentPath };
}

function main() {
  refuseIfAiSession();
  const config = cfg.load();
  if (config.safety.ai_can_send !== false) throw new Error('Safety violation: ai_can_send is true.');

  const args = parseArgs(process.argv);
  const targets = [];
  if (args.id) targets.push(path.join(cfg.APPROVED_DIR, `${args.id}.json`));
  else if (args.all) {
    if (!fs.existsSync(cfg.APPROVED_DIR)) { console.log('No approved/ directory.'); return; }
    for (const f of fs.readdirSync(cfg.APPROVED_DIR)) {
      if (f.endsWith('.json')) targets.push(path.join(cfg.APPROVED_DIR, f));
    }
  } else {
    throw new Error('Specify --id <draft-id> or --all');
  }

  const results = [];
  for (const fp of targets) {
    if (!fs.existsSync(fp)) { console.error(`Skip: not found: ${fp}`); continue; }
    try {
      results.push(sendOne(fp));
      console.log(`Sent: ${path.basename(fp, '.json')}`);
    } catch (err) {
      console.error(`FAILED: ${path.basename(fp, '.json')}: ${err.message}`);
    }
  }
  console.log(JSON.stringify({ sent_count: results.length, sent: results }, null, 2));
}

main();
