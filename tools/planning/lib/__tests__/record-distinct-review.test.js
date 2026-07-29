'use strict';

/**
 * recordDistinctReview — the missing distinct_reviews[] writer for the
 * plan-review-state machinery (keystone fix 2026-06-30). The mechanical gate
 * tools/kernel/hooks/userprompt-plan-review-gate.cjs reads marker.distinct_reviews
 * but no library function recorded an entry. These offline tests verify the
 * writer + the validateStateMarkerShape extension that models distinct_reviews on
 * the post_repair family.
 *
 * Run: node --test tools/planning/lib/__tests__/record-distinct-review.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('../plan-review-state');

function freshPostRepairMarker(planId) {
  return {
    plan_id: planId || 'record-distinct-review-test-plan',
    last_event: 'post_repair',
    post_repair: {
      repair_id: 'repair-1',
      timestamp: '2026-06-30T00:00:00Z',
      review_status: 'pending',
      review_reference: '_dev/reports/analysis/task-plan-reviews/x__review.md'
    }
  };
}

function writeFreshMarker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-distinct-review-'));
  const markerPath = path.join(dir, 'plan.json');
  lib.writeStateMarker(markerPath, freshPostRepairMarker());
  return markerPath;
}

// ── append creates the array ─────────────────────────────────────────────────

test('append creates distinct_reviews array when absent', () => {
  const markerPath = writeFreshMarker();
  const before = lib.readStateMarker(markerPath);
  assert.strictEqual(before.distinct_reviews, undefined, 'fresh marker has no distinct_reviews');

  const res = lib.recordDistinctReview(markerPath, {
    actor: 'codex gpt-5.5',
    artifact: '_dev/reports/analysis/codex-last-message__review.md',
    verdict: 'APPROVE',
    at: '2026-06-30T01:00:00Z'
  });
  assert.strictEqual(res.action, 'appended');

  const after = lib.readStateMarker(markerPath);
  assert.ok(Array.isArray(after.distinct_reviews));
  assert.strictEqual(after.distinct_reviews.length, 1);
  assert.deepStrictEqual(after.distinct_reviews[0], {
    actor: 'codex gpt-5.5',
    artifact: '_dev/reports/analysis/codex-last-message__review.md',
    at: '2026-06-30T01:00:00Z',
    verdict: 'APPROVE'
  });
});

test('append defaults `at` to an ISO timestamp when omitted', () => {
  const markerPath = writeFreshMarker();
  lib.recordDistinctReview(markerPath, {
    actor: 'gemini',
    artifact: 'art.md',
    verdict: 'approve'
  });
  const after = lib.readStateMarker(markerPath);
  assert.strictEqual(typeof after.distinct_reviews[0].at, 'string');
  assert.ok(!Number.isNaN(Date.parse(after.distinct_reviews[0].at)), 'at parses as a date');
});

// ── preserves review_status / last_event (recording is NOT an approval) ───────

test('recording preserves last_event and post_repair.review_status (no terminal flip)', () => {
  const markerPath = writeFreshMarker();
  lib.recordDistinctReview(markerPath, {
    actor: 'codex',
    artifact: 'art.md',
    verdict: 'APPROVE'
  });
  const after = lib.readStateMarker(markerPath);
  assert.strictEqual(after.last_event, 'post_repair', 'last_event must remain post_repair');
  assert.strictEqual(
    after.post_repair.review_status,
    'pending',
    'review_status must remain pending — recording is not an approval'
  );
  // post_repair provenance block untouched.
  assert.strictEqual(after.post_repair.repair_id, 'repair-1');
  assert.strictEqual(after.post_repair.review_reference, '_dev/reports/analysis/task-plan-reviews/x__review.md');
});

// ── dedupe on (actor + artifact) ─────────────────────────────────────────────

test('dedupe: re-recording the same (actor, artifact, verdict) does not duplicate', () => {
  const markerPath = writeFreshMarker();
  const review = { actor: 'codex', artifact: 'same.md', verdict: 'APPROVE', at: '2026-06-30T01:00:00Z' };
  lib.recordDistinctReview(markerPath, review);
  const res2 = lib.recordDistinctReview(markerPath, review);
  assert.strictEqual(res2.action, 'upserted');
  const after = lib.readStateMarker(markerPath);
  assert.strictEqual(after.distinct_reviews.length, 1, 'no duplicate entry for same actor+artifact');
});

test('upsert: same actor+artifact with a new verdict replaces in place (still length 1)', () => {
  const markerPath = writeFreshMarker();
  lib.recordDistinctReview(markerPath, { actor: 'codex', artifact: 'same.md', verdict: 'reject' });
  lib.recordDistinctReview(markerPath, { actor: 'codex', artifact: 'same.md', verdict: 'APPROVE' });
  const after = lib.readStateMarker(markerPath);
  assert.strictEqual(after.distinct_reviews.length, 1);
  assert.strictEqual(after.distinct_reviews[0].verdict, 'APPROVE');
});

test('distinct actors / distinct artifacts append as separate entries', () => {
  const markerPath = writeFreshMarker();
  lib.recordDistinctReview(markerPath, { actor: 'codex', artifact: 'a.md', verdict: 'APPROVE' });
  lib.recordDistinctReview(markerPath, { actor: 'gemini', artifact: 'a.md', verdict: 'APPROVE' });
  lib.recordDistinctReview(markerPath, { actor: 'codex', artifact: 'b.md', verdict: 'APPROVE' });
  const after = lib.readStateMarker(markerPath);
  assert.strictEqual(after.distinct_reviews.length, 3);
});

// ── schema accepts distinct_reviews on a post_repair marker ───────────────────

test('validateStateMarkerShape accepts a well-formed distinct_reviews entry on a post_repair marker', () => {
  const marker = freshPostRepairMarker();
  marker.distinct_reviews = [
    { actor: 'codex', artifact: 'art.md', at: '2026-06-30T00:00:00Z', verdict: 'APPROVE' }
  ];
  const r = lib.validateStateMarkerShape(marker);
  assert.strictEqual(r.ok, true, r.errors.join('; '));
});

test('validateStateMarkerShape tolerates null / omitted entry fields seen in live markers', () => {
  const marker = freshPostRepairMarker();
  marker.distinct_reviews = [{ actor: 'codex', verdict: 'APPROVE' }]; // artifact/at omitted
  marker.distinct_reviews_pending = [{ actor: 'codex', artifact: null, at: null, verdict: 'pending' }];
  const r = lib.validateStateMarkerShape(marker);
  assert.strictEqual(r.ok, true, r.errors.join('; '));
});

// ── an invalid entry is rejected ─────────────────────────────────────────────

test('validateStateMarkerShape rejects a non-string actor', () => {
  const marker = freshPostRepairMarker();
  marker.distinct_reviews = [{ actor: 123, artifact: 'art.md', verdict: 'APPROVE' }];
  const r = lib.validateStateMarkerShape(marker);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /distinct_reviews\[0\]\.actor must be a string/.test(e)), r.errors.join('; '));
});

test('validateStateMarkerShape rejects a non-object entry', () => {
  const marker = freshPostRepairMarker();
  marker.distinct_reviews = ['not-an-object'];
  const r = lib.validateStateMarkerShape(marker);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /distinct_reviews\[0\] must be an object/.test(e)), r.errors.join('; '));
});

test('writeStateMarker refuses a marker carrying a malformed distinct_reviews entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-distinct-review-bad-'));
  const markerPath = path.join(dir, 'plan.json');
  const marker = freshPostRepairMarker();
  marker.distinct_reviews = [{ actor: 42 }];
  assert.throws(() => lib.writeStateMarker(markerPath, marker), /distinct_reviews/);
});

// ── writer input validation + missing-marker guard ───────────────────────────

test('recordDistinctReview throws when no marker exists at the path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-distinct-review-missing-'));
  const markerPath = path.join(dir, 'absent.json');
  assert.throws(
    () => lib.recordDistinctReview(markerPath, { actor: 'codex', artifact: 'a.md', verdict: 'APPROVE' }),
    /no state marker found/
  );
});

test('recordDistinctReview requires actor, artifact, verdict', () => {
  const markerPath = writeFreshMarker();
  assert.throws(() => lib.recordDistinctReview(markerPath, { artifact: 'a.md', verdict: 'ok' }), /actor/);
  assert.throws(() => lib.recordDistinctReview(markerPath, { actor: 'c', verdict: 'ok' }), /artifact/);
  assert.throws(() => lib.recordDistinctReview(markerPath, { actor: 'c', artifact: 'a.md' }), /verdict/);
});

test('round-trip: a recorded marker re-reads cleanly through readStateMarker', () => {
  const markerPath = writeFreshMarker();
  lib.recordDistinctReview(markerPath, {
    actor: 'codex',
    artifact: 'a.md',
    verdict: 'APPROVE',
    note: 'distinct-mind review; producer was claude'
  });
  const after = lib.readStateMarker(markerPath);
  assert.strictEqual(after.distinct_reviews[0].note, 'distinct-mind review; producer was claude');
});

function writeBoundFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-bound-review-'));
  const planDir = path.join(root, '_dev/reports/analysis/task-plans');
  const markerDir = path.join(root, '_dev/state/plan-task-review-state');
  const reviewDir = path.join(root, '_dev/reports/analysis');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'bound__plan.json'), JSON.stringify({ task_id: 'bound' }));
  fs.writeFileSync(path.join(planDir, 'bound__plan.md'), '# Bound\n');
  fs.writeFileSync(path.join(reviewDir, 'bound-review.md'), 'APPROVE\n');
  lib.writeStateMarker(path.join(markerDir, 'bound.json'), { plan_id: 'bound', last_event: 'review_approved' });
  return root;
}

test('new review records compute plan-pair and artifact hashes from contained bytes', () => {
  const root = writeBoundFixture();
  const result = lib.recordDistinctReview('bound', {
    actor: 'gemini',
    model: 'gemini-3-pro-preview',
    reviewer_family: 'gemini',
    producer_family: 'codex',
    artifact: '_dev/reports/analysis/bound-review.md',
    verdict: 'approved',
    plan_pair_sha256: 'sha256:' + '0'.repeat(64),
    artifact_sha256: 'sha256:' + '0'.repeat(64)
  }, { projectRoot: root });
  assert.match(result.entry.plan_pair_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.entry.artifact_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(result.entry.plan_pair_sha256, 'sha256:' + '0'.repeat(64));
  assert.notEqual(result.entry.artifact_sha256, 'sha256:' + '0'.repeat(64));
  const decision = lib.collectPlanRunGateDecision(root, 'bound', {
    requiresConvene: false,
    operatorStampRequired: false,
    operatorStampVerification: 'not_required',
    evaluatedAt: '2026-07-15T00:00:00Z'
  });
  assert.equal(decision.status, 'ready');
});

test('opaque or missing review artifacts remain recordable but unbound', () => {
  const root = writeBoundFixture();
  const result = lib.recordDistinctReview('bound', {
    actor: 'gemini', model: 'gemini-3-pro-preview', reviewer_family: 'gemini', producer_family: 'codex',
    artifact: 'opaque-review-id', verdict: 'approved',
    plan_pair_sha256: 'sha256:' + '0'.repeat(64), artifact_sha256: 'sha256:' + '0'.repeat(64)
  }, { projectRoot: root });
  assert.equal(result.entry.plan_pair_sha256, undefined);
  assert.equal(result.entry.artifact_sha256, undefined);
  const decision = lib.collectPlanRunGateDecision(root, 'bound', {
    requiresConvene: false, operatorStampRequired: false, operatorStampVerification: 'not_required'
  });
  assert.equal(decision.status, 'blocked');
  assert.ok(decision.reason_codes.includes('distinct_review_missing'));
});

test('client plan metadata can receive the same byte-bound review without reading payload surfaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-client-bound-review-'));
  const planDir = path.join(root, 'clients/TEST/plans');
  const markerDir = path.join(root, 'clients/TEST/state/plan-task-review-state');
  const reviewDir = path.join(root, '_dev/reports/analysis');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'client-bound__plan.json'), JSON.stringify({ task_id: 'client-bound' }));
  fs.writeFileSync(path.join(planDir, 'client-bound__plan.md'), '# Client plan metadata\n');
  fs.writeFileSync(path.join(reviewDir, 'client-bound-review.md'), 'APPROVE\n');
  lib.writeStateMarker(path.join(markerDir, 'client-bound.json'), { plan_id: 'client-bound', last_event: 'review_approved' });
  const result = lib.recordDistinctReview('client-bound', {
    actor: 'gemini', model: 'gemini-3-pro-preview', reviewer_family: 'gemini', producer_family: 'codex',
    artifact: '_dev/reports/analysis/client-bound-review.md', verdict: 'approved'
  }, { projectRoot: root, clientCode: 'TEST' });
  assert.match(result.entry.plan_pair_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.entry.artifact_sha256, /^sha256:[a-f0-9]{64}$/);
});
