#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listDiscordIntents, ackAndClose } = require('../drain-discord-intents.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-drain-'));
const signalDir = path.join(root, '_dev', 'reports', 'signals');
fs.mkdirSync(signalDir, { recursive: true });

const file = path.join(signalDir, 'discord-intent__chat__2026.signal.json');
fs.writeFileSync(file, JSON.stringify({
  schema: 'HandoffSignal/2.0',
  signal_type: 'coordination-request',
  lifecycle_state: 'live',
  source: 'discord-sentinel',
  scope: 'discord-intent/chat',
  timestamp: '2026-06-12T00:00:00.000Z',
  target_addressees: { mode: 'broadcast' },
  acknowledgement_threshold: { mode: 'at-least', count: 1 },
  acknowledgements: [],
  responses: [],
  context: {
    chat_id: 'chat',
    message_id: 'msg',
    raw_message: 'do thing',
    received_at: '2026-06-12T00:00:00.000Z'
  }
}, null, 2));

const intents = listDiscordIntents(root);
assert.strictEqual(intents.length, 1);
assert.strictEqual(intents[0].signal.context.message_id, 'msg');

assert.strictEqual(ackAndClose(intents[0], 'sess', root), true);
assert.strictEqual(fs.existsSync(file), false);

const closed = path.join(signalDir, 'closed', path.basename(file));
assert.strictEqual(fs.existsSync(closed), true);
const closedSignal = JSON.parse(fs.readFileSync(closed, 'utf8'));
assert.strictEqual(closedSignal.lifecycle_state, 'closed');
assert.strictEqual(closedSignal.closed_reason, 'consumed');
assert.strictEqual(closedSignal.acknowledgements[0].session_id, 'sess');

console.log('drain-discord-intents: passed');
