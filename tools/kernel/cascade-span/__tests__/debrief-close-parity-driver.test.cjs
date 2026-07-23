'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRule, writeSessionTier } = require('../../hooks/lib/process-tier.cjs');
const { runPairedObservation, joinPairedObservations } = require('../debrief-close-parity-driver.cjs');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-parity-root-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-parity-state-'));
  const sessionId = `claude-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeSessionTier({
    sessionId,
    model: 'gpt-5.5',
    tier: 'associate',
    tierProvenance: 'resolved-model',
    source: 'test'
  }, { stateDir });
  const authoredDir = path.join(root, '_dev/state/delegation-altitude');
  fs.mkdirSync(authoredDir, { recursive: true });
  fs.writeFileSync(path.join(authoredDir, `${sessionId}.json`), JSON.stringify({ spawns: 0, edits: 1, paths: [] }));
  return { root, stateDir, sessionId };
}

function writeBound(sb, dirRel, name) {
  const file = path.join(sb.root, dirRel, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'evidence\n');
  const authored = path.join(sb.root, '_dev/state/delegation-altitude', `${sb.sessionId}.json`);
  const state = JSON.parse(fs.readFileSync(authored, 'utf8'));
  state.paths.push(file);
  fs.writeFileSync(authored, JSON.stringify(state));
}

function context(actionId) {
  return {
    action_id: actionId,
    trace_id: `trace-${actionId}`,
    parent_span_id: `parent-${actionId}`,
    logical_session_id: `logical-${actionId}`,
    scope_identity: 'sovereign-core-harness',
    work_unit: 'P4-S2-native-span-parity',
    lineage_root: `lineage-${actionId}`,
    layer_depth: 2
  };
}

for (const outcome of ['allow', 'deny']) {
  test(`real Claude Stop subdecision and native production interface match for ${outcome}`, (t) => {
    const sb = sandbox();
    t.after(() => {
      fs.rmSync(sb.root, { recursive: true, force: true });
      fs.rmSync(sb.stateDir, { recursive: true, force: true });
    });
    if (outcome === 'allow') {
      writeBound(sb, '_dev/reports/debriefs', 'paired-debrief.md');
      writeBound(sb, '_dev/reports/analysis/task-plan-reviews', 'paired-review.md');
    }
    const actionId = `paired-${outcome}`;
    const observationLogPath = path.join(sb.root, 'paired-observations.jsonl');
    const run = runPairedObservation({
      root: sb.root,
      context: context(actionId),
      workloadFamily: 'interactive',
      claudePayload: { session_id: sb.sessionId },
      claudeOptions: { stateDir: sb.stateDir, rule: readRule() },
      nativeDecision: {
        runtime_session_id: `native-runtime-${outcome}`,
        scope_identity: 'sovereign-core-harness',
        close_reason: 'quit',
        outcome,
        enforced: outcome === 'deny',
        decided_at: '2026-07-16T12:00:00.000Z'
      },
      spanLogPath: path.join(sb.root, 'paired-spans.jsonl'),
      observationLogPath
    });
    assert.equal(run.result.comparison.ok, true, run.result.comparison.mismatches.join('; '));
    assert.equal(run.result.claude_debrief_outcome, outcome);
    assert.equal(run.result.native_debrief_outcome, outcome);
    assert.notEqual(run.result.actual_runtime_session_ids.claude_hook, run.result.actual_runtime_session_ids.native);
    const rows = fs.readFileSync(observationLogPath, 'utf8').trim().split('\n').map(JSON.parse);
    const joined = joinPairedObservations(rows, actionId);
    assert.equal(joined.ok, true);
  });
}

test('pair join rejects missing homes and duplicate spans', () => {
  const row = { home: 'claude-hook', projection: { action_id: 'action-1' } };
  assert.deepEqual(joinPairedObservations([row], 'action-1').missing_homes, ['native']);
  const duplicate = joinPairedObservations([row, { ...row }], 'action-1');
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.duplicates, ['claude-hook']);
});
