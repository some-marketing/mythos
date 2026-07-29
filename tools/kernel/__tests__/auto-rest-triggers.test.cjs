'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const writer = require(path.join(REPO_ROOT, 'tools/kernel/lib/arc-state-writer.cjs'));
const evaluators = require(path.join(REPO_ROOT, 'tools/kernel/lib/rest-trigger-evaluators.cjs'));
const posttool = require(path.join(REPO_ROOT, 'tools/kernel/hooks/posttool-arc-rest-check.cjs'));

function withEnv(t, values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function seedExecutingArc(actorId) {
  writer.createArc({
    arc_id: 'arc-auto-rest-test',
    workstream_scope: 'auto-rest-mechanical-triggers',
    scope_identity: { slug: 'auto-rest-mechanical-triggers' },
    declared_write_set: ['tools/kernel/**'],
    forbidden_artifacts: ['instructions/canonical/**'],
    authority_source: { kind: 'approved-plan', ref: 'auto-rest-mechanical-triggers__plan.json' },
    parent_arc_id: null,
    authorized_at: '2026-06-05T17:00:00.000Z',
    lifecycle_state: 'executing',
    actor_id: actorId,
    actor_tier: 'main-chain',
    arc_ended_at: null,
    end_reason: null
  });
}

test('consecutive-review-failures requires failures on the requested scope', () => {
  const history = [
    { scope_key: 'alpha', verdict: 'NEEDS-ADJUSTMENT' },
    { scope_key: 'beta', verdict: 'NEEDS-ADJUSTMENT' },
    { scope_key: 'beta', verdict: 'REJECTED' },
    { scope_key: 'beta', verdict: 'BLOCK' }
  ];

  const alpha = evaluators.evaluateConsecutiveReviewFailures(history, null, {
    scope_key: 'alpha'
  });
  assert.equal(alpha.triggered, false);
  assert.equal(alpha.evidence.trailing_failures, 1);
  assert.equal(alpha.evidence.skipped_mismatched_scope, 3);

  const beta = evaluators.evaluateConsecutiveReviewFailures(history, null, {
    scope_key: 'beta'
  });
  assert.equal(beta.triggered, true);
  assert.equal(beta.evidence.trailing_failures, 3);
});

test('consecutive-review-failures ignores internal review cascade fixtures', () => {
  const result = evaluators.evaluateConsecutiveReviewFailures([
    { scope_key: 'alpha', verdict: 'NEEDS-ADJUSTMENT', phase: 'internal-review' },
    { scope_key: 'alpha', verdict: 'NEEDS-ADJUSTMENT', failure_class: 'internal-phase-cascade' },
    { scope_key: 'alpha', verdict: 'NEEDS-ADJUSTMENT', review_phase: 'internal_review_cascade' }
  ], null, { scope_key: 'alpha' });

  assert.equal(result.triggered, false);
  assert.equal(result.evidence.trailing_failures, 0);
  assert.equal(result.evidence.skipped_internal_phase_cascade, 3);
});

test('scope-expansion-attempted carries checkpoint authorization outcome', (t) => {
  const arcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-rest-arc-'));
  t.after(() => fs.rmSync(arcDir, { recursive: true, force: true }));
  withEnv(t, {
    MYTHOS_ACTOR_ARC_DIR: arcDir,
    MYTHOS_ACTOR_ID: 'codex-auto-rest-test'
  });
  seedExecutingArc('codex-auto-rest-test');

  const result = evaluators.evaluateScopeExpansionAttempted(
    'codex-auto-rest-test',
    'instructions/canonical/guardrails.md'
  );

  assert.equal(result.triggered, true);
  assert.equal(result.advisory_outcome, 'checkpoint_and_request_authorization');
  assert.equal(result.evidence.recommended_outcome, 'checkpoint_and_request_authorization');
});

test('posttool auto-rest hook logs advisory evidence without transitioning arc', (t) => {
  const arcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-rest-arc-'));
  const logPath = path.join(
    REPO_ROOT,
    '_dev/reports/lifecycle',
    `auto-rest-test-${process.pid}-${Date.now()}.jsonl`
  );
  t.after(() => {
    fs.rmSync(arcDir, { recursive: true, force: true });
    fs.rmSync(logPath, { force: true });
  });
  withEnv(t, {
    MYTHOS_ACTOR_ARC_DIR: arcDir,
    MYTHOS_ACTOR_ID: 'codex-auto-rest-test',
    MYTHOS_HOOK_EVENT_LOG: logPath,
    CLAUDE_TOOL_INPUT: JSON.stringify({ file_path: 'instructions/canonical/guardrails.md' })
  });
  seedExecutingArc('codex-auto-rest-test');

  assert.equal(posttool.main(), 0);
  const after = writer.readCurrentArc('codex-auto-rest-test');
  assert.equal(after.lifecycle_state, 'executing');

  const events = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'auto-rest-advisory');
  assert.equal(events[0].detail.trigger_id, 'scope-expansion-attempted');
  assert.equal(events[0].detail.advisory_outcome, 'checkpoint_and_request_authorization');
});

test('posttool auto-rest hook has no pre-A3 transition surface', () => {
  const hookSource = fs.readFileSync(
    path.join(REPO_ROOT, 'tools/kernel/hooks/posttool-arc-rest-check.cjs'),
    'utf8'
  );
  assert.equal(/\btransitionArc\b/.test(hookSource), false);
});
