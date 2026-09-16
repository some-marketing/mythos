'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const lifecyclePath = path.resolve(__dirname, '..', 'watcher-lifecycle.cjs');
const readyPath = path.resolve(__dirname, '..', '..', 'signals', 'lib', 'watcher-ready.cjs');
const {
  DEFAULT_WATCHER_SET, startWatchers, stopWatchers, listRegistry,
  normalizeWatcherSet, registryFilePath, sessionLockDbPath,
  acquireSessionLock, releaseSessionLock, processExists, spawnedChildren,
  writeRegistry, liveStartTime, computeArgvFingerprint, verifyIdentity, spawnWatcher
} = require(lifecyclePath);

const children = [];
let sequence = 0;
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-lifecycle-')); }
function sid() { sequence += 1; return `managed-${process.pid}-${sequence}`; }
function track(child) { children.push(child); return child; }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await wait(10);
  }
  throw new Error('timed out waiting for condition');
}
async function waitExit(child, timeout = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), timeout);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}
function writeFixture(dir, name, body) {
  const file = path.join(dir, `${name}.cjs`);
  fs.writeFileSync(file, `'use strict';\n${body}\n`, 'utf8');
  return file;
}
function managedFixture(dir, name, extra = '', afterCommit = '') {
  return writeFixture(dir, name, `
const fs = require('fs');
const { createWatcherReadiness } = require(${JSON.stringify(readyPath)});
(async () => {
  ${extra}
  await createWatcherReadiness(${JSON.stringify(name)}).prepareAndWait();
  ${afterCommit}
  setInterval(() => {}, 1000);
})().catch(() => process.exit(17));`);
}
function entry(name, script, readiness = 'ipc-required', env = {}) {
  return { name, script, readiness, env };
}

after(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
    }
  }
  for (const child of spawnedChildren().values()) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
    }
  }
  await wait(100);
});

test('default family is IPC-required and custom readiness is explicit', () => {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const defaults = normalizeWatcherSet(DEFAULT_WATCHER_SET, projectRoot);
  assert.deepStrictEqual(defaults.map((item) => item.readiness), ['ipc-required', 'ipc-required', 'ipc-required']);
  for (const item of defaults) {
    assert.equal(item.executable, process.execPath);
    assert.equal(item.script, path.join(projectRoot, 'tools', 'signals', `${item.name}.js`));
  }
  assert.throws(() => normalizeWatcherSet([{ name: 'custom', command: process.execPath, args: ['-e', '0'] }], projectRoot), /must declare readiness/);
  assert.throws(() => normalizeWatcherSet([{ name: DEFAULT_WATCHER_SET[0], command: process.execPath, args: ['-e', '0'], readiness: 'liveness-only' }], projectRoot), /requires readiness/);
});

test('managed start publishes complete registry before COMMIT and records COMMITTED identity', async () => {
  const projectRoot = root();
  const session = sid();
  const sawCommit = path.join(projectRoot, 'saw-commit');
  const registry = registryFilePath(session, projectRoot);
  const script = managedFixture(projectRoot, 'alpha', `process.on('message', (m) => { if (m && m.type === 'mythos-watcher-commit') { if (!fs.existsSync(${JSON.stringify(registry)})) process.exit(31); fs.writeFileSync(${JSON.stringify(sawCommit)}, 'yes'); } });`);
  const result = await startWatchers(session, [entry('alpha', script)], { projectRoot, prepareTimeoutMs: 1000, committedTimeoutMs: 1000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.status, 'committed');
  assert.equal(fs.readFileSync(sawCommit, 'utf8'), 'yes');
  const identity = listRegistry(session, { projectRoot })[0];
  assert.equal(identity.readiness_degraded, false);
  assert.ok(Number.isInteger(identity.pid) && identity.pid > 0);
  assert.ok(identity.start_time);
  assert.equal(identity.executable, process.execPath);
  assert.ok(Array.isArray(identity.argv) && identity.argv.length >= 2);
  assert.match(identity.argv_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(verifyIdentity(identity).ok, true);
  const stopped = await stopWatchers(session, { projectRoot, graceMs: 100 });
  assert.deepStrictEqual(stopped.signaled, ['alpha']);
  assert.deepStrictEqual(stopped.refused, []);
});

test('managed caller observes no completed start before PREPARED/COMMIT settles', async () => {
  const projectRoot = root();
  const session = sid();
  const prepared = path.join(projectRoot, 'prepared');
  const completed = path.join(projectRoot, 'completed');
  const script = managedFixture(projectRoot, 'delayed', `fs.writeFileSync(${JSON.stringify(prepared)}, 'yes');`);
  const runner = writeFixture(projectRoot, 'runner', `
const { startWatchers } = require(${JSON.stringify(lifecyclePath)});
startWatchers(${JSON.stringify(session)}, [${JSON.stringify(entry('delayed', script))}], { projectRoot: ${JSON.stringify(projectRoot)} }).then((r) => require('fs').writeFileSync(${JSON.stringify(completed)}, JSON.stringify(r)));`);
  const child = track(spawn(process.execPath, [runner], { stdio: 'ignore' }));
  await waitFor(() => fs.existsSync(prepared));
  assert.equal(fs.existsSync(completed), false);
  const exited = await waitExit(child);
  assert.equal(exited.code, 0);
  const result = JSON.parse(fs.readFileSync(completed, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(processExists(result.started[0].pid), true, 'finalized watcher outlives start caller');
  await stopWatchers(session, { projectRoot, graceMs: 100 });
});

test('direct exported spawnWatcher finalizes promptly while its daemon remains alive', async () => {
  const projectRoot = root();
  const daemon = writeFixture(projectRoot, 'direct-spawn-daemon', `setInterval(() => {}, 1000);`);
  const runner = writeFixture(projectRoot, 'direct-spawn-runner', `
const { spawnWatcher } = require(${JSON.stringify(lifecyclePath)});
(async () => {
  const control = await spawnWatcher({
    name: 'direct-spawn', executable: process.execPath,
    argv: [process.execPath, ${JSON.stringify(daemon)}], script: ${JSON.stringify(daemon)},
    readiness: 'liveness-only', env: {}
  }, { sessionId: 'direct-spawn-session', projectRoot: ${JSON.stringify(projectRoot)}, startupSettleMs: 20 });
  control.finalize();
  process.stdout.write(String(control.identity.pid));
})().catch((error) => { process.stderr.write(error.stack); process.exitCode = 1; });`);
  const caller = track(spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] }));
  let stdout = '';
  let stderr = '';
  caller.stdout.on('data', (chunk) => { stdout += chunk; });
  caller.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = await waitExit(caller, 2000);
  assert.equal(exited.timedOut, undefined, 'direct spawn caller exits promptly');
  assert.equal(exited.code, 0, stderr);
  const daemonPid = Number(stdout.trim());
  assert.ok(Number.isInteger(daemonPid) && daemonPid > 0);
  assert.equal(processExists(daemonPid), true);
  process.kill(daemonPid, 'SIGKILL');
  await waitFor(() => !processExists(daemonPid));
});

test('in-bound delayed PREPARED and COMMITTED acknowledgements settle', async () => {
  const projectRoot = root();
  const session = sid();
  const script = writeFixture(projectRoot, 'delayed-acks', `
const { MESSAGE_TYPES, ENV, makeWatcherMessage, isExactWatcherMessage } = require(${JSON.stringify(readyPath)});
const nonce = process.env[ENV.NONCE];
setTimeout(() => process.send(makeWatcherMessage(MESSAGE_TYPES.PREPARED, 'delayed-acks', process.pid, nonce)), 30);
process.on('message', (message) => {
  if (!isExactWatcherMessage(message, MESSAGE_TYPES.COMMIT, { name: 'delayed-acks', pid: process.pid, nonce })) process.exit(22);
  setTimeout(() => process.send(makeWatcherMessage(MESSAGE_TYPES.COMMITTED, 'delayed-acks', process.pid, nonce)), 30);
});
setInterval(() => {}, 1000);`);
  const result = await startWatchers(session, [entry('delayed-acks', script)], { projectRoot, prepareTimeoutMs: 250, committedTimeoutMs: 250 });
  assert.equal(result.ok, true, JSON.stringify(result));
  await stopWatchers(session, { projectRoot, graceMs: 100 });
});

test('wrong acknowledgement and prepare timeout are bounded and leave no generation', async () => {
  for (const kind of ['wrong', 'silent']) {
    const projectRoot = root();
    const session = sid();
    const body = kind === 'wrong'
      ? `process.send({type:'mythos-watcher-prepared',protocol:'wrong',name:'bad',pid:process.pid,nonce:'bad'}); setInterval(()=>{},1000);`
      : `setInterval(()=>{},1000);`;
    const script = writeFixture(projectRoot, kind, body);
    const startedAt = Date.now();
    const result = await startWatchers(session, [entry(kind, script)], { projectRoot, prepareTimeoutMs: 100, committedTimeoutMs: 100 });
    assert.equal(result.ok, false, kind);
    assert.ok(Date.now() - startedAt < 2000, kind);
    assert.deepStrictEqual(listRegistry(session, { projectRoot }), []);
  }
});

test('partial PREPARED failure reaps the earlier owned child', async () => {
  const projectRoot = root();
  const session = sid();
  const first = managedFixture(projectRoot, 'partial-first');
  const bad = writeFixture(projectRoot, 'partial-bad', `process.send({ bad: true }); setInterval(()=>{},1000);`);
  const result = await startWatchers(session, [entry('partial-first', first), entry('partial-bad', bad)], { projectRoot, prepareTimeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.deepStrictEqual(result.rolled_back, ['partial-first']);
  assert.equal(processExists(result.started[0].pid), false);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }), []);
});

test('asynchronous nonexistent executable is reported promptly with no registry identity', async () => {
  const projectRoot = root();
  const session = sid();
  const startedAt = Date.now();
  const result = await startWatchers(session, [{
    name: 'missing-executable', command: '/nonexistent/watcher-binary', args: [], readiness: 'liveness-only'
  }], { projectRoot });
  assert.equal(result.ok, false);
  assert.match(result.failed[0].error, /ENOENT/);
  assert.ok(Date.now() - startedAt < 2000);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }), []);
});

test('liveness-only startup rejects a child that exits during settle', async () => {
  const projectRoot = root();
  const session = sid();
  const pidFile = path.join(projectRoot, 'early-exit.pid');
  const script = writeFixture(projectRoot, 'early-exit', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => process.exit(7), 10);`);
  const result = await startWatchers(session, [entry('early-exit', script, 'liveness-only')], { projectRoot, startupSettleMs: 100 });
  assert.equal(result.ok, false);
  assert.match(result.failed[0].error, /exited during startup/);
  await waitFor(() => fs.existsSync(pidFile));
  assert.equal(processExists(Number(fs.readFileSync(pidFile, 'utf8'))), false);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }), []);
});

test('unavailable start-time probing is bounded to five attempts and reaps its owned child', async () => {
  const projectRoot = root();
  const session = sid();
  const countFile = path.join(projectRoot, 'ps-count');
  const pidFile = path.join(projectRoot, 'daemon-pid');
  const fakePs = path.join(projectRoot, 'ps');
  fs.writeFileSync(fakePs, '#!/bin/sh\nprintf x >> "$MYTHOS_FAKE_PS_COUNT"\nexit 1\n');
  fs.chmodSync(fakePs, 0o755);
  const daemon = writeFixture(projectRoot, 'uninspectable', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000);`);
  const reportFile = path.join(projectRoot, 'report');
  const runner = writeFixture(projectRoot, 'uninspectable-runner', `
const { startWatchers } = require(${JSON.stringify(lifecyclePath)});
startWatchers(${JSON.stringify(session)}, [${JSON.stringify(entry('uninspectable', daemon, 'liveness-only'))}], { projectRoot: ${JSON.stringify(projectRoot)} }).then((result) => require('fs').writeFileSync(${JSON.stringify(reportFile)}, JSON.stringify(result)));`);
  const child = track(spawn(process.execPath, [runner], {
    env: Object.assign({}, process.env, { PATH: `${projectRoot}:${process.env.PATH || ''}`, MYTHOS_FAKE_PS_COUNT: countFile }),
    stdio: 'ignore'
  }));
  const exited = await waitExit(child);
  assert.equal(exited.code, 0);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(fs.readFileSync(countFile, 'utf8').length, 5);
  const daemonPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(processExists(daemonPid), false);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }), []);
});

test('registry persistence failure reaps owned child, preserves error, and releases lock', async () => {
  const projectRoot = root();
  const session = sid();
  const script = managedFixture(projectRoot, 'persist-fail');
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('fixture registry persistence failure'); };
  try {
    await assert.rejects(startWatchers(session, [entry('persist-fail', script)], { projectRoot }), /fixture registry persistence failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  const owned = spawnedChildren().get(`${session}::persist-fail`);
  assert.ok(!owned || !processExists(owned.pid));
  const lock = acquireSessionLock(session, projectRoot);
  releaseSessionLock(lock);
});

test('storage failure plus cleanup failure reports non-durable blocked repair truth', async () => {
  const projectRoot = root();
  const session = sid();
  const script = managedFixture(projectRoot, 'storage-residue');
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('fixture registry persistence failure'); };
  let result;
  try {
    result = await startWatchers(session, [entry('storage-residue', script)], {
      projectRoot,
      committedTimeoutMs: 100,
      reapOwnedChild: async () => ({ ok: false, error: new Error('fixture cleanup refused') })
    });
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(result.status, 'blocked_repair');
  const record = result.blocked_repair[0];
  assert.equal(record.pid, result.started[0].pid);
  assert.equal(record.observed_start_time, result.started[0].start_time);
  assert.match(record.blocker, /fixture cleanup refused/);
  assert.match(record.original_operation_error, /fixture registry persistence failure/);
  assert.equal(record.durable_identity_persisted, false);
  assert.match(record.storage_note, /durable persistence was not achieved/);
  assert.equal(record.gate_owner, 'lifecycle integrator/coordinator');
  assert.equal(record.safe_pickup_command, `node tools/sessions/watcher-lifecycle.cjs stop ${session} --root ${projectRoot}`);
  assert.match(record.forbidden_repeat_action, /startWatchers/);
  const child = spawnedChildren().get(`${session}::storage-residue`);
  assert.ok(child, 'owned ChildProcess handle remains visible');
  assert.equal(processExists(record.pid), true, 'owned residue remains live until explicit test cleanup');
  if (processExists(child.pid)) child.kill('SIGKILL');
  await waitExit(child);
  spawnedChildren().delete(`${session}::storage-residue`);
});

test('post-publication COMMITTED failure retains durable blocked repair identity', async () => {
  const projectRoot = root();
  const session = sid();
  const script = writeFixture(projectRoot, 'committed-timeout', `
const { MESSAGE_TYPES, ENV, makeWatcherMessage } = require(${JSON.stringify(readyPath)});
const nonce = process.env[ENV.NONCE];
process.send(makeWatcherMessage(MESSAGE_TYPES.PREPARED, 'committed-timeout', process.pid, nonce));
process.on('message', () => {});
setInterval(() => {}, 1000);`);
  const result = await startWatchers(session, [entry('committed-timeout', script)], {
    projectRoot,
    committedTimeoutMs: 100,
    reapOwnedChild: async () => ({ ok: false, error: new Error('fixture cleanup refused') })
  });
  assert.equal(result.status, 'blocked_repair');
  const record = result.blocked_repair[0];
  assert.equal(record.pid, result.started[0].pid);
  assert.equal(record.observed_start_time, result.started[0].start_time);
  assert.match(record.blocker, /fixture cleanup refused/);
  assert.match(record.original_operation_error, /timed out waiting for mythos-watcher-committed/);
  assert.equal(record.safe_pickup_command, `node tools/sessions/watcher-lifecycle.cjs stop ${session} --root ${projectRoot}`);
  assert.equal(record.durable_identity_persisted, true);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }).map((item) => item.name), ['committed-timeout']);
  const child = spawnedChildren().get(`${session}::committed-timeout`);
  assert.ok(child, 'durably recorded residue retains its owned ChildProcess handle');
  assert.equal(processExists(record.pid), true);
  if (child && processExists(child.pid)) child.kill('SIGKILL');
  await waitFor(() => !processExists(result.started[0].pid));
  const cleaned = await stopWatchers(session, { projectRoot, graceMs: 100 });
  assert.deepStrictEqual(cleaned.stale, ['committed-timeout']);
});

test('explicit liveness-only mode is visibly degraded', async () => {
  const projectRoot = root();
  const session = sid();
  const script = writeFixture(projectRoot, 'legacy', `setInterval(()=>{},1000);`);
  const result = await startWatchers(session, [entry('legacy', script, 'liveness-only')], { projectRoot, startupSettleMs: 20 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.started[0].readiness, 'liveness-only');
  assert.equal(result.started[0].readiness_degraded, true);
  await stopWatchers(session, { projectRoot, graceMs: 100 });
});

test('stop delivers SIGTERM to each of three verified children and empties the registry', async () => {
  const projectRoot = root();
  const session = sid();
  const script = writeFixture(projectRoot, 'three-daemon', `setInterval(() => {}, 1000);`);
  const names = ['codex-fixture', 'actor-fixture', 'pipeline-fixture'];
  const started = await startWatchers(session, names.map((name) => entry(name, script, 'liveness-only')), { projectRoot, startupSettleMs: 20 });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.started.length, 3);
  for (const identity of started.started) {
    assert.ok(Array.isArray(identity.argv) && identity.argv.length >= 2, `${identity.name} argv array is recorded`);
    assert.equal(verifyIdentity(identity).ok, true, `${identity.name} identity verifies while live`);
  }
  const handles = new Map(names.map((name) => [name, spawnedChildren().get(`${session}::${name}`)]));
  for (const [name, child] of handles) assert.ok(child, `${name} child handle is visible`);
  const stopped = await stopWatchers(session, { projectRoot, graceMs: 100 });
  assert.deepStrictEqual(new Set(stopped.signaled), new Set(names));
  assert.deepStrictEqual(stopped.refused, []);
  assert.deepStrictEqual(stopped.stale, []);
  for (const [name, child] of handles) {
    const exit = await waitExit(child);
    assert.equal(exit.signal, 'SIGTERM', `${name} received SIGTERM`);
    assert.equal(exit.code, null);
  }
  assert.deepStrictEqual(listRegistry(session, { projectRoot }), []);
});

test('below-floor runtime fails before spawn with WATCHER_LOCK_UNSUPPORTED', async () => {
  const projectRoot = root();
  const marker = path.join(projectRoot, 'spawned');
  const script = writeFixture(projectRoot, 'unsupported', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes');`);
  await assert.rejects(
    startWatchers(sid(), [entry('unsupported', script, 'liveness-only')], { projectRoot, runtimeVersion: '22.12.0' }),
    (error) => error.code === 'WATCHER_LOCK_UNSUPPORTED'
  );
  assert.equal(fs.existsSync(marker), false);
});

test('legacy lock fails closed, remains byte-identical, and prevents spawn', async () => {
  const projectRoot = root();
  const session = sid();
  const legacy = path.join(path.dirname(registryFilePath(session, projectRoot)), 'watchers.lock');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  const bytes = Buffer.from([0, 1, 2, 3, 255]);
  fs.writeFileSync(legacy, bytes);
  const marker = path.join(projectRoot, 'spawned');
  const script = writeFixture(projectRoot, 'legacy-lock', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes');`);
  await assert.rejects(
    startWatchers(session, [entry('legacy-lock', script, 'liveness-only')], { projectRoot }),
    (error) => error.code === 'WATCHER_LOCK_LEGACY_PRESENT'
  );
  assert.deepStrictEqual(fs.readFileSync(legacy), bytes);
  assert.equal(fs.existsSync(marker), false);
});

test('SQLite contention is immediate and killed holder releases kernel ownership', async () => {
  const projectRoot = root();
  const session = sid();
  const ready = path.join(projectRoot, 'locked');
  const holder = writeFixture(projectRoot, 'holder', `
const fs = require('fs');
const { acquireSessionLock } = require(${JSON.stringify(lifecyclePath)});
globalThis.heldLock = acquireSessionLock(${JSON.stringify(session)}, ${JSON.stringify(projectRoot)});
fs.writeFileSync(${JSON.stringify(ready)}, 'yes');
setInterval(() => {}, 1000);`);
  const child = track(spawn(process.execPath, [holder], { stdio: 'ignore' }));
  await waitFor(() => fs.existsSync(ready));
  assert.throws(() => acquireSessionLock(session, projectRoot), (error) => error.code === 'WATCHER_LOCK_BUSY');
  const spawnMarker = path.join(projectRoot, 'must-not-spawn');
  const never = writeFixture(projectRoot, 'never', `require('fs').writeFileSync(${JSON.stringify(spawnMarker)}, 'yes');`);
  await assert.rejects(startWatchers(session, [entry('never', never, 'liveness-only')], { projectRoot }), (error) => error.code === 'WATCHER_LOCK_BUSY');
  await assert.rejects(stopWatchers(session, { projectRoot }), (error) => error.code === 'WATCHER_LOCK_BUSY');
  assert.equal(fs.existsSync(spawnMarker), false);
  child.kill('SIGKILL');
  await waitExit(child);
  const lock = acquireSessionLock(session, projectRoot);
  assert.equal(fs.existsSync(sessionLockDbPath(session, projectRoot)), true);
  releaseSessionLock(lock);
});

test('two same-session start contenders admit exactly one generation', async () => {
  const projectRoot = root();
  const session = sid();
  const localScan = path.join(projectRoot, 'local-scan');
  const slow = managedFixture(projectRoot, 'contender', `fs.writeFileSync(${JSON.stringify(localScan)}, 'yes'); await new Promise((resolve) => setTimeout(resolve, 250));`);
  const first = startWatchers(session, [entry('contender', slow)], { projectRoot, prepareTimeoutMs: 1000 });
  await waitFor(() => fs.existsSync(localScan));
  await assert.rejects(startWatchers(session, [entry('contender', slow)], { projectRoot }), (error) => error.code === 'WATCHER_LOCK_BUSY');
  const result = await first;
  assert.equal(result.ok, true);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }).map((item) => item.name), ['contender']);
  await stopWatchers(session, { projectRoot, graceMs: 100 });
});

test('two independent startWatchers processes produce one winner, one busy loser, and one live PID', async () => {
  const projectRoot = root();
  const session = sid();
  const daemon = writeFixture(projectRoot, 'process-contender-daemon', `require('fs').writeFileSync(process.env.PR17_PID_FILE, String(process.pid)); setInterval(()=>{},1000);`);
  const goFile = path.join(projectRoot, 'go');
  const runner = writeFixture(projectRoot, 'process-contender-runner', `
const fs = require('fs');
const { startWatchers } = require(${JSON.stringify(lifecyclePath)});
fs.writeFileSync(process.env.PR17_READY_FILE, 'ready');
while (!fs.existsSync(process.env.PR17_GO_FILE)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
(async () => {
  try {
    const result = await startWatchers(${JSON.stringify(session)}, [{
      name: 'process-contender', command: process.execPath, args: [${JSON.stringify(daemon)}],
      readiness: 'liveness-only', env: { PR17_PID_FILE: process.env.PR17_PID_FILE }
    }], { projectRoot: ${JSON.stringify(projectRoot)}, startupSettleMs: 400 });
    fs.writeFileSync(process.env.PR17_RESULT_FILE, JSON.stringify({ ok: result.ok, started: result.started }));
  } catch (error) {
    fs.writeFileSync(process.env.PR17_RESULT_FILE, JSON.stringify({ error: { code: error.code, message: error.message } }));
    process.exitCode = 2;
  }
})();`);
  const launch = (label) => {
    const readyFile = path.join(projectRoot, `${label}.ready`);
    const pidFile = path.join(projectRoot, `${label}.pid`);
    const resultFile = path.join(projectRoot, `${label}.json`);
    const child = track(spawn(process.execPath, [runner], {
      env: Object.assign({}, process.env, {
        PR17_READY_FILE: readyFile, PR17_PID_FILE: pidFile,
        PR17_RESULT_FILE: resultFile, PR17_GO_FILE: goFile
      }),
      stdio: 'ignore'
    }));
    return { child, readyFile, pidFile, resultFile };
  };
  const a = launch('a');
  const b = launch('b');
  await waitFor(() => fs.existsSync(a.readyFile) && fs.existsSync(b.readyFile));
  fs.writeFileSync(goFile, 'go');
  const [exitA, exitB] = await Promise.all([waitExit(a.child), waitExit(b.child)]);
  assert.deepStrictEqual(new Set([exitA.code, exitB.code]), new Set([0, 2]));
  const reports = [JSON.parse(fs.readFileSync(a.resultFile, 'utf8')), JSON.parse(fs.readFileSync(b.resultFile, 'utf8'))];
  assert.equal(reports.filter((item) => item.ok === true).length, 1);
  assert.equal(reports.filter((item) => item.error && item.error.code === 'WATCHER_LOCK_BUSY').length, 1);
  const pidFiles = [a.pidFile, b.pidFile].filter((file) => fs.existsSync(file));
  assert.equal(pidFiles.length, 1, 'only the lock winner may spawn a watcher');
  const winnerPid = Number(fs.readFileSync(pidFiles[0], 'utf8'));
  const registry = listRegistry(session, { projectRoot });
  assert.equal(registry.length, 1);
  assert.equal(registry[0].pid, winnerPid);
  assert.equal(processExists(winnerPid), true);
  await stopWatchers(session, { projectRoot, graceMs: 100 });
});

test('parent crash before registry publication disconnects child without post-COMMIT effect', async () => {
  const projectRoot = root();
  const session = sid();
  const prepared = path.join(projectRoot, 'prepared');
  const effect = path.join(projectRoot, 'effect');
  const pidFile = path.join(projectRoot, 'pid');
  const script = managedFixture(
    projectRoot,
    'crash-before',
    `fs.writeFileSync(${JSON.stringify(prepared)}, 'yes'); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await new Promise((resolve) => setTimeout(resolve, 500));`,
    `fs.writeFileSync(${JSON.stringify(effect)}, 'forbidden');`
  );
  const runner = writeFixture(projectRoot, 'crash-runner', `require(${JSON.stringify(lifecyclePath)}).startWatchers(${JSON.stringify(session)}, [${JSON.stringify(entry('crash-before', script))}], { projectRoot: ${JSON.stringify(projectRoot)}, prepareTimeoutMs: 5000 });`);
  const parent = track(spawn(process.execPath, [runner], { stdio: 'ignore' }));
  await waitFor(() => fs.existsSync(prepared));
  parent.kill('SIGKILL');
  await waitExit(parent);
  const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
  await waitFor(() => !processExists(childPid));
  assert.equal(fs.existsSync(registryFilePath(session, projectRoot)), false);
  assert.equal(fs.existsSync(effect), false);
});

test('parent crash during partial COMMIT leaves every possible survivor durably stoppable', async () => {
  const projectRoot = root();
  const session = sid();
  const secondCommitted = path.join(projectRoot, 'second-accepted-commit');
  const protocolFixture = (name, acknowledge) => writeFixture(projectRoot, name, `
const fs = require('fs');
const { MESSAGE_TYPES, ENV, makeWatcherMessage, isExactWatcherMessage } = require(${JSON.stringify(readyPath)});
const nonce = process.env[ENV.NONCE];
let accepted = false;
process.on('disconnect', () => { if (!accepted) process.exit(19); });
process.on('message', (message) => {
  if (!isExactWatcherMessage(message, MESSAGE_TYPES.COMMIT, { name: ${JSON.stringify(name)}, pid: process.pid, nonce })) return process.exit(20);
  accepted = true;
  ${acknowledge ? `process.send(makeWatcherMessage(MESSAGE_TYPES.COMMITTED, ${JSON.stringify(name)}, process.pid, nonce));` : `fs.writeFileSync(${JSON.stringify(secondCommitted)}, 'yes');`}
});
process.send(makeWatcherMessage(MESSAGE_TYPES.PREPARED, ${JSON.stringify(name)}, process.pid, nonce));
setInterval(() => {}, 1000);`);
  const first = protocolFixture('commit-first', true);
  const second = protocolFixture('commit-second', false);
  const runner = writeFixture(projectRoot, 'partial-commit-runner', `require(${JSON.stringify(lifecyclePath)}).startWatchers(${JSON.stringify(session)}, ${JSON.stringify([entry('commit-first', first), entry('commit-second', second)])}, { projectRoot: ${JSON.stringify(projectRoot)}, committedTimeoutMs: 5000 });`);
  const parent = track(spawn(process.execPath, [runner], { stdio: 'ignore' }));
  await waitFor(() => fs.existsSync(secondCommitted));
  const identities = listRegistry(session, { projectRoot });
  assert.deepStrictEqual(new Set(identities.map((item) => item.name)), new Set(['commit-first', 'commit-second']));
  parent.kill('SIGKILL');
  await waitExit(parent);
  const stopped = await stopWatchers(session, { projectRoot, graceMs: 100 });
  assert.deepStrictEqual(new Set(stopped.signaled), new Set(['commit-first', 'commit-second']));
  assert.deepStrictEqual(stopped.refused, []);
});

test('pre-emptive duplicate generation stops the recorded generation first', async () => {
  const projectRoot = root();
  const session = sid();
  const first = managedFixture(projectRoot, 'one');
  const second = managedFixture(projectRoot, 'two');
  const a = await startWatchers(session, [entry('one', first)], { projectRoot });
  assert.equal(a.ok, true);
  const oldPid = a.started[0].pid;
  const b = await startWatchers(session, [entry('two', second)], { projectRoot, graceMs: 100 });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepStrictEqual(b.preemptively_stopped, ['one']);
  assert.equal(processExists(oldPid), false);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }).map((item) => item.name), ['two']);
  await stopWatchers(session, { projectRoot, graceMs: 100 });
});

test('restarting an identical two-name set kills both old PIDs and records two distinct live replacements', async () => {
  const projectRoot = root();
  const session = sid();
  const alpha = managedFixture(projectRoot, 'restart-alpha');
  const beta = managedFixture(projectRoot, 'restart-beta');
  const watcherSet = [entry('restart-alpha', alpha), entry('restart-beta', beta)];
  const first = await startWatchers(session, watcherSet, { projectRoot });
  assert.equal(first.ok, true, JSON.stringify(first));
  const oldByName = Object.fromEntries(first.started.map((item) => [item.name, item.pid]));
  const second = await startWatchers(session, watcherSet, { projectRoot, graceMs: 100 });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepStrictEqual(new Set(second.preemptively_stopped), new Set(['restart-alpha', 'restart-beta']));
  const freshByName = Object.fromEntries(second.started.map((item) => [item.name, item.pid]));
  for (const name of ['restart-alpha', 'restart-beta']) {
    assert.equal(processExists(oldByName[name]), false, `${name} old PID is dead`);
    assert.notEqual(freshByName[name], oldByName[name], `${name} replacement PID differs`);
    assert.equal(processExists(freshByName[name]), true, `${name} replacement is live`);
  }
  const registry = listRegistry(session, { projectRoot });
  assert.deepStrictEqual(new Set(registry.map((item) => item.name)), new Set(['restart-alpha', 'restart-beta']));
  for (const identity of registry) assert.equal(verifyIdentity(identity).ok, true, `${identity.name} registry identity verifies`);
  await stopWatchers(session, { projectRoot, graceMs: 100 });
});

test('identity mismatch is never signaled and remains a durable blocked repair', async () => {
  const projectRoot = root();
  const session = sid();
  const child = track(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }));
  await waitFor(() => liveStartTime(child.pid));
  const argv = [process.execPath, '-e', 'setInterval(()=>{},1000)'];
  writeRegistry(session, { watchers: { foreign: {
    name: 'foreign', pid: child.pid, start_time: 'Mon Jan 01 00:00:00 1900',
    executable: process.execPath, executable_basename: path.basename(process.execPath),
    argv, argv_fingerprint: computeArgvFingerprint(argv), script: null
  } } }, projectRoot);
  const result = await stopWatchers(session, { projectRoot, graceMs: 50 });
  assert.equal(result.status, 'blocked_repair');
  assert.equal(processExists(child.pid), true);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }).map((item) => item.name), ['foreign']);
  assert.equal(result.blocked_repair[0].operation, 'stop');
  child.kill('SIGKILL');
  await waitExit(child);
});

test('correct start time with wrong executable and fingerprint refuses without signaling', async () => {
  const projectRoot = root();
  const session = sid();
  const child = track(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }));
  const startTime = await waitFor(() => liveStartTime(child.pid));
  const wrongArgv = ['/usr/bin/bogus-executable', '--foreign'];
  writeRegistry(session, { watchers: { wrongargv: {
    name: 'wrongargv', pid: child.pid, start_time: startTime,
    executable: wrongArgv[0], executable_basename: 'bogus-executable',
    argv: wrongArgv, argv_fingerprint: computeArgvFingerprint(wrongArgv), script: null
  } } }, projectRoot);
  const result = await stopWatchers(session, { projectRoot, graceMs: 50 });
  assert.equal(result.status, 'blocked_repair');
  assert.equal(result.signaled.length, 0);
  assert.equal(result.refused.length, 1);
  assert.deepStrictEqual(result.refused[0].mismatches, ['argv']);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.equal(processExists(child.pid), true);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }).map((item) => item.name), ['wrongargv']);
  child.kill('SIGKILL');
  await waitExit(child);
  const stale = await stopWatchers(session, { projectRoot, graceMs: 20 });
  assert.deepStrictEqual(stale.stale, ['wrongargv']);
});

test('stale recorded PID is removed without signaling', async () => {
  const projectRoot = root();
  const session = sid();
  writeRegistry(session, { watchers: { stale: {
    name: 'stale', pid: 2147483647, start_time: 'unavailable', executable: process.execPath,
    argv: [process.execPath], argv_fingerprint: computeArgvFingerprint([process.execPath]), script: null
  } } }, projectRoot);
  const result = await stopWatchers(session, { projectRoot, graceMs: 20 });
  assert.deepStrictEqual(result.stale, ['stale']);
  assert.deepStrictEqual(result.signaled, []);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }), []);
});

test('pre-emptive foreign identity blocks a fresh start before spawn', async () => {
  const projectRoot = root();
  const session = sid();
  const foreign = track(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }));
  await waitFor(() => liveStartTime(foreign.pid));
  writeRegistry(session, { watchers: { foreign: {
    name: 'foreign', pid: foreign.pid, start_time: 'wrong', executable: process.execPath,
    argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'],
    argv_fingerprint: computeArgvFingerprint([process.execPath, '-e', 'setInterval(()=>{},1000)']), script: null
  } } }, projectRoot);
  const spawnedMarker = path.join(projectRoot, 'fresh-spawned');
  const fresh = writeFixture(projectRoot, 'fresh', `require('fs').writeFileSync(${JSON.stringify(spawnedMarker)}, 'yes'); setInterval(()=>{},1000);`);
  const result = await startWatchers(session, [entry('fresh', fresh, 'liveness-only')], { projectRoot });
  assert.equal(result.status, 'blocked_repair');
  assert.equal(fs.existsSync(spawnedMarker), false);
  assert.equal(processExists(foreign.pid), true);
  foreign.kill('SIGKILL');
  await waitExit(foreign);
});

test('pre-emptive cleanup stops its real generation but retains a live foreign refusal and never spawns fresh', async () => {
  const projectRoot = root();
  const session = sid();
  const realScript = managedFixture(projectRoot, 'recorded-real');
  const first = await startWatchers(session, [entry('recorded-real', realScript)], { projectRoot });
  assert.equal(first.ok, true);
  const realPid = first.started[0].pid;
  const foreign = track(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }));
  await waitFor(() => liveStartTime(foreign.pid));
  const registry = { watchers: Object.fromEntries(listRegistry(session, { projectRoot }).map((item) => [item.name, item])) };
  registry.watchers.foreign = {
    name: 'foreign', pid: foreign.pid, start_time: 'wrong', executable: '/usr/bin/bogus',
    executable_basename: 'bogus', argv: ['/usr/bin/bogus'],
    argv_fingerprint: computeArgvFingerprint(['/usr/bin/bogus']), script: null
  };
  writeRegistry(session, registry, projectRoot);
  const freshMarker = path.join(projectRoot, 'fresh-started');
  const fresh = writeFixture(projectRoot, 'fresh-after-mixed', `require('fs').writeFileSync(${JSON.stringify(freshMarker)}, 'yes'); setInterval(()=>{},1000);`);
  const result = await startWatchers(session, [entry('fresh-after-mixed', fresh, 'liveness-only')], { projectRoot, graceMs: 100 });
  assert.equal(result.status, 'blocked_repair');
  assert.deepStrictEqual(result.preemptively_stopped, ['recorded-real']);
  assert.equal(processExists(realPid), false);
  assert.equal(processExists(foreign.pid), true);
  assert.equal(foreign.exitCode, null);
  assert.equal(foreign.signalCode, null);
  assert.equal(fs.existsSync(freshMarker), false);
  assert.deepStrictEqual(listRegistry(session, { projectRoot }).map((item) => item.name), ['foreign']);
  foreign.kill('SIGKILL');
  await waitExit(foreign);
  await stopWatchers(session, { projectRoot, graceMs: 20 });
});

test('missing registry is a clean stop and traversal session ids fail closed', async () => {
  const projectRoot = root();
  const missing = await stopWatchers(sid(), { projectRoot });
  assert.equal(missing.registry_missing, true);
  assert.deepStrictEqual(missing.signaled, []);
  assert.deepStrictEqual(missing.refused, []);
  assert.deepStrictEqual(missing.stale, []);
  await assert.rejects(stopWatchers('../escape', { projectRoot }), /invalid session_id/);
  await assert.rejects(startWatchers('../escape', [entry('x', __filename, 'liveness-only')], { projectRoot }), /invalid session_id/);
});

test('stopping one session leaves a different session in the same root live and registered', async () => {
  const projectRoot = root();
  const sessionA = sid();
  const sessionB = sid();
  const scriptA = managedFixture(projectRoot, 'session-a');
  const scriptB = managedFixture(projectRoot, 'session-b');
  const startedA = await startWatchers(sessionA, [entry('session-a', scriptA)], { projectRoot });
  const startedB = await startWatchers(sessionB, [entry('session-b', scriptB)], { projectRoot });
  assert.equal(startedA.ok, true);
  assert.equal(startedB.ok, true);
  const pidA = startedA.started[0].pid;
  const pidB = startedB.started[0].pid;
  const stoppedA = await stopWatchers(sessionA, { projectRoot, graceMs: 100 });
  assert.deepStrictEqual(stoppedA.signaled, ['session-a']);
  assert.equal(processExists(pidA), false);
  assert.equal(processExists(pidB), true, 'session B process survives session A stop');
  const registryB = listRegistry(sessionB, { projectRoot });
  assert.equal(registryB.length, 1);
  assert.equal(registryB[0].pid, pidB);
  assert.equal(verifyIdentity(registryB[0]).ok, true);
  assert.deepStrictEqual(listRegistry(sessionA, { projectRoot }), []);
  await stopWatchers(sessionB, { projectRoot, graceMs: 100 });
});
