'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildSummary,
  parseArgs,
  renderText
} = require('../where-plan-dashboard');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function touch(filePath, timestamp) {
  const date = new Date(timestamp);
  fs.utimesSync(filePath, date, date);
}

test('plans:where reports generated dashboard freshness and top routes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-where-'));
  const reportRoot = path.join(root, '_dev/reports/analysis');
  const modelPath = path.join(reportRoot, 'plan-visibility__current.json');
  const planPath = path.join(reportRoot, 'task-plans/example__plan.json');

  writeJson(planPath, { task_id: 'example', bounded_plan: { steps: [] } });
  writeJson(modelPath, {
    generated_at: '2026-06-22T00:00:00.000Z',
    plans: [
      {
        task_id: 'example',
        title: 'Example Plan',
        status: 'ready',
        review_lane: 'verify-local',
        risk_tier: 'low',
        quality_flags: [],
        path: '_dev/reports/analysis/task-plans/example__plan.json',
        next_command: '/run-plan example',
        next_step: { step_id: 'S1', description: 'Run example step' }
      },
      {
        task_id: 'other',
        title: 'Other Plan',
        status: 'planned',
        review_lane: 'codex-bridge',
        risk_tier: 'medium',
        quality_flags: [],
        path: '_dev/reports/analysis/task-plans/other__plan.json',
        next_command: '/review-task-plan other',
        next_step: { step_id: 'O1', description: 'Review other step' }
      },
      {
        task_id: 'third',
        title: 'Third Plan',
        status: 'planned',
        review_lane: 'codex-bridge',
        risk_tier: 'medium',
        quality_flags: [],
        path: '_dev/reports/analysis/task-plans/third__plan.json',
        next_command: '/review-task-plan third',
        next_step: { step_id: 'T1', description: 'Review third step' }
      }
    ],
    relationships: [
      {
        source: 'example',
        target: 'other',
        type: 'mentions',
        intent: 'sequence',
        confidence: 'derived',
        confidence_reason: 'Derived from a task-id mention in the task-plan artifact; inspect evidence before treating as dependency.',
        evidence: 'example evidence'
      },
      {
        source: 'other',
        target: 'third',
        type: 'parent',
        intent: 'hierarchy',
        confidence: 'high',
        confidence_reason: 'Declared parent_task_id metadata links this plan to a parent plan.',
        evidence: 'other parent evidence'
      }
    ],
    relationship_clusters: [
      {
        id: 'cluster-1',
        label: 'Example workstream',
        label_reason: 'Two plans are connected by sequence intent.',
        size: 2,
        relationships: 2,
        plan_ids: ['example', 'other', 'third'],
        statuses: { ready: 1, planned: 2 },
        next_plan: {
          task_id: 'example',
          status: 'ready',
          reason: 'ready plan in this connected workstream',
          next_step: 'S1: Run example step',
          next_command: '/run-plan example'
        }
      }
    ],
    workstream_matrix: [
      {
        cluster_id: 'cluster-1',
        label: 'Example workstream',
        plans: 3,
        relationships: 2,
        suggested_next: { task_id: 'example' },
        map_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
        brief_href: 'visual-plans/cluster-1.md'
      }
    ],
    workstream_drilldowns: {
      summary: '1 connected workstream has drilldowns; largest is Example workstream with 3 plans.',
      total_workstreams: 1,
      shown_workstreams: 1,
      drilldowns: [
        {
          cluster_id: 'cluster-1',
          label: 'Example workstream',
          plans: 3,
          relationships: 2,
          dashboard_href: 'plan-visibility__current.html#cluster=cluster-1',
          brief_href: 'visual-plans/cluster-1.md',
          slices: [
            {
              slice_id: 'cluster-1:meta-execution-normalization',
              label: 'Meta Execution-normalization',
              framework: 'meta/execution-normalization',
              plans: 2,
              relationships: 2,
              ready_like: 1,
              attention: 0,
              status_mix: [{ label: 'ready', count: 1 }, { label: 'planned', count: 1 }],
              quality_flags: [{ label: 'missing_review_lane', count: 1 }],
              top_intents: [{ label: 'sequence', count: 1 }],
              suggested_next: {
                task_id: 'example',
                status: 'ready',
                next_command: '/run-plan example',
                dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example'
              }
            }
          ]
        }
      ]
    },
    workstream_stories: [
      {
        cluster_id: 'cluster-1',
        label: 'Example workstream',
        plans: 3,
        relationships: 2,
        explanation: 'Example workstream connects 3 plans through 2 detected relationships.',
        dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
        brief_href: 'visual-plans/cluster-1.md',
        bridge_plans: [{ task_id: 'other', role: 'bridge', total: 2 }],
        relationship_examples: [
          {
            source: 'example',
            target: 'other',
            type: 'mentions',
            intent: 'sequence',
            evidence: 'example evidence'
          }
        ]
      }
    ],
    data_quality: {
      unlinked: { count: 3 },
      missing_review_lane: { count: 4 }
    },
    groupings: {
      review_lane: {
        'operator-gate': 1,
        'codex-bridge': 2,
        'verify-local': 1,
        'not-recorded': 4
      }
    },
    graph_health: {
      linked_plans: 7,
      unlinked_plans: 3,
      coverage_percent: 70,
      links_per_plan: 1.4,
      weakest_areas: [{ signal: 'unlinked', count: 3 }],
      recommendations: [{ signal: 'unlinked', dashboard_href: 'plan-visibility__current.html#quality=unlinked' }]
    },
    dependency_sequence_chains: [
      {
        chain_id: 'chain-1',
        summary: 'example -> other -> third',
        start_task_id: 'example',
        end_task_id: 'third',
        hops: 2,
        plan_count: 3,
        intents: ['sequence', 'dependency'],
        cluster_id: 'cluster-1',
        cluster_label: 'Example workstream',
        next_task_id: 'example',
        next_command: '/run-plan example',
        dashboard_href: 'plan-visibility__current.html#from=example&to=third'
      }
    ],
    operator_question_routes: [
      {
        id: 'start',
        question: 'Where should I start?',
        answer: 'Open priority scan.',
        count_label: '1 priority items',
        href: 'plan-visibility__index.html#priority-scan',
        command: 'npm run plans:where',
        evidence: 'Suggested next in largest workstream'
      },
      {
        id: 'connections',
        question: 'How do plans interconnect?',
        answer: 'Open chain routes.',
        count_label: '1 chains',
        href: 'plan-visibility__index.html#dependency-sequence-chains',
        command: 'npm run plans:where -- --from example --to third',
        evidence: 'example -> other -> third'
      }
    ],
    map_reading_guide: {
      summary: 'How to read the generated plan map without treating it as source authority.',
      items: [
        {
          term: 'Generated map',
          meaning: 'A derived view over task-plan artifacts.',
          use: 'Use it for navigation and scanning.',
          trust_boundary: 'The source task-plan JSON/Markdown remains authoritative.'
        },
        {
          term: 'Workstream',
          meaning: 'A connected group of plans.',
          use: 'Open it to inspect related plans.',
          trust_boundary: 'Generated labels can be improved by metadata.'
        }
      ]
    },
    protocol_readiness: {
      summary: '1 of 3 visible plans carry the protocol fields needed for routed execution and handoff; 2 need repair before treating the dashboard as execution authority.',
      totals: {
        visible_plans: 3,
        protocol_ready: 1,
        needs_protocol_repair: 2
      },
      checks: [
        {
          id: 'review_lane',
          label: 'Review lane',
          missing_field: 'routing_expectations.review_lane',
          present_count: 2,
          missing_count: 1,
          repair: 'Set verify-local, codex-bridge, operator-gate, or another explicit review lane.',
          sample: ['other']
        },
        {
          id: 'bounded_steps',
          label: 'Bounded steps',
          missing_field: 'bounded_plan.steps',
          present_count: 2,
          missing_count: 1,
          repair: 'Add bounded steps so execution progress is auditable.',
          sample: ['third']
        }
      ],
      rows: [
        {
          task_id: 'other',
          title: 'Other',
          status: 'planned',
          protocol_state: 'needs_protocol_repair',
          missing_fields: ['routing_expectations.review_lane'],
          missing_count: 1,
          dashboard_href: 'plan-visibility__current.html#plan=other',
          recommended_command: '/amend-plan other',
          reason: 'Missing routing_expectations.review_lane.'
        },
        {
          task_id: 'example',
          title: 'Example',
          status: 'ready',
          protocol_state: 'protocol_ready',
          missing_fields: [],
          missing_count: 0,
          dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
          recommended_command: '/run-plan example',
          reason: 'Carries required protocol fields.'
        }
      ]
    },
    remediation_queue: [
      {
        signal: 'unlinked',
        task_id: 'example',
        recommended_fix: 'Connect example to its parent workstream.',
        dashboard_href: 'plan-visibility__current.html#quality=unlinked&plan=example',
        next_command: '/run-plan example'
      }
    ],
    priority_scan: [
      {
        kind: 'workstream-next',
        label: 'Suggested next in largest workstream',
        task_id: 'example',
        status: 'ready',
        reason: 'Example workstream: ready plan in this connected workstream.',
        href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
        source: '_dev/reports/analysis/task-plans/example__plan.json',
        next_command: '/run-plan example'
      }
    ],
    plan_action_board: {
      summary: 'Action lanes derived from test fixture.',
      lanes: [
        {
          id: 'runnable_now',
          label: 'Runnable Now',
          summary: '1 ready plan.',
          rows: [
            {
              task_id: 'example',
              title: 'Example Plan',
              status: 'ready',
              review_lane: 'verify-local',
              risk_tier: 'low',
              source: '_dev/reports/analysis/task-plans/example__plan.json',
              next_command: '/run-plan example',
              dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
              reason: 'Ready or in progress with no incoming dependency-intent relationship detected.'
            }
          ]
        },
        { id: 'map_repairs', label: 'Map Repairs', summary: '0 repairs.', rows: [] }
      ]
    },
    execution_readiness: {
      summary: 'Execution readiness combines action-lane membership with protocol readiness.',
      lanes: [
        {
          id: 'ready_to_route',
          label: 'Ready To Route',
          summary: '1 runnable candidate has protocol fields.',
          rows: [
            {
              task_id: 'example',
              title: 'Example Plan',
              source_lane: 'runnable_now',
              readiness: 'ready_to_route',
              status: 'ready',
              missing_protocol_fields: [],
              source: '_dev/reports/analysis/task-plans/example__plan.json',
              recommended_command: '/run-plan example',
              dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
              reason: 'Runnable candidate with protocol-readiness fields present.'
            }
          ]
        },
        {
          id: 'protocol_repair_first',
          label: 'Protocol Repair First',
          summary: '1 runnable-looking candidate needs repair.',
          rows: [
            {
              task_id: 'other',
              title: 'Other',
              source_lane: 'runnable_now',
              readiness: 'protocol_repair_first',
              status: 'ready',
              missing_protocol_fields: ['routing_expectations.review_lane'],
              source: '_dev/reports/analysis/task-plans/other__plan.json',
              recommended_command: '/amend-plan other',
              dashboard_href: 'plan-visibility__current.html#plan=other',
              reason: 'Runnable-looking candidate, but missing routing_expectations.review_lane.'
            }
          ]
        }
      ]
    },
    routing_blockers: {
      summary: 'No action candidates are ready to route. Start with Protocol Repair First to clear the first blocker lane.',
      ready_to_route: 0,
      blocker_total: 1,
      protocol_ready: 1,
      protocol_repairs: 2,
      top_blocker: {
        id: 'protocol_repair_first',
        label: 'Protocol Repair First',
        count: 1,
        first_task_id: 'other',
        reason: 'Runnable-looking candidate, but missing routing_expectations.review_lane.',
        command: '/amend-plan other',
        href: 'plan-visibility__current.html#plan=other'
      },
      blockers: [
        {
          id: 'protocol_repair_first',
          label: 'Protocol Repair First',
          count: 1,
          first_task_id: 'other',
          reason: 'Runnable-looking candidate, but missing routing_expectations.review_lane.',
          command: '/amend-plan other',
          href: 'plan-visibility__current.html#plan=other'
        }
      ]
    },
    first_repair_path: {
      summary: 'First repair path starts with Repair Protocol Fields: other.',
      ready_to_route: 0,
      blocker_total: 1,
      recommended_first_step: {
        id: 'repair-protocol',
        lane_id: 'protocol_repair_first',
        label: 'Repair Protocol Fields',
        lane_label: 'Protocol Repair First',
        task_id: 'other',
        status: 'ready',
        why_first: 'Actor-continuity fields come before delegation or execution.',
        effect: 'Turns ready-looking work into routeable work with auditable handoff context.',
        command: '/amend-plan other',
        href: 'plan-visibility__current.html#plan=other'
      },
      steps: [
        {
          id: 'repair-protocol',
          lane_id: 'protocol_repair_first',
          label: 'Repair Protocol Fields',
          lane_label: 'Protocol Repair First',
          task_id: 'other',
          status: 'ready',
          reason: 'Runnable-looking candidate, but missing routing_expectations.review_lane.',
          why_first: 'Actor-continuity fields come before delegation or execution.',
          effect: 'Turns ready-looking work into routeable work with auditable handoff context.',
          command: '/amend-plan other',
          href: 'plan-visibility__current.html#plan=other',
          source: '_dev/reports/analysis/task-plans/other__plan.json'
        }
      ]
    },
    risk_gate_queue: {
      summary: '1 ready or in-progress plan needs explicit gate interpretation before execution; 1 highest-priority row is shown.',
      totals: {
        candidates: 1,
        operator_gate: 0,
        codex_bridge: 1,
        protocol_repair: 0,
        verify_local: 0
      },
      rows: [
        {
          task_id: 'example',
          title: 'Example Plan',
          status: 'ready',
          gate_owner: 'codex-bridge',
          gate_label: 'Codex Bridge',
          review_lane: 'codex-bridge',
          risk_tier: 'medium',
          protocol_state: 'protocol_ready',
          missing_protocol_fields: [],
          quality_flags: ['high_risk_ready'],
          reason: 'Distinct review is required before treating this ready-looking item as clear.',
          recommended_command: '/run-plan example',
          source: '_dev/reports/analysis/task-plans/example__plan.json',
          dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example'
        }
      ]
    },
    orchestration_routing_board: {
      summary: '3 visible plans classified by orchestration route; repair-before-dispatch and explicit review lanes come before execution.',
      totals: {
        repair_before_dispatch: 1,
        operator_gate: 0,
        codex_bridge: 1,
        verify_local: 1,
        route_unspecified: 0
      },
      first_route: {
        task_id: 'other',
        recommended_command: '/amend-plan other',
        route_owner: 'coordinator',
        dashboard_href: 'plan-visibility__current.html#plan=other'
      },
      lanes: [
        {
          id: 'repair_before_dispatch',
          label: 'Repair Before Dispatch',
          purpose: 'Coordinator repairs actor-continuity, bounded-step, routing, risk, or evidence fields before delegation.',
          count: 1,
          first_task_id: 'other',
          first_command: '/amend-plan other',
          rows: [
            {
              task_id: 'other',
              status: 'ready',
              review_lane: 'not-recorded',
              risk_tier: 'not-recorded',
              protocol_state: 'needs_protocol_repair',
              missing_protocol_fields: ['routing_expectations.review_lane'],
              route_owner: 'coordinator',
              actor_route: 'Coordinator repairs the plan before any worker or reviewer actor receives it.',
              reason: 'Missing protocol fields: routing_expectations.review_lane.',
              recommended_command: '/amend-plan other',
              dashboard_href: 'plan-visibility__current.html#plan=other',
              source: '_dev/reports/analysis/task-plans/other__plan.json'
            }
          ]
        },
        {
          id: 'codex_bridge',
          label: 'Codex Bridge',
          purpose: 'A distinct review actor should cross-check assumptions, code, or consequential output before acceptance.',
          count: 1,
          first_task_id: 'example',
          first_command: '/review-task-plan example',
          rows: [
            {
              task_id: 'example',
              status: 'ready',
              review_lane: 'codex-bridge',
              risk_tier: 'medium',
              protocol_state: 'protocol_ready',
              missing_protocol_fields: [],
              route_owner: 'distinct review actor',
              actor_route: 'Dispatch a distinct Codex bridge/reviewer actor for cross-checking before acceptance.',
              reason: 'Plan declares codex-bridge review lane.',
              recommended_command: '/review-task-plan example',
              dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
              source: '_dev/reports/analysis/task-plans/example__plan.json'
            }
          ]
        }
      ]
    },
    command_runbook: {
      summary: '1 current command suggestion grouped into 1 command verb; 1 row is shown.',
      total_commands: 1,
      shown_commands: 1,
      first_command: {
        task_id: 'example',
        command: '/run-plan example',
        verb: '/run-plan',
        purpose: 'Codex Bridge gate',
        source_surface: 'risk_gate_queue',
        gate_or_lane: 'Codex Bridge',
        reason: 'Distinct review is required before treating this ready-looking item as clear.',
        dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
        source: '_dev/reports/analysis/task-plans/example__plan.json'
      },
      groups: [
        {
          verb: '/run-plan',
          purpose: 'Route an approved plan through execution.',
          count: 1,
          rows: [
            {
              task_id: 'example',
              command: '/run-plan example',
              verb: '/run-plan',
              purpose: 'Codex Bridge gate',
              source_surface: 'risk_gate_queue',
              gate_or_lane: 'Codex Bridge',
              reason: 'Distinct review is required before treating this ready-looking item as clear.',
              dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example',
              source: '_dev/reports/analysis/task-plans/example__plan.json'
            }
          ]
        }
      ]
    },
    recent_activity: {
      summary: '1 newest visible task-plan source files by filesystem modified time.',
      items: [
        {
          task_id: 'example',
          title: 'Example Plan',
          status: 'ready',
          source_mtime: '2026-06-22T00:00:00.000Z',
          next_command: '/run-plan example',
          source: '_dev/reports/analysis/task-plans/example__plan.json',
          dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example'
        }
      ]
    },
    plan_progress_timeline: {
      summary: '1 most recently touched visible plans with current status, workstream, next step, and next command.',
      status_mix: { ready: 1 },
      items: [
        {
          task_id: 'example',
          title: 'Example Plan',
          status: 'ready',
          review_lane: 'verify-local',
          risk_tier: 'low',
          source: '_dev/reports/analysis/task-plans/example__plan.json',
          modified_at: '2026-06-22T00:00:00.000Z',
          next_step: { step_id: 'S1', description: 'Run example step with a deliberately long description that should remain readable in the terminal locator output without flooding the operator with the full task-plan prose every time the dashboard locator runs.' },
          next_command: '/run-plan example',
          quality_flags: [],
          workstream_id: 'cluster-1',
          workstream_label: 'Example workstream',
          dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=example'
        }
      ]
    },
    unlinked_plan_triage: {
      total: 1,
      shown: 1,
      summary: '1 visible plan has no detected relationships; 1 highest-priority item is shown for triage.',
      rows: [
        {
          task_id: 'loose-plan',
          title: 'Loose Plan',
          status: 'ready',
          review_lane: 'verify-local',
          risk_tier: 'low',
          next_command: '/run-plan loose-plan',
          source: '_dev/reports/analysis/task-plans/loose-plan__plan.json',
          dashboard_href: 'plan-visibility__current.html#quality=unlinked&plan=loose-plan'
        }
      ]
    },
    impact_hubs: {
      total: 1,
      shown: 1,
      summary: '1 highest-impact connected plan by relationship count.',
      rows: [
        {
          task_id: 'other',
          role: 'bridge',
          status: 'planned',
          review_lane: 'codex-bridge',
          risk_tier: 'medium',
          total: 2,
          incoming: 1,
          outgoing: 1,
          top_intent: 'sequence',
          top_intent_count: 1,
          workstream_id: 'cluster-1',
          workstream_label: 'Example workstream',
          next_command: '/review-task-plan other',
          dashboard_href: 'plan-visibility__current.html#cluster=cluster-1&plan=other',
          why_it_matters: 'Bridge plan: connects upstream and downstream context across 2 relationships; top intent sequence.'
        }
      ]
    },
    visual_flowcharts: {
      summary: '2 generated Markdown artifacts contain Mermaid flowcharts.',
      items: [
        {
          label: 'System overview flowcharts',
          path: 'plan-visibility__current.md',
          command: 'npm run plans:dashboard'
        },
        {
          label: 'Example workstream',
          path: 'visual-plans/cluster-1.md',
          command: 'npm run plans:visual -- --cluster cluster-1 --write'
        }
      ]
    }
  });
  touch(planPath, '2026-06-22T00:00:00.000Z');
  touch(modelPath, '2026-06-22T00:01:00.000Z');

  const fresh = buildSummary(root);
  assert.equal(fresh.freshness.status, 'fresh');
  assert.equal(fresh.counts.plans, 3);
  assert.equal(fresh.counts.unlinked, 3);
  assert.equal(fresh.graph_health.coverage_percent, 70);
  assert.equal(fresh.priority_scan[0].task_id, 'example');
  assert.equal(fresh.top_workstreams[0].label, 'Example workstream');
  assert.equal(fresh.workstream_drilldowns.drilldowns[0].slices[0].label, 'Meta Execution-normalization');
  assert.ok(fresh.files.visualLibrary.path.endsWith('visual-plans/index.html'));
  assert.ok(fresh.files.visualLibraryMarkdown.path.endsWith('visual-plans/index.md'));
  assert.ok(fresh.files.harnessCapabilityDashboard.path.endsWith('harness-capability-dashboard.html'));
  assert.ok(fresh.quick_views.some((view) => view.label === 'Harness capability dashboard' && view.path.endsWith('harness-capability-dashboard.html')));
  assert.match(renderText(fresh), /Freshness: fresh/);
  assert.match(renderText(fresh), /Graph health:/);
  assert.match(renderText(fresh), /coverage: 70%/);
  assert.match(renderText(fresh), /actions: unlinked: plan-visibility__current\.html#quality=unlinked/);
  assert.equal(fresh.review_lane_routing.lanes[0].lane, 'operator-gate');
  assert.equal(fresh.review_lane_routing.lanes[1].lane, 'codex-bridge');
  assert.match(renderText(fresh), /Review lane routing:/);
  assert.match(renderText(fresh), /Operator Gate: 1 plans - Human operator judgment/);
  assert.match(renderText(fresh), /Codex Bridge: 2 plans - Distinct review lane/);
  assert.match(renderText(fresh), /Verify Local: 1 plans - Deterministic local checks are sufficient/);
  assert.match(renderText(fresh), /Missing Review Lane: 4 plans - Routing metadata is missing/);
  assert.match(renderText(fresh), /_dev\/reports\/analysis\/plan-visibility__current\.html#review=codex-bridge/);
  assert.match(renderText(fresh), /_dev\/reports\/analysis\/plan-visibility__current\.html#quality=missing_review_lane/);
  assert.equal(fresh.operator_question_routes[0].question, 'Where should I start?');
  assert.match(renderText(fresh), /Operator question router:/);
  assert.match(renderText(fresh), /Where should I start\? \(1 priority items\) - plan-visibility__index\.html#priority-scan - npm run plans:where/);
  assert.match(renderText(fresh), /How do plans interconnect\? \(1 chains\) - plan-visibility__index\.html#dependency-sequence-chains - npm run plans:where -- --from example --to third/);
  assert.match(renderText(fresh), /Workstream drilldowns:/);
  assert.match(renderText(fresh), /Meta Execution-normalization: 2 plans, 1 ready\/in-progress; next example - \/run-plan example - plan-visibility__current\.html#cluster=cluster-1&plan=example/);
  assert.equal(fresh.map_reading_guide.items[0].term, 'Generated map');
  assert.match(renderText(fresh), /How to read this map:/);
  assert.match(renderText(fresh), /Generated map: A derived view over task-plan artifacts\. Use: Use it for navigation and scanning\./);
  assert.equal(fresh.protocol_readiness.totals.protocol_ready, 1);
  assert.match(renderText(fresh), /Protocol readiness:/);
  assert.match(renderText(fresh), /ready: 1\/3; needs repair: 2/);
  assert.match(renderText(fresh), /Review lane: 1 missing - Set verify-local, codex-bridge, operator-gate, or another explicit review lane\./);
  assert.match(renderText(fresh), /repair other: routing_expectations\.review_lane - \/amend-plan other/);
  assert.equal(fresh.dependency_sequence_chains[0].summary, 'example -> other -> third');
  assert.match(renderText(fresh), /Dependency and sequence chains:/);
  assert.match(renderText(fresh), /example -> other -> third: 2 hops \(sequence, dependency\) - next example - \/run-plan example - plan-visibility__current\.html#from=example&to=third/);
  assert.match(renderText(fresh), /Remediation queue:/);
  assert.match(renderText(fresh), /unlinked: example/);
  assert.match(renderText(fresh), /Priority scan:/);
  assert.match(renderText(fresh), /Suggested next in largest workstream: example/);
  assert.equal(fresh.plan_action_board.lanes[0].rows[0].task_id, 'example');
  assert.match(renderText(fresh), /Plan action board:/);
  assert.match(renderText(fresh), /Runnable Now: example \(ready\) - Ready or in progress with no incoming dependency-intent relationship detected\. - \/run-plan example - plan-visibility__current\.html#cluster=cluster-1&plan=example/);
  assert.equal(fresh.execution_readiness.lanes[0].id, 'ready_to_route');
  assert.match(renderText(fresh), /Execution readiness:/);
  assert.match(renderText(fresh), /Ready To Route: example \(ready_to_route\) - Runnable candidate with protocol-readiness fields present\. - \/run-plan example - plan-visibility__current\.html#cluster=cluster-1&plan=example/);
  assert.match(renderText(fresh), /Protocol Repair First: other \(protocol_repair_first\) - Runnable-looking candidate, but missing routing_expectations\.review_lane\. - \/amend-plan other - plan-visibility__current\.html#plan=other/);
  assert.equal(fresh.routing_blockers.ready_to_route, 0);
  assert.match(renderText(fresh), /Routing blockers:/);
  assert.match(renderText(fresh), /ready to route: 0; blocker rows: 1/);
  assert.match(renderText(fresh), /Protocol Repair First: 1 rows; first other - \/amend-plan other - plan-visibility__current\.html#plan=other/);
  assert.equal(fresh.first_repair_path.recommended_first_step.id, 'repair-protocol');
  assert.match(renderText(fresh), /First repair path:/);
  assert.match(renderText(fresh), /1\. Repair Protocol Fields: other - Actor-continuity fields come before delegation or execution\. - \/amend-plan other - plan-visibility__current\.html#plan=other/);
  assert.equal(fresh.risk_gate_queue.rows[0].gate_owner, 'codex-bridge');
  assert.match(renderText(fresh), /Risk gate queue:/);
  assert.match(renderText(fresh), /Codex Bridge: example \(ready, medium\) - Distinct review is required before treating this ready-looking item as clear\. - \/run-plan example - plan-visibility__current\.html#cluster=cluster-1&plan=example/);
  assert.equal(fresh.orchestration_routing_board.lanes[0].id, 'repair_before_dispatch');
  assert.match(renderText(fresh), /Orchestration routing board:/);
  assert.match(renderText(fresh), /Repair Before Dispatch: 1 plans; first other - coordinator - \/amend-plan other - plan-visibility__current\.html#plan=other/);
  assert.match(renderText(fresh), /Codex Bridge: 1 plans; first example - distinct review actor - \/review-task-plan example - plan-visibility__current\.html#cluster=cluster-1&plan=example/);
  assert.equal(fresh.command_runbook.groups[0].verb, '/run-plan');
  assert.match(renderText(fresh), /Command runbook:/);
  assert.match(renderText(fresh), /\/run-plan: [0-9]+ suggestions - Route an approved plan through execution\./);
  assert.match(renderText(fresh), /example: Distinct review is required before treating this ready-looking item as clear\. - \/run-plan example - plan-visibility__current\.html#cluster=cluster-1&plan=example/);
  assert.match(renderText(fresh), /Recent source activity:/);
  assert.match(renderText(fresh), /2026-06-22T00:00:00\.000Z: example \(ready\) - \/run-plan example/);
  assert.equal(fresh.plan_progress_timeline.items[0].task_id, 'example');
  assert.match(renderText(fresh), /Plan progress timeline:/);
  assert.match(renderText(fresh), /example \(ready, Example workstream\) - S1: Run example step with a deliberately long description/);
  assert.match(renderText(fresh), /without flooding the operator with the full\.\.\. - \/run-plan example/);
  assert.doesNotMatch(renderText(fresh), /every time the dashboard locator runs/);
  assert.match(renderText(fresh), /map: plan-visibility__current\.html#cluster=cluster-1&plan=example/);
  assert.equal(fresh.unlinked_plan_triage.rows[0].task_id, 'loose-plan');
  assert.match(renderText(fresh), /Unlinked plan triage:/);
  assert.match(renderText(fresh), /loose-plan \(ready, verify-local\/low\) - \/run-plan loose-plan - plan-visibility__current\.html#quality=unlinked&plan=loose-plan/);
  assert.equal(fresh.impact_hubs.rows[0].task_id, 'other');
  assert.match(renderText(fresh), /Impact hubs:/);
  assert.match(renderText(fresh), /other \(bridge, 2 links, Example workstream\) - Bridge plan: connects upstream and downstream context across 2 relationships; top intent sequence\. - plan-visibility__current\.html#cluster=cluster-1&plan=other/);
  assert.match(renderText(fresh), /Visual flowcharts:/);
  assert.match(renderText(fresh), /System overview flowcharts/);
  assert.match(renderText(fresh), /Example workstream/);
  assert.match(renderText(fresh), /Visual brief library: _dev\/reports\/analysis\/visual-plans\/index\.html/);
  assert.match(renderText(fresh), /Visual brief library Markdown: _dev\/reports\/analysis\/visual-plans\/index\.md/);
  assert.match(renderText(fresh), /Harness capability dashboard: _dev\/reports\/analysis\/harness-capability-dashboard\.html/);

  const selected = buildSummary(root, { planId: 'example' });
  assert.equal(selected.selected_plan.found, true);
  assert.equal(selected.selected_plan.map, '_dev/reports/analysis/plan-visibility__current.html#cluster=cluster-1&plan=example');
  assert.equal(selected.selected_plan.workstream.brief_exists, false);
  assert.equal(selected.selected_plan.workstream.brief_command, 'npm run plans:visual -- --cluster cluster-1 --write');
  assert.equal(selected.selected_plan.relationships.outgoing, 1);
  assert.equal(selected.selected_plan.neighborhood.direct_neighbors[0].task_id, 'other');
  assert.equal(selected.selected_plan.neighborhood.direct_neighbors[0].status, 'planned');
  assert.equal(selected.selected_plan.neighborhood.same_workstream_sample[0].task_id, 'other');
  assert.equal(selected.selected_plan.action_lanes[0].lane, 'Runnable Now');
  assert.equal(selected.selected_plan.action_lanes[0].next_command, '/run-plan example');
  assert.equal(selected.selected_plan.connection_evidence[0].other_task_id, 'other');
  assert.equal(selected.selected_plan.connection_evidence[0].confidence, 'derived');
  assert.equal(selected.selected_plan.connection_evidence[0].meaning, 'This plan points at other as sequencing context.');
  assert.equal(selected.selected_plan.remediation_rows[0].signal, 'unlinked');
  assert.match(renderText(selected), /Selected plan:/);
  assert.match(renderText(selected), /next: \/run-plan example/);
  assert.match(renderText(selected), /remediation:/);
  assert.match(renderText(selected), /action lanes:/);
  assert.match(renderText(selected), /Runnable Now: Ready or in progress/);
  assert.match(renderText(selected), /connection evidence:/);
  assert.match(renderText(selected), /example -> other \(sequence\/mentions, derived\) - This plan points at other as sequencing context\./);
  assert.match(renderText(selected), /confidence: Derived from a task-id mention/);
  assert.match(renderText(selected), /evidence: example evidence/);
  assert.match(renderText(selected), /direct neighbors:/);
  assert.match(renderText(selected), /outgoing: other \(sequence\/mentions, derived\)/);
  assert.match(renderText(selected), /same workstream sample:/);
  assert.match(renderText(selected), /brief: not generated for this workstream/);

  const workstream = buildSummary(root, { workstreamId: 'cluster-1' });
  assert.equal(workstream.selected_workstream.found, true);
  assert.equal(workstream.selected_workstream.map, '_dev/reports/analysis/plan-visibility__current.html#cluster=cluster-1&plan=example');
  assert.equal(workstream.selected_workstream.brief_exists, false);
  assert.equal(workstream.selected_workstream.suggested_next.task_id, 'example');
  assert.ok(workstream.selected_workstream.top_intents.some((item) => item.label === 'sequence'));
  assert.match(renderText(workstream), /Selected workstream:/);
  assert.match(renderText(workstream), /Example workstream \(cluster-1\)/);
  assert.match(renderText(workstream), /suggested next: example \(ready\)/);
  assert.match(renderText(workstream), /story: Example workstream connects 3 plans/);
  assert.match(renderText(workstream), /example -> other \(sequence\/mentions\): example evidence/);
  assert.match(renderText(workstream), /bridge plans: other \(bridge, 2 links\)/);

  const pathSummary = buildSummary(root, { pathFrom: 'example', pathTo: 'third' });
  assert.equal(pathSummary.connection_path.found, true);
  assert.equal(pathSummary.connection_path.hops, 2);
  assert.deepEqual(pathSummary.connection_path.plans.map((plan) => plan.task_id), ['example', 'other', 'third']);
  assert.equal(pathSummary.connection_path.relationships[0].intent, 'sequence');
  assert.match(renderText(pathSummary), /Connection path:/);
  assert.match(renderText(pathSummary), /example -> third: 2 hops/);
  assert.match(renderText(pathSummary), /plan sequence: example -> other -> third/);

  const missing = buildSummary(root, { planId: 'missing-plan' });
  assert.equal(missing.selected_plan.found, false);
  assert.match(renderText(missing), /No visible plan found for missing-plan/);

  const missingWorkstream = buildSummary(root, { workstreamId: 'cluster-missing' });
  assert.equal(missingWorkstream.selected_workstream.found, false);
  assert.match(renderText(missingWorkstream), /No visible workstream found for cluster-missing/);

  assert.equal(parseArgs(['--workstream', 'cluster-1']).workstreamId, 'cluster-1');
  assert.equal(parseArgs(['--cluster=cluster-1']).workstreamId, 'cluster-1');
  assert.equal(parseArgs(['--from', 'example', '--to=third']).pathFrom, 'example');
  assert.equal(parseArgs(['--from', 'example', '--to=third']).pathTo, 'third');

  const missingPath = buildSummary(root, { pathFrom: 'example', pathTo: 'missing-plan' });
  assert.equal(missingPath.connection_path.found, false);
  assert.match(renderText(missingPath), /Cannot locate path because missing-plan is not visible/);

  touch(planPath, '2026-06-22T00:02:00.000Z');
  const stale = buildSummary(root);
  assert.equal(stale.freshness.status, 'stale');
  assert.equal(stale.freshness.newest_plan.path, '_dev/reports/analysis/task-plans/example__plan.json');
  assert.match(renderText(stale), /Freshness: stale/);
  assert.match(renderText(stale), /Run npm run plans:dashboard/);
});
