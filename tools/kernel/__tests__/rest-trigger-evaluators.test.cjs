'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const writer = require(path.join(REPO_ROOT, 'tools/kernel/lib/arc-state-writer.cjs'));
const evaluators = require(path.join(REPO_ROOT, 'tools/kernel/lib/rest-trigger-evaluators.cjs'));

function withTempArcDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-arc-rest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MYTHOS_ACTOR_ARC_DIR = dir;
  t.after(() => {
    delete process.env.MYTHOS_ACTOR_ARC_DIR;
  });
}

function seedArc() {
  writer.createArc({
    arc_id: 'arc-rest-001',
    workstream_scope: 'actor-arc-state-machine',
    scope_identity: { workstream_scope: 'actor-arc-state-machine' },
    declared_write_set: ['tools/kernel/**'],
    forbidden_artifacts: ['instructions/canonical/kernel/**'],
    authority_source: { kind: 'approved-plan', ref: 'plan.json' },
    parent_arc_id: null,
    authorized_at: '2026-04-24T16:00:00-0300',
    lifecycle_state: 'authorized-for-arc',
    actor_id: 'claude-main-chain-session:test',
    actor_tier: 'main-chain',
    arc_ended_at: null,
    end_reason: null
  });
}

test('context-budget fires at threshold', () => {
  const result = evaluators.evaluateContextBudget(70);
  assert.equal(result.triggered, true);
  assert.equal(result.trigger_id, 'context-budget');
});

test('consecutive-review-failures fires on trailing NEEDS-ADJUSTMENT entries', () => {
  const result = evaluators.evaluateConsecutiveReviewFailures([
    'APPROVE',
    'NEEDS-ADJUSTMENT',
    'NEEDS-ADJUSTMENT',
    'NEEDS-ADJUSTMENT'
  ]);
  assert.equal(result.triggered, true);
  assert.equal(result.evidence.trailing_failures, 3);
});

test('ambiguity-load fires when there are multiple viable next actions', () => {
  const result = evaluators.evaluateAmbiguityLoad(['/run-plan a', '/run-plan b']);
  assert.equal(result.triggered, true);
  assert.equal(result.trigger_id, 'ambiguity-load');
});

test('scope-expansion-attempted fires when target escapes current arc scope', (t) => {
  withTempArcDir(t);
  seedArc();
  const result = evaluators.evaluateScopeExpansionAttempted(
    'claude-main-chain-session:test',
    'instructions/canonical/kernel/doctrine/index.md'
  );
  assert.equal(result.triggered, true);
  assert.equal(result.trigger_id, 'scope-expansion-attempted');
});

test('scope-expansion-attempted does not false-positive on within-arc progression', (t) => {
  withTempArcDir(t);
  seedArc();
  const result = evaluators.evaluateScopeExpansionAttempted(
    'claude-main-chain-session:test',
    'tools/kernel/lib/arc-state-writer.cjs'
  );
  assert.equal(result.triggered, false);
});

test('contradiction-density fires when enough sibling contradictions accumulate', () => {
  const result = evaluators.evaluateContradictionDensity([
    { contradiction: true },
    { contradiction: true }
  ]);
  assert.equal(result.triggered, true);
  assert.equal(result.trigger_id, 'contradiction-density');
});
