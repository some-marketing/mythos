'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertAuthoritativeSessionIdentity } = require('../resolve-session-id.cjs');
const { newSession } = require('../../../commands/handlers/new-session.cjs');
const { enforceSessionIdentityGate } = require('../../../codex/commands/run-plan.js');

const identityNames = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'SM_OS_SESSION_ID', 'CODEX_SESSION_ID', 'MYTHOS_SESSION_ID'];

function withoutAuthoritativeIdentity(fn) {
  const previous = Object.fromEntries(identityNames.map(name => [name, process.env[name]]));
  for (const name of identityNames) delete process.env[name];
  try { return fn(); } finally {
    for (const name of identityNames) {
      if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
}

test('authoritative process identity is accepted', () => {
  const original = process.env.MYTHOS_SESSION_ID;
  process.env.MYTHOS_SESSION_ID = 'test-authoritative-session';
  try {
    const result = assertAuthoritativeSessionIdentity(path.resolve(__dirname, '../../../..'), 'test');
    assert.equal(result.custody_grade, 'authoritative');
  } finally {
    if (original == null) delete process.env.MYTHOS_SESSION_ID; else process.env.MYTHOS_SESSION_ID = original;
  }
});

test('new-session blocks before spawning step 0 without authoritative identity', () => {
  withoutAuthoritativeIdentity(() => {
    const result = newSession(path.resolve(__dirname, '../../../..'), '', { spawn: () => { throw new Error('must not spawn'); } });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /SESSION_IDENTITY_BLOCKED/);
  });
});

test('run-plan identity gate blocks without authoritative identity', () => {
  withoutAuthoritativeIdentity(() => {
    const result = enforceSessionIdentityGate(path.resolve(__dirname, '../../../..'), 'task/example');
    assert.equal(result.exitCode, 2);
    assert.match(result.stdout, /session-identity-(none|best_effort)/);
  });
});
