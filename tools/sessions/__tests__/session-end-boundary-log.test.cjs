'use strict';

// session-end-boundary-log.test.cjs — covers the L3 leak-check step wired
// into the SessionEnd boundary-log writer (plan reflexive-artifact-durability).
//
// Three arms per AC3:
//   1. leaky close — the validator finds a leak; the warn output names the
//      offending path.
//   2. clean-close control — no leaks; the quiet single line fires, no warn.
//   3. validator-crash arm — the validator throws; session end still
//      completes (runLeakCheckStep returns null, no throw escapes).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runLeakCheckStep, STAGED_VALIDATOR_PATH, buildLogEntry } = require('../session-end-boundary-log.cjs');

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeSink() {
  const lines = [];
  const fn = (...args) => lines.push(args.join(' '));
  fn.lines = lines;
  return fn;
}

// A fake validator module shaped like the real
// tools/verify/scratch-leak-check.cjs export:
// { runScratchLeakCheck({root}) => {ok, leaks, scanned, skipped, ...} }
function fakeValidator(resultOrFn) {
  return {
    runScratchLeakCheck: (opts) => {
      if (typeof resultOrFn === 'function') return resultOrFn(opts);
      return resultOrFn;
    },
  };
}

// --- Arm 1: leaky close — warn fires, names the offending path ------------

test('leaky close: warn output names the offending artifact and path', () => {
  const warn = makeSink();
  const log = makeSink();
  const validator = fakeValidator({
    ok: false,
    leaks: [
      { artifact: '_dev/state/task-plan-reviews/leaky-plan.json', field_or_line: 'artifact_path', offending_path: '/private/tmp/claude-501/scratchpad/leaky.json' },
    ],
    scanned: 3,
    skipped: 0,
  });

  const result = runLeakCheckStep({ validator, warn, log, root: tmpRoot('leak-close-') });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(log.lines.length, 0, 'a leaky close must not print the quiet OK line');
  assert.ok(warn.lines.length >= 2, 'expected a summary warn line plus at least one per-leak line');
  assert.ok(warn.lines[0].startsWith('[scratch-leak-warn]'), 'warn lines must be greppable via the [scratch-leak-warn] prefix');
  const joined = warn.lines.join('\n');
  assert.ok(joined.includes('_dev/state/task-plan-reviews/leaky-plan.json'), 'warn output must name the offending artifact');
  assert.ok(joined.includes('/private/tmp/claude-501/scratchpad/leaky.json'), 'warn output must name the offending path');
});

// --- Arm 2: clean-close control — quiet line, no warn ----------------------

test('clean close: quiet single line with scanned count, no warn', () => {
  const warn = makeSink();
  const log = makeSink();
  const validator = fakeValidator({ ok: true, leaks: [], scanned: 5, skipped: 1 });

  const result = runLeakCheckStep({ validator, warn, log, root: tmpRoot('clean-close-') });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(warn.lines.length, 0, 'a clean close must never warn');
  assert.strictEqual(log.lines.length, 1, 'a clean close prints exactly one quiet line');
  assert.ok(log.lines[0].startsWith('[scratch-leak-check]'));
  assert.ok(log.lines[0].includes('5'), 'quiet line must surface the scanned count (reflexivity: execution is observable)');
});

// --- Arm 3: validator crash — session end still completes ------------------

test('validator crash: runLeakCheckStep never throws, reports null, warns once', () => {
  const warn = makeSink();
  const log = makeSink();
  const validator = {
    runScratchLeakCheck: () => {
      throw new Error('simulated validator crash');
    },
  };

  let result;
  assert.doesNotThrow(() => {
    result = runLeakCheckStep({ validator, warn, log, root: tmpRoot('crash-close-') });
  }, 'a validator crash must never escape runLeakCheckStep — session end must complete');

  assert.strictEqual(result, null);
  assert.strictEqual(log.lines.length, 0);
  assert.strictEqual(warn.lines.length, 1);
  assert.ok(warn.lines[0].startsWith('[scratch-leak-warn]'));
  assert.ok(/never blocking session end/.test(warn.lines[0]));
});

// --- Validator-load-failure arm: same never-block contract as a run crash --

test('validator load failure (bad require path) is caught the same way as a run crash', () => {
  const warn = makeSink();
  const log = makeSink();

  // Simulate a load failure by having the injected "validator" throw when
  // accessed as a getter — but runLeakCheckStep only calls loadValidator()
  // internally when no validator is injected, so drive this arm by passing
  // an object whose runScratchLeakCheck itself throws a require-shaped error,
  // exercising the same catch branch loadValidator() would hit.
  const validator = {
    get runScratchLeakCheck() {
      throw new Error("Cannot find module 'nonexistent'");
    },
  };

  let result;
  assert.doesNotThrow(() => {
    result = runLeakCheckStep({ validator, warn, log, root: tmpRoot('load-fail-') });
  });
  assert.strictEqual(result, null);
  assert.strictEqual(warn.lines.length, 1);
  assert.ok(warn.lines[0].startsWith('[scratch-leak-warn]'));
});

// --- Real (non-mocked) STAGED_VALIDATOR_PATH resolves and runs -------------

test('STAGED_VALIDATOR_PATH resolves to a module exporting runScratchLeakCheck', () => {
  const resolved = require.resolve(path.join(__dirname, '..', STAGED_VALIDATOR_PATH));
  const mod = require(resolved);
  assert.strictEqual(typeof mod.runScratchLeakCheck, 'function');
});

test('default (no injected validator) call against an empty fixture root reports quietly, no throw', () => {
  const warn = makeSink();
  const log = makeSink();
  const emptyRoot = tmpRoot('empty-root-');
  // No _dev/state or _dev/reports under emptyRoot -> nothing selected -> ok:true, scanned:0.
  let result;
  assert.doesNotThrow(() => {
    result = runLeakCheckStep({ warn, log, root: emptyRoot });
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.scanned, 0);
  assert.strictEqual(warn.lines.length, 0);
  assert.strictEqual(log.lines.length, 1);
});

// --- Regression: buildLogEntry (pre-existing behavior) is untouched --------

test('buildLogEntry still reports pending markers via the boundary lib (regression)', () => {
  const root = tmpRoot('boundary-log-regress-');
  const entry = buildLogEntry({ mode: 'hard' });
  // No canonical-root scoping applied here (default opts) — this asserts the
  // shape survives, not specific pending content, since it reads whatever
  // real per-scope markers exist for the invoking process's root resolution.
  assert.strictEqual(entry.schema, 'SessionBoundaryLog/1.0');
  assert.strictEqual(entry.event, 'session_end');
  assert.strictEqual(typeof entry.pending_marker_present, 'boolean');
  assert.strictEqual(typeof entry.pending_marker_count, 'number');
  assert.ok(Array.isArray(entry.pending_scopes));
  void root; // fixture unused directly; buildLogEntry resolves its own root
});
