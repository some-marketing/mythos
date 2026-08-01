#!/usr/bin/env node
'use strict';

/**
 * draft.cjs — Write an outbound iMessage DRAFT for operator approval.
 *
 * This tool is AI-callable. It cannot send or approve; it only deposits a
 * proposed message into the drafts directory. Operator approval (via
 * tools/channels/outbound/cli.sh, terminal-typed) is required before send.
 *
 * Usage:
 *   node tools/channels/outbound/draft.cjs --to "+19024019627" --reason "<why>" --body "<text>"
 *   echo "<text>" | node tools/channels/outbound/draft.cjs --to "+19024019627" --reason "<why>" --body-stdin
 *
 * Body is locked at draft time. Operator may reject and ask for a revised draft;
 * editing is not supported in-place because the body must equal what was approved.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = require('./lib/config.cjs');
const audit = require('./lib/audit.cjs');

function parseArgs(argv) {
  const args = { to: null, reason: null, body: null, bodyStdin: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') args.to = argv[++i];
    else if (a === '--reason') args.reason = argv[++i];
    else if (a === '--body') args.body = argv[++i];
    else if (a === '--body-stdin') args.bodyStdin = true;
    else if (a === '--help' || a === '-h') { help(); process.exit(0); }
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

function help() {
  console.log(`Draft an outbound iMessage. Operator must approve before send.

Usage:
  draft.cjs --to <handle> --reason <why> --body <text>
  draft.cjs --to <handle> --reason <why> --body-stdin   # body from stdin
`);
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const config = cfg.load();

  if (!args.to) throw new Error('--to is required');
  if (!args.reason) throw new Error('--reason is required (one-line why this draft exists)');

  const body = args.bodyStdin ? readStdin() : args.body;
  if (!body || !body.trim()) throw new Error('Body is empty');

  if (!cfg.isAllowedRecipient(config, args.to)) {
    audit.append({ type: 'draft-refused', recipient: args.to, reason: 'not-on-allowlist' });
    throw new Error(`Recipient ${args.to} is not on outbound allowlist. Operator must add via outbound-imessage.json (no AI mutation allowed).`);
  }

  const ttlMin = config.safety.draft_ttl_minutes || 60;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMin * 60_000);

  const draft = {
    schema: 'OutboundDraft/1.0',
    id: crypto.randomUUID(),
    recipient_handle: args.to,
    body: body,
    body_sha256: crypto.createHash('sha256').update(body).digest('hex'),
    draft_reason: args.reason,
    drafted_by: 'ai',
    drafted_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    state: 'pending-approval'
  };

  fs.mkdirSync(cfg.DRAFTS_DIR, { recursive: true });
  const draftPath = path.join(cfg.DRAFTS_DIR, `${draft.id}.json`);
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));

  audit.append({
    type: 'draft-created',
    draft_id: draft.id,
    recipient: args.to,
    body_sha256: draft.body_sha256,
    expires_at: draft.expires_at,
    reason: args.reason
  });

  console.log(JSON.stringify({
    ok: true,
    draft_id: draft.id,
    draft_path: draftPath,
    expires_at: draft.expires_at,
    operator_action: `Approve with: tools/channels/outbound/cli.sh approve ${draft.id}`
  }, null, 2));
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
