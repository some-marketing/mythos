'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  resolveToken,
  extractReferences,
  extractCodeReferences,
  extractConfigValueReferences,
  extractPlistValueReferences,
  extractMarkdownCommandReferences,
  extractByKind,
  classifyReference,
  classifySurfaceKind,
  isOperativeSurface,
  buildAltTest,
  runReferenceProof,
  runFalsifierArm,
  dirsFromCensus,
  loadDeleteCandidateSet,
  SELF_EXCLUDE_PREFIX,
} = require('../reference-proof.cjs');

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const FIXTURES = path.join(__dirname, '__fixtures__');

const TARGET_DIRS = ['lib', 'claude', 'signals', 'codex', 'ai-bridge'];
const CARVE_OUT_DIRS = ['hooks', 'boot', 'commands', 'launchd', 'macos-tcc', 'notify', 'custody'];
const ALT_TEST = buildAltTest([...TARGET_DIRS, ...CARVE_OUT_DIRS]);

// ---------------------------------------------------------------------------
// resolveToken — the four resolution rules
// ---------------------------------------------------------------------------

test('resolveToken: template-var prefix (${CLAUDE_PROJECT_DIR}/...) strips to repo-root-relative', () => {
  const r = resolveToken('${CLAUDE_PROJECT_DIR}/hooks/session-lifecycle/session-end-close.cjs', 'anything/whatever.json', REPO_ROOT);
  assert.strictEqual(r.resolved, 'hooks/session-lifecycle/session-end-close.cjs');
  assert.strictEqual(r.method, 'template-var-stripped');
});

test('resolveToken: absolute path under the real repo root strips to repo-relative', () => {
  const token = `${REPO_ROOT}/signals/lib/actor-registry.cjs`;
  const r = resolveToken(token, 'somewhere/file.js', REPO_ROOT);
  assert.strictEqual(r.resolved, 'signals/lib/actor-registry.cjs');
  assert.strictEqual(r.method, 'absolute-repo-root-stripped');
});

test('resolveToken: absolute path outside the repo root is not a repo reference', () => {
  const r = resolveToken('/usr/bin/env', 'somewhere/file.js', REPO_ROOT);
  assert.strictEqual(r, null);
});

test('resolveToken: ../ relative token resolves against the declaring file\'s own directory', () => {
  const r = resolveToken('../../signals/lib/actor-registry', 'ai-bridge/lib/routing-policy.js', REPO_ROOT);
  assert.strictEqual(r.resolved, 'signals/lib/actor-registry');
  assert.strictEqual(r.method, 'declaring-file-relative');
});

test('resolveToken: ./ relative token resolves against the declaring file\'s own directory', () => {
  const r = resolveToken('./canonical-root.cjs', 'lib/index.js', REPO_ROOT);
  assert.strictEqual(r.resolved, 'lib/canonical-root.cjs');
});

test('resolveToken: bare token (no leading dot/slash/template) is repo-root-relative', () => {
  const r = resolveToken('codex/smos-launcher.js', 'launchd/some.plist', REPO_ROOT);
  assert.strictEqual(r.resolved, 'codex/smos-launcher.js');
  assert.strictEqual(r.method, 'bare-repo-root-relative');
});

test('resolveToken: empty token resolves to null', () => {
  assert.strictEqual(resolveToken('', 'a/b.js', REPO_ROOT), null);
});

test('resolveToken: bare "./" resolves to the declaring file\'s own directory, not null', () => {
  const r = resolveToken('./', 'a/b.js', REPO_ROOT);
  assert.strictEqual(r.resolved, 'a');
});

// ---------------------------------------------------------------------------
// extractReferences
// ---------------------------------------------------------------------------

test('extractReferences: finds a quoted relative reference and records source line', () => {
  const content = 'line one\nconst x = require("../../signals/lib/actor-registry");\n';
  const refs = extractReferences(content, 'ai-bridge/lib/routing-policy.js', ALT_TEST, REPO_ROOT);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].resolved_target, 'signals/lib/actor-registry');
  assert.strictEqual(refs[0].line, 2);
});

test('extractReferences: finds a ${CLAUDE_PROJECT_DIR}-templated hook command (the v2 lesson)', () => {
  const content = '"command": "node \\"${CLAUDE_PROJECT_DIR}/hooks/session-lifecycle/session-end-close.cjs\\""';
  const refs = extractReferences(content, '.claude/settings.json', ALT_TEST, REPO_ROOT);
  assert.ok(refs.some((r) => r.resolved_target === 'hooks/session-lifecycle/session-end-close.cjs'));
});

test('extractReferences: content with no shadow-layer dir name produces zero references (fast-path)', () => {
  const content = 'this file talks about tools/foo and _dev/reports/bar only\n';
  const refs = extractReferences(content, 'somewhere/file.md', ALT_TEST, REPO_ROOT);
  assert.strictEqual(refs.length, 0);
});

test('extractReferences: bare shell invocation is captured (node codex/smos-launcher.js)', () => {
  const content = '<string>node codex/smos-launcher.js</string>\n';
  const refs = extractReferences(content, 'launchd/ca.example.plist', ALT_TEST, REPO_ROOT);
  assert.ok(refs.some((r) => r.resolved_target === 'codex/smos-launcher.js'));
});

// ---------------------------------------------------------------------------
// classifyReference — one fixture per required class
// ---------------------------------------------------------------------------

const TARGET_SET = new Set(TARGET_DIRS);
const CARVE_SET = new Set(CARVE_OUT_DIRS);

test('classifyReference: shadow-internal when the declaring file is itself in the target set', () => {
  const ref = { resolved_target: 'signals/lib/actor-registry.cjs' };
  const cls = classifyReference(ref, 'lib/canonical-root.cjs', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'shadow-internal');
});

test('classifyReference: live-external when a surviving file references a to-be-deleted dir', () => {
  const ref = { resolved_target: 'signals/lib/actor-registry.cjs' };
  const cls = classifyReference(ref, 'autonomy/lib/actor-registry.cjs', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'live-external');
  assert.ok(cls.fix.includes("tools/signals/lib/actor-registry.cjs"));
});

test('classifyReference: live-excluded-target when reference points at a carve-out dir', () => {
  const ref = { resolved_target: 'hooks/session-lifecycle/session-end-close.cjs' };
  const cls = classifyReference(ref, '.claude/settings.json', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'live-excluded-target');
});

test('classifyReference: docs-historical for a report-artifact prose citation', () => {
  const ref = { resolved_target: 'lib/canonical-root.cjs' };
  const cls = classifyReference(ref, '_dev/reports/analysis/some-report.md', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'docs-historical');
});

test('classifyReference: live signal (not /closed/) is NOT docs-historical -- normal live rules apply', () => {
  const ref = { resolved_target: 'lib/canonical-root.cjs' };
  const cls = classifyReference(ref, '_dev/reports/signals/ready-for-review/some-signal.json', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'live-external');
});

test('classifyReference: closed signal under _dev/reports/signals/closed/ IS docs-historical', () => {
  const ref = { resolved_target: 'lib/canonical-root.cjs' };
  const cls = classifyReference(ref, '_dev/reports/signals/closed/some-signal.json', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'docs-historical');
});

test('classifyReference: a reference not pointing into the shadow layer at all returns null', () => {
  const ref = { resolved_target: 'tools/lib/canonical-root.cjs' };
  const cls = classifyReference(ref, 'autonomy/lib/actor-registry.cjs', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls, null);
});

// ---------------------------------------------------------------------------
// Falsifier arm (plan-required): plant a reference in a fixture representing
// a launch surface NOT in the tool's named external-surface enumeration, and
// prove the extraction+classification pipeline still detects it. This
// exercises the same template-prefix lesson the v2 5-dir run's falsifier
// proved (a plain path-literal regex misses ${VAR}/ prefixes). The
// simulated declaring path is shell-like (.sh) so it routes through the
// v5 OPERATIVE 'code' surface -- a CI runner script's whole body is code.
// ---------------------------------------------------------------------------

test('falsifier: a planted reference in an omitted-surface-style fixture is detected end-to-end', () => {
  const fixturePath = path.join(FIXTURES, 'falsifier', 'planted-launch-surface.txt');
  assert.ok(fs.existsSync(fixturePath), 'falsifier fixture must exist on disk');
  const content = fs.readFileSync(fixturePath, 'utf8');

  // Simulate this fixture being discovered as a declaring file at a
  // repo-relative path the tool's named surfaces list does not enumerate.
  const simulatedDeclaringPath = 'ci/unforeseen-runner-config.sh';

  const refs = extractCodeReferences(content, simulatedDeclaringPath, ALT_TEST, REPO_ROOT);
  const planted = refs.find((r) => r.resolved_target === 'lib/canonical-root.cjs');
  assert.ok(planted, 'planted ${CLAUDE_PROJECT_DIR}/lib/canonical-root.cjs reference must be extracted');
  assert.strictEqual(planted.resolution_method, 'template-var-stripped');

  const cls = classifyReference(planted, simulatedDeclaringPath, TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'live-external', 'a surviving, operative declaring file referencing a to-be-deleted dir must classify live-external');
});

test('falsifier: runFalsifierArm reports {planted, detected: true} against the real repo (no delete-candidate set)', () => {
  const result = runFalsifierArm({
    repoRoot: REPO_ROOT,
    targetDirSet: new Set(['lib']),
    carveOutDirSet: new Set(CARVE_OUT_DIRS),
    deleteCandidateSet: null,
    dirNameAltTest: buildAltTest(['lib', ...CARVE_OUT_DIRS]),
  });
  assert.strictEqual(result.detected, true);
  assert.strictEqual(result.classification, 'live-external');
  assert.strictEqual(result.planted.resolved_target, 'lib/canonical-root.cjs');
});

test('falsifier: runFalsifierArm reports {planted, detected: true} against the real delete-candidate set', () => {
  const deleteCandidateSet = loadDeleteCandidateSet(
    '_dev/reports/analysis/shadow-tree-removal__inventory-full.json',
    REPO_ROOT
  );
  const result = runFalsifierArm({
    repoRoot: REPO_ROOT,
    targetDirSet: new Set(['lib']),
    carveOutDirSet: new Set(CARVE_OUT_DIRS),
    deleteCandidateSet,
    dirNameAltTest: buildAltTest(['lib', ...CARVE_OUT_DIRS]),
  });
  assert.strictEqual(result.detected, true, 'lib/canonical-root.cjs is deletable=true in the real inventory, so the falsifier must still detect live-external under the stricter set-membership rule');
});

// ---------------------------------------------------------------------------
// v5 regression arms: one per verified false-positive class from the v4
// full-layer run (3,214 live-external hits, orders of magnitude too many).
// ---------------------------------------------------------------------------

test('regression: a framework-id token in prose (.md) is docs-historical, not live-external', () => {
  // e.g. "wordpress/qa" cited in AGENTS Registered Frameworks table, or in a
  // .claude/commands/*.md doc -- a framework identifier, not a path.
  const ref = { resolved_target: 'wordpress/qa' };
  const cls = classifyReference(ref, '.claude/commands/cast-grimoire.md', new Set(['wordpress']), CARVE_SET);
  assert.strictEqual(cls.classification, 'docs-historical');
});

test('regression: a generic-dir mention in prose (.md) is docs-historical, not live-external', () => {
  // e.g. "artifacts/imported/" mentioned in a command doc's prose.
  const ref = { resolved_target: 'artifacts/imported/' };
  const cls = classifyReference(ref, '.claude/commands/claim-spoils.md', new Set(['artifacts']), CARVE_SET);
  assert.strictEqual(cls.classification, 'docs-historical');
});

test('regression: the proof machinery self-excludes its own tree from the tracked-file sweep', () => {
  assert.strictEqual(SELF_EXCLUDE_PREFIX, 'tools/scoped/shadow-tree-removal/');
  const result = runReferenceProof({
    repoRoot: REPO_ROOT,
    targetDirs: ['signals', 'lib'],
    carveOutDirs: CARVE_OUT_DIRS,
  });
  assert.ok(result.scan_roots.self_excluded.files_skipped > 0, 'expected at least one self-excluded file to be skipped (this test file, the tool itself, its fixtures)');
  const selfHits = result.references.filter((r) => r.source_file.startsWith(SELF_EXCLUDE_PREFIX));
  assert.deepStrictEqual(selfHits, [], 'no reference should ever declare from inside the proof machinery\'s own tree');
});

test('regression: an operative require() to a real delete-candidate-set file classifies live-external', () => {
  const deleteCandidateSet = new Set(['signals/lib/actor-registry.cjs']);
  const ref = { resolved_target: 'signals/lib/actor-registry.cjs', operative: true };
  const cls = classifyReference(ref, 'autonomy/lib/actor-registry.cjs', TARGET_SET, CARVE_SET, { deleteCandidateSet });
  assert.strictEqual(cls.classification, 'live-external');
});

test('regression: an operative reference resolving OUTSIDE the delete-candidate set classifies non-target, not live-external', () => {
  const deleteCandidateSet = new Set(['signals/lib/some-other-file.cjs']);
  const ref = { resolved_target: 'signals/lib/actor-registry.cjs', operative: true };
  const cls = classifyReference(ref, 'autonomy/lib/actor-registry.cjs', TARGET_SET, CARVE_SET, { deleteCandidateSet });
  assert.strictEqual(cls.classification, 'non-target');
  assert.strictEqual(cls.target_exists, false);
});

test('regression: a JSON description/prose field (non-operative JSON surface) is docs-historical', () => {
  // e.g. a task-plan or analysis report JSON that happens to mention a
  // shadow-layer-shaped string inside a free-text field.
  const ref = { resolved_target: 'signals/lib/actor-registry.cjs' };
  const cls = classifyReference(ref, '_dev/reports/analysis/some-report.json', TARGET_SET, CARVE_SET);
  assert.strictEqual(cls.classification, 'docs-historical');
});

test('classifySurfaceKind / isOperativeSurface: code, config, registry, and prose surfaces route correctly', () => {
  assert.strictEqual(classifySurfaceKind('autonomy/lib/actor-registry.cjs'), 'code');
  assert.strictEqual(classifySurfaceKind('tools/foo/bar.sh'), 'code');
  assert.strictEqual(classifySurfaceKind('.githooks/pre-push'), 'code');
  assert.strictEqual(classifySurfaceKind('.claude/settings.json'), 'config-values');
  assert.strictEqual(classifySurfaceKind('.claude/settings.local.json'), 'config-values');
  assert.strictEqual(classifySurfaceKind('package.json'), 'config-scripts');
  assert.strictEqual(classifySurfaceKind('launchd/ca.example.plist'), 'config-plist');
  assert.strictEqual(classifySurfaceKind('AGENTS.md'), 'md-registry');
  assert.strictEqual(classifySurfaceKind('_dev/reports/signals/ready-for-review__foo.json'), 'config-values');
  assert.strictEqual(classifySurfaceKind('_dev/reports/signals/closed/foo.json'), 'prose');
  assert.strictEqual(classifySurfaceKind('BUILD_LOG.md'), 'prose');
  assert.strictEqual(classifySurfaceKind('CLAUDE.md'), 'prose');
  assert.strictEqual(classifySurfaceKind('_dev/reports/analysis/some-report.json'), 'prose');
  assert.strictEqual(isOperativeSurface('autonomy/lib/actor-registry.cjs'), true);
  assert.strictEqual(isOperativeSurface('BUILD_LOG.md'), false);
});

test('extractCodeReferences: only picks up require/import/fs-call string literals, not comments or prose strings', () => {
  const content = [
    '// see docs/artifacts/notes.md for background on artifacts/imported/',
    "const x = require('../../signals/lib/actor-registry');",
    "const msg = 'this mentions signals/lib/other-thing.cjs but is not a call';",
  ].join('\n');
  const refs = extractCodeReferences(content, 'ai-bridge/lib/routing-policy.js', buildAltTest(['signals', 'artifacts']), REPO_ROOT);
  assert.strictEqual(refs.length, 1, 'only the require() call site should be extracted, not the comment or the free string');
  assert.strictEqual(refs[0].resolved_target, 'signals/lib/actor-registry');
  assert.strictEqual(refs[0].operative, true);
});

test('extractCodeReferences: .sh files strip full-line comments before scanning', () => {
  const content = [
    '#!/bin/bash',
    '# node signals/lib/actor-registry.cjs -- this is commented out, not real',
    'node signals/lib/actor-registry.cjs --check',
  ].join('\n');
  const refs = extractCodeReferences(content, 'tools/some-script.sh', buildAltTest(['signals']), REPO_ROOT);
  assert.strictEqual(refs.length, 1, 'the commented-out line must be excluded');
  assert.strictEqual(refs[0].line, 3);
});

test('extractConfigValueReferences: extracts JSON string VALUES only, not keys', () => {
  const content = JSON.stringify({
    hooks: {
      signals: 'this key name matches a target dir but keys are never scanned',
      PreToolUse: [{ hooks: [{ command: 'node "${CLAUDE_PROJECT_DIR}/signals/lib/actor-registry.cjs"' }] }],
    },
  });
  const refs = extractConfigValueReferences(content, '.claude/settings.json', buildAltTest(['signals']), REPO_ROOT);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].resolved_target, 'signals/lib/actor-registry.cjs');
  assert.strictEqual(refs[0].resolution_method, 'template-var-stripped');
});

test('extractConfigValueReferences: package.json scriptsOnly ignores non-scripts fields', () => {
  const content = JSON.stringify({
    description: 'mentions signals/lib/other.cjs in prose, should be ignored',
    scripts: { check: 'node signals/lib/actor-registry.cjs' },
  });
  const refs = extractConfigValueReferences(content, 'package.json', buildAltTest(['signals']), REPO_ROOT, { scriptsOnly: true });
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].resolved_target, 'signals/lib/actor-registry.cjs');
});

test('extractPlistValueReferences: only <string> element values are scanned', () => {
  const content = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '<!-- comment mentioning signals/lib/comment-only.cjs is not a <string> tag -->',
    '<key>ProgramArguments</key><array>',
    '<string>node</string>',
    '<string>signals/lib/actor-registry.cjs</string>',
    '</array></dict></plist>',
  ].join('\n');
  const refs = extractPlistValueReferences(content, 'launchd/ca.example.plist', buildAltTest(['signals']), REPO_ROOT);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].resolved_target, 'signals/lib/actor-registry.cjs');
});

test('extractMarkdownCommandReferences: AGENTS.md command lines are operative, everything else is not', () => {
  const content = [
    '| wordpress/qa | 16 | FINDINGS_ONLY | none |',
    'Run `node signals/lib/actor-registry.cjs --check` to verify.',
  ].join('\n');
  const refs = extractMarkdownCommandReferences(content, 'AGENTS.md', buildAltTest(['wordpress', 'signals']), REPO_ROOT);
  const tableRef = refs.find((r) => r.resolved_target === 'wordpress/qa');
  const commandRef = refs.find((r) => r.resolved_target === 'signals/lib/actor-registry.cjs');
  assert.ok(tableRef, 'the framework-id table row should still be extracted (for classification, not silently dropped)');
  assert.strictEqual(tableRef.operative, false);
  assert.ok(commandRef, 'the backtick-quoted script command should be extracted');
  assert.strictEqual(commandRef.operative, true);
});

test('extractByKind: dispatches by surface kind and prose files fall through to the broad extractor', () => {
  const content = 'See artifacts/imported/ for details.';
  const refs = extractByKind(content, 'BUILD_LOG.md', buildAltTest(['artifacts']), REPO_ROOT);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].resolved_target, 'artifacts/imported/');
  assert.strictEqual(refs[0].operative, undefined, 'prose extraction leaves operative undefined; classifyReference computes it from the declaring path');
});

test('loadDeleteCandidateSet: real inventory-full.json yields exactly the deletable=true files', () => {
  const set = loadDeleteCandidateSet('_dev/reports/analysis/shadow-tree-removal__inventory-full.json', REPO_ROOT);
  assert.strictEqual(set.size, 1014, 'must match inventory counts.deletable');
  assert.ok(set.has('lib/canonical-root.cjs'));
});

// ---------------------------------------------------------------------------
// dirsFromCensus — sanity against the real census artifact
// ---------------------------------------------------------------------------

test('dirsFromCensus: reads real census, returns 94 target dirs and 7 carve-out dirs, no overlap', () => {
  const { targetDirs, carveOutDirs } = dirsFromCensus(
    '_dev/reports/analysis/shadow-tree-removal__full-layer-census.json',
    REPO_ROOT
  );
  assert.strictEqual(targetDirs.length, 94);
  assert.strictEqual(carveOutDirs.length, 7);
  const overlap = targetDirs.filter((d) => carveOutDirs.includes(d));
  assert.deepStrictEqual(overlap, []);
});

// ---------------------------------------------------------------------------
// runReferenceProof — small real-repo smoke (bounded target-dir subset, fast)
// ---------------------------------------------------------------------------

test('runReferenceProof: small real-repo run over a 2-dir subset produces zero unclassified and finds known live-external', () => {
  const result = runReferenceProof({
    repoRoot: REPO_ROOT,
    targetDirs: ['signals', 'lib'],
    carveOutDirs: CARVE_OUT_DIRS,
  });
  assert.strictEqual(result.unclassified_count, 0);
  assert.ok(result.counts_by_classification['shadow-internal'] >= 0);
  // known live-external from the v2 5-dir run: autonomy/lib/actor-registry.cjs -> signals/lib/actor-registry
  const known = result.live_external_blockers.find(
    (r) => r.source_file === 'autonomy/lib/actor-registry.cjs' && r.resolved_target === 'signals/lib/actor-registry'
  );
  assert.ok(known, 'expected known live-external reference from autonomy/lib/actor-registry.cjs was not found');
});
