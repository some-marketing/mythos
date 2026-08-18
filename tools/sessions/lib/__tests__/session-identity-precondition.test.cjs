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

// Codex review, PR #18: new-session previously enforced authoritative
// identity as a blanket precondition before step 0, hard-failing (exit 2)
// the ENTIRE session-open cascade for any registry-only harness (best_effort
// identity, no process-scoped env var) or an unresolvable identity (none).
// That contradicts the authoritative step-0 contract in
// instructions/canonical/commands/new-session.yaml: "An unresolvable session
// id is a clean no-op (exit 0, reported) because an unrecorded daemon could
// never be identity-verified later." Identity grading now applies only at
// the point of actual custody-grade use (the _current-id grounding write),
// not as a session-wide gate — step 0 (and the rest of the cascade) must
// still run without an authoritative identity.
test('new-session does not block step 0 (or the rest of the cascade) without authoritative identity', () => {
  withoutAuthoritativeIdentity(() => {
    let spawnCalls = 0;
    const spawn = () => {
      spawnCalls += 1;
      return { status: 0, stdout: '{}', stderr: '' };
    };
    const result = newSession(path.resolve(__dirname, '../../../..'), '', { spawn });
    assert.ok(spawnCalls > 0, 'expected step 0 to actually dispatch instead of being blocked before it runs');
    assert.notEqual(result.exitCode, 2);
    assert.doesNotMatch(result.stderr || '', /SESSION_IDENTITY_BLOCKED/);
  });
});

test('run-plan identity gate blocks without authoritative identity', () => {
  withoutAuthoritativeIdentity(() => {
    const result = enforceSessionIdentityGate(path.resolve(__dirname, '../../../..'), 'task/example');
    assert.equal(result.exitCode, 2);
    assert.match(result.stdout, /session-identity-(none|best_effort)/);
  });
});
