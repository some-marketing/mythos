#!/usr/bin/env node
'use strict';

/**
 * Tests for run-hygiene-sweep.cjs (the hygiene lane supervisor).
 * Stdlib only. Self-tallying check() runner.
 *
 * Covers:
 *  - exit-code aggregation: all-ok -> success; any ran-nonzero child -> failure
 *  - child-missing: OPTIONAL child recorded 'missing' and tolerated; a
 *    missing/skipped REQUIRED child forces success=false
 *  - interpreter-missing: recorded 'skipped'; same required/optional rule
 *  - kill-switch: the tool short-circuits (exit 0, no output) when disabled
 *
 * The supervisor's child pipeline is injectable (runSweep(children)), so these
 * tests drive fast synthetic children instead of the real 8-tool pipeline.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.resolve(__dirname, '..', 'run-hygiene-sweep.cjs');
const { runSweep, KILL_SWITCH } = require('../run-hygiene-sweep.cjs');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`FAIL  ${name}`); console.error(err.stack || err.message); }
}

// Write a tiny node child that exits with a given code.
function childExiting(dir, name, code) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `process.exit(${code});\n`);
  return { label: name, bin: 'node', script: p, args: [] };
}

check('all-ok children -> success true, all statuses ok', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsweep-'));
  try {
    const children = [childExiting(dir, 'a.cjs', 0), childExiting(dir, 'b.cjs', 0)];
    const rec = runSweep(children);
    assert.strictEqual(rec.success, true);
    assert.deepStrictEqual(rec.steps.map((s) => s.status), ['ok', 'ok']);
    assert.deepStrictEqual(rec.steps.map((s) => s.exit_code), [0, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('one non-zero child -> success false, others still ok (aggregation)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsweep-'));
  try {
    const children = [childExiting(dir, 'a.cjs', 0), childExiting(dir, 'b.cjs', 3), childExiting(dir, 'c.cjs', 0)];
    const rec = runSweep(children);
    assert.strictEqual(rec.success, false);
    assert.deepStrictEqual(rec.steps.map((s) => s.status), ['ok', 'failed', 'ok']);
    assert.strictEqual(rec.steps[1].exit_code, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('missing child script -> recorded missing, not fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsweep-'));
  try {
    const children = [
      childExiting(dir, 'a.cjs', 0),
      { label: 'ghost', bin: 'node', script: path.join(dir, 'does-not-exist.cjs'), args: [] }
    ];
    const rec = runSweep(children);
    assert.strictEqual(rec.steps[1].status, 'missing');
    assert.strictEqual(rec.success, true, 'a missing child must be tolerated');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('missing interpreter -> recorded skipped, not fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsweep-'));
  try {
    const good = childExiting(dir, 'a.cjs', 0);
    // Point at a real script but an interpreter binary that does not exist.
    const children = [good, { label: 'no-interp', bin: 'definitely-not-a-real-binary-xyz', script: good.script, args: [] }];
    const rec = runSweep(children);
    assert.strictEqual(rec.steps[1].status, 'skipped');
    assert.strictEqual(rec.success, true, 'a missing interpreter must be tolerated');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── FIX 4: required vs optional child success semantics ─────────────────────
check('missing REQUIRED child forces success=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsweep-'));
  try {
    const children = [
      childExiting(dir, 'a.cjs', 0),
      // A required label pointed at a non-existent script -> status 'missing'.
      { label: 'rotate-jsonl', bin: 'node', script: path.join(dir, 'gone.cjs'), args: [] }
    ];
    const rec = runSweep(children);
    assert.strictEqual(rec.steps[1].status, 'missing');
    assert.strictEqual(rec.success, false, 'a missing REQUIRED child must fail the sweep');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('skipped REQUIRED child (bad interpreter) forces success=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsweep-'));
  try {
    const good = childExiting(dir, 'a.cjs', 0);
    const children = [
      good,
      { label: 'manifest-schema-sweep', bin: 'definitely-not-a-real-binary-xyz', script: good.script, args: [] }
    ];
    const rec = runSweep(children);
    assert.strictEqual(rec.steps[1].status, 'skipped');
    assert.strictEqual(rec.success, false, 'a skipped REQUIRED child must fail the sweep');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('missing OPTIONAL child is tolerated (success stays true)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsweep-'));
  try {
    const children = [
      childExiting(dir, 'a.cjs', 0),
      // 'homeostasis' is env-dependent/optional -> missing tolerated.
      { label: 'homeostasis', bin: 'python3', script: path.join(dir, 'gone.py'), args: [] }
    ];
    const rec = runSweep(children);
    assert.strictEqual(rec.steps[1].status, 'missing');
    assert.strictEqual(rec.success, true, 'a missing OPTIONAL child must be tolerated');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check('kill-switch short-circuits the tool (exit 0, no output)', () => {
  const swDir = path.dirname(KILL_SWITCH);
  const preexisting = fs.existsSync(KILL_SWITCH);
  if (!preexisting) fs.mkdirSync(swDir, { recursive: true });
  fs.writeFileSync(KILL_SWITCH, 'test');
  try {
    const r = spawnSync('node', [TOOL, '--json'], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 0);
    assert.strictEqual((r.stdout || '').trim(), '', 'kill-switch must produce no output');
  } finally {
    if (!preexisting) fs.rmSync(KILL_SWITCH, { force: true });
  }
});

console.log(`\nrun-hygiene-sweep: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
