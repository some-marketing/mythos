'use strict';
//
// fabricated-attributions.test.cjs — unit + boundary tests for the
// fabricated-attributions runner built in external-skill-harvest-integration SA.2,
// plus the SA.3 slop bank.
//
// Run: node --test tools/lint/__tests__/fabricated-attributions.test.cjs
//
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.resolve(__dirname, '..', 'fabricated-attributions.cjs');
const { scanFile, classify } = require('../fabricated-attributions.cjs');
const { scanSlop, SLOP_PATTERNS } = require('../slop-patterns.js');

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-attr-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function runCli(args) {
  return spawnSync('node', [RUNNER, ...args], { encoding: 'utf8' });
}

test('detects a fabricated em-dash attribution', () => {
  const file = tmpFile('mockup.md',
    '"She turns a stage into a place where the audience leans forward."\n— Halifax Theatre Notes, 2023\n');
  const { findings } = scanFile(file);
  assert.equal(findings.length, 1, 'one fabricated finding expected');
  assert.equal(findings[0].classification, 'fabricated');
  assert.match(findings[0].attribution, /Halifax Theatre Notes/);
});

test('clean content with placeholder marker produces no fabricated finding', () => {
  const file = tmpFile('clean.md',
    'The team shipped the feature on Tuesday.\n\n"[testimonial pending — client to provide]"\n');
  const { findings } = scanFile(file);
  assert.equal(findings.length, 0, 'placeholder must not be flagged as fabricated');
});

test('classify respects evidence-backed attributions', () => {
  const evidence = new Set(['dave barrow']);
  assert.equal(classify('"Great service."', 'Dave Barrow', evidence), 'evidence-backed');
  assert.equal(classify('"Great service."', 'Halifax Theatre Notes', new Set()), 'fabricated');
  assert.equal(classify('lorem ipsum dolor sit amet', '', new Set()), 'placeholder-acceptable');
});

test('CLI exits 1 on fabricated, 0 on clean', () => {
  const fab = tmpFile('fab.md', '"Loved it."\n— Atlantic Festival Producer, 2024\n');
  const clean = tmpFile('clean2.md', 'The crew loaded the truck and drove north.\n');
  assert.equal(runCli([fab]).status, 1, 'fabricated => exit 1');
  assert.equal(runCli([clean]).status, 0, 'clean => exit 0');
});

test('CLI is non-throwing and emits valid JSON', () => {
  const clean = tmpFile('c3.md', 'Plain prose with no quotes.\n');
  const res = runCli([clean, '--json']);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.fabricated, 0);
  assert.ok(Array.isArray(parsed.findings));
});

test('--signal emits a VerificationSignal that proceeds on clean input', () => {
  const clean = tmpFile('c4.md', 'A simple sentence.\n');
  const sigPath = path.join(path.dirname(clean), 'sig.json');
  const res = runCli([clean, '--signal', sigPath]);
  assert.equal(res.status, 0);
  const sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
  assert.equal(sig.verdict, 'PASS');
  assert.equal(sig.gate_decision.proceed, true);
});

// ── NAME_SHAPED attribution boundary cases (SA.2 repair) ───────────────────────

test('FALSE-POSITIVE guard: ordinary capitalized prose with a quote does NOT flag', () => {
  // Capitalized proper nouns inside a normal sentence + a non-attributed quote.
  // No em-dash/blockquote attribution line follows, so nothing must be flagged.
  const file = tmpFile('prose.md',
    'On Monday in Halifax, Dave Barrow toured the Nova Scotia lot.\n' +
    'He said "the inventory looks strong this quarter" during the walkthrough.\n' +
    'The Atlantic Auto Group confirmed the numbers later that week.\n');
  const { findings } = scanFile(file);
  assert.equal(findings.length, 0, 'plain capitalized prose must not be flagged as fabricated');
});

test('FALSE-POSITIVE guard: a properly-cited REAL source (in evidence) is NOT flagged', () => {
  // Build a tree where a testimonials.json sits alongside the artifact, so the
  // attribution resolves as evidence-backed rather than fabricated.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-attr-evi-'));
  fs.writeFileSync(path.join(dir, 'testimonials.json'),
    JSON.stringify({ quotes: [{ author: 'Dave Barrow', text: 'Best dealership crew in the Maritimes.' }] }));
  const artifact = path.join(dir, 'deck.md');
  fs.writeFileSync(artifact,
    '"Best dealership crew in the Maritimes."\n— Dave Barrow, 2024\n');
  const { findings } = scanFile(artifact);
  assert.equal(findings.length, 0,
    'a quote attributed to a source present in testimonials.json must be evidence-backed, not fabricated');
});

test('FALSE-NEGATIVE case: a role/org attribution variant MUST flag', () => {
  // No matching evidence; an org-with-role attribution shape must still be caught.
  const file = tmpFile('mockup2.md',
    '"This venue transformed our season."\n— Maritime Arts Council, Programming Director, 2022\n');
  const { findings } = scanFile(file);
  assert.equal(findings.length, 1, 'fabricated role/org attribution variant must flag');
  assert.equal(findings[0].classification, 'fabricated');
  assert.match(findings[0].attribution, /Maritime Arts Council/);
});

// ── SA.3 slop bank ────────────────────────────────────────────────────────────

test('slop bank flags net-new prose patterns as WARN', () => {
  const hits = scanSlop("Here's the thing: the data tells us this really matters.");
  const cats = hits.map((h) => h.category);
  assert.ok(cats.includes('throat-clearing'));
  assert.ok(cats.includes('false-agency'));
  assert.ok(cats.includes('filler-adverb'));
  for (const h of hits) assert.equal(h.severity, 'warn', 'all slop patterns must be WARN-tier');
});

test('slop bank does NOT re-add copy-voice-lint duplicates (deconfliction SA.1)', () => {
  // No em-dash density, triadic-list, sentence-length, or banned ad-connective
  // tokens (game-changer/unlock/seamless) should appear as slop-bank rules.
  const ids = SLOP_PATTERNS.map((p) => p.id).join(' ');
  const cats = SLOP_PATTERNS.map((p) => p.category).join(' ');
  assert.ok(!/em-?dash/i.test(ids + cats), 'em-dash is owned by copy-voice-lint');
  assert.ok(!/triadic|three-item|breath/i.test(ids + cats), 'list/length owned by copy-voice-lint');
  // "game-changer" must not be a standalone slop phrase.
  const clean = scanSlop('This is a game-changer for our seamless workflow.');
  assert.ok(!clean.some((h) => /game-?changer|seamless/i.test(h.hit)),
    'game-changer/seamless are copy-voice-lint hard-fails, excluded here');
});

test('slop bank stays advisory: every pattern is severity warn', () => {
  for (const p of SLOP_PATTERNS) assert.equal(p.severity, 'warn');
});
