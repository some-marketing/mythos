#!/usr/bin/env node
'use strict';

const { finish, readPayload } = require('./lib/compat-dispatch.cjs');
const fs = require('fs');
const path = require('path');

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.MYTHOS_PROJECT_ROOT || process.cwd();
}

function receiptDir(root = projectRoot()) {
  return path.join(root, '_dev', 'state', 'discord-delivery-receipts');
}

function isReceiptDisabled(root = projectRoot()) {
  return fs.existsSync(path.join(receiptDir(root), 'disabled'));
}

function extractDiscordChannelReceipts(prompt) {
  const text = String(prompt || '');
  const out = [];
  const blockRe = /<channel\b([^>]*)\bsource=(["'])discord\2([^>]*)>/gi;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const attrs = `${match[1] || ''} ${match[3] || ''}`;
    const chatId = attr(attrs, 'chat_id');
    const messageId = attr(attrs, 'message_id');
    if (messageId) out.push({ chat_id: chatId || '', message_id: messageId });
  }
  return out;
}

function attr(text, name) {
  const re = new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'i');
  const match = re.exec(String(text || ''));
  return match ? match[2] : '';
}

// S1c delivery receipt (realtime-inbound-bridge): an operator Discord DM that
// reaches a live session leaves a receipt the sentinel can check; capture
// without a receipt triggers the deaf-cell failure notice. Fail-silent —
// must never block the prompt. Kill-switch: receiptDir()/disabled.
function writeDiscordDeliveryReceipts(payload, opts = {}) {
  try {
    const root = opts.projectRoot || projectRoot();
    if (isReceiptDisabled(root)) return [];
    const prompt = String(payload && payload.prompt || '');
    const sessionId = String(payload && payload.session_id || '');
    const receipts = extractDiscordChannelReceipts(prompt);
    if (receipts.length === 0) return [];

    const dir = receiptDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const written = [];
    const receivedAt = opts.now || new Date().toISOString();
    for (const receipt of receipts) {
      const body = {
        message_id: receipt.message_id,
        chat_id: receipt.chat_id,
        session_id: sessionId,
        received_at: receivedAt
      };
      const file = path.join(dir, `${safeName(receipt.message_id)}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(body, null, 2));
      fs.renameSync(`${file}.tmp`, file);
      written.push(file);
    }
    return written;
  } catch {
    return [];
  }
}

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '_');
}

// Override-log safeguard for the SessionStart behavioral-contract emitter: when
// the operator overrides a surfaced lesson in-session, append a lesson-revision
// candidate to the down-rung revisions ledger. Fail-silent; never blocks.
function logContractOverrides(payload) {
  try {
    require('./session-start-contract-emitter.cjs').logOverrideCandidates(payload);
  } catch {
    /* fail-silent: override logging must never block a prompt */
  }
}

function main() {
  const payload = readPayload();
  writeDiscordDeliveryReceipts(payload);
  logContractOverrides(payload);
  require('../../transcripts/snapshot-current-session.cjs').snapshotCurrentSession(payload);
  // Lazy tier re-stamp: SessionStart fires before a fresh session's transcript
  // exists, so its stamp can land model:unknown → scaffold (inert frontier
  // shedding). By first prompt the transcript answers; must run BEFORE the
  // ambient router consults the tier.
  require('./session-start-tier-stamp.cjs').ensureSessionTier(payload);
  const ambientNotice = require('./userpromptsubmit-ambient-router.cjs').noticeForPayload(payload);
  if (ambientNotice) process.stdout.write(ambientNotice + '\n');
  // tier-s2b-injection-consumers: owl-altitude framing, add-gated via the
  // ProcessTierRule/1.1 add_registry (owl-altitude-injection). Inert for
  // sessions not carrying the add; per-add operator kill-switch honored.
  const owlNotice = require('./userprompt-owl-altitude.cjs').noticeForPayload(payload);
  if (owlNotice) process.stdout.write(owlNotice + '\n');

  const planGate = require('./userprompt-plan-review-gate.cjs');
  const prompt = String(payload.prompt || '');
  if (planGate.parsePrompt(prompt).matched) {
    const result = planGate.evaluateGate(prompt, process.env.CLAUDE_PROJECT_DIR || process.cwd(), payload.session_id || null);
    if (result.action === 'inject' && result.text) process.stdout.write(result.text + '\n');
  }
  finish(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  extractDiscordChannelReceipts,
  writeDiscordDeliveryReceipts,
  receiptDir,
  isReceiptDisabled
};
