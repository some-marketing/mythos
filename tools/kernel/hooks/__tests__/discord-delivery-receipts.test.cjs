#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractDiscordChannelReceipts,
  writeDiscordDeliveryReceipts
} = require('../dispatch-userprompt.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-receipts-'));

const prompt = '<channel source="discord" chat_id="c123" message_id="m456">hello</channel>';
assert.deepStrictEqual(extractDiscordChannelReceipts(prompt), [{ chat_id: 'c123', message_id: 'm456' }]);

const written = writeDiscordDeliveryReceipts({
  session_id: 's789',
  prompt
}, { projectRoot: tmp, now: '2026-06-12T00:00:00.000Z' });

assert.strictEqual(written.length, 1);
const receipt = JSON.parse(fs.readFileSync(written[0], 'utf8'));
assert.deepStrictEqual(receipt, {
  message_id: 'm456',
  chat_id: 'c123',
  session_id: 's789',
  received_at: '2026-06-12T00:00:00.000Z'
});

fs.mkdirSync(path.join(tmp, '_dev', 'state', 'discord-delivery-receipts'), { recursive: true });
fs.writeFileSync(path.join(tmp, '_dev', 'state', 'discord-delivery-receipts', 'disabled'), '');
assert.deepStrictEqual(writeDiscordDeliveryReceipts({ session_id: 's', prompt }, { projectRoot: tmp }), []);

console.log('discord delivery receipts: passed');
