// tools/sessions/lib/__tests__/active-session-registry-filter.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const registry = require('../active-session-registry');

function withTempRegistry(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-registry-filter-'));
  registry.setDataDir(dataDir);
  t.after(() => {
    registry.resetDataDir();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return dataDir;
}

function seedPrior(dataDir, prior, paths) {
  const priorDir = path.join(dataDir, prior);
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, 'write_log.json'),
    `${JSON.stringify({ session_id: prior, paths }, null, 2)}\n`
  );
}

test('adoptSessionCustody with a filter scopes adoption to matching paths only', (t) => {
  const dataDir = withTempRegistry(t);
  const prior = 'prior-mixed';
  const current = 'current-filtered';
  seedPrior(dataDir, prior, [
    { path: 'tools/ant-hive-world/dashboard.js', at: 'x', tool: 'Write' },
    { path: 'tools/ant-hive-world/world-mind.js', at: 'x', tool: 'Write' },
    { path: 'clients/ECH/next-session-handoff.md', at: 'x', tool: 'Write' },
    { path: '_dev/reports/analysis/relational-substrate-port__plan.json', at: 'x', tool: 'Write' }
  ]);

  const antOnly = (p) => /ant-(sim|hive-world|world)/.test(String(p));
  const res = registry.adoptSessionCustody({
    fromSessionId: prior,
    toSessionId: current,
    filter: antOnly
  });

  assert.equal(res.adopted, true);
  assert.equal(res.adopted_count, 2, 'only ant-matching paths adopted');
  assert.deepEqual(res.paths.sort(), [
    'tools/ant-hive-world/dashboard.js',
    'tools/ant-hive-world/world-mind.js'
  ]);
  const log = JSON.parse(fs.readFileSync(path.join(dataDir, current, 'write_log.json'), 'utf8'));
  assert.equal(log.paths.length, 2, 'foreign workstream paths NOT dragged into custody');
  assert.ok(log.paths.every((e) => e.adopted_from === prior));
});

test('adoptSessionCustody with a filter matching nothing is a fail-open no-op', (t) => {
  const dataDir = withTempRegistry(t);
  const prior = 'prior-nomatch';
  seedPrior(dataDir, prior, [
    { path: 'clients/ECH/x.md', at: 'x', tool: 'Write' }
  ]);
  const res = registry.adoptSessionCustody({
    fromSessionId: prior,
    toSessionId: 'current-nomatch',
    filter: (p) => p.includes('ant-hive-world')
  });
  assert.equal(res.adopted, false);
  assert.equal(res.adopted_count, 0);
  assert.equal(res.reason, 'no-paths-match-filter');
  assert.equal(fs.existsSync(path.join(dataDir, 'current-nomatch', 'write_log.json')), false);
});

test('adoptSessionCustody without a filter adopts the full prior ledger (back-compat)', (t) => {
  const dataDir = withTempRegistry(t);
  const prior = 'prior-full';
  const current = 'current-full';
  seedPrior(dataDir, prior, [
    { path: 'a.txt', at: 'x', tool: 'Write' },
    { path: 'b.txt', at: 'x', tool: 'Write' }
  ]);
  const res = registry.adoptSessionCustody({ fromSessionId: prior, toSessionId: current });
  assert.equal(res.adopted, true);
  assert.equal(res.adopted_count, 2);
});
