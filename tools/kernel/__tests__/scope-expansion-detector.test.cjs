'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const detector = require(path.join(REPO_ROOT, 'tools/kernel/lib/scope-expansion-detector.cjs'));

const CURRENT_ARC = {
  arc_id: 'arc-001',
  workstream_scope: 'actor-arc-state-machine',
  declared_write_set: ['tools/kernel/**', '.claude/commands/arc-*.md', '_dev/state/actor-arc/**'],
  forbidden_artifacts: ['instructions/canonical/kernel/**', 'tools/kernel/doctrine-reflex.cjs']
};

test('allows writes inside declared_write_set globs', () => {
  const result = detector.checkWriteTargetAgainstArc(
    CURRENT_ARC,
    'tools/kernel/lib/arc-state-writer.cjs'
  );
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'within_declared_write_set');
});

test('subset inheritance treats child write sets as valid subsets of parent globs', () => {
  assert.equal(
    detector.isWriteSetSubset(
      ['tools/kernel/lib/**', '.claude/commands/arc-status.md'],
      CURRENT_ARC.declared_write_set
    ),
    true
  );
});

test('forbidden_artifacts precedence overrides declared_write_set overlap', () => {
  const result = detector.checkWriteTargetAgainstArc(
    CURRENT_ARC,
    'tools/kernel/doctrine-reflex.cjs'
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'forbidden_artifact');
  assert.equal(result.violation.class, 'forbidden_artifact');
});

test('missing arc returns a no_current_arc fallback', () => {
  const result = detector.checkWriteTargetAgainstArc(null, 'tools/kernel/lib/arc-state-writer.cjs');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'no_current_arc');
});

test('forbidden superset helper enforces child cannot unlock parent-forbidden surfaces', () => {
  assert.equal(
    detector.isForbiddenSuperset(
      ['instructions/canonical/kernel/**', 'tools/kernel/doctrine-reflex.cjs'],
      ['instructions/canonical/kernel/**']
    ),
    true
  );
});
