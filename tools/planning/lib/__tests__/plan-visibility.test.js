'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildPlanVisibilityModel,
  buildVisualFlowchartInventory,
  buildVisualPlanAdapterManifest,
  buildPlanVisibilityIndexQuickViews,
  collectPlanSummaries,
  collectPlanRelationships,
  renderFocusedVisualPlanMarkdown,
  renderPlanDocumentMarkdown,
  renderPlanVisibilityHtml,
  renderPlanVisibilityIndex,
  renderPlanVisibilityMarkdown,
  renderPlanVisibilityOperatorBrief,
  renderVisualPlanLibraryHtml,
  renderVisualPlanLibraryMarkdown
} = require('../plan-visibility');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('plan visibility defaults to system plans and labels derived authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/system-one__plan.json'), {
    task_id: 'system-one',
    title: 'System One',
    scope_type: 'system',
    current_state: 'System plan exists.',
    question_work: 'Run the next bounded step.',
    desired_state: 'The next bounded step has been handled.',
    approval: { status: 'approved' },
    routing_expectations: { risk_tier: 'medium', review_lane: 'codex-bridge' },
    bounded_plan: {
      steps: [
        { step_id: 's1', status: 'complete' },
        { step_id: 's2', status: 'ready' }
      ]
    }
  });
  writeJson(path.join(root, 'clients/ABC/plans/client-one__plan.json'), {
    task_id: 'client-one',
    title: 'Client One',
    scope_type: 'client'
  });

  const summaries = collectPlanSummaries(root);
  const model = buildPlanVisibilityModel(root, { generatedAt: '2026-06-22T00:00:00Z' });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].task_id, 'system-one');
  assert.equal(summaries[0].status, 'ready');
  assert.equal(summaries[0].client_code, 'system');
  assert.equal(summaries[0].step_counts.complete, 1);
  assert.equal(model.data_quality.missing_review_lane.count, 0);
  assert.equal(model.data_quality.unlinked.count, 1);
  assert.equal(model.graph_health.coverage_percent, 0);
  assert.equal(model.graph_health.unlinked_plans, 1);
  const unlinkedRecommendation = model.graph_health.recommendations.find((item) => item.signal === 'unlinked');
  assert.equal(unlinkedRecommendation.dashboard_href, 'plan-visibility__current.html#quality=unlinked');
  assert.equal(model.remediation_queue[0].task_id, 'system-one');
  assert.equal(model.remediation_queue[0].source, '_dev/reports/analysis/task-plans/system-one__plan.json');
  assert.equal(model.unlinked_plan_triage.total, 1);
  assert.equal(model.unlinked_plan_triage.rows[0].task_id, 'system-one');
  assert.equal(model.unlinked_plan_triage.rows[0].dashboard_href, 'plan-visibility__current.html#quality=unlinked&plan=system-one');
  assert.equal(model.plan_action_board.lanes[0].id, 'runnable_now');
  assert.equal(model.plan_action_board.lanes[0].rows[0].task_id, 'system-one');
  assert.equal(model.recent_activity.items[0].task_id, 'system-one');
  assert.equal(model.recent_activity.items[0].source, '_dev/reports/analysis/task-plans/system-one__plan.json');
  assert.equal(model.plan_progress_timeline.items[0].task_id, 'system-one');
  assert.equal(model.plan_progress_timeline.items[0].next_command, '/review-task-plan system-one');
  assert.ok(model.operator_question_routes.some((route) => route.question === 'Where should I start?'));
  assert.ok(model.operator_question_routes.some((route) => route.question === 'Where is the full dashboard?' && route.count_label === '1 visible plans'));
  assert.equal(model.map_reading_guide.items[0].term, 'Generated map');
  assert.ok(model.map_reading_guide.items.some((item) => item.term === 'Workstream'));
  assert.equal(model.protocol_readiness.totals.protocol_ready, 1);
  assert.equal(model.protocol_readiness.totals.needs_protocol_repair, 0);
  assert.equal(model.protocol_readiness.rows[0].protocol_state, 'protocol_ready');
  assert.equal(model.execution_readiness.lanes[0].id, 'ready_to_route');
  assert.equal(model.execution_readiness.lanes[0].rows[0].task_id, 'system-one');
  assert.equal(model.routing_blockers.ready_to_route, 1);
  assert.equal(model.routing_blockers.blockers[0].id, 'protocol_repair_first');
  assert.equal(model.first_repair_path.recommended_first_step.id, 'route-ready');
  assert.equal(model.first_repair_path.recommended_first_step.task_id, 'system-one');
  assert.equal(model.risk_gate_queue.rows[0].task_id, 'system-one');
  assert.equal(model.risk_gate_queue.rows[0].gate_owner, 'codex-bridge');
  assert.ok(model.orchestration_routing_board.lanes.length > 0);
  assert.ok(model.orchestration_routing_board.lanes.some((lane) => lane.id === 'codex_bridge'));
  assert.ok(model.command_runbook.groups.length > 0);
  assert.ok(model.command_runbook.groups.some((group) => group.verb === '/review-task-plan'));
  assert.ok(model.visual_flowcharts.items.some((item) => item.id === 'system-overview' && item.mermaid_blocks.includes('status_flow')));
  assert.deepEqual(model.plans[0].quality_flags, ['unlinked', 'high_risk_ready']);
  assert.deepEqual(model.relationship_hubs, []);
  assert.equal(model.impact_hubs.total, 0);
  assert.deepEqual(model.impact_hubs.rows, []);

  const markdown = renderPlanVisibilityMarkdown(root, { generatedAt: '2026-06-22T00:00:00Z' });
  assert.match(markdown, /Derived context only/);
  assert.match(markdown, /## Briefing/);
  assert.match(markdown, /Operator Question Router/);
  assert.match(markdown, /Where is the full dashboard\?/);
  assert.match(markdown, /How To Read This Map/);
  assert.match(markdown, /Generated map/);
  assert.match(markdown, /Workstream/);
  assert.match(markdown, /## Protocol Readiness/);
  assert.match(markdown, /protocol_ready/);
  assert.match(markdown, /## Execution Readiness/);
  assert.match(markdown, /ready_to_route/);
  assert.match(markdown, /Routing Blockers/);
  assert.match(markdown, /First Repair Path/);
  assert.match(markdown, /Route Ready Work/);
  assert.match(markdown, /Risk Gate Queue/);
  assert.match(markdown, /Orchestration Routing Board/);
  assert.match(markdown, /Codex Bridge/);
  assert.match(markdown, /Command Runbook/);
  assert.match(markdown, /Codex Bridge/);
  assert.match(markdown, /## Graph Health/);
  assert.match(markdown, /Map Confidence Actions/);
  assert.match(markdown, /Remediation Queue/);
  assert.match(markdown, /Unlinked Plan Triage/);
  assert.match(markdown, /Plan Action Board/);
  assert.match(markdown, /Runnable Now/);
  assert.match(markdown, /Visual Flowcharts/);
  assert.match(markdown, /Recent Source Activity/);
  assert.match(markdown, /Plan Progress Timeline/);
  assert.match(markdown, /plan-visibility__current\.html#quality=unlinked/);
  assert.match(markdown, /Linked plans/);
  assert.match(markdown, /## Data Quality/);
  assert.match(markdown, /## Visual Overview/);
  assert.match(markdown, /Quality/);
  assert.match(markdown, /unlinked/);
  assert.match(markdown, /```mermaid/);
  assert.match(markdown, /system-one/);
  assert.doesNotMatch(markdown, /client-one/);
});

test('completed verified outcomes route to debrief unless exact next command overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-complete-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/completed-plan__plan.json'), {
    task_id: 'completed-plan',
    scope_type: 'system',
    routing_expectations: { risk_tier: 'medium', review_lane: 'codex-bridge' },
    bounded_plan: {
      steps: [
        { step_id: 's1', status: 'completed' }
      ]
    },
    outcome_delta: {
      completed: true,
      verification_passed: true
    }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/exact-command-plan__plan.json'), {
    task_id: 'exact-command-plan',
    scope_type: 'system',
    exact_next_command: '/custom-next exact-command-plan',
    routing_expectations: { risk_tier: 'medium', review_lane: 'codex-bridge' },
    bounded_plan: {
      steps: [
        { step_id: 's1', status: 'completed' }
      ]
    },
    outcome_delta: {
      completed: true,
      verification_passed: true
    }
  });

  const byId = new Map(collectPlanSummaries(root).map((plan) => [plan.task_id, plan]));
  assert.equal(byId.get('completed-plan').next_command, '/debrief-run completed-plan');
  assert.equal(byId.get('exact-command-plan').next_command, '/custom-next exact-command-plan');

  fs.mkdirSync(path.join(root, '_dev/reports/analysis'), { recursive: true });
  fs.writeFileSync(path.join(root, '_dev/reports/analysis/run-debrief__completed-plan.md'), '# debrief\n');
  const afterDebrief = new Map(collectPlanSummaries(root).map((plan) => [plan.task_id, plan]));
  assert.equal(afterDebrief.get('completed-plan').next_command, 'none');
  assert.equal(afterDebrief.get('exact-command-plan').next_command, '/custom-next exact-command-plan');
});

test('plan visibility includes client plans only when explicitly requested', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, 'clients/ABC/plans/client-one__plan.json'), {
    task_id: 'client-one',
    title: 'Client One',
    scope_type: 'client',
    bounded_plan: { steps: [] }
  });

  assert.equal(collectPlanSummaries(root).length, 0);
  assert.equal(collectPlanSummaries(root, { includeClient: true }).length, 1);
});

test('plan visibility detects plan interconnections from plan metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/parent-plan__plan.json'), {
    task_id: 'parent-plan',
    title: 'Parent Plan',
    scope_type: 'system',
    bounded_plan: {
      steps: [
        { step_id: 'p1', status: 'ready', description: 'Run before final-plan.' }
      ]
    }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/child-plan__plan.json'), {
    task_id: 'child-plan',
    title: 'Child Plan',
    scope_type: 'system',
    parent_task_id: 'parent-plan',
    component_matches: [
      { path: '_dev/reports/analysis/task-plans/parent-plan__plan.json' }
    ],
    existing_work_overlap: {
      highest_scoring_plan: '_dev/reports/analysis/task-plans/parent-plan__plan.json'
    },
    scope_identity: {
      referenced_not_owned: [
        '_dev/reports/analysis/task-plans/parent-plan__plan.json'
      ]
    },
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/final-plan__plan.json'), {
    task_id: 'final-plan',
    title: 'Final Plan',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });

  const summaries = collectPlanSummaries(root);
  const relationships = collectPlanRelationships(summaries);
  const model = buildPlanVisibilityModel(root, { generatedAt: '2026-06-22T00:00:00Z' });
  const types = relationships.map((relationship) => relationship.type).sort();
  for (const type of ['component', 'overlap', 'parent', 'references']) {
    assert.ok(types.includes(type), `missing ${type} relationship`);
  }
  assert.equal(relationships.find((relationship) => relationship.type === 'parent').confidence, 'high');
  assert.equal(relationships.find((relationship) => relationship.type === 'component').confidence, 'high');
  assert.equal(relationships.find((relationship) => relationship.type === 'references').confidence, 'medium');
  assert.equal(relationships.find((relationship) => relationship.type === 'overlap').confidence, 'medium');
  const childHub = model.relationship_hubs.find((hub) => hub.task_id === 'child-plan');
  assert.ok(childHub);
  assert.equal(model.relationship_groupings.confidence.high, 2);
  assert.equal(model.relationship_groupings.confidence.medium, 2);
  assert.equal(childHub.role, 'bridge');
  assert.equal(childHub.outgoing, 4);
  assert.match(childHub.cluster_label, /workstream/);
  const childImpactHub = model.impact_hubs.rows.find((hub) => hub.task_id === 'child-plan');
  assert.ok(childImpactHub);
  assert.equal(childImpactHub.role, 'bridge');
  assert.match(childImpactHub.why_it_matters, /Bridge plan/);
  const childPath = model.action_paths.find((item) => item.task_id === 'child-plan');
  assert.ok(childPath);
  assert.ok(childPath.upstream_count >= 1);
  assert.equal(childPath.downstream_count, 1);
  assert.equal(childPath.upstream[0].plan, 'parent-plan');
  assert.ok(model.dependency_sequence_chains.some((chain) => chain.summary.includes('parent-plan -> final-plan')));
  assert.ok(model.dependency_sequence_chains.some((chain) => chain.dashboard_href.includes('from=parent-plan')));
  assert.equal(model.workstream_matrix.length, model.relationship_clusters.length);
  assert.ok(model.workstream_drilldowns.drilldowns.length >= 1);
  assert.ok(model.workstream_drilldowns.drilldowns[0].slices.length >= 1);
  assert.equal(model.workstream_stories.length, model.relationship_clusters.length);
  assert.equal(model.workstream_stories[0].cluster_id, model.relationship_clusters[0].id);
  assert.ok(model.workstream_stories[0].explanation.includes('connects'));
  assert.ok(model.workstream_stories[0].relationship_examples.some((example) => example.source === 'child-plan' && example.target === 'parent-plan'));
  assert.ok(model.workstream_matrix.every((row) => Object.prototype.hasOwnProperty.call(row, 'brief_exists')));
  assert.equal(model.visual_coverage.total_workstreams, model.workstream_matrix.length);
  assert.equal(model.visual_coverage.generated_briefs + model.visual_coverage.missing_briefs, model.workstream_matrix.length);
  const noDefaultBriefsModel = buildPlanVisibilityModel(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    visualClusterLimit: 0
  });
  assert.equal(noDefaultBriefsModel.visual_coverage.missing_briefs, noDefaultBriefsModel.workstream_matrix.length);
  fs.mkdirSync(path.join(root, '_dev/reports/analysis/visual-plans'), { recursive: true });
  fs.writeFileSync(path.join(root, '_dev/reports/analysis/visual-plans', `${noDefaultBriefsModel.workstream_matrix[0].cluster_id}.md`), '# generated\n');
  const fileAwareModel = buildPlanVisibilityModel(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    visualClusterLimit: 0
  });
  assert.equal(fileAwareModel.visual_coverage.generated_briefs, 1);
  const allVisualsModel = buildPlanVisibilityModel(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    visualClusterLimit: Number.MAX_SAFE_INTEGER
  });
  assert.equal(allVisualsModel.visual_coverage.missing_briefs, 0);

  const markdown = renderPlanVisibilityMarkdown(root, { generatedAt: '2026-06-22T00:00:00Z' });
  assert.match(markdown, /child-plan/);
  assert.match(markdown, /parent-plan/);
  assert.match(markdown, /Workstream Connection Stories/);
  assert.match(markdown, /Workstream Drilldowns/);
  assert.match(markdown, /Impact Hubs/);
  assert.match(markdown, /Interconnection Table/);
  assert.match(markdown, /Dependency & Sequence Chains/);
  assert.match(markdown, /parent-plan -&gt; final-plan|parent-plan -> final-plan/);
});

test('plan visibility normalizes structured framework references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/object-framework__plan.json'), {
    task_id: 'object-framework',
    title: 'Object Framework',
    scope_type: 'system',
    similarity_assessment: {
      top_framework: {
        framework_id: 'wordpress/qa',
        rationale: 'Structured framework match record.'
      }
    },
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/null-framework__plan.json'), {
    task_id: 'null-framework',
    title: 'Null Framework',
    scope_type: 'system',
    similarity_assessment: {
      top_framework: {
        framework_id: null,
        match_rationale: 'No framework match.'
      }
    },
    bounded_plan: { steps: [] }
  });

  const model = buildPlanVisibilityModel(root, { generatedAt: '2026-06-22T00:00:00Z' });
  const byId = new Map(model.plans.map((plan) => [plan.task_id, plan]));
  assert.equal(byId.get('object-framework').framework, 'wordpress/qa');
  assert.equal(byId.get('null-framework').framework, 'no-framework-match');
  assert.ok(!model.plans.some((plan) => String(plan.framework).includes('[object Object]')));
});

test('plan visibility renders standalone html map from the same model', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/alpha__plan.json'), {
    task_id: 'alpha',
    title: 'Alpha',
    scope_type: 'system',
    approval: { status: 'approved' },
    similarity_assessment: { top_framework: 'meta/example' },
    routing_expectations: { risk_tier: 'low', review_lane: 'verify-local' },
    bounded_plan: { steps: [{ step_id: 'a', status: 'complete' }] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/beta__plan.json'), {
    task_id: 'beta',
    title: 'Beta',
    scope_type: 'system',
    parent_task_id: 'alpha',
    bounded_plan: { steps: [{ step_id: 'b1', status: 'ready', description: 'Do the beta step', mode: 'PATCH_ALLOWED' }] }
  });

  const html = renderPlanVisibilityHtml(root, { generatedAt: '2026-06-22T00:00:00Z' });
  assert.match(html, /<!doctype html>/);
  assert.match(html, /Mythos Plan Map/);
  assert.match(html, /Derived context only/);
  assert.match(html, /Briefing/);
  assert.match(html, /Operator Overview/);
  assert.match(html, /Data Quality/);
  assert.match(html, /data_quality/);
  assert.match(html, /Relationship Clusters/);
  assert.match(html, /relationship_clusters/);
  assert.match(html, /Workstream Matrix/);
  assert.match(html, /workstream_matrix/);
  assert.match(html, /renderWorkstreamMatrix/);
  assert.match(html, /Workstream Connection Stories/);
  assert.match(html, /workstream_stories/);
  assert.match(html, /renderWorkstreamStories/);
  assert.match(html, /Impact Hubs/);
  assert.match(html, /impact_hubs/);
  assert.match(html, /renderImpactHubs/);
  assert.match(html, /storySearch/);
  assert.match(html, /storyIntent/);
  assert.match(html, /storyRelationshipMode/);
  assert.match(html, /storyHashFilters/);
  assert.match(html, /storyMode/);
  assert.match(html, /applyStoryFiltersAndPersist/);
  assert.match(html, /Visual Coverage Queue/);
  assert.match(html, /visual_coverage/);
  assert.match(html, /renderVisualCoverage/);
  assert.match(html, /Recent Source Activity/);
  assert.match(html, /recent_activity/);
  assert.match(html, /renderRecentActivity/);
  assert.match(html, /Plan Progress Timeline/);
  assert.match(html, /plan_progress_timeline/);
  assert.match(html, /renderPlanProgressTimeline/);
  assert.match(html, /Plan Action Board/);
  assert.match(html, /plan_action_board/);
  assert.match(html, /renderPlanActionBoard/);
  assert.match(html, /Unlinked Plan Triage/);
  assert.match(html, /unlinked_plan_triage/);
  assert.match(html, /renderUnlinkedPlanTriage/);
  assert.match(html, /Connection Hubs/);
  assert.match(html, /relationship_hubs/);
  assert.match(html, /renderHubs/);
  assert.match(html, /Action Paths/);
  assert.match(html, /action_paths/);
  assert.match(html, /renderActionPaths/);
  assert.match(html, /Plan Context/);
  assert.match(html, /renderSelectedPlanContext/);
  assert.match(html, /renderSelectedPlanLocalFlow/);
  assert.match(html, /Local flow/);
  assert.match(html, /selected-flow/);
  assert.match(html, /actionLanesForPlan/);
  assert.match(html, /renderActionLaneMembership/);
  assert.match(html, /Action lanes/);
  assert.match(html, /connectionEvidenceForPlan/);
  assert.match(html, /renderConnectionEvidence/);
  assert.match(html, /Connection evidence/);
  assert.match(html, /clusterForPlan/);
  assert.match(html, /Focus cluster/);
  assert.match(html, /Open brief/);
  assert.match(html, /visual-plans\//);
  assert.match(html, /Clear cluster focus/);
  assert.match(html, /readHashState/);
  assert.match(html, /updateHash/);
  assert.match(html, /hashFilters/);
  assert.match(html, /applyFiltersAndPersist/);
  assert.match(html, /Relationship Graph/);
  assert.match(html, /Visible Relationships/);
  assert.match(html, /visibleRelationships/);
  assert.match(html, /renderVisibleRelationships/);
  assert.match(html, /Confidence/);
  assert.match(html, /confidence_reason/);
  assert.match(html, /relationships match the current filters/);
  assert.match(html, /Connection path finder/);
  assert.match(html, /pathFrom/);
  assert.match(html, /pathTo/);
  assert.match(html, /findConnectionPath/);
  assert.match(html, /connection path/);
  assert.match(html, /arrowhead/);
  assert.match(html, /marker-end/);
  assert.match(html, /graphAll/);
  assert.match(html, /All filtered plans/);
  assert.match(html, /first 80 shown/);
  assert.match(html, /Needs Attention/);
  assert.match(html, /Runnable Now/);
  assert.match(html, /Dependency Watch/);
  assert.match(html, /Risk Watch/);
  assert.match(html, /Queue reason/);
  assert.match(html, /Next Step/);
  assert.match(html, /Do the beta step/);
  assert.match(html, /Selected neighborhood/);
  assert.match(html, /Incoming/);
  assert.match(html, /Outgoing/);
  assert.match(html, /Open source/);
  assert.match(html, /sourceHref/);
  assert.match(html, /<script id="plan-data" type="application\/json">/);
  assert.match(html, /"task_id":"alpha"/);
  assert.match(html, /"next_step":/);
  assert.match(html, /"quality_flags":/);
  assert.match(html, /All clients/);
  assert.match(html, /All frameworks/);
  assert.match(html, /All quality signals/);
  assert.match(html, /All relationship intents/);
  assert.match(html, /"framework":"meta\/example"/);
  assert.match(html, /"source":"alpha","target":"beta","type":"parent","intent":"hierarchy"/);
});

test('plan visibility derives mention relationships and groupings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/source-plan__plan.json'), {
    task_id: 'source-plan',
    title: 'Source Plan',
    scope_type: 'system',
    task_summary: 'This plan should follow target-plan before execution.',
    similarity_assessment: { top_framework: 'meta/example' },
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/target-plan__plan.json'), {
    task_id: 'target-plan',
    title: 'Target Plan',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });

  const summaries = collectPlanSummaries(root);
  const relationships = collectPlanRelationships(summaries);
  assert.ok(relationships.some((relationship) => (
    relationship.source === 'source-plan'
    && relationship.target === 'target-plan'
    && relationship.type === 'mentions'
    && relationship.intent === 'sequence'
    && relationship.confidence === 'derived'
  )));

  const markdown = renderPlanVisibilityMarkdown(root, { generatedAt: '2026-06-22T00:00:00Z' });
  assert.match(markdown, /## Plan Groupings/);
  assert.match(markdown, /## Relationship Clusters/);
  assert.match(markdown, /## Workstream Matrix/);
  assert.match(markdown, /Relationship Confidence/);
  assert.match(markdown, /Confidence/);
  assert.match(markdown, /derived: Derived from a task-id mention/);
  assert.match(markdown, /## Connection Hubs/);
  assert.match(markdown, /## Action Paths/);
  assert.match(markdown, /Feeds from/);
  assert.match(markdown, /Feeds into/);
  assert.match(markdown, /driver/);
  assert.match(markdown, /convergence/);
  assert.match(markdown, /source-plan/);
  assert.match(markdown, /target-plan/);
  assert.match(markdown, /Workstream/);
  assert.match(markdown, /Meta Example workstream/);
  assert.match(markdown, /Why named this way/);
  assert.match(markdown, /### Relationship Intents/);
  assert.match(markdown, /meta\/example: 1/);
  assert.match(markdown, /sequence: 1/);
  assert.match(markdown, /mentions/);
});

test('plan visibility index points to generated dashboard artifacts', () => {
  const html = renderPlanVisibilityIndex({
    generatedAt: '2026-06-22T00:00:00Z',
    model: {
      buckets: {
        ready: 2,
        planned: 3,
        complete: 1
      },
      graph_health: {
        linked_plans: 7,
        unlinked_plans: 3,
        coverage_percent: 70,
        links_per_plan: 1.2,
        top_intents: [{ label: 'dependency', count: 2 }],
        top_sources: [{ label: 'parent', count: 2 }],
        weakest_areas: [{ signal: 'unlinked', count: 3 }]
      },
      relationship_groupings: {
        confidence: {
          high: 2,
          medium: 1,
          derived: 4
        }
      },
      groupings: {
        review_lane: {
          'operator-gate': 1,
          'codex-bridge': 2,
          'verify-local': 3,
          'not-recorded': 4
        }
      },
      data_quality: {
        unlinked: { count: 3, sample: ['one'] },
        missing_review_lane: { count: 2, sample: ['two'] }
      },
      priority_scan: [
        {
          kind: 'workstream-next',
          label: 'Suggested next in largest workstream',
          task_id: 'ready-plan',
          status: 'ready',
          reason: 'Ready Workstream: ready plan in this connected workstream.',
          href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan',
          source: '_dev/reports/analysis/task-plans/ready-plan__plan.json',
          next_command: '/run-plan ready-plan'
        }
      ],
      operator_question_routes: [
        {
          id: 'start',
          question: 'Where should I start?',
          answer: 'Open the priority scan for the first few plans and workstreams worth inspecting.',
          count_label: '1 priority items',
          href: 'plan-visibility__index.html#priority-scan',
          command: 'npm run plans:where',
          evidence: 'Suggested next in largest workstream'
        },
        {
          id: 'connections',
          question: 'How do plans interconnect?',
          answer: 'Scan dependency and sequence chains, then open a chain link in the connection path finder.',
          count_label: '1 chains',
          href: 'plan-visibility__index.html#dependency-sequence-chains',
          command: 'npm run plans:where -- --from ready-plan --to done-plan',
          evidence: 'ready-plan -> bridge-plan -> done-plan'
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
            meaning: 'A connected group of plans in the relationship graph.',
            use: 'Open a workstream when you want related plans.',
            trust_boundary: 'Workstream labels are generated and can be improved by better metadata.'
          }
        ]
      },
      protocol_readiness: {
        summary: '1 of 2 visible plans carry the protocol fields needed for routed execution and handoff; 1 need repair before treating the dashboard as execution authority.',
        totals: {
          visible_plans: 2,
          protocol_ready: 1,
          needs_protocol_repair: 1
        },
        checks: [
          {
            id: 'review_lane',
            label: 'Review lane',
            missing_field: 'routing_expectations.review_lane',
            present_count: 1,
            missing_count: 1,
            repair: 'Set verify-local, codex-bridge, operator-gate, or another explicit review lane.',
            sample: ['needs-route']
          }
        ],
        rows: [
          {
            task_id: 'needs-route',
            title: 'Needs Route',
            status: 'planned',
            protocol_state: 'needs_protocol_repair',
            missing_fields: ['routing_expectations.review_lane'],
            missing_count: 1,
            review_lane: 'not-recorded',
            risk_tier: 'low',
            source: '_dev/reports/analysis/task-plans/needs-route__plan.json',
            dashboard_href: 'plan-visibility__current.html#plan=needs-route',
            recommended_command: '/amend-plan needs-route',
            reason: 'Missing routing_expectations.review_lane.'
          }
        ]
      },
      plan_action_board: {
        summary: 'Action lanes derived from test fixture.',
        lanes: [
          {
            id: 'runnable_now',
            label: 'Runnable Now',
            summary: '1 ready plan.',
            rows: [
              {
                task_id: 'ready-plan',
                title: 'Ready Plan',
                status: 'ready',
                review_lane: 'verify-local',
                risk_tier: 'low',
                source: '_dev/reports/analysis/task-plans/ready-plan__plan.json',
                next_command: '/run-plan ready-plan',
                dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan',
                workstream_label: 'Ready Workstream',
                reason: 'Ready or in progress with no incoming dependency-intent relationship detected.'
              }
            ]
          },
          { id: 'dependency_watch', label: 'Dependency Watch', summary: '0 dependency items.', rows: [] }
        ]
      },
      execution_readiness: {
        summary: 'Execution readiness combines action-lane membership with protocol readiness.',
        lanes: [
          {
            id: 'ready_to_route',
            label: 'Ready To Route',
            summary: '1 runnable candidate has protocol-readiness fields present.',
            rows: [
              {
                task_id: 'ready-plan',
                title: 'Ready Plan',
                source_lane: 'runnable_now',
                readiness: 'ready_to_route',
                status: 'ready',
                review_lane: 'verify-local',
                risk_tier: 'low',
                missing_protocol_fields: [],
                source: '_dev/reports/analysis/task-plans/ready-plan__plan.json',
                dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan',
                recommended_command: '/run-plan ready-plan',
                reason: 'Runnable candidate with protocol-readiness fields present.'
              }
            ]
          },
          {
            id: 'protocol_repair_first',
            label: 'Protocol Repair First',
            summary: '1 runnable-looking candidate needs protocol repair.',
            rows: [
              {
                task_id: 'needs-route',
                title: 'Needs Route',
                source_lane: 'runnable_now',
                readiness: 'protocol_repair_first',
                status: 'ready',
                review_lane: 'not-recorded',
                risk_tier: 'low',
                missing_protocol_fields: ['routing_expectations.review_lane'],
                source: '_dev/reports/analysis/task-plans/needs-route__plan.json',
                dashboard_href: 'plan-visibility__current.html#plan=needs-route',
                recommended_command: '/amend-plan needs-route',
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
        protocol_repairs: 1,
        top_blocker: {
          id: 'protocol_repair_first',
          label: 'Protocol Repair First',
          count: 1,
          first_task_id: 'needs-route',
          reason: 'Runnable-looking candidate, but missing routing_expectations.review_lane.',
          command: '/amend-plan needs-route',
          href: 'plan-visibility__current.html#plan=needs-route'
        },
        blockers: [
          {
            id: 'protocol_repair_first',
            label: 'Protocol Repair First',
            count: 1,
            first_task_id: 'needs-route',
            reason: 'Runnable-looking candidate, but missing routing_expectations.review_lane.',
            command: '/amend-plan needs-route',
            href: 'plan-visibility__current.html#plan=needs-route'
          }
        ]
      },
      first_repair_path: {
        summary: 'First repair path starts with Repair Protocol Fields: needs-route.',
        ready_to_route: 0,
        blocker_total: 1,
        recommended_first_step: {
          id: 'repair-protocol',
          lane_id: 'protocol_repair_first',
          label: 'Repair Protocol Fields',
          lane_label: 'Protocol Repair First',
          task_id: 'needs-route',
          status: 'ready',
          why_first: 'Actor-continuity fields come before delegation or execution.',
          effect: 'Turns ready-looking work into routeable work with auditable handoff context.',
          command: '/amend-plan needs-route',
          href: 'plan-visibility__current.html#plan=needs-route'
        },
        steps: [
          {
            id: 'repair-protocol',
            lane_id: 'protocol_repair_first',
            label: 'Repair Protocol Fields',
            lane_label: 'Protocol Repair First',
            task_id: 'needs-route',
            status: 'ready',
            reason: 'Runnable-looking candidate, but missing routing_expectations.review_lane.',
            why_first: 'Actor-continuity fields come before delegation or execution.',
            effect: 'Turns ready-looking work into routeable work with auditable handoff context.',
            command: '/amend-plan needs-route',
            href: 'plan-visibility__current.html#plan=needs-route',
            source: '_dev/reports/analysis/task-plans/needs-route__plan.json'
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
            task_id: 'ready-plan',
            title: 'Ready Plan',
            status: 'ready',
            gate_owner: 'codex-bridge',
            gate_label: 'Codex Bridge',
            review_lane: 'codex-bridge',
            risk_tier: 'medium',
            protocol_state: 'protocol_ready',
            missing_protocol_fields: [],
            quality_flags: ['high_risk_ready'],
            reason: 'Distinct review is required before treating this ready-looking item as clear.',
            recommended_command: '/run-plan ready-plan',
            source: '_dev/reports/analysis/task-plans/ready-plan__plan.json',
            workstream_id: 'cluster-alpha',
            workstream_label: 'Ready Workstream',
            dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan'
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
          task_id: 'needs-route',
          recommended_command: '/amend-plan needs-route',
          route_owner: 'coordinator',
          dashboard_href: 'plan-visibility__current.html#plan=needs-route'
        },
        lanes: [
          {
            id: 'repair_before_dispatch',
            label: 'Repair Before Dispatch',
            purpose: 'Coordinator repairs actor-continuity, bounded-step, routing, risk, or evidence fields before delegation.',
            count: 1,
            first_task_id: 'needs-route',
            first_command: '/amend-plan needs-route',
            rows: [
              {
                task_id: 'needs-route',
                title: 'Needs Route',
                status: 'ready',
                review_lane: 'not-recorded',
                risk_tier: 'not-recorded',
                protocol_state: 'needs_protocol_repair',
                missing_protocol_fields: ['routing_expectations.review_lane'],
                route_owner: 'coordinator',
                actor_route: 'Coordinator repairs the plan before any worker or reviewer actor receives it.',
                reason: 'Missing protocol fields: routing_expectations.review_lane.',
                recommended_command: '/amend-plan needs-route',
                dashboard_href: 'plan-visibility__current.html#plan=needs-route',
                source: '_dev/reports/analysis/task-plans/needs-route__plan.json',
                workstream_id: 'none',
                workstream_label: 'not linked'
              }
            ]
          },
          {
            id: 'codex_bridge',
            label: 'Codex Bridge',
            purpose: 'A distinct review actor should cross-check assumptions, code, or consequential output before acceptance.',
            count: 1,
            first_task_id: 'ready-plan',
            first_command: '/review-task-plan ready-plan',
            rows: [
              {
                task_id: 'ready-plan',
                title: 'Ready Plan',
                status: 'ready',
                review_lane: 'codex-bridge',
                risk_tier: 'medium',
                protocol_state: 'protocol_ready',
                missing_protocol_fields: [],
                route_owner: 'distinct review actor',
                actor_route: 'Dispatch a distinct Codex bridge/reviewer actor for cross-checking before acceptance.',
                reason: 'Plan declares codex-bridge review lane.',
                recommended_command: '/review-task-plan ready-plan',
                dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan',
                source: '_dev/reports/analysis/task-plans/ready-plan__plan.json',
                workstream_id: 'cluster-alpha',
                workstream_label: 'Ready Workstream'
              }
            ]
          }
        ]
      },
      command_runbook: {
        summary: '2 current command suggestions grouped into 2 command verbs; 2 rows are shown.',
        total_commands: 2,
        shown_commands: 2,
        first_command: {
          task_id: 'needs-route',
          command: '/amend-plan needs-route',
          verb: '/amend-plan',
          purpose: 'First repair path',
          source_surface: 'first_repair_path',
          gate_or_lane: 'Protocol Repair First',
          reason: 'Actor-continuity fields come before delegation or execution.',
          dashboard_href: 'plan-visibility__current.html#plan=needs-route',
          source: '_dev/reports/analysis/task-plans/needs-route__plan.json'
        },
        groups: [
          {
            verb: '/amend-plan',
            purpose: 'Repair plan metadata before routing.',
            count: 1,
            rows: [
              {
                task_id: 'needs-route',
                command: '/amend-plan needs-route',
                verb: '/amend-plan',
                purpose: 'First repair path',
                source_surface: 'first_repair_path',
                gate_or_lane: 'Protocol Repair First',
                reason: 'Actor-continuity fields come before delegation or execution.',
                dashboard_href: 'plan-visibility__current.html#plan=needs-route',
                source: '_dev/reports/analysis/task-plans/needs-route__plan.json'
              }
            ]
          },
          {
            verb: '/run-plan',
            purpose: 'Route an approved plan through execution.',
            count: 1,
            rows: [
              {
                task_id: 'ready-plan',
                command: '/run-plan ready-plan',
                verb: '/run-plan',
                purpose: 'Codex Bridge gate',
                source_surface: 'risk_gate_queue',
                gate_or_lane: 'Codex Bridge',
                reason: 'Distinct review is required before treating this ready-looking item as clear.',
                dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan',
                source: '_dev/reports/analysis/task-plans/ready-plan__plan.json'
              }
            ]
          }
        ]
      },
      visual_flowcharts: {
        summary: '2 generated Markdown artifacts contain Mermaid flowcharts.',
        items: [
          {
            id: 'system-overview',
            kind: 'overview',
            label: 'System overview flowcharts',
            path: 'plan-visibility__current.md',
            dashboard_href: 'plan-visibility__current.html',
            command: 'npm run plans:dashboard',
            mermaid_blocks: ['status_flow', 'review_lanes', 'plan_interconnections'],
            description: 'Status, review-lane, and inter-plan Mermaid diagrams for the current system scope.'
          }
        ]
      },
      visual_coverage: {
        total_workstreams: 2,
        generated_briefs: 1,
        missing_briefs: 1,
        coverage_percent: 50,
        summary: '1 of 2 workstreams have generated visual briefs; 1 remain queued.',
        queue: [
          {
            cluster_id: 'cluster-beta',
            label: 'Missing Visual Workstream',
            plans: 2,
            relationships: 1,
            suggested_next: { task_id: 'ready-plan', status: 'ready' },
            dashboard_href: 'plan-visibility__current.html#cluster=cluster-beta&plan=ready-plan',
            command: 'npm run plans:visual -- --cluster cluster-beta --write',
            reason: '2 plans and 1 relationships do not yet have a generated visual brief.'
          }
        ]
      },
      recent_activity: {
        summary: '1 newest visible task-plan source files by filesystem modified time.',
        items: [
          {
            task_id: 'ready-plan',
            title: 'Ready Plan',
            status: 'ready',
            review_lane: 'verify-local',
            risk_tier: 'low',
            source: '_dev/reports/analysis/task-plans/ready-plan__plan.json',
            source_mtime: '2026-06-22T00:00:00.000Z',
            next_command: '/run-plan ready-plan',
            workstream_id: 'cluster-alpha',
            workstream_label: 'Ready Workstream',
            dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan'
          }
        ]
      },
      plan_progress_timeline: {
        summary: '1 most recently touched visible plans with current status, workstream, next step, and next command.',
        status_mix: { ready: 1 },
        items: [
          {
            task_id: 'ready-plan',
            title: 'Ready Plan',
            status: 'ready',
            review_lane: 'verify-local',
            risk_tier: 'low',
            source: '_dev/reports/analysis/task-plans/ready-plan__plan.json',
            modified_at: '2026-06-22T00:00:00.000Z',
            next_step: {
              step_id: 'r1',
              status: 'ready',
              description: 'Run the ready step'
            },
            next_command: '/run-plan ready-plan',
            quality_flags: [],
            workstream_id: 'cluster-alpha',
            workstream_label: 'Ready Workstream',
            dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan'
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
            source: '_dev/reports/analysis/task-plans/loose-plan__plan.json',
            next_step: { step_id: 'L1', description: 'Connect loose plan' },
            next_command: '/run-plan loose-plan',
            suggested_fix: 'Add parent_task_id or task-id mention.',
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
            task_id: 'bridge-plan',
            role: 'bridge',
            status: 'ready',
            review_lane: 'verify-local',
            risk_tier: 'low',
            total: 8,
            incoming: 3,
            outgoing: 5,
            top_intent: 'review',
            top_intent_count: 4,
            workstream_id: 'cluster-alpha',
            workstream_label: 'Ready Workstream',
            source: '_dev/reports/analysis/task-plans/bridge-plan__plan.json',
            next_command: '/review-task-plan bridge-plan',
            dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=bridge-plan',
            why_it_matters: 'Bridge plan: connects upstream and downstream context across 8 relationships; top intent review.'
          }
        ]
      },
      workstream_stories: [
        {
          cluster_id: 'cluster-alpha',
          label: 'Ready Workstream',
          plans: 3,
          relationships: 2,
          explanation: 'Ready Workstream connects 3 plans through 2 detected relationships.',
          dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan',
          brief_href: 'visual-plans/cluster-alpha.md',
          bridge_plans: [{ task_id: 'bridge-plan', role: 'bridge', total: 8 }],
          relationship_examples: [
            {
              source: 'ready-plan',
              target: 'bridge-plan',
              intent: 'sequence',
              type: 'mentions',
              evidence: 'ready-plan mentions bridge-plan'
            }
          ]
        }
      ],
      relationships: [
        {
          source: 'ready-plan',
          target: 'bridge-plan',
          type: 'mentions',
          intent: 'sequence',
          confidence: 'derived',
          confidence_reason: 'Derived from a task-id mention in the task-plan artifact; inspect evidence before treating as dependency.',
          evidence: 'ready-plan mentions bridge-plan as the next connected step.'
        },
        {
          source: 'bridge-plan',
          target: 'done-plan',
          type: 'parent_task_id',
          intent: 'hierarchy',
          confidence: 'high',
          confidence_reason: 'Declared parent metadata link.',
          evidence: 'bridge-plan declares done-plan as parent context.'
        }
      ],
      relationship_clusters: [
        {
          id: 'cluster-alpha',
          label: 'Ready Workstream',
          label_reason: 'Two plans share an execution theme.',
          size: 3,
          relationships: 2,
          statuses: { ready: 2, planned: 1 },
          next_plan: {
            task_id: 'ready-plan',
            status: 'ready',
            reason: 'ready plan in this connected workstream'
          }
        }
      ],
      workstream_matrix: [
        {
          cluster_id: 'cluster-alpha',
          top_intents: [{ label: 'sequence', count: 2 }, { label: 'review', count: 1 }]
        }
      ],
      workstream_drilldowns: {
        summary: '1 connected workstream has drilldowns; largest is Ready Workstream with 3 plans.',
        total_workstreams: 1,
        shown_workstreams: 1,
        drilldowns: [
          {
            cluster_id: 'cluster-alpha',
            label: 'Ready Workstream',
            plans: 3,
            relationships: 2,
            dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha',
            brief_href: 'visual-plans/cluster-alpha.md',
            slices: [
              {
                slice_id: 'cluster-alpha:meta-execution-normalization',
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
                  task_id: 'ready-plan',
                  status: 'ready',
                  next_command: '/run-plan ready-plan',
                  dashboard_href: 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan'
                }
              }
            ]
          }
        ]
      },
      action_paths: [
        {
          task_id: 'ready-plan',
          status: 'ready',
          review_lane: 'verify-local',
          risk_tier: 'low',
          cluster_id: 'cluster-alpha',
          cluster_label: 'Ready Workstream',
          upstream_count: 1,
          downstream_count: 1,
          upstream: [{ plan: 'bridge-plan', intent: 'dependency' }],
          downstream: [{ plan: 'done-plan', intent: 'sequence' }],
          next_step: { step_id: 'S1', description: 'Do the next visible task.' },
          next_command: '/run-plan ready-plan'
        }
      ],
      dependency_sequence_chains: [
        {
          chain_id: 'chain-1',
          summary: 'ready-plan -> bridge-plan -> done-plan',
          start_task_id: 'ready-plan',
          end_task_id: 'done-plan',
          hops: 2,
          plan_count: 3,
          intents: ['sequence', 'dependency'],
          ready_count: 1,
          dependency_count: 1,
          cluster_id: 'cluster-alpha',
          cluster_label: 'Ready Workstream',
          next_task_id: 'ready-plan',
          next_command: '/run-plan ready-plan',
          next_step: { step_id: 'S1', description: 'Run the chain starter.' },
          dashboard_href: 'plan-visibility__current.html#from=ready-plan&to=done-plan'
        }
      ],
      relationship_hubs: [
        {
          task_id: 'bridge-plan',
          role: 'bridge',
          total: 8,
          incoming: 3,
          outgoing: 5,
          top_intent: 'review'
        }
      ]
    }
  });
  assert.match(html, /Mythos Plan Visibility Dashboard/);
  assert.match(html, /Derived context only/);
  assert.match(html, /Route Map/);
  assert.match(html, /Start here/);
  assert.match(html, /Follow a workstream/);
  assert.match(html, /Share a view/);
  assert.match(html, /Make a brief/);
  assert.match(html, /Dashboard Navigator/);
  assert.match(html, /section-nav/);
  assert.match(html, /href="#operator-question-router"/);
  assert.match(html, /Operator Question Router/);
  assert.match(html, /Where should I start\?/);
  assert.match(html, /How do plans interconnect\?/);
  assert.match(html, /npm run plans:where -- --from ready-plan --to done-plan/);
  assert.match(html, /How To Read This Map/);
  assert.match(html, /Generated map/);
  assert.match(html, /source task-plan JSON\/Markdown remains authoritative/);
  assert.match(html, /Protocol Readiness/);
  assert.match(html, /Protocol-ready plans/);
  assert.match(html, /routing_expectations\.review_lane/);
  assert.match(html, /\/amend-plan needs-route/);
  assert.match(html, /href="#workstream-overview"/);
  assert.match(html, /href="#subtask-hierarchy-spotlight"/);
  assert.match(html, /parent\/child\/subtask relationships/);
  assert.match(html, /Priority Scan/);
  assert.match(html, /Suggested next in largest workstream/);
  assert.match(html, /priority-card/);
  assert.match(html, /Plan Action Board/);
  assert.match(html, /Runnable Now/);
  assert.match(html, /Open first/);
  assert.match(html, /plan-visibility__current\.html#cluster=cluster-alpha&amp;plan=ready-plan/);
  assert.match(html, /Execution Readiness/);
  assert.match(html, /Ready To Route/);
  assert.match(html, /Protocol Repair First/);
  assert.match(html, /\/amend-plan needs-route/);
  assert.match(html, /Routing Blockers/);
  assert.match(html, /Routeability/);
  assert.match(html, /No action candidates are ready to route/);
  assert.match(html, /First Repair Path/);
  assert.match(html, /Repair Protocol Fields/);
  assert.match(html, /Recommended first step/);
  assert.match(html, /Risk Gate Queue/);
  assert.match(html, /Gate summary/);
  assert.match(html, /Codex Bridge · ready-plan/);
  assert.match(html, /Orchestration Routing Board/);
  assert.match(html, /Route summary/);
  assert.match(html, /Repair Before Dispatch/);
  assert.match(html, /Command Runbook/);
  assert.match(html, /Command groups/);
  assert.match(html, /\/run-plan ready-plan/);
  assert.match(html, /Review Lane Routing/);
  assert.match(html, /Verify Local/);
  assert.match(html, /Deterministic local checks are sufficient/);
  assert.match(html, /plan-visibility__current\.html#review=verify-local/);
  assert.match(html, /Missing Review Lane/);
  assert.match(html, /plan-visibility__current\.html#quality=missing_review_lane/);
  assert.match(html, /Action Readiness Flow/);
  assert.match(html, /action-flow/);
  assert.match(html, /Visible action candidates/);
  assert.match(html, /shown across action lanes/);
  assert.match(html, /Plan Protocol Flow/);
  assert.match(html, /concept-init/);
  assert.match(html, /plan-task/);
  assert.match(html, /completion audit/);
  assert.match(html, /If evidence fails/);
  assert.match(html, /Workstream Overview/);
  assert.match(html, /Top connected workstreams/);
  assert.match(html, /workstream-overview/);
  assert.match(html, /Largest Workstream Breakdown/);
  assert.match(html, /workstream-breakdown/);
  assert.match(html, /Status mix/);
  assert.match(html, /Bridge plans/);
  assert.match(html, /Workstream Drilldowns/);
  assert.match(html, /Drilldown summary/);
  assert.match(html, /Meta Execution-normalization/);
  assert.match(html, /Interconnection Paths/);
  assert.match(html, /interconnection-paths/);
  assert.match(html, /feeds from: bridge-plan/);
  assert.match(html, /feeds into: done-plan/);
  assert.match(html, /Dependency & Sequence Chains/);
  assert.match(html, /dependency-chain/);
  assert.match(html, /ready-plan -&gt; bridge-plan -&gt; done-plan/);
  assert.match(html, /plan-visibility__current\.html#from=ready-plan&amp;to=done-plan/);
  assert.match(html, /Connection Evidence Spotlight/);
  assert.match(html, /evidence-spotlight/);
  assert.match(html, /bridge-plan -&gt; done-plan/);
  assert.match(html, /Declared parent metadata link/);
  assert.match(html, /plan-visibility__current\.html#from=bridge-plan&amp;to=done-plan/);
  assert.match(html, /Subtask Hierarchy Spotlight/);
  assert.match(html, /hierarchy-spotlight/);
  assert.match(html, /children: bridge-plan/);
  assert.match(html, /strongest confidence high/);
  assert.match(html, /plan-visibility__current\.html#plan=done-plan&amp;intent=hierarchy/);
  assert.match(html, /Workstream Connection Stories/);
  assert.match(html, /Ready Workstream connects 3 plans/);
  assert.match(html, /ready-plan -&gt; bridge-plan/);
  assert.match(html, /Bridge Plans/);
  assert.match(html, /Highly connected bridge plans/);
  assert.match(html, /bridge-overview/);
  assert.match(html, /plan-visibility__current\.html#plan=bridge-plan/);
  assert.match(html, /Impact Hubs/);
  assert.match(html, /Bridge plan: connects upstream and downstream context/);
  assert.match(html, /plan-visibility__current\.html#cluster=cluster-alpha&amp;plan=bridge-plan/);
  assert.match(html, /Relationship Types/);
  assert.match(html, /Relationship types detected in the plan map/);
  assert.match(html, /intent-overview/);
  assert.match(html, /plan-visibility__current\.html#intent=dependency/);
  assert.match(html, /Relationship Confidence/);
  assert.match(html, /Confidence labels distinguish declared metadata links/);
  assert.match(html, /declared metadata/);
  assert.match(html, /task-id mention/);
  assert.match(html, /plan-visibility__current\.html#confidence=derived/);
  assert.match(html, /Status Overview/);
  assert.match(html, /Plan status buckets/);
  assert.match(html, /status-overview/);
  assert.match(html, /plan-visibility__current\.html#status=ready/);
  assert.match(html, /Map Quality/);
  assert.match(html, /Map-quality gaps that reduce confidence/);
  assert.match(html, /quality-overview/);
  assert.match(html, /plan-visibility__current\.html#quality=unlinked/);
  assert.match(html, /Decision Guide/);
  assert.match(html, /Graph Health/);
  assert.match(html, /Map Confidence Actions/);
  assert.match(html, /Remediation Queue/);
  assert.match(html, /Visual Flowcharts/);
  assert.match(html, /System overview flowcharts/);
  assert.match(html, /Visual Coverage Queue/);
  assert.match(html, /Missing Visual Workstream/);
  assert.match(html, /npm run plans:visual -- --cluster cluster-beta --write/);
  assert.match(html, /Recent Source Activity/);
  assert.match(html, /2026-06-22T00:00:00\.000Z/);
  assert.match(html, /Plan Progress Timeline/);
  assert.match(html, /Run the ready step/);
  assert.match(html, /Unlinked Plan Triage/);
  assert.match(html, /loose-plan/);
  assert.match(html, /Add parent_task_id or task-id mention/);
  assert.match(html, /Coverage/);
  assert.match(html, /Choose a slice/);
  assert.match(html, /Open the map/);
  assert.match(html, /Open the brief/);
  assert.match(html, /Act from authority/);
  assert.match(html, /Quick Views/);
  assert.match(html, /Ready Plans/);
  assert.match(html, /Dependency Links/);
  assert.match(html, /Unlinked Plans/);
  assert.match(html, /Data Quality Gaps/);
  assert.match(html, /plan-visibility__current\.html#quality=unlinked/);
  assert.match(html, /plan-visibility__current\.html#quality=missing_review_lane/);
  assert.match(html, /Workstream Routes/);
  assert.match(html, /Ready Workstream/);
  assert.match(html, /Suggested next: ready-plan \(ready\)/);
  assert.match(html, /plan-visibility__current\.html#cluster=cluster-alpha&amp;plan=ready-plan/);
  assert.match(html, /visual-plans\/cluster-alpha\.md/);
  assert.match(html, /plan-visibility__current\.html/);
  assert.match(html, /plan-visibility__all\.html/);
  assert.match(html, /plan-visibility__operator-brief\.md/);
  assert.match(html, /plan-visibility__current\.json/);
  assert.match(html, /plan-visibility__all\.json/);
  assert.match(html, /visual-plans\/visual-plan-adapter-manifest\.json/);
  assert.match(html, /Focused Visual Briefs/);
  assert.match(html, /visual-plans\/index\.html/);
  assert.match(html, /visual-plans\/index\.md/);
  assert.match(html, /visual-plans\/plan-visibility-surface\.md/);
  assert.match(html, /visual-plans\/cluster-1\.md/);
});

test('visual flowchart inventory lists generated Mermaid artifacts and commands', () => {
  const inventory = buildVisualFlowchartInventory({
    plans: [{ task_id: 'plan-visibility-surface', title: 'Plan Visibility Surface' }],
    relationship_clusters: [
      {
        id: 'cluster-1',
        label: 'Bridge workstream',
        size: 8,
        relationships: 12,
        next_plan: { task_id: 'next-plan', status: 'ready' }
      }
    ]
  });

  assert.match(inventory.summary, /generated Markdown artifacts contain Mermaid flowcharts/);
  assert.ok(inventory.items.some((item) => item.path === 'plan-visibility__current.md' && item.mermaid_blocks.includes('plan_interconnections')));
  assert.ok(inventory.items.some((item) => item.path === 'visual-plans/cluster-1.md' && item.command === 'npm run plans:visual -- --cluster cluster-1 --write'));
});

test('plan visibility index quick views point to actionable dashboard presets', () => {
  const views = buildPlanVisibilityIndexQuickViews({
    relationship_clusters: [
      {
        id: 'cluster-alpha',
        label: 'Ready Workstream',
        size: 3,
        relationships: 2,
        next_plan: {
          task_id: 'ready-plan',
          status: 'ready',
          reason: 'ready plan in this connected workstream'
        }
      }
    ]
  });

  assert.ok(views.some((view) => view.label === 'Ready Plans' && view.href === 'plan-visibility__current.html#status=ready'));
  assert.ok(views.some((view) => view.label === 'Dependency Links' && view.href === 'plan-visibility__current.html#intent=dependency'));
  assert.ok(views.some((view) => view.label === 'Unlinked Plans' && view.href === 'plan-visibility__current.html#quality=unlinked'));
  assert.ok(views.some((view) => view.label === 'Data Quality Gaps' && view.href === 'plan-visibility__current.html#quality=missing_review_lane'));
  assert.ok(views.some((view) => view.label === 'Largest Cluster' && view.href === 'plan-visibility__current.html#cluster=cluster-alpha'));
  assert.ok(views.some((view) => view.label === 'Largest Cluster' && view.description.includes('Ready Workstream')));
  assert.ok(views.some((view) => (
    view.label === 'Suggested Next In Largest Cluster'
    && view.href === 'plan-visibility__current.html#cluster=cluster-alpha&plan=ready-plan'
  )));
});

test('operator brief summarizes quick links, workstreams, ready plans, and dependency watch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/ready-plan__plan.json'), {
    task_id: 'ready-plan',
    title: 'Ready Plan',
    scope_type: 'system',
    approval: { status: 'approved' },
    routing_expectations: { risk_tier: 'medium', review_lane: 'codex-bridge' },
    task_summary: 'Ready plan depends on dependency-plan before execution.',
    bounded_plan: { steps: [{ step_id: 'r1', status: 'ready', description: 'Run ready step' }] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/dependency-plan__plan.json'), {
    task_id: 'dependency-plan',
    title: 'Dependency Plan',
    scope_type: 'system',
    task_summary: 'dependency blocker for ready-plan',
    bounded_plan: { steps: [{ step_id: 'd1', status: 'planned', description: 'Resolve dependency' }] }
  });

  const markdown = renderPlanVisibilityOperatorBrief(root, { generatedAt: '2026-06-22T00:00:00Z' });
  assert.match(markdown, /# Mythos Plan Operator Brief/);
  assert.match(markdown, /## Decision Guide/);
  assert.match(markdown, /## Graph Health/);
  assert.match(markdown, /Map Confidence Actions/);
  assert.match(markdown, /Remediation Queue/);
  assert.match(markdown, /Unlinked Plan Triage/);
  assert.match(markdown, /Open plans with no detected relationships|Add or verify parent_task_id/);
  assert.match(markdown, /Link density/);
  assert.match(markdown, /Choose a slice/);
  assert.match(markdown, /Open the map/);
  assert.match(markdown, /Open the brief/);
  assert.match(markdown, /Act from authority/);
  assert.match(markdown, /## Quick Links/);
  assert.match(markdown, /Ready Plans/);
  assert.match(markdown, /Dependency Links/);
  assert.match(markdown, /Unlinked Plans/);
  assert.match(markdown, /Data Quality Gaps/);
  assert.match(markdown, /## Data Quality/);
  assert.match(markdown, /missing_review_lane/);
  assert.match(markdown, /## Suggested Workstreams/);
  assert.match(markdown, /Workstream/);
  assert.match(markdown, /Why named this way/);
  assert.match(markdown, /Brief/);
  assert.match(markdown, /visual-plans\/cluster-1\.md/);
  assert.match(markdown, /## Workstream Matrix/);
  assert.match(markdown, /Top intents/);
  assert.match(markdown, /## Connection Hubs/);
  assert.match(markdown, /## Impact Hubs/);
  assert.match(markdown, /## Action Paths/);
  assert.match(markdown, /driver|convergence|bridge/);
  assert.match(markdown, /Plan Progress Timeline/);
  assert.match(markdown, /Plan Action Board/);
  assert.match(markdown, /Runnable Now|Dependency Watch|Map Repairs|Impact Review/);
  assert.match(markdown, /ready-plan/);
  assert.match(markdown, /Run ready step/);
  assert.match(markdown, /## Dependency Watch/);
  assert.match(markdown, /incoming dependency relationship/);
  assert.match(markdown, /plan-visibility__current\.html/);
});

test('focused visual plan export renders a portable single-plan brief', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/source-plan__plan.json'), {
    task_id: 'source-plan',
    title: 'Source Plan',
    scope_type: 'system',
    task_summary: 'This plan should feed target-plan before execution.',
    bounded_plan: { steps: [{ step_id: 'source-step', status: 'ready', description: 'Prepare source output' }] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/target-plan__plan.json'), {
    task_id: 'target-plan',
    title: 'Target Plan',
    scope_type: 'system',
    bounded_plan: { steps: [{ step_id: 'target-step', status: 'planned', description: 'Use source output' }] }
  });

  const markdown = renderFocusedVisualPlanMarkdown(root, {
    taskId: 'source-plan',
    generatedAt: '2026-06-22T00:00:00Z'
  });

  assert.match(markdown, /# Visual Plan: source-plan/);
  assert.match(markdown, /subject_type: plan/);
  assert.match(markdown, /```mermaid/);
  assert.match(markdown, /source-plan/);
  assert.match(markdown, /target-plan/);
  assert.match(markdown, /## Connection Hubs/);
  assert.match(markdown, /## Action Paths/);
  assert.match(markdown, /Feeds from/);
  assert.match(markdown, /Feeds into/);
  assert.match(markdown, /Selected Plan Relationship Direction/);
  assert.match(markdown, /incoming: 0/);
  assert.match(markdown, /outgoing: 1/);
  assert.match(markdown, /\[source\]\(_dev\/reports\/analysis\/task-plans\/source-plan__plan\.json\)/);
});

test('focused visual plan export renders a relationship cluster brief', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/alpha__plan.json'), {
    task_id: 'alpha',
    title: 'Alpha',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/beta__plan.json'), {
    task_id: 'beta',
    title: 'Beta',
    scope_type: 'system',
    parent_task_id: 'alpha',
    bounded_plan: { steps: [{ step_id: 'b1', status: 'ready', description: 'Run beta' }] }
  });

  const model = buildPlanVisibilityModel(root, { generatedAt: '2026-06-22T00:00:00Z' });
  assert.equal(model.relationship_clusters[0].next_plan.task_id, 'beta');
  assert.equal(model.relationship_clusters[0].next_plan.status, 'ready');
  assert.equal(model.relationship_clusters[0].label, 'beta workstream');
  assert.match(model.relationship_clusters[0].label_reason, /suggested next plan/);

  const markdown = renderFocusedVisualPlanMarkdown(root, {
    clusterId: 'cluster-1',
    generatedAt: '2026-06-22T00:00:00Z'
  });

  assert.match(markdown, /# Visual Plan: cluster-1/);
  assert.match(markdown, /subject_type: cluster/);
  assert.match(markdown, /beta workstream \(cluster-1\)/);
  assert.match(markdown, /alpha/);
  assert.match(markdown, /beta/);
  assert.match(markdown, /suggested next plan beta \(ready\)/);
  assert.match(markdown, /## Connection Hubs/);
  assert.match(markdown, /## Action Paths/);
  assert.match(markdown, /Feeds from/);
  assert.match(markdown, /Feeds into/);
  assert.match(markdown, /parent/);
  assert.doesNotMatch(markdown, /Selected Plan Relationship Direction/);
});

test('visual plan library index lists included briefs and generation commands', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/plan-visibility-surface__plan.json'), {
    task_id: 'plan-visibility-surface',
    title: 'Plan Visibility Surface',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/alpha__plan.json'), {
    task_id: 'alpha',
    title: 'Alpha',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/beta__plan.json'), {
    task_id: 'beta',
    title: 'Beta',
    scope_type: 'system',
    parent_task_id: 'alpha',
    bounded_plan: { steps: [{ step_id: 'b1', status: 'ready', description: 'Run beta' }] }
  });

  const markdown = renderVisualPlanLibraryMarkdown(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    clusterLimit: 3
  });
  const html = renderVisualPlanLibraryHtml(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    clusterLimit: 3
  });

  assert.match(markdown, /# Mythos Focused Visual Brief Library/);
  assert.match(markdown, /plan-visibility-surface/);
  assert.match(markdown, /\[open\]\(plan-visibility-surface\.md\)/);
  assert.match(markdown, /cluster-1/);
  assert.match(markdown, /\[open\]\(cluster-1\.md\)/);
  assert.match(markdown, /beta \(ready\): ready plan in this connected workstream/);
  assert.match(markdown, /npm run plans:visual -- --plan <task-id> --write/);
  assert.match(markdown, /npm run plans:visual -- --cluster <cluster-id> --write/);
  assert.match(html, /Mythos Visual Brief Library/);
  assert.match(html, /visual-library-data/);
  assert.match(html, /Search workstreams, plans, frameworks, next commands/);
  assert.match(html, /All primary statuses/);
  assert.match(html, /All top frameworks/);
  assert.match(html, /cluster-1\.md/);
  assert.match(html, /\.\.\/plan-visibility__current\.html#cluster=/);
  assert.match(html, /Visible briefs/);
  assert.match(html, /render\(\)/);
});

function parseVisualLibraryRows(html) {
  const match = html.match(/<script id="visual-library-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'visual-library-data embedded JSON should be present');
  return JSON.parse(match[1].replace(/\\u003c/g, '<')).rows;
}

test('visual plan library row view_href resolves to a readable <id>.plan.html document', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/alpha__plan.json'), {
    task_id: 'alpha',
    title: 'Alpha',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/beta__plan.json'), {
    task_id: 'beta',
    title: 'Beta',
    scope_type: 'system',
    parent_task_id: 'alpha',
    bounded_plan: { steps: [{ step_id: 'b1', status: 'ready', description: 'Run beta' }] }
  });

  const html = renderVisualPlanLibraryHtml(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    clusterLimit: 3
  });
  const rows = parseVisualLibraryRows(html);
  assert.ok(rows.length >= 1, 'at least one cluster row');
  const row = rows[0];

  // View link points at the browser-viewable readable document, not a draw.io file.
  assert.equal(typeof row.view_href, 'string');
  assert.match(row.view_href, /\.plan\.html$/);
  assert.doesNotMatch(row.view_href, /\.drawio$/);
  // The dashboard generated the readable doc on disk so the View link is not dangling.
  const expectedDoc = path.join(root, '_dev/reports/analysis/visual-plans', `${decodeURIComponent(row.view_href)}`);
  assert.ok(fs.existsSync(expectedDoc), 'readable plan document should exist on disk');

  // The View anchor is rendered (client-side) from the readable doc href, and the
  // table never offers a cluster-scoped drawio link.
  assert.match(html, /row\.view_href \? '<a href="' \+ esc\(row\.view_href\) \+ '">View<\/a>'/);
  assert.doesNotMatch(html, /cluster-\d+\.drawio/);
});

test('visual plan library row links existing steps and plandoc sibling views', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  const visualRoot = path.join(root, '_dev/reports/analysis/visual-plans');
  fs.mkdirSync(visualRoot, { recursive: true });
  fs.writeFileSync(path.join(visualRoot, 'alpha.steps.html'), '<!doctype html><title>alpha steps</title>');
  fs.writeFileSync(path.join(visualRoot, 'alpha.plandoc.html'), '<!doctype html><title>alpha plandoc</title>');
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/alpha__plan.json'), {
    task_id: 'alpha',
    title: 'Alpha',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });

  const html = renderVisualPlanLibraryHtml(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    model: {
      scope: 'system',
      relationship_clusters: [{
        id: 'cluster-alpha',
        label: 'Alpha Cluster',
        label_reason: 'test fixture',
        size: 1,
        relationships: 0,
        statuses: { ready: 1 },
        top_framework: { label: 'none' },
        next_plan: { task_id: 'alpha', status: 'ready', reason: 'fixture', next_command: '/run-plan alpha' },
        sample_plans: ['alpha']
      }]
    }
  });
  const rows = parseVisualLibraryRows(html);
  assert.equal(rows[0].steps_href, 'alpha.steps.html');
  assert.equal(rows[0].plandoc_href, 'alpha.plandoc.html');
  assert.match(html, /row\.steps_href \? '<a href="' \+ esc\(row\.steps_href\) \+ '">Steps<\/a>'/);
  assert.match(html, /row\.plandoc_href \? '<a href="' \+ esc\(row\.plandoc_href\) \+ '">Layman<\/a>'/);
});

test('readable plan document opens with a plain what-this-is sentence for client plans', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, 'clients/ABC/plans/client-demo__plan.json'), {
    task_id: 'client-demo',
    title: 'Client Demo Launch',
    scope_type: 'client',
    client_code: 'ABC',
    routing_expectations: { risk_tier: 'medium', review_lane: 'codex-bridge' },
    task_summary: 'Launch a client-facing update with review before publication.',
    bounded_plan: {
      steps: [
        { step_id: 'S1', status: 'complete', description: 'Prepare draft.' },
        { step_id: 'S2', status: 'ready', description: 'Review and publish the client update.' }
      ]
    }
  });

  const markdown = renderPlanDocumentMarkdown(root, {
    taskId: 'client-demo',
    generatedAt: '2026-06-24T00:00:00Z',
    selfContainmentLint: false
  });

  assert.match(markdown, /^# Client Demo Launch\n\n## Context\n\n\*\*What this is:\*\*/);
  assert.match(markdown, /This is a client \(ABC\) plan for Client Demo Launch; it is currently ready, review runs through codex-bridge, and the next action is S2: Review and publish the client update\./);
});

test('readable plan document lead truncates long next-step prose', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, 'clients/ABC/plans/client-long__plan.json'), {
    task_id: 'client-long',
    title: 'Client Long Plan',
    scope_type: 'client',
    client_code: 'ABC',
    routing_expectations: { review_lane: 'operator-gate' },
    bounded_plan: {
      steps: [
        {
          step_id: 'S1',
          status: 'ready',
          description: 'Review the client-facing update before publication. Provenance: this deliberately long note should remain in the step body rather than taking over the first sentence of the readable plan document.'
        }
      ]
    }
  });

  const markdown = renderPlanDocumentMarkdown(root, {
    taskId: 'client-long',
    generatedAt: '2026-06-24T00:00:00Z',
    selfContainmentLint: false
  });

  const lead = markdown.match(/\*\*What this is:\*\* ([^\n]+)/)[1];
  assert.match(lead, /next action is S1: Review the client-facing update before publication\./);
  assert.doesNotMatch(lead, /Provenance/);
});

test('visual plan library drawio_href appears only when a real per-plan .drawio exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/alpha__plan.json'), {
    task_id: 'alpha',
    title: 'Alpha',
    scope_type: 'system',
    bounded_plan: { steps: [] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/beta__plan.json'), {
    task_id: 'beta',
    title: 'Beta',
    scope_type: 'system',
    parent_task_id: 'alpha',
    bounded_plan: { steps: [{ step_id: 'b1', status: 'ready', description: 'Run beta' }] }
  });

  // No per-plan .drawio on disk yet -> no Edit (draw.io) link.
  const withoutDrawio = parseVisualLibraryRows(renderVisualPlanLibraryHtml(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    clusterLimit: 3
  }));
  const representative = withoutDrawio[0].representative_plan;
  assert.ok(representative, 'cluster has a representative plan');
  assert.equal(withoutDrawio[0].drawio_href, null);

  // Create the real per-plan <id>.drawio file -> Edit link now resolves to it.
  const drawioPath = path.join(root, '_dev/reports/analysis/visual-plans', `${representative}.drawio`);
  fs.mkdirSync(path.dirname(drawioPath), { recursive: true });
  fs.writeFileSync(drawioPath, '<mxfile></mxfile>');
  const withDrawioHtml = renderVisualPlanLibraryHtml(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    clusterLimit: 3
  });
  const withDrawio = parseVisualLibraryRows(withDrawioHtml);
  assert.equal(withDrawio[0].drawio_href, `${encodeURIComponent(representative)}.drawio`);
  assert.match(withDrawio[0].drawio_href, /\.drawio$/);
  assert.match(withDrawioHtml, /Edit \(draw\.io\)/);
  // Still no cluster-scoped drawio view link.
  assert.doesNotMatch(withDrawioHtml, /cluster-\d+\.drawio/);
});

test('visual plan adapter manifest points external visual tools back to Mythos authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-visibility-'));
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/plan-visibility-surface__plan.json'), {
    task_id: 'plan-visibility-surface',
    title: 'Plan Visibility Surface',
    scope_type: 'system',
    routing_expectations: { risk_tier: 'low', review_lane: 'verify-local' },
    task_summary: 'Relationship with beta.',
    bounded_plan: { steps: [{ step_id: 'pv1', status: 'complete', description: 'Build dashboard' }] }
  });
  writeJson(path.join(root, '_dev/reports/analysis/task-plans/beta__plan.json'), {
    task_id: 'beta',
    title: 'Beta',
    scope_type: 'system',
    parent_task_id: 'plan-visibility-surface',
    bounded_plan: { steps: [{ step_id: 'b1', status: 'ready', description: 'Run beta' }] }
  });

  const manifest = buildVisualPlanAdapterManifest(root, {
    generatedAt: '2026-06-22T00:00:00Z',
    clusterLimit: 2
  });

  assert.equal(manifest.schema_version, 'mythos.plan-visibility.visual-adapter.v1');
  assert.equal(manifest.intended_adapter.reference, 'BuilderIO/skills /visual-plan');
  assert.equal(manifest.authority.status, 'derived_context_only');
  assert.equal(manifest.dashboard.current_system_map, 'plan-visibility__current.html');
  assert.equal(manifest.commands.locate_plan, 'npm run plans:where -- --plan <task-id>');
  assert.equal(manifest.graph_health.coverage_percent, 100);
  assert.equal(manifest.graph_health.links_per_plan, 1);
  assert.equal(manifest.counts.visual_flowchart_artifacts, 3);
  assert.ok(manifest.graph_health.recommendations.some((item) => item.signal === 'missing_review_lane'));
  assert.ok(manifest.graph_health.recommendations.every((item) => item.dashboard_href.startsWith('plan-visibility__current.html#quality=')));
  assert.ok(manifest.remediation_queue.some((item) => item.task_id === 'beta' && item.signal === 'missing_review_lane'));
  assert.ok(manifest.visual_flowcharts.items.some((item) => item.id === 'system-overview'));
  assert.ok(manifest.briefs.some((brief) => brief.kind === 'plan' && brief.id === 'plan-visibility-surface'));
  assert.ok(manifest.briefs.some((brief) => brief.kind === 'relationship_cluster' && brief.id === 'cluster-1'));
  const planBrief = manifest.briefs.find((brief) => brief.kind === 'plan');
  assert.equal(planBrief.markdown_path, 'visual-plans/plan-visibility-surface.md');
  assert.match(planBrief.dashboard_href, /plan-visibility__current\.html#cluster=cluster-1&plan=plan-visibility-surface/);
  assert.equal(planBrief.relationships.outgoing, 1);
});
