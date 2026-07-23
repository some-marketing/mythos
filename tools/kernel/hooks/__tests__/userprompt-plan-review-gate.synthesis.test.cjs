'use strict';

/**
 * REJECT_HOLLOW_COMPLETION (kernel convene 20260629T214856Z) —
 * userprompt-plan-review-gate.cjs requires a real synthesis.md before a
 * convene-run DIRECTORY counts as convene evidence for a BIG plan, behind the
 * DEFAULT-OFF flag SMOS_REQUIRE_CONVENE_SYNTHESIS.
 *
 * Falsifiable contract:
 *   - Flag OFF (default): a BIG plan whose ONLY convene evidence is a skeleton-
 *     only convene-run dir STILL PASSES, with byte-identical pass text (the
 *     critical safety / byte-unchanged proof).
 *   - Flag ON + skeleton-only convene dir => DO-NOT-EXECUTE block naming
 *     REJECT_HOLLOW_COMPLETION.
 *   - Flag ON + real synthesis.md => PASSES (same pass text as OFF).
 *   - Flag ON + operator-authored marker.convene_review => NOT subjected to the
 *     dir validation (passes) — only the auto-discovered dir loophole is gated.
 *
 * The validator is loaded by the gate from the real repo
 * (tools/kernel/lib/validate-convene-synthesis.cjs); plans/markers/convene dirs
 * are built under a throwaway temp projectRoot. Run:
 *   node --test tools/kernel/hooks/__tests__/userprompt-plan-review-gate.synthesis.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gate = require('../userprompt-plan-review-gate.cjs');

const FLAG = 'SMOS_REQUIRE_CONVENE_SYNTHESIS';

function withFlag(value, fn) {
  const prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  }
}

const SKELETON = [
  '# Convene synthesis skeleton',
  '',
  '**Scope:** demo',
  '',
  '## Cross-verification catches',
  '',
  '[SYNTHESIS SECTION: which slot caught which issue]',
  '',
  '## Net findings',
  '',
  '[ONE-VOICE SUMMARY: speak as the kernel/profile, not as three consultants.]',
  ''
].join('\n');

const REAL_SYNTHESIS = [
  '# Convene synthesis — demo',
  '',
  '- Verdict: APPROVED',
  '',
  '## Cross-verification catches',
  'codex caught the hole; gemini widened the frame; claude conceded the drift.',
  '',
  '## Net findings',
  'A genuine, written-through synthesis with real net findings — not a stub.',
  ''
].join('\n');

const CONVENE_DIRNAME_SUFFIX = '-triad';

// Build a temp projectRoot with a resolvable BIG plan (risk_tier high), a marker
// carrying a satisfying distinct review, and a convene-run dir named after the
// plan id. `synthesisState` controls what lands in that dir.
function makeRoot(planId, { synthesisState, conveneReviewField, conveneReviewPointsAtDir } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-synth-'));
  const planDir = path.join(root, '_dev/reports/analysis/task-plans');
  const markerDir = path.join(root, '_dev/state/plan-task-review-state');
  const conveneRunsDir = path.join(root, '_dev/reports/analysis/convene-runs');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  fs.mkdirSync(conveneRunsDir, { recursive: true });

  fs.writeFileSync(
    path.join(planDir, `${planId}__plan.json`),
    JSON.stringify({ task_id: planId, scope_type: 'system', routing_expectations: { risk_tier: 'high' } }, null, 2)
  );

  // Convene-run dir (always created so the loophole path is exercised). Name must
  // include the plan id for findConveneEvidence's glob.
  const dirName = `20260629T000000Z-${planId}${CONVENE_DIRNAME_SUFFIX}`;
  const conveneRef = `_dev/reports/analysis/convene-runs/${dirName}`;
  const runDir = path.join(conveneRunsDir, dirName);
  fs.mkdirSync(runDir, { recursive: true });
  if (synthesisState === 'skeleton') {
    fs.writeFileSync(path.join(runDir, 'synthesis-skeleton.md'), SKELETON);
  } else if (synthesisState === 'real') {
    fs.writeFileSync(path.join(runDir, 'synthesis-skeleton.md'), SKELETON);
    fs.writeFileSync(path.join(runDir, 'synthesis.md'), REAL_SYNTHESIS);
  }

  const marker = {
    schema: 'PlanTaskReviewState/1.0',
    plan_id: planId,
    last_event: 'distinct_review_complete',
    distinct_reviews: [{ actor: 'codex', verdict: 'approve', artifact: 'r.md' }]
  };
  // conveneReviewPointsAtDir: marker.convene_review points at the run dir created
  // above (with whatever synthesisState). conveneReviewField: a literal field value.
  if (conveneReviewPointsAtDir) {
    marker.convene_review = { artifact: conveneRef, at: '2026-06-29T00:00:00Z' };
  } else if (conveneReviewField) {
    marker.convene_review = conveneReviewField;
  }
  fs.writeFileSync(path.join(markerDir, `${planId}.json`), JSON.stringify(marker, null, 2));

  return { root, conveneRef };
}

function expectedPassText(planId, conveneRef) {
  return [
    `[plan-review-gate] PASS for ${planId}: distinct-mind review verified via marker.distinct_reviews — codex verdict "approve" (r.md).`,
    `[plan-review-gate] BIG plan (routing_expectations.risk_tier=high): convene evidence verified — ${conveneRef}.`
  ].join('\n');
}

// ---- THE KEY PROOF: flag OFF (default) is byte-unchanged ----
test('DEFAULT (flag OFF): skeleton-only convene dir STILL PASSES — byte-identical pass text', () => {
  withFlag(undefined, () => {
    const planId = 'hollow-off-plan';
    const { root, conveneRef } = makeRoot(planId, { synthesisState: 'skeleton' });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-off');
    assert.strictEqual(res.action, 'inject');
    // Exact-string equality => proves no behavioral/output drift when the flag is off.
    assert.strictEqual(res.text, expectedPassText(planId, conveneRef));
    assert.doesNotMatch(res.text, /REJECT_HOLLOW_COMPLETION/);
    assert.doesNotMatch(res.text, /DO NOT EXECUTE/);
  });
});

test('DEFAULT (flag OFF): explicitly empty env string is also OFF (skeleton still passes)', () => {
  withFlag('', () => {
    const planId = 'hollow-empty-plan';
    const { root, conveneRef } = makeRoot(planId, { synthesisState: 'skeleton' });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-empty');
    assert.strictEqual(res.text, expectedPassText(planId, conveneRef));
  });
});

// ---- Flag ON ----
test('flag ON + skeleton-only convene dir => DO-NOT-EXECUTE, REJECT_HOLLOW_COMPLETION', () => {
  withFlag('1', () => {
    const planId = 'hollow-on-plan';
    const { root } = makeRoot(planId, { synthesisState: 'skeleton' });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-on');
    assert.strictEqual(res.action, 'inject');
    assert.match(res.text, /DO NOT EXECUTE/);
    assert.match(res.text, /REJECT_HOLLOW_COMPLETION/);
    assert.match(res.text, /synthesis\.md missing/);
    // The distinct review IS satisfied — the ONLY failure is the hollow convene.
    assert.doesNotMatch(res.text, /DISTINCT-MIND \(codex\) REVIEW/);
  });
});

test('flag ON + real synthesis.md => PASSES (same pass text as OFF)', () => {
  withFlag('1', () => {
    const planId = 'real-on-plan';
    const { root, conveneRef } = makeRoot(planId, { synthesisState: 'real' });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-real');
    assert.strictEqual(res.action, 'inject');
    assert.strictEqual(res.text, expectedPassText(planId, conveneRef));
    assert.doesNotMatch(res.text, /REJECT_HOLLOW_COMPLETION/);
  });
});

// ---- MINOR (codex review): the marker.convene_review path is ALSO covered ----
test('flag ON + marker.convene_review pointing at a HOLLOW convene dir => blocked', () => {
  withFlag('1', () => {
    const planId = 'marker-hollow-plan';
    // findConveneEvidence prefers marker.convene_review (source = marker.convene_review);
    // it points at a skeleton-only dir, which must NOT satisfy the gate.
    const { root } = makeRoot(planId, { synthesisState: 'skeleton', conveneReviewPointsAtDir: true });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-mh');
    assert.strictEqual(res.action, 'inject');
    assert.match(res.text, /DO NOT EXECUTE/);
    assert.match(res.text, /REJECT_HOLLOW_COMPLETION/);
    assert.match(res.text, /marker\.convene_review/);
  });
});

test('flag ON + marker.convene_review pointing at a REAL synthesis dir => passes', () => {
  withFlag('1', () => {
    const planId = 'marker-real-plan';
    const { root } = makeRoot(planId, { synthesisState: 'real', conveneReviewPointsAtDir: true });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-mr');
    assert.strictEqual(res.action, 'inject');
    assert.doesNotMatch(res.text, /REJECT_HOLLOW_COMPLETION/);
    assert.doesNotMatch(res.text, /DO NOT EXECUTE/);
    assert.match(res.text, /PASS for marker-real-plan/);
  });
});

test('flag ON + OPAQUE marker.convene_review (no resolvable path) => left unassessed (passes)', () => {
  withFlag('1', () => {
    const planId = 'marker-opaque-plan';
    // An opaque operator note (no slash, no "convene" token) is not a dir path, so
    // it is not subjected to validation — we do not false-block operator records.
    const { root } = makeRoot(planId, {
      synthesisState: 'skeleton',
      conveneReviewField: { note: 'approved-verbally', at: '2026-06-29T00:00:00Z' }
    });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-mo');
    assert.strictEqual(res.action, 'inject');
    assert.doesNotMatch(res.text, /REJECT_HOLLOW_COMPLETION/);
    assert.doesNotMatch(res.text, /DO NOT EXECUTE/);
    assert.match(res.text, /PASS for marker-opaque-plan/);
  });
});

test('DEFAULT (flag OFF): marker.convene_review pointing at a HOLLOW dir STILL PASSES (byte-unchanged)', () => {
  withFlag(undefined, () => {
    const planId = 'marker-off-plan';
    const { root } = makeRoot(planId, { synthesisState: 'skeleton', conveneReviewPointsAtDir: true });
    const res = gate.evaluateGate(`/run-plan ${planId}`, root, 'sess-moff');
    assert.strictEqual(res.action, 'inject');
    assert.doesNotMatch(res.text, /REJECT_HOLLOW_COMPLETION/);
    assert.doesNotMatch(res.text, /DO NOT EXECUTE/);
    assert.match(res.text, /PASS for marker-off-plan/);
  });
});
