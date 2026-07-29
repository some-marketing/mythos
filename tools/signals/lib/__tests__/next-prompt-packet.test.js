'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { validate } = require('../../../verify/lib/schema.cjs');
const schema = require('../../schemas/next-prompt-packet.schema.json');
const {
  buildWorkerNextPromptPacket,
  buildReviewerNextPromptPacket,
  buildBridgeNextPromptPacket,
  buildCloseoutNextPromptPacket,
  buildHandoffNextPromptPacket,
  buildSystemizationInitNextPromptPacket,
  buildRecursiveActorWorkOrderSummary,
  validateNextPromptPacket
} = require('../next-prompt-packet');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const COMMON_INPUT = Object.freeze({
  workstream_scope: 'behavior-tree-next-prompt-automation',
  actor_role: 'Codex agent',
  scope_identity: {
    workstream_scope: 'behavior-tree-next-prompt-automation',
    workflow_scope: 'behavior-tree-next-prompt-automation',
    session_id: 'session-123',
    session_or_run_id: 'session-123',
    execution_id: 'exec-456',
    signal_id: 'signal-789',
    actor_id: 'codex',
    owner: 'human',
    working_surface: {
      path: 'tools/signals/lib',
      layer: 'signal-runtime'
    },
    custody_hierarchy: {
      system_id: 'Mythos',
      client_code: null,
      project_id: null,
      task_id: 'behavior-tree-next-prompt-automation',
      parent_scope: 'system:Mythos',
      child_scopes: ['packet-builder']
    },
    owned_artifacts: [
      'tools/signals/lib/next-prompt-packet.js',
      'tools/signals/schemas/next-prompt-packet.schema.json',
      'tools/signals/lib/__tests__/next-prompt-packet.test.js'
    ],
    forbidden_artifacts: [
      'tools/codex/**',
      'tools/planning/**',
      'instructions/**',
      '_dev/reports/**',
      'client/framework files'
    ]
  },
  write_set: [
    'tools/signals/lib/next-prompt-packet.js',
    'tools/signals/schemas/next-prompt-packet.schema.json'
  ],
  forbidden_surfaces: [
    'tools/codex/**',
    'tools/planning/**',
    'clients/**',
    'credentials/.env/auth',
    'unrelated plans/signals'
  ],
  expected_evidence: [
    'changed_files',
    'schema validation',
    'node:test output'
  ],
  tests: [
    'node --test tools/signals/lib/__tests__/next-prompt-packet.test.js'
  ],
  review_lane: 'codex-bridge',
  closeout_owner: 'human',
  grounding_posture: {
    mode: 'kernel',
    interpretive_posture: 'advisory',
    advisory_only: true,
    summary: 'Grounding is posture, not implementation spec.',
    files: ['KERNEL.md', 'LINEAGE.md'],
    notes: ['Use local artifacts and acceptance criteria as primary data.']
  },
  local_model_preflight_summary: {
    status: 'passed',
    summary: 'Host-state preflight passed for local-model dispatch.',
    observed_at: '2026-04-22T12:00:00Z',
    host_state: {
      ok: true
    },
    blockers: [],
    warnings: [],
    notes: ['No blockers observed.']
  }
});

function isSchemaValid(packet) {
  const errors = validate(packet, schema, { rootSchema: schema, path: '' });
  assert.deepEqual(errors, [], `expected packet to validate, got errors: ${JSON.stringify(errors, null, 2)}`);
}

describe('NextPromptPacket/1.0 builders', () => {
  it('builds a worker packet with preserved custody, write set, and exact return contract', () => {
    const packet = buildWorkerNextPromptPacket({
      ...COMMON_INPUT,
      exact_return_contract: {
        kind: 'worker-return/custom',
        delivery: 'single JSON object',
        required_fields: ['status', 'changed_files'],
        optional_fields: ['notes'],
        blocked_when_missing: ['workstream_scope'],
        notes: ['Custom contract for this test.']
      }
    });

    assert.equal(packet.role, 'worker');
    assert.equal(packet.schema, 'NextPromptPacket/1.0');
    assert.equal(packet.scope_identity.workflow_scope, 'behavior-tree-next-prompt-automation');
    assert.equal(packet.scope_identity.session_id, 'session-123');
    assert.deepEqual(packet.write_set, [
      'tools/signals/lib/next-prompt-packet.js',
      'tools/signals/schemas/next-prompt-packet.schema.json'
    ]);
    assert.equal(packet.review_lane, 'codex-bridge');
    assert.equal(packet.closeout_owner, 'human');
    assert.equal(packet.advisory_not_authority, false);
    assert.equal(packet.exact_return_contract.kind, 'worker-return/custom');
    assert.equal(packet.local_model_preflight_summary.status, 'passed');
    isSchemaValid(packet);
    assert.deepEqual(validateNextPromptPacket(packet), { valid: true, errors: [] });
  });

  it('builds a validated RecursiveActorWorkOrder summary with branch metadata and unverified repo assumptions', () => {
    const summary = buildRecursiveActorWorkOrderSummary('worker', {
      workstream_scope: 'behavior-tree-next-prompt-automation',
      next_actor_role: 'worker',
      exact_next_command: '/run-plan behavior-tree-next-prompt-automation',
      summary: 'Execute /run-plan behavior-tree-next-prompt-automation for behavior-tree-next-prompt-automation.',
      write_set: ['tools/signals/lib/next-prompt-packet.js'],
      forbidden_surfaces: ['clients/**'],
      expected_evidence: ['Exact next command: /run-plan behavior-tree-next-prompt-automation'],
      tests: ['node --test tools/signals/lib/__tests__/next-prompt-packet.test.js'],
      review_lane: 'decision-tree',
      closeout_owner: 'Codex agent',
      target_branch: 'main',
      branch_reference_set: ['main', 'origin/main'],
      repo_specific_assumptions_verified: false
    });
    const packet = buildWorkerNextPromptPacket({
      ...COMMON_INPUT,
      work_order_summary: summary
    });

    assert.equal(summary.schema, 'RecursiveActorWorkOrder/1.0');
    assert.equal(summary.validated, true);
    assert.equal(summary.scope_tier, 'leaf');
    assert.equal(summary.model_class, 'mechanical');
    assert.equal(summary.smallest_sufficient_local_class, 'local-model');
    assert.equal(summary.decomposition_state, 'ready');
    assert.equal(summary.three_step_plan.length, 3);
    assert.equal(summary.ready_to_execute_when_three_steps, true);
    assert.equal(summary.fractal_until_executable, false);
    assert.equal(summary.target_branch, 'main');
    assert.deepEqual(summary.branch_reference_set, ['main', 'origin/main']);
    assert.deepEqual(summary.open_questions, []);
    assert.deepEqual(summary.child_work_orders, []);
    assert.equal(summary.aggregation_contract.schema, 'RecursiveActorWorkOrderAggregation/1.0');
    assert.equal(summary.cost_preference, 'free');
    assert.equal(summary.determinism_level, 'mechanical');
    assert.match(summary.model_downshift_reason, /downshift to a free or low-cost model/i);
    assert.equal(summary.repo_specific_assumptions_verified, false);
    assert.deepEqual(packet.work_order_summary, summary);
    isSchemaValid(packet);
  });

  it('builds a reviewer packet and preserves forbidden surfaces and evidence lists', () => {
    const packet = buildReviewerNextPromptPacket(COMMON_INPUT);

    assert.equal(packet.role, 'reviewer');
    assert.deepEqual(packet.forbidden_surfaces, [
      'tools/codex/**',
      'tools/planning/**',
      'clients/**',
      'credentials/.env/auth',
      'unrelated plans/signals'
    ]);
    assert.deepEqual(packet.expected_evidence, [
      'changed_files',
      'schema validation',
      'node:test output'
    ]);
    assert.ok(packet.exact_return_contract.required_fields.includes('verdict'));
    isSchemaValid(packet);
  });

  it('builds a bridge packet with grounding posture preserved', () => {
    const packet = buildBridgeNextPromptPacket(COMMON_INPUT);

    assert.equal(packet.role, 'bridge');
    assert.equal(packet.grounding_posture.mode, 'kernel');
    assert.equal(packet.grounding_posture.interpretive_posture, 'advisory');
    assert.equal(packet.grounding_posture.advisory_only, true);
    assert.ok(packet.exact_return_contract.required_fields.includes('trust_rules'));
    isSchemaValid(packet);
  });

  it('builds closeout and handoff packets with role-specific return contracts', () => {
    const closeout = buildCloseoutNextPromptPacket(COMMON_INPUT);
    const handoff = buildHandoffNextPromptPacket(COMMON_INPUT);

    assert.equal(closeout.role, 'closeout');
    assert.ok(closeout.exact_return_contract.required_fields.includes('closeout_state'));
    assert.equal(handoff.role, 'handoff');
    assert.ok(handoff.exact_return_contract.required_fields.includes('ownership_transfer'));
    isSchemaValid(closeout);
    isSchemaValid(handoff);
  });

  it('builds a systemization-init packet as advisory-not-authority', () => {
    const packet = buildSystemizationInitNextPromptPacket({
      ...COMMON_INPUT,
      closeout_owner: 'human',
      advisory_not_authority: true
    });

    assert.equal(packet.role, 'systemization-init');
    assert.equal(packet.advisory_not_authority, true);
    assert.equal(packet.exact_return_contract.kind, 'systemization-init-return/1.0');
    assert.ok(packet.exact_return_contract.required_fields.includes('candidate_state'));
    isSchemaValid(packet);
  });

  it('rejects advisory_not_authority on non-systemization packets', () => {
    assert.throws(
      () => buildWorkerNextPromptPacket({
        ...COMMON_INPUT,
        advisory_not_authority: true
      }),
      /advisory_not_authority may only be true for systemization-init packets/
    );
  });

  it('rejects packets missing a workstream scope', () => {
    assert.throws(
      () => buildWorkerNextPromptPacket({
        ...COMMON_INPUT,
        workstream_scope: ''
      }),
      /workstream_scope/
    );
  });

  it('can validate a hand-built packet object through the shared validator', () => {
    const packet = {
      schema: 'NextPromptPacket/1.0',
      role: 'worker',
      workstream_scope: 'behavior-tree-next-prompt-automation',
      actor_role: 'Codex agent',
      write_set: [],
      forbidden_surfaces: [],
      expected_evidence: [],
      tests: [],
      review_lane: 'codex-bridge',
      closeout_owner: 'human',
      grounding_posture: {
        mode: 'none',
        interpretive_posture: 'none',
        advisory_only: true,
        summary: 'No grounding substrate supplied.'
      },
      local_model_preflight_summary: {
        status: 'not_applicable',
        summary: 'Not requested.'
      },
      exact_return_contract: {
        kind: 'worker-return/1.0',
        delivery: 'single JSON object',
        required_fields: ['status'],
        notes: ['ok']
      },
      advisory_not_authority: false
    };

    const result = validateNextPromptPacket(packet);
    assert.equal(result.valid, true);
    isSchemaValid(packet);
  });

  it('preserves TaskCustody/1.0 fields in scope_identity', () => {
    const packet = buildWorkerNextPromptPacket(COMMON_INPUT);

    assert.equal(packet.scope_identity.workstream_scope, 'behavior-tree-next-prompt-automation');
    assert.equal(packet.scope_identity.workflow_scope, 'behavior-tree-next-prompt-automation');
    assert.equal(packet.scope_identity.session_or_run_id, 'session-123');
    assert.deepEqual(packet.scope_identity.working_surface, {
      path: 'tools/signals/lib',
      layer: 'signal-runtime'
    });
    assert.deepEqual(packet.scope_identity.custody_hierarchy, {
      system_id: 'Mythos',
      client_code: null,
      project_id: null,
      task_id: 'behavior-tree-next-prompt-automation',
      parent_scope: 'system:Mythos',
      child_scopes: ['packet-builder']
    });
    assert.deepEqual(packet.scope_identity.owned_artifacts, [
      'tools/signals/lib/next-prompt-packet.js',
      'tools/signals/schemas/next-prompt-packet.schema.json',
      'tools/signals/lib/__tests__/next-prompt-packet.test.js'
    ]);
    assert.deepEqual(packet.scope_identity.forbidden_artifacts, [
      'tools/codex/**',
      'tools/planning/**',
      'instructions/**',
      '_dev/reports/**',
      'client/framework files'
    ]);
    isSchemaValid(packet);
  });

  it('preserves string working_surface in scope_identity', () => {
    const packet = buildWorkerNextPromptPacket({
      ...COMMON_INPUT,
      scope_identity: {
        ...COMMON_INPUT.scope_identity,
        working_surface: 'Mythos/_dev/reports/analysis/task-plans'
      }
    });

    assert.equal(packet.scope_identity.working_surface, 'Mythos/_dev/reports/analysis/task-plans');
    isSchemaValid(packet);
  });
});
