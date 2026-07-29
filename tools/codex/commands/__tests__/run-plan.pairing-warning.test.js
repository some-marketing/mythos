'use strict';

/**
 * Tests for /run-plan repair-plan pairing-warning refusal (SH1 close-the-loops).
 *
 * Falsifiable contract:
 *   - A LIVE pairing warning (sister missing OR older than the warning) blocks
 *     /run-plan (exit 2), and the refusal names the exact .warning sidecar path.
 *   - The warning self-clears once the sister file is (re)written after the
 *     warning (sister-file sync) — /run-plan then proceeds past the pairing gate.
 *   - No sidecar -> no pairing block.
 *
 * Run: node --test tools/codex/commands/__tests__/run-plan.pairing-warning.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { emitShadowCursorReceipt, isShadowCursorEnabled, runPlan } = require('../run-plan');
const { hashPlanPair } = require('../../../planning/lib/plan-run-gate');
const { sha256Bytes } = require('../../../verify/lib/run-evidence-index.cjs');

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runplan-pair-'));
  const planDir = path.join(root, '_dev/reports/analysis/task-plans');
  fs.mkdirSync(planDir, { recursive: true });
  return { root, planDir };
}

function writePlanJson(planDir, taskId) {
  const p = path.join(planDir, `${taskId}__plan.json`);
  fs.writeFileSync(p, JSON.stringify({ task_id: taskId, bounded_plan: { steps: [] } }, null, 2));
  return p;
}

function writeSidecar(jsonPath, sidecar) {
  fs.writeFileSync(jsonPath + '.warning', JSON.stringify(sidecar, null, 2) + '\n');
  return jsonPath + '.warning';
}

test('LIVE pairing warning (sister missing) blocks run-plan and names the sidecar', () => {
  const { root, planDir } = makeRepo();
  const jsonPath = writePlanJson(planDir, 'demo-plan');
  const mdPath = jsonPath.replace(/\.json$/, '.md'); // deliberately NOT created
  const sidecarPath = writeSidecar(jsonPath, {
    hook_id: 'post-write-repair-plan-pairing',
    triggered_at: new Date().toISOString(),
    file_path: jsonPath,
    paired_path: mdPath,
  });

  const res = runPlan(root, 'demo-plan');
  assert.equal(res.exitCode, 2);
  assert.match(res.stdout, /repair-plan-pairing-warning-live/);
  assert.ok(res.stdout.includes(sidecarPath), 'refusal names the exact .warning sidecar path');
  assert.match(res.stdout, /\/repair-plan demo-plan/);
});

test('warning clears once the sister file is written after the trigger', () => {
  const { root, planDir } = makeRepo();
  const jsonPath = writePlanJson(planDir, 'demo-plan');
  const mdPath = jsonPath.replace(/\.json$/, '.md');
  // Warning triggered in the past...
  writeSidecar(jsonPath, {
    hook_id: 'post-write-repair-plan-pairing',
    triggered_at: new Date(Date.now() - 60000).toISOString(),
    file_path: jsonPath,
    paired_path: mdPath,
  });
  // ...then the operator syncs the sister file NOW (mtime > trigger).
  fs.writeFileSync(mdPath, '# demo-plan\n');

  const res = runPlan(root, 'demo-plan');
  // Past the pairing gate: not a pairing block. (resolveAuthority may still
  // decide, but it must NOT be the pairing-warning refusal.)
  assert.ok(!/repair-plan-pairing-warning-live/.test(res.stdout || ''),
    'synced sister must clear the pairing warning');
});

test('stale sister (older than warning) stays LIVE and blocks', () => {
  const { root, planDir } = makeRepo();
  const jsonPath = writePlanJson(planDir, 'demo-plan');
  const mdPath = jsonPath.replace(/\.json$/, '.md');
  // Sister written first (old)...
  fs.writeFileSync(mdPath, '# stale\n');
  const oldTime = new Date(Date.now() - 120000);
  fs.utimesSync(mdPath, oldTime, oldTime);
  // ...then a bypass single-sided write triggers the warning AFTER it.
  writeSidecar(jsonPath, {
    hook_id: 'post-write-repair-plan-pairing',
    triggered_at: new Date().toISOString(),
    file_path: jsonPath,
    paired_path: mdPath,
  });

  const res = runPlan(root, 'demo-plan');
  assert.equal(res.exitCode, 2);
  assert.match(res.stdout, /repair-plan-pairing-warning-live/);
});

test('no sidecar -> no pairing block', () => {
  const { root, planDir } = makeRepo();
  writePlanJson(planDir, 'demo-plan');
  const res = runPlan(root, 'demo-plan');
  assert.ok(!/repair-plan-pairing-warning-live/.test(res.stdout || ''));
});

test('shadow cursor is default-off and blocked gates emit no state', () => {
  const { root } = makeRepo();
  assert.equal(isShadowCursorEnabled({}), false);
  assert.deepEqual(emitShadowCursorReceipt(root, 'demo-plan', { status: 'ready' }, {}, { env: {} }), { emitted: false, reason: 'feature_disabled' });
  assert.deepEqual(emitShadowCursorReceipt(root, 'demo-plan', { status: 'blocked' }, {}, { env: { SMOS_SHADOW_CURSOR: '1' } }), { emitted: false, reason: 'gate_not_ready' });
  assert.equal(fs.existsSync(path.join(root, '_dev/state/plan-execution-cursor')), false);
});

test('enabled shadow cursor appends an advisory receipt without a coordinator step', () => {
  const { root, planDir } = makeRepo();
  const taskId = 'demo-plan';
  const jsonPath = path.join(planDir, `${taskId}__plan.json`);
  const mdPath = path.join(planDir, `${taskId}__plan.md`);
  const plan = { task_id: taskId, bounded_plan: { steps: [{ step_id: 'S1', status: 'pending', depends_on: [], description: 'operator decision', execution: { kind: 'operator_gate', gate_ref: 'human_operator', mode: 'REVIEW_ONLY', write_scope: 'none' } }] } };
  const jsonBytes = `${JSON.stringify(plan, null, 2)}\n`;
  const markdownBytes = '# demo\n';
  fs.writeFileSync(jsonPath, jsonBytes); fs.writeFileSync(mdPath, markdownBytes);
  fs.mkdirSync(path.join(root, 'instructions/canonical/commands'), { recursive: true });
  fs.writeFileSync(path.join(root, 'instructions/canonical/commands/run-plan.yaml'), '{}\n');
  fs.mkdirSync(path.join(root, '_dev/state'), { recursive: true });
  const hashes = hashPlanPair(jsonBytes, markdownBytes);
  const gate = { schema: 'PlanRunGateDecision/1.0', task_id: taskId, status: 'ready', evaluated_at: '2026-07-15T00:00:00Z', json_sha256: sha256Bytes(jsonBytes), markdown_sha256: sha256Bytes(markdownBytes), plan_pair_sha256: hashes.plan_pair_sha256, marker_sha256: 'a'.repeat(64), reason_codes: [], checks: [], authority: 'run_authorization_only' };
  const result = emitShadowCursorReceipt(root, taskId, gate, { MYTHOS_TRACE_ID: 'trace', MYTHOS_SPAN_ID: 'span' }, { env: { SMOS_SHADOW_CURSOR: '1' }, observedAt: '2026-07-15T00:00:00Z' });
  assert.equal(result.emitted, true, result.reason);
  assert.equal(result.receipt.coordinator_step_id, null);
  assert.equal(result.receipt.cursor_result, 'operator_gate');
  assert.equal(result.receipt.can_execute, false);
  assert.equal(fs.readFileSync(result.target, 'utf8').trim().split('\n').length, 1);
});
