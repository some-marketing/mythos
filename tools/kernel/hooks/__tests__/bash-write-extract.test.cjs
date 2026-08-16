#!/usr/bin/env node
'use strict';

/**
 * bash-write-extract.test.cjs — node --test suite for the Bash write-target
 * extraction library.
 *
 * Run: node tools/scoped/write-ledger-bash-capture/__tests__/bash-write-extract.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { extractBashWrites } = require('../lib/bash-write-extract.cjs');

function candPaths(result) {
  return result.candidates.map((c) => c.path);
}

// --- redirect ---------------------------------------------------------

test('redirect: plain > target is literal', () => {
  const r = extractBashWrites('echo hi > out.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'out.txt', confidence: 'literal', mechanism: 'redirect' }]);
  assert.deepStrictEqual(r.opaque, []);
});

test('redirect: >> append target is literal', () => {
  const r = extractBashWrites('echo hi >> log.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'log.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

test('redirect: fd-numbered 2> target is literal', () => {
  const r = extractBashWrites('cmd 2> err.log');
  assert.deepStrictEqual(r.candidates, [{ path: 'err.log', confidence: 'literal', mechanism: 'redirect' }]);
});

test('redirect: &> target is literal', () => {
  const r = extractBashWrites('cmd &> all.log');
  assert.deepStrictEqual(r.candidates, [{ path: 'all.log', confidence: 'literal', mechanism: 'redirect' }]);
});

test('redirect: multiple redirects on one segment all captured', () => {
  const r = extractBashWrites('cmd > out.log 2> err.log');
  assert.deepStrictEqual(candPaths(r).sort(), ['err.log', 'out.log']);
});

// --- tee ----------------------------------------------------------------

test('tee: single target literal', () => {
  const r = extractBashWrites('echo hi | tee out.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'out.txt', confidence: 'literal', mechanism: 'tee' }]);
});

test('tee: -a flag skipped, multiple targets all literal', () => {
  const r = extractBashWrites('echo hi | tee -a one.txt two.txt');
  assert.deepStrictEqual(candPaths(r), ['one.txt', 'two.txt']);
});

// --- cp -------------------------------------------------------------------

test('cp: 2-arg rename is literal', () => {
  const r = extractBashWrites('cp a.txt b.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'b.txt', confidence: 'literal', mechanism: 'cp' }]);
});

test('cp: trailing-slash dir target is inferred from source basename', () => {
  const r = extractBashWrites('cp src/file.txt dest/');
  assert.deepStrictEqual(r.candidates, [{ path: 'dest/file.txt', confidence: 'inferred', mechanism: 'cp' }]);
});

test('cp: multiple sources into a dir target are each inferred', () => {
  const r = extractBashWrites('cp a.txt b.txt dest/');
  assert.deepStrictEqual(candPaths(r).sort(), ['dest/a.txt', 'dest/b.txt']);
  assert.ok(r.candidates.every((c) => c.confidence === 'inferred' && c.mechanism === 'cp'));
});

// --- mv -------------------------------------------------------------------

test('mv: 2-arg rename is literal', () => {
  const r = extractBashWrites('mv old.txt new.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'new.txt', confidence: 'literal', mechanism: 'mv' }]);
});

test('mv: trailing-slash dir target is inferred', () => {
  const r = extractBashWrites('mv file.txt archive/');
  assert.deepStrictEqual(r.candidates, [{ path: 'archive/file.txt', confidence: 'inferred', mechanism: 'mv' }]);
});

// --- git mv -----------------------------------------------------------

test('git mv: 2-arg rename target is literal, mechanism git-mv', () => {
  const r = extractBashWrites('git mv old.txt new.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'new.txt', confidence: 'literal', mechanism: 'git-mv' }]);
});

test('git mv: dir target with multiple sources is inferred per source', () => {
  const r = extractBashWrites('git mv a.txt b.txt dest/');
  assert.deepStrictEqual(candPaths(r).sort(), ['dest/a.txt', 'dest/b.txt']);
  assert.ok(r.candidates.every((c) => c.mechanism === 'git-mv' && c.confidence === 'inferred'));
});

test('git mv: other git subcommands are not treated as git-mv', () => {
  const r = extractBashWrites('git status');
  assert.deepStrictEqual(r.candidates, []);
  assert.deepStrictEqual(r.opaque, [{ reason: 'script-internal-writes-unknown', snippet: 'git status' }]);
});

// --- mkdir ------------------------------------------------------------

test('mkdir -p with multiple targets: all literal', () => {
  const r = extractBashWrites('mkdir -p one two/three');
  assert.deepStrictEqual(candPaths(r), ['one', 'two/three']);
  assert.ok(r.candidates.every((c) => c.confidence === 'literal' && c.mechanism === 'mkdir'));
});

// --- touch ------------------------------------------------------------

test('touch: single target literal', () => {
  const r = extractBashWrites('touch newfile.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'newfile.txt', confidence: 'literal', mechanism: 'touch' }]);
});

// --- literal vs inferred distinction (explicit) ----------------------------

test('literal vs inferred: direct token is literal, derived-from-basename is inferred', () => {
  const literal = extractBashWrites('cp a.txt b.txt');
  const inferred = extractBashWrites('cp a.txt dest/');
  assert.strictEqual(literal.candidates[0].confidence, 'literal');
  assert.strictEqual(inferred.candidates[0].confidence, 'inferred');
});

// --- opaque: command substitution --------------------------------------

test('opaque: $(...) in a redirect target is opaque, not guessed', () => {
  const r = extractBashWrites('echo hi > $(get_target)');
  assert.deepStrictEqual(r.candidates, []);
  assert.strictEqual(r.opaque.length, 1);
  assert.strictEqual(r.opaque[0].reason, 'command-substitution');
});

test('opaque: backticks in a redirect target is opaque', () => {
  const r = extractBashWrites('echo hi > `get_target`');
  assert.deepStrictEqual(r.candidates, []);
  assert.strictEqual(r.opaque[0].reason, 'command-substitution');
});

// --- opaque: inline interpreters ---------------------------------------

test('opaque: node -e is opaque, no candidates guessed', () => {
  const r = extractBashWrites('node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"');
  assert.deepStrictEqual(r.candidates, []);
  assert.strictEqual(r.opaque[0].reason, 'inline-interpreter-writes-unknown');
});

test('opaque: python -c is opaque', () => {
  const r = extractBashWrites("python -c \"open('x','w')\"");
  assert.strictEqual(r.opaque[0].reason, 'inline-interpreter-writes-unknown');
});

test('opaque: ruby -e is opaque', () => {
  const r = extractBashWrites("ruby -e \"File.write('x','y')\"");
  assert.strictEqual(r.opaque[0].reason, 'inline-interpreter-writes-unknown');
});

test('opaque: perl -e is opaque', () => {
  const r = extractBashWrites("perl -e \"open(F,'>x')\"");
  assert.strictEqual(r.opaque[0].reason, 'inline-interpreter-writes-unknown');
});

// --- opaque: $VAR target -------------------------------------------------

test('opaque: $VAR redirect target is opaque, not resolved', () => {
  const r = extractBashWrites('echo hi > $OUTFILE');
  assert.deepStrictEqual(r.candidates, []);
  assert.strictEqual(r.opaque[0].reason, 'variable-expansion');
});

// --- opaque: unknown script invocation ----------------------------------

test('opaque: unrecognized executable with no shell write operator is opaque', () => {
  const r = extractBashWrites('./deploy.sh --prod');
  assert.deepStrictEqual(r.candidates, []);
  assert.strictEqual(r.opaque[0].reason, 'script-internal-writes-unknown');
});

test('safe-readonly commands never produce a script-internal-writes-unknown opaque entry', () => {
  const r = extractBashWrites('ls -la');
  assert.deepStrictEqual(r.candidates, []);
  assert.deepStrictEqual(r.opaque, []);
});

// --- unknown executable + redirect on the same segment ------------------
//
// F1 fix: a redirect target on an unknown executable's output must still be
// captured AND the unknown executable's own (unmodeled) internal writes must
// still get their opaque marker — the redirect must not silently suppress
// the opaque check. An allowlisted read-only command with a redirect (e.g.
// `echo hi > f`) must NOT gain a spurious opaque entry.

test('unknown-script-with-redirect: redirect candidate AND opaque marker both emitted', () => {
  const r = extractBashWrites('./my-script.sh > log.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'log.txt', confidence: 'literal', mechanism: 'redirect' }]);
  assert.deepStrictEqual(r.opaque, [{ reason: 'script-internal-writes-unknown', snippet: './my-script.sh > log.txt' }]);
});

test('echo-with-redirect: allowlisted read-only command with a redirect yields the candidate only, no spurious opaque', () => {
  const r = extractBashWrites('echo hi > f');
  assert.deepStrictEqual(r.candidates, [{ path: 'f', confidence: 'literal', mechanism: 'redirect' }]);
  assert.deepStrictEqual(r.opaque, []);
});

// --- multi-command line: redirect + opaque segment both reported --------

test('multi-command: a redirect segment and an opaque segment are both reported', () => {
  const r = extractBashWrites('echo hi > out.txt; node -e "evil()"');
  assert.deepStrictEqual(r.candidates, [{ path: 'out.txt', confidence: 'literal', mechanism: 'redirect' }]);
  assert.strictEqual(r.opaque.length, 1);
  assert.strictEqual(r.opaque[0].reason, 'inline-interpreter-writes-unknown');
});

test('multi-command: && and | chains are each split into their own segment', () => {
  const r = extractBashWrites('mkdir -p out && cp a.txt out/');
  assert.deepStrictEqual(candPaths(r).sort(), ['out', 'out/a.txt']);
});

// --- quote-aware paths with spaces --------------------------------------

test('quote-aware: double-quoted redirect target with a space is one literal path', () => {
  const r = extractBashWrites('echo hi > "my file.txt"');
  assert.deepStrictEqual(r.candidates, [{ path: 'my file.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

test('quote-aware: single-quoted redirect target with a space is one literal path', () => {
  const r = extractBashWrites("echo hi > 'my file.txt'");
  assert.deepStrictEqual(r.candidates, [{ path: 'my file.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

test('quote-aware: single quotes make $ literal, not a variable expansion', () => {
  const r = extractBashWrites("echo hi > 'lit$erally.txt'");
  assert.deepStrictEqual(r.candidates, [{ path: 'lit$erally.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

test('quote-aware: cp source and dest each containing spaces', () => {
  const r = extractBashWrites('cp "a file.txt" "b file.txt"');
  assert.deepStrictEqual(r.candidates, [{ path: 'b file.txt', confidence: 'literal', mechanism: 'cp' }]);
});

// --- over-budget (4KB complexity budget) --------------------------------

test('over-budget: a command over 4096 bytes short-circuits with truncated:true', () => {
  const huge = 'echo ' + 'a'.repeat(5000) + ' > out.txt';
  const r = extractBashWrites(huge);
  assert.deepStrictEqual(r, { candidates: [], opaque: [{ reason: 'over-budget' }], truncated: true });
});

test('over-budget: exactly at the boundary (4096 bytes) still analyzes normally', () => {
  // pad so total byte length is exactly 4096
  const prefix = 'echo ';
  const suffix = ' > out.txt';
  const padLen = 4096 - Buffer.byteLength(prefix + suffix, 'utf8');
  const cmd = prefix + 'a'.repeat(padLen) + suffix;
  assert.strictEqual(Buffer.byteLength(cmd, 'utf8'), 4096);
  const r = extractBashWrites(cmd);
  assert.strictEqual(r.truncated, false);
  assert.deepStrictEqual(r.candidates, [{ path: 'out.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

// --- unparseable segment --------------------------------------------------

test('unparseable-segment: an unbalanced quote is reported opaque, not guessed', () => {
  const r = extractBashWrites('echo "unterminated > out.txt');
  assert.deepStrictEqual(r.candidates, []);
  assert.strictEqual(r.opaque.length, 1);
  assert.strictEqual(r.opaque[0].reason, 'unparseable-segment');
});

// --- cwd resolution -------------------------------------------------------

test('cwd resolution: relative redirect target resolves against provided cwd', () => {
  const r = extractBashWrites('echo hi > out.txt', { cwd: '/repo/sub' });
  assert.deepStrictEqual(r.candidates, [{ path: '/repo/sub/out.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

test('cwd resolution: absolute redirect target is unaffected by cwd', () => {
  const r = extractBashWrites('echo hi > /var/log/out.txt', { cwd: '/repo/sub' });
  assert.deepStrictEqual(r.candidates, [{ path: '/var/log/out.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

test('cwd resolution: relative target with no cwd option is returned as given', () => {
  const r = extractBashWrites('echo hi > out.txt');
  assert.deepStrictEqual(r.candidates, [{ path: 'out.txt', confidence: 'literal', mechanism: 'redirect' }]);
});

test('cwd resolution: inferred cp target resolves against cwd too', () => {
  const r = extractBashWrites('cp file.txt dest/', { cwd: '/repo' });
  assert.deepStrictEqual(r.candidates, [{ path: '/repo/dest/file.txt', confidence: 'inferred', mechanism: 'cp' }]);
});

// --- newline segmentation ------------------------------------------------
//
// Live defect (caught by B4 read-back of a real session write_log.json):
// a compound command joined by a literal newline instead of ';' was never
// segmented, because the tokenizer treated '\n' as ordinary whitespace, not
// a top-level separator. The whole multi-line compound collapsed into one
// segment, so the first command's mechanism (mkdir) silently swallowed every
// later-line word — including the next command's own name and its
// allowlisted-command arguments — as bogus extra mkdir targets.

test('newline segmentation: exact live-shape repro — mkdir NEWLINE ls && echo ok yields only the mkdir target', () => {
  const r = extractBashWrites(
    'mkdir -p tools/scoped/shadow-tree-removal/__tests__/__fixtures__\nls && echo ok'
  );
  assert.deepStrictEqual(r.candidates, [
    { path: 'tools/scoped/shadow-tree-removal/__tests__/__fixtures__', confidence: 'literal', mechanism: 'mkdir' },
  ]);
  assert.deepStrictEqual(r.opaque, []);
});

test('newline segmentation: \\r\\n is treated as a single separator, not two', () => {
  const r = extractBashWrites('mkdir -p one\r\nls && echo ok');
  assert.deepStrictEqual(r.candidates, [{ path: 'one', confidence: 'literal', mechanism: 'mkdir' }]);
});

test('newline segmentation: a bare newline alone splits segments like ;', () => {
  const r = extractBashWrites('mkdir -p one\nmkdir -p two');
  assert.deepStrictEqual(candPaths(r), ['one', 'two']);
  assert.ok(r.candidates.every((c) => c.mechanism === 'mkdir' && c.confidence === 'literal'));
});

// General regression: for every mechanism, appending a newline-joined
// allowlisted compound (NEWLINE ls && echo ok) must never contribute extra
// candidates or opaque entries beyond the mechanism's own targets — no
// operator token and no later-command word can be swallowed as an earlier
// mechanism's target.
const NEWLINE_REGRESSION_CASES = [
  { mechanism: 'redirect', cmd: 'echo hi > out.txt' },
  { mechanism: 'tee', cmd: 'echo hi | tee out.txt' },
  { mechanism: 'cp', cmd: 'cp a.txt b.txt' },
  { mechanism: 'mv', cmd: 'mv old.txt new.txt' },
  { mechanism: 'git-mv', cmd: 'git mv old.txt new.txt' },
  { mechanism: 'mkdir', cmd: 'mkdir -p one' },
  { mechanism: 'touch', cmd: 'touch newfile.txt' },
];

for (const { mechanism, cmd } of NEWLINE_REGRESSION_CASES) {
  test(`newline segmentation: ${mechanism} NEWLINE ls && echo ok yields only ${mechanism}'s own targets`, () => {
    const baseline = extractBashWrites(cmd);
    const joined = extractBashWrites(`${cmd}\nls && echo ok`);
    assert.deepStrictEqual(joined.candidates, baseline.candidates);
    assert.deepStrictEqual(joined.opaque, []);
    assert.ok(joined.candidates.every((c) => c.mechanism === mechanism));
  });
}
