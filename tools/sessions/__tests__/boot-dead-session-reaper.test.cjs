'use strict';

// S2 crash-path + reaper (plan session-boundary-leak-repairs):
// the boot-time dead-session reaper is ADVISORY ONLY (gate G3). It surfaces
// crash-stub orphans and stale-completed scopes (M135-class) with evidence
// links and resume-or-tombstone options, and NEVER mutates the pending surface.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { reapDeadSessions, planIdCandidates, gradeReviewEvent } = require('../boot-dead-session-reaper.cjs');
const { writeMarker, peekPending } = require('../lib/boundary-markers.cjs');

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'smos-reaper-'));
}

function writeReviewState(root, planId, lastEvent) {
  const dir = path.join(root, '_dev', 'state', 'plan-task-review-state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${planId}.json`), JSON.stringify({
    plan_id: planId,
    last_event: lastEvent,
    updated_at: '2026-07-03T12:08:42.231Z',
    notes: 'fixture',
    distinct_reviews: [{ actor: 'codex', verdict: 'approve-with-minor', artifact: '_dev/reports/analysis/codex-x.md', at: '2026-07-03T12:05:58Z' }]
  }, null, 2));
}

// Reconstruct the live M135 specimen shape.
function seedSpecimen(root) {
  // 1. crash-stub orphan (session died without /shutdown)
  writeMarker({
    schema: 'SessionBoundary/1.0',
    scope: 'system-unclosed-session',
    handoff_path: '_dev/reports/analysis/next-session-handoff.md',
    recommended_next_command: '/whats-next',
    summary: 'MECHANICAL STUB (session-end crash floor): session abcd1234 ended without a fresh boundary marker.',
    written_by: 'session-end-close.cjs (mechanical stub, session abcd1234)'
  }, { root });
  // 2. stale-completed (M135-class): pending scope whose plan is already approved
  writeMarker({
    schema: 'SessionBoundary/1.0',
    scope: 'worldforge-m135',
    handoff_path: '_dev/handoffs/next-session__worldforge-m135__20260703.md',
    recommended_next_command: '/plan-task worldforge-m135-presence-runtime-render --scope system'
  }, { root });
  writeReviewState(root, 'worldforge-m135-presence-runtime-render', 'distinct_review_approved_with_minor');
  // 3. active scope — no completion evidence, not a crash stub -> NOT surfaced
  writeMarker({
    schema: 'SessionBoundary/1.0',
    scope: 'client:{CLIENT_CODE}',
    handoff_path: '_dev/reports/analysis/next-session-handoff__client-{CLIENT_CODE}.md',
    recommended_next_command: '/whats-next'
  }, { root });
}

test('reaper surfaces the crash-stub orphan and the stale-completed M135 scope, not the active one', () => {
  const root = makeRoot();
  seedSpecimen(root);
  const report = reapDeadSessions({ root });
  assert.equal(report.schema, 'DeadSessionReaperReport/1.0');
  assert.equal(report.advisory, true);
  assert.equal(report.auto_tombstone, false);
  assert.equal(report.pending_count, 3);
  assert.equal(report.surfaced_count, 2);

  const scopes = report.surfaced.map((s) => s.scope).sort();
  assert.deepEqual(scopes, ['system-unclosed-session', 'worldforge-m135']);
  assert.ok(!scopes.includes('client:{CLIENT_CODE}'), 'active scope must not be surfaced');

  const crash = report.surfaced.find((s) => s.scope === 'system-unclosed-session');
  assert.ok(crash.classifications.includes('crash_stub_orphan'));

  const m135 = report.surfaced.find((s) => s.scope === 'worldforge-m135');
  // distinct_review_approved_with_minor is a REVIEW approval, not operator-final:
  // it grades to the weaker stale_review_approved (an operator gate may remain).
  assert.ok(m135.classifications.includes('stale_review_approved'));
  assert.ok(!m135.classifications.includes('stale_completed'), 'review-with-minor must not claim operator-final completion');
  assert.equal(m135.completion_evidence.length, 1);
  const evidence = m135.completion_evidence[0];
  assert.equal(evidence.plan_id, 'worldforge-m135-presence-runtime-render');
  assert.equal(evidence.last_event, 'distinct_review_approved_with_minor');
  assert.equal(evidence.grade, 'stale_review_approved');
  assert.equal(evidence.link, 'exact-plan-id');
  assert.match(evidence.review_state_path, /plan-task-review-state\/worldforge-m135-presence-runtime-render\.json$/);
  assert.equal(evidence.review_artifacts.length, 1);
  // The tombstone note must NOT imply readiness for a review-only grade.
  assert.match(m135.options.tombstone.note, /operator gate may still remain|not to imply tombstone/i);
});

test('classifier grades: operator-final -> stale_completed; distinct-review -> stale_review_approved', () => {
  assert.equal(gradeReviewEvent('operator_approved'), 'stale_completed');
  assert.equal(gradeReviewEvent('operator_stamped'), 'stale_completed');
  assert.equal(gradeReviewEvent('s6_complete_ledgers_stamped'), 'stale_completed');
  assert.equal(gradeReviewEvent('distinct_review_approved_with_minor'), 'stale_review_approved');
  assert.equal(gradeReviewEvent('distinct_review_complete'), 'stale_review_approved');
  assert.equal(gradeReviewEvent('post_review_approved'), 'stale_review_approved');
  // Non-completion grades stay unflagged.
  assert.equal(gradeReviewEvent('review_pending'), null);
  assert.equal(gradeReviewEvent('post_repair'), null);
  assert.equal(gradeReviewEvent('distinct_review_recorded'), null);
});

test('an operator_stamped plan grades to stale_completed with a stronger tombstone note', () => {
  const root = makeRoot();
  writeMarker({
    schema: 'SessionBoundary/1.0',
    scope: 'done-plan',
    handoff_path: '_dev/reports/analysis/next-session-handoff.md',
    recommended_next_command: '/run-plan done-plan'
  }, { root });
  writeReviewState(root, 'done-plan', 'operator_stamped');
  const report = reapDeadSessions({ root });
  const item = report.surfaced.find((s) => s.scope === 'done-plan');
  assert.ok(item.classifications.includes('stale_completed'));
  assert.match(item.options.tombstone.note, /confirms .* is complete/i);
});

test('every surfaced item carries resume + tombstone options with the exact consume command', () => {
  const root = makeRoot();
  seedSpecimen(root);
  const report = reapDeadSessions({ root });
  for (const item of report.surfaced) {
    assert.match(item.options.resume.command, /consume-boundary\.cjs /);
    assert.ok(item.options.tombstone.note.length > 0);
    // The advisory never presents an auto path — the command is operator-run.
    assert.match(item.options.tombstone.command, /consume-boundary\.cjs /);
  }
});

test('G3: the reaper is advisory — pending markers are unchanged after a scan', () => {
  const root = makeRoot();
  seedSpecimen(root);
  const before = peekPending({ root }).map((m) => m.scope).sort();
  reapDeadSessions({ root });
  reapDeadSessions({ root });
  const after = peekPending({ root }).map((m) => m.scope).sort();
  assert.deepEqual(after, before, 'reaper must not consume/tombstone any pending marker');
  assert.equal(after.length, 3);
});

test('G3 regression: a legacy single-file marker is byte-identical and unmoved after a scan', () => {
  const root = makeRoot();
  // A legacy single-file marker exists; the per-scope dir does NOT yet hold it.
  const legacyPath = path.join(root, '_dev', 'state', 'session-boundary-pending.json');
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  const legacyBody = JSON.stringify({
    schema: 'SessionBoundary/1.0',
    scope: 'legacy-scope',
    handoff_path: '_dev/h.md',
    recommended_next_command: '/whats-next'
  }, null, 2);
  fs.writeFileSync(legacyPath, legacyBody);
  const perScopePath = path.join(root, '_dev', 'state', 'session-boundary', 'pending', 'legacy-scope.json');

  const before = fs.readFileSync(legacyPath); // Buffer

  const report = reapDeadSessions({ root });

  // The legacy file is byte-identical and still at its original path — NOT moved.
  assert.equal(fs.existsSync(legacyPath), true, 'legacy marker must not be moved by the advisory scan');
  assert.ok(before.equals(fs.readFileSync(legacyPath)), 'legacy marker bytes must be identical after scan');
  assert.equal(fs.existsSync(perScopePath), false, 'reaper must NOT migrate the legacy marker into the per-scope dir');

  // It is still SURFACED as advisory evidence, in place.
  const surfaced = report.surfaced.find((s) => s.scope === 'legacy-scope');
  assert.ok(surfaced, 'legacy marker should be surfaced as advisory');
  assert.equal(surfaced.legacy_marker, true);
  assert.ok(surfaced.classifications.includes('legacy_marker_unmigrated'));
});

test('G3: the reaper reads the pending surface only through the non-mutating path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'boot-dead-session-reaper.cjs'), 'utf8');
  // No archive/consume/write/delete of the pending surface may exist.
  assert.ok(!/\bconsume\s*\(/.test(src), 'reaper must not call consume()');
  assert.ok(!/\bwriteMarker\s*\(/.test(src), 'reaper must not call writeMarker()');
  assert.ok(!/fs\.(unlink|rename|writeFileSync|rmSync|rm)\b/.test(src), 'reaper must not delete/rename/write files');
  // Helper-side effects: the reaper must NOT reach migrateLegacy (directly or via
  // listPending). It reads only through peekPending, which never migrates.
  assert.ok(!/\bmigrateLegacy\b/.test(src), 'reaper must not invoke migrateLegacy (a write)');
  assert.ok(!/\blistPending\b/.test(src), 'reaper must not use listPending (it runs migrateLegacy); use peekPending');
  assert.ok(/\bpeekPending\s*\(/.test(src), 'reaper must read the pending surface via peekPending');
});

test('planIdCandidates skips flag values (e.g. --scope system) but keeps the plan-id token', () => {
  const candidates = planIdCandidates({
    scope: 'worldforge-m135',
    recommended_next_command: '/plan-task worldforge-m135-presence-runtime-render --scope system'
  });
  assert.ok(candidates.includes('worldforge-m135'));
  assert.ok(candidates.includes('worldforge-m135-presence-runtime-render'));
  assert.ok(!candidates.includes('system'), 'flag value "system" must not be a plan-id candidate');
});

test('non-completion review states (pending/repair) do not flag a scope as stale-completed', () => {
  const root = makeRoot();
  writeMarker({
    schema: 'SessionBoundary/1.0',
    scope: 'in-progress-plan',
    handoff_path: '_dev/reports/analysis/next-session-handoff.md',
    recommended_next_command: '/run-plan in-progress-plan'
  }, { root });
  writeReviewState(root, 'in-progress-plan', 'review_pending');
  const report = reapDeadSessions({ root });
  assert.equal(report.surfaced_count, 0, 'a pending review state is not completion evidence');
});
