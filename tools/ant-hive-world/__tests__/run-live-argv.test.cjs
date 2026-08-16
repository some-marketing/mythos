'use strict';

// tools/ant-hive-world/__tests__/run-live-argv.test.cjs -- rider T4, plan
// srd2-boundary-crossing-trial. Proves run-live.js's strict argv gate: an
// unknown flag, an unknown positional argument, or a value-taking flag with
// a missing/flag-shaped value refuses with usage and a non-zero exit BEFORE
// any filesystem write -- and that every recognized flag still behaves
// exactly as before (a real short run still starts and writes its files).
//
// RED-STATE METHOD (documented per dispatch instruction, not left implicit):
// this test suite is written and asserts against the FIXED behavior below.
// The pre-fix (HEAD) defect was verified manually, once, outside this test
// file, rather than by making the automated suite spawn the old code: a
// child process was spawned running `git show HEAD:...run-live.js` copied to
// a scratch path but INVOKED FROM THE REAL tools/ant-hive-world/ DIRECTORY
// (so its relative `require('./harness.js')` etc. still resolved), with
// `--help --ticks 1 --sandbox-root <scratch-tmp-dir> --no-checkpoint`. On the
// unpatched driver this exited 0 after writing a full set of sandbox files
// (decision-stream.jsonl, run-log.jsonl, hive-a/hive-state.json, etc.) --
// `--help` silently started a real (if short) run, which is exactly the
// gen-2 stray-run defect this rider closes. A `--ticks 1` bound plus a
// process timeout kept that one-time manual proof from ever running a full
// 300-tick sandbox. That defect is not re-demonstrated automatically here
// (spawning unpatched historical source from a test would couple the suite
// to git plumbing for no ongoing benefit) -- this suite instead pins the
// CURRENT, FIXED behavior so any regression back to the old behavior fails
// these assertions immediately.
//
// Each spawned child uses a fresh --sandbox-root under a mkdtemp'd directory
// and --ticks 1 / a short timeout so a defect that DID start a run could
// never balloon into a real 300-tick sandbox during `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const RUN_LIVE = path.join(__dirname, '..', 'run-live.js');

function freshSandboxRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'srd2-argv-test-'));
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else count += 1;
  }
  return count;
}

function runArgv(extraArgs, sandboxRoot) {
  return spawnSync(process.execPath, [RUN_LIVE, ...extraArgs, '--sandbox-root', sandboxRoot, '--ticks', '1', '--no-checkpoint'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10000
  });
}

test('--help refuses with usage, exits 0, writes nothing', () => {
  const sandboxRoot = freshSandboxRoot();
  const result = runArgv(['--help'], sandboxRoot);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node run-live\.js/);
  assert.equal(countFiles(sandboxRoot), 0, 'no file should be written before --help refuses');
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

test('unknown flag refuses with usage, non-zero exit, writes nothing', () => {
  const sandboxRoot = freshSandboxRoot();
  const result = runArgv(['--this-flag-does-not-exist'], sandboxRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node run-live\.js/);
  assert.match(result.stderr, /unrecognized flag '--this-flag-does-not-exist'/);
  assert.equal(countFiles(sandboxRoot), 0);
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

test('unknown positional argument refuses with usage, non-zero exit, writes nothing', () => {
  const sandboxRoot = freshSandboxRoot();
  const result = runArgv(['stray-positional-token'], sandboxRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unrecognized positional argument 'stray-positional-token'/);
  assert.equal(countFiles(sandboxRoot), 0);
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

test('value-arity: value-taking flag at end of argv refuses, writes nothing', () => {
  const sandboxRoot = freshSandboxRoot();
  // --root-seed with nothing after it in the arg list (it is the LAST token
  // supplied to runArgv before the harness appends --sandbox-root/--ticks/
  // --no-checkpoint, so build the argv by hand instead of through the helper
  // to put --root-seed genuinely last).
  const result = spawnSync(process.execPath, [RUN_LIVE, '--sandbox-root', sandboxRoot, '--ticks', '1', '--no-checkpoint', '--root-seed'], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10000
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /flag --root-seed requires a value but none was given/);
  assert.equal(countFiles(sandboxRoot), 0);
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

test('value-arity: value-taking flag followed by a flag-shaped token refuses, writes nothing', () => {
  const sandboxRoot = freshSandboxRoot();
  const result = runArgv(['--root-seed', '--forever'], sandboxRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /flag --root-seed requires a value but the next token '--forever' looks like a flag/);
  assert.equal(countFiles(sandboxRoot), 0);
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

test('recognized flags still behave exactly as before: a real short run starts and writes its files', () => {
  const sandboxRoot = freshSandboxRoot();
  const result = runArgv(['--root-seed', '424242'], sandboxRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Done after 1 rounds/);
  assert.ok(fs.existsSync(path.join(sandboxRoot, 'run-log.jsonl')));
  assert.ok(fs.existsSync(path.join(sandboxRoot, 'decision-stream.jsonl')));
  assert.ok(fs.existsSync(path.join(sandboxRoot, 'shared', 'world-state.json')));
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

// ---- A2 (plan sim-foundation-repairs, S6): invalid seed values refuse ----
// run-live.js:445-464 did `parseInt(raw, 10) >>> 0` then
// `!Number.isFinite(rootSeed)`. `NaN >>> 0 === 0` and `>>> 0` always yields a
// finite integer, so the guard could never fire: `--root-seed abc` silently
// became seed 0, and `--seed-a abc` silently became seed 0 too. The fix
// validates the RAW string against /^\d+$/ BEFORE any numeric coercion
// (digits only, no sign/exponent/hex) and requires the value to fit uint32
// (0..4294967295) so overflow like 2^32 cannot silently wrap to 0 either.
// Any invalid seed input must write STATUS=invalid-root-seed and exit 1 --
// the path the dead guard was always intended to take -- with no run started.
//
// These tests pin the FIXED behavior (RED on HEAD, where the invalid seed is
// silently coerced and the run proceeds; GREEN after S6).
function assertSeedRefusal(extraArgs, extraEnv) {
  const sandboxRoot = freshSandboxRoot();
  const result = spawnSync(process.execPath, [
    RUN_LIVE, ...extraArgs, '--sandbox-root', sandboxRoot, '--ticks', '1', '--no-checkpoint'
  ], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10000,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env
  });
  try {
    assert.notEqual(result.status, 0, `expected non-zero exit; stderr was: ${result.stderr}`);
    assert.match(result.stderr, /STATUS=invalid-root-seed/);
    // Seed validation runs after the goal/resume gates have already printed
    // their fresh-start lines, so stdout is not empty -- but the run itself
    // must not have started: no "Done" line, and no run artifacts.
    assert.doesNotMatch(result.stdout, /Done after/, 'no run may complete');
    // The refusal is before any run state: no run artifacts may exist. The
    // STATUS file itself IS written (the existing refusal channel) -- check
    // its content rather than counting files.
    assert.ok(!fs.existsSync(path.join(sandboxRoot, 'run-log.jsonl')), 'no run-log may be written');
    assert.ok(!fs.existsSync(path.join(sandboxRoot, 'decision-stream.jsonl')), 'no decision-stream may be written');
    assert.ok(!fs.existsSync(path.join(sandboxRoot, 'shared', 'world-state.json')), 'no world state may be written');
    const statusPath = path.join(sandboxRoot, 'STATUS');
    assert.equal(fs.readFileSync(statusPath, 'utf8').trim(), 'invalid-root-seed');
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

test('A2: --root-seed abc (non-digit) refuses with invalid-root-seed, exit 1, no run', () => {
  assertSeedRefusal(['--root-seed', 'abc']);
});

test('A2: --root-seed -1 (negative) refuses with invalid-root-seed, exit 1, no run', () => {
  assertSeedRefusal(['--root-seed', '-1']);
});

test('A2: --root-seed 4294967296 (overflow past uint32) refuses with invalid-root-seed, exit 1, no run', () => {
  assertSeedRefusal(['--root-seed', '4294967296']);
});

test('A2: --seed-a abc (non-digit) refuses with invalid-root-seed, exit 1, no run', () => {
  assertSeedRefusal(['--seed-a', 'abc']);
});

test('A2: --seed-b -5 (negative) refuses with invalid-root-seed, exit 1, no run', () => {
  assertSeedRefusal(['--seed-b', '-5']);
});

test('A2: ROOT_SEED env abc (non-digit) refuses with invalid-root-seed, exit 1, no run', () => {
  assertSeedRefusal([], { ROOT_SEED: 'abc' });
});
