'use strict';

/**
 * Tests for the lessons-note lineage fix (lessons synthesis
 * 2026-06-03→2026-06-10 root 3; 2026-06-04 P5, 2026-06-05 LR-002):
 * appendLessonsNote records the stable signal id alongside the source-signal
 * path so notes survive the live→closed signal move.
 *
 * Run: node --test tools/signals/lib/__tests__/lessons-note-lineage.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  appendLessonsNote,
  ensureLessonsDocument,
  extractAutomatedRunNoteTimestamps
} = require('../codex-auto');

function makeLessonsFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-note-lineage-'));
  const filePath = path.join(dir, 'session-learnings__2026-06-10__auto-runs.md');
  ensureLessonsDocument(filePath, '2026-06-10T00:00:00.000Z');
  return { dir, filePath };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

const BASE_NOTE = {
  timestamp: '20260610T120000Z',
  scope: 'lineage-test-scope',
  sourceSignal: '_dev/reports/signals/ready-for-review__20260610T110000Z__lineage-test-scope.json',
  triggerCommand: '/reconcile-lessons 2026-06-08',
  exitStatus: 'success',
  outcome: 'success',
  completionArtifact: '_dev/reports/analysis/codex-cli-run__20260610T120000Z__lineage-test-scope.md',
  followUpSignal: '_dev/reports/signals/ready-for-review__20260610T120000Z__lineage-test-scope.json',
  summary: 'Automated Codex bridge run completed and published a ready-for-review signal.'
};

describe('appendLessonsNote — stable signal id lineage', () => {
  it('records the signal id alongside the source-signal path', () => {
    const { dir, filePath } = makeLessonsFile();
    try {
      appendLessonsNote(filePath, {
        ...BASE_NOTE,
        signalId: 'ready-for-review__20260610T110000Z__lineage-test-scope.json'
      });
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes(`- Source signal: \`${BASE_NOTE.sourceSignal}\``));
      assert.ok(
        content.includes('- Source signal id: `ready-for-review__20260610T110000Z__lineage-test-scope.json`'),
        'note must carry the stable signal id line'
      );
      // The id line sits directly after the path line, inside the same note.
      const pathIdx = content.indexOf('- Source signal: ');
      const idIdx = content.indexOf('- Source signal id: ');
      assert.ok(idIdx > pathIdx, 'signal id line follows the source-signal path line');
    } finally {
      cleanup(dir);
    }
  });

  it('omits the id line when no signalId is provided (backward compatible)', () => {
    const { dir, filePath } = makeLessonsFile();
    try {
      appendLessonsNote(filePath, BASE_NOTE);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('- Source signal: `'));
      assert.ok(!content.includes('- Source signal id:'));
    } finally {
      cleanup(dir);
    }
  });

  it('extractAutomatedRunNoteTimestamps still parses notes carrying the id line', () => {
    const { dir, filePath } = makeLessonsFile();
    try {
      appendLessonsNote(filePath, {
        ...BASE_NOTE,
        signalId: 'ready-for-review__20260610T110000Z__lineage-test-scope.json'
      });
      appendLessonsNote(filePath, {
        ...BASE_NOTE,
        timestamp: '2026-06-10T13:00:00Z',
        signalId: 'coord-20260610130000000-abc123'
      });
      const timestamps = extractAutomatedRunNoteTimestamps(filePath);
      assert.equal(timestamps.length, 2, 'both note headings must still parse');
      assert.equal(timestamps[0], Date.parse('2026-06-10T12:00:00Z'));
      assert.equal(timestamps[1], Date.parse('2026-06-10T13:00:00Z'));
    } finally {
      cleanup(dir);
    }
  });
});
