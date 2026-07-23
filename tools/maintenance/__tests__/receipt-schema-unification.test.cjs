#!/usr/bin/env node
'use strict';

/**
 * Cross-tool lane-health receipt schema unification test (grounding A2, FIX 1).
 *
 * Every hygiene/self-heal writer must emit the SAME canonical receipt shape,
 * produced by the shared writer tools/maintenance/lib/hygiene-lane-health.cjs
 * (Node) or its field-for-field twin in tools/fleet/homeostasis.py (Python).
 *
 * Falsifiable contract: for each writer, drive its real receipt path against a
 * throwaway base and assert the emitted JSONL line carries the required fields
 * with the canonical schema id and the writer's own tool name.
 *
 * Writers covered: rotate-jsonl, artifact-cleanup, heartbeat-consumer,
 * reconcile-task-outcomes, repair-ladder (Node, shared lib) + homeostasis
 * (Python inline schema).
 *
 * Stdlib only. Run:
 *   node tools/maintenance/__tests__/receipt-schema-unification.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCHEMA = 'HygieneLaneHealth/1.0';
const REQUIRED = ['schema', 'timestamp', 'tool', 'decision', 'verification', 'outcome'];

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`FAIL  ${name}`); console.error(err.stack || err.message); }
}

function tmpBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-schema-')); }

function receiptLines(base) {
  const p = path.join(base, '_dev/reports/lifecycle/hygiene-lane-health.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function assertConformant(rec, expectedTool) {
  for (const f of REQUIRED) {
    assert.ok(Object.prototype.hasOwnProperty.call(rec, f), `missing required field '${f}' in ${JSON.stringify(rec)}`);
  }
  assert.strictEqual(rec.schema, SCHEMA, `schema must be ${SCHEMA}`);
  assert.strictEqual(rec.tool, expectedTool, `tool must be ${expectedTool}`);
  assert.ok(!Number.isNaN(Date.parse(rec.timestamp)), 'timestamp must be ISO-parseable');
  assert.strictEqual(typeof rec.decision, 'string', 'decision must be a string');
  assert.strictEqual(typeof rec.outcome, 'string', 'outcome must be a string');
  assert.ok(rec.verification && typeof rec.verification === 'object', 'verification must be an object');
}

// ── Shared Node writer, exercised through each tool's own wrapper ────────────
const NODE_WRITERS = [
  { tool: 'rotate-jsonl',       mod: '../../state/rotate-jsonl.cjs' },
  { tool: 'artifact-cleanup',   mod: '../../artifacts/artifact-cleanup.js' },
  { tool: 'heartbeat-consumer', mod: '../../kernel/heartbeat-consumer.cjs' },
];

for (const { tool, mod } of NODE_WRITERS) {
  check(`${tool}: wrapper emits a schema-conformant receipt`, () => {
    const base = tmpBase();
    try {
      const { writeLaneHealthReceipt } = require(mod);
      assert.strictEqual(typeof writeLaneHealthReceipt, 'function', `${tool} must export writeLaneHealthReceipt`);
      writeLaneHealthReceipt(
        { decision: 'test-decision', target: 'test-target', verification: { evidence: true }, outcome: 'noop' },
        { base }
      );
      const lines = receiptLines(base);
      assert.strictEqual(lines.length, 1, 'exactly one receipt line written');
      assertConformant(lines[0], tool);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
}

// ── reconcile-task-outcomes & repair-ladder use the shared appendReceipt directly.
check('reconcile-task-outcomes / repair-ladder share the canonical appendReceipt', () => {
  const base = tmpBase();
  try {
    const { appendReceipt } = require('../lib/hygiene-lane-health.cjs');
    appendReceipt({ tool: 'reconcile-task-outcomes', decision: 'observed-pending-activation', target: 'pre-acceptance-marking', verification: { observed_cycles: 1 }, outcome: 'noop' }, { base });
    appendReceipt({ tool: 'repair-ladder', decision: 'upgraded-verified-sandbox', target: 'x.json', verification: { passed: true }, outcome: 'verified-sandbox' }, { base });
    const lines = receiptLines(base);
    assert.strictEqual(lines.length, 2);
    assertConformant(lines[0], 'reconcile-task-outcomes');
    assertConformant(lines[1], 'repair-ladder');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ── Python writer (homeostasis) — inline schema must match field-for-field ──
check('homeostasis (python) emits the same canonical schema', () => {
  const base = tmpBase();
  try {
    const py = [
      'import sys',
      'from pathlib import Path',
      'sys.path.insert(0, "tools/fleet")',
      'import homeostasis',
      'homeostasis._append_receipt(Path(sys.argv[1]), decision="test-decision", target="test-target", verification={"evidence": True}, outcome="noop")',
    ].join('; ');
    const r = spawnSync('python3', ['-c', py, base], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000 });
    if (r.error && r.error.code === 'ENOENT') {
      console.error('  (skipped: python3 interpreter unavailable)');
      return;
    }
    assert.strictEqual(r.status, 0, `python writer must exit 0; stderr: ${r.stderr}`);
    const lines = receiptLines(base);
    assert.strictEqual(lines.length, 1, 'exactly one python receipt line written');
    assertConformant(lines[0], 'homeostasis');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

console.log(`\nreceipt-schema-unification: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
