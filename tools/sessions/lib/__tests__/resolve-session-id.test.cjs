'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const registry = require('../active-session-registry');
const { ENV_PRIORITY, resolveSessionId } = require('../resolve-session-id.cjs');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-session-id-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-session-root-'));
  registry.setDataDir(dataDir);
  const previous = Object.fromEntries(ENV_PRIORITY.map((name) => [name, process.env[name]]));
  for (const name of ENV_PRIORITY) delete process.env[name];
  t.after(() => {
    registry.resetDataDir();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
    for (const name of ENV_PRIORITY) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  return { dataDir, projectRoot };
}

test('multiple active sessions do not select a best-effort target', (t) => {
  const { projectRoot } = fixture(t);

  registry.registerSession({ sessionId: 'session-a', now: new Date().toISOString() });
  registry.registerSession({ sessionId: 'session-b', now: new Date().toISOString() });

  assert.deepEqual(resolveSessionId(projectRoot), {
    session_id: null,
    session_id_source: 'ambiguous-active-sessions',
    custody_grade: 'none'
  });
});

test('live sidecar remains best-effort display identity when multiple sessions are active', (t) => {
  const { projectRoot } = fixture(t);
  registry.registerSession({ sessionId: 'session-a', now: new Date().toISOString() });
  registry.registerSession({ sessionId: 'session-b', now: new Date().toISOString() });
  const activeDir = path.join(projectRoot, '_dev', 'state', 'active-sessions');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, '_current-id'), 'session-a\n');

  assert.deepEqual(resolveSessionId(projectRoot), {
    session_id: 'session-a',
    session_id_source: 'active-session-sidecar',
    custody_grade: 'best_effort'
  });
});

test('sole active session remains best-effort display identity', (t) => {
  const { projectRoot } = fixture(t);
  registry.registerSession({ sessionId: 'session-a', now: new Date().toISOString() });

  assert.deepEqual(resolveSessionId(projectRoot), {
    session_id: 'session-a',
    session_id_source: 'sole-active-session',
    custody_grade: 'best_effort'
  });
});

test('explicit environment session id is authoritative', (t) => {
  const { projectRoot } = fixture(t);
  process.env[ENV_PRIORITY[0]] = 'session-env';

  assert.deepEqual(resolveSessionId(projectRoot), {
    session_id: 'session-env',
    session_id_source: 'env',
    custody_grade: 'authoritative'
  });
});
