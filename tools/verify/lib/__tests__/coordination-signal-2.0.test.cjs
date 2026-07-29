'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  createHandoffSignal,
  validateHandoffSignal,
  validateHandoffSignalV2
} = require(path.resolve(__dirname, '..', 'signal.cjs'));

const ISO = '2026-04-27T12:00:00.000Z';

function makeSignal(overrides = {}) {
  return {
    schema: 'HandoffSignal/2.0',
    signal_type: 'coordination-request',
    lifecycle_state: 'live',
    source: 'codex',
    scope: 'system-repair-and-dart-wiring__20260427',
    timestamp: ISO,
    target_addressees: {
      mode: 'snapshot',
      sessions: ['claude:session-a', 'codex:session-b'],
      resolved_at: ISO,
      source: 'active-session-registry'
    },
    acknowledgement_threshold: {
      mode: 'all'
    },
    acknowledgements: [],
    responses: [],
    ...overrides
  };
}

function validate(signal, opts = {}) {
  return validateHandoffSignal(signal, opts);
}

function assertValid(signal, opts = {}) {
  const result = validate(signal, opts);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.valid, true);
  return result;
}

function assertInvalid(signal, pattern, opts = {}) {
  const result = validate(signal, opts);
  assert.strictEqual(result.valid, false);
  assert.match(result.errors.join('\n'), pattern);
  return result;
}

test('valid 2.0 snapshot signal passes', () => {
  assertValid(makeSignal());
});

test('valid 2.0 broadcast snapshot passes with active-session-registry source', () => {
  assertValid(makeSignal({
    target_addressees: {
      mode: 'snapshot',
      source: 'active-session-registry',
      resolved_at: ISO,
      sessions: [
        'codex-cli:system-repair-and-dart-wiring__20260427:cluster-2',
        'claude-cli:system-repair-and-dart-wiring__20260427:cluster-3'
      ]
    }
  }));
});

test('reject missing target_addressees', () => {
  const signal = makeSignal();
  delete signal.target_addressees;

  assertInvalid(signal, /target_addressees/);
});

test('reject invalid lifecycle_state consumed and accept complete', () => {
  assertInvalid(makeSignal({ lifecycle_state: 'consumed' }), /lifecycle_state/);
  assertValid(makeSignal({ lifecycle_state: 'complete' }));
});

test('reject snapshot without sessions array', () => {
  assertInvalid(makeSignal({
    target_addressees: {
      mode: 'snapshot',
      resolved_at: ISO,
      source: 'active-session-registry'
    }
  }), /target_addressees\.sessions/);
});

test('reject acknowledgement entry missing action_taken', () => {
  assertInvalid(makeSignal({
    acknowledgements: [
      {
        actor_id: 'claude',
        session_id: 'claude:session-a',
        ts: ISO
      }
    ]
  }), /acknowledgements\[0\]\.action_taken/);
});

test('accept on_complete with allowlisted trigger_command', () => {
  assertValid(makeSignal({
    on_complete: {
      trigger_command: 'archive_to_closed'
    }
  }));
});

test('reject on_complete with non-allowlisted trigger_command', () => {
  assertInvalid(makeSignal({
    on_complete: {
      trigger_command: 'rm -rf /'
    }
  }), /allowlisted/);
});

test('on_timeout mode validation accepts operator-review and rejects unknown-mode', () => {
  assertValid(makeSignal({
    on_timeout: {
      mode: 'operator-review'
    }
  }));

  assertInvalid(makeSignal({
    on_timeout: {
      mode: 'unknown-mode'
    }
  }), /on_timeout\.mode/);
});

test('idempotency is not enforced at validator layer', () => {
  assertValid(makeSignal({
    acknowledgements: [
      {
        actor_id: 'claude',
        session_id: 'claude:session-a',
        ts: ISO,
        action_taken: 'noted'
      },
      {
        actor_id: 'claude',
        session_id: 'claude:session-b',
        ts: ISO,
        action_taken: 'responded'
      }
    ]
  }));
});

test('backward compat: 1.0 signal still validates against existing path', () => {
  const signal = createHandoffSignal('codex', 'scope:test', 'ready-for-clear', {
    validation: { ran: true, summary: 'ok' },
    recommended_next_actor: '',
    recommended_next_command: '',
    next_step_detail: []
  });

  assertValid(signal);
});

test('validateHandoffSignalV2 can be called directly', () => {
  const result = validateHandoffSignalV2(makeSignal({
    acknowledgement_threshold: {
      mode: 'at-least',
      count: 1
    }
  }));

  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.errors, []);
});
