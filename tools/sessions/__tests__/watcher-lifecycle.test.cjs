'use strict';

// watcher-lifecycle.test.cjs — L1 coverage for the session-scoped watcher
// lifecycle module (plan sim-foundation-repairs, S11 / L1, AC11).
//
// Arms:
//   1. start records per-daemon process identity (pid + start_time + argv
//      fingerprint + executable + argv), immediately after spawn.
//   2. stop signals exactly the session-start set after identity
//      verification (graceful SIGTERM; signalCode evidence per child).
//   3. stale-pid cleanup removes the entry WITHOUT signaling.
//   4. foreign-pid refusal — a live pid recorded with a wrong start_time/argv
//      is refused: entry removed, occupant NOT signaled (fail closed).
//   5. PID-reuse — identity mismatch (same argv, wrong start_time) refuses
//      the signal and the entry is removed without signaling.
//   6. default watcher set resolves to real scripts under tools/signals/ and
//      launches with process.execPath (resolution only — no real spawn).
//   7. stopWatchers on a missing registry is a clean no-op.
//   8. session-id validation rejects path-traversal input.
//   9. pre-emptive cleanup pass: starting twice stops the first generation
//      (identity-verified) and never orphans duplicate daemons.
//   10. pre-emptive cleanup is identity-verified: a foreign occupant of a
//      recorded pid is refused (never signaled) and the fresh start is
//      rolled back fail-closed.
//   11. partial-start failure rolls back the already-started set and records
//      no identity for the failed spawn.
//
// Live daemons are harmless long-running children
// (node -e 'setInterval(()=>{},1000)'); every spawned process is reaped.
//
// GATE NOTE (mirrors the module header): the canonical YAML process-array
// wiring (new-session.yaml / shutdown.yaml) landed under ConveneReceipt/1.0
// sim-foundation-repairs-s11-yaml; the handler-level wiring is covered by the
// handler + drift suites. This suite exercises the lifecycle module directly.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const {
  DEFAULT_WATCHER_SET,
  startWatchers,
  stopWatchers,
  listRegistry,
  registryFilePath,
  readRegistry,
  writeRegistry,
  normalizeWatcherSet,
  normalizeStartTime,
  computeArgvFingerprint,
  verifyIdentity,
  processExists,
  spawnedChildren
} = require('../watcher-lifecycle.cjs');

const POSIX = process.platform !== 'win32';

let seq = 0;
function freshSession(root) {
  seq += 1;
  return `wtest-${process.pid}-${Date.now()}-${seq}`;
}

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-lifecycle-'));
}

// Harmless long-running child: node -e 'setInterval(()=>{},1000)'.
function spawnHarmless() {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  return child;
}

function waitExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => resolve({ code: child.exitCode, signal: child.signalCode, timedOut: true }), timeoutMs || 5000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

// Safety net: reap every child this file spawned, live or not.
const spawnedTrack = [];
function track(child) {
  spawnedTrack.push(child);
  return child;
}
after(async () => {
  for (const child of spawnedTrack) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }
  }
  for (const [key, child] of spawnedChildren().entries()) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }
  }
  // give the SIGKILLs a beat to land
  await new Promise((r) => setTimeout(r, 150));
});

const HARM_ARGS = ['-e', 'setInterval(()=>{},1000)'];

test('start records per-daemon identity: pid + start_time + executable + argv fingerprint', async () => {
  const root = freshRoot();
  const sid = freshSession(root);

  const { started, failed } = await startWatchers(
    sid,
    [
      { name: 'alpha', command: process.execPath, args: HARM_ARGS },
      { name: 'beta', command: process.execPath, args: HARM_ARGS }
    ],
    { projectRoot: root }
  );

  assert.strictEqual(failed.length, 0, `unexpected start failures: ${JSON.stringify(failed)}`);
  assert.strictEqual(started.length, 2);

  assert.ok(fs.existsSync(registryFilePath(sid, root)), 'registry file must exist');

  const entries = listRegistry(sid, { projectRoot: root });
  assert.strictEqual(entries.length, 2);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

  for (const name of ['alpha', 'beta']) {
    const entry = byName[name];
    assert.ok(entry, `entry ${name} missing`);
    assert.ok(Number.isInteger(entry.pid) && entry.pid > 0, `${name}: pid recorded`);
    assert.ok(typeof entry.start_time === 'string' && entry.start_time.trim() !== '', `${name}: start_time recorded`);
    assert.strictEqual(entry.executable, process.execPath, `${name}: executable recorded`);
    assert.ok(Array.isArray(entry.argv) && entry.argv.length >= 2, `${name}: argv recorded`);
    assert.match(entry.argv_fingerprint, /^[0-9a-f]{64}$/, `${name}: argv_fingerprint is a sha256 hex`);
  }

  // The recorded identity must verify against the live processes (POSIX).
  if (POSIX) {
    for (const name of ['alpha', 'beta']) {
      const v = verifyIdentity(byName[name], { projectRoot: root });
      assert.strictEqual(v.exists, true, `${name}: live`);
      assert.strictEqual(v.ok, true, `${name}: identity verified: ${JSON.stringify(v.mismatches)}`);
    }
  }

  const stop = await stopWatchers(sid, { projectRoot: root });
  assert.deepStrictEqual(new Set(stop.signaled), new Set(['alpha', 'beta']));
  assert.deepStrictEqual(stop.refused, []);
  assert.deepStrictEqual(stop.stale, []);
});

test('stop signals exactly the session-start set after identity verification (SIGTERM)', async () => {
  const root = freshRoot();
  const sid = freshSession(root);

  const daemonPath = path.join(root, 'daemon.cjs');
  fs.writeFileSync(daemonPath, 'setInterval(()=>{},1000);\n', 'utf8');

  const { started } = await startWatchers(
    sid,
    [
      { name: 'codex', command: process.execPath, args: HARM_ARGS },
      { name: 'actor', command: process.execPath, args: HARM_ARGS },
      { name: 'pipeline', script: daemonPath }
    ],
    { projectRoot: root }
  );
  assert.strictEqual(started.length, 3);

  // Snapshot the ChildProcess handles before stopping, for signal evidence.
  const children = {};
  for (const name of ['codex', 'actor', 'pipeline']) {
    children[name] = spawnedChildren().get(`${sid}::${name}`);
    assert.ok(children[name], `child handle for ${name} present`);
    track(children[name]);
  }

  const stop = await stopWatchers(sid, { projectRoot: root });

  // Exactly the session-start set, nothing else, nothing refused or stale.
  assert.deepStrictEqual(new Set(stop.signaled), new Set(['codex', 'actor', 'pipeline']));
  assert.deepStrictEqual(stop.refused, []);
  assert.deepStrictEqual(stop.stale, []);
  assert.strictEqual(stop.registry_missing, false);

  // Every daemon actually received the graceful signal.
  for (const name of ['codex', 'actor', 'pipeline']) {
    const { code, signal } = await waitExit(children[name]);
    assert.strictEqual(signal, 'SIGTERM', `${name}: received SIGTERM`);
    assert.strictEqual(code, null, `${name}: terminated by signal, no exit code`);
  }

  // Registry is empty after a clean stop.
  assert.deepStrictEqual(listRegistry(sid, { projectRoot: root }), []);
});

test('stale-pid cleanup removes the entry WITHOUT signaling', async () => {
  const root = freshRoot();
  const sid = freshSession(root);

  const ghost = track(spawnHarmless());
  const ghostPid = ghost.pid;
  ghost.kill('SIGKILL');
  await waitExit(ghost);
  assert.strictEqual(processExists(ghostPid), false, 'ghost pid must be dead');

  const argv = [process.execPath, ...HARM_ARGS];
  writeRegistry(
    sid,
    {
      watchers: {
        ghost: {
          name: 'ghost',
          pid: ghostPid,
          start_time: 'Mon 1 Jan 00:00:00 2000',
          executable: process.execPath,
          executable_basename: 'node',
          argv,
          argv_fingerprint: computeArgvFingerprint(argv),
          script: null
        }
      }
    },
    root
  );

  const stop = await stopWatchers(sid, { projectRoot: root });
  assert.deepStrictEqual(stop.stale, ['ghost']);
  assert.deepStrictEqual(stop.signaled, []);
  assert.deepStrictEqual(stop.refused, []);
  assert.deepStrictEqual(listRegistry(sid, { projectRoot: root }), [], 'entry removed from registry');
});

test('foreign-pid refusal: wrong start_time/argv for a live pid -> refuse, remove, do NOT signal', { skip: POSIX ? false : 'POSIX identity verification only' }, async () => {
  const root = freshRoot();
  const sid = freshSession(root);

  // Live occupant at the recorded pid — must survive stopWatchers untouched.
  const occupant = track(spawnHarmless());

  writeRegistry(
    sid,
    {
      watchers: {
        intruder: {
          name: 'intruder',
          pid: occupant.pid,
          start_time: 'Mon 1 Jan 00:00:00 2000', // wrong: not the occupant's start
          executable: '/usr/bin/bogus-executable',
          executable_basename: 'bogus-executable',
          argv: ['/usr/bin/bogus-executable', '--evil'],
          argv_fingerprint: computeArgvFingerprint(['/usr/bin/bogus-executable', '--evil']),
          script: null
        }
      }
    },
    root
  );

  const stop = await stopWatchers(sid, { projectRoot: root });

  assert.strictEqual(stop.signaled.length, 0, 'nothing may be signaled');
  assert.strictEqual(stop.stale.length, 0);
  assert.strictEqual(stop.refused.length, 1);
  assert.strictEqual(stop.refused[0].name, 'intruder');
  assert.strictEqual(stop.refused[0].reason, 'identity-mismatch-fail-closed');
  assert.ok(stop.refused[0].mismatches.includes('start_time'), 'start_time mismatch named');
  assert.ok(stop.refused[0].mismatches.includes('argv'), 'argv mismatch named');

  // Fail closed: the occupant was NOT signaled and is still alive.
  assert.strictEqual(occupant.exitCode, null, 'occupant not exited');
  assert.strictEqual(occupant.signalCode, null, 'occupant received no signal');
  assert.strictEqual(processExists(occupant.pid), true, 'occupant still alive');

  // The refused entry was removed from the registry without signaling it.
  assert.deepStrictEqual(listRegistry(sid, { projectRoot: root }), []);

  occupant.kill('SIGKILL');
  await waitExit(occupant);
});

test('PID-reuse: identity mismatch (wrong start_time, correct argv) refuses the signal', { skip: POSIX ? false : 'POSIX identity verification only' }, async () => {
  const root = freshRoot();
  const sid = freshSession(root);

  // The "reused" pid: a live process occupying the recorded pid, whose
  // argv matches the record but whose start_time proves it is NOT the
  // process the entry was written for.
  const recycled = track(spawnHarmless());
  const argv = [process.execPath, ...HARM_ARGS];

  writeRegistry(
    sid,
    {
      watchers: {
        reused: {
          name: 'reused',
          pid: recycled.pid,
          start_time: 'Sat 15 Aug 00:00:00 2026', // one day earlier: different incarnation
          executable: process.execPath,
          executable_basename: 'node',
          argv,
          argv_fingerprint: computeArgvFingerprint(argv),
          script: null
        }
      }
    },
    root
  );

  const stop = await stopWatchers(sid, { projectRoot: root });

  assert.strictEqual(stop.signaled.length, 0, 'PID-reuse must refuse the signal');
  assert.strictEqual(stop.refused.length, 1);
  assert.strictEqual(stop.refused[0].name, 'reused');
  assert.deepStrictEqual(stop.refused[0].mismatches, ['start_time'], 'single cause: identity/start_time mismatch');

  // The occupant of the reused pid was not signaled.
  assert.strictEqual(processExists(recycled.pid), true, 'recycled-pid occupant still alive');
  assert.strictEqual(recycled.signalCode, null, 'no signal delivered');

  assert.deepStrictEqual(listRegistry(sid, { projectRoot: root }), [], 'entry removed without signaling');

  recycled.kill('SIGKILL');
  await waitExit(recycled);
});

test('default watcher set resolves to real scripts under tools/signals with process.execPath', () => {
  const root = path.resolve(__dirname, '../../..');
  const entries = normalizeWatcherSet(DEFAULT_WATCHER_SET, root);

  assert.strictEqual(entries.length, 3);
  assert.deepStrictEqual(
    entries.map((e) => e.name).sort(),
    ['watch-actor-bridge', 'watch-codex-bridge', 'watch-pipeline-loop']
  );
  for (const entry of entries) {
    assert.strictEqual(entry.executable, process.execPath);
    assert.strictEqual(entry.argv[0], process.execPath);
    assert.ok(entry.script && fs.existsSync(entry.script), `${entry.name}: script exists (${entry.script})`);
    assert.strictEqual(path.basename(entry.script), `${entry.name}.js`);
  }
});

test('stopWatchers on a missing registry is a clean no-op', async () => {
  const root = freshRoot();
  const sid = freshSession(root);
  const stop = await stopWatchers(sid, { projectRoot: root });
  assert.strictEqual(stop.registry_missing, true);
  assert.deepStrictEqual(stop.signaled, []);
  assert.deepStrictEqual(stop.refused, []);
  assert.deepStrictEqual(stop.stale, []);
});

test('a failed spawn is reported in failed, rolls back the started set, and records no identity', async () => {
  const root = freshRoot();
  const sid = freshSession(root);

  const { ok, started, failed, preemptively_stopped, cleanup_refused, rolled_back } = await startWatchers(
    sid,
    [
      { name: 'ok', command: process.execPath, args: HARM_ARGS },
      { name: 'broken', command: '/nonexistent/watcher-binary', args: ['--x'] }
    ],
    { projectRoot: root }
  );

  // Partial-start failure handling: the whole call fails, the healthy
  // watcher started in THIS call is rolled back (identity-verified stop),
  // and no orphaned subset is left running.
  assert.strictEqual(ok, false, 'partial start must be reported as failure');
  assert.strictEqual(started.length, 1);
  assert.strictEqual(failed.length, 1);
  assert.strictEqual(failed[0].name, 'broken');
  assert.ok(failed[0].error, 'error message present');
  assert.deepStrictEqual(rolled_back, ['ok']);
  assert.deepStrictEqual(preemptively_stopped, []);
  assert.deepStrictEqual(cleanup_refused, []);

  // No identity was recorded for the failed spawn, and the rollback left
  // the registry empty — nothing is left running or durably recorded.
  assert.deepStrictEqual(listRegistry(sid, { projectRoot: root }), []);

  await stopWatchers(sid, { projectRoot: root });
});

test('pre-emptive cleanup: starting twice never orphans duplicate daemons', async () => {
  const root = freshRoot();
  const sid = freshSession(root);
  const set = [
    { name: 'codex', command: process.execPath, args: HARM_ARGS },
    { name: 'actor', command: process.execPath, args: HARM_ARGS }
  ];

  const first = await startWatchers(sid, set, { projectRoot: root });
  assert.strictEqual(first.ok, true, JSON.stringify(first.failed));
  assert.strictEqual(first.started.length, 2);
  assert.strictEqual(first.preemptively_stopped.length, 0, 'first start has nothing to clean up');

  // Snapshot the first generation before the second start.
  const firstChildren = {};
  const firstPids = {};
  for (const name of ['codex', 'actor']) {
    firstChildren[name] = spawnedChildren().get(`${sid}::${name}`);
    assert.ok(firstChildren[name], `${name}: first-generation child handle present`);
    track(firstChildren[name]);
    firstPids[name] = firstChildren[name].pid;
  }

  const second = await startWatchers(sid, set, { projectRoot: root });
  assert.strictEqual(second.ok, true, JSON.stringify(second.failed));
  // The first generation was pre-emptively stopped (identity-verified), and
  // a fresh generation was spawned — no duplicates, no orphaning.
  assert.deepStrictEqual(new Set(second.preemptively_stopped), new Set(['codex', 'actor']));
  assert.strictEqual(second.started.length, 2);
  assert.strictEqual(second.rolled_back.length, 0);
  assert.strictEqual(second.cleanup_refused.length, 0);

  for (const name of ['codex', 'actor']) {
    const { code, signal } = await waitExit(firstChildren[name]);
    assert.strictEqual(signal, 'SIGTERM', `${name}: first generation received SIGTERM`);
    assert.strictEqual(code, null, `${name}: terminated by signal`);
    assert.strictEqual(processExists(firstPids[name]), false, `${name}: first-generation pid gone`);
  }

  // The registry holds exactly one fresh generation with distinct pids.
  const entries = listRegistry(sid, { projectRoot: root });
  assert.strictEqual(entries.length, 2);
  for (const entry of entries) {
    assert.notStrictEqual(entry.pid, firstPids[entry.name], `${entry.name}: fresh pid`);
    const live = spawnedChildren().get(`${sid}::${entry.name}`);
    assert.ok(live && live.exitCode === null && live.signalCode === null, `${entry.name}: fresh generation live`);
  }
  if (POSIX) {
    for (const entry of entries) {
      const v = verifyIdentity(entry, { projectRoot: root });
      assert.strictEqual(v.ok, true, `${entry.name}: fresh identity verified: ${JSON.stringify(v.mismatches)}`);
    }
  }

  await stopWatchers(sid, { projectRoot: root });
});

test('pre-emptive cleanup is identity-verified: foreign occupants are refused, never signaled', { skip: POSIX ? false : 'POSIX identity verification only' }, async () => {
  const root = freshRoot();
  const sid = freshSession(root);
  const set = [{ name: 'legit', command: process.execPath, args: HARM_ARGS }];

  const first = await startWatchers(sid, set, { projectRoot: root });
  assert.strictEqual(first.ok, true, JSON.stringify(first.failed));
  const legitChild = spawnedChildren().get(`${sid}::legit`);
  assert.ok(legitChild, 'first-generation child handle present');
  track(legitChild);
  const legitPid = legitChild.pid;

  // Plant a foreign registry entry: a live process occupying the recorded
  // pid whose identity (start_time/argv) proves it is NOT our daemon.
  // stopWatchers must refuse it fail-closed — never signal the occupant.
  const occupant = track(spawnHarmless());
  writeRegistry(
    sid,
    {
      watchers: {
        legit: readRegistry(sid, root).watchers.legit,
        foreign: {
          name: 'foreign',
          pid: occupant.pid,
          start_time: 'Mon 1 Jan 00:00:00 2000',
          executable: '/usr/bin/bogus-executable',
          executable_basename: 'bogus-executable',
          argv: ['/usr/bin/bogus-executable', '--evil'],
          argv_fingerprint: computeArgvFingerprint(['/usr/bin/bogus-executable', '--evil']),
          script: null
        }
      }
    },
    root
  );

  const second = await startWatchers(sid, set, { projectRoot: root });

  // The verified first-generation daemon was pre-emptively stopped.
  assert.deepStrictEqual(second.preemptively_stopped, ['legit']);
  const { signal } = await waitExit(legitChild);
  assert.strictEqual(signal, 'SIGTERM', 'legit first generation SIGTERM');
  assert.strictEqual(processExists(legitPid), false, 'legit first-generation pid gone');

  // The foreign occupant was refused — never signaled — and the refusal is
  // a failure, so the fresh start was rolled back (fail closed).
  assert.strictEqual(second.cleanup_refused.length, 1);
  assert.strictEqual(second.cleanup_refused[0].name, 'foreign');
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.started.length, 1);
  assert.deepStrictEqual(second.rolled_back, ['legit']);
  assert.strictEqual(second.failed.length, 1);
  assert.strictEqual(second.failed[0].name, 'foreign');
  assert.match(second.failed[0].error, /pre-emptive cleanup refused/);
  assert.strictEqual(occupant.exitCode, null, 'foreign occupant not exited');
  assert.strictEqual(occupant.signalCode, null, 'foreign occupant received no signal');
  assert.strictEqual(processExists(occupant.pid), true, 'foreign occupant still alive');

  // Registry is empty: the refused entry was removed without signaling and
  // the fresh generation was rolled back.
  assert.deepStrictEqual(listRegistry(sid, { projectRoot: root }), []);

  occupant.kill('SIGKILL');
  await waitExit(occupant);
  await stopWatchers(sid, { projectRoot: root });
});

test('session-id validation rejects path-traversal input', async () => {
  const root = freshRoot();
  for (const bad of ['../evil', '../../etc/passwd', '/abs/path', 'a b']) {
    await assert.rejects(
      () => startWatchers(bad, [{ name: 'x', command: process.execPath, args: HARM_ARGS }], { projectRoot: root }),
      /invalid session_id/,
      `must reject ${JSON.stringify(bad)}`
    );
  }
});
