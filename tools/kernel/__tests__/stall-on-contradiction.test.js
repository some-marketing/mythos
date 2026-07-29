'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const reflex = require(path.join(REPO_ROOT, 'tools/kernel/doctrine-reflex.cjs'));

const FIXTURE = path.join(__dirname, 'fixtures', 'envelope-stall-contradiction.json');

test('incompatible-intent fixture produces verdict=stall', () => {
  const env = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const result = reflex.runReflex(env);
  assert.equal(result.verdict, 'stall', 'Gemini falsifier: stall on contradiction');
  const stallFindings = result.findings.filter((f) => f.level === 'stall');
  assert.ok(stallFindings.length >= 1, 'at least one stall-level finding');
  const hasForbiddenOrContradiction = stallFindings.some((f) =>
    ['write_to_forbidden_path', 'intent_evidence_contradiction'].includes(f.code)
  );
  assert.ok(hasForbiddenOrContradiction, 'expected forbidden-path or contradiction finding');
});

test('explicit caller-declared contradiction stalls', () => {
  const env = {
    event_type: 'PostToolUse',
    scope_tier: 'system',
    declared_intent: {
      contradiction_declared: true,
      contradiction_reason: 'test:declared-impossibility'
    },
    observed_write_set: [],
    observed_tool_outputs: [],
    session_present_snapshot: {
      writer_attestation: {
        writer_harness_id: 'claude-code:test-harness',
        signature: 'x',
        signed_at: 'x'
      }
    }
  };
  const result = reflex.runReflex(env);
  assert.equal(result.verdict, 'stall');
});
