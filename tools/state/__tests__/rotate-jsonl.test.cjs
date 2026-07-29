#!/usr/bin/env node
'use strict';

/**
 * Tests for rotate-jsonl.cjs
 * Stdlib only (assert + fs + os + path + zlib + child_process). Convention
 * follows tools/maintenance/__tests__/*.test.cjs (self-tallying check() runner).
 *
 * Covers:
 *  - size-trigger rotation: cold prefix archived (gzip roundtrip), tail kept
 *  - idempotency: re-planning an already-rotated file is a no-op
 *  - tail floor: never cut into keep_tail_lines
 *  - age-trigger rotation with per-line timestamps
 *  - atomic rewrite leaves a valid live file
 *  - coverage completeness: every real _dev/state JSONL surface is classified
 *  - real classification: known surfaces covered / known state stores exempt
 *  - dry-run default and kill-switch behavior via spawn (no mutation)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const TOOL = path.resolve(__dirname, '..', 'rotate-jsonl.cjs');
const {
  planSurface,
  applyRotation,
  surfaceConfigFor,
  exemptionFor,
  globFiles,
  extractTimestamp,
  PROJECT_ROOT
} = require('../rotate-jsonl.cjs');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
  }
}

function tmpFile(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotjsonl-'));
  const file = path.join(dir, 'surface.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return { dir, file };
}

const DAY = 24 * 60 * 60 * 1000;

// ── size trigger + gzip roundtrip + tail floor ────────────────────────────
check('size trigger archives cold prefix and keeps tail', () => {
  const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(40) }));
  const { dir, file } = tmpFile(lines);
  try {
    const cfg = { max_bytes: 100, keep_tail_lines: 10, max_age_days: null };
    const plan = planSurface(file, cfg, Date.now());
    assert.ok(plan, 'expected a rotation plan');
    assert.strictEqual(plan.trigger, 'size');
    assert.strictEqual(plan.cut, 90, 'cut everything above the 10-line tail floor');
    assert.strictEqual(plan.kept, 10);

    const dest = path.join(dir, 'archive.jsonl.gz');
    applyRotation(plan, dest);

    // Archive contains the cold prefix, decompressible and complete.
    const restored = zlib.gunzipSync(fs.readFileSync(dest)).toString('utf8').trim().split('\n');
    assert.strictEqual(restored.length, 90);
    assert.deepStrictEqual(JSON.parse(restored[0]), { n: 0, pad: 'x'.repeat(40) });

    // Live file now holds only the recent tail, still valid JSONL.
    const liveLines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.strictEqual(liveLines.length, 10);
    assert.deepStrictEqual(JSON.parse(liveLines[0]), { n: 90, pad: 'x'.repeat(40) });
    assert.deepStrictEqual(JSON.parse(liveLines[9]), { n: 99, pad: 'x'.repeat(40) });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── idempotency ────────────────────────────────────────────────────────────
check('re-planning an already-rotated file is a no-op', () => {
  const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(40) }));
  const { dir, file } = tmpFile(lines);
  try {
    const cfg = { max_bytes: 100, keep_tail_lines: 10, max_age_days: null };
    const first = planSurface(file, cfg, Date.now());
    applyRotation(first, path.join(dir, 'a.gz'));
    const second = planSurface(file, cfg, Date.now());
    assert.strictEqual(second, null, 're-run must be a no-op (idempotent)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('tail floor blocks rotation when total <= keep_tail_lines', () => {
  const lines = Array.from({ length: 5 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(999) }));
  const { dir, file } = tmpFile(lines);
  try {
    const cfg = { max_bytes: 1, keep_tail_lines: 10, max_age_days: null }; // huge file, tiny limit
    const plan = planSurface(file, cfg, Date.now());
    assert.strictEqual(plan, null, 'must not drop recent history below the floor');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── age trigger ────────────────────────────────────────────────────────────
check('age trigger archives aged prefix, capped by tail floor', () => {
  const now = Date.now();
  const old = new Date(now - 200 * DAY).toISOString();
  const recent = new Date(now - 1 * DAY).toISOString();
  const lines = [
    ...Array.from({ length: 30 }, () => JSON.stringify({ ts: old, v: 'aged' })),
    ...Array.from({ length: 20 }, () => JSON.stringify({ ts: recent, v: 'fresh' }))
  ];
  const { dir, file } = tmpFile(lines);
  try {
    const cfg = { max_bytes: 10 * 1024 * 1024, keep_tail_lines: 5, max_age_days: 90 };
    const plan = planSurface(file, cfg, now);
    assert.ok(plan, 'expected an age-triggered plan');
    assert.strictEqual(plan.trigger, 'age');
    assert.strictEqual(plan.cut, 30, 'cut exactly the 30 aged lines (well above the 5-line floor)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('age trigger respects tail floor', () => {
  const now = Date.now();
  const old = new Date(now - 200 * DAY).toISOString();
  const lines = Array.from({ length: 50 }, () => JSON.stringify({ ts: old, v: 'aged' }));
  const { dir, file } = tmpFile(lines);
  try {
    const cfg = { max_bytes: 10 * 1024 * 1024, keep_tail_lines: 20, max_age_days: 90 };
    const plan = planSurface(file, cfg, now);
    assert.ok(plan);
    assert.strictEqual(plan.cut, 30, 'all aged, but floor keeps the last 20');
    assert.strictEqual(plan.kept, 20);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('extractTimestamp reads common timestamp fields', () => {
  const t = Date.parse('2026-01-01T00:00:00Z');
  assert.strictEqual(extractTimestamp(JSON.stringify({ ts: '2026-01-01T00:00:00Z' })), t);
  assert.strictEqual(extractTimestamp(JSON.stringify({ timestamp: '2026-01-01T00:00:00Z' })), t);
  assert.strictEqual(extractTimestamp('not json'), null);
  assert.strictEqual(extractTimestamp(JSON.stringify({ no_ts: 1 })), null);
});

// ── coverage completeness against the real repo inventory ─────────────────
check('every real _dev/state JSONL surface is covered or exempt (0 unclassified)', () => {
  const all = globFiles('_dev/state/**/*.jsonl')
    .map((abs) => path.relative(PROJECT_ROOT, abs).split(path.sep).join('/'));
  const unclassified = all.filter((rel) => !exemptionFor(rel) && !surfaceConfigFor(rel));
  assert.deepStrictEqual(
    unclassified, [],
    `unclassified _dev/state JSONL surfaces (add policy or exemption in CONFIG):\n  ${unclassified.join('\n  ')}`
  );
});

check('known surfaces classify as expected', () => {
  assert.ok(surfaceConfigFor('_dev/state/kernel-heartbeat-history.jsonl'), 'heartbeat history is covered');
  assert.ok(exemptionFor('_dev/state/memory-edges/edges.jsonl'), 'graph store is exempt');
  assert.ok(exemptionFor('_dev/state/plan-review-gate/overrides.jsonl'), 'override authority is exempt');
  // contextual-hints: pick a real one and assert exempt
  const hint = globFiles('_dev/state/contextual-hints/**/*.jsonl')[0];
  if (hint) {
    const rel = path.relative(PROJECT_ROOT, hint).split(path.sep).join('/');
    assert.ok(exemptionFor(rel), 'contextual-hints logs are exempt');
  }
});

// ── dry-run default + kill-switch via spawn (no mutation) ─────────────────
check('default run is dry-run and mutates nothing', () => {
  const r = spawnSync('node', [TOOL], { encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, `exit 0 expected; stderr: ${r.stderr}`);
  assert.ok(/DRY RUN/.test(r.stdout), 'default must announce dry-run');
  assert.ok(!/APPLY MODE/.test(r.stdout));
});

check('kill-switch halts before any work', () => {
  const swDir = path.join(PROJECT_ROOT, '_dev', 'state', 'rotate-jsonl');
  const sw = path.join(swDir, 'disabled');
  const preexisting = fs.existsSync(sw);
  if (!preexisting) fs.mkdirSync(swDir, { recursive: true });
  fs.writeFileSync(sw, 'test');
  try {
    const r = spawnSync('node', [TOOL, '--apply'], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 0);
    assert.ok(/Kill-switch present/.test(r.stdout), 'kill-switch must short-circuit even under --apply');
  } finally {
    if (!preexisting) fs.rmSync(sw, { force: true });
  }
});

console.log(`\nrotate-jsonl: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
