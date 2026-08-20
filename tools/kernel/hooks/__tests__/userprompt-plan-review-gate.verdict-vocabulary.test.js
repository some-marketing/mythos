'use strict';

// Regression tests for the distinct-review verdict classifier.
//
// Origin (2026-08-20): the gate matched approval FIRST with unanchored
// substrings, then rejection, and anything matching NEITHER fell through both
// buckets into a filename-glob fallback that opened the gate. The repository's
// own canonical verdict AMEND_REQUIRED matched neither pattern, so an
// instruction to amend a plan read as authorization to run it. An audit of the
// 26 plans reaching the gate through that fallback found 25 that should not
// have been passing, 20 of them carrying artifacts declaring an explicitly
// blocking verdict.
//
// Authorized by convene run
// _dev/reports/analysis/convene-runs/20260820T153136Z-plan-review-gate-verdict-vocabulary/.

const test = require('node:test');
const assert = require('node:assert');

const {
  classifyVerdict,
  assessDistinctReview
} = require('../userprompt-plan-review-gate.cjs');

const ROOT = require('path').resolve(__dirname, '..', '..', '..', '..');
const marker = (reviews, pending) => ({
  distinct_reviews: reviews,
  distinct_reviews_pending: pending || []
});
const at = (iso, verdict) => ({ actor: 'codex', verdict, at: iso });

test('canonical blocking verdicts are recognized as blocking', () => {
  // Every string here was observed in a real recorded verdict or review body.
  const blocking = [
    'AMEND_REQUIRED',
    'changes_required',
    'CHANGES_REQUIRED',
    'changes-required',
    'CHANGES_REQUESTED',
    'REJECT',
    'REJECT_PENDING_AMENDMENT',
    'NEEDS_AMENDMENT',
    'AMENDED',
    'AMEND',
    'NO_VERDICT',
    'Amend required before execution',
    'blocked for amendment'
  ];
  for (const v of blocking) {
    assert.equal(classifyVerdict(v), 'blocking', `"${v}" must classify as blocking`);
  }
});

test('canonical approval forms are recognized', () => {
  for (const v of ['APPROVE', 'APPROVED', 'approve', 'LGTM', 'SOUND', 'ok', 'CLEAN',
                   'APPROVE-FOR-RUN', 'APPROVE-WITH-CHANGES', 'APPROVED-WITH-MINOR',
                   'PASS-WITH-CONDITIONS', 'SOUND-WITH-CONDITIONS']) {
    assert.equal(classifyVerdict(v), 'approving', `"${v}" must classify as approving`);
  }
});

test('blocking beats an approving word in the same string', () => {
  // Prompt echoes such as "give APPROVE or AMEND_REQUIRED" must never authorize.
  assert.equal(classifyVerdict('APPROVE or AMEND_REQUIRED'), 'blocking');
  assert.equal(classifyVerdict('approved pending amendment'), 'blocking');
});

test('negated approval never reads as approval', () => {
  for (const v of ['not approved', 'NOT APPROVED', 'cannot approve', 'no approval granted', 'not yet accepted']) {
    assert.notEqual(classifyVerdict(v), 'approving', `"${v}" must not authorize`);
  }
});

// --- Attacks raised by the distinct-family review of this change ------------

test('negation covers EVERY approval token, not just approve/accept', () => {
  // These all authorized when the negation guard only knew approve/accept.
  for (const v of ['not OK', 'not LGTM', 'not sound', 'not clean', 'not clear', 'never accepted']) {
    assert.notEqual(classifyVerdict(v), 'approving', `"${v}" must not authorize`);
  }
});

test('narrative prose never authorizes, however approving it sounds', () => {
  // Distinct-family review broke the earlier prose-tolerant grammar with these
  // real corpus entries. The first carries unresolved MAJOR findings; the second
  // explicitly demands a further review. Both used to authorize.
  assert.notEqual(classifyVerdict('PASS on 3 of 4 round-1 findings; NEW MAJOR schema gap; NEW MAJOR archive gap'), 'approving');
  assert.notEqual(classifyVerdict('original 5 findings confirmed repaired; structural precheck PASSES; final /review-task-plan pass required before /run-plan'), 'approving');
  assert.notEqual(classifyVerdict('I pass on authorizing this plan'), 'approving');
  assert.notEqual(classifyVerdict('CLEAN, with a reliability caveat'), 'approving');
});

test('approving-sounding prose is unclassified, not blocked', () => {
  // Fail-closed either way, but the distinction matters for the operator
  // message: these are narrative, not refusals.
  assert.equal(classifyVerdict('CLEAN - two non-blocking advisories, not scoped to this plan'), 'unclassified');
  assert.equal(classifyVerdict('approved - no blocking findings; next /run-plan'), 'unclassified');
});

test('blocking vocabulary is narrow enough not to fire on "non-blocking"', () => {
  assert.notEqual(classifyVerdict('CLEAN - two non-blocking advisories'), 'blocking');
  assert.notEqual(classifyVerdict('approved - no blocking findings'), 'blocking');
  // ...while the canonical blocking phrases still block.
  assert.equal(classifyVerdict('NEEDS_AMENDMENT'), 'blocking');
  assert.equal(classifyVerdict('on hold'), 'blocking');
  assert.equal(classifyVerdict('blocked for amendment'), 'blocking');
});

test('an approval cannot override pending or unclassified evidence', () => {
  // The authorization predicate once quantified over BLOCKING entries only, so
  // an approval sitting beside in-flight or unrecognized evidence authorized —
  // contradicting this hook's own fail-closed contract.
  assert.notEqual(assessDistinctReview(ROOT, 'fixture-plan', marker([
    { verdict: 'APPROVE' }, { verdict: 'see major findings' }
  ])).status, 'satisfied');

  assert.notEqual(assessDistinctReview(ROOT, 'fixture-plan', marker([
    { verdict: 'APPROVE' }, { verdict: 'pending' }
  ])).status, 'satisfied');

  // distinct_reviews_pending[] carries no ordering, so it blocks outright.
  assert.notEqual(assessDistinctReview(ROOT, 'fixture-plan', marker(
    [{ verdict: 'APPROVE' }], [{ actor: 'codex', note: 'in flight' }]
  )).status, 'satisfied');

  // ...but a lone approval with nothing else outstanding still authorizes.
  assert.equal(assessDistinctReview(ROOT, 'fixture-plan', marker([{ verdict: 'APPROVE' }])).status, 'satisfied');
});

test('the approval vocabulary is a closed enumeration, not a wildcard pattern', () => {
  // Each of these matched an earlier `approv\w*` / `accept\w*` / free-qualifier
  // pattern. A closed list makes them unmatchable by construction.
  for (const v of ['APPROVAL', 'ACCEPTABLE', 'PASSABLE', 'CLEARANCE',
                   'APPROVE-UNSAFE', 'APPROVE-WITH-MAJOR-FINDINGS', 'APPROVE-WITH-UNRESOLVED']) {
    assert.notEqual(classifyVerdict(v), 'approving', `"${v}" must not authorize`);
  }
});

test('an approval must postdate EVERY blocking review, not merely the latest', () => {
  // A partially ordered set cannot be folded to one maximum: reviewIsAfter
  // reports incomparable pairs as false, so a reducer silently dropped blocks.
  assert.notEqual(assessDistinctReview(ROOT, 'fixture-plan', marker([
    { verdict: 'CHANGES_REQUIRED', at: '2026-08-01T00:00:00Z' },
    { verdict: 'AMEND_REQUIRED' },
    { verdict: 'APPROVE', at: '2026-08-03T00:00:00Z' }
  ])).status, 'satisfied');

  assert.notEqual(assessDistinctReview(ROOT, 'fixture-plan', marker([
    { verdict: 'AMEND_REQUIRED' },
    { verdict: 'CHANGES_REQUIRED', at: '2026-08-02T00:00:00Z' },
    { verdict: 'APPROVE' }
  ])).status, 'satisfied');
});

test('a marker cannot supply its own ordering index to revive a stale approval', () => {
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    { actor: 'codex', verdict: 'APPROVE', __index: 999 },
    { actor: 'codex', verdict: 'CHANGES_REQUIRED' }
  ]));
  assert.equal(result.status, 'rejected');
});

test('mixed timestamp and append ordering fails closed', () => {
  // One entry timestamped, the other not: the two are not comparable, so an
  // approval must NOT be treated as postdating the block.
  assert.equal(assessDistinctReview(ROOT, 'fixture-plan', marker([
    { actor: 'codex', verdict: 'CHANGES_REQUIRED', at: 'not-a-date' },
    { actor: 'codex', verdict: 'APPROVE', at: '2020-01-01T00:00:00Z' }
  ])).status, 'rejected');

  assert.equal(assessDistinctReview(ROOT, 'fixture-plan', marker([
    { actor: 'codex', verdict: 'AMEND_REQUIRED' },
    { actor: 'codex', verdict: 'APPROVE', at: '2026-01-01T00:00:00Z' }
  ])).status, 'rejected');
});

test('approval words are matched as tokens, never substrings', () => {
  // "bypass" contains "pass"; "unacceptable" contains "accept".
  assert.notEqual(classifyVerdict('bypass'), 'approving');
  assert.notEqual(classifyVerdict('unacceptable'), 'approving');
});

test('an unrecognized verdict is unclassified, not approval', () => {
  for (const v of ['completion-ready', 'per this codebase', 'mu', 'see notes']) {
    assert.equal(classifyVerdict(v), 'unclassified', `"${v}" must be unclassified`);
  }
});

test('an empty or absent verdict is pending', () => {
  assert.equal(classifyVerdict(''), 'pending');
  assert.equal(classifyVerdict(undefined), 'pending');
  assert.equal(classifyVerdict('review pending'), 'pending');
});

// --- Falsifier pair supplied by the NOW/codex convene slot -------------------

test('FALSIFIER: [APPROVE, CHANGES_REQUIRED] must BLOCK — approval is not immortal', () => {
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    at('2026-08-01T00:00:00Z', 'APPROVE'),
    at('2026-08-02T00:00:00Z', 'CHANGES_REQUIRED')
  ]));
  assert.equal(result.status, 'rejected');
  assert.match(result.detail, /PREDATES this block/);
});

test('FALSIFIER: [AMEND_REQUIRED, APPROVE] must PASS — the normal lifecycle survives', () => {
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    at('2026-08-01T00:00:00Z', 'AMEND_REQUIRED'),
    at('2026-08-02T00:00:00Z', 'APPROVE')
  ]));
  assert.equal(result.status, 'satisfied');
});

test('ordering falls back to append order when timestamps are absent', () => {
  assert.equal(
    assessDistinctReview(ROOT, 'fixture-plan', marker([{ verdict: 'APPROVE' }, { verdict: 'AMEND_REQUIRED' }])).status,
    'rejected'
  );
  assert.equal(
    assessDistinctReview(ROOT, 'fixture-plan', marker([{ verdict: 'AMEND_REQUIRED' }, { verdict: 'APPROVE' }])).status,
    'satisfied'
  );
});

test('an unclassified verdict blocks and is reported as unclassified', () => {
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    at('2026-08-01T00:00:00Z', 'completion-ready')
  ]));
  assert.equal(result.status, 'unclassified');
});

test('a pending entry still blocks', () => {
  assert.equal(assessDistinctReview(ROOT, 'fixture-plan', marker([at('2026-08-01T00:00:00Z', 'pending')])).status, 'pending');
  assert.equal(assessDistinctReview(ROOT, 'fixture-plan', marker([], [{ actor: 'codex', note: 'in flight' }])).status, 'pending');
});

test('an empty marker is missing, never satisfied', () => {
  assert.equal(assessDistinctReview(ROOT, 'fixture-plan', marker([])).status, 'missing');
  assert.equal(assessDistinctReview(ROOT, 'fixture-plan', null).status, 'missing');
});

test('RETIRED: a review artifact on disk can no longer satisfy the gate by filename', () => {
  // 'mythos-core-rebase-research' has real codex-cli-run__* artifacts naming it
  // in _dev/reports/analysis/. Under the old glob fallback their mere existence
  // returned 'satisfied-legacy'. With an empty marker it must now be 'missing'.
  const result = assessDistinctReview(ROOT, 'mythos-core-rebase-research', marker([]));
  assert.equal(result.status, 'missing');
});

test('malformed review entries cannot crash or authorize', () => {
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([null, 'a string', 42, { no_verdict_key: true }]));
  assert.notEqual(result.status, 'satisfied');
});

test('classifying a verdict does not mutate the caller\'s review entries', () => {
  const entries = [at('2026-08-01T00:00:00Z', 'APPROVE')];
  assessDistinctReview(ROOT, 'fixture-plan', marker(entries));
  assert.equal('__index' in entries[0], false, 'ordering index must not leak onto caller state');
});

// ROUND-4 REVIEW FINDINGS (codex-last-message__20260820T190400Z, AMEND_REQUIRED)

test('FALSIFIER: a calendar-invalid "approval" timestamp cannot normalize past a real block', () => {
  // 2026-02-30 does not exist; raw Date.parse() silently normalizes it to
  // 2026-03-02, which used to let this fixture authorize past a block dated
  // one day earlier on the calendar (2026-03-01). It must not.
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    at('2026-03-01T00:00:00Z', 'AMEND_REQUIRED'),
    at('2026-02-30T00:00:00Z', 'APPROVE')
  ]));
  assert.notEqual(result.status, 'satisfied');
});

test('a calendar-invalid timestamp falls back to append order like any other unparseable timestamp', () => {
  // Malformed timestamp on the approval, well-formed on the block: append
  // order decides, same as the existing "mixed timestamp and append ordering"
  // fail-closed case, since strict parsing treats it as unparseable rather
  // than silently normalized.
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    at('2026-02-30T00:00:00Z', 'APPROVE'),
    at('2026-08-01T00:00:00Z', 'AMEND_REQUIRED')
  ]));
  assert.equal(result.status, 'rejected');
});

test('the reported blocker is never falsely claimed to postdate a later approval', () => {
  // Block on Aug 1, APPROVE on Aug 3 (postdates the block), unclassified note
  // on Aug 4 (postdates the approval). Authorization correctly fails because
  // no single approval postdates every non-authorizing entry, but the named
  // withholding evidence must be the Aug 4 unclassified entry — not the
  // already-superseded Aug 1 block — and no PREDATES claim may be made about
  // the Aug 3 approval, since it genuinely postdates the block.
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    at('2026-08-01T00:00:00Z', 'AMEND_REQUIRED'),
    at('2026-08-03T00:00:00Z', 'APPROVE'),
    at('2026-08-04T00:00:00Z', 'not sure about this one')
  ]));
  assert.notEqual(result.status, 'satisfied');
  assert.equal(result.status, 'unclassified');
  assert.match(result.detail, /not sure about this one/);
  assert.doesNotMatch(result.detail, /PREDATES/);
});

test('a block that no approval postdates is still reported as the rejection reason, with a truthful PREDATES claim', () => {
  const result = assessDistinctReview(ROOT, 'fixture-plan', marker([
    at('2026-08-01T00:00:00Z', 'APPROVE'),
    at('2026-08-03T00:00:00Z', 'AMEND_REQUIRED')
  ]));
  assert.equal(result.status, 'rejected');
  assert.match(result.detail, /PREDATES/);
});
