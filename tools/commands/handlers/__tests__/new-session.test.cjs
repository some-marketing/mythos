'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const registry = require('../../../sessions/lib/active-session-registry');
const { ENV_PRIORITY } = require('../../../sessions/lib/resolve-session-id.cjs');
const { defaultCommands } = require('../new-session.cjs');

const ROOT = path.resolve(__dirname, '../../../..');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-session-commands-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'new-session-root-'));
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
  return { projectRoot };
}

test('new-session step 4 invokes the existing mythos status executable', () => {
  const commands = defaultCommands(ROOT);
  const statusCommand = commands['4-status'];
  assert.deepEqual(statusCommand.slice(0, 2), [process.execPath, path.join('tools', 'status', 'mythos-status.js')]);
  assert.equal(statusCommand[2], '--json');
  assert.equal(fs.existsSync(path.join(ROOT, statusCommand[1])), true);
});

test('new-session watcher start does not consume a sidecar identity when multiple sessions are active', (t) => {
  const { projectRoot } = fixture(t);
  registry.registerSession({ sessionId: 'session-a', now: new Date().toISOString() });
  registry.registerSession({ sessionId: 'session-b', now: new Date().toISOString() });
  const activeDir = path.join(projectRoot, '_dev', 'state', 'active-sessions');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, '_current-id'), 'session-a\n');

  assert.equal(defaultCommands(projectRoot)['0'][3], '');
});

test('new-session watcher start does not consume a sole-active best-effort identity', (t) => {
  const { projectRoot } = fixture(t);
  registry.registerSession({ sessionId: 'session-a', now: new Date().toISOString() });

  assert.equal(defaultCommands(projectRoot)['0'][3], '');
});

test('new-session watcher start consumes an explicit authoritative environment identity', (t) => {
  const { projectRoot } = fixture(t);
  process.env[ENV_PRIORITY[0]] = 'session-env';

  assert.equal(defaultCommands(projectRoot)['0'][3], 'session-env');
});
