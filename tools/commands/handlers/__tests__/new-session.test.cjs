'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { defaultCommands } = require('../new-session.cjs');

const ROOT = path.resolve(__dirname, '../../../..');

test('new-session step 4 invokes the existing mythos status executable', () => {
  const commands = defaultCommands(ROOT);
  const statusCommand = commands['4-status'];
  assert.deepEqual(statusCommand.slice(0, 2), [process.execPath, path.join('tools', 'status', 'mythos-status.js')]);
  assert.equal(statusCommand[2], '--json');
  assert.equal(fs.existsSync(path.join(ROOT, statusCommand[1])), true);
});
