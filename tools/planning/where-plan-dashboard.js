#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPORT_ROOT = path.join('_dev', 'reports', 'analysis');
const FILES = {
  index: path.join(REPORT_ROOT, 'plan-visibility__index.html'),
  systemMap: path.join(REPORT_ROOT, 'plan-visibility__current.html'),
  allMap: path.join(REPORT_ROOT, 'plan-visibility__all.html'),
  operatorBrief: path.join(REPORT_ROOT, 'plan-visibility__operator-brief.md'),
  visualLibrary: path.join(REPORT_ROOT, 'visual-plans', 'index.html'),
  visualLibraryMarkdown: path.join(REPORT_ROOT, 'visual-plans', 'index.md'),
  adapterManifest: path.join(REPORT_ROOT, 'visual-plans', 'visual-plan-adapter-manifest.json'),
  harnessCapabilityDashboard: path.join(REPORT_ROOT, 'harness-capability-dashboard.html'),
  harnessCapabilityDashboardModel: path.join(REPORT_ROOT, 'harness-capability-dashboard.json'),
  systemModel: path.join(REPORT_ROOT, 'plan-visibility__current.json'),
  allModel: path.join(REPORT_ROOT, 'plan-visibility__all.json'),
  smokeScreenshot: path.join(REPORT_ROOT, 'plan-visibility__current-smoke.png')
};

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const summary = buildSummary(projectRoot, {
    planId: parsed.planId,
    workstreamId: parsed.workstreamId,
    pathFrom: parsed.pathFrom,
    pathTo: parsed.pathTo
  });

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderText(summary));
}

function parseArgs(argv) {
  const parsed = { json: false, planId: null, workstreamId: null, pathFrom: null, pathTo: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--plan') {
      parsed.planId = argv[index + 1] || null;
      index += 1;
    } else if (arg.startsWith('--plan=')) {
      parsed.planId = arg.slice('--plan='.length);
    } else if (arg === '--workstream' || arg === '--cluster') {
      parsed.workstreamId = argv[index + 1] || null;
      index += 1;
    } else if (arg.startsWith('--workstream=')) {
      parsed.workstreamId = arg.slice('--workstream='.length);
    } else if (arg.startsWith('--cluster=')) {
      parsed.workstreamId = arg.slice('--cluster='.length);
    } else if (arg === '--from') {
      parsed.pathFrom = argv[index + 1] || null;
      index += 1;
    } else if (arg.startsWith('--from=')) {
      parsed.pathFrom = arg.slice('--from='.length);
    } else if (arg === '--to') {
      parsed.pathTo = argv[index + 1] || null;
      index += 1;
    } else if (arg.startsWith('--to=')) {
      parsed.pathTo = arg.slice('--to='.length);
    }
  }
  return parsed;
}

function buildSummary(projectRoot, options = {}) {
  const files = Object.fromEntries(Object.entries(FILES).map(([key, relativePath]) => {
    const absolutePath = path.join(projectRoot, relativePath);
    const exists = fs.existsSync(absolutePath);
    return [key, {
      path: relativePath,
      exists,
      mtime: exists ? fs.statSync(absolutePath).mtime.toISOString() : null
    }];
  }));

  const model = readJsonIfExists(path.join(projectRoot, FILES.systemModel));
  const freshness = buildFreshnessSummary(projectRoot, files.systemModel, model);
  const topWorkstreams = Array.isArray(model?.workstream_matrix)
    ? model.workstream_matrix.slice(0, 8).map((row) => ({
      cluster_id: row.cluster_id,
      label: row.label,
      plans: row.plans,
      relationships: row.relationships,
      suggested_next: row.suggested_next?.task_id || 'none',
      map: row.map_href || `${path.basename(FILES.systemMap)}#cluster=${encodeURIComponent(row.cluster_id)}`,
      brief: row.brief_href || `visual-plans/${encodeURIComponent(row.cluster_id)}.md`
    }))
    : [];
  const selectedPlan = options.planId && model
    ? buildSelectedPlanSummary(projectRoot, model, options.planId)
    : null;
  const selectedWorkstream = options.workstreamId && model
    ? buildSelectedWorkstreamSummary(projectRoot, model, options.workstreamId)
    : null;
  const connectionPath = (options.pathFrom || options.pathTo) && model
    ? buildConnectionPathSummary(model, options.pathFrom, options.pathTo)
    : null;

  return {
    generated: files.systemModel.exists,
    files,
    freshness,
    counts: model ? {
      plans: Array.isArray(model.plans) ? model.plans.length : 0,
      relationships: Array.isArray(model.relationships) ? model.relationships.length : 0,
      workstreams: Array.isArray(model.relationship_clusters) ? model.relationship_clusters.length : 0,
      matrix_rows: Array.isArray(model.workstream_matrix) ? model.workstream_matrix.length : 0,
      unlinked: model.data_quality?.unlinked?.count ?? 0,
      missing_review_lane: model.data_quality?.missing_review_lane?.count ?? 0
    } : null,
    graph_health: model?.graph_health || null,
    map_reading_guide: model?.map_reading_guide || null,
    protocol_readiness: model?.protocol_readiness || null,
    review_lane_routing: model ? buildReviewLaneRoutingSummary(model.groupings?.review_lane || {}) : null,
    operator_question_routes: Array.isArray(model?.operator_question_routes) ? model.operator_question_routes.slice(0, 8) : [],
    dependency_sequence_chains: Array.isArray(model?.dependency_sequence_chains) ? model.dependency_sequence_chains.slice(0, 8) : [],
    workstream_drilldowns: model?.workstream_drilldowns || null,
    remediation_queue: Array.isArray(model?.remediation_queue) ? model.remediation_queue.slice(0, 8) : [],
    unlinked_plan_triage: model?.unlinked_plan_triage || null,
    impact_hubs: model?.impact_hubs || null,
    plan_action_board: model?.plan_action_board || null,
    execution_readiness: model?.execution_readiness || null,
    routing_blockers: model?.routing_blockers || null,
    first_repair_path: model?.first_repair_path || null,
    risk_gate_queue: model?.risk_gate_queue || null,
    orchestration_routing_board: model?.orchestration_routing_board || null,
    command_runbook: model?.command_runbook || null,
    priority_scan: Array.isArray(model?.priority_scan) ? model.priority_scan.slice(0, 6) : [],
    recent_activity: model?.recent_activity || null,
    plan_progress_timeline: model?.plan_progress_timeline || null,
    visual_flowcharts: model?.visual_flowcharts || null,
    quick_views: [
      { label: 'Start here', path: FILES.index },
      { label: 'System map', path: FILES.systemMap },
      { label: 'Operator brief', path: FILES.operatorBrief },
      { label: 'Visual brief library', path: FILES.visualLibrary },
      { label: 'Visual brief library Markdown', path: FILES.visualLibraryMarkdown },
      { label: 'Visual-plan adapter manifest', path: FILES.adapterManifest },
      { label: 'Harness capability dashboard', path: FILES.harnessCapabilityDashboard },
      { label: 'Harness capability dashboard model', path: FILES.harnessCapabilityDashboardModel },
      { label: 'Unlinked plans', path: `${FILES.systemMap}#quality=unlinked` },
      { label: 'Data quality gaps', path: `${FILES.systemMap}#quality=missing_review_lane` }
    ],
    selected_plan: selectedPlan,
    selected_workstream: selectedWorkstream,
    connection_path: connectionPath,
    top_workstreams: topWorkstreams,
    commands: {
      regenerate: 'npm run plans:dashboard',
      smoke: 'npm run plans:dashboard:smoke',
      json: 'npm run plans:where -- --json',
      locate_plan: 'npm run plans:where -- --plan <task-id>',
      locate_workstream: 'npm run plans:where -- --workstream <cluster-id>',
      locate_path: 'npm run plans:where -- --from <task-id> --to <task-id>'
    }
  };
}

function buildReviewLaneRoutingSummary(grouping) {
  const lanes = Object.entries(grouping || {})
    .map(([label, count]) => ({ lane: label || 'not-recorded', count: Number(count) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => reviewLanePriority(a.lane) - reviewLanePriority(b.lane) || b.count - a.count || a.lane.localeCompare(b.lane))
    .map((entry) => ({
      lane: entry.lane,
      label: reviewLaneLabel(entry.lane),
      count: entry.count,
      purpose: reviewLanePurpose(entry.lane),
      dashboard_href: reviewLaneHref(entry.lane)
    }));
  return {
    summary: lanes.length
      ? `${lanes.length} review-lane routes are visible in the current model.`
      : 'No review-lane routes are visible in the current model.',
    lanes
  };
}

function reviewLanePriority(label) {
  const normalized = String(label || 'not-recorded');
  const priorities = {
    'operator-gate': 1,
    'codex-bridge': 2,
    'verify-local': 3,
    'not-recorded': 4,
    unknown: 5
  };
  return priorities[normalized] || 10;
}

function reviewLaneLabel(label) {
  const normalized = String(label || 'not-recorded');
  if (normalized === 'operator-gate') return 'Operator Gate';
  if (normalized === 'codex-bridge') return 'Codex Bridge';
  if (normalized === 'verify-local') return 'Verify Local';
  if (normalized === 'not-recorded' || normalized === 'unknown') return 'Missing Review Lane';
  return normalized.replace(/_/g, ' ');
}

function reviewLanePurpose(label) {
  const normalized = String(label || 'not-recorded');
  if (normalized === 'operator-gate') return 'Human operator judgment, approval, or external authority is required before clearing.';
  if (normalized === 'codex-bridge') return 'Distinct review lane for consequential assumptions, code review, or cross-checking.';
  if (normalized === 'verify-local') return 'Deterministic local checks are sufficient for this bounded slice.';
  if (normalized === 'not-recorded' || normalized === 'unknown') return 'Routing metadata is missing; repair before treating the plan as execution-ready.';
  return 'Review lane recorded by the source task plan.';
}

function reviewLaneHref(label) {
  const normalized = String(label || 'not-recorded');
  if (normalized === 'not-recorded' || normalized === 'unknown') return `${FILES.systemMap}#quality=missing_review_lane`;
  return `${FILES.systemMap}#review=${encodeURIComponent(normalized)}`;
}

function buildConnectionPathSummary(model, fromId, toId) {
  if (!fromId || !toId) {
    return {
      found: false,
      from: fromId || null,
      to: toId || null,
      message: 'Pass both --from <task-id> and --to <task-id> to locate a connection path.'
    };
  }

  const byId = new Map((model.plans || []).map((plan) => [plan.task_id, plan]));
  if (!byId.has(fromId) || !byId.has(toId)) {
    return {
      found: false,
      from: fromId,
      to: toId,
      message: `Cannot locate path because ${!byId.has(fromId) ? fromId : toId} is not visible in the current model.`
    };
  }

  if (fromId === toId) {
    return {
      found: true,
      from: fromId,
      to: toId,
      hops: 0,
      plans: [summarizePlanForLocator(byId.get(fromId))],
      relationships: [],
      map: `${FILES.systemMap}#plan=${encodeURIComponent(fromId)}`,
      message: 'Source and target are the same visible plan.'
    };
  }

  const adjacency = buildUndirectedRelationshipAdjacency(model.relationships || [], byId);
  const queue = [{ id: fromId, path: [] }];
  const seen = new Set([fromId]);
  const maxDepth = 6;

  while (queue.length) {
    const current = queue.shift();
    if (current.path.length >= maxDepth) continue;
    for (const edge of adjacency.get(current.id) || []) {
      if (seen.has(edge.next)) continue;
      const nextPath = [...current.path, edge];
      if (edge.next === toId) {
        const planIds = [fromId, ...nextPath.map((item) => item.next)];
        return {
          found: true,
          from: fromId,
          to: toId,
          hops: nextPath.length,
          plans: planIds.map((id) => summarizePlanForLocator(byId.get(id))),
          relationships: nextPath.map((item) => ({
            from: item.from,
            to: item.next,
            traversed: item.traversed,
            source: item.relationship.source,
            target: item.relationship.target,
            type: item.relationship.type,
            intent: item.relationship.intent,
            confidence: item.relationship.confidence,
            confidence_reason: item.relationship.confidence_reason,
            evidence: item.relationship.evidence
          })),
          map: `${FILES.systemMap}#plan=${encodeURIComponent(fromId)}`,
          message: `Found ${nextPath.length}-hop connection path.`
        };
      }
      seen.add(edge.next);
      queue.push({ id: edge.next, path: nextPath });
    }
  }

  return {
    found: false,
    from: fromId,
    to: toId,
    message: `No connection path found within ${maxDepth} hops.`
  };
}

function buildUndirectedRelationshipAdjacency(relationships, byId) {
  const adjacency = new Map([...byId.keys()].map((id) => [id, []]));
  for (const relationship of relationships) {
    if (!byId.has(relationship.source) || !byId.has(relationship.target)) continue;
    adjacency.get(relationship.source).push({
      from: relationship.source,
      next: relationship.target,
      traversed: 'forward',
      relationship
    });
    adjacency.get(relationship.target).push({
      from: relationship.target,
      next: relationship.source,
      traversed: 'reverse',
      relationship
    });
  }
  for (const edges of adjacency.values()) {
    edges.sort((a, b) => intentPriority(a.relationship.intent) - intentPriority(b.relationship.intent) || a.next.localeCompare(b.next));
  }
  return adjacency;
}

function buildSelectedWorkstreamSummary(projectRoot, model, workstreamId) {
  const cluster = (model.relationship_clusters || []).find((item) => item.id === workstreamId);
  if (!cluster) {
    return {
      found: false,
      cluster_id: workstreamId,
      message: `No visible workstream found for ${workstreamId}.`
    };
  }

  const planIds = new Set(cluster.plan_ids || []);
  const plans = (model.plans || [])
    .filter((plan) => planIds.has(plan.task_id))
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
  const relationships = (model.relationships || []).filter((relationship) => (
    planIds.has(relationship.source)
    && planIds.has(relationship.target)
  ));
  const briefPath = path.join(REPORT_ROOT, 'visual-plans', `${cluster.id}.md`);
  const briefExists = fs.existsSync(path.join(projectRoot, briefPath));
  const next = cluster.next_plan || {};
  const story = (model.workstream_stories || []).find((item) => item.cluster_id === cluster.id) || null;

  return {
    found: true,
    cluster_id: cluster.id,
    label: cluster.label,
    label_reason: cluster.label_reason,
    plans: cluster.size,
    relationships: cluster.relationships,
    map: `${FILES.systemMap}#cluster=${encodeURIComponent(cluster.id)}${next.task_id && next.task_id !== 'none' ? `&plan=${encodeURIComponent(next.task_id)}` : ''}`,
    brief: briefPath,
    brief_exists: briefExists,
    brief_command: `npm run plans:visual -- --cluster ${cluster.id} --write`,
    suggested_next: {
      task_id: next.task_id || 'none',
      status: next.status || 'not-recorded',
      reason: next.reason || 'No suggested-next reason recorded.',
      next_step: next.next_step || 'none',
      next_command: next.next_command || 'none'
    },
    status_mix: topEntries(cluster.statuses || {}, 6),
    top_intents: topEntries(countRelationshipsBy(relationships, 'intent'), 6),
    top_sources: topEntries(countRelationshipsBy(relationships, 'type'), 6),
    story,
    sample_plans: plans.slice(0, 12).map((plan) => ({
      task_id: plan.task_id,
      status: plan.status,
      review_lane: plan.review_lane,
      risk_tier: plan.risk_tier,
      next_command: plan.next_command,
      source: plan.path
    }))
  };
}

function buildSelectedPlanSummary(projectRoot, model, planId) {
  const plan = (model.plans || []).find((item) => item.task_id === planId);
  if (!plan) {
    return {
      found: false,
      task_id: planId,
      message: `No visible plan found for ${planId}.`
    };
  }

  const cluster = (model.relationship_clusters || []).find((item) => (item.plan_ids || []).includes(planId));
  const incoming = (model.relationships || []).filter((relationship) => relationship.target === planId);
  const outgoing = (model.relationships || []).filter((relationship) => relationship.source === planId);
  const byId = new Map((model.plans || []).map((item) => [item.task_id, item]));
  const mapHash = cluster
    ? `#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(planId)}`
    : `#plan=${encodeURIComponent(planId)}`;

  const briefPath = cluster ? path.join(REPORT_ROOT, 'visual-plans', `${cluster.id}.md`) : null;
  const briefExists = briefPath ? fs.existsSync(path.join(projectRoot, briefPath)) : false;
  const peerIds = new Set(cluster?.plan_ids || []);
  peerIds.delete(planId);
  const sameWorkstreamSample = [...peerIds]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status) || a.task_id.localeCompare(b.task_id))
    .slice(0, 8)
    .map(summarizePlanForLocator);
  const directNeighbors = [
    ...incoming.map((relationship) => summarizeNeighborForLocator(relationship, byId.get(relationship.source), 'incoming')),
    ...outgoing.map((relationship) => summarizeNeighborForLocator(relationship, byId.get(relationship.target), 'outgoing'))
  ].slice(0, 12);
  const connectionEvidence = buildSelectedPlanConnectionEvidence(planId, incoming, outgoing);
  const remediationRows = (model.remediation_queue || [])
    .filter((row) => row.task_id === planId)
    .map((row) => ({
      signal: row.signal,
      recommended_fix: row.recommended_fix,
      dashboard_href: row.dashboard_href,
      next_command: row.next_command
    }));
  const actionLanes = actionLanesForPlan(model.plan_action_board, planId);

  return {
    found: true,
    task_id: plan.task_id,
    title: plan.title,
    status: plan.status,
    review_lane: plan.review_lane,
    risk_tier: plan.risk_tier,
    quality_flags: plan.quality_flags || [],
    source: plan.path,
    map: `${FILES.systemMap}${mapHash}`,
    next_command: plan.next_command,
    next_step: plan.next_step,
    workstream: cluster ? {
      cluster_id: cluster.id,
      label: cluster.label,
      brief: briefPath,
      brief_exists: briefExists,
      brief_command: `npm run plans:visual -- --cluster ${cluster.id} --write`
    } : null,
    relationships: {
      incoming: incoming.length,
      outgoing: outgoing.length,
      incoming_sample: incoming.slice(0, 5).map(summarizeRelationshipForLocator),
      outgoing_sample: outgoing.slice(0, 5).map(summarizeRelationshipForLocator)
    },
    connection_evidence: connectionEvidence,
    neighborhood: {
      direct_neighbors: directNeighbors,
      same_workstream_sample: sameWorkstreamSample
    },
    action_lanes: actionLanes,
    remediation_rows: remediationRows
  };
}

function buildSelectedPlanConnectionEvidence(planId, incoming, outgoing) {
  return [
    ...incoming.map((relationship) => summarizeConnectionEvidence(planId, relationship, 'incoming')),
    ...outgoing.map((relationship) => summarizeConnectionEvidence(planId, relationship, 'outgoing'))
  ]
    .sort((a, b) => intentPriority(a.intent) - intentPriority(b.intent) || a.other_task_id.localeCompare(b.other_task_id))
    .slice(0, 8);
}

function summarizeConnectionEvidence(planId, relationship, direction) {
  const otherTaskId = direction === 'incoming' ? relationship.source : relationship.target;
  return {
    direction,
    other_task_id: otherTaskId,
    source: relationship.source,
    target: relationship.target,
    relationship: relationship.type,
    intent: relationship.intent,
    confidence: relationship.confidence || 'unknown',
    confidence_reason: relationship.confidence_reason || 'No confidence reason recorded.',
    meaning: relationshipMeaning(direction, relationship.intent, otherTaskId),
    evidence: relationship.evidence
  };
}

function relationshipMeaning(direction, intent, otherTaskId) {
  const prefix = direction === 'incoming'
    ? `${otherTaskId} points at this plan`
    : `This plan points at ${otherTaskId}`;
  if (intent === 'dependency') return `${prefix} as a dependency signal.`;
  if (intent === 'sequence') return `${prefix} as sequencing context.`;
  if (intent === 'review') return `${prefix} as review context.`;
  if (intent === 'hierarchy') return `${prefix} as parent/child hierarchy context.`;
  if (intent === 'implementation') return `${prefix} as implementation context.`;
  if (intent === 'coordination') return `${prefix} as coordination context.`;
  if (intent === 'lifecycle') return `${prefix} as lifecycle context.`;
  return `${prefix} as related context.`;
}

function actionLanesForPlan(actionBoard, planId) {
  if (!actionBoard || !Array.isArray(actionBoard.lanes)) return [];
  const matches = [];
  for (const lane of actionBoard.lanes) {
    const row = (lane.rows || []).find((item) => item.task_id === planId);
    if (!row) continue;
    matches.push({
      lane_id: lane.id,
      lane: lane.label,
      summary: lane.summary,
      reason: row.reason,
      next_command: row.next_command,
      dashboard_href: row.dashboard_href
    });
  }
  return matches;
}

function summarizeNeighborForLocator(relationship, neighbor, direction) {
  return {
    direction,
    task_id: direction === 'incoming' ? relationship.source : relationship.target,
    relationship: relationship.type,
    intent: relationship.intent,
    evidence: relationship.evidence,
    confidence: relationship.confidence || 'unknown',
    confidence_reason: relationship.confidence_reason || 'No confidence reason recorded.',
    status: neighbor?.status || 'unknown',
    review_lane: neighbor?.review_lane || 'unknown',
    risk_tier: neighbor?.risk_tier || 'unknown',
    next_command: neighbor?.next_command || 'unknown',
    source: neighbor?.path || null
  };
}

function summarizePlanForLocator(plan) {
  return {
    task_id: plan.task_id,
    status: plan.status,
    review_lane: plan.review_lane,
    risk_tier: plan.risk_tier,
    next_command: plan.next_command,
    source: plan.path
  };
}

function statusPriority(status) {
  const priority = { ready: 0, in_progress: 1, needs_review: 2, blocked: 3, planned: 4, complete: 5, unreadable: 6 };
  return priority[status] ?? 9;
}

function summarizeRelationshipForLocator(relationship) {
  return {
    source: relationship.source,
    target: relationship.target,
    type: relationship.type,
    intent: relationship.intent,
    confidence: relationship.confidence || 'unknown',
    confidence_reason: relationship.confidence_reason || 'No confidence reason recorded.',
    evidence: relationship.evidence
  };
}

function buildFreshnessSummary(projectRoot, modelFile, model) {
  if (!modelFile.exists) {
    return {
      status: 'missing',
      generated_at: null,
      model_mtime: null,
      newest_plan: null,
      message: 'No generated system model found. Run npm run plans:dashboard.'
    };
  }

  const newestPlan = findNewestTaskPlan(projectRoot);
  if (!newestPlan) {
    return {
      status: 'unknown',
      generated_at: model?.generated_at || null,
      model_mtime: modelFile.mtime,
      newest_plan: null,
      message: 'No task-plan artifacts found to compare against.'
    };
  }

  const modelTime = Date.parse(modelFile.mtime);
  const planTime = Date.parse(newestPlan.mtime);
  const stale = planTime > modelTime;
  return {
    status: stale ? 'stale' : 'fresh',
    generated_at: model?.generated_at || null,
    model_mtime: modelFile.mtime,
    newest_plan: newestPlan,
    message: stale
      ? `Generated model is older than ${newestPlan.path}. Run npm run plans:dashboard.`
      : 'Generated model is at least as new as the newest task-plan artifact.'
  };
}

function findNewestTaskPlan(projectRoot) {
  const roots = [
    path.join(projectRoot, '_dev', 'reports', 'analysis', 'task-plans'),
    path.join(projectRoot, 'clients')
  ];
  let newest = null;
  for (const root of roots) {
    for (const filePath of walkJsonFiles(root)) {
      if (!filePath.endsWith('__plan.json')) continue;
      const stat = fs.statSync(filePath);
      const item = {
        path: path.relative(projectRoot, filePath),
        mtime: stat.mtime.toISOString()
      };
      if (!newest || stat.mtimeMs > Date.parse(newest.mtime)) {
        newest = item;
      }
    }
  }
  return newest;
}

function walkJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        out.push(entryPath);
      }
    }
  }
  return out;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function renderText(summary) {
  const lines = [
    'Mythos plan visibility surfaces',
    '',
    `Generated model present: ${summary.generated ? 'yes' : 'no'}`,
    `Freshness: ${summary.freshness.status} - ${summary.freshness.message}`,
    ''
  ];

  if (summary.counts) {
    lines.push(
      'Current system scope:',
      `- plans: ${summary.counts.plans}`,
      `- relationships: ${summary.counts.relationships}`,
      `- workstreams: ${summary.counts.workstreams}`,
      `- workstream matrix rows: ${summary.counts.matrix_rows}`,
      `- unlinked plans: ${summary.counts.unlinked}`,
      `- missing review lane: ${summary.counts.missing_review_lane}`,
      ''
    );
    if (summary.graph_health) {
      lines.push(
        'Graph health:',
        `- coverage: ${summary.graph_health.coverage_percent}% (${summary.graph_health.linked_plans} linked, ${summary.graph_health.unlinked_plans} unlinked)`,
        `- link density: ${summary.graph_health.links_per_plan} links per plan`,
        `- weakest areas: ${formatWeakestAreas(summary.graph_health.weakest_areas)}`,
        `- actions: ${formatRecommendations(summary.graph_health.recommendations)}`,
        ''
      );
      if (summary.review_lane_routing?.lanes?.length) {
        lines.push(
          'Review lane routing:',
          `- ${summary.review_lane_routing.summary}`,
          ...summary.review_lane_routing.lanes.map((lane) => `- ${lane.label}: ${lane.count} plans - ${lane.purpose} - ${lane.dashboard_href}`),
          ''
        );
      }
      if (summary.operator_question_routes.length) {
        lines.push(
          'Operator question router:',
          ...summary.operator_question_routes.map((route) => `- ${route.question} ${route.count_label ? `(${route.count_label})` : ''} - ${route.href} - ${route.command}`),
          ''
        );
      }
      if (summary.map_reading_guide?.items?.length) {
        lines.push(
          'How to read this map:',
          `- ${summary.map_reading_guide.summary || 'Generated map reading guide.'}`,
          ...summary.map_reading_guide.items.slice(0, 5).map((item) => `- ${item.term}: ${item.meaning} Use: ${item.use}`),
          ''
        );
      }
      if (summary.protocol_readiness?.totals) {
        const totals = summary.protocol_readiness.totals;
        const checks = summary.protocol_readiness.checks || [];
        const repairs = summary.protocol_readiness.rows || [];
        lines.push(
          'Protocol readiness:',
          `- ${summary.protocol_readiness.summary || `${totals.protocol_ready || 0} protocol-ready plans.`}`,
          `- ready: ${totals.protocol_ready || 0}/${totals.visible_plans || 0}; needs repair: ${totals.needs_protocol_repair || 0}`,
          ...checks
            .filter((check) => check.missing_count > 0)
            .slice(0, 5)
            .map((check) => `- ${check.label}: ${check.missing_count} missing - ${check.repair}`),
          ...repairs
            .filter((row) => row.protocol_state === 'needs_protocol_repair')
            .slice(0, 5)
            .map((row) => `- repair ${row.task_id}: ${(row.missing_fields || []).join(', ') || 'none'} - ${row.recommended_command}`),
          ''
        );
      }
      if (summary.dependency_sequence_chains.length) {
        lines.push(
          'Dependency and sequence chains:',
          ...summary.dependency_sequence_chains.slice(0, 6).map((chain) => `- ${chain.summary}: ${chain.hops} hops (${(chain.intents || []).join(', ') || 'not-recorded'}) - next ${chain.next_task_id || 'none'} - ${chain.next_command || 'not-recorded'} - ${chain.dashboard_href}`),
          ''
        );
      }
      if (summary.remediation_queue.length) {
        lines.push(
          'Remediation queue:',
          ...summary.remediation_queue.slice(0, 5).map((row) => `- ${row.signal}: ${row.task_id} (${row.dashboard_href})`),
          ''
        );
      }
      if (summary.priority_scan.length) {
        lines.push(
          'Priority scan:',
          ...summary.priority_scan.map((item) => `- ${item.label}: ${item.task_id || 'not-recorded'} (${item.status || 'not-recorded'}) - ${item.reason || 'No reason recorded.'}`),
          ''
        );
      }
      if (summary.plan_action_board?.lanes?.length) {
        lines.push(
          'Plan action board:',
          `- ${summary.plan_action_board.summary}`,
          ...summary.plan_action_board.lanes.map((lane) => {
            const first = (lane.rows || [])[0];
            return first
              ? `- ${lane.label}: ${first.task_id} (${first.status}) - ${first.reason} - ${first.next_command} - ${first.dashboard_href}`
              : `- ${lane.label}: no plans in this lane`;
          }),
          ''
        );
      }
      if (summary.execution_readiness?.lanes?.length) {
        lines.push(
          'Execution readiness:',
          `- ${summary.execution_readiness.summary}`,
          ...summary.execution_readiness.lanes.map((lane) => {
            const first = (lane.rows || [])[0];
            return first
              ? `- ${lane.label}: ${first.task_id} (${first.readiness}) - ${first.reason} - ${first.recommended_command} - ${first.dashboard_href}`
              : `- ${lane.label}: no plans in this lane`;
          }),
          ''
        );
      }
      if (summary.routing_blockers?.blockers?.length) {
        lines.push(
          'Routing blockers:',
          `- ${summary.routing_blockers.summary}`,
          `- ready to route: ${summary.routing_blockers.ready_to_route || 0}; blocker rows: ${summary.routing_blockers.blocker_total || 0}`,
          ...summary.routing_blockers.blockers.map((item) => `- ${item.label}: ${item.count} rows; first ${item.first_task_id} - ${item.command} - ${item.href}`),
          ''
        );
      }
      if (summary.first_repair_path?.steps?.length) {
        lines.push(
          'First repair path:',
          `- ${summary.first_repair_path.summary}`,
          ...summary.first_repair_path.steps.map((step, index) => `- ${index + 1}. ${step.label}: ${step.task_id} - ${step.why_first} - ${step.command} - ${step.href}`),
          ''
        );
      }
      if (summary.risk_gate_queue?.rows?.length) {
        lines.push(
          'Risk gate queue:',
          `- ${summary.risk_gate_queue.summary}`,
          `- candidates: ${summary.risk_gate_queue.totals?.candidates || 0}; operator: ${summary.risk_gate_queue.totals?.operator_gate || 0}; bridge: ${summary.risk_gate_queue.totals?.codex_bridge || 0}; protocol repair: ${summary.risk_gate_queue.totals?.protocol_repair || 0}`,
          ...summary.risk_gate_queue.rows.slice(0, 8).map((row) => `- ${row.gate_label}: ${row.task_id} (${row.status}, ${row.risk_tier}) - ${row.reason} - ${row.recommended_command} - ${row.dashboard_href}`),
          ''
        );
      }
      if (summary.orchestration_routing_board?.lanes?.length) {
        lines.push(
          'Orchestration routing board:',
          `- ${summary.orchestration_routing_board.summary}`,
          ...summary.orchestration_routing_board.lanes.map((lane) => {
            const first = (lane.rows || [])[0];
            return `- ${lane.label}: ${lane.count} plans; first ${first?.task_id || 'none'} - ${first?.route_owner || 'none'} - ${first?.recommended_command || 'none'} - ${first?.dashboard_href || 'none'}`;
          }),
          ''
        );
      }
      if (summary.command_runbook?.groups?.length) {
        lines.push(
          'Command runbook:',
          `- ${summary.command_runbook.summary}`,
          ...summary.command_runbook.groups.slice(0, 6).flatMap((group) => [
            `- ${group.verb}: ${group.count} suggestions - ${group.purpose}`,
            ...(group.rows || []).slice(0, 3).map((row) => `  - ${row.task_id}: ${row.reason} - ${row.command} - ${row.dashboard_href}`)
          ]),
          ''
        );
      }
      if (summary.recent_activity?.items?.length) {
        lines.push(
          'Recent source activity:',
          ...summary.recent_activity.items.slice(0, 6).map((item) => `- ${item.source_mtime}: ${item.task_id} (${item.status}) - ${item.next_command}`),
          ''
        );
      }
      if (summary.plan_progress_timeline?.items?.length) {
        lines.push(
          'Plan progress timeline:',
          ...summary.plan_progress_timeline.items.slice(0, 8).flatMap(formatTimelineItem),
          ''
        );
      }
      if (summary.unlinked_plan_triage?.rows?.length) {
        lines.push(
          'Unlinked plan triage:',
          `- ${summary.unlinked_plan_triage.summary}`,
          ...summary.unlinked_plan_triage.rows.slice(0, 8).map((row) => `- ${row.task_id} (${row.status}, ${row.review_lane}/${row.risk_tier}) - ${row.next_command} - ${row.dashboard_href}`),
          ''
        );
      }
      if (summary.impact_hubs?.rows?.length) {
        lines.push(
          'Impact hubs:',
          `- ${summary.impact_hubs.summary}`,
          ...summary.impact_hubs.rows.slice(0, 8).map((hub) => `- ${hub.task_id} (${hub.role}, ${hub.total} links, ${hub.workstream_label || 'not linked'}) - ${hub.why_it_matters} - ${hub.dashboard_href}`),
          ''
        );
      }
      if (summary.visual_flowcharts?.items?.length) {
        lines.push(
          'Visual flowcharts:',
          `- ${summary.visual_flowcharts.summary}`,
          ...summary.visual_flowcharts.items.slice(0, 5).map((item) => `- ${item.label}: ${path.join(REPORT_ROOT, item.path)} (${item.command})`),
          ''
        );
      }
    }
  } else {
    lines.push('Current system scope: no generated model found. Run `npm run plans:dashboard`.', '');
  }

  lines.push('Open these files:', ...summary.quick_views.map((view) => `- ${view.label}: ${view.path}`), '');

  if (summary.selected_plan) {
    lines.push('Selected plan:');
    if (!summary.selected_plan.found) {
      lines.push(`- ${summary.selected_plan.message}`, '');
    } else {
      const plan = summary.selected_plan;
      lines.push(
        `- ${plan.task_id}: ${plan.status} · ${plan.review_lane} · ${plan.risk_tier}`,
        `  source: ${plan.source}`,
        `  map: ${plan.map}`,
        `  next: ${plan.next_command}`,
        `  next step: ${plan.next_step.step_id}: ${plan.next_step.description}`,
        `  workstream: ${plan.workstream ? `${plan.workstream.label} (${plan.workstream.cluster_id})` : 'none'}`,
        `  relationships: ${plan.relationships.incoming} incoming, ${plan.relationships.outgoing} outgoing`
      );
      if (plan.remediation_rows.length) {
        lines.push('  remediation:');
        for (const row of plan.remediation_rows.slice(0, 5)) {
          lines.push(`  - ${row.signal}: ${row.recommended_fix} (${row.dashboard_href})`);
        }
      }
      if (plan.action_lanes.length) {
        lines.push('  action lanes:');
        for (const lane of plan.action_lanes) {
          lines.push(`  - ${lane.lane}: ${lane.reason} (${lane.next_command}; ${lane.dashboard_href})`);
        }
      } else {
        lines.push('  action lanes: none');
      }
      if (plan.connection_evidence.length) {
        lines.push('  connection evidence:');
        for (const item of plan.connection_evidence.slice(0, 6)) {
          lines.push(`  - ${item.direction}: ${item.source} -> ${item.target} (${item.intent}/${item.relationship}, ${item.confidence}) - ${item.meaning}`);
          lines.push(`    confidence: ${item.confidence_reason}`);
          lines.push(`    evidence: ${clipText(item.evidence, 180)}`);
        }
      }
      if (plan.workstream?.brief_exists) {
        lines.push(`  brief: ${plan.workstream.brief}`);
      } else if (plan.workstream) {
        lines.push(`  brief: not generated for this workstream (${plan.workstream.brief_command})`);
      }
      if (plan.neighborhood.direct_neighbors.length) {
        lines.push('  direct neighbors:');
        for (const neighbor of plan.neighborhood.direct_neighbors.slice(0, 8)) {
          lines.push(`  - ${neighbor.direction}: ${neighbor.task_id} (${neighbor.intent}/${neighbor.relationship}, ${neighbor.confidence}) · ${neighbor.status} · ${neighbor.next_command}`);
        }
      }
      if (plan.neighborhood.same_workstream_sample.length) {
        lines.push('  same workstream sample:');
        for (const peer of plan.neighborhood.same_workstream_sample.slice(0, 6)) {
          lines.push(`  - ${peer.task_id}: ${peer.status} · ${peer.review_lane} · ${peer.risk_tier} · ${peer.next_command}`);
        }
      }
      lines.push('');
    }
  }

  if (summary.selected_workstream) {
    lines.push('Selected workstream:');
    if (!summary.selected_workstream.found) {
      lines.push(`- ${summary.selected_workstream.message}`, '');
    } else {
      const workstream = summary.selected_workstream;
      lines.push(
        `- ${workstream.label} (${workstream.cluster_id})`,
        `  reason: ${workstream.label_reason}`,
        `  plans: ${workstream.plans}`,
        `  relationships: ${workstream.relationships}`,
        `  map: ${workstream.map}`,
        `  brief: ${workstream.brief_exists ? workstream.brief : `not generated (${workstream.brief_command})`}`,
        `  suggested next: ${workstream.suggested_next.task_id} (${workstream.suggested_next.status}) - ${workstream.suggested_next.reason}`,
        `  next step: ${workstream.suggested_next.next_step}`,
        `  next command: ${workstream.suggested_next.next_command}`,
        `  status mix: ${formatEntryList(workstream.status_mix)}`,
        `  top intents: ${formatEntryList(workstream.top_intents)}`,
        `  top sources: ${formatEntryList(workstream.top_sources)}`
      );
      if (workstream.story) {
        lines.push(`  story: ${workstream.story.explanation}`);
        if (workstream.story.relationship_examples?.length) {
          lines.push('  example links:');
          for (const example of workstream.story.relationship_examples.slice(0, 3)) {
            lines.push(`  - ${example.source} -> ${example.target} (${example.intent}/${example.type}): ${example.evidence}`);
          }
        }
        if (workstream.story.bridge_plans?.length) {
          lines.push(`  bridge plans: ${workstream.story.bridge_plans.map((hub) => `${hub.task_id} (${hub.role}, ${hub.total} links)`).join(', ')}`);
        }
      }
      for (const plan of workstream.sample_plans.slice(0, 8)) {
        lines.push(`  - ${plan.task_id}: ${plan.status} · ${plan.review_lane} · ${plan.risk_tier} · ${plan.next_command}`);
      }
      lines.push('');
    }
  }

  if (summary.connection_path) {
    lines.push('Connection path:');
    if (!summary.connection_path.found) {
      lines.push(`- ${summary.connection_path.message}`, '');
    } else {
      const pathSummary = summary.connection_path;
      lines.push(
        `- ${pathSummary.from} -> ${pathSummary.to}: ${pathSummary.hops} hop${pathSummary.hops === 1 ? '' : 's'}`,
        `  map: ${pathSummary.map}`,
        `  ${pathSummary.message}`
      );
      for (const relationship of pathSummary.relationships) {
        lines.push(`  - ${relationship.from} -> ${relationship.to}: ${relationship.intent}/${relationship.type} (${relationship.confidence || 'unknown'}; ${relationship.traversed}; source edge ${relationship.source} -> ${relationship.target})`);
      }
      lines.push(`  plan sequence: ${pathSummary.plans.map((plan) => plan.task_id).join(' -> ')}`, '');
    }
  }

  if (summary.top_workstreams.length) {
    lines.push('Top workstreams:');
    for (const row of summary.top_workstreams) {
      lines.push(`- ${row.label} (${row.cluster_id}): ${row.plans} plans, ${row.relationships} links; next ${row.suggested_next}`);
      lines.push(`  map: ${path.join(REPORT_ROOT, row.map)}`);
      lines.push(`  brief: ${path.join(REPORT_ROOT, row.brief)}`);
    }
    lines.push('');
  }

  if (summary.workstream_drilldowns?.drilldowns?.length) {
    lines.push(
      'Workstream drilldowns:',
      `- ${summary.workstream_drilldowns.summary}`
    );
    for (const drilldown of summary.workstream_drilldowns.drilldowns.slice(0, 3)) {
      lines.push(`- ${drilldown.label} (${drilldown.cluster_id}): ${drilldown.plans} plans, ${drilldown.relationships} links`);
      for (const slice of (drilldown.slices || []).slice(0, 3)) {
        const next = slice.suggested_next || {};
        lines.push(`  - ${slice.label}: ${slice.plans} plans, ${slice.ready_like} ready/in-progress; next ${next.task_id || 'none'} - ${next.next_command || 'not-recorded'} - ${next.dashboard_href || drilldown.dashboard_href}`);
      }
    }
    lines.push('');
  }

  lines.push(
    'Commands:',
    `- regenerate: ${summary.commands.regenerate}`,
    `- smoke: ${summary.commands.smoke}`,
    `- machine-readable locator: ${summary.commands.json}`,
    `- locate plan: ${summary.commands.locate_plan}`,
    `- locate workstream: ${summary.commands.locate_workstream}`,
    `- locate path: ${summary.commands.locate_path}`,
    ''
  );

  return `${lines.join('\n')}\n`;
}

function formatWeakestAreas(areas) {
  if (!Array.isArray(areas) || areas.length === 0) return 'none';
  return areas.map((area) => `${area.signal}: ${area.count}`).join(', ');
}

function formatRecommendations(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length === 0) return 'none';
  return recommendations.slice(0, 3).map((item) => `${item.signal}: ${item.dashboard_href}`).join(', ');
}

function formatTimelineItem(item) {
  const step = item.next_step || {};
  const stepId = step.step_id || 'none';
  const description = clipText(step.description || 'No next step recorded.', 160);
  const quality = Array.isArray(item.quality_flags) && item.quality_flags.length
    ? `; signals: ${item.quality_flags.join(', ')}`
    : '';
  return [
    `- ${item.modified_at}: ${item.task_id} (${item.status}, ${item.workstream_label || 'not linked'}) - ${stepId}: ${description} - ${item.next_command}${quality}`,
    `  map: ${item.dashboard_href || 'not-recorded'}`
  ];
}

function clipText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function countRelationshipsBy(relationships, field) {
  return relationships.reduce((acc, relationship) => {
    const value = relationship[field] || 'not-recorded';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function intentPriority(intent) {
  const priority = { dependency: 0, sequence: 1, review: 2, hierarchy: 3, coordination: 4, implementation: 5 };
  return priority[intent] ?? 9;
}

function topEntries(grouping, limit = 5) {
  return Object.entries(grouping || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function formatEntryList(entries) {
  return (entries || []).map((entry) => `${entry.label}: ${entry.count}`).join(', ') || 'none';
}

if (require.main === module) {
  main();
}

module.exports = {
  buildSummary,
  parseArgs,
  renderText
};
