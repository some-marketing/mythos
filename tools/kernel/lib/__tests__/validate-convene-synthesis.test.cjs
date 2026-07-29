'use strict';

/**
 * Unit tests for the synthesis-required validator (REJECT_HOLLOW_COMPLETION).
 * Run: node --test tools/kernel/lib/__tests__/validate-convene-synthesis.test.cjs
 *
 * Builds throwaway convene-run dirs in a temp dir; never mutates real convene
 * runs. Covers the codex distinct-review REJECT: a size+keyword body must NOT
 * pass — only a genuine cross-slot synthesis does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  validateConveneSynthesis,
  MIN_BYTES,
  MIN_DISTINCT_CONTENT_WORDS,
  MIN_SLOT_REFERENCES
} = require('../validate-convene-synthesis.cjs');

// A skeleton exactly like tools/convene/lib/artifacts.js emits (placeholders intact).
const SKELETON = [
  '# Convene synthesis skeleton',
  '',
  '**Scope:** demo-scope',
  '**Origin:** claude',
  '',
  '## Task',
  '',
  'Some task text that makes the file comfortably exceed the minimum byte floor so',
  'that the ONLY reason it is rejected is the unfilled skeleton placeholders below.',
  '',
  '## ALPHA / claude',
  '',
  '[ORIGIN SLOT/ACTOR FILLS THIS IN AFTER READING PARTICIPANT RESPONSES]',
  '',
  '## Cross-verification catches',
  '',
  '[SYNTHESIS SECTION: which slot caught which issue, where they agreed, where they disagreed]',
  '',
  '## Net findings',
  '',
  '[ONE-VOICE SUMMARY: speak as the kernel/profile, not as three consultants.]',
  ''
].join('\n');

// A real, filled-in synthesis: references the slots, has structure, diverse prose.
const REAL_SYNTHESIS = [
  '# Convene synthesis — demo scope',
  '',
  '- Scope: demo-scope',
  '- Profile: kernel (consequence-grade)',
  '- Verdict: APPROVED WITH CONDITIONS',
  '',
  '## Cross-verification catches',
  'codex caught the self-approval hole; gemini widened the frame to gating decay;',
  'claude conceded the drift. All three converged on observability substitutes for approval.',
  '',
  '## Net findings',
  'Default posture is autonomous execution under continuous projection. The gate fires',
  'only at the consequential perimeter. This is a real, written-through synthesis, not a stub.',
  ''
].join('\n');

function makeRun(name, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'convene-synth-'));
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [fname, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, fname), content);
  }
  return { root, dir };
}

test('skeleton-only convene dir (no synthesis.md) => INVALID, hollow', () => {
  const { dir } = makeRun('run-skel', { 'synthesis-skeleton.md': SKELETON });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /synthesis\.md missing/);
});

test('synthesis.md that is just the unfilled skeleton => INVALID (placeholders)', () => {
  const { dir } = makeRun('run-copied-skel', {
    'synthesis-skeleton.md': SKELETON,
    'synthesis.md': SKELETON
  });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /skeleton/i);
});

test('real filled-in synthesis.md => VALID', () => {
  const { dir } = makeRun('run-real', {
    'synthesis-skeleton.md': SKELETON,
    'synthesis.md': REAL_SYNTHESIS
  });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, true, r.reason);
  assert.match(r.reason, /substantive/);
});

test('tiny stub synthesis.md (< MIN_BYTES) => INVALID', () => {
  const { dir } = makeRun('run-tiny', { 'synthesis.md': '# done\n' });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /too short/);
});

// --- Codex REJECT coverage: a FAKE synthesis must not pass ---

test('EXACT codex smoke (# Notes + Verdict: ok + repeated filler) => INVALID', () => {
  const smoke = '# Notes\nVerdict: ok\n'
    + 'this is padding filler content that repeats verbatim again and again\n'.repeat(40);
  const { dir } = makeRun('run-smoke', { 'synthesis.md': smoke });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, false); // caught (no slot references)
});

test('keyword-padded body mentioning slots but low diversity => INVALID (substance)', () => {
  // Mentions codex + gemini + "Verdict"/"findings" but is mostly repeated low-entropy words.
  const pad = '# Notes about codex and gemini\nVerdict: ok findings here\n'
    + 'blah blah blah blah blah blah blah blah\n'.repeat(30);
  const { dir } = makeRun('run-pad', { 'synthesis.md': pad });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /insufficient substantive content|keyword-padded/);
});

test('slots + structure + diversity but filler-dominated lines => INVALID (filler)', () => {
  const body = [
    '# Convene synthesis — codex and gemini and claude reviewed the proposal',
    'Verdict: approved with conditions after cross-verification across all three lobes.',
    'The findings cover latency, retries, caching, idempotency, rollback, and blast radius.',
    ''
  ].join('\n')
    + 'padding padding padding here again and again now today\n'.repeat(30);
  const { dir } = makeRun('run-filler', { 'synthesis.md': body });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /repeated\/low-entropy filler|duplicate lines/);
});

test('diverse prose mentioning slots but NO verdict/findings section => INVALID (structure)', () => {
  const body = [
    '# Discussion notes',
    'The codex analysis and the gemini perspective explored several architectural',
    'tradeoffs, latency budgets, retry semantics, idempotency keys, and downstream',
    'caching behaviour across the proposed pipeline stages without reaching closure.'
  ].join('\n');
  const { dir } = makeRun('run-nostructure', { 'synthesis.md': body });
  const r = validateConveneSynthesis(dir);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /verdict\/findings\/net-findings/);
});

test('unreadable / missing dir => INVALID (fail-closed), never throws', () => {
  const r = validateConveneSynthesis(path.join(os.tmpdir(), 'definitely-does-not-exist-' + Date.now()));
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /unreadable or missing/);
});

test('path that is a file, not a dir => INVALID (fail-closed)', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'convene-synth-')), 'afile');
  fs.writeFileSync(f, 'x');
  const r = validateConveneSynthesis(f);
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /not a directory/);
});

test('exports are present and reasonable', () => {
  assert.ok(MIN_BYTES >= 100 && MIN_BYTES <= 500);
  assert.ok(MIN_DISTINCT_CONTENT_WORDS >= 5);
  assert.strictEqual(MIN_SLOT_REFERENCES, 2);
});
