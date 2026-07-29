'use strict';

/**
 * Tests for the lessons-reconciliation due-status logic — the lane that was
 * dead from launch because the checker read a filename scheme no writer used
 * and Date.parse rejected the compact note timestamps agents actually write.
 * Run: node --test tools/signals/lib/__tests__/lessons-reconciliation-status.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getLessonsReconciliationStatus,
  emitLessonsReconciliationSignal,
  lessonsReconciliationCommand,
  listLessonsFiles,
  extractAutomatedRunNoteTimestamps,
  latestReconciliationArtifactMs,
  LESSONS_RECONCILIATION_THRESHOLD
} = require('../codex-auto');

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-status-'));
  fs.mkdirSync(path.join(root, '_dev', 'reports', 'analysis'), { recursive: true });
  return root;
}

function writeLearnings(root, filename, noteTimestamps) {
  const lines = [
    '# Session Learnings: Automated Codex Runs',
    '',
    '## Automated Codex Run Notes',
    ''
  ];
  for (const ts of noteTimestamps) {
    lines.push(`### ${ts} -- some-scope`, '- Exit status: success', '');
  }
  fs.writeFileSync(path.join(root, '_dev', 'reports', 'analysis', filename), lines.join('\n'));
}

test('compact agent-closeout filenames are discovered', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260610T1__auto-runs.md', []);
  writeLearnings(root, 'session-learnings__20260610T2__auto-runs.md', []);
  writeLearnings(root, 'session-learnings__2026-06-10__auto-runs.md', []);
  fs.writeFileSync(path.join(root, '_dev', 'reports', 'analysis', 'session-learnings__notes.md'), 'not a lane file');
  const files = listLessonsFiles(root);
  assert.strictEqual(files.length, 3);
});

test('compact note timestamps parse (the on-disk reality)', () => {
  const root = makeRepo();
  const file = path.join(root, '_dev', 'reports', 'analysis', 'session-learnings__20260610T1__auto-runs.md');
  writeLearnings(root, 'session-learnings__20260610T1__auto-runs.md', [
    '20260610T110845Z',
    '2026-06-10T12:00:00Z'
  ]);
  const ts = extractAutomatedRunNoteTimestamps(file);
  assert.strictEqual(ts.length, 2);
  assert.strictEqual(ts[0], Date.parse('2026-06-10T11:08:45Z'));
});

test('threshold notes across compact-named files -> due', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260610T1__auto-runs.md', [
    '20260610T110000Z', '20260610T111000Z', '20260610T112000Z'
  ]);
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.strictEqual(status.notesSinceLastReconciliation, LESSONS_RECONCILIATION_THRESHOLD);
  assert.strictEqual(status.due, true);
  assert.ok(status.reasons.includes(`turn-cadence-${LESSONS_RECONCILIATION_THRESHOLD}`));
});

test('below threshold -> not due', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260610T1__auto-runs.md', [
    '20260610T110000Z', '20260610T111000Z'
  ]);
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.strictEqual(status.due, false);
});

test('backlog from PRIOR days counts (global, not per-day)', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260608T1__auto-runs.md', [
    '20260608T100000Z', '20260608T101000Z'
  ]);
  writeLearnings(root, 'session-learnings__20260610T1__auto-runs.md', [
    '20260610T110000Z'
  ]);
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.strictEqual(status.notesSinceLastReconciliation, 3);
  assert.strictEqual(status.due, true);
});

// CRITICAL-finding regression (Codex review 2026-06-10): a reconciliation
// artifact covers ONLY its own date's files. A latest/other-date artifact must
// never absolve an older date's backlog.
test('reconciliation artifact for another date does NOT reset older notes', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260608T1__auto-runs.md', [
    '20260608T100000Z', '20260608T101000Z', '20260608T102000Z'
  ]);
  const reconPath = path.join(root, '_dev', 'reports', 'analysis',
    'lessons-reconciliation__2026-06-09.expectation-failures.json');
  fs.writeFileSync(reconPath, JSON.stringify({ reconciled_at: '2026-06-09T08:00:00Z' }));
  assert.strictEqual(latestReconciliationArtifactMs(root), Date.parse('2026-06-09T08:00:00Z'));
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.strictEqual(status.notesSinceLastReconciliation, 3);
  assert.strictEqual(status.due, true);
  assert.deepStrictEqual(status.uncoveredDates, ['2026-06-08']);
  assert.strictEqual(status.oldestUncoveredDate, '2026-06-08');
});

test('reconciliation artifact for the SAME date covers that date', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260608T1__auto-runs.md', [
    '20260608T100000Z', '20260608T101000Z', '20260608T102000Z'
  ]);
  fs.writeFileSync(
    path.join(root, '_dev', 'reports', 'analysis', 'lessons-reconciliation__2026-06-08.expectation-failures.json'),
    JSON.stringify({ reconciled_at: '2026-06-09T08:00:00Z' })
  );
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.strictEqual(status.notesSinceLastReconciliation, 0);
  assert.strictEqual(status.due, false);
});

test('notes after the same-date reconciliation count again', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260610T1__auto-runs.md', [
    '20260610T070000Z', '20260610T110000Z', '20260610T112000Z', '20260610T113000Z'
  ]);
  fs.writeFileSync(
    path.join(root, '_dev', 'reports', 'analysis', 'lessons-reconciliation__2026-06-10.expectation-failures.json'),
    JSON.stringify({ reconciled_at: '2026-06-10T08:00:00Z' })
  );
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.strictEqual(status.notesSinceLastReconciliation, 3);
  assert.strictEqual(status.due, true);
});

test('recommended command targets the OLDEST uncovered date', () => {
  const root = makeRepo();
  writeLearnings(root, 'session-learnings__20260604T1__auto-runs.md', ['20260604T100000Z']);
  writeLearnings(root, 'session-learnings__20260608T1__auto-runs.md', ['20260608T100000Z', '20260608T101000Z']);
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.deepStrictEqual(status.uncoveredDates, ['2026-06-04', '2026-06-08']);
  assert.strictEqual(lessonsReconciliationCommand(status), '/reconcile-lessons 2026-06-04');
});

test('emitLessonsReconciliationSignal: emits once, skips while live, supersedes on request', () => {
  const root = makeRepo();
  fs.mkdirSync(path.join(root, '_dev', 'reports', 'signals'), { recursive: true });
  writeLearnings(root, 'session-learnings__20260610T1__auto-runs.md', [
    '20260610T110000Z', '20260610T111000Z', '20260610T112000Z'
  ]);
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});

  const first = emitLessonsReconciliationSignal(root, status, {});
  assert.strictEqual(first.emitted, true);
  assert.ok(fs.existsSync(first.signalPath));

  const second = emitLessonsReconciliationSignal(root, status, {});
  assert.strictEqual(second.emitted, false);
  assert.strictEqual(second.skippedReason, 'live-signal-present');

  const third = emitLessonsReconciliationSignal(root, status, { supersede: true });
  assert.strictEqual(third.emitted, true);
  const signal = JSON.parse(fs.readFileSync(third.signalPath, 'utf8'));
  assert.strictEqual(signal.recommended_next_command, '/reconcile-lessons 2026-06-10');
  assert.ok(signal.supersedes_signal);
  // L5 retarget: codex-targeted with an auto-runnable execution contract
  assert.strictEqual(signal.recommended_next_actor, 'codex');
  assert.strictEqual(signal.execution.mode, 'patch-allowed');
  // lock released
  assert.strictEqual(fs.existsSync(path.join(root, '_dev', 'reports', 'signals', '.lessons-reconciliation.lock')), false);
});

test('empty repo -> not due, no throw', () => {
  const root = makeRepo();
  const status = getLessonsReconciliationStatus(root, '2026-06-10T13:00:00Z', {});
  assert.strictEqual(status.due, false);
  assert.strictEqual(status.notesSinceLastReconciliation, 0);
});
