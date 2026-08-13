'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  resolveTwin,
  applyAllowlistedTransforms,
  readMetadata,
  metadataMatches,
  ancestryTest,
  classifyFile,
  runTwinProof,
  CARVE_OUT_PREFIXES,
  CHECKPOINT_DATE,
} = require('../twin-proof.cjs');

const FIXTURES = path.join(__dirname, '__fixtures__', 'static');
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();

// ---------------------------------------------------------------------------
// resolveTwin
// ---------------------------------------------------------------------------

test('resolveTwin: same-relative-subpath is preferred and sole candidate', () => {
  const r = resolveTwin('foo.txt', path.join(FIXTURES, 'identical'));
  assert.strictEqual(r.resolved_twin, 'tools/foo.txt');
  assert.strictEqual(r.twin_match_method, 'same-relative-subpath-under-tools');
  assert.strictEqual(r.dual_twin, false);
});

test('resolveTwin: no-twin when neither candidate exists', () => {
  const r = resolveTwin('orphan.txt', path.join(FIXTURES, 'no-twin'));
  assert.strictEqual(r.resolved_twin, null);
  assert.strictEqual(r.dual_twin, false);
  assert.deepStrictEqual(r.candidates, []);
});

test('resolveTwin: dual-twin fails loud when both same-name and T1-rename candidates exist', () => {
  const r = resolveTwin('smos-runtime/thing.js', path.join(FIXTURES, 'dual-twin'));
  assert.strictEqual(r.dual_twin, true);
  assert.strictEqual(r.resolved_twin, null, 'dual-twin must never auto-classify a twin');
  assert.strictEqual(r.candidates.length, 2);
  assert.ok(r.candidates.includes('tools/smos-runtime/thing.js'));
  assert.ok(r.candidates.includes('tools/runtime/thing.js'));
});

// ---------------------------------------------------------------------------
// applyAllowlistedTransforms (T1-T4 pinned rules + caveats)
// ---------------------------------------------------------------------------

test('T4: SM_OS_ prefix renamed to MYTHOS_, whole-token', () => {
  const { out, fired } = applyAllowlistedTransforms(Buffer.from('export SM_OS_ROOT="/x"\n'));
  assert.strictEqual(out.toString('utf8'), 'export MYTHOS_ROOT="/x"\n');
  assert.deepStrictEqual(fired, ['T4']);
});

test('T4 caveat: SM_OS_IDENTITY_ID variable name is excluded from the rename (value-only rename in the twin)', () => {
  const { out, fired } = applyAllowlistedTransforms(Buffer.from('export SM_OS_IDENTITY_ID="sam"\n'));
  assert.strictEqual(out.toString('utf8'), 'export SM_OS_IDENTITY_ID="sam"\n', 'name must be left untouched');
  assert.deepStrictEqual(fired, [], 'no transform fires because nothing changed');
});

test('T3: CoordinationSignal/x.y schema string renamed to HandoffSignal/x.y', () => {
  const { out, fired } = applyAllowlistedTransforms(Buffer.from('const SCHEMA = "CoordinationSignal/1.0";\n'));
  assert.strictEqual(out.toString('utf8'), 'const SCHEMA = "HandoffSignal/1.0";\n');
  assert.deepStrictEqual(fired, ['T3']);
});

test('T2: smos-command-runner.cjs literal and runSmosCommand identifier renamed', () => {
  const { out, fired } = applyAllowlistedTransforms(
    Buffer.from('require("./smos-command-runner.cjs");\nrunSmosCommand(args);\n')
  );
  assert.strictEqual(
    out.toString('utf8'),
    'require("./mythos-command-runner.cjs");\nrunMythosCommand(args);\n'
  );
  assert.deepStrictEqual(fired, ['T2']);
});

test('T2 caveat: import-aliasing pattern (runMythosCommand: runSmosCommand) is left untouched', () => {
  const input = 'const { runMythosCommand: runSmosCommand } = require("./x");\nrunSmosCommand();\n';
  const { out } = applyAllowlistedTransforms(Buffer.from(input));
  const text = out.toString('utf8');
  assert.ok(
    text.includes('runMythosCommand: runSmosCommand'),
    'the aliasing declaration itself must survive untouched — blind substitution would duplicate the name'
  );
  // the free-standing call site IS renamed (that's the whole point of the alias:
  // call sites use the new name, only the aliasing declaration keeps the old one)
  assert.ok(text.includes('runMythosCommand();'));
});

test('transforms compose: T3 + T4 both fire on the same file', () => {
  const input = 'export SM_OS_ROOT="/x"\nconst SCHEMA = "CoordinationSignal/2.1";\n';
  const { fired } = applyAllowlistedTransforms(Buffer.from(input));
  assert.deepStrictEqual(fired.sort(), ['T3', 'T4']);
});

test('binary content is never transformed (transforms_fired empty, buffer passed through)', () => {
  const bin = Buffer.from([0x00, 0x01, 0x02, 0x53, 0x4d, 0x5f, 0x4f, 0x53]); // includes a null byte
  const { out, fired, binary } = applyAllowlistedTransforms(bin);
  assert.strictEqual(binary, true);
  assert.deepStrictEqual(fired, []);
  assert.ok(out.equals(bin));
});

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------

test('readMetadata: exec bit and shebang read from the real filesystem', () => {
  const shadowMeta = readMetadata(path.join(FIXTURES, 'exec-bit', 'script.sh'));
  const twinMeta = readMetadata(path.join(FIXTURES, 'exec-bit', 'tools', 'script.sh'));
  assert.strictEqual(shadowMeta.executable, true);
  assert.strictEqual(twinMeta.executable, false);
  assert.strictEqual(shadowMeta.shebang, '#!/usr/bin/env bash');
  assert.strictEqual(metadataMatches(shadowMeta, twinMeta), false);
});

test('metadataMatches: symlink target mismatch fails the match', () => {
  const a = { type: 'symlink', target: '/a', executable: null };
  const b = { type: 'symlink', target: '/b', executable: null };
  assert.strictEqual(metadataMatches(a, b), false);
});

// ---------------------------------------------------------------------------
// classifyFile — one fixture per required diff_class (v4 F7/F8)
// ---------------------------------------------------------------------------

test('classifyFile: identical pair -> identical, deletable', () => {
  const r = classifyFile(path.join(FIXTURES, 'identical'), 'foo.txt');
  assert.strictEqual(r.diff_class, 'identical');
  assert.strictEqual(r.deletable, true);
  assert.strictEqual(r.dual_twin, false);
});

test('classifyFile: transform-only pair (env rename) -> allowlisted-transform, deletable', () => {
  const r = classifyFile(path.join(FIXTURES, 'transform-only'), 'env.sh');
  assert.strictEqual(r.diff_class, 'allowlisted-transform');
  assert.ok(r.transforms_fired.includes('T4'));
  assert.ok(r.transforms_fired.includes('T3'));
  assert.ok(r.transforms_fired.includes('T2'));
  assert.strictEqual(r.deletable, true);
});

test('classifyFile: dual-twin case -> DUAL_TWIN_STOP, never auto-classified, not deletable', () => {
  const r = classifyFile(path.join(FIXTURES, 'dual-twin'), 'smos-runtime/thing.js');
  assert.strictEqual(r.diff_class, 'DUAL_TWIN_STOP');
  assert.strictEqual(r.dual_twin, true);
  assert.strictEqual(r.deletable, false);
});

test('classifyFile: exec-bit mismatch -> metadata_stop true, never deletable even though content is byte-identical', () => {
  const r = classifyFile(path.join(FIXTURES, 'exec-bit'), 'script.sh');
  assert.strictEqual(r.diff_class, 'identical', 'content itself is byte-identical');
  assert.strictEqual(r.metadata_stop, true, 'exec-bit mismatch is NEVER allowlisted');
  assert.strictEqual(r.deletable, false, 'metadata_stop must block deletable even for identical content');
});

test('classifyFile: no-twin file -> no-twin, not deletable', () => {
  const r = classifyFile(path.join(FIXTURES, 'no-twin'), 'orphan.txt');
  assert.strictEqual(r.diff_class, 'no-twin');
  assert.strictEqual(r.deletable, false);
});

test('classifyFile: binary file (.pyc), identical bytes -> identical, deletable', () => {
  const r = classifyFile(path.join(FIXTURES, 'binary-identical'), 'data.pyc');
  assert.strictEqual(r.diff_class, 'identical');
  assert.strictEqual(r.deletable, true);
});

test('classifyFile: binary file (.pyc), diverged bytes, no twin history -> residual-diverged, not deletable', () => {
  const r = classifyFile(path.join(FIXTURES, 'binary-diverged'), 'data.pyc');
  assert.strictEqual(r.diff_class, 'residual-diverged');
  assert.strictEqual(r.deletable, false);
  assert.strictEqual(r.ancestry.ancestry_pass, false, 'these fixtures have no git history at all');
});

// ---------------------------------------------------------------------------
// ancestry test (v4 F4): path-history-only, coexistence vs evolved
// ---------------------------------------------------------------------------

function buildGitFixtureRepo({ twinLastCommitDate }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-proof-ancestry-'));
  const run = (args, env) => execFileSync('git', args, { cwd: tmp, env: { ...process.env, ...env } });

  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'twin-proof-test']);

  fs.mkdirSync(path.join(tmp, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tools', 'twin.txt'), 'ORIGINAL CONTENT\n');
  run(['add', 'tools/twin.txt']);
  run(['commit', '-q', '-m', 'origin commit'], {
    GIT_AUTHOR_DATE: '2026-05-01T00:00:00',
    GIT_COMMITTER_DATE: '2026-05-01T00:00:00',
  });

  // The commit that changes the twin's content away from what the shadow
  // still holds, dated either AT the checkpoint (coexistence: twin never
  // touched again after the checkpoint) or AFTER it (evolved).
  fs.writeFileSync(path.join(tmp, 'tools', 'twin.txt'), 'UPDATED CONTENT\n');
  run(['add', 'tools/twin.txt']);
  const isoDate = `${twinLastCommitDate}T12:00:00`;
  run(['commit', '-q', '-m', 'twin evolves'], {
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  });

  fs.writeFileSync(path.join(tmp, 'shadow.txt'), 'ORIGINAL CONTENT\n');
  return tmp;
}

test('ancestryTest: coexistence when twin_last_commit == checkpoint date (both sides frozen at the checkpoint)', () => {
  const tmp = buildGitFixtureRepo({ twinLastCommitDate: CHECKPOINT_DATE });
  const r = ancestryTest(tmp, path.join(tmp, 'shadow.txt'), 'tools/twin.txt');
  assert.strictEqual(r.ancestry_pass, true);
  assert.strictEqual(r.class, 'coexistence');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ancestryTest: evolved when twin_last_commit is after the checkpoint', () => {
  const tmp = buildGitFixtureRepo({ twinLastCommitDate: '2026-08-05' });
  const r = ancestryTest(tmp, path.join(tmp, 'shadow.txt'), 'tools/twin.txt');
  assert.strictEqual(r.ancestry_pass, true);
  assert.strictEqual(r.class, 'evolved');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ancestryTest: no match anywhere in twin history -> ancestry_pass false', () => {
  const tmp = buildGitFixtureRepo({ twinLastCommitDate: '2026-08-05' });
  fs.writeFileSync(path.join(tmp, 'shadow.txt'), 'NEVER SEEN IN HISTORY\n');
  const r = ancestryTest(tmp, path.join(tmp, 'shadow.txt'), 'tools/twin.txt');
  assert.strictEqual(r.ancestry_pass, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// carve-out assertion (AC6)
// ---------------------------------------------------------------------------

test('runTwinProof: carve-out prefixes never produce a deletable file (mechanical assertion)', () => {
  const result = runTwinProof({ repoRoot: FIXTURES, dirs: [] });
  assert.deepStrictEqual(result.carve_out_assertion.carve_out_prefixes, CARVE_OUT_PREFIXES);
  assert.strictEqual(result.carve_out_assertion.violations.length, 0);
  assert.strictEqual(result.carve_out_assertion.passed, true);
});

// ---------------------------------------------------------------------------
// ACCEPTANCE FIXTURE (v4): real repo, --dirs lib,claude,signals,codex,hooks,
// diffed against a frozen per-file expected table generated from the
// production run of this same tool (see acceptance-expected.json — frozen
// 2026-08-12; regenerate deliberately, never silently, if the shadow tree
// itself changes before deletion lands).
//
// The v1 5-dir inventory (shadow-tree-removal__inventory.json) only ever
// tested ONE transform (SM_OS_ROOT->MYTHOS_ROOT) and found 2
// allowlisted-transform + 71 diverged + 57 identical + 2 no-twin = 132.
// v4's full T1-T4 allowlist reclassifies more of those 71 as
// allowlisted-transform (22 here) and, critically, the ancestry test further
// splits the remaining residual-diverged files into 'coexistence' (both
// sides frozen at the checkpoint — not evolution) and 'evolved' (twin kept
// moving after the checkpoint). That split is the documented v4 delta from
// v1/v2/normalized and is asserted explicitly below, not fudged into a
// single frozen snapshot with no explanation.
// ---------------------------------------------------------------------------

test('ACCEPTANCE: 5-dir production run matches the frozen expected table exactly', () => {
  const expected = JSON.parse(
    fs.readFileSync(path.join(__dirname, '__fixtures__', 'acceptance-expected.json'), 'utf8')
  );
  const result = runTwinProof({ repoRoot: REPO_ROOT, dirs: ['lib', 'claude', 'signals', 'codex', 'hooks'] });

  assert.deepStrictEqual(result.counts, expected.counts);

  const byPath = new Map(result.files.map((f) => [f.path, f]));
  for (const ef of expected.files) {
    const af = byPath.get(ef.path);
    assert.ok(af, `expected file missing from live run: ${ef.path}`);
    assert.strictEqual(af.diff_class, ef.diff_class, `diff_class drift on ${ef.path}`);
    assert.strictEqual(af.resolved_twin, ef.resolved_twin, `twin resolution drift on ${ef.path}`);
    assert.strictEqual(af.deletable, ef.deletable, `deletable drift on ${ef.path}`);
    assert.deepStrictEqual((af.transforms_fired || []).sort(), (ef.transforms_fired || []).sort(),
      `transforms_fired drift on ${ef.path}`);
    if (ef.ancestry_class) {
      assert.strictEqual(af.ancestry && af.ancestry.class, ef.ancestry_class, `ancestry class drift on ${ef.path}`);
    }
  }
  assert.strictEqual(result.files.length, expected.files.length, 'file-count drift between live run and frozen table');
});

test('ACCEPTANCE: v4 delta — the two "frozen at checkpoint on both sides" artifacts are coexistence, not evolved', () => {
  // codewhale F5: the withdrawn '48 residuals all canonical-side-newer'
  // generalization was falsified by exactly these two files. v4's fix is the
  // twin_last_commit-based coexistence/evolved split in ancestryTest.
  const result = runTwinProof({ repoRoot: REPO_ROOT, dirs: ['codex', 'signals'] });
  const byPath = new Map(result.files.map((f) => [f.path, f]));
  const a = byPath.get('codex/prompts/smos-command.md');
  const b = byPath.get('signals/cowork-bridge-README.md');
  assert.strictEqual(a.diff_class, 'residual-diverged');
  assert.strictEqual(a.ancestry.class, 'coexistence');
  assert.strictEqual(a.deletable, false);
  assert.strictEqual(b.diff_class, 'residual-diverged');
  assert.strictEqual(b.ancestry.class, 'coexistence');
  assert.strictEqual(b.deletable, false);
});

test('ACCEPTANCE: v4 delta — hooks/ files are no-twin (2 of 2, both live-registered elsewhere, not this tool\'s call)', () => {
  const result = runTwinProof({ repoRoot: REPO_ROOT, dirs: ['hooks'] });
  assert.strictEqual(result.files.length, 2);
  for (const f of result.files) {
    assert.strictEqual(f.diff_class, 'no-twin');
    assert.strictEqual(f.deletable, false);
  }
});

test('ACCEPTANCE: v4 delta — exec-bit mismatches match the known 10-file list exactly, all stopped', () => {
  const result = runTwinProof({ repoRoot: REPO_ROOT, dirs: ['lib', 'claude', 'signals', 'codex', 'hooks'] });
  assert.strictEqual(result.exec_bit.unexpected.length, 0, 'no NEW exec-bit mismatches beyond the known list');
  assert.strictEqual(result.exec_bit.hits.length, 10);
  for (const f of result.files) {
    if (result.exec_bit.hits.includes(f.path)) {
      assert.strictEqual(f.deletable, false, `${f.path}: exec-bit mismatch must never be deletable`);
    }
  }
});

test('ACCEPTANCE: v4 delta — lib/canonical-root.cjs (the root-cause file) is allowlisted-transform (T4 only), not a hand-wave', () => {
  // The content divergence is a single SM_OS_ROOT->MYTHOS_ROOT rename; the
  // actual ECANONROOT danger is a structural depth fact (documented in the
  // task plan and S2's reference-proof), not something a per-file byte diff
  // can or should catch — S1 only proves content/metadata parity.
  const r = classifyFile(REPO_ROOT, 'lib/canonical-root.cjs');
  assert.strictEqual(r.diff_class, 'allowlisted-transform');
  assert.deepStrictEqual(r.transforms_fired, ['T4']);
  assert.strictEqual(r.deletable, true);
});
