'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const reflex = require(path.join(REPO_ROOT, 'tools/kernel/doctrine-reflex.cjs'));
const guardPath = path.join(REPO_ROOT, 'tools/kernel/guard-now-write.cjs');

test('c1 — Claude Write/Edit to session-present.json is REFUSED by guard-now-write.cjs (tool-path immutability)', () => {
  const env = {
    ...process.env,
    CLAUDE_TOOL_INPUT: JSON.stringify({
      file_path: path.resolve(REPO_ROOT, '_dev/state/session-present.json')
    })
  };
  const res = spawnSync(process.execPath, [guardPath], { env, encoding: 'utf8' });
  assert.notEqual(res.status, 0, 'guard must exit non-zero to refuse Write/Edit');
  assert.equal(res.status, 2, 'guard exits with code 2 for explicit refusal');
  assert.match(res.stderr, /NOW falsifier is tool-path immutable/);
});

test('c1b — guard allows writes to other paths', () => {
  const env = {
    ...process.env,
    CLAUDE_TOOL_INPUT: JSON.stringify({
      file_path: path.resolve(REPO_ROOT, 'tools/kernel/some-other-file.cjs')
    })
  };
  const res = spawnSync(process.execPath, [guardPath], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, 'non-protected path passes');
});

test('c2 — non-harness shell write produces session-present snapshot without writer-attestation → reflex emits verdict=stall', () => {
  // Simulate a non-harness-path write: create a snapshot object that lacks
  // writer_attestation (as would result from `echo > ...` via a subshell
  // that does not know how to sign the envelope).
  const snapshotWithoutAttestation = {
    schema: 'SessionPresent/1.0',
    scope_tier: 'task',
    last_updated_by: 'subshell:echo',
    last_updated_at: new Date().toISOString()
    // writer_attestation deliberately missing
  };
  const envelope = {
    event_type: 'PostToolUse',
    scope_tier: 'system',
    declared_intent: { owned_artifacts: [], forbidden_artifacts: [] },
    observed_write_set: [],
    observed_tool_outputs: [],
    session_present_snapshot: snapshotWithoutAttestation
  };
  const result = reflex.runReflex(envelope);
  assert.equal(result.verdict, 'stall', 'missing attestation must stall');
  const hit = result.findings.find((f) => f.code === 'session_present_missing_attestation');
  assert.ok(hit, 'non-harness-path detection finding present');
});

test('c2b — snapshot with invalid writer-attestation harness id → stall', () => {
  const envelope = {
    event_type: 'PostToolUse',
    scope_tier: 'system',
    declared_intent: { owned_artifacts: [], forbidden_artifacts: [] },
    observed_write_set: [],
    observed_tool_outputs: [],
    session_present_snapshot: {
      schema: 'SessionPresent/1.0',
      writer_attestation: {
        writer_harness_id: 'not-a-harness-prefix',
        signature: 'x',
        signed_at: 'x'
      }
    }
  };
  const result = reflex.runReflex(envelope);
  assert.equal(result.verdict, 'stall');
});
