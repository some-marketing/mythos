'use strict';

/**
 * A4 (plan-approval-surface) — plan-review-state.js VALID_LAST_EVENTS widening
 * + live PlanTaskReviewState/1.0 tolerance + the centralized operator_stamp
 * presence/flag helpers (consumed by A1 hook + A2 run-plan).
 *
 * Run: node --test tools/planning/lib/__tests__/plan-review-state.allowed-events.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const lib = require('../plan-review-state');

// ── A4: live markers no longer throw ─────────────────────────────────────────

test('readStateMarker on the live {CLIENT_CODE} marker (last_event:convene_complete) returns parsed object, not throw', () => {
  const markerPath = path.join(
    PROJECT_ROOT,
    'clients/{CLIENT_CODE}/state/plan-task-review-state/{CLIENT_CODE}-qualified-conversion-campaign-scoped-goal-track-a.json'
  );
  assert.ok(fs.existsSync(markerPath), 'live {CLIENT_CODE} marker fixture must exist');
  const marker = lib.readStateMarker(markerPath);
  assert.ok(marker && typeof marker === 'object');
  assert.strictEqual(marker.last_event, 'convene_complete');
  assert.strictEqual(marker.operator_stamp, null);
});

test('plan_superseded validates', () => {
  const r = lib.validateStateMarkerShape({ plan_id: 'p', last_event: 'plan_superseded' });
  assert.strictEqual(r.ok, true, r.errors.join('; '));
});

test('an unknown last_event still fails (allow-set is finite, not open-ended)', () => {
  const r = lib.validateStateMarkerShape({ plan_id: 'p', last_event: 'totally_made_up_event' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /last_event must be one of/.test(e)));
});

test('live PlanTaskReviewState/1.0 shape (distinct_reviews[]/convene_review/operator_stamp:null) validates', () => {
  const r = lib.validateStateMarkerShape({
    schema: 'PlanTaskReviewState/1.0',
    plan_id: 'p',
    last_event: 'convene_complete',
    distinct_reviews: [{ actor: 'codex', verdict: 'APPROVED-WITH-MINOR' }],
    distinct_reviews_pending: [],
    convene_review: { artifact: 'x', at: '2026-06-29' },
    operator_stamp: null
  });
  assert.strictEqual(r.ok, true, r.errors.join('; '));
});

test('round-trip: writeStateMarker then readStateMarker on a live-shape marker (no throw)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-a4-'));
  const p = path.join(dir, 'x.json');
  const marker = {
    schema: 'PlanTaskReviewState/1.0',
    plan_id: 'round-trip',
    last_event: 'convene_complete',
    distinct_reviews: [],
    operator_stamp: null
  };
  lib.writeStateMarker(p, marker);
  const back = lib.readStateMarker(p);
  assert.strictEqual(back.last_event, 'convene_complete');
});

// ── A4: legacy validation is NOT weakened ────────────────────────────────────

test('legacy post_repair still REQUIRES the post_repair provenance block', () => {
  const r = lib.validateStateMarkerShape({ plan_id: 'p', last_event: 'post_repair' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /post_repair object is required/.test(e)));
});

test('a complete legacy post_review_approved marker still validates', () => {
  const r = lib.validateStateMarkerShape({
    plan_id: 'p',
    last_event: 'post_review_approved',
    post_repair: {
      repair_id: 'r1',
      timestamp: '2026-06-29T00:00:00Z',
      review_status: 'approved',
      review_reference: 'ref.md'
    },
    post_review: {
      decision: 'approved',
      approval_reference: 'ref.md',
      decided_at: '2026-06-29T00:00:00Z'
    }
  });
  assert.strictEqual(r.ok, true, r.errors.join('; '));
});

// ── shared operator_stamp helpers (A1/A2 single source of truth) ─────────────

test('isOperatorStampEnforcementEnabled defaults FALSE (bootstrap safety)', () => {
  assert.strictEqual(lib.isOperatorStampEnforcementEnabled({}), false);
  assert.strictEqual(lib.isOperatorStampEnforcementEnabled({ SMOS_ENFORCE_OPERATOR_STAMP: '' }), false);
  assert.strictEqual(lib.isOperatorStampEnforcementEnabled({ SMOS_ENFORCE_OPERATOR_STAMP: 'false' }), false);
});

test('isOperatorStampEnforcementEnabled true only for explicit truthy values', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
    assert.strictEqual(
      lib.isOperatorStampEnforcementEnabled({ SMOS_ENFORCE_OPERATOR_STAMP: v }),
      true,
      v
    );
  }
});

test('assessOperatorStamp: null/absent stamp is missing; present stamp is present (presence-only)', () => {
  assert.strictEqual(lib.assessOperatorStamp(null).status, 'missing');
  assert.strictEqual(lib.assessOperatorStamp({ operator_stamp: null }).status, 'missing');
  assert.strictEqual(lib.assessOperatorStamp({ operator_stamp: {} }).status, 'missing');
  const present = lib.assessOperatorStamp({ operator_stamp: { by: '{OPERATOR_NAME}', at: 'now' } });
  assert.strictEqual(present.status, 'present');
  assert.strictEqual(present.verifiedHere, false, 'Stage A never claims authenticity verification');
});
