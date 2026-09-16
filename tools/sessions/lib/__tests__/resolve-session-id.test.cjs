'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const registry = require('../active-session-registry');
const { ENV_PRIORITY, resolveSessionId } = require('../resolve-session-id.cjs');

test('multiple active sessions do not select a best-effort target', (t) => {
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

  registry.registerSession({ sessionId: 'session-a', now: new Date().toISOString() });
  registry.registerSession({ sessionId: 'session-b', now: new Date().toISOString() });

  assert.deepEqual(resolveSessionId(projectRoot), {
    session_id: null,
    session_id_source: 'ambiguous-active-sessions',
    custody_grade: 'none'
  });
});
