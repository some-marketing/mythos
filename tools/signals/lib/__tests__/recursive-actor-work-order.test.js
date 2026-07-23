'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../../../verify/lib/schema.cjs');
const schema = require('../../schemas/recursive-actor-work-order.schema.json');
const {
  buildRecursiveActorWorkOrder,
  renderRecursiveActorWorkOrderCommand,
  validateRecursiveActorWorkOrder
} = require('../recursive-actor-work-order');

function isSchemaValid(order) {
  const errors = validate(order, schema, { rootSchema: schema, path: '' });
  assert.deepEqual(errors, [], `expected work order to validate, got errors: ${JSON.stringify(errors, null, 2)}`);
}

describe('RecursiveActorWorkOrder/1.0', () => {
  it('builds a ready compact order with refs, routing, custody, evidence, and a three-step plan', () => {
    const order = buildRecursiveActorWorkOrder({
      critical_ref: 'critical:signal-123',
      conversation_ref: 'conversation:thread-456',
      prompt_ref: 'prompt:packet-789',
      workstream: {
        scope: 'recursive-orchestration-framework/child-slice',
        scope_tier: 'task'
      },
      parent: {
        scope: 'recursive-orchestration-framework',
        scope_tier: 'project'
      },
      actor: {
        role: 'Codex agent',
        target: 'codex'
      },
      routing: {
        api_allowed: false,
        local_tiny_available: true
      },
      custody: {
        owner: 'human',
        held_by: 'Codex agent',
        write_set: [
          'tools/signals/lib/recursive-actor-work-order.js',
          'tools/signals/schemas/recursive-actor-work-order.schema.json',
          'tools/signals/lib/__tests__/recursive-actor-work-order.test.js'
        ],
        forbidden_surfaces: [
          'clients/**',
          'instructions/**',
          '.claude/**'
        ]
      },
      branch: {
        target_branch: 'feature/recursive-orchestration-framework',
        reference_set: ['refs/heads/feature/recursive-orchestration-framework'],
        grounding_summary: 'Live GitHub grounding was used for repo-specific claims.',
        grounding_state: 'live',
        github_connector_available: true
      },
      task: {
        summary: 'Inspect the narrow task slice and keep the router frontier-aware',
        objective: 'Produce a ready leaf branch with the smallest sufficient local-capable model'
      },
      three_step_plan: [
        'inspect the narrow task slice',
        'apply the smallest sufficient local-capable model',
        'return the exact compact command and evidence'
      ],
      delegation: {
        child_write_set: ['tools/signals/lib/recursive-actor-work-order.js']
      },
      evidence: {
        references: [
          'tools/signals/lib/bridge-target-policy.js',
          'tools/signals/lib/bridge-target-policy.js:207'
        ],
        locations: [
          'tools/signals/lib/bridge-target-policy.js:207',
          'tools/signals/lib/bridge-target-policy.js:419'
        ]
      },
      stop_conditions: [
        'halt if the child scope is not narrower than the parent scope',
        'halt if routing.transport becomes api without api_allowed=true'
      ]
    });

    assert.equal(order.schema, 'RecursiveActorWorkOrder/1.0');
    assert.equal(order.workstream.scope_tier, 'task');
    assert.equal(order.parent.scope_tier, 'project');
    assert.equal(order.routing.transport, 'local-cli');
    assert.equal(order.routing.api_allowed, false);
    assert.equal(order.routing.prefers_logged_in_before_api, true);
    assert.equal(order.routing.smallest_sufficient_local_class, 'local-tiny');
    assert.equal(order.routing.local_tiny_available, true);
    assert.equal(order.delegation.child_scope_tier, 'task');
    assert.equal(order.delegation.child_depth_budget, 0);
    assert.equal(order.decomposition_state, 'ready');
    assert.equal(order.ready_to_execute_when_three_steps, true);
    assert.equal(order.fractal_until_executable, false);
    assert.match(order.actor.launch_contract, /codex exec <prompt>/);
    assert.equal(order.task.command.includes('\n'), false);
    assert.match(order.task.command, /critical=critical:signal-123/);
    assert.match(order.task.command, /actor=codex\/local-cli/);
    isSchemaValid(order);
    assert.deepEqual(validateRecursiveActorWorkOrder(order), { valid: true, errors: [] });
  });

  it('fans out open questions into child work orders and aggregates them explicitly', () => {
    const order = buildRecursiveActorWorkOrder({
      critical_ref: 'critical:signal-fanout',
      conversation_ref: 'conversation:thread-fanout',
      prompt_ref: 'prompt:packet-fanout',
      workstream: {
        scope: 'recursive-orchestration-framework/parent-branch',
        scope_tier: 'project'
      },
      parent: {
        scope: 'recursive-orchestration-framework',
        scope_tier: 'client'
      },
      actor: {
        role: 'Codex agent',
        target: 'codex'
      },
      custody: {
        owner: 'human',
        held_by: 'Codex agent',
        write_set: ['tools/signals/lib/recursive-actor-work-order.js'],
        forbidden_surfaces: ['clients/**']
      },
      branch: {
        target_branch: 'feature/recursive-orchestration-framework',
        reference_set: ['refs/heads/feature/recursive-orchestration-framework'],
        grounding_summary: 'GitHub grounding was unavailable, so repo-specific claims are marked unverified.',
        grounding_state: 'unverified',
        github_connector_available: false
      },
      task: {
        summary: 'Fan out the parent branch questions',
        objective: 'Spawn child work orders and aggregate evidence back upward'
      },
      open_questions: [
        'what is the narrowest child question',
        'what evidence should each child carry'
      ],
      evidence: {
        references: ['tools/signals/lib/bridge-target-policy.js'],
        locations: ['tools/signals/lib/bridge-target-policy.js:245']
      },
      stop_conditions: ['halt when child answers are not yet executable']
    });

    assert.equal(order.decomposition_state, 'fan-out');
    assert.equal(order.fractal_until_executable, true);
    assert.equal(order.child_work_orders.length, 2);
    assert.equal(order.child_work_orders[0].task.summary, 'what is the narrowest child question');
    assert.equal(order.child_work_orders[0].decomposition_state, 'ready');
    assert.equal(order.child_work_orders[0].ready_to_execute_when_three_steps, true);
    assert.equal(order.child_work_orders[0].fractal_until_executable, false);
    assert.equal(order.aggregation_contract.merge_strategy, 'aggregate child evidence, blockers, and next-state candidates upward');
    isSchemaValid(order);
    assert.deepEqual(validateRecursiveActorWorkOrder(order), { valid: true, errors: [] });
  });

  it('routes mechanical leaf work to the least intense RasPi-class local lane when available', () => {
    const order = buildRecursiveActorWorkOrder({
      critical_ref: 'critical:signal-raspi',
      conversation_ref: 'conversation:thread-raspi',
      prompt_ref: 'prompt:packet-raspi',
      workstream: {
        scope: 'recursive-orchestration-framework/raspi-leaf',
        scope_tier: 'leaf'
      },
      parent: {
        scope: 'recursive-orchestration-framework/task-slice',
        scope_tier: 'task'
      },
      actor: {
        role: 'local verifier',
        target: 'ollama',
        transport: 'local-model',
        model: 'tiny-local'
      },
      routing: {
        transport: 'local-model',
        local_tiny_available: true,
        raspi_available: true
      },
      custody: {
        owner: 'human',
        held_by: 'local verifier',
        write_set: ['tools/signals/lib/recursive-actor-work-order.js'],
        forbidden_surfaces: ['clients/**']
      },
      branch: {
        target_branch: 'feature/recursive-orchestration-framework',
        reference_set: ['refs/heads/feature/recursive-orchestration-framework'],
        grounding_summary: 'GitHub grounding was unavailable, so repo-specific claims are marked unverified.',
        grounding_state: 'unverified',
        github_connector_available: false
      },
      task: {
        summary: 'Run the atomic local verification',
        objective: 'Confirm leaf routing chooses a RasPi-class local lane when available'
      },
      three_step_plan: [
        'read the atomic check input',
        'run the local deterministic check',
        'return the result and evidence'
      ],
      evidence: {
        references: ['tools/signals/lib/bridge-target-policy.js'],
        locations: ['tools/signals/lib/bridge-target-policy.js:34']
      },
      stop_conditions: ['halt after the atomic three-step check']
    });

    assert.equal(order.routing.transport, 'local-model');
    assert.equal(order.routing.smallest_sufficient_local_class, 'raspi');
    assert.equal(order.routing.cost_priority, 'free');
    assert.equal(order.determinism_level, 'mechanical');
    assert.equal(order.ready_to_execute_when_three_steps, true);
    isSchemaValid(order);
    assert.deepEqual(validateRecursiveActorWorkOrder(order), { valid: true, errors: [] });
  });

  it('renders the same compact command string from an existing order', () => {
    const order = buildRecursiveActorWorkOrder({
      critical_ref: 'critical:signal-abc',
      conversation_ref: 'conversation:thread-def',
      prompt_ref: 'prompt:packet-ghi',
      workstream: {
        scope: 'recursive-orchestration-framework/leaf-slice',
        scope_tier: 'leaf'
      },
      parent: {
        scope: 'recursive-orchestration-framework/task-slice',
        scope_tier: 'task'
      },
      actor: {
        role: 'Codex agent',
        target: 'codex'
      },
      custody: {
        owner: 'human',
        held_by: 'Codex agent',
        write_set: ['tools/signals/lib/recursive-actor-work-order.js'],
        forbidden_surfaces: ['clients/**']
      },
      branch: {
        target_branch: 'feature/recursive-orchestration-framework',
        reference_set: ['refs/heads/feature/recursive-orchestration-framework'],
        grounding_summary: 'GitHub grounding was unavailable, so repo-specific claims are marked unverified.',
        grounding_state: 'unverified',
        github_connector_available: false
      },
      task: {
        summary: 'Render the compact command string',
        objective: 'Verify compact command rendering stays stable'
      },
      delegation: {
        child_write_set: ['tools/signals/lib/recursive-actor-work-order.js']
      },
      evidence: {
        references: ['tools/signals/lib/bridge-target-policy.js'],
        locations: ['tools/signals/lib/bridge-target-policy.js:419']
      },
      stop_conditions: ['halt when the next child scope would widen']
    });

    const rendered = renderRecursiveActorWorkOrderCommand(order);

    assert.equal(rendered, order.task.command);
    assert.equal(rendered.includes('\n'), false);
    assert.match(rendered, /^\/recursive-actor-work-order /);
    assert.match(rendered, /prompt=prompt:packet-ghi/);
  });

  it('rejects api and api-router routing unless api_allowed is true', () => {
    assert.throws(
      () => buildRecursiveActorWorkOrder({
        critical_ref: 'critical:signal-api',
        conversation_ref: 'conversation:thread-api',
        prompt_ref: 'prompt:packet-api',
        workstream: {
          scope: 'recursive-orchestration-framework/api-slice',
          scope_tier: 'task'
        },
        parent: {
          scope: 'recursive-orchestration-framework',
          scope_tier: 'project'
        },
        actor: {
          role: 'Codex agent',
          target: 'gemini',
          transport: 'api'
        },
        routing: {
          transport: 'api',
          api_allowed: false
        },
        custody: {
          owner: 'human',
          held_by: 'Codex agent',
          write_set: ['tools/signals/lib/recursive-actor-work-order.js'],
          forbidden_surfaces: ['clients/**']
        },
        branch: {
          target_branch: 'feature/recursive-orchestration-framework',
          reference_set: ['refs/heads/feature/recursive-orchestration-framework'],
          grounding_summary: 'GitHub grounding was unavailable, so repo-specific claims are marked unverified.',
          grounding_state: 'unverified',
          github_connector_available: false
        },
        task: {
          summary: 'Check the api gate',
          objective: 'Ensure api transport is blocked unless explicitly allowed'
        },
        delegation: {
          child_write_set: ['tools/signals/lib/recursive-actor-work-order.js']
        },
        evidence: {
          references: ['tools/signals/lib/bridge-target-policy.js'],
          locations: ['tools/signals/lib/bridge-target-policy.js:388']
        },
        stop_conditions: ['halt if api is selected without permission']
      }),
      /api_allowed=true/
    );
  });

  it('rejects child write sets that escape parent custody', () => {
    assert.throws(
      () => buildRecursiveActorWorkOrder({
        critical_ref: 'critical:signal-write-set',
        conversation_ref: 'conversation:thread-write-set',
        prompt_ref: 'prompt:packet-write-set',
        workstream: {
          scope: 'recursive-orchestration-framework/leaf-slice',
          scope_tier: 'leaf'
        },
        parent: {
          scope: 'recursive-orchestration-framework/task-slice',
          scope_tier: 'task'
        },
        actor: {
          role: 'Codex agent',
          target: 'codex'
        },
        custody: {
          owner: 'human',
          held_by: 'Codex agent',
          write_set: ['tools/signals/lib/recursive-actor-work-order.js'],
          forbidden_surfaces: ['clients/**']
        },
        branch: {
          target_branch: 'feature/recursive-orchestration-framework',
          reference_set: ['refs/heads/feature/recursive-orchestration-framework'],
          grounding_summary: 'GitHub grounding was unavailable, so repo-specific claims are marked unverified.',
          grounding_state: 'unverified',
          github_connector_available: false
        },
        task: {
          summary: 'Check custody write set enforcement',
          objective: 'Ensure child write sets cannot escape parent custody'
        },
        delegation: {
          child_write_set: [
            'tools/signals/lib/recursive-actor-work-order.js',
            'tools/signals/lib/__tests__/recursive-actor-work-order.test.js'
          ]
        },
        evidence: {
          references: ['tools/signals/lib/bridge-target-policy.js'],
          locations: ['tools/signals/lib/bridge-target-policy.js:213']
        },
        stop_conditions: ['halt if the child write set widens']
      }),
      /escapes parent custody write set/
    );
  });

  it('rejects child tiers that are not narrower than the parent scope tier', () => {
    assert.throws(
      () => buildRecursiveActorWorkOrder({
        critical_ref: 'critical:signal-same-tier',
        conversation_ref: 'conversation:thread-same-tier',
        prompt_ref: 'prompt:packet-same-tier',
        workstream: {
          scope: 'recursive-orchestration-framework/task-slice',
          scope_tier: 'task'
        },
        parent: {
          scope: 'recursive-orchestration-framework/task-parent',
          scope_tier: 'task'
        },
        actor: {
          role: 'Codex agent',
          target: 'codex'
        },
        custody: {
          owner: 'human',
          held_by: 'Codex agent',
          write_set: ['tools/signals/lib/recursive-actor-work-order.js'],
          forbidden_surfaces: ['clients/**']
        },
        branch: {
          target_branch: 'feature/recursive-orchestration-framework',
          reference_set: ['refs/heads/feature/recursive-orchestration-framework'],
          grounding_summary: 'GitHub grounding was unavailable, so repo-specific claims are marked unverified.',
          grounding_state: 'unverified',
          github_connector_available: false
        },
        task: {
          summary: 'Check scope-tier narrowing enforcement',
          objective: 'Ensure child tiers remain narrower than parent tiers'
        },
        delegation: {
          child_write_set: ['tools/signals/lib/recursive-actor-work-order.js']
        },
        evidence: {
          references: ['tools/signals/lib/bridge-target-policy.js'],
          locations: ['tools/signals/lib/bridge-target-policy.js:213']
        },
        stop_conditions: ['halt if tiers are equal']
      }),
      /narrower child scope tier/
    );
  });
});
