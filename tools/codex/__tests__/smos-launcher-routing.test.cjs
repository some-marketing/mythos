#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { executeAction } = require('../smos-launcher.js');
const { phrases } = require('../../commands/__tests__/route-fixtures.cjs');

const projectRoot = path.resolve(__dirname, '../../..');
const state = {
  session_id: 'route-test',
  booted_at: '2026-06-19T00:00:00Z',
  cwd: projectRoot
};

for (const fixture of phrases) {
  const execution = executeAction(projectRoot, state, 'command', {
    _: ['command'],
    command: `/route ${fixture.text}`
  });
  assert.equal(execution.result.exitCode, 0, fixture.text);
  const payload = JSON.parse(execution.result.stdout);
  assert.equal(payload.executed, false, fixture.text);
  assert.equal(payload.route.command, fixture.command, fixture.text);
  assert.equal(payload.route.target, fixture.target, fixture.text);
}

console.log('smos launcher route parity tests passed');
