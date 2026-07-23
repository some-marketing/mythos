'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  emit,
  isValidLifecycleEvent,
  CODEX_LIFECYCLE_EVENTS,
  buildCodexSessionStartPayload,
  resolveCodexSessionId,
  resolveCodexSessionModel,
  runCodexHook,
  codexLifecycleLogPathFor,
  coordinationDispatcherPathFor
} = require('../hook-emulation');

const SESSION_CONTEXT_ENV_KEYS = [
  'CODEX_MODEL',
  'OPENAI_MODEL',
  'MYTHOS_MODEL',
  'MYTHOS_SESSION_ID',
  'CODEX_SESSION_ID',
  'MYTHOS_PROCESS_TIER'
];

function withCleanSessionEnv(fn) {
  const saved = {};
  for (const key of SESSION_CONTEXT_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of SESSION_CONTEXT_ENV_KEYS) {
      if (typeof saved[key] === 'string') {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  }
}

function tmpProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-codex-emit-'));
  // Mirror enough of the repo layout that emit() can write its lifecycle log.
  fs.mkdirSync(path.join(root, '_dev', 'reports', 'lifecycle'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'sessions', 'hooks'), { recursive: true });
  return root;
}

function readLifecycleLines(projectRoot) {
  const logPath = codexLifecycleLogPathFor(projectRoot);
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('CODEX_LIFECYCLE_EVENTS lists the Layer 3 events', () => {
  assert.deepEqual(
    [...CODEX_LIFECYCLE_EVENTS].sort(),
    ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'SubagentStop', 'UserPromptSubmit']
  );
});

test('isValidLifecycleEvent rejects unknown event names', () => {
  assert.equal(isValidLifecycleEvent('SessionStart'), true);
  assert.equal(isValidLifecycleEvent('Stop'), false);
  assert.equal(isValidLifecycleEvent(''), false);
  assert.equal(isValidLifecycleEvent(null), false);
});

// tier-s0a (tier-enforcement-implementation slice 0, convene 20260611T130035Z
// condition 2): the SessionStart payload must carry genuine model identity so
// session-start-tier-stamp.cjs resolves a real tier with provenance instead
// of stamping fallback scaffold from an empty payload.
test('buildCodexSessionStartPayload prefers explicit options over env', () => {
  withCleanSessionEnv(() => {
    process.env.CODEX_MODEL = 'env-model';
    process.env.MYTHOS_SESSION_ID = 'env-session';
    const payload = buildCodexSessionStartPayload({
      model: 'gpt-5.5-codex',
      sessionId: 'explicit-session',
      processTier: 'sentinel'
    });
    assert.deepEqual(payload, {
      session_id: 'explicit-session',
      model: 'gpt-5.5-codex',
      process_tier: 'sentinel'
    });
  });
});

test('buildCodexSessionStartPayload resolves model and session id from the codex runtime env', () => {
  withCleanSessionEnv(() => {
    process.env.CODEX_MODEL = 'gpt-5.5-codex';
    process.env.MYTHOS_SESSION_ID = 'codex-env-session';
    const payload = buildCodexSessionStartPayload();
    assert.equal(payload.model, 'gpt-5.5-codex');
    assert.equal(payload.session_id, 'codex-env-session');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'process_tier'), false);
  });
});

test('buildCodexSessionStartPayload omits model when identity is unresolvable (never fabricates)', () => {
  withCleanSessionEnv(() => {
    const payload = buildCodexSessionStartPayload();
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'model'), false);
    assert.match(payload.session_id, /^codex-hook-emulation:\d+:\d+$/);
  });
});

test('resolveCodexSessionModel and resolveCodexSessionId honor the documented precedence', () => {
  withCleanSessionEnv(() => {
    assert.equal(resolveCodexSessionModel(''), '');
    process.env.MYTHOS_MODEL = 'mythos-model';
    assert.equal(resolveCodexSessionModel(''), 'mythos-model');
    process.env.OPENAI_MODEL = 'openai-model';
    assert.equal(resolveCodexSessionModel(''), 'openai-model');
    process.env.CODEX_MODEL = 'codex-model';
    assert.equal(resolveCodexSessionModel(''), 'codex-model');
    assert.equal(resolveCodexSessionModel('explicit'), 'explicit');

    process.env.CODEX_SESSION_ID = 'codex-session';
    assert.equal(resolveCodexSessionId(''), 'codex-session');
    process.env.MYTHOS_SESSION_ID = 'mythos-session';
    assert.equal(resolveCodexSessionId(''), 'mythos-session');
    assert.equal(resolveCodexSessionId('explicit-session'), 'explicit-session');
  });
});

test('runCodexHook userprompt-submit runs configured UserPromptSubmit command hooks', () => {
  const projectRoot = tmpProjectRoot();
  const hookPath = path.join(projectRoot, 'probe-userprompt-hook.cjs');
  fs.writeFileSync(hookPath, [
    "const fs = require('fs');",
    "const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');",
    "process.stdout.write('prompt=' + payload.prompt);"
  ].join('\n'), 'utf8');
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: `node ${JSON.stringify(hookPath)}`
            }
          ]
        }
      ]
    }
  }), 'utf8');

  const result = runCodexHook({
    event: 'userprompt-submit',
    command: '/run-plan harness-protocol-parity',
    projectRoot
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /prompt=\/run-plan harness-protocol-parity/);
});

test('runCodexHook accepts canonical SessionStart and SessionEnd event names', () => {
  const projectRoot = tmpProjectRoot();
  fs.mkdirSync(path.join(projectRoot, 'tools', 'boot'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'tools', 'boot', 'verify-credentials.cjs'), 'process.exit(0);\n', 'utf8');
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
    hooks: {
      SessionEnd: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node -e "process.stdout.write(\'session-end-ok\')"'
            }
          ]
        }
      ]
    }
  }), 'utf8');

  const start = runCodexHook({ event: 'SessionStart', projectRoot });
  assert.equal(start.exitCode, 0);

  const end = runCodexHook({ event: 'SessionEnd', projectRoot });
  assert.equal(end.exitCode, 0);
  assert.match(end.stdout, /session-end-ok/);
});

test('emit invokes the dispatcher with MYTHOS_HOOK_EVENT and compound actor_id', () => {
  const projectRoot = tmpProjectRoot();
  const dispatcherPath = coordinationDispatcherPathFor(projectRoot);
  // Touch the dispatcher path so emit() does not short-circuit on existence check.
  fs.writeFileSync(dispatcherPath, '// stub\n', 'utf8');

  const calls = [];
  const stubRunner = (scriptPath, opts) => {
    calls.push({ scriptPath, env: opts.env });
    return { stdout: '', stderr: '', exitCode: 0 };
  };

  const result = emit(
    'SessionStart',
    { sessionId: 'codex-managed-abc', actorId: 'codex-managed:cluster-c', cwd: projectRoot },
    { projectRoot, runner: stubRunner }
  );

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.dispatcherExists, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scriptPath, dispatcherPath);
  assert.equal(calls[0].env.MYTHOS_HOOK_EVENT, 'SessionStart');
  assert.equal(calls[0].env.MYTHOS_HOOK_SOURCE, 'codex-managed-runtime');
  assert.equal(calls[0].env.MYTHOS_HOOK_SESSION_ID, 'codex-managed-abc');
  assert.equal(calls[0].env.MYTHOS_HOOK_ACTOR_ID, 'codex-managed:cluster-c');

  const lines = readLifecycleLines(projectRoot);
  assert.ok(lines.length >= 1);
  const entry = lines[lines.length - 1];
  assert.equal(entry.event, 'SessionStart');
  assert.equal(entry.ok, true);
  assert.equal(entry.session_id, 'codex-managed-abc');
  assert.equal(entry.actor_id, 'codex-managed:cluster-c');
});

test('emit short-circuits and logs when dispatcher is not on disk', () => {
  const projectRoot = tmpProjectRoot();
  // Deliberately do NOT create the dispatcher file.

  const calls = [];
  const stubRunner = (scriptPath, opts) => {
    calls.push({ scriptPath, env: opts.env });
    return { stdout: '', stderr: '', exitCode: 0 };
  };

  const result = emit(
    'PreToolUse',
    { sessionId: 'codex-managed-xyz', actorId: 'codex-managed', toolName: 'Bash' },
    { projectRoot, runner: stubRunner }
  );

  // No-op success: cluster A may not have shipped the dispatcher yet.
  assert.equal(result.ok, true);
  assert.equal(result.dispatcherExists, false);
  assert.equal(calls.length, 0);

  const lines = readLifecycleLines(projectRoot);
  const entry = lines[lines.length - 1];
  assert.equal(entry.reason, 'dispatcher-not-on-disk');
  assert.equal(entry.event, 'PreToolUse');
});

test('emit isolates dispatcher errors and never throws', () => {
  const projectRoot = tmpProjectRoot();
  const dispatcherPath = coordinationDispatcherPathFor(projectRoot);
  fs.writeFileSync(dispatcherPath, '// stub\n', 'utf8');

  const throwingRunner = () => {
    throw new Error('synthetic dispatcher crash');
  };

  // Must not throw. Must log the failure.
  const result = emit(
    'PostToolUse',
    { sessionId: 's', actorId: 'codex-managed:test', toolName: 'Write' },
    { projectRoot, runner: throwingRunner }
  );

  assert.equal(result.ok, false);
  assert.equal(result.dispatcherExists, true);
  assert.match(result.error, /synthetic dispatcher crash/);

  const lines = readLifecycleLines(projectRoot);
  const entry = lines[lines.length - 1];
  assert.equal(entry.reason, 'runner-threw');
  assert.match(entry.error, /synthetic dispatcher crash/);
});

test('emit rejects invalid event names with a logged failure', () => {
  const projectRoot = tmpProjectRoot();
  const result = emit('NotARealEvent', {}, { projectRoot });
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid event/);

  const lines = readLifecycleLines(projectRoot);
  const entry = lines[lines.length - 1];
  assert.equal(entry.reason, 'invalid-event-name');
});

test('emit propagates non-zero exit codes from the dispatcher runner', () => {
  const projectRoot = tmpProjectRoot();
  const dispatcherPath = coordinationDispatcherPathFor(projectRoot);
  fs.writeFileSync(dispatcherPath, '// stub\n', 'utf8');

  const failingRunner = () => ({ stdout: '', stderr: 'boom', exitCode: 7 });

  const result = emit(
    'SessionEnd',
    { sessionId: 's', actorId: 'codex-managed' },
    { projectRoot, runner: failingRunner }
  );

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.dispatcherExists, true);

  const lines = readLifecycleLines(projectRoot);
  const entry = lines[lines.length - 1];
  assert.equal(entry.exit_code, 7);
  assert.equal(entry.event, 'SessionEnd');
});
