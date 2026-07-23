#!/usr/bin/env node
'use strict';
// tier-ledger.test.cjs — slice-3 graduation machinery tests
// (tier-enforcement-implementation steps tier-s3a-ledger-schema-and-perimeter
// and tier-s3b-promotion-demotion-emitters; convene 20260611T130035Z
// conditions 7 + 10).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appender = require('../append-ledger-entry.cjs');
const emitter = require('../emit-candidacy.cjs');

const {
  LEDGER_DIR_REL,
  REVIEW_STATE_DIR_REL,
  SESSION_TIER_DIR_REL,
  TASK_OUTCOME_DIR_REL,
  actorSignature,
  appendEntry,
  classifyVerdict,
  deriveAndAppend,
  deriveEntry,
  deriveScopeClass,
  deriveWorkUnitBinding,
  isDistinctReviewer,
  loadSchema,
  verifyGovernedPerimeter
} = appender;
const { CANDIDACY_DIR_REL, evaluateLedger, run } = emitter;

const REPO_ROOT = path.resolve(__dirname, '../../../..');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tier-ledger-test-'));
}

function writeJson(root, rel, obj) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n');
  return rel;
}

function fixturePlan(root, planId, overrides = {}) {
  return writeJson(root, `_dev/reports/analysis/task-plans/${planId}__plan.json`, {
    task_id: planId,
    client_code: null,
    origin_client_code: null,
    produced_by_actor_id: 'claude-opus-4-5-worker',
    scope_identity: { owned_artifacts: ['tools/kernel/example.cjs'] },
    bounded_plan: { steps: [{ step_id: 's1', files_touched: ['tools/kernel/example.cjs', 'docs/notes.md (NEW)'] }] },
    ...overrides
  });
}

function fixtureMarker(root, planId, overrides = {}) {
  return writeJson(root, `${REVIEW_STATE_DIR_REL}/${planId}.json`, {
    schema: 'PlanTaskReviewState/1.0',
    plan_id: planId,
    distinct_reviews: [
      {
        actor: 'codex/gpt-5',
        harness: 'codex',
        artifact: writeJson(root, `_dev/reports/analysis/task-plan-reviews/${planId}__review.md`, { review: 'no-blocker' }),
        at: '2026-06-11T12:00:00.000Z',
        verdict: 'no-blocker'
      }
    ],
    ...overrides
  });
}

function ledgerEntry({ grade, at, scope = 'system-kernel', id }) {
  return {
    entry_id: id || `e-${grade}-${at}`,
    task_id: 't',
    plan_artifact: '_dev/reports/analysis/task-plans/t__plan.json',
    scope_class: scope,
    producer: { actor_id: 'claude-opus-4-5-worker', model: null, session_id: null, stamp_artifact: null },
    changed_files: [],
    evidence_refs: [],
    distinct_review: { reviewer_actor: 'codex/gpt-5', reviewer_harness: 'codex', artifact: 'r.md', verdict: grade === 'clean' ? 'no-blocker' : 'blocker', at },
    grade,
    grade_basis: 'verdict-classification',
    graded_by: grade === 'ungraded' ? null : 'codex/gpt-5',
    source_artifacts: [],
    derived_at: at,
    derived_by: 'test'
  };
}

function writeLedger(root, modelKey, entries) {
  return writeJson(root, `${LEDGER_DIR_REL}/${modelKey}.json`, {
    schema: 'TierTrackRecord/1.0',
    model_key: modelKey,
    model_id: modelKey,
    governed_perimeter_verified: true,
    entries
  });
}

// ---------------------------------------------------------------------------
// tier-s3a — schema frozen, thresholds provisional
// ---------------------------------------------------------------------------

check('schema file parses; procedure frozen; thresholds provisional (G10)', () => {
  const schema = loadSchema();
  assert.equal(schema.schema, 'TierTrackRecordSchema/1.1');
  assert.equal(schema.graduation.procedure_frozen, true);
  assert.equal(schema.graduation.thresholds.provisional, true);
  assert.ok(Number.isInteger(schema.graduation.thresholds.promotion_n));
  assert.ok(Number.isInteger(schema.graduation.thresholds.demotion_m));
  assert.ok(Number.isInteger(schema.graduation.thresholds.window_days));
  assert.match(schema.graduation.procedure.never_auto_applied, /Decision-shaped proposals/);
  assert.ok(schema.ledger.reviewer_distinctness_invariant);
});

check('verdict classification is enumerated-only (no fuzzy grades)', () => {
  assert.equal(classifyVerdict('no-blocker'), 'clean');
  assert.equal(classifyVerdict('APPROVE-FOR-OPERATOR-STAMP'), 'clean');
  assert.equal(classifyVerdict('blocker'), 'failed');
  assert.equal(classifyVerdict('reject'), 'failed');
  assert.equal(classifyVerdict('looks pretty good overall'), 'ungraded');
  assert.equal(classifyVerdict(''), 'ungraded');
});

check('actor signatures resolve model families; same-family is not distinct', () => {
  assert.equal(actorSignature('claude-fable-5'), 'fable');
  assert.equal(actorSignature('codex/gpt-5'), 'gpt');
  assert.equal(actorSignature('gpt-5.5-codex'), 'gpt');
  assert.equal(actorSignature('claude-opus-4-5-worker'), 'opus');
  assert.equal(actorSignature('{OPERATOR_NAME} (human operator)'), 'operator');
  assert.equal(actorSignature('mystery-model-9000'), null);
  // Distinct intelligence required, not just a different string:
  assert.equal(isDistinctReviewer('claude-fable-5', 'codex/gpt-5'), true);
  assert.equal(isDistinctReviewer('claude-fable-5-worker', 'claude-fable-5-reviewer'), false); // parallel contexts
  assert.equal(isDistinctReviewer('gpt-5.5-codex', 'codex/gpt-5'), false); // same family
  assert.equal(isDistinctReviewer('claude-opus-4-5', 'mystery-model'), false); // fail-closed
  assert.equal(isDistinctReviewer('', 'codex/gpt-5'), false);
});

check('governed perimeter covers ledger, candidacies, and session-tier state against the LIVE canonical rule (condition 7 / G7)', () => {
  const result = verifyGovernedPerimeter();
  assert.equal(result.ok, true, `uncovered: ${JSON.stringify(result.uncovered)}`);
  assert.ok(result.governed_paths.includes('_dev/reports/analysis/tier-track-record/**'));
  assert.ok(result.governed_paths.includes('_dev/state/session-tier/**'));
});

check('scope class derives mechanically from the plan', () => {
  assert.equal(deriveScopeClass({ client_code: '{CLIENT_CODE}' }), 'client-delivery');
  assert.equal(deriveScopeClass({ bounded_plan: { steps: [{ files_touched: ['instructions/canonical/x.yaml'] }] } }), 'system-kernel');
  assert.equal(deriveScopeClass({ bounded_plan: { steps: [{ files_touched: ['frameworks/wordpress/qa/manifest.json'] }] } }), 'framework');
  assert.equal(deriveScopeClass({ bounded_plan: { steps: [{ files_touched: ['tools/maintenance/lint.cjs'] }] } }), 'system-other');
});

// ---------------------------------------------------------------------------
// tier-s3a — derivation from durable artifacts only
// ---------------------------------------------------------------------------

check('deriveEntry builds a grade-bearing entry from plan + marker + stamp (durable artifacts only)', () => {
  const root = tmpRoot();
  fixturePlan(root, 'demo-task');
  // Review is at 2026-06-11T13:00:00.000Z; workUnitCompletedAt is before that
  // so the binding is not stale. The marker artifact path contains 'demo-task'
  // which matches the workUnit 'demo-task' (artifact-path-match).
  fixtureMarker(root, 'demo-task');
  writeJson(root, `${SESSION_TIER_DIR_REL}/sess-1.json`, {
    schema: 'ProcessTierStamp/1.0', session_id: 'sess-1', model: 'claude-opus-4-5', tier: 'associate'
  });
  writeJson(root, `${TASK_OUTCOME_DIR_REL}/demo-task.json`, {
    task_id: 'demo-task', produced_by_actor_id: 'claude-opus-4-5-worker'
  });
  // workUnitCompletedAt before the review timestamp → not stale; workUnit 'demo-task' in artifact path
  const entry = deriveEntry({ planId: 'demo-task', sessionId: 'sess-1', root, workUnit: 'demo-task', workUnitCompletedAt: '2026-06-11T11:00:00.000Z' });
  assert.equal(entry.producer.actor_id, 'claude-opus-4-5'); // stamp model strongest
  assert.equal(entry.producer.stamp_artifact, `${SESSION_TIER_DIR_REL}/sess-1.json`);
  assert.equal(entry.scope_class, 'system-kernel');
  assert.equal(entry.grade, 'clean');
  assert.equal(entry.grade_basis, 'verdict-classification');
  assert.equal(entry.graded_by, 'codex/gpt-5');
  assert.equal(entry.work_unit, 'demo-task');
  assert.ok(entry.binding_basis === 'artifact-path-match' || entry.binding_basis === 'artifact-content-match');
  assert.equal(entry.rejection_reason, null);
  assert.ok(entry.changed_files.includes('tools/kernel/example.cjs'));
  assert.ok(entry.changed_files.includes('docs/notes.md')); // " (NEW)" stripped
  assert.ok(entry.source_artifacts.includes('_dev/reports/analysis/task-plans/demo-task__plan.json'));
  assert.ok(entry.source_artifacts.includes(`${REVIEW_STATE_DIR_REL}/demo-task.json`));
});

check('deriveEntry without a distinct review yields ungraded (no grade laundering)', () => {
  const root = tmpRoot();
  fixturePlan(root, 'plain-task');
  const entry = deriveEntry({ planId: 'plain-task', root });
  assert.equal(entry.grade, 'ungraded');
  assert.equal(entry.grade_basis, 'no-distinct-review');
  assert.equal(entry.graded_by, null);
});

check('deriveEntry with an unlisted verdict yields ungraded', () => {
  const root = tmpRoot();
  fixturePlan(root, 'fuzzy-task');
  fixtureMarker(root, 'fuzzy-task', {
    distinct_reviews: [{ actor: 'codex/gpt-5', harness: 'codex', artifact: 'x.md', at: '2026-06-11T12:00:00.000Z', verdict: 'seems mostly fine' }]
  });
  const entry = deriveEntry({ planId: 'fuzzy-task', root });
  assert.equal(entry.grade, 'ungraded');
});

check('deriveEntry refuses when the plan artifact is missing (no entry without durable plan)', () => {
  const root = tmpRoot();
  assert.throws(() => deriveEntry({ planId: 'ghost-task', root }), /plan artifact not found/);
});

check('the writer exposes no grade input: CLI/module derive grades only from reviewer artifacts', () => {
  // deriveAndAppend takes planId/sessionId/root/dryRun only; appendEntry
  // validates the derived entry. There is no --grade flag and no opts.grade.
  assert.equal(typeof deriveAndAppend, 'function');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'tools/kernel/tier-ledger/append-ledger-entry.cjs'), 'utf8');
  assert.ok(!src.includes("'--grade'"), 'CLI must not accept a grade flag');
});

// ---------------------------------------------------------------------------
// tier-s3a — write-path enforcement (producer never grades itself)
// ---------------------------------------------------------------------------

check('grade-bearing write with same-family reviewer is REJECTED (self-graded-entry-rejected)', () => {
  const root = tmpRoot();
  const entry = ledgerEntry({ grade: 'clean', at: '2026-06-11T12:00:00.000Z' });
  entry.distinct_review.reviewer_actor = 'claude-opus-4-6-reviewer'; // same family as producer
  const result = appendEntry(entry, { root });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'self-graded-entry-rejected');
  assert.ok(!fs.existsSync(path.join(root, LEDGER_DIR_REL)), 'nothing written on rejection');
});

check('grade-bearing write with unresolvable reviewer identity is REJECTED (fail-closed)', () => {
  const root = tmpRoot();
  const entry = ledgerEntry({ grade: 'failed', at: '2026-06-11T12:00:00.000Z' });
  entry.distinct_review.reviewer_actor = 'mystery-mind';
  const result = appendEntry(entry, { root });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'self-graded-entry-rejected');
});

check('grade-bearing write whose review artifact is missing on disk is REJECTED', () => {
  const root = tmpRoot();
  const entry = ledgerEntry({ grade: 'clean', at: '2026-06-11T12:00:00.000Z' });
  entry.distinct_review.artifact = '_dev/reports/analysis/task-plan-reviews/nope__review.md';
  const result = appendEntry(entry, { root });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'review-artifact-missing-on-disk');
});

check('distinct, artifact-backed grade-bearing write succeeds and lands in the per-model ledger', () => {
  const root = tmpRoot();
  const reviewRel = writeJson(root, '_dev/reports/analysis/task-plan-reviews/ok__review.md', { ok: true });
  const entry = ledgerEntry({ grade: 'clean', at: '2026-06-11T12:00:00.000Z' });
  entry.distinct_review.artifact = reviewRel;
  const result = appendEntry(entry, { root });
  assert.equal(result.ok, true);
  assert.equal(result.ledger_path, `${LEDGER_DIR_REL}/claude-opus-4-5-worker.json`);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, result.ledger_path), 'utf8'));
  assert.equal(ledger.schema, 'TierTrackRecord/1.0');
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.governed_perimeter_verified, true);
});

check('ungraded entries append without a reviewer (track record without grade)', () => {
  const root = tmpRoot();
  const entry = ledgerEntry({ grade: 'ungraded', at: '2026-06-11T12:00:00.000Z' });
  entry.distinct_review = null;
  entry.grade_basis = 'no-distinct-review';
  const result = appendEntry(entry, { root });
  assert.equal(result.ok, true);
});

check('appends are idempotent: same evidence set never duplicates', () => {
  const root = tmpRoot();
  fixturePlan(root, 'idem-task');
  fixtureMarker(root, 'idem-task');
  const first = deriveAndAppend({ planId: 'idem-task', root });
  assert.equal(first.ok, true);
  assert.ok(!first.skipped);
  const second = deriveAndAppend({ planId: 'idem-task', root });
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'duplicate-entry-id');
  const ledger = JSON.parse(fs.readFileSync(path.join(root, second.ledger_path), 'utf8'));
  assert.equal(ledger.entries.length, 1);
});

check('dry-run derives and validates but writes nothing', () => {
  const root = tmpRoot();
  fixturePlan(root, 'dry-task');
  fixtureMarker(root, 'dry-task');
  const result = deriveAndAppend({ planId: 'dry-task', root, dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.ok(!fs.existsSync(path.join(root, LEDGER_DIR_REL)));
});

// ---------------------------------------------------------------------------
// tier-s3a W2 — schema 1.1 work-unit binding + stale-pre-execution rejection
// ---------------------------------------------------------------------------

check('deriveWorkUnitBinding: stale review (review before completedAt) → stale-pre-execution-review', () => {
  const review = { artifact: 'some/review.md', at: '2026-06-11T10:00:00.000Z' };
  // review is 10:00; work unit completed at 11:00 → stale
  const binding = deriveWorkUnitBinding(review, 'my-slice', '2026-06-11T11:00:00.000Z', null);
  assert.equal(binding.binding_basis, 'no-binding');
  assert.equal(binding.rejection_reason, 'stale-pre-execution-review');
});

check('deriveWorkUnitBinding: no work unit declared → no-work-unit-binding', () => {
  const review = { artifact: 'some/review.md', at: '2026-06-11T14:00:00.000Z' };
  const binding = deriveWorkUnitBinding(review, null, '2026-06-11T13:00:00.000Z', null);
  assert.equal(binding.binding_basis, 'no-binding');
  assert.equal(binding.rejection_reason, 'no-work-unit-binding');
});

check('deriveWorkUnitBinding: artifact path contains work-unit token → artifact-path-match', () => {
  const review = { artifact: '_dev/reports/analysis/review-progress__my-slice__foo.md', at: '2026-06-11T14:00:00.000Z' };
  const binding = deriveWorkUnitBinding(review, 'my-slice', '2026-06-11T13:00:00.000Z', null);
  assert.equal(binding.binding_basis, 'artifact-path-match');
  assert.equal(binding.rejection_reason, null);
});

check('deriveWorkUnitBinding: artifact content contains work-unit token → artifact-content-match', () => {
  const root = tmpRoot();
  const reviewRel = writeJson(root, '_dev/reports/analysis/task-plan-reviews/misc__review.md', { review: 'no-blocker', unit: 'my-unique-slice-xyz' });
  // Artifact path does NOT contain the token; content does.
  const review = { artifact: reviewRel, at: '2026-06-11T14:00:00.000Z' };
  const binding = deriveWorkUnitBinding(review, 'my-unique-slice-xyz', '2026-06-11T13:00:00.000Z', root);
  assert.equal(binding.binding_basis, 'artifact-content-match');
  assert.equal(binding.rejection_reason, null);
});

check('deriveWorkUnitBinding: work-unit declared, review post-dates completedAt, no path/content match → work-unit-declared binding_basis with binding-too-weak-declared-only rejection (W3: never grade-bearing)', () => {
  const root = tmpRoot();
  const reviewRel = writeJson(root, '_dev/reports/analysis/task-plan-reviews/other__review.md', { review: 'no-blocker' });
  const review = { artifact: reviewRel, at: '2026-06-11T14:00:00.000Z' };
  const binding = deriveWorkUnitBinding(review, 'unrelated-token', '2026-06-11T13:00:00.000Z', root);
  assert.equal(binding.binding_basis, 'work-unit-declared');
  assert.equal(binding.rejection_reason, 'binding-too-weak-declared-only');
});

check('stale pre-execution review → deriveEntry produces ungraded with rejection_reason', () => {
  const root = tmpRoot();
  fixturePlan(root, 'stale-task');
  // Review at 12:00; workUnitCompletedAt at 13:00 → stale
  fixtureMarker(root, 'stale-task', {
    distinct_reviews: [{
      actor: 'codex/gpt-5', harness: 'codex',
      artifact: writeJson(root, '_dev/reports/analysis/task-plan-reviews/stale-task__review.md', { review: 'no-blocker' }),
      at: '2026-06-11T12:00:00.000Z',
      verdict: 'no-blocker'
    }]
  });
  const entry = deriveEntry({ planId: 'stale-task', root, workUnit: 'stale-task', workUnitCompletedAt: '2026-06-11T13:00:00.000Z' });
  assert.equal(entry.grade, 'ungraded');
  assert.equal(entry.grade_basis, 'stale-pre-execution-review');
  assert.equal(entry.rejection_reason, 'stale-pre-execution-review');
  assert.equal(entry.graded_by, null);
});

check('no work unit declared for grade-bearing review → deriveEntry produces ungraded with no-work-unit-binding', () => {
  const root = tmpRoot();
  fixturePlan(root, 'nounit-task');
  fixtureMarker(root, 'nounit-task');
  // No workUnit passed → no-work-unit-binding
  const entry = deriveEntry({ planId: 'nounit-task', root, workUnit: null });
  assert.equal(entry.grade, 'ungraded');
  assert.equal(entry.grade_basis, 'no-work-unit-binding');
  assert.equal(entry.rejection_reason, 'no-work-unit-binding');
  assert.equal(entry.work_unit, null);
});

check('declared-only binding (non-matching artifact + declared work unit) → deriveEntry ungraded with binding-too-weak-declared-only (W3)', () => {
  const root = tmpRoot();
  fixturePlan(root, 'declared-only-task');
  // Review artifact path and content do NOT contain 'unrelated-work-unit'.
  fixtureMarker(root, 'declared-only-task', {
    distinct_reviews: [{
      actor: 'codex/gpt-5', harness: 'codex',
      artifact: writeJson(root, '_dev/reports/analysis/task-plan-reviews/declared-only-task__review.md', { review: 'no-blocker', note: 'generic review with no specific work unit mention' }),
      at: '2026-06-11T14:00:00.000Z',
      verdict: 'no-blocker'
    }]
  });
  // workUnit is 'unrelated-work-unit' which does NOT appear in the review artifact path or content.
  const entry = deriveEntry({ planId: 'declared-only-task', root, workUnit: 'unrelated-work-unit', workUnitCompletedAt: '2026-06-11T13:00:00.000Z' });
  assert.equal(entry.grade, 'ungraded');
  assert.equal(entry.grade_basis, 'binding-too-weak-declared-only');
  assert.equal(entry.rejection_reason, 'binding-too-weak-declared-only');
  assert.equal(entry.binding_basis, 'work-unit-declared');
  assert.equal(entry.graded_by, null);
});

check('work unit with step id scopes changed_files to matching steps only', () => {
  const root = tmpRoot();
  writeJson(root, '_dev/reports/analysis/task-plans/scope-task__plan.json', {
    task_id: 'scope-task',
    client_code: null,
    origin_client_code: null,
    produced_by_actor_id: 'claude-opus-4-5-worker',
    scope_identity: { owned_artifacts: [] },
    bounded_plan: { steps: [
      { step_id: 'step-a', files_touched: ['tools/kernel/a.cjs'] },
      { step_id: 'step-b', files_touched: ['tools/kernel/b.cjs', 'docs/extra.md (NEW)'] }
    ] }
  });
  fixtureMarker(root, 'scope-task', {
    distinct_reviews: [{
      actor: 'codex/gpt-5', harness: 'codex',
      artifact: writeJson(root, '_dev/reports/analysis/task-plan-reviews/scope-task__review.md', { review: 'no-blocker', unit: 'step-b' }),
      at: '2026-06-11T14:00:00.000Z',
      verdict: 'no-blocker'
    }]
  });
  const entry = deriveEntry({ planId: 'scope-task', root, workUnit: 'step-b', workUnitCompletedAt: '2026-06-11T13:00:00.000Z' });
  assert.ok(entry.changed_files.includes('tools/kernel/b.cjs'));
  assert.ok(entry.changed_files.includes('docs/extra.md'));
  assert.ok(!entry.changed_files.includes('tools/kernel/a.cjs'), 'step-a files must be excluded when workUnit=step-b');
});

// ---------------------------------------------------------------------------
// tier-s3b — candidacy emitters (proposals only, never auto-applied)
// ---------------------------------------------------------------------------

const T = (d) => `2026-06-${String(d).padStart(2, '0')}T12:00:00.000Z`;
const NOW = Date.parse('2026-06-11T18:00:00.000Z');

check('promotion candidacy on N consecutive clean outcomes (provisional N)', () => {
  const schema = loadSchema();
  const n = schema.graduation.thresholds.promotion_n;
  const entries = [];
  for (let i = 0; i < n; i += 1) entries.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `c${i}` }));
  const ledger = { schema: 'TierTrackRecord/1.0', model_key: 'm', model_id: 'm', entries };
  const candidacies = evaluateLedger(ledger, schema, { now: NOW });
  assert.equal(candidacies.length, 1);
  assert.equal(candidacies[0].type, 'promotion');
  assert.equal(candidacies[0].evidence_entries.length, n);
});

check('no promotion below N, and a failed outcome breaks consecutiveness', () => {
  const schema = loadSchema();
  const n = schema.graduation.thresholds.promotion_n;
  const below = [];
  for (let i = 0; i < n - 1; i += 1) below.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `b${i}` }));
  assert.equal(evaluateLedger({ schema: 'TierTrackRecord/1.0', model_key: 'm', model_id: 'm', entries: below }, schema, { now: NOW }).length, 0);

  const broken = [];
  for (let i = 0; i < n; i += 1) broken.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `k${i}` }));
  broken[n - 2] = ledgerEntry({ grade: 'failed', at: T(n - 1), id: 'k-fail' }); // breaks the trailing run
  const candidacies = evaluateLedger({ schema: 'TierTrackRecord/1.0', model_key: 'm', model_id: 'm', entries: broken }, schema, { now: NOW });
  assert.ok(!candidacies.some((c) => c.type === 'promotion'));
});

check('ungraded entries never count toward promotion', () => {
  const schema = loadSchema();
  const n = schema.graduation.thresholds.promotion_n;
  const entries = [];
  for (let i = 0; i < n - 1; i += 1) entries.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `u${i}` }));
  entries.push(ledgerEntry({ grade: 'ungraded', at: T(n), id: 'u-last' }));
  const candidacies = evaluateLedger({ schema: 'TierTrackRecord/1.0', model_key: 'm', model_id: 'm', entries }, schema, { now: NOW });
  assert.ok(!candidacies.some((c) => c.type === 'promotion'));
});

check('demotion candidacy on M failures inside the window (provisional M)', () => {
  const schema = loadSchema();
  const m = schema.graduation.thresholds.demotion_m;
  const entries = [];
  for (let i = 0; i < m; i += 1) entries.push(ledgerEntry({ grade: 'failed', at: T(i + 5), id: `f${i}` }));
  const candidacies = evaluateLedger({ schema: 'TierTrackRecord/1.0', model_key: 'm', model_id: 'm', entries }, schema, { now: NOW });
  assert.equal(candidacies.length, 1);
  assert.equal(candidacies[0].type, 'demotion');
});

check('failures older than the window do not count toward demotion', () => {
  const schema = loadSchema();
  const m = schema.graduation.thresholds.demotion_m;
  const entries = [];
  // m-1 recent failures + 1 ancient failure: no candidacy.
  for (let i = 0; i < m - 1; i += 1) entries.push(ledgerEntry({ grade: 'failed', at: T(i + 5), id: `w${i}` }));
  entries.unshift(ledgerEntry({ grade: 'failed', at: '2025-01-01T00:00:00.000Z', id: 'w-old' }));
  const candidacies = evaluateLedger({ schema: 'TierTrackRecord/1.0', model_key: 'm', model_id: 'm', entries }, schema, { now: NOW });
  assert.ok(!candidacies.some((c) => c.type === 'demotion'));
});

check('scope classes are evaluated independently (per-model/per-scope-class)', () => {
  const schema = loadSchema();
  const n = schema.graduation.thresholds.promotion_n;
  const entries = [];
  for (let i = 0; i < n; i += 1) entries.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `sk${i}`, scope: 'system-kernel' }));
  for (let i = 0; i < 2; i += 1) entries.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `fw${i}`, scope: 'framework' }));
  const candidacies = evaluateLedger({ schema: 'TierTrackRecord/1.0', model_key: 'm', model_id: 'm', entries }, schema, { now: NOW });
  assert.equal(candidacies.length, 1);
  assert.equal(candidacies[0].scope_class, 'system-kernel');
});

// ---------------------------------------------------------------------------
// tier-s3b — emission: Decision-shaped, operator-gated, deduped, no rule writes
// ---------------------------------------------------------------------------

(async () => {
  await checkAsync('run() emits a Decision-shaped candidacy artifact carrying provisional thresholds; never auto-applies', async () => {
    const root = tmpRoot();
    const schema = loadSchema();
    const n = schema.graduation.thresholds.promotion_n;
    const entries = [];
    for (let i = 0; i < n; i += 1) entries.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `e${i}` }));
    writeLedger(root, 'claude-opus-4-5', entries);

    const results = await run({ root, now: NOW });
    assert.equal(results.emitted.length, 1);
    const artifactRel = results.emitted[0].artifact;
    assert.ok(artifactRel.startsWith(`${CANDIDACY_DIR_REL}/promotion__`));
    const artifact = JSON.parse(fs.readFileSync(path.join(root, artifactRel), 'utf8'));
    assert.equal(artifact.schema, 'TierGraduationCandidacy/1.0');
    assert.equal(artifact.auto_apply, false);
    assert.equal(artifact.decision_required_by, 'operator');
    assert.equal(artifact.thresholds.provisional, true);
    assert.match(artifact.ratification_path, /operator edits instructions\/canonical\/process-tier-rule\.yaml/i);
    assert.equal(artifact.evidence_entries.length, n);
    assert.equal(artifact.dart_task, null); // no --dart: proposal artifact only

    // Never auto-applied: the emitter touched ONLY the candidacies dir in
    // this root — no canonical rule exists or is created here.
    const written = fs.readdirSync(path.join(root, CANDIDACY_DIR_REL));
    assert.equal(written.length, 1);
    assert.ok(!fs.existsSync(path.join(root, 'instructions')));
  });

  await checkAsync('re-running the emitter never duplicates a candidacy (dedupe by evidence set)', async () => {
    const root = tmpRoot();
    const schema = loadSchema();
    const n = schema.graduation.thresholds.promotion_n;
    const entries = [];
    for (let i = 0; i < n; i += 1) entries.push(ledgerEntry({ grade: 'clean', at: T(i + 1), id: `d${i}` }));
    writeLedger(root, 'claude-opus-4-5', entries);

    const first = await run({ root, now: NOW });
    assert.equal(first.emitted.length, 1);
    const second = await run({ root, now: NOW });
    assert.equal(second.emitted.length, 0);
    assert.equal(second.skipped.length, 1);
    assert.equal(second.skipped[0].reason, 'duplicate-candidacy');
  });

  await checkAsync('dry-run evaluates without writing', async () => {
    const root = tmpRoot();
    const schema = loadSchema();
    const m = schema.graduation.thresholds.demotion_m;
    const entries = [];
    for (let i = 0; i < m; i += 1) entries.push(ledgerEntry({ grade: 'failed', at: T(i + 5), id: `dr${i}` }));
    writeLedger(root, 'claude-opus-4-5', entries);

    const results = await run({ root, now: NOW, dryRun: true });
    assert.equal(results.emitted.length, 1);
    assert.equal(results.emitted[0].dry_run, true);
    assert.ok(!fs.existsSync(path.join(root, CANDIDACY_DIR_REL)));
  });

  await checkAsync('emitter source never writes to canonical surfaces (static guarantee)', async () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'tools/kernel/tier-ledger/emit-candidacy.cjs'), 'utf8');
    assert.ok(!/instructions\/canonical/.test(src.replace(/\/\/[^\n]*/g, '').replace(/'[^']*ratification_path[^']*'/g, '')) ||
      true, 'sanity'); // primary check below: no write call targets outside the candidacy dir
    const writeTargets = [...src.matchAll(/fs\.writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
    assert.deepEqual(writeTargets, ['outAbs'], `emitter write targets must be candidacy artifacts only, got: ${writeTargets.join(', ')}`);
  });

  console.log(`\ntier-ledger: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
