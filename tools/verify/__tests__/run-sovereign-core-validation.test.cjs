'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COMMANDS } = require('../run-sovereign-core-validation.cjs');

test('final validation plan covers every in-scope phase and excludes P6/P7 and Broker phase 4', () => {
  const ids = COMMANDS.map((command) => command.id);
  for (const expected of ['p0-cascade-span-and-tombstone', 'p1-sovereign-hook-self-test-contract', 'p2-p3-tool-broker', 'p4-outer-enforcement', 'p4-fork-focused', 'p4-fork-build', 'p5-hardening-gradient', 'p5-protocol-parity', 'instructions-parity']) assert.ok(ids.includes(expected));
  const commandText = JSON.stringify(COMMANDS);
  assert.doesNotMatch(commandText, /P6|P7|phase.?4|autonomous/i);
});
