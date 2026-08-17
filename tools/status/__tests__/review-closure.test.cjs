'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatText, getArchiveableArtifacts } = require('../review-closure');

test('review closure renders explicit counts and join gaps without a percentage', () => {
  const output = formatText({ counts: { live_signals: 2, active_plans: 3, completed_verified_outcomes: 4, deferred_maintenance: 1, archiveable_artifacts: 5 }, gaps: { active_plans_without_live_signal: ['a'], completed_outcomes_without_artifact: ['b'], orphaned_outcome_artifacts: ['c'] } });
  assert.match(output, /Live signals:\s+2/);
  assert.match(output, /Completed verified outcomes:\s+4/);
  assert.match(output, /1 active plans without live signals/);
  assert.doesNotMatch(output, /%/);
});

test('archiveable artifact reader preserves newest and protected files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-closure-'));
  try {
    const analysis = path.join(root, '_dev/reports/analysis');
    fs.mkdirSync(analysis, { recursive: true });
    for (const name of ['new.json', 'old.json', 'protected.json']) fs.writeFileSync(path.join(analysis, name), '{}');
    const now = Date.now();
    fs.utimesSync(path.join(analysis, 'new.json'), now / 1000, now / 1000);
    fs.utimesSync(path.join(analysis, 'old.json'), (now - 8 * 86400000) / 1000, (now - 8 * 86400000) / 1000);
    fs.utimesSync(path.join(analysis, 'protected.json'), (now - 8 * 86400000) / 1000, (now - 8 * 86400000) / 1000);
    fs.mkdirSync(path.join(root, 'tools/artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools/artifacts/retention-policy.json'), JSON.stringify({ protected: ['_dev/reports/analysis/protected.json'] }));
    assert.deepEqual(getArchiveableArtifacts(root, now, 7).paths, ['_dev/reports/analysis/old.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
