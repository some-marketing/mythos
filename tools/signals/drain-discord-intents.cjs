#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../workspace/lib/args');
const { stampAcknowledgement } = require('./lib/signal-lifecycle.js');
const { closeSignalFile, configureProjectRoot } = require('./close-signal.js');

function projectRoot(args = {}) {
  return path.resolve(args.project_root || process.env.MYTHOS_PROJECT_ROOT || path.join(__dirname, '..', '..'));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function listDiscordIntents(root) {
  const dir = path.join(root, '_dev', 'reports', 'signals');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^discord-intent__.*\.signal\.json$/.test(entry.name))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const signal = readJson(filePath);
      const stat = fs.statSync(filePath);
      return { name: entry.name, filePath, relPath: path.relative(root, filePath), signal, size: stat.size };
    })
    .filter((entry) => entry.signal && entry.signal.schema === 'HandoffSignal/2.0' && entry.signal.lifecycle_state === 'live')
    .sort((a, b) => {
      const aTs = Date.parse(a.signal.context && a.signal.context.received_at || a.signal.timestamp || '') || 0;
      const bTs = Date.parse(b.signal.context && b.signal.context.received_at || b.signal.timestamp || '') || 0;
      return aTs - bTs;
    });
}

function printIntent(info) {
  const ctx = info.signal.context || {};
  console.log(`- ${info.name}`);
  console.log(`  chat_id: ${ctx.chat_id || '-'}`);
  console.log(`  message_id: ${ctx.message_id || '-'}`);
  console.log(`  received_at: ${ctx.received_at || info.signal.timestamp || '-'}`);
  console.log(`  raw_message: ${ctx.raw_message || ''}`);
}

function ackAndClose(info, sessionId, root) {
  // close-signal.js resolves CLOSED_DIR from module state — point it at this
  // root before closing, or library callers close into the wrong repo.
  configureProjectRoot(root);
  const updated = stampAcknowledgement(info.signal, {
    actor_id: 'discord-intent-drain',
    session_id: sessionId,
    action_taken: 'responded',
    ts: new Date().toISOString()
  });
  fs.writeFileSync(info.filePath, JSON.stringify(updated, null, 2));
  const refreshed = { ...info, signal: updated, size: fs.statSync(info.filePath).size };
  return closeSignalFile(refreshed, false, false, { reason: 'consumed', scopeMatch: 'discord-intent' });
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log([
      'Usage: node tools/signals/drain-discord-intents.cjs [--ack <session-id>] [--project-root <path>]',
      '',
      'Lists live discord-intent signals oldest-first.',
      'With --ack, stamps an acknowledgement for the session and closes each signal as consumed.',
      '',
      'Hook point: run from SessionStart and after long live-session gaps so Discord',
      'operator messages queued by the sentinel are surfaced inside the live session.'
    ].join('\n'));
    return 0;
  }

  const root = projectRoot(args);
  configureProjectRoot(root);
  const intents = listDiscordIntents(root);
  if (intents.length === 0) {
    console.log('No live discord-intent signals.');
    return 0;
  }

  console.log(`Live discord-intent signals: ${intents.length}`);
  for (const info of intents) printIntent(info);

  if (!args.ack) {
    console.log('\nUse --ack <session-id> to acknowledge and close these signals.');
    return 0;
  }

  let closed = 0;
  for (const info of intents) {
    if (ackAndClose(info, String(args.ack), root)) closed++;
  }
  console.log(`\nAcknowledged and closed ${closed}/${intents.length} discord-intent signal(s).`);
  return closed === intents.length ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { listDiscordIntents, ackAndClose };
