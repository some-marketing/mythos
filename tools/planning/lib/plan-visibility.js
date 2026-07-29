'use strict';

const fs = require('fs');
const path = require('path');

const SYSTEM_PLAN_ROOT = path.join('_dev', 'reports', 'analysis', 'task-plans');
const CLIENTS_ROOT = 'clients';
const DEFAULT_VISUAL_CLUSTER_LIMIT = 8;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function walkPlanFiles(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const files = [];
  const systemRoot = path.join(projectRoot, SYSTEM_PLAN_ROOT);

  if (fs.existsSync(systemRoot)) {
    for (const entry of fs.readdirSync(systemRoot).sort()) {
      if (entry.endsWith('__plan.json')) {
        files.push(path.join(systemRoot, entry));
      }
    }
  }

  if (!includeClient) return files;

  const clientsRoot = path.join(projectRoot, CLIENTS_ROOT);
  if (!fs.existsSync(clientsRoot)) return files;

  for (const clientCode of fs.readdirSync(clientsRoot).sort()) {
    const plansRoot = path.join(clientsRoot, clientCode, 'plans');
    if (!fs.existsSync(plansRoot)) continue;
    for (const entry of fs.readdirSync(plansRoot).sort()) {
      if (entry.endsWith('__plan.json')) {
        files.push(path.join(plansRoot, entry));
      }
    }
  }

  return files;
}

function classifyPlan(plan) {
  // An explicit operator-set terminal top-level status is a stronger signal than
  // derived step state — honor it before falling back to step/approval derivation.
  // Only terminal values are honored here; non-terminal declared values
  // (planned/in_progress/ready) defer to live step-derivation below, which is
  // more current for in-flight work.
  const declared = String(plan?.status || '').trim().toLowerCase();
  if (declared === 'complete' || declared === 'completed' || declared === 'done') return 'complete';
  if (declared === 'blocked') return 'blocked';

  const steps = Array.isArray(plan?.bounded_plan?.steps) ? plan.bounded_plan.steps : [];
  const statuses = steps.map((step) => normalizeStepStatus(step.status)).filter(Boolean);
  const approvalStatus = String(plan?.approval?.status || plan?.operator_review?.decision || '').toLowerCase();

  if (approvalStatus === 'blocked' || statuses.includes('blocked')) return 'blocked';
  if (steps.length > 0 && statuses.length === steps.length && statuses.every((status) => status === 'complete')) {
    return 'complete';
  }
  if (statuses.includes('ready') || approvalStatus === 'approved') return 'ready';
  if (statuses.includes('in_progress') || statuses.includes('in-progress')) return 'in_progress';
  if (approvalStatus === 'approved') return 'ready';
  if (approvalStatus === 'pending' || approvalStatus === 'needs_review') return 'needs_review';
  return 'planned';
}

function summarizeSteps(plan) {
  const steps = Array.isArray(plan?.bounded_plan?.steps) ? plan.bounded_plan.steps : [];
  const counts = {
    total: steps.length,
    complete: 0,
    ready: 0,
    blocked: 0,
    in_progress: 0,
    planned: 0,
    unknown: 0
  };

  for (const step of steps) {
    const status = normalizeStepStatus(step.status);
    if (status === 'complete') counts.complete += 1;
    else if (status === 'ready') counts.ready += 1;
    else if (status === 'blocked') counts.blocked += 1;
    else if (status === 'in_progress' || status === 'in-progress') counts.in_progress += 1;
    else if (status === 'planned') counts.planned += 1;
    else counts.unknown += 1;
  }

  return counts;
}

function summarizeNextStep(plan) {
  const steps = Array.isArray(plan?.bounded_plan?.steps) ? plan.bounded_plan.steps : [];
  const next = steps.find((step) => normalizeStepStatus(step.status) !== 'complete');
  if (!next) {
    return {
      step_id: 'none',
      status: steps.length ? 'complete' : 'not-recorded',
      description: steps.length ? 'All declared steps are complete.' : 'No bounded-plan steps recorded.',
      mode: 'not-recorded'
    };
  }

  return {
    step_id: next.step_id || next.id || 'unnamed-step',
    status: next.status || 'unknown',
    description: next.description || next.summary || next.name || 'No step description recorded.',
    mode: next.mode || next.framework_mode || next.execution_mode || 'not-recorded'
  };
}

function normalizeStepStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'done' || value === 'completed') return 'complete';
  if (value === 'in-progress') return 'in_progress';
  return value;
}

function hasDebriefArtifacts(projectRoot, taskId) {
  if (!projectRoot || !taskId) return false;
  return fs.existsSync(path.join(
    projectRoot,
    '_dev',
    'reports',
    'analysis',
    `run-debrief__${taskId}.md`
  ));
}

function inferNextCommand(plan, projectRoot = null) {
  const taskId = plan?.task_id || '<task-id>';
  if (plan?.outcome_delta?.completed === true && plan?.outcome_delta?.verification_passed === true && hasDebriefArtifacts(projectRoot, taskId)) {
    return 'none';
  }
  if (plan?.exact_next_command) return plan.exact_next_command;
  if (plan?.outcome_delta?.completed === true && plan?.outcome_delta?.verification_passed === true) {
    return `/debrief-run ${taskId}`;
  }
  const reviewLane = String(plan?.routing_expectations?.review_lane || '').toLowerCase();
  if (!reviewLane || ['not-recorded', 'unknown'].includes(reviewLane)) return `/amend-plan ${taskId}`;
  if (reviewLane === 'operator-gate' || reviewLane === 'codex-bridge') return `/review-task-plan ${taskId}`;

  const guidance = plan?.operator_guidance?.conditional_next_steps;
  if (Array.isArray(guidance) && guidance[0]?.command) return guidance[0].command;

  const approvalStatus = String(plan?.approval?.status || '').toLowerCase();
  if (approvalStatus === 'approved') return `/run-plan ${taskId}`;
  return `/review-task-plan ${taskId}`;
}

function toRelative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function collectPlanSummaries(projectRoot, options = {}) {
  return walkPlanFiles(projectRoot, options)
    .map((filePath) => {
      const plan = readJson(filePath);
      if (!plan) {
        const stat = fs.statSync(filePath);
        return {
          task_id: path.basename(filePath, '__plan.json'),
          title: path.basename(filePath),
          path: toRelative(projectRoot, filePath),
          source_mtime: stat.mtime.toISOString(),
          raw_plan: null,
          status: 'unreadable',
          scope_type: 'unknown',
          step_counts: summarizeSteps(null),
          next_step: summarizeNextStep(null),
          review_lane: 'unknown',
          next_command: 'inspect JSON parse error'
        };
      }

      return {
        task_id: plan.task_id || path.basename(filePath, '__plan.json'),
        title: plan.title || plan.task_summary || plan.task_id || path.basename(filePath),
        path: toRelative(projectRoot, filePath),
        source_mtime: fs.statSync(filePath).mtime.toISOString(),
        raw_plan: plan,
        status: classifyPlan(plan),
        scope_type: plan.scope_type || 'unknown',
        client_code: plan.client_code || plan.origin_client_code || inferClientCode(projectRoot, filePath),
        project_id: plan.project_id || plan.origin_project_id || 'not-recorded',
        framework: inferFramework(plan),
        approval: plan.approval?.status || plan.operator_review?.decision || 'not-recorded',
        review_lane: plan.routing_expectations?.review_lane || 'not-recorded',
        risk_tier: plan.routing_expectations?.risk_tier || 'not-recorded',
        step_counts: summarizeSteps(plan),
        next_step: summarizeNextStep(plan),
        next_command: inferNextCommand(plan, projectRoot)
      };
    })
    .sort((a, b) => {
      const statusOrder = { blocked: 0, ready: 1, in_progress: 2, needs_review: 3, planned: 4, complete: 5, unreadable: 6 };
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || a.task_id.localeCompare(b.task_id);
    });
}

function stripRawPlan(summaries) {
  return summaries.map(({ raw_plan: _rawPlan, ...summary }) => summary);
}

function annotatePlanQuality(plans, relationships) {
  const linked = new Set();
  for (const relationship of relationships) {
    linked.add(relationship.source);
    linked.add(relationship.target);
  }

  return plans.map((plan) => {
    const flags = [];
    if (!linked.has(plan.task_id)) flags.push('unlinked');
    if (!plan.review_lane || plan.review_lane === 'not-recorded' || plan.review_lane === 'unknown') flags.push('missing_review_lane');
    if (!plan.risk_tier || plan.risk_tier === 'not-recorded' || plan.risk_tier === 'unknown') flags.push('missing_risk_tier');
    if (plan.step_counts.total === 0) flags.push('no_bounded_steps');
    if (plan.status === 'unreadable') flags.push('unreadable');
    if (['ready', 'in_progress'].includes(plan.status) && !['low', 'not-recorded', 'unknown', ''].includes(String(plan.risk_tier || '').toLowerCase())) flags.push('high_risk_ready');
    return { ...plan, quality_flags: flags };
  });
}

function inferClientCode(projectRoot, filePath) {
  const relativePath = toRelative(projectRoot, filePath);
  const match = relativePath.match(/^clients\/([^/]+)\//);
  return match ? match[1] : 'system';
}

function inferFramework(plan) {
  return normalizeFrameworkReference(
    plan?.similarity_assessment?.top_framework
    || plan?.framework_match?.matched_framework
    || plan?.matched_framework
    || plan?.framework_id
    || 'not-recorded'
  );
}

function normalizeFrameworkReference(value) {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value) return 'not-recorded';
  if (typeof value !== 'object') return String(value);

  const candidates = [
    value.framework_id,
    value.matched_framework,
    value.top_framework,
    value.framework,
    value.id
  ];
  const match = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return match || 'no-framework-match';
}

function planIdFromPlanPath(value) {
  const text = String(value || '');
  const match = text.match(/([^/]+)__plan\.json$/);
  return match ? match[1] : null;
}

function addRelationship(relationships, source, target, type, evidence, intent = null) {
  if (!source || !target || source === target) return;
  const key = `${source}\u0000${target}\u0000${type}`;
  if (relationships.some((relationship) => relationship.key === key)) return;
  const confidence = relationshipConfidence(type);
  relationships.push({
    key,
    source,
    target,
    type,
    intent: intent || inferRelationshipIntent(type, evidence),
    confidence: confidence.level,
    confidence_reason: confidence.reason,
    evidence
  });
}

function relationshipConfidence(type) {
  if (type === 'parent') {
    return {
      level: 'high',
      reason: 'Declared parent_task_id metadata links this plan to a parent plan.'
    };
  }
  if (type === 'component') {
    return {
      level: 'high',
      reason: 'Declared component_matches metadata links this plan to another plan.'
    };
  }
  if (type === 'references') {
    return {
      level: 'medium',
      reason: 'Declared referenced_not_owned metadata points at another plan.'
    };
  }
  if (type === 'overlap') {
    return {
      level: 'medium',
      reason: 'Declared overlap metadata marks this plan as related to another plan.'
    };
  }
  return {
    level: 'derived',
    reason: 'Derived from a task-id mention in the task-plan artifact; inspect evidence before treating as dependency.'
  };
}

function inferRelationshipIntent(type, evidence) {
  if (type === 'parent') return 'hierarchy';
  if (type === 'component') return 'component-match';
  if (type === 'references') return 'reference';
  if (type === 'overlap') return 'related-work';
  const text = String(evidence || '').toLowerCase();
  if (/\b(blocked|blocked_by|blocker|dependency|depends|depends_on|prereq|prerequisite|downstream|upstream)\b/.test(text)) return 'dependency';
  if (/\b(after|before|next|then|follow|follow-up|sequence|stage|phase)\b/.test(text)) return 'sequence';
  if (/\b(review|reviewer|codex|gate|approval|approved|validate|validation|verify|verification)\b/.test(text)) return 'review';
  if (/\b(amend|amendment|repair|reopen|supersede|supersedes|replace|replaces)\b/.test(text)) return 'lifecycle';
  if (/\b(parent|child|sibling|sub-plan|subplan|orchestration|housing)\b/.test(text)) return 'hierarchy';
  if (/\b(signal|coordination|handoff|dispatch|bridge)\b/.test(text)) return 'coordination';
  if (/\b(implement|implementation|build|runner|tool|script|command|surface)\b/.test(text)) return 'implementation';
  if (/\b(similar|overlap|related|adjacent|pattern|template|precedent)\b/.test(text)) return 'related-work';
  return 'mention';
}

function mentionEvidence(plan, target) {
  const text = JSON.stringify(plan, null, 2);
  const idx = text.indexOf(target);
  if (idx === -1) return `task_id:${target}`;
  const start = Math.max(0, idx - 100);
  const end = Math.min(text.length, idx + target.length + 100);
  const context = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `task_id:${target}; context:${context}`;
}

function collectPlanRelationships(summaries) {
  const knownIds = new Set(summaries.map((summary) => summary.task_id));
  const relationships = [];

  for (const summary of summaries) {
    const plan = summary.raw_plan;
    if (!plan) continue;

    if (plan.parent_task_id) {
      addRelationship(relationships, plan.parent_task_id, summary.task_id, 'parent', 'parent_task_id');
    }

    const referenced = plan.scope_identity?.referenced_not_owned;
    if (Array.isArray(referenced)) {
      for (const ref of referenced) {
        const target = planIdFromPlanPath(ref);
        if (target && knownIds.has(target)) {
          addRelationship(relationships, summary.task_id, target, 'references', ref);
        }
      }
    }

    const components = Array.isArray(plan.component_matches) ? plan.component_matches : [];
    for (const component of components) {
      const target = planIdFromPlanPath(component.path);
      if (target && knownIds.has(target)) {
        addRelationship(relationships, summary.task_id, target, 'component', component.path);
      }
    }

    const overlap = plan.existing_work_overlap;
    if (overlap?.highest_scoring_plan) {
      const target = planIdFromPlanPath(overlap.highest_scoring_plan);
      if (target && knownIds.has(target)) {
        addRelationship(relationships, summary.task_id, target, 'overlap', overlap.highest_scoring_plan);
      }
    }
    if (Array.isArray(overlap?.related_plans)) {
      for (const ref of overlap.related_plans) {
        const target = planIdFromPlanPath(ref);
        if (target && knownIds.has(target)) {
          addRelationship(relationships, summary.task_id, target, 'overlap', ref);
        }
      }
    }
    if (Array.isArray(overlap?.highest_scoring_plans)) {
      for (const item of overlap.highest_scoring_plans) {
        const target = planIdFromPlanPath(item.path);
        if (target && knownIds.has(target)) {
          addRelationship(relationships, summary.task_id, target, 'overlap', item.path);
        }
      }
    }

    const planText = JSON.stringify(plan);
    for (const target of knownIds) {
      if (target === summary.task_id) continue;
      if (target.length < 8) continue;
      if (planText.includes(target)) {
        const evidence = mentionEvidence(plan, target);
        addRelationship(relationships, summary.task_id, target, 'mentions', evidence, inferRelationshipIntent('mentions', evidence));
      }
    }
  }

  return relationships.map(({ key: _key, ...relationship }) => relationship)
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.type.localeCompare(b.type));
}

function buildGroupings(plans) {
  return {
    scope_type: countBy(plans, 'scope_type'),
    client_code: countBy(plans, 'client_code'),
    framework: countBy(plans, 'framework'),
    review_lane: countBy(plans, 'review_lane'),
    risk_tier: countBy(plans, 'risk_tier')
  };
}

function countRelationshipsBy(relationships, field) {
  return relationships.reduce((acc, relationship) => {
    const value = relationship[field] || 'not-recorded';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function countBy(plans, field) {
  return plans.reduce((acc, plan) => {
    const value = plan[field] || 'not-recorded';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function topEntry(grouping) {
  const [label, count] = Object.entries(grouping)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ['none', 0];
  return { label, count };
}

function topEntries(grouping, limit = 5) {
  return Object.entries(grouping || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function countDependencyWatchCandidates(plans, relationships) {
  const dependencyTargets = new Set(
    relationships
      .filter((relationship) => relationship.intent === 'dependency')
      .map((relationship) => relationship.target)
  );
  return plans.filter((plan) => (
    ['ready', 'in_progress'].includes(plan.status)
    && dependencyTargets.has(plan.task_id)
  )).length;
}

function buildRelationshipClusters(plans, relationships) {
  const byId = new Map(plans.map((plan) => [plan.task_id, plan]));
  const adjacency = new Map(plans.map((plan) => [plan.task_id, new Set()]));
  const edgeCounts = new Map(plans.map((plan) => [plan.task_id, 0]));

  for (const relationship of relationships) {
    if (!adjacency.has(relationship.source) || !adjacency.has(relationship.target)) continue;
    adjacency.get(relationship.source).add(relationship.target);
    adjacency.get(relationship.target).add(relationship.source);
    edgeCounts.set(relationship.source, (edgeCounts.get(relationship.source) || 0) + 1);
    edgeCounts.set(relationship.target, (edgeCounts.get(relationship.target) || 0) + 1);
  }

  const seen = new Set();
  const clusters = [];
  for (const id of adjacency.keys()) {
    if (seen.has(id)) continue;
    const queue = [id];
    const ids = [];
    seen.add(id);
    while (queue.length) {
      const current = queue.pop();
      ids.push(current);
      for (const next of adjacency.get(current)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }

    const clusterPlans = ids.map((planId) => byId.get(planId)).filter(Boolean);
    const frameworks = countBy(clusterPlans, 'framework');
    const statuses = countBy(clusterPlans, 'status');
    const nextPlan = summarizeClusterNextPlan(clusterPlans);
    const label = summarizeClusterLabel(clusterPlans, topEntry(frameworks), nextPlan);
    const edgeTotal = ids.reduce((total, planId) => total + (edgeCounts.get(planId) || 0), 0) / 2;
    clusters.push({
      id: `cluster-${clusters.length + 1}`,
      label: label.label,
      label_reason: label.reason,
      size: ids.length,
      relationships: edgeTotal,
      top_framework: topEntry(frameworks),
      statuses,
      next_plan: nextPlan,
      plan_ids: ids.sort(),
      sample_plans: ids.sort().slice(0, 8)
    });
  }

  return clusters.sort((a, b) => b.size - a.size || b.relationships - a.relationships || a.id.localeCompare(b.id));
}

function buildRelationshipHubs(plans, relationships, clusters) {
  const byId = new Map(plans.map((plan) => [plan.task_id, plan]));
  const clusterByPlan = new Map();
  for (const cluster of clusters) {
    for (const planId of cluster.plan_ids || []) {
      clusterByPlan.set(planId, {
        id: cluster.id,
        label: cluster.label || cluster.id
      });
    }
  }

  const counts = new Map(plans.map((plan) => [plan.task_id, {
    task_id: plan.task_id,
    title: plan.title,
    status: plan.status,
    framework: plan.framework,
    review_lane: plan.review_lane,
    risk_tier: plan.risk_tier,
    path: plan.path,
    next_step: plan.next_step,
    next_command: plan.next_command,
    incoming: 0,
    outgoing: 0,
    intents: {}
  }]));

  for (const relationship of relationships) {
    const source = counts.get(relationship.source);
    const target = counts.get(relationship.target);
    if (source) {
      source.outgoing += 1;
      source.intents[relationship.intent] = (source.intents[relationship.intent] || 0) + 1;
    }
    if (target) {
      target.incoming += 1;
      target.intents[relationship.intent] = (target.intents[relationship.intent] || 0) + 1;
    }
  }

  return [...counts.values()]
    .map((hub) => {
      const total = hub.incoming + hub.outgoing;
      const topIntent = topEntry(hub.intents);
      const cluster = clusterByPlan.get(hub.task_id) || { id: 'none', label: 'No relationship cluster' };
      return {
        ...hub,
        total,
        top_intent: topIntent.label,
        top_intent_count: topIntent.count,
        role: relationshipHubRole(hub.incoming, hub.outgoing),
        cluster_id: cluster.id,
        cluster_label: cluster.label
      };
    })
    .filter((hub) => hub.total > 0)
    .sort((a, b) => (
      b.total - a.total
      || b.outgoing - a.outgoing
      || b.incoming - a.incoming
      || a.task_id.localeCompare(b.task_id)
    ))
    .slice(0, 20);
}

function buildImpactHubs(relationshipHubs, limit = 12) {
  const rows = (relationshipHubs || []).slice(0, limit).map((hub) => ({
    task_id: hub.task_id,
    title: hub.title,
    role: hub.role,
    status: hub.status,
    review_lane: hub.review_lane,
    risk_tier: hub.risk_tier,
    total: hub.total,
    incoming: hub.incoming,
    outgoing: hub.outgoing,
    top_intent: hub.top_intent,
    top_intent_count: hub.top_intent_count,
    workstream_id: hub.cluster_id,
    workstream_label: hub.cluster_label,
    source: hub.path,
    next_step: hub.next_step,
    next_command: hub.next_command,
    dashboard_href: hub.cluster_id && hub.cluster_id !== 'none'
      ? `plan-visibility__current.html#cluster=${encodeURIComponent(hub.cluster_id)}&plan=${encodeURIComponent(hub.task_id)}`
      : `plan-visibility__current.html#plan=${encodeURIComponent(hub.task_id)}`,
    why_it_matters: impactHubReason(hub)
  }));

  return {
    total: (relationshipHubs || []).length,
    shown: rows.length,
    summary: rows.length
      ? `${rows.length} highest-impact connected plans by relationship count, showing whether each plan is a driver, convergence point, or bridge.`
      : 'No connected impact hubs were detected.',
    rows
  };
}

function impactHubReason(hub) {
  const role = hub.role || 'hub';
  const topIntent = hub.top_intent || 'not-recorded';
  if (role === 'bridge') {
    return `Bridge plan: connects upstream and downstream context across ${hub.total} relationships; top intent ${topIntent}.`;
  }
  if (role === 'driver') {
    return `Driver plan: feeds ${hub.outgoing} downstream relationship${hub.outgoing === 1 ? '' : 's'}; inspect before dependent work.`;
  }
  if (role === 'convergence') {
    return `Convergence plan: receives ${hub.incoming} incoming relationship${hub.incoming === 1 ? '' : 's'}; inspect before execution or closure.`;
  }
  return `Connected plan with ${hub.total} relationship${hub.total === 1 ? '' : 's'}; inspect its neighborhood for context.`;
}

function buildPlanActionBoard(plans, relationships, clusters, remediationQueue, impactHubs, limit = 8) {
  const clusterByPlan = new Map();
  for (const cluster of clusters || []) {
    for (const planId of cluster.plan_ids || []) {
      clusterByPlan.set(planId, cluster);
    }
  }

  const dependencyIncoming = new Map();
  for (const relationship of relationships || []) {
    if (relationship.intent !== 'dependency') continue;
    const rows = dependencyIncoming.get(relationship.target) || [];
    rows.push(relationship);
    dependencyIncoming.set(relationship.target, rows);
  }

  const planHref = (plan) => {
    const cluster = clusterByPlan.get(plan.task_id);
    return cluster
      ? `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(plan.task_id)}`
      : `plan-visibility__current.html#plan=${encodeURIComponent(plan.task_id)}`;
  };
  const actionCommand = (plan) => {
    if (plan.status === 'unreadable') return `inspect ${plan.path}`;
    if (!plan.review_lane || ['not-recorded', 'unknown'].includes(plan.review_lane)) return `/amend-plan ${plan.task_id}`;
    if (plan.review_lane === 'operator-gate' || plan.review_lane === 'codex-bridge') return `/review-task-plan ${plan.task_id}`;
    return plan.next_command || (plan.status === 'ready' ? `/run-plan ${plan.task_id}` : `/review-task-plan ${plan.task_id}`);
  };
  const planRow = (plan, reason) => {
    const cluster = clusterByPlan.get(plan.task_id);
    return {
      task_id: plan.task_id,
      title: plan.title,
      status: plan.status,
      review_lane: plan.review_lane,
      risk_tier: plan.risk_tier,
      source: plan.path,
      next_command: actionCommand(plan),
      dashboard_href: planHref(plan),
      workstream_id: cluster?.id || null,
      workstream_label: cluster?.label || 'not linked',
      reason
    };
  };

  const runnableNow = (plans || [])
    .filter((plan) => ['ready', 'in_progress'].includes(plan.status) && !dependencyIncoming.has(plan.task_id))
    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status) || a.task_id.localeCompare(b.task_id))
    .slice(0, limit)
    .map((plan) => planRow(plan, 'Ready or in progress with no incoming dependency-intent relationship detected.'));

  const dependencyWatch = (plans || [])
    .filter((plan) => ['ready', 'in_progress'].includes(plan.status) && dependencyIncoming.has(plan.task_id))
    .sort((a, b) => (dependencyIncoming.get(b.task_id)?.length || 0) - (dependencyIncoming.get(a.task_id)?.length || 0) || a.task_id.localeCompare(b.task_id))
    .slice(0, limit)
    .map((plan) => {
      const upstream = (dependencyIncoming.get(plan.task_id) || []).slice(0, 3).map((relationship) => relationship.source).join(', ');
      return planRow(plan, `Runnable-looking plan with incoming dependency links from ${upstream || 'upstream plans'}. Inspect before execution.`);
    });

  const mapRepairs = (remediationQueue || [])
    .slice(0, limit)
    .map((row) => ({
      task_id: row.task_id,
      title: row.title,
      status: row.status,
      review_lane: row.review_lane,
      risk_tier: row.risk_tier,
      source: row.source,
      next_command: row.next_command,
      dashboard_href: row.dashboard_href,
      workstream_id: null,
      workstream_label: row.signal,
      reason: row.recommended_fix
    }));

  const impactReview = (impactHubs?.rows || [])
    .slice(0, limit)
    .map((hub) => ({
      task_id: hub.task_id,
      title: hub.title,
      status: hub.status,
      review_lane: hub.review_lane,
      risk_tier: hub.risk_tier,
      source: hub.source,
      next_command: actionCommand(hub),
      dashboard_href: hub.dashboard_href,
      workstream_id: hub.workstream_id,
      workstream_label: hub.workstream_label,
      reason: hub.why_it_matters
    }));

  const lanes = [
    {
      id: 'runnable_now',
      label: 'Runnable Now',
      summary: `${runnableNow.length} ready or in-progress plans without detected incoming dependency links.`,
      rows: runnableNow
    },
    {
      id: 'dependency_watch',
      label: 'Dependency Watch',
      summary: `${dependencyWatch.length} runnable-looking plans have incoming dependency links to inspect first.`,
      rows: dependencyWatch
    },
    {
      id: 'map_repairs',
      label: 'Map Repairs',
      summary: `${mapRepairs.length} highest-priority map-confidence repair rows.`,
      rows: mapRepairs
    },
    {
      id: 'impact_review',
      label: 'Impact Review',
      summary: `${impactReview.length} structurally important connected plans to understand before broad execution.`,
      rows: impactReview
    }
  ];

  return {
    summary: 'Action lanes derived from plan status, dependency links, map-confidence gaps, and impact hubs.',
    lanes
  };
}

function buildProtocolReadiness(planSummaries, plans, clusters, limit = 24) {
  const rawById = new Map((planSummaries || []).map((plan) => [plan.task_id, plan.raw_plan]));
  const clusterByPlan = new Map();
  for (const cluster of clusters || []) {
    for (const planId of cluster.plan_ids || []) {
      clusterByPlan.set(planId, cluster);
    }
  }

  const checks = [
    {
      id: 'current_state',
      label: 'Current State',
      missing_field: 'current_state',
      repair: 'Record what is true now before execution or delegation.'
    },
    {
      id: 'question_work',
      label: 'Question / Work',
      missing_field: 'question_work',
      repair: 'Record the bounded question or work-unit for the actor.'
    },
    {
      id: 'desired_state',
      label: 'Desired State',
      missing_field: 'desired_state',
      repair: 'Record what should be true when the actor returns.'
    },
    {
      id: 'bounded_steps',
      label: 'Bounded steps',
      missing_field: 'bounded_plan.steps',
      repair: 'Add bounded steps so execution progress is auditable.'
    },
    {
      id: 'review_lane',
      label: 'Review lane',
      missing_field: 'routing_expectations.review_lane',
      repair: 'Set verify-local, codex-bridge, operator-gate, or another explicit review lane.'
    },
    {
      id: 'risk_tier',
      label: 'Risk tier',
      missing_field: 'routing_expectations.risk_tier',
      repair: 'Set risk tier so routing and review can match work altitude.'
    },
    {
      id: 'completion_evidence',
      label: 'Completion evidence',
      missing_field: 'evidence',
      repair: 'Attach verification evidence before treating complete work as durable.'
    }
  ];

  const hasToken = (rawPlan, token) => {
    if (!rawPlan) return false;
    return JSON.stringify(rawPlan).toLowerCase().includes(token);
  };
  const present = (plan, rawPlan, checkId) => {
    if (checkId === 'current_state') return hasToken(rawPlan, 'current_state');
    if (checkId === 'question_work') return hasToken(rawPlan, 'question_work') || hasToken(rawPlan, 'question / work');
    if (checkId === 'desired_state') return hasToken(rawPlan, 'desired_state');
    if (checkId === 'bounded_steps') return plan.step_counts.total > 0;
    if (checkId === 'review_lane') return Boolean(plan.review_lane && !['not-recorded', 'unknown'].includes(plan.review_lane));
    if (checkId === 'risk_tier') return Boolean(plan.risk_tier && !['not-recorded', 'unknown'].includes(plan.risk_tier));
    if (checkId === 'completion_evidence') return plan.status !== 'complete' || hasToken(rawPlan, 'evidence');
    return false;
  };
  const planHref = (plan) => {
    const cluster = clusterByPlan.get(plan.task_id);
    return cluster
      ? `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(plan.task_id)}`
      : `plan-visibility__current.html#plan=${encodeURIComponent(plan.task_id)}`;
  };
  const recommendedCommand = (missing, plan) => {
    if (plan.status === 'unreadable') return `inspect ${plan.path}`;
    if (missing.includes('bounded_plan.steps') || missing.includes('current_state') || missing.includes('question_work') || missing.includes('desired_state')) {
      return `/amend-plan ${plan.task_id}`;
    }
    if (missing.includes('routing_expectations.review_lane') || missing.includes('routing_expectations.risk_tier')) {
      return `/amend-plan ${plan.task_id}`;
    }
    if (missing.includes('evidence')) return `/review-progress ${plan.task_id}`;
    return plan.next_command || `/review-task-plan ${plan.task_id}`;
  };

  const rows = (plans || []).map((plan) => {
    const rawPlan = rawById.get(plan.task_id);
    const missingChecks = checks.filter((check) => !present(plan, rawPlan, check.id));
    const missing = missingChecks.map((check) => check.missing_field);
    const cluster = clusterByPlan.get(plan.task_id);
    const state = missing.length ? 'needs_protocol_repair' : 'protocol_ready';
    return {
      task_id: plan.task_id,
      title: plan.title,
      status: plan.status,
      protocol_state: state,
      missing_fields: missing,
      missing_count: missing.length,
      review_lane: plan.review_lane,
      risk_tier: plan.risk_tier,
      source: plan.path,
      dashboard_href: planHref(plan),
      workstream_id: cluster?.id || null,
      workstream_label: cluster?.label || 'not linked',
      recommended_command: recommendedCommand(missing, plan),
      reason: missing.length
        ? `Missing ${missing.join(', ')}.`
        : 'Carries current-state, work, desired-state, bounded steps, routing, and completion-evidence requirements for its current status.'
    };
  });

  const statusOrder = { needs_protocol_repair: 0, protocol_ready: 1 };
  const planStatusOrder = { ready: 0, in_progress: 1, needs_review: 2, blocked: 3, planned: 4, complete: 5, unreadable: 6 };
  const sortedRows = rows.sort((a, b) => {
    return (statusOrder[a.protocol_state] ?? 9) - (statusOrder[b.protocol_state] ?? 9)
      || b.missing_count - a.missing_count
      || (planStatusOrder[a.status] ?? 9) - (planStatusOrder[b.status] ?? 9)
      || a.task_id.localeCompare(b.task_id);
  });

  const totals = {
    visible_plans: rows.length,
    protocol_ready: rows.filter((row) => row.protocol_state === 'protocol_ready').length,
    needs_protocol_repair: rows.filter((row) => row.protocol_state === 'needs_protocol_repair').length
  };
  const checkRows = checks.map((check) => {
    const missingRows = rows.filter((row) => row.missing_fields.includes(check.missing_field));
    return {
      id: check.id,
      label: check.label,
      missing_field: check.missing_field,
      present_count: rows.length - missingRows.length,
      missing_count: missingRows.length,
      repair: check.repair,
      sample: missingRows.slice(0, 5).map((row) => row.task_id)
    };
  });

  return {
    summary: `${totals.protocol_ready} of ${totals.visible_plans} visible plans carry the protocol fields needed for routed execution and handoff; ${totals.needs_protocol_repair} need repair before treating the dashboard as execution authority.`,
    totals,
    checks: checkRows,
    rows: sortedRows.slice(0, limit)
  };
}

function buildExecutionReadiness(planActionBoard, protocolReadiness, limit = 8) {
  const protocolByPlan = new Map((protocolReadiness?.rows || []).map((row) => [row.task_id, row]));
  const laneRows = (laneId) => (planActionBoard?.lanes || []).find((lane) => lane.id === laneId)?.rows || [];
  const reviewFirstCommand = (row) => `/review-task-plan ${row.task_id}`;
  const toRow = (sourceLane, row, readiness, reason, command) => {
    const protocol = protocolByPlan.get(row.task_id);
    return {
      task_id: row.task_id,
      title: row.title,
      source_lane: sourceLane,
      readiness,
      status: row.status,
      review_lane: row.review_lane,
      risk_tier: row.risk_tier,
      missing_protocol_fields: protocol?.missing_fields || [],
      dashboard_href: row.dashboard_href || `plan-visibility__current.html#plan=${encodeURIComponent(row.task_id)}`,
      source: row.source,
      recommended_command: command || protocol?.recommended_command || row.next_command || `/review-task-plan ${row.task_id}`,
      reason
    };
  };

  const runnable = laneRows('runnable_now');
  const dependencyWatch = laneRows('dependency_watch');
  const mapRepairs = laneRows('map_repairs');
  const impactReview = laneRows('impact_review');

  const routeable = runnable
    .filter((row) => (protocolByPlan.get(row.task_id)?.protocol_state || 'needs_protocol_repair') === 'protocol_ready')
    .slice(0, limit)
    .map((row) => toRow(
      'runnable_now',
      row,
      'ready_to_route',
      'Runnable candidate with protocol-readiness fields present and no incoming dependency-watch edge in the current model.',
      row.next_command
    ));

  const protocolRepairFirst = runnable
    .filter((row) => (protocolByPlan.get(row.task_id)?.protocol_state || 'needs_protocol_repair') !== 'protocol_ready')
    .slice(0, limit)
    .map((row) => {
      const protocol = protocolByPlan.get(row.task_id);
      return toRow(
        'runnable_now',
        row,
        'protocol_repair_first',
        `Runnable-looking candidate, but missing ${(protocol?.missing_fields || []).join(', ') || 'protocol fields'}.`,
        protocol?.recommended_command || `/amend-plan ${row.task_id}`
      );
    });

  const dependencyFirst = dependencyWatch
    .slice(0, limit)
    .map((row) => toRow(
      'dependency_watch',
      row,
      'dependency_review_first',
      row.reason || 'Runnable-looking candidate with incoming dependency links; inspect upstream plans first.',
      reviewFirstCommand(row)
    ));

  const mapRepairFirst = mapRepairs
    .slice(0, limit)
    .map((row) => toRow(
      'map_repairs',
      row,
      'map_repair_first',
      row.reason || 'Map-confidence repair is needed before relying on this plan map entry.',
      row.next_command
    ));

  const impactFirst = impactReview
    .slice(0, limit)
    .map((row) => toRow(
      'impact_review',
      row,
      'impact_review_first',
      row.reason || 'Structurally important plan; inspect its workstream context before broad execution.',
      row.next_command
    ));

  const lanes = [
    {
      id: 'ready_to_route',
      label: 'Ready To Route',
      summary: `${routeable.length} runnable candidates have protocol-readiness fields present.`,
      rows: routeable
    },
    {
      id: 'protocol_repair_first',
      label: 'Protocol Repair First',
      summary: `${protocolRepairFirst.length} runnable-looking candidates need actor-continuity or routing fields before execution.`,
      rows: protocolRepairFirst
    },
    {
      id: 'dependency_review_first',
      label: 'Dependency Review First',
      summary: `${dependencyFirst.length} runnable-looking candidates have incoming dependency links to inspect.`,
      rows: dependencyFirst
    },
    {
      id: 'map_repair_first',
      label: 'Map Repair First',
      summary: `${mapRepairFirst.length} map-confidence repair candidates affect dashboard trust.`,
      rows: mapRepairFirst
    },
    {
      id: 'impact_review_first',
      label: 'Impact Review First',
      summary: `${impactFirst.length} structurally important connected plans should be understood before broad execution.`,
      rows: impactFirst
    }
  ];

  return {
    summary: 'Execution readiness combines action-lane membership with protocol readiness, dependency watch, map confidence, and impact-review context.',
    lanes
  };
}

function buildRoutingBlockers(executionReadiness, protocolReadiness) {
  const laneRows = (laneId) => (executionReadiness?.lanes || []).find((lane) => lane.id === laneId)?.rows || [];
  const readyRows = laneRows('ready_to_route');
  const blockerLaneIds = ['protocol_repair_first', 'dependency_review_first', 'map_repair_first', 'impact_review_first'];
  const blockers = blockerLaneIds.map((id) => {
    const lane = (executionReadiness?.lanes || []).find((item) => item.id === id) || { id, label: id, rows: [] };
    const first = (lane.rows || [])[0];
    return {
      id: lane.id,
      label: lane.label,
      count: (lane.rows || []).length,
      first_task_id: first?.task_id || 'none',
      reason: first?.reason || lane.summary || 'No current blocker rows in this lane.',
      command: first?.recommended_command || 'none',
      href: first?.dashboard_href || 'plan-visibility__index.html#execution-readiness'
    };
  });
  const topBlocker = blockers
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0] || null;
  const protocolTotals = protocolReadiness?.totals || {};

  return {
    summary: readyRows.length
      ? `${readyRows.length} action candidates are ready to route; inspect blocker lanes for nearby repair work.`
      : `No action candidates are ready to route. Start with ${topBlocker ? topBlocker.label : 'Protocol Readiness'} to clear the first blocker lane.`,
    ready_to_route: readyRows.length,
    blocker_total: blockers.reduce((total, item) => total + item.count, 0),
    protocol_ready: protocolTotals.protocol_ready || 0,
    protocol_repairs: protocolTotals.needs_protocol_repair || 0,
    top_blocker: topBlocker,
    blockers
  };
}

function buildFirstRepairPath(executionReadiness, routingBlockers, limit = 5) {
  const lanes = executionReadiness?.lanes || [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const routeable = laneById.get('ready_to_route')?.rows || [];
  const orderedLaneIds = routeable.length
    ? ['ready_to_route', 'protocol_repair_first', 'dependency_review_first', 'map_repair_first', 'impact_review_first']
    : ['protocol_repair_first', 'dependency_review_first', 'map_repair_first', 'impact_review_first', 'ready_to_route'];
  const stepCopy = {
    ready_to_route: {
      id: 'route-ready',
      label: 'Route Ready Work',
      why_first: 'A routeable action candidate already carries protocol fields and can proceed through its declared review lane.',
      effect: 'Moves an already prepared plan into execution rather than adding more analysis debt.'
    },
    protocol_repair_first: {
      id: 'repair-protocol',
      label: 'Repair Protocol Fields',
      why_first: 'Actor-continuity fields come before delegation or execution because they define current state, bounded work, desired state, review lane, risk, and evidence.',
      effect: 'Turns ready-looking work into routeable work with auditable handoff context.'
    },
    dependency_review_first: {
      id: 'review-dependencies',
      label: 'Review Dependencies',
      why_first: 'Incoming dependency links can change what is safe to execute first.',
      effect: 'Prevents routing downstream work before upstream context is understood.'
    },
    map_repair_first: {
      id: 'repair-map',
      label: 'Repair Map Metadata',
      why_first: 'Map-confidence gaps make the dashboard less reliable as a routing surface.',
      effect: 'Improves relationship, lane, and source navigation before broader execution.'
    },
    impact_review_first: {
      id: 'review-impact',
      label: 'Review Impact Hubs',
      why_first: 'Highly connected plans can affect multiple workstreams and need context before broad execution.',
      effect: 'Avoids treating structurally important work as an isolated task.'
    }
  };

  const steps = [];
  for (const laneId of orderedLaneIds) {
    const lane = laneById.get(laneId);
    const first = (lane?.rows || [])[0];
    if (!lane || !first) continue;
    const copy = stepCopy[laneId] || {
      id: laneId,
      label: lane.label || laneId,
      why_first: lane.summary || 'This lane has current repair work.',
      effect: 'Clears the next visible routing constraint.'
    };
    steps.push({
      id: copy.id,
      lane_id: laneId,
      label: copy.label,
      lane_label: lane.label,
      task_id: first.task_id,
      status: first.status,
      reason: first.reason || lane.summary || 'No reason recorded.',
      why_first: copy.why_first,
      effect: copy.effect,
      command: first.recommended_command || first.next_command || 'not-recorded',
      href: first.dashboard_href || 'plan-visibility__current.html',
      source: first.source || null
    });
    if (steps.length >= limit) break;
  }

  const firstStep = steps[0] || null;
  return {
    summary: firstStep
      ? `First repair path starts with ${firstStep.label}: ${firstStep.task_id}.`
      : 'No first repair path is available from the current execution-readiness lanes.',
    ready_to_route: routingBlockers?.ready_to_route || 0,
    blocker_total: routingBlockers?.blocker_total || 0,
    recommended_first_step: firstStep,
    steps
  };
}

function buildRiskGateQueue(plans, protocolReadiness, clusters, limit = 16) {
  const protocolByPlan = new Map((protocolReadiness?.rows || []).map((row) => [row.task_id, row]));
  const clusterByPlan = new Map();
  for (const cluster of clusters || []) {
    for (const planId of cluster.plan_ids || []) {
      clusterByPlan.set(planId, cluster);
    }
  }

  const rows = (plans || [])
    .filter((plan) => ['ready', 'in_progress'].includes(plan.status))
    .filter((plan) => (
      (plan.quality_flags || []).includes('high_risk_ready')
      || ['high', 'medium', 'low-medium'].includes(String(plan.risk_tier || '').toLowerCase())
      || ['operator-gate', 'codex-bridge'].includes(plan.review_lane)
    ))
    .map((plan) => {
      const protocol = protocolByPlan.get(plan.task_id);
      const cluster = clusterByPlan.get(plan.task_id);
      const gate = riskGateOwner(plan);
      const protocolMissing = protocol?.missing_fields || [];
      const command = protocolMissing.length
        ? (protocol?.recommended_command || `/amend-plan ${plan.task_id}`)
        : riskGateCommand(plan, gate);
      return {
        task_id: plan.task_id,
        title: plan.title,
        status: plan.status,
        gate_owner: gate.owner,
        gate_label: gate.label,
        review_lane: plan.review_lane,
        risk_tier: plan.risk_tier,
        protocol_state: protocol?.protocol_state || 'unknown',
        missing_protocol_fields: protocolMissing,
        quality_flags: plan.quality_flags || [],
        reason: riskGateReason(plan, protocolMissing),
        recommended_command: command,
        source: plan.path,
        workstream_id: cluster?.id || 'none',
        workstream_label: cluster?.label || 'not linked',
        dashboard_href: cluster
          ? `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(plan.task_id)}`
          : `plan-visibility__current.html#plan=${encodeURIComponent(plan.task_id)}`
      };
    })
    .sort((a, b) => (
      riskGatePriority(a) - riskGatePriority(b)
      || statusPriority(a.status) - statusPriority(b.status)
      || a.task_id.localeCompare(b.task_id)
    ));

  const totals = {
    candidates: rows.length,
    operator_gate: rows.filter((row) => row.gate_owner === 'operator-gate').length,
    codex_bridge: rows.filter((row) => row.gate_owner === 'codex-bridge').length,
    protocol_repair: rows.filter((row) => row.gate_owner === 'protocol-repair').length,
    verify_local: rows.filter((row) => row.gate_owner === 'verify-local').length
  };

  return {
    summary: rows.length
      ? `${rows.length} ready or in-progress plans need explicit gate interpretation before execution; ${Math.min(rows.length, limit)} highest-priority rows are shown.`
      : 'No ready or in-progress plans currently need a risk-gate queue.',
    totals,
    rows: rows.slice(0, limit)
  };
}

function buildCommandRunbook(surfaces, limitPerGroup = 8) {
  const entries = [];
  const add = (row) => {
    if (!row?.command || row.command === 'not-recorded' || row.command === 'none') return;
    entries.push({
      task_id: row.task_id || 'not-recorded',
      command: row.command,
      verb: commandVerb(row.command),
      purpose: row.purpose || commandPurpose(commandVerb(row.command)),
      source_surface: row.source_surface || 'not-recorded',
      gate_or_lane: row.gate_or_lane || row.lane_label || row.gate_label || row.readiness || 'not-recorded',
      reason: row.reason || 'No reason recorded.',
      dashboard_href: row.dashboard_href || row.href || 'plan-visibility__current.html',
      source: row.source || null
    });
  };

  for (const step of surfaces.firstRepairPath?.steps || []) {
    add({
      task_id: step.task_id,
      command: step.command,
      purpose: 'First repair path',
      source_surface: 'first_repair_path',
      gate_or_lane: step.lane_label,
      reason: step.why_first || step.reason,
      dashboard_href: step.href,
      source: step.source
    });
  }

  for (const row of surfaces.riskGateQueue?.rows || []) {
    add({
      task_id: row.task_id,
      command: row.recommended_command,
      purpose: `${row.gate_label || 'Risk'} gate`,
      source_surface: 'risk_gate_queue',
      gate_or_lane: row.gate_label,
      reason: row.reason,
      dashboard_href: row.dashboard_href,
      source: row.source
    });
  }

  for (const lane of surfaces.executionReadiness?.lanes || []) {
    for (const row of lane.rows || []) {
      add({
        task_id: row.task_id,
        command: row.recommended_command,
        purpose: lane.label,
        source_surface: 'execution_readiness',
        gate_or_lane: lane.label,
        reason: row.reason,
        dashboard_href: row.dashboard_href,
        source: row.source
      });
    }
  }

  for (const lane of surfaces.planActionBoard?.lanes || []) {
    for (const row of lane.rows || []) {
      add({
        task_id: row.task_id,
        command: row.next_command,
        purpose: lane.label,
        source_surface: 'plan_action_board',
        gate_or_lane: lane.label,
        reason: row.reason,
        dashboard_href: row.dashboard_href,
        source: row.source
      });
    }
  }

  for (const row of surfaces.protocolReadiness?.rows || []) {
    add({
      task_id: row.task_id,
      command: row.recommended_command,
      purpose: row.protocol_state === 'protocol_ready' ? 'Protocol-ready review' : 'Protocol repair',
      source_surface: 'protocol_readiness',
      gate_or_lane: row.protocol_state,
      reason: row.reason,
      dashboard_href: row.dashboard_href,
      source: row.source
    });
  }

  for (const drilldown of surfaces.workstreamDrilldowns?.drilldowns || []) {
    for (const slice of drilldown.slices || []) {
      const next = slice.suggested_next;
      add({
        task_id: next?.task_id,
        command: next?.next_command,
        purpose: `${slice.label} workstream slice`,
        source_surface: 'workstream_drilldowns',
        gate_or_lane: drilldown.label,
        reason: `${slice.ready_like} ready/in-progress plans in this slice; suggested next is ${next?.task_id || 'none'}.`,
        dashboard_href: next?.dashboard_href || drilldown.dashboard_href,
        source: next?.source
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.verb}\n${entry.command}\n${entry.task_id}\n${entry.source_surface}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  const byVerb = new Map();
  for (const entry of unique) {
    const bucket = byVerb.get(entry.verb) || [];
    bucket.push(entry);
    byVerb.set(entry.verb, bucket);
  }

  const groups = [...byVerb.entries()]
    .map(([verb, rows]) => ({
      verb,
      purpose: commandPurpose(verb),
      count: rows.length,
      rows: rows.slice(0, limitPerGroup)
    }))
    .sort((a, b) => commandVerbPriority(a.verb) - commandVerbPriority(b.verb) || b.count - a.count || a.verb.localeCompare(b.verb));

  const shown = groups.reduce((total, group) => total + group.rows.length, 0);
  return {
    summary: unique.length
      ? `${unique.length} current command suggestions grouped into ${groups.length} command verbs; ${shown} rows are shown.`
      : 'No current command suggestions were available from the derived plan surfaces.',
    total_commands: unique.length,
    shown_commands: shown,
    groups,
    first_command: groups[0]?.rows?.[0] || null
  };
}

function commandVerb(command) {
  const [first] = String(command || '').trim().split(/\s+/);
  return first || 'not-recorded';
}

function commandPurpose(verb) {
  if (verb === '/amend-plan') return 'Repair plan metadata before routing.';
  if (verb === '/review-task-plan') return 'Review a generated plan before execution.';
  if (verb === '/run-plan') return 'Route an approved plan through execution.';
  if (verb === '/review-progress') return 'Review progress or evidence before closure.';
  if (verb === 'inspect') return 'Inspect a source artifact manually.';
  if (verb === 'npm') return 'Regenerate or inspect derived dashboard artifacts.';
  return 'Follow the exact command suggested by the source surface.';
}

function commandVerbPriority(verb) {
  const priority = {
    '/amend-plan': 0,
    '/review-task-plan': 1,
    '/review-progress': 2,
    '/run-plan': 3,
    inspect: 4,
    npm: 5
  };
  return priority[verb] ?? 9;
}

function buildOrchestrationRoutingBoard(plans, protocolReadiness, riskGateQueue, clusters, limitPerLane = 8) {
  const protocolByPlan = new Map((protocolReadiness?.rows || []).map((row) => [row.task_id, row]));
  const riskByPlan = new Map((riskGateQueue?.rows || []).map((row) => [row.task_id, row]));
  const clusterByPlan = new Map();
  for (const cluster of clusters || []) {
    for (const planId of cluster.plan_ids || []) {
      clusterByPlan.set(planId, cluster);
    }
  }

  const dashboardHref = (plan) => {
    const cluster = clusterByPlan.get(plan.task_id);
    return cluster
      ? `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(plan.task_id)}`
      : `plan-visibility__current.html#plan=${encodeURIComponent(plan.task_id)}`;
  };
  const commandFor = (plan, protocol, route) => {
    if (protocol?.missing_fields?.length) return protocol.recommended_command || `/amend-plan ${plan.task_id}`;
    if (route?.id === 'route_unspecified') return `/amend-plan ${plan.task_id}`;
    if (route?.id === 'operator_gate') return `/review-task-plan ${plan.task_id}`;
    if (route?.id === 'codex_bridge') return `/review-task-plan ${plan.task_id}`;
    return plan.next_command || (plan.status === 'ready' ? `/run-plan ${plan.task_id}` : `/review-task-plan ${plan.task_id}`);
  };
  const routeFor = (plan, protocol) => {
    const missing = protocol?.missing_fields || [];
    if (missing.length) {
      return {
        id: 'repair_before_dispatch',
        label: 'Repair Before Dispatch',
        owner: 'coordinator',
        actor: 'Coordinator repairs the plan before any worker or reviewer actor receives it.',
        reason: `Missing protocol fields: ${missing.join(', ')}.`
      };
    }
    if (plan.review_lane === 'operator-gate') {
      return {
        id: 'operator_gate',
        label: 'Operator Gate',
        owner: 'human operator',
        actor: 'Human operator decision or approval is required before execution proceeds.',
        reason: 'Plan declares operator-gate review lane.'
      };
    }
    if (plan.review_lane === 'codex-bridge') {
      return {
        id: 'codex_bridge',
        label: 'Codex Bridge',
        owner: 'distinct review actor',
        actor: 'Dispatch a distinct Codex bridge/reviewer actor for cross-checking before acceptance.',
        reason: 'Plan declares codex-bridge review lane.'
      };
    }
    if (plan.review_lane === 'verify-local') {
      return {
        id: 'verify_local',
        label: 'Verify Local',
        owner: 'current Codex session',
        actor: 'Current Codex session can verify with deterministic local commands.',
        reason: 'Plan declares verify-local review lane.'
      };
    }
    return {
      id: 'route_unspecified',
      label: 'Route Unspecified',
      owner: 'coordinator',
      actor: 'Coordinator must set explicit review lane and risk tier before routing.',
      reason: 'Review lane is missing or not recognized.'
    };
  };

  const lanes = [
    orchestrationLane('repair_before_dispatch', 'Repair Before Dispatch', 'Coordinator repairs actor-continuity, bounded-step, routing, risk, or evidence fields before delegation.'),
    orchestrationLane('operator_gate', 'Operator Gate', 'Human operator judgment or approval is required before the work can proceed.'),
    orchestrationLane('codex_bridge', 'Codex Bridge', 'A distinct review actor should cross-check assumptions, code, or consequential output before acceptance.'),
    orchestrationLane('verify_local', 'Verify Local', 'The current Codex session can verify with deterministic local commands and recorded evidence.'),
    orchestrationLane('route_unspecified', 'Route Unspecified', 'Routing metadata is missing or unrecognized and must be amended before execution authority is clear.')
  ];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));

  for (const plan of plans || []) {
    if (!['ready', 'in_progress', 'planned', 'needs_review'].includes(plan.status)) continue;
    const protocol = protocolByPlan.get(plan.task_id);
    const route = routeFor(plan, protocol);
    const risk = riskByPlan.get(plan.task_id);
    const lane = laneById.get(route.id);
    if (!lane) continue;
    const cluster = clusterByPlan.get(plan.task_id);
    lane.rows.push({
      task_id: plan.task_id,
      title: plan.title,
      status: plan.status,
      review_lane: plan.review_lane,
      risk_tier: plan.risk_tier,
      protocol_state: protocol?.protocol_state || 'unknown',
      missing_protocol_fields: protocol?.missing_fields || [],
      quality_flags: plan.quality_flags || [],
      route_owner: route.owner,
      actor_route: route.actor,
      reason: risk?.reason || route.reason,
      recommended_command: commandFor(plan, protocol, route),
      dashboard_href: dashboardHref(plan),
      source: plan.path,
      workstream_id: cluster?.id || 'none',
      workstream_label: cluster?.label || 'not linked'
    });
  }

  for (const lane of lanes) {
    lane.count = lane.rows.length;
    lane.rows = lane.rows
      .sort((a, b) => statusPriority(a.status) - statusPriority(b.status) || riskTierPriority(a.risk_tier) - riskTierPriority(b.risk_tier) || a.task_id.localeCompare(b.task_id))
      .slice(0, limitPerLane);
    lane.first_task_id = lane.rows[0]?.task_id || 'none';
    lane.first_command = lane.rows[0]?.recommended_command || 'none';
  }

  const totals = lanes.reduce((acc, lane) => {
    acc[lane.id] = lane.count;
    return acc;
  }, {});
  return {
    summary: `${(plans || []).length} visible plans classified by orchestration route; repair-before-dispatch and explicit review lanes come before execution.`,
    totals,
    lanes,
    first_route: lanes.find((lane) => lane.rows.length)?.rows[0] || null
  };
}

function orchestrationLane(id, label, purpose) {
  return { id, label, purpose, count: 0, first_task_id: 'none', first_command: 'none', rows: [] };
}

function riskTierPriority(riskTier) {
  const risk = String(riskTier || '').toLowerCase();
  if (risk === 'high') return 0;
  if (risk === 'medium-high') return 1;
  if (risk === 'medium') return 2;
  if (risk === 'low-medium') return 3;
  if (risk === 'low') return 4;
  return 5;
}

function riskGateOwner(plan) {
  if (!plan.review_lane || ['not-recorded', 'unknown'].includes(plan.review_lane)) {
    return { owner: 'protocol-repair', label: 'Protocol Repair' };
  }
  if (plan.review_lane === 'operator-gate') return { owner: 'operator-gate', label: 'Operator Gate' };
  if (plan.review_lane === 'codex-bridge') return { owner: 'codex-bridge', label: 'Codex Bridge' };
  return { owner: 'verify-local', label: 'Verify Local' };
}

function riskGatePriority(row) {
  const priority = {
    'protocol-repair': 0,
    'operator-gate': 1,
    'codex-bridge': 2,
    'verify-local': 3
  };
  const risk = String(row.risk_tier || '').toLowerCase();
  const riskScore = risk === 'high' ? 0 : risk === 'medium' || risk === 'low-medium' ? 1 : 2;
  return (priority[row.gate_owner] ?? 9) * 10 + riskScore;
}

function riskGateReason(plan, missingProtocolFields) {
  if (missingProtocolFields.length) {
    return `Protocol fields missing before execution: ${missingProtocolFields.join(', ')}.`;
  }
  if (plan.review_lane === 'operator-gate') return 'Human operator approval or judgment is required before execution.';
  if (plan.review_lane === 'codex-bridge') return 'Distinct review is required before treating this ready-looking item as clear.';
  if ((plan.quality_flags || []).includes('high_risk_ready')) return 'Ready-looking plan carries a non-low risk tier.';
  return 'Ready-looking plan has explicit review and risk metadata.';
}

function riskGateCommand(plan, gate) {
  if (gate?.owner === 'operator-gate' || gate?.owner === 'codex-bridge') {
    return `/review-task-plan ${plan.task_id}`;
  }
  if (gate?.owner === 'protocol-repair') {
    return `/amend-plan ${plan.task_id}`;
  }
  return plan.next_command || `/review-task-plan ${plan.task_id}`;
}

function buildWorkstreamDrilldowns(plans, relationships, clusters, options = {}) {
  const workstreamLimit = Number.isFinite(options.workstreamLimit) ? options.workstreamLimit : 5;
  const sliceLimit = Number.isFinite(options.sliceLimit) ? options.sliceLimit : 6;
  const byId = new Map((plans || []).map((plan) => [plan.task_id, plan]));
  const visibleClusters = (clusters || [])
    .filter((cluster) => (cluster.plan_ids || []).length > 1)
    .slice(0, workstreamLimit);

  const drilldowns = visibleClusters.map((cluster) => {
    const planIds = new Set(cluster.plan_ids || []);
    const clusterPlans = [...planIds].map((taskId) => byId.get(taskId)).filter(Boolean);
    const internalRelationships = (relationships || []).filter((relationship) => (
      planIds.has(relationship.source)
      && planIds.has(relationship.target)
    ));
    const frameworkGroups = new Map();
    for (const plan of clusterPlans) {
      const key = plan.framework || 'not-recorded';
      const group = frameworkGroups.get(key) || [];
      group.push(plan);
      frameworkGroups.set(key, group);
    }
    const slices = [...frameworkGroups.entries()]
      .map(([framework, groupPlans]) => {
        const groupIds = new Set(groupPlans.map((plan) => plan.task_id));
        const groupRelationships = internalRelationships.filter((relationship) => (
          groupIds.has(relationship.source)
          || groupIds.has(relationship.target)
        ));
        const statuses = countBy(groupPlans, 'status');
        const reviewLanes = countBy(groupPlans, 'review_lane');
        const risks = countBy(groupPlans, 'risk_tier');
        const qualityFlags = {};
        for (const plan of groupPlans) {
          for (const flag of plan.quality_flags || []) {
            qualityFlags[flag] = (qualityFlags[flag] || 0) + 1;
          }
        }
        const nextPlan = groupPlans
          .slice()
          .sort((a, b) => statusPriority(a.status) - statusPriority(b.status) || a.task_id.localeCompare(b.task_id))[0];
        return {
          slice_id: `${cluster.id}:${slugify(framework)}`,
          cluster_id: cluster.id,
          cluster_label: cluster.label,
          label: titleCaseWords(String(framework || 'not-recorded').replace(/\//g, ' ')),
          framework,
          plans: groupPlans.length,
          relationships: groupRelationships.length,
          ready_like: (statuses.ready || 0) + (statuses.in_progress || 0),
          attention: (statuses.blocked || 0) + (statuses.needs_review || 0) + (statuses.unreadable || 0),
          status_mix: topEntries(statuses, 4),
          review_lanes: topEntries(reviewLanes, 3),
          risk_tiers: topEntries(risks, 3),
          quality_flags: topEntries(qualityFlags, 4),
          top_intents: topEntries(countRelationshipsBy(groupRelationships, 'intent'), 4),
          suggested_next: nextPlan ? {
            task_id: nextPlan.task_id,
            status: nextPlan.status,
            next_command: nextPlan.next_command,
            next_step: `${nextPlan.next_step?.step_id || 'none'}: ${nextPlan.next_step?.description || 'No next step recorded.'}`,
            dashboard_href: `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(nextPlan.task_id)}`,
            source: nextPlan.path
          } : null
        };
      })
      .sort((a, b) => (
        b.ready_like - a.ready_like
        || b.plans - a.plans
        || b.relationships - a.relationships
        || a.label.localeCompare(b.label)
      ))
      .slice(0, sliceLimit);

    return {
      cluster_id: cluster.id,
      label: cluster.label,
      plans: clusterPlans.length,
      relationships: internalRelationships.length,
      summary: `${cluster.label || cluster.id} contains ${clusterPlans.length} plans across ${frameworkGroups.size} framework slices; ${slices.length} highest-priority slices are shown.`,
      dashboard_href: `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}`,
      brief_href: `visual-plans/${encodeURIComponent(cluster.id)}.md`,
      slices
    };
  });

  const largest = drilldowns[0] || null;
  return {
    summary: largest
      ? `${drilldowns.length} connected workstreams have drilldowns; largest is ${largest.label} with ${largest.plans} plans.`
      : 'No multi-plan workstreams are available for drilldown.',
    total_workstreams: (clusters || []).length,
    shown_workstreams: drilldowns.length,
    drilldowns
  };
}

function slugify(value) {
  return String(value || 'none')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'none';
}

function buildActionPaths(plans, relationships, clusters) {
  const actionIntents = new Set(['dependency', 'sequence', 'review', 'hierarchy']);
  const byId = new Map(plans.map((plan) => [plan.task_id, plan]));
  const clusterByPlan = new Map();
  for (const cluster of clusters) {
    for (const planId of cluster.plan_ids || []) {
      clusterByPlan.set(planId, {
        id: cluster.id,
        label: cluster.label || cluster.id
      });
    }
  }

  const incoming = new Map();
  const outgoing = new Map();
  for (const relationship of relationships) {
    if (!actionIntents.has(relationship.intent)) continue;
    if (!byId.has(relationship.source) || !byId.has(relationship.target)) continue;
    const inList = incoming.get(relationship.target) || [];
    inList.push(relationship);
    incoming.set(relationship.target, inList);
    const outList = outgoing.get(relationship.source) || [];
    outList.push(relationship);
    outgoing.set(relationship.source, outList);
  }

  const statusPriority = { ready: 0, in_progress: 1, needs_review: 2, blocked: 3, planned: 4, complete: 5, unreadable: 6 };
  return plans
    .map((plan) => {
      const upstream = incoming.get(plan.task_id) || [];
      const downstream = outgoing.get(plan.task_id) || [];
      if (!upstream.length && !downstream.length) return null;
      const cluster = clusterByPlan.get(plan.task_id) || { id: 'none', label: 'No relationship cluster' };
      return {
        task_id: plan.task_id,
        status: plan.status,
        framework: plan.framework,
        review_lane: plan.review_lane,
        risk_tier: plan.risk_tier,
        path: plan.path,
        next_step: plan.next_step,
        next_command: plan.next_command,
        upstream_count: upstream.length,
        downstream_count: downstream.length,
        upstream: summarizePathRelationships(upstream, 'source'),
        downstream: summarizePathRelationships(downstream, 'target'),
        cluster_id: cluster.id,
        cluster_label: cluster.label
      };
    })
    .filter(Boolean)
    .sort((a, b) => (
      (statusPriority[a.status] ?? 9) - (statusPriority[b.status] ?? 9)
      || b.upstream_count - a.upstream_count
      || b.downstream_count - a.downstream_count
      || a.task_id.localeCompare(b.task_id)
    ))
    .slice(0, 30);
}

function buildDependencySequenceChains(plans, relationships, clusters) {
  const chainIntents = new Set(['dependency', 'sequence']);
  const byId = new Map((plans || []).map((plan) => [plan.task_id, plan]));
  const clusterByPlan = new Map();
  for (const cluster of clusters || []) {
    for (const planId of cluster.plan_ids || []) {
      clusterByPlan.set(planId, {
        id: cluster.id,
        label: cluster.label || cluster.id
      });
    }
  }

  const edges = (relationships || [])
    .filter((relationship) => chainIntents.has(relationship.intent) && byId.has(relationship.source) && byId.has(relationship.target))
    .sort(compareChainRelationships);
  const outgoing = new Map();
  const incoming = new Map();
  for (const relationship of edges) {
    const outList = outgoing.get(relationship.source) || [];
    outList.push(relationship);
    outgoing.set(relationship.source, outList);
    const inList = incoming.get(relationship.target) || [];
    inList.push(relationship);
    incoming.set(relationship.target, inList);
  }

  const starts = [...new Set([
    ...edges.filter((relationship) => !(incoming.get(relationship.source) || []).length).map((relationship) => relationship.source),
    ...edges.map((relationship) => relationship.source)
  ])].sort((a, b) => statusPriority(byId.get(a)?.status) - statusPriority(byId.get(b)?.status) || a.localeCompare(b));

  const seen = new Set();
  const chains = [];
  for (const start of starts) {
    const planIds = [start];
    const chainEdges = [];
    const visited = new Set([start]);
    let current = start;

    while (chainEdges.length < 6) {
      const nextEdge = (outgoing.get(current) || [])
        .filter((relationship) => !visited.has(relationship.target))
        .sort(compareChainRelationships)[0];
      if (!nextEdge) break;
      chainEdges.push(nextEdge);
      planIds.push(nextEdge.target);
      visited.add(nextEdge.target);
      current = nextEdge.target;
    }

    if (!chainEdges.length) continue;
    const key = planIds.join('>');
    if (seen.has(key)) continue;
    seen.add(key);

    const chainPlans = planIds.map((taskId) => byId.get(taskId)).filter(Boolean);
    const firstActionable = chainPlans.find((plan) => !['complete', 'unreadable'].includes(plan.status)) || chainPlans[0];
    const cluster = chainPlans.map((plan) => clusterByPlan.get(plan.task_id)).find(Boolean) || { id: 'none', label: 'No relationship cluster' };
    const intents = [...new Set(chainEdges.map((relationship) => relationship.intent))];
    const readyCount = chainPlans.filter((plan) => ['ready', 'in_progress'].includes(plan.status)).length;
    const dependencyCount = chainEdges.filter((relationship) => relationship.intent === 'dependency').length;
    const startPlan = chainPlans[0];
    const endPlan = chainPlans[chainPlans.length - 1];
    const href = `plan-visibility__current.html#from=${encodeURIComponent(startPlan.task_id)}&to=${encodeURIComponent(endPlan.task_id)}`;
    chains.push({
      chain_id: `chain-${chains.length + 1}`,
      summary: planIds.join(' -> '),
      start_task_id: startPlan.task_id,
      end_task_id: endPlan.task_id,
      hops: chainEdges.length,
      plan_count: chainPlans.length,
      intents,
      ready_count: readyCount,
      dependency_count: dependencyCount,
      cluster_id: cluster.id,
      cluster_label: cluster.label,
      next_task_id: firstActionable?.task_id || 'none',
      next_command: firstActionable?.next_command || 'not-recorded',
      next_step: firstActionable?.next_step || { step_id: 'none', description: 'No next step recorded.' },
      dashboard_href: href,
      plans: chainPlans.map((plan) => ({
        task_id: plan.task_id,
        status: plan.status,
        review_lane: plan.review_lane,
        risk_tier: plan.risk_tier,
        next_command: plan.next_command
      })),
      relationships: chainEdges.map((relationship) => ({
        source: relationship.source,
        target: relationship.target,
        type: relationship.type,
        intent: relationship.intent,
        confidence: relationship.confidence,
        evidence: relationship.evidence
      }))
    });
  }

  return chains
    .sort((a, b) => (
      b.hops - a.hops
      || b.ready_count - a.ready_count
      || b.dependency_count - a.dependency_count
      || a.start_task_id.localeCompare(b.start_task_id)
    ))
    .slice(0, 12)
    .map((chain, index) => ({ ...chain, chain_id: `chain-${index + 1}` }));
}

function compareChainRelationships(a, b) {
  return (
    intentPriority(a.intent) - intentPriority(b.intent)
    || confidenceRank(a.confidence) - confidenceRank(b.confidence)
    || a.source.localeCompare(b.source)
    || a.target.localeCompare(b.target)
  );
}

function generatedVisualBriefExists(projectRoot, clusterId) {
  if (!projectRoot) return false;
  return fs.existsSync(path.join(projectRoot, '_dev', 'reports', 'analysis', 'visual-plans', `${clusterId}.md`));
}

function buildWorkstreamMatrix(plans, relationships, clusters, options = {}) {
  const byId = new Map(plans.map((plan) => [plan.task_id, plan]));
  const generatedClusterLimit = Number.isFinite(options.generatedClusterLimit)
    ? options.generatedClusterLimit
    : DEFAULT_VISUAL_CLUSTER_LIMIT;

  return clusters.map((cluster, index) => {
    const planIds = new Set(cluster.plan_ids || []);
    const clusterPlans = [...planIds].map((id) => byId.get(id)).filter(Boolean);
    const clusterRelationships = relationships.filter((relationship) => (
      planIds.has(relationship.source)
      && planIds.has(relationship.target)
    ));
    const intents = countRelationshipsBy(clusterRelationships, 'intent');
    const types = countRelationshipsBy(clusterRelationships, 'type');
    const statuses = countBy(clusterPlans, 'status');
    const readyLike = (statuses.ready || 0) + (statuses.in_progress || 0);
    const attention = (statuses.blocked || 0) + (statuses.needs_review || 0) + (statuses.unreadable || 0);

    return {
      cluster_id: cluster.id,
      label: cluster.label,
      label_reason: cluster.label_reason,
      plans: cluster.size,
      relationships: cluster.relationships,
      ready_like: readyLike,
      attention,
      top_intents: topEntries(intents, 4),
      top_sources: topEntries(types, 3),
      status_mix: topEntries(statuses, 5),
      suggested_next: cluster.next_plan,
      map_href: `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}${cluster.next_plan?.task_id && cluster.next_plan.task_id !== 'none' ? `&plan=${encodeURIComponent(cluster.next_plan.task_id)}` : ''}`,
      brief_href: `visual-plans/${encodeURIComponent(cluster.id)}.md`,
      brief_exists: index < generatedClusterLimit || generatedVisualBriefExists(options.projectRoot, cluster.id)
    };
  });
}

function buildWorkstreamStories(plans, relationships, clusters, relationshipHubs, limit = Number.MAX_SAFE_INTEGER) {
  const byId = new Map(plans.map((plan) => [plan.task_id, plan]));
  const hubsByCluster = new Map();
  for (const hub of relationshipHubs || []) {
    const rows = hubsByCluster.get(hub.cluster_id) || [];
    rows.push(hub);
    hubsByCluster.set(hub.cluster_id, rows);
  }

  return (clusters || []).slice(0, limit).map((cluster) => {
    const planIds = new Set(cluster.plan_ids || []);
    const clusterRelationships = relationships.filter((relationship) => (
      planIds.has(relationship.source)
      && planIds.has(relationship.target)
    ));
    const intents = topEntries(countRelationshipsBy(clusterRelationships, 'intent'), 5);
    const sources = topEntries(countRelationshipsBy(clusterRelationships, 'type'), 4);
    const examples = clusterRelationships
      .slice()
      .sort((a, b) => intentPriority(a.intent) - intentPriority(b.intent) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
      .slice(0, 6)
      .map((relationship) => ({
        source: relationship.source,
        target: relationship.target,
        type: relationship.type,
        intent: relationship.intent,
        source_status: byId.get(relationship.source)?.status || 'not-recorded',
        target_status: byId.get(relationship.target)?.status || 'not-recorded',
        evidence: truncateText(relationship.evidence, 180)
      }));
    const hubs = (hubsByCluster.get(cluster.id) || []).slice(0, 4).map((hub) => ({
      task_id: hub.task_id,
      role: hub.role,
      total: hub.total,
      incoming: hub.incoming,
      outgoing: hub.outgoing,
      top_intent: hub.top_intent
    }));
    const relationshipCount = Number(cluster.relationships) || 0;
    const planCount = Number(cluster.size) || 0;
    const baseExplanation = relationshipCount > 0
      ? `${cluster.label || cluster.id} connects ${planCount} ${planCount === 1 ? 'plan' : 'plans'} through ${relationshipCount} detected ${relationshipCount === 1 ? 'relationship' : 'relationships'}.`
      : `${cluster.label || cluster.id} is currently an isolated ${planCount === 1 ? 'plan' : 'workstream'} with no detected intra-workstream relationships.`;
    const explanationParts = [
      baseExplanation,
      intents.length ? `Dominant intents: ${formatEntryList(intents)}.` : 'No relationship intent is available yet.',
      cluster.next_plan?.task_id && cluster.next_plan.task_id !== 'none'
        ? `Suggested next: ${cluster.next_plan.task_id} (${cluster.next_plan.status}) because ${cluster.next_plan.reason}.`
        : 'No suggested next plan is available.'
    ];

    return {
      cluster_id: cluster.id,
      label: cluster.label,
      label_reason: cluster.label_reason,
      plans: cluster.size,
      relationships: cluster.relationships,
      explanation: explanationParts.join(' '),
      top_intents: intents,
      top_sources: sources,
      suggested_next: cluster.next_plan,
      bridge_plans: hubs,
      relationship_examples: examples,
      dashboard_href: `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}${cluster.next_plan?.task_id && cluster.next_plan.task_id !== 'none' ? `&plan=${encodeURIComponent(cluster.next_plan.task_id)}` : ''}`,
      brief_href: `visual-plans/${encodeURIComponent(cluster.id)}.md`
    };
  });
}

function summarizePathRelationships(relationships, endpointField) {
  return relationships
    .slice()
    .sort((a, b) => intentPriority(a.intent) - intentPriority(b.intent) || a[endpointField].localeCompare(b[endpointField]))
    .slice(0, 5)
    .map((relationship) => ({
      plan: relationship[endpointField],
      type: relationship.type,
      intent: relationship.intent,
      evidence: relationship.evidence
    }));
}

function intentPriority(intent) {
  const priority = { dependency: 0, sequence: 1, review: 2, hierarchy: 3 };
  return priority[intent] ?? 9;
}

function relationshipHubRole(incoming, outgoing) {
  if (incoming > 0 && outgoing > 0) return 'bridge';
  if (incoming > 0) return 'convergence';
  if (outgoing > 0) return 'driver';
  return 'isolated';
}

function summarizeClusterLabel(plans, topFramework, nextPlan) {
  if (!plans.length) {
    return { label: 'Empty workstream', reason: 'No plans were available for this cluster.' };
  }

  const frameworkLabel = topFramework?.label || 'not-recorded';
  const frameworkKey = frameworkLabel.toLowerCase();
  const frameworkUseful = !['none', 'not-recorded', 'no-framework-match', 'unknown', '(inherits from parent)'].includes(frameworkKey);
  if (frameworkUseful && topFramework.count >= Math.max(1, Math.ceil(plans.length / 3))) {
    return {
      label: `${titleCaseWords(frameworkLabel.replace(/\//g, ' '))} workstream`,
      reason: `${topFramework.count} of ${plans.length} plans share the ${frameworkLabel} framework; suggested next plan is ${nextPlan.task_id}.`
    };
  }

  const tokenCounts = new Map();
  for (const plan of plans) {
    const text = `${plan.task_id} ${plan.title || ''}`.toLowerCase();
    const tokens = new Set(text.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
    for (const token of tokens) {
      if (['plan', 'task', 'step', 'phase', 'system', 'repair', 'review', 'workstream'].includes(token)) continue;
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }
  }
  const [token, count] = [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [];
  if (token && count > 1) {
    return {
      label: `${titleCaseWords(token)} workstream`,
      reason: `${count} of ${plans.length} plans share the term "${token}"; suggested next plan is ${nextPlan.task_id}.`
    };
  }

  return {
    label: `${nextPlan.task_id} workstream`,
    reason: `Named from the suggested next plan because no stronger shared framework or term was detected.`
  };
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function summarizeClusterNextPlan(plans) {
  const priority = {
    ready: 0,
    in_progress: 1,
    needs_review: 2,
    blocked: 3,
    planned: 4,
    unreadable: 5,
    complete: 6
  };
  const plan = plans
    .slice()
    .sort((a, b) => (
      (priority[a.status] ?? 9) - (priority[b.status] ?? 9)
      || a.task_id.localeCompare(b.task_id)
    ))[0];

  if (!plan) {
    return {
      task_id: 'none',
      status: 'not-recorded',
      reason: 'No plans in this cluster.',
      next_step: 'none',
      next_command: 'none'
    };
  }

  return {
    task_id: plan.task_id,
    status: plan.status,
    reason: clusterNextPlanReason(plan.status),
    next_step: `${plan.next_step.step_id}: ${plan.next_step.description}`,
    next_command: plan.next_command
  };
}

function clusterNextPlanReason(status) {
  if (status === 'ready') return 'ready plan in this connected workstream';
  if (status === 'in_progress') return 'in-progress plan in this connected workstream';
  if (status === 'needs_review') return 'plan waiting for review in this connected workstream';
  if (status === 'blocked') return 'blocked plan requiring attention in this connected workstream';
  if (status === 'planned') return 'earliest planned plan in this connected workstream';
  if (status === 'complete') return 'all higher-priority plans in this workstream are complete';
  return 'highest-priority visible plan in this connected workstream';
}

function buildBriefing(plans, relationships, buckets, groupings, relationshipGroupings, clusters = []) {
  const topFramework = topEntry(groupings.framework || {});
  const topIntent = topEntry(relationshipGroupings.intent || {});
  const dependencyWatch = countDependencyWatchCandidates(plans, relationships);
  const largestCluster = clusters[0] || { size: 0, relationships: 0 };
  const ready = buckets.ready || 0;
  const inProgress = buckets.in_progress || 0;
  const blocked = buckets.blocked || 0;
  const needsReview = buckets.needs_review || 0;
  const complete = buckets.complete || 0;

  return [
    `${plans.length} plans are visible in this scope: ${ready} ready, ${inProgress} in progress, ${needsReview} needing review, ${blocked} blocked, and ${complete} complete.`,
    `${relationships.length} inter-plan relationships were detected; the most common relationship intent is ${topIntent.label} (${topIntent.count}).`,
    `${clusters.length} relationship clusters were detected; the largest contains ${largestCluster.size} plans and ${largestCluster.relationships} relationships.`,
    `${dependencyWatch} ready or in-progress plans have incoming dependency links and are called out in Dependency Watch.`,
    `The largest framework grouping is ${topFramework.label} (${topFramework.count}); use the framework filter to narrow that workstream.`
  ];
}

function buildMapReadingGuide({ plans, relationships, relationshipClusters, graphHealth, planActionBoard }) {
  const actionLaneCount = planActionBoard?.lanes?.length || 0;
  return {
    summary: 'How to read the generated plan map without treating it as source authority.',
    items: [
      {
        term: 'Generated map',
        meaning: `A derived view over ${plans.length} visible task-plan artifacts and ${relationships.length} detected relationships.`,
        use: 'Use it for navigation, scanning, and deciding what source artifact to open next.',
        trust_boundary: 'The source task-plan JSON/Markdown remains authoritative.'
      },
      {
        term: 'Workstream',
        meaning: `A connected group of plans in the relationship graph; ${relationshipClusters.length} are visible in the current model.`,
        use: 'Open a workstream when you want the local neighborhood of related plans instead of the whole map.',
        trust_boundary: 'Workstream labels are generated from plan/framework/title signals and can be improved by better metadata.'
      },
      {
        term: 'Relationship',
        meaning: 'A source-to-target link between two plans, with an intent such as dependency, sequence, review, hierarchy, coordination, or mention.',
        use: 'Inspect relationship evidence before treating a line as load-bearing.',
        trust_boundary: 'Declared metadata links are stronger than derived task-id mentions.'
      },
      {
        term: 'Confidence',
        meaning: 'A label for how the relationship was found: high/medium from declared metadata, derived from task-id mentions.',
        use: 'Use confidence filters when deciding which links are safe to rely on.',
        trust_boundary: 'Derived links are navigation hints, not proof of dependency.'
      },
      {
        term: 'Action lane',
        meaning: `${actionLaneCount} generated queues such as Runnable Now, Dependency Watch, Map Repairs, and Impact Review.`,
        use: 'Use lanes to decide what kind of attention a plan needs before opening the source.',
        trust_boundary: 'A lane does not authorize execution; review_lane and risk_tier still govern validation.'
      },
      {
        term: 'Map quality',
        meaning: `Graph-health signals such as coverage (${graphHealth?.coverage_percent ?? 'unknown'}%), missing review lane, missing risk tier, unlinked plans, and missing bounded steps.`,
        use: 'Repair map-quality gaps when the dashboard feels misleading or sparse.',
        trust_boundary: 'Low map quality means the dashboard is incomplete, not that the underlying plan work is invalid.'
      },
      {
        term: 'Review lane',
        meaning: 'The validation route for a plan, such as verify-local, codex-bridge, or operator-gate.',
        use: 'Check review lane before executing or clearing work.',
        trust_boundary: 'Missing review lane is a repair signal before treating work as execution-ready.'
      },
      {
        term: 'Visual brief',
        meaning: 'A portable Markdown flowchart for one plan or workstream.',
        use: 'Open it when you need a shareable or compact view of a slice.',
        trust_boundary: 'Visual briefs are generated from the same derived model and must route back to source plans for authority.'
      }
    ]
  };
}

function buildDataQuality(plans, relationships) {
  const linked = new Set();
  for (const relationship of relationships) {
    linked.add(relationship.source);
    linked.add(relationship.target);
  }

  const sample = (items) => items.slice(0, 8).map((plan) => plan.task_id);
  const unlinked = plans.filter((plan) => !linked.has(plan.task_id));
  const missingReview = plans.filter((plan) => !plan.review_lane || plan.review_lane === 'not-recorded' || plan.review_lane === 'unknown');
  const missingRisk = plans.filter((plan) => !plan.risk_tier || plan.risk_tier === 'not-recorded' || plan.risk_tier === 'unknown');
  const noSteps = plans.filter((plan) => plan.step_counts.total === 0);
  const unreadable = plans.filter((plan) => plan.status === 'unreadable');
  const highRiskReady = plans.filter((plan) => ['ready', 'in_progress'].includes(plan.status) && !['low', 'not-recorded', 'unknown', ''].includes(String(plan.risk_tier || '').toLowerCase()));

  return {
    unlinked: { count: unlinked.length, sample: sample(unlinked) },
    missing_review_lane: { count: missingReview.length, sample: sample(missingReview) },
    missing_risk_tier: { count: missingRisk.length, sample: sample(missingRisk) },
    no_bounded_steps: { count: noSteps.length, sample: sample(noSteps) },
    unreadable: { count: unreadable.length, sample: sample(unreadable) },
    high_risk_ready: { count: highRiskReady.length, sample: sample(highRiskReady) }
  };
}

function buildGraphHealth(plans, relationships, relationshipGroupings, clusters, dataQuality) {
  const linked = new Set();
  for (const relationship of relationships) {
    linked.add(relationship.source);
    linked.add(relationship.target);
  }

  const planCount = plans.length;
  const linkedPlans = [...linked].filter((taskId) => plans.some((plan) => plan.task_id === taskId)).length;
  const unlinkedPlans = Math.max(0, planCount - linkedPlans);
  const coverage = planCount ? Math.round((linkedPlans / planCount) * 1000) / 10 : 0;
  const linkDensity = planCount ? Math.round((relationships.length / planCount) * 100) / 100 : 0;
  const connectedClusterPlans = (clusters || [])
    .filter((cluster) => (cluster.relationships || 0) > 0)
    .reduce((total, cluster) => total + (cluster.size || 0), 0);
  const clusterCoverage = planCount ? Math.round((connectedClusterPlans / planCount) * 1000) / 10 : 0;
  const weakest = Object.entries(dataQuality || {})
    .filter(([, value]) => value.count > 0)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([signal, value]) => ({ signal, count: value.count, sample: value.sample || [] }));

  return {
    linked_plans: linkedPlans,
    unlinked_plans: unlinkedPlans,
    coverage_percent: coverage,
    links_per_plan: linkDensity,
    cluster_coverage_percent: clusterCoverage,
    top_intents: topEntries(relationshipGroupings.intent || {}, 5),
    top_sources: topEntries(relationshipGroupings.type || {}, 5),
    strongest_workstreams: (clusters || []).slice(0, 5).map((cluster) => ({
      cluster_id: cluster.id,
      label: cluster.label,
      plans: cluster.size,
      relationships: cluster.relationships,
      suggested_next: cluster.next_plan?.task_id || 'none'
    })),
    weakest_areas: weakest,
    recommendations: buildMapConfidenceRecommendations(weakest, planCount),
    summary: `${linkedPlans}/${planCount} plans have at least one detected relationship (${coverage}% coverage); ${relationships.length} links produce ${linkDensity} links per plan.`
  };
}

function buildMapConfidenceRecommendations(weakestAreas, planCount) {
  const descriptions = {
    unlinked: 'Add or verify parent_task_id, component_matches, scope references, overlap references, or task-id mentions so isolated plans appear in a workstream.',
    missing_review_lane: 'Set routing_expectations.review_lane so execution and review routing are visible.',
    missing_risk_tier: 'Set routing_expectations.risk_tier so ready/high-risk work can be separated from ordinary queue items.',
    no_bounded_steps: 'Add bounded_plan.steps so the dashboard can show the next concrete action.',
    unreadable: 'Fix JSON parse errors before trusting this plan in generated views.',
    high_risk_ready: 'Review elevated-risk ready or in-progress plans before execution.'
  };

  return (weakestAreas || []).map((area) => {
    const percent = planCount ? Math.round((area.count / planCount) * 1000) / 10 : 0;
    return {
      signal: area.signal,
      count: area.count,
      percent,
      sample: area.sample || [],
      action: descriptions[area.signal] || 'Inspect this confidence signal and update the source task plans if the generated map is missing context.',
      dashboard_href: `plan-visibility__current.html#quality=${encodeURIComponent(area.signal)}`
    };
  });
}

function buildMapConfidenceRemediationQueue(plans, recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length === 0) return [];
  const bySignal = new Map(recommendations.map((item) => [item.signal, item]));
  const rows = [];

  for (const signal of bySignal.keys()) {
    const recommendation = bySignal.get(signal);
    const sampleIds = new Set((recommendation.sample || []).slice(0, 8));
    for (const plan of plans) {
      if (!sampleIds.has(plan.task_id)) continue;
      if (!(plan.quality_flags || []).includes(signal)) continue;
      rows.push({
        signal,
        task_id: plan.task_id,
        title: plan.title,
        status: plan.status,
        review_lane: plan.review_lane,
        risk_tier: plan.risk_tier,
        next_command: mapRepairCommand(plan, signal),
        source: plan.path,
        recommended_fix: recommendation.action,
        dashboard_href: `${recommendation.dashboard_href}&plan=${encodeURIComponent(plan.task_id)}`
      });
    }
  }

  return rows;
}

function mapRepairCommand(plan, signal) {
  if (signal === 'missing_review_lane' || signal === 'missing_risk_tier' || signal === 'no_bounded_steps' || signal === 'unlinked') {
    return `/amend-plan ${plan.task_id}`;
  }
  if ((plan.quality_flags || []).includes('high_risk_ready')) {
    return `/review-task-plan ${plan.task_id}`;
  }
  return plan.next_command || `/review-task-plan ${plan.task_id}`;
}

function buildUnlinkedPlanTriage(plans, limit = 24) {
  const rows = (plans || [])
    .filter((plan) => (plan.quality_flags || []).includes('unlinked'))
    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status) || a.task_id.localeCompare(b.task_id))
    .slice(0, limit)
    .map((plan) => ({
      task_id: plan.task_id,
      title: plan.title,
      status: plan.status,
      review_lane: plan.review_lane,
      risk_tier: plan.risk_tier,
      framework: plan.framework,
      source: plan.path,
      next_step: plan.next_step,
      next_command: plan.next_command,
      dashboard_href: `plan-visibility__current.html#quality=unlinked&plan=${encodeURIComponent(plan.task_id)}`,
      suggested_fix: 'Add parent_task_id, component_matches, referenced_not_owned, overlap metadata, or an explicit task-id mention that connects this plan to its real workstream.'
    }));

  const total = (plans || []).filter((plan) => (plan.quality_flags || []).includes('unlinked')).length;
  return {
    total,
    shown: rows.length,
    summary: total
      ? `${total} visible plans have no detected relationships; ${rows.length} highest-priority items are shown for triage.`
      : 'Every visible plan has at least one detected relationship.',
    rows
  };
}

function statusPriority(status) {
  const priority = { ready: 0, in_progress: 1, needs_review: 2, blocked: 3, planned: 4, complete: 5, unreadable: 6 };
  return priority[status] ?? 9;
}

function buildPriorityScan(plans, relationships, relationshipClusters, relationshipHubs, remediationQueue) {
  const byId = new Map((plans || []).map((plan) => [plan.task_id, plan]));
  const items = [];
  const seen = new Set();
  const seenTaskIds = new Set();
  const addItem = (item) => {
    const key = `${item.kind}:${item.task_id || item.href || item.label}`;
    if (seen.has(key)) return;
    if (item.task_id && seenTaskIds.has(item.task_id)) return;
    seen.add(key);
    if (item.task_id) seenTaskIds.add(item.task_id);
    items.push(item);
  };

  const planHref = (taskId) => `plan-visibility__current.html#plan=${encodeURIComponent(taskId)}`;
  const planSource = (taskId) => byId.get(taskId)?.path || null;
  const planCommand = (taskId) => byId.get(taskId)?.next_command || 'none';
  const planStatus = (taskId) => byId.get(taskId)?.status || 'not-recorded';

  const largestCluster = (relationshipClusters || [])[0];
  const suggested = largestCluster?.next_plan;
  if (largestCluster && suggested?.task_id && suggested.task_id !== 'none') {
    addItem({
      kind: 'workstream-next',
      label: 'Suggested next in largest workstream',
      task_id: suggested.task_id,
      status: suggested.status || planStatus(suggested.task_id),
      reason: `${largestCluster.label || largestCluster.id}: ${suggested.reason || 'suggested by workstream priority.'}`,
      href: `plan-visibility__current.html#cluster=${encodeURIComponent(largestCluster.id)}&plan=${encodeURIComponent(suggested.task_id)}`,
      source: planSource(suggested.task_id),
      brief: `visual-plans/${encodeURIComponent(largestCluster.id)}.md`,
      next_command: suggested.next_command || planCommand(suggested.task_id)
    });
  }

  const dependencyTargets = new Set((relationships || [])
    .filter((relationship) => relationship.intent === 'dependency')
    .map((relationship) => relationship.target));
  const dependencyWatch = (plans || []).find((plan) => ['ready', 'in_progress'].includes(plan.status) && dependencyTargets.has(plan.task_id) && !seenTaskIds.has(plan.task_id));
  if (dependencyWatch) {
    addItem({
      kind: 'dependency-watch',
      label: 'Runnable plan with incoming dependency link',
      task_id: dependencyWatch.task_id,
      status: dependencyWatch.status,
      reason: 'Ready or in-progress work has an incoming dependency relationship; inspect the connection before execution.',
      href: planHref(dependencyWatch.task_id),
      source: dependencyWatch.path,
      brief: null,
      next_command: dependencyWatch.next_command
    });
  }

  const readyPlan = (plans || []).find((plan) => plan.status === 'ready' && !seenTaskIds.has(plan.task_id));
  if (readyPlan) {
    addItem({
      kind: 'ready-plan',
      label: 'Ready execution candidate',
      task_id: readyPlan.task_id,
      status: readyPlan.status,
      reason: 'Plan is classified ready; use the source task plan and review gates before execution.',
      href: planHref(readyPlan.task_id),
      source: readyPlan.path,
      brief: null,
      next_command: readyPlan.next_command
    });
  }

  const highRiskReady = (plans || []).find((plan) => (plan.quality_flags || []).includes('high_risk_ready') && !seenTaskIds.has(plan.task_id));
  if (highRiskReady) {
    addItem({
      kind: 'risk-watch',
      label: 'Elevated-risk runnable work',
      task_id: highRiskReady.task_id,
      status: highRiskReady.status,
      reason: `Risk tier is ${highRiskReady.risk_tier}; review routing before execution.`,
      href: planHref(highRiskReady.task_id),
      source: highRiskReady.path,
      brief: null,
      next_command: highRiskReady.next_command
    });
  }

  const firstRemediation = (remediationQueue || []).find((row) => !seenTaskIds.has(row.task_id));
  if (firstRemediation) {
    addItem({
      kind: 'map-quality',
      label: 'Map-confidence repair candidate',
      task_id: firstRemediation.task_id,
      status: firstRemediation.status,
      reason: `${firstRemediation.signal}: ${firstRemediation.recommended_fix}`,
      href: firstRemediation.dashboard_href,
      source: firstRemediation.source,
      brief: null,
      next_command: firstRemediation.next_command
    });
  }

  const firstHub = (relationshipHubs || []).find((hub) => !seenTaskIds.has(hub.task_id));
  if (firstHub) {
    addItem({
      kind: 'bridge-plan',
      label: 'Bridge plan explaining interconnections',
      task_id: firstHub.task_id,
      status: firstHub.status,
      reason: `${firstHub.total} relationships (${firstHub.incoming} incoming, ${firstHub.outgoing} outgoing); top intent ${firstHub.top_intent || 'not-recorded'}.`,
      href: planHref(firstHub.task_id),
      source: planSource(firstHub.task_id),
      brief: null,
      next_command: firstHub.next_command || planCommand(firstHub.task_id)
    });
  }

  return items.slice(0, 6);
}

function buildOperatorQuestionRoutes({
  buckets,
  dataQuality,
  graphHealth,
  priorityScan,
  planActionBoard,
  relationshipClusters,
  dependencySequenceChains,
  recentActivity
}) {
  const laneRows = (laneId) => (planActionBoard?.lanes || []).find((lane) => lane.id === laneId)?.rows || [];
  const largestCluster = (relationshipClusters || [])[0];
  const suggestedNext = largestCluster?.next_plan?.task_id && largestCluster.next_plan.task_id !== 'none'
    ? largestCluster.next_plan.task_id
    : null;
  const largestClusterHref = largestCluster
    ? `plan-visibility__current.html#cluster=${encodeURIComponent(largestCluster.id)}${suggestedNext ? `&plan=${encodeURIComponent(suggestedNext)}` : ''}`
    : 'plan-visibility__current.html';
  const topChain = (dependencySequenceChains || [])[0];
  const newest = recentActivity?.items?.[0];

  return [
    {
      id: 'start',
      question: 'Where should I start?',
      answer: 'Open the priority scan for the first few plans and workstreams worth inspecting.',
      count_label: `${(priorityScan || []).length} priority items`,
      href: 'plan-visibility__index.html#priority-scan',
      command: 'npm run plans:where',
      evidence: (priorityScan || [])[0]?.label || 'Priority scan is generated from current plan status, workstreams, dependencies, and map quality.'
    },
    {
      id: 'run-now',
      question: 'What can run now?',
      answer: 'Use the Plan Action Board runnable lane, then check the plan review lane before execution.',
      count_label: `${laneRows('runnable_now').length} runnable candidates`,
      href: 'plan-visibility__index.html#plan-action-board',
      command: 'npm run plans:where',
      evidence: laneRows('runnable_now')[0]?.task_id || 'Runnable lane is empty in the current model.'
    },
    {
      id: 'needs-routing',
      question: 'What needs routing repair?',
      answer: 'Open the missing-review-lane filter before treating those plans as execution-ready.',
      count_label: `${dataQuality?.missing_review_lane?.count || 0} missing review lane`,
      href: 'plan-visibility__current.html#quality=missing_review_lane',
      command: 'npm run plans:where',
      evidence: (dataQuality?.missing_review_lane?.sample || [])[0] || 'No missing review-lane sample recorded.'
    },
    {
      id: 'connections',
      question: 'How do plans interconnect?',
      answer: 'Scan dependency and sequence chains, then open a chain link in the connection path finder.',
      count_label: `${(dependencySequenceChains || []).length} chains`,
      href: 'plan-visibility__index.html#dependency-sequence-chains',
      command: topChain ? `npm run plans:where -- --from ${topChain.start_task_id} --to ${topChain.end_task_id}` : 'npm run plans:where -- --from <task-id> --to <task-id>',
      evidence: topChain?.summary || 'No dependency or sequence chains detected.'
    },
    {
      id: 'workstream',
      question: 'Which workstream should I inspect?',
      answer: 'Open the largest workstream route and its focused visual brief.',
      count_label: `${(relationshipClusters || []).length} workstreams`,
      href: largestClusterHref,
      command: largestCluster ? `npm run plans:where -- --workstream ${largestCluster.id}` : 'npm run plans:where -- --workstream <cluster-id>',
      evidence: largestCluster ? `${largestCluster.label || largestCluster.id}: ${largestCluster.size || 0} plans` : 'No workstreams detected.'
    },
    {
      id: 'map-quality',
      question: 'Where is the map weak?',
      answer: 'Use map-quality filters for unlinked plans, missing routing metadata, missing risk, and missing bounded steps.',
      count_label: `${(graphHealth?.recommendations || []).length} quality actions`,
      href: 'plan-visibility__index.html#map-quality',
      command: 'npm run plans:where',
      evidence: (graphHealth?.recommendations || [])[0]?.signal || 'No map-quality recommendation recorded.'
    },
    {
      id: 'recent',
      question: 'What changed recently?',
      answer: 'Open recent source activity and the plan progress timeline to see the newest touched plan artifacts.',
      count_label: `${recentActivity?.items?.length || 0} recent items`,
      href: 'plan-visibility__index.html#recent-source-activity',
      command: 'npm run plans:where',
      evidence: newest ? `${newest.task_id} at ${newest.source_mtime}` : 'No recent activity item recorded.'
    },
    {
      id: 'full-map',
      question: 'Where is the full dashboard?',
      answer: 'Open the current system map for search, filters, graph, selected-plan detail, and source links.',
      count_label: `${Object.values(buckets || {}).reduce((sum, count) => sum + count, 0)} visible plans`,
      href: 'plan-visibility__current.html',
      command: 'npm run plans:dashboard',
      evidence: 'Generated from repo-local task-plan artifacts; derived context only.'
    }
  ];
}

function buildVisualFlowchartInventory(model, clusterLimit = 8) {
  const clusters = (model.relationship_clusters || []).slice(0, clusterLimit);
  const planVisibility = (model.plans || []).find((plan) => plan.task_id === 'plan-visibility-surface');
  const items = [
    {
      id: 'system-overview',
      kind: 'overview',
      label: 'System overview flowcharts',
      path: 'plan-visibility__current.md',
      dashboard_href: 'plan-visibility__current.html',
      command: 'npm run plans:dashboard',
      mermaid_blocks: ['status_flow', 'review_lanes', 'plan_interconnections'],
      description: 'Status, review-lane, and inter-plan Mermaid diagrams for the current system scope.'
    },
    {
      id: 'visual-brief-library',
      kind: 'library',
      label: 'Focused visual brief library',
      path: 'visual-plans/index.md',
      dashboard_href: 'visual-plans/index.md',
      command: 'npm run plans:dashboard',
      mermaid_blocks: [],
      description: 'Index of generated focused visual briefs and commands for making more.'
    }
  ];

  if (planVisibility) {
    items.push({
      id: planVisibility.task_id,
      kind: 'plan',
      label: planVisibility.title || planVisibility.task_id,
      path: `visual-plans/${planVisibility.task_id}.md`,
      dashboard_href: `plan-visibility__current.html#plan=${encodeURIComponent(planVisibility.task_id)}`,
      command: `npm run plans:visual -- --plan ${planVisibility.task_id} --write`,
      mermaid_blocks: ['flowchart'],
      description: 'Focused Mermaid flowchart around the plan-visibility task plan.'
    });
  }

  for (const cluster of clusters) {
    const next = cluster.next_plan || {};
    items.push({
      id: cluster.id,
      kind: 'relationship_cluster',
      label: cluster.label || cluster.id,
      path: `visual-plans/${cluster.id}.md`,
      dashboard_href: `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}${next.task_id && next.task_id !== 'none' ? `&plan=${encodeURIComponent(next.task_id)}` : ''}`,
      command: `npm run plans:visual -- --cluster ${cluster.id} --write`,
      mermaid_blocks: ['flowchart'],
      description: `${cluster.size} plans and ${cluster.relationships} relationships; suggested next plan ${next.task_id || 'none'}.`
    });
  }

  return {
    summary: `${items.filter((item) => item.mermaid_blocks.length > 0).length} generated Markdown artifacts contain Mermaid flowcharts.`,
    items
  };
}

function buildVisualCoverage(workstreamMatrix) {
  const rows = Array.isArray(workstreamMatrix) ? workstreamMatrix : [];
  const generated = rows.filter((row) => row.brief_exists !== false);
  const missing = rows.filter((row) => row.brief_exists === false);
  const total = rows.length;
  const generatedCount = generated.length;
  const missingCount = missing.length;
  return {
    total_workstreams: total,
    generated_briefs: generatedCount,
    missing_briefs: missingCount,
    coverage_percent: total ? Math.round((generatedCount / total) * 100) : 100,
    summary: total
      ? `${generatedCount} of ${total} workstreams have generated visual briefs; ${missingCount} remain queued.`
      : 'No relationship workstreams need visual briefs.',
    queue: missing.slice(0, 24).map((row) => ({
      cluster_id: row.cluster_id,
      label: row.label,
      plans: row.plans,
      relationships: row.relationships,
      suggested_next: row.suggested_next,
      dashboard_href: row.map_href,
      command: `npm run plans:visual -- --cluster ${row.cluster_id} --write`,
      reason: `${row.plans} plans and ${row.relationships} relationships do not yet have a generated visual brief.`
    }))
  };
}

function buildRecentActivity(plans, clusters, limit = 12) {
  const clusterByPlan = new Map();
  for (const cluster of clusters || []) {
    for (const planId of cluster.plan_ids || []) {
      if (!clusterByPlan.has(planId)) {
        clusterByPlan.set(planId, cluster);
      }
    }
  }

  const items = (plans || [])
    .filter((plan) => plan.source_mtime)
    .map((plan) => {
      const cluster = clusterByPlan.get(plan.task_id);
      return {
        task_id: plan.task_id,
        title: plan.title,
        status: plan.status,
        review_lane: plan.review_lane,
        risk_tier: plan.risk_tier,
        source: plan.path,
        source_mtime: plan.source_mtime,
        next_step: plan.next_step,
        next_command: plan.next_command,
        workstream_id: cluster?.id || null,
        workstream_label: cluster?.label || null,
        dashboard_href: cluster
          ? `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(plan.task_id)}`
          : `plan-visibility__current.html#plan=${encodeURIComponent(plan.task_id)}`
      };
    })
    .sort((a, b) => Date.parse(b.source_mtime) - Date.parse(a.source_mtime) || a.task_id.localeCompare(b.task_id))
    .slice(0, limit);

  return {
    summary: items.length
      ? `${items.length} newest visible task-plan source files by filesystem modified time.`
      : 'No visible task-plan source modification times were available.',
    items
  };
}

function buildPlanProgressTimeline(plans, clusters, limit = 18) {
  const clusterByPlan = new Map();
  for (const cluster of clusters || []) {
    for (const planId of cluster.plan_ids || []) {
      if (!clusterByPlan.has(planId)) {
        clusterByPlan.set(planId, cluster);
      }
    }
  }

  const items = (plans || [])
    .filter((plan) => plan.source_mtime)
    .map((plan) => {
      const cluster = clusterByPlan.get(plan.task_id);
      const step = plan.next_step || {};
      return {
        task_id: plan.task_id,
        title: plan.title,
        status: plan.status,
        review_lane: plan.review_lane,
        risk_tier: plan.risk_tier,
        source: plan.path,
        modified_at: plan.source_mtime,
        next_step: {
          step_id: step.step_id || 'none',
          status: step.status || 'not-recorded',
          description: step.description || 'No next step recorded.'
        },
        next_command: plan.next_command,
        quality_flags: plan.quality_flags || [],
        workstream_id: cluster?.id || null,
        workstream_label: cluster?.label || 'not linked',
        dashboard_href: cluster
          ? `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(plan.task_id)}`
          : `plan-visibility__current.html#plan=${encodeURIComponent(plan.task_id)}`
      };
    })
    .sort((a, b) => Date.parse(b.modified_at) - Date.parse(a.modified_at) || a.task_id.localeCompare(b.task_id))
    .slice(0, limit);

  const status_mix = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return {
    summary: items.length
      ? `${items.length} most recently touched visible plans with current status, workstream, next step, and next command.`
      : 'No visible plan progress timestamps were available.',
    status_mix,
    items
  };
}

function renderGraphHealthRows(graphHealth) {
  if (!graphHealth) return ['| none | none |'];
  return [
    `| Linked plans | ${graphHealth.linked_plans} linked, ${graphHealth.unlinked_plans} unlinked (${graphHealth.coverage_percent}% coverage) |`,
    `| Link density | ${graphHealth.links_per_plan} links per visible plan |`,
    `| Cluster coverage | ${graphHealth.cluster_coverage_percent}% of visible plans are inside detected relationship clusters |`,
    `| Top intents | ${escapeCell(formatEntryList(graphHealth.top_intents))} |`,
    `| Top sources | ${escapeCell(formatEntryList(graphHealth.top_sources))} |`,
    `| Weakest areas | ${escapeCell(formatWeakestAreas(graphHealth.weakest_areas))} |`,
    `| Recommended actions | ${escapeCell(formatRecommendations(graphHealth.recommendations))} |`
  ];
}

function formatWeakestAreas(areas) {
  if (!Array.isArray(areas) || areas.length === 0) return 'none';
  return areas.map((area) => `${area.signal}: ${area.count}`).join(', ');
}

function formatRecommendations(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length === 0) return 'none';
  return recommendations.map((item) => `${item.signal}: ${item.action}`).join(' | ');
}

function renderTopGrouping(grouping, limit = 12) {
  const entries = Object.entries(grouping)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
  if (entries.length === 0) return '- none';
  return entries.map(([label, count]) => `- ${label}: ${count}`).join('\n');
}

function renderRelationshipHubRows(hubs) {
  if (!hubs.length) {
    return ['| none | none | 0 | 0 | 0 | none | none | No connected plans detected. |'];
  }

  return hubs.map((hub) => {
    const plan = `[${escapeCell(hub.task_id)}](${escapeCell(hub.path)})`;
    const workstream = hub.cluster_id === 'none'
      ? hub.cluster_label
      : `${hub.cluster_label} (${hub.cluster_id})`;
    const nextStep = `${hub.next_step.step_id}: ${hub.next_step.description}`;
    const topIntent = `${hub.top_intent} (${hub.top_intent_count})`;
    return `| ${plan} | ${escapeCell(hub.role)} | ${hub.total} | ${hub.incoming} | ${hub.outgoing} | ${escapeCell(topIntent)} | ${escapeCell(workstream)} | ${escapeCell(nextStep)} |`;
  });
}

function renderImpactHubRows(impactHubs) {
  const rows = impactHubs?.rows || [];
  if (!rows.length) {
    return ['| none | none | 0 | 0 | 0 | none | none | none | none |'];
  }

  return rows.map((hub) => {
    const plan = `[${escapeCell(hub.task_id)}](${escapeCell(hub.dashboard_href)})`;
    const workstream = hub.workstream_id === 'none'
      ? hub.workstream_label
      : `${hub.workstream_label} (${hub.workstream_id})`;
    return `| ${plan} | ${escapeCell(hub.role)} | ${hub.total} | ${hub.incoming} | ${hub.outgoing} | ${escapeCell(`${hub.top_intent} (${hub.top_intent_count})`)} | ${escapeCell(workstream)} | ${escapeCell(hub.why_it_matters)} | \`${escapeBackticks(hub.next_command)}\` |`;
  });
}

function renderPlanActionBoardRows(actionBoard) {
  const lanes = actionBoard?.lanes || [];
  const rows = lanes.flatMap((lane) => (lane.rows || []).map((row) => ({ lane, row })));
  if (!rows.length) {
    return ['| none | none | none | none | none | none |'];
  }

  return rows.map(({ lane, row }) => `| ${escapeCell(lane.label)} | [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.status)} | ${escapeCell(row.workstream_label || 'not linked')} | ${escapeCell(row.reason)} | \`${escapeBackticks(row.next_command || 'not-recorded')}\` |`);
}

function renderExecutionReadinessRows(executionReadiness) {
  const lanes = executionReadiness?.lanes || [];
  const rows = lanes.flatMap((lane) => (lane.rows || []).map((row) => ({ lane, row })));
  if (!rows.length) {
    return ['| none | none | none | none | none | none | none |'];
  }

  return rows.map(({ lane, row }) => {
    const missing = (row.missing_protocol_fields || []).join(', ') || 'none';
    return `| ${escapeCell(lane.label)} | [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.readiness)} | ${escapeCell(row.status)} | ${escapeCell(missing)} | ${escapeCell(row.reason)} | \`${escapeBackticks(row.recommended_command || 'not-recorded')}\` |`;
  });
}

function renderRoutingBlockerRows(routingBlockers) {
  const rows = routingBlockers?.blockers || [];
  if (!rows.length) {
    return ['| none | 0 | none | none | none |'];
  }

  return rows.map((row) => `| ${escapeCell(row.label)} | ${row.count} | [${escapeCell(row.first_task_id)}](${escapeCell(row.href)}) | ${escapeCell(row.reason)} | \`${escapeBackticks(row.command || 'none')}\` |`);
}

function renderFirstRepairPathRows(firstRepairPath) {
  const rows = firstRepairPath?.steps || [];
  if (!rows.length) {
    return ['| none | none | none | none | none | none |'];
  }

  return rows.map((row, index) => `| ${index + 1} | ${escapeCell(row.label)} | [${escapeCell(row.task_id)}](${escapeCell(row.href)}) | ${escapeCell(row.why_first)} | ${escapeCell(row.effect)} | \`${escapeBackticks(row.command || 'none')}\` |`);
}

function renderRiskGateQueueRows(queue) {
  const rows = queue?.rows || [];
  if (!rows.length) {
    return ['| none | none | none | none | none | none | none |'];
  }

  return rows.map((row) => {
    const missing = (row.missing_protocol_fields || []).join(', ') || 'none';
    return `| ${escapeCell(row.gate_label)} | [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.status)} | ${escapeCell(row.review_lane)} | ${escapeCell(row.risk_tier)} | ${escapeCell(missing)} | ${escapeCell(row.reason)} | \`${escapeBackticks(row.recommended_command || 'not-recorded')}\` |`;
  });
}

function renderCommandRunbookRows(runbook) {
  const groups = runbook?.groups || [];
  const rows = groups.flatMap((group) => (group.rows || []).map((row) => ({ group, row })));
  if (!rows.length) {
    return ['| none | none | none | none | none | none | none |'];
  }

  return rows.map(({ group, row }) => `| ${escapeCell(group.verb)} | [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.purpose)} | ${escapeCell(row.source_surface)} | ${escapeCell(row.gate_or_lane || 'not-recorded')} | ${escapeCell(row.reason)} | \`${escapeBackticks(row.command || 'not-recorded')}\` |`);
}

function renderOrchestrationRoutingRows(board) {
  const lanes = board?.lanes || [];
  const rows = lanes.flatMap((lane) => (lane.rows || []).map((row) => ({ lane, row })));
  if (!rows.length) {
    return ['| none | none | none | none | none | none | none | none |'];
  }

  return rows.map(({ lane, row }) => {
    const missing = (row.missing_protocol_fields || []).join(', ') || 'none';
    return `| ${escapeCell(lane.label)} | [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.route_owner)} | ${escapeCell(row.status)} | ${escapeCell(row.review_lane)} | ${escapeCell(row.risk_tier)} | ${escapeCell(missing)} | ${escapeCell(row.reason)} | \`${escapeBackticks(row.recommended_command || 'not-recorded')}\` |`;
  });
}

function renderActionPathRows(paths) {
  if (!paths.length) {
    return ['| none | none | 0 | 0 | none | none | none | No dependency, sequence, review, or hierarchy paths detected. |'];
  }

  return paths.map((item) => {
    const plan = `[${escapeCell(item.task_id)}](${escapeCell(item.path)})`;
    const upstream = item.upstream.map((relationship) => `${relationship.plan} (${relationship.intent})`).join(', ') || 'none';
    const downstream = item.downstream.map((relationship) => `${relationship.plan} (${relationship.intent})`).join(', ') || 'none';
    const workstream = item.cluster_id === 'none'
      ? item.cluster_label
      : `${item.cluster_label} (${item.cluster_id})`;
    const nextStep = `${item.next_step.step_id}: ${item.next_step.description}`;
    return `| ${plan} | ${escapeCell(item.status)} | ${item.upstream_count} | ${item.downstream_count} | ${escapeCell(upstream)} | ${escapeCell(downstream)} | ${escapeCell(workstream)} | ${escapeCell(nextStep)} |`;
  });
}

function renderOperatorQuestionRouteRows(routes) {
  if (!routes.length) {
    return ['| none | No operator question routes generated. | none | none | none | none |'];
  }

  return routes.map((route) => `| ${escapeCell(route.question)} | ${escapeCell(route.answer)} | ${escapeCell(route.count_label || 'not-recorded')} | [open](${escapeCell(route.href || 'plan-visibility__index.html')}) | \`${escapeBackticks(route.command || 'not-recorded')}\` | ${escapeCell(route.evidence || 'No evidence recorded.')} |`);
}

function renderMapReadingGuideRows(guide) {
  const items = guide?.items || [];
  if (!items.length) {
    return ['| none | No map-reading guide generated. | none | none |'];
  }

  return items.map((item) => `| ${escapeCell(item.term)} | ${escapeCell(item.meaning)} | ${escapeCell(item.use)} | ${escapeCell(item.trust_boundary)} |`);
}

function renderProtocolReadinessRows(protocolReadiness) {
  const rows = protocolReadiness?.rows || [];
  if (!rows.length) {
    return ['| none | none | none | none | none | none |'];
  }

  return rows.map((row) => {
    const missing = (row.missing_fields || []).join(', ') || 'none';
    return `| [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.protocol_state)} | ${escapeCell(row.status)} | ${escapeCell(missing)} | ${escapeCell(row.reason)} | \`${escapeBackticks(row.recommended_command || 'not-recorded')}\` |`;
  });
}

function renderProtocolCheckRows(protocolReadiness) {
  const checks = protocolReadiness?.checks || [];
  if (!checks.length) {
    return ['| none | 0 | 0 | none | none |'];
  }

  return checks.map((check) => `| ${escapeCell(check.label)} | ${check.present_count} | ${check.missing_count} | ${escapeCell(check.repair)} | ${escapeCell((check.sample || []).join(', ') || 'none')} |`);
}

function renderDependencySequenceChainRows(chains) {
  if (!chains.length) {
    return ['| none | 0 | none | none | none | none | No dependency or sequence chains detected. |'];
  }

  return chains.slice(0, 12).map((chain) => {
    const summary = `[${escapeCell(chain.summary)}](${escapeCell(chain.dashboard_href)})`;
    const workstream = chain.cluster_id === 'none'
      ? chain.cluster_label
      : `${chain.cluster_label} (${chain.cluster_id})`;
    return `| ${summary} | ${chain.hops} | ${escapeCell((chain.intents || []).join(', ') || 'none')} | ${escapeCell(workstream)} | ${escapeCell(chain.next_task_id || 'none')} | \`${escapeBackticks(chain.next_command || 'not-recorded')}\` | ${escapeCell(chain.dashboard_href || 'not-recorded')} |`;
  });
}

function renderWorkstreamMatrixRows(rows, options = {}) {
  if (!rows.length) {
    return ['| none | none | 0 | 0 | 0 | 0 | none | none | none | none |'];
  }

  return rows.map((row) => {
    const cluster = options.links
      ? `[${escapeCell(row.cluster_id)}](${escapeCell(row.map_href)})`
      : escapeCell(row.cluster_id);
    const brief = options.links
      ? (row.brief_exists === false ? 'not generated' : `[brief](${escapeCell(row.brief_href)})`)
      : (row.brief_exists === false ? 'not generated' : escapeCell(row.brief_href));
    return `| ${cluster} | ${escapeCell(row.label)} | ${row.plans} | ${row.relationships} | ${row.ready_like} | ${row.attention} | ${escapeCell(formatEntryList(row.top_intents))} | ${escapeCell(formatEntryList(row.status_mix))} | ${escapeCell(row.suggested_next.task_id)} | ${brief} |`;
  });
}

function renderWorkstreamDrilldownRows(drilldowns) {
  const rows = (drilldowns?.drilldowns || [])
    .flatMap((drilldown) => (drilldown.slices || []).map((slice) => ({ drilldown, slice })));
  if (!rows.length) {
    return ['| none | none | 0 | 0 | none | none | none | none | none |'];
  }

  return rows.map(({ drilldown, slice }) => {
    const next = slice.suggested_next;
    const quality = formatEntryList(slice.quality_flags);
    const intents = formatEntryList(slice.top_intents);
    return `| [${escapeCell(drilldown.cluster_id)}](${escapeCell(drilldown.dashboard_href)}) | ${escapeCell(slice.label)} | ${slice.plans} | ${slice.ready_like} | ${escapeCell(formatEntryList(slice.status_mix))} | ${escapeCell(intents)} | ${escapeCell(quality)} | ${next ? `[${escapeCell(next.task_id)}](${escapeCell(next.dashboard_href)})` : 'none'} | \`${escapeBackticks(next?.next_command || 'not-recorded')}\` |`;
  });
}

function renderMapConfidenceActionRows(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return ['| none | 0 | No map-confidence actions detected. | none | none |'];
  }

  return recommendations.map((item) => {
    const samples = (item.sample || []).join(', ') || 'none';
    return `| ${escapeCell(item.signal)} | ${item.count} (${item.percent}%) | ${escapeCell(item.action)} | [filter](${escapeCell(item.dashboard_href)}) | ${escapeCell(samples)} |`;
  });
}

function renderRemediationQueueRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return ['| none | none | none | none | none | none |'];
  }

  return rows.slice(0, 24).map((row) => `| ${escapeCell(row.signal)} | [${escapeCell(row.task_id)}](${escapeCell(row.source)}) | ${escapeCell(row.status)} | ${escapeCell(row.recommended_fix)} | [filter](${escapeCell(row.dashboard_href)}) | \`${escapeBackticks(row.next_command)}\` |`);
}

function renderUnlinkedPlanTriageRows(triage) {
  const rows = triage?.rows || [];
  if (!rows.length) {
    return ['| none | none | none | none | none | none | none |'];
  }

  return rows.map((row) => {
    const nextStep = `${row.next_step?.step_id || 'none'}: ${row.next_step?.description || 'No next step recorded.'}`;
    return `| [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.status)} | ${escapeCell(row.review_lane)} | ${escapeCell(row.risk_tier)} | ${escapeCell(nextStep)} | \`${escapeBackticks(row.next_command)}\` | [source](${escapeCell(row.source)}) |`;
  });
}

function renderVisualFlowchartRows(inventory) {
  const items = inventory?.items || [];
  if (!items.length) {
    return ['| none | none | none | none | none |'];
  }

  return items.slice(0, 16).map((item) => `| [${escapeCell(item.label)}](${escapeCell(item.path)}) | ${escapeCell(item.kind)} | ${escapeCell((item.mermaid_blocks || []).join(', ') || 'index')} | [open](${escapeCell(item.dashboard_href)}) | \`${escapeBackticks(item.command)}\` |`);
}

function renderVisualCoverageRows(coverage) {
  const rows = coverage?.queue || [];
  if (!rows.length) {
    return ['| none | none | 0 | 0 | none | none |'];
  }

  return rows.map((row) => `| ${escapeCell(row.cluster_id)} | [${escapeCell(row.label)}](${escapeCell(row.dashboard_href)}) | ${row.plans} | ${row.relationships} | ${escapeCell(row.reason)} | \`${escapeBackticks(row.command)}\` |`);
}

function renderRecentActivityRows(activity) {
  const rows = activity?.items || [];
  if (!rows.length) {
    return ['| none | none | none | none | none | none |'];
  }

  return rows.map((row) => `| ${escapeCell(row.source_mtime)} | [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.status)} | ${escapeCell(row.workstream_label || 'not-linked')} | \`${escapeBackticks(row.next_command)}\` | [source](${escapeCell(row.source)}) |`);
}

function renderPlanProgressTimelineRows(timeline) {
  const rows = timeline?.items || [];
  if (!rows.length) {
    return ['| none | none | none | none | none | none | none |'];
  }

  return rows.map((row) => {
    const nextStep = `${row.next_step.step_id}: ${row.next_step.description}`;
    const quality = (row.quality_flags || []).join(', ') || 'none';
    return `| ${escapeCell(row.modified_at)} | [${escapeCell(row.task_id)}](${escapeCell(row.dashboard_href)}) | ${escapeCell(row.status)} | ${escapeCell(row.workstream_label || 'not-linked')} | ${escapeCell(nextStep)} | \`${escapeBackticks(row.next_command)}\` | ${escapeCell(quality)} |`;
  });
}

function renderWorkstreamStoryRows(stories) {
  const rows = stories || [];
  if (!rows.length) {
    return ['| none | none | none | none | none | none |'];
  }

  return rows.map((story) => {
    const examples = (story.relationship_examples || [])
      .slice(0, 3)
      .map((example) => `${example.source} -> ${example.target} (${example.intent})`)
      .join('; ') || 'none';
    const bridges = (story.bridge_plans || [])
      .map((hub) => `${hub.task_id} (${hub.role})`)
      .join(', ') || 'none';
    return `| [${escapeCell(story.cluster_id)}](${escapeCell(story.dashboard_href)}) | ${escapeCell(story.label)} | ${escapeCell(story.explanation)} | ${escapeCell(examples)} | ${escapeCell(bridges)} | [brief](${escapeCell(story.brief_href)}) |`;
  });
}

function formatEntryList(entries) {
  return (entries || []).map((entry) => `${entry.label}: ${entry.count}`).join(', ') || 'none';
}

function mermaidId(value) {
  return `p_${String(value || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function mermaidLabel(value) {
  return String(value || '').replace(/"/g, '\\"');
}

function renderStatusMermaid(buckets) {
  return [
    '```mermaid',
    'flowchart LR',
    `  all["All plans (${sumBucketCounts(buckets)})"]`,
    `  all --> ready["Ready (${buckets.ready || 0})"]`,
    `  all --> in_progress["In progress (${buckets.in_progress || 0})"]`,
    `  all --> planned["Planned (${buckets.planned || 0})"]`,
    `  all --> blocked["Blocked (${buckets.blocked || 0})"]`,
    `  all --> needs_review["Needs review (${buckets.needs_review || 0})"]`,
    `  all --> complete["Complete (${buckets.complete || 0})"]`,
    '```'
  ].join('\n');
}

function renderReviewLaneMermaid(plans) {
  const lanes = plans.reduce((acc, plan) => {
    const lane = plan.review_lane || 'not-recorded';
    acc[lane] = (acc[lane] || 0) + 1;
    return acc;
  }, {});

  const lines = [
    '```mermaid',
    'flowchart LR',
    '  operator["Human operator"] --> review["Plan review lanes"]'
  ];

  for (const lane of Object.keys(lanes).sort()) {
    lines.push(`  review --> ${mermaidId(lane)}["${mermaidLabel(lane)} (${lanes[lane]})"]`);
  }

  lines.push('```');
  return lines.join('\n');
}

function renderRelationshipMermaid(relationships, limit = 40) {
  const visible = relationships.slice(0, limit);
  const lines = [
    '```mermaid',
    'flowchart TD'
  ];

  if (visible.length === 0) {
    lines.push('  none["No plan interconnections found in current metadata"]');
  }

  for (const relationship of visible) {
    const label = relationship.intent && relationship.intent !== relationship.type
      ? `${relationship.type}:${relationship.intent}`
      : relationship.type;
    lines.push(`  ${mermaidId(relationship.source)}["${mermaidLabel(relationship.source)}"] -->|${mermaidLabel(label)}| ${mermaidId(relationship.target)}["${mermaidLabel(relationship.target)}"]`);
  }

  lines.push('```');
  return lines.join('\n');
}

function sumBucketCounts(buckets) {
  return Object.values(buckets).reduce((total, count) => total + count, 0);
}

function renderPlanVisibilityMarkdown(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const model = buildPlanVisibilityModel(projectRoot, { includeClient, generatedAt });
  const { plans, relationships, buckets } = model;

  const lines = [
    '# Mythos Plan Visibility',
    '',
    `generated_at: ${generatedAt}`,
    `scope: ${includeClient ? 'system+client' : 'system-only'}`,
    '',
    '> Derived context only. Task-plan JSON/MD, amendments, reviews, signals, and canonical command specs remain authority.',
    '',
    '## Summary',
    '',
    `- plans: ${plans.length}`,
    `- ready: ${buckets.ready || 0}`,
    `- in_progress: ${buckets.in_progress || 0}`,
    `- blocked: ${buckets.blocked || 0}`,
    `- needs_review: ${buckets.needs_review || 0}`,
    `- planned: ${buckets.planned || 0}`,
    `- complete: ${buckets.complete || 0}`,
    `- unreadable: ${buckets.unreadable || 0}`,
    `- interconnections: ${relationships.length}`,
    '',
    '## Briefing',
    '',
    ...model.briefing.map((line) => `- ${line}`),
    '',
    '## Operator Question Router',
    '',
    '| Question | Answer | Count | Open | Command | Evidence |',
    '|---|---|---|---|---|---|',
    ...renderOperatorQuestionRouteRows(model.operator_question_routes || []),
    '',
    '## How To Read This Map',
    '',
    model.map_reading_guide?.summary || 'Generated map reading guide.',
    '',
    '| Term | Meaning | Use | Trust boundary |',
    '|---|---|---|---|',
    ...renderMapReadingGuideRows(model.map_reading_guide),
    '',
    '## Protocol Readiness',
    '',
    model.protocol_readiness.summary,
    '',
    '| Check | Present | Missing | Repair | Sample missing plans |',
    '|---|---:|---:|---|---|',
    ...renderProtocolCheckRows(model.protocol_readiness),
    '',
    '| Plan | Protocol state | Status | Missing fields | Reason | Recommended command |',
    '|---|---|---|---|---|---|',
    ...renderProtocolReadinessRows(model.protocol_readiness),
    '',
    '## Graph Health',
    '',
    model.graph_health.summary,
    '',
    '| Signal | Reading |',
    '|---|---|',
    ...renderGraphHealthRows(model.graph_health),
    '',
    '### Map Confidence Actions',
    '',
    '| Signal | Count | Action | Filter | Sample plans |',
    '|---|---:|---|---|---|',
    ...renderMapConfidenceActionRows(model.graph_health.recommendations),
    '',
    '### Remediation Queue',
    '',
    '| Signal | Plan | Status | Recommended fix | Filter | Next command |',
    '|---|---|---|---|---|---|',
    ...renderRemediationQueueRows(model.remediation_queue),
    '',
    '### Unlinked Plan Triage',
    '',
    model.unlinked_plan_triage.summary,
    '',
    '| Plan | Status | Review | Risk | Next step | Next command | Source |',
    '|---|---|---|---|---|---|---|',
    ...renderUnlinkedPlanTriageRows(model.unlinked_plan_triage),
    '',
    '### Visual Flowcharts',
    '',
    model.visual_flowcharts.summary,
    '',
    '| Artifact | Type | Mermaid blocks | Dashboard | Command |',
    '|---|---|---|---|---|',
    ...renderVisualFlowchartRows(model.visual_flowcharts),
    '',
    '### Visual Coverage Queue',
    '',
    model.visual_coverage.summary,
    '',
    '| Cluster | Workstream | Plans | Links | Reason | Generate command |',
    '|---|---|---:|---:|---|---|',
    ...renderVisualCoverageRows(model.visual_coverage),
    '',
    '### Recent Source Activity',
    '',
    model.recent_activity.summary,
    '',
    '| Modified | Plan | Status | Workstream | Next command | Source |',
    '|---|---|---|---|---|---|',
    ...renderRecentActivityRows(model.recent_activity),
    '',
    '### Plan Progress Timeline',
    '',
    model.plan_progress_timeline.summary,
    '',
    '| Modified | Plan | Status | Workstream | Next step | Next command | Quality signals |',
    '|---|---|---|---|---|---|---|',
    ...renderPlanProgressTimelineRows(model.plan_progress_timeline),
    '',
    '## Plan Action Board',
    '',
    model.plan_action_board.summary,
    '',
    '| Lane | Plan | Status | Workstream | Reason | Next command |',
    '|---|---|---|---|---|---|',
    ...renderPlanActionBoardRows(model.plan_action_board),
    '',
    '## Execution Readiness',
    '',
    model.execution_readiness.summary,
    '',
    '| Lane | Plan | Readiness | Status | Missing protocol fields | Reason | Recommended command |',
    '|---|---|---|---|---|---|---|',
    ...renderExecutionReadinessRows(model.execution_readiness),
    '',
    '### Routing Blockers',
    '',
    model.routing_blockers.summary,
    '',
    '| Blocker lane | Count | First plan | Reason | Command |',
    '|---|---:|---|---|---|',
    ...renderRoutingBlockerRows(model.routing_blockers),
    '',
    '### First Repair Path',
    '',
    model.first_repair_path.summary,
    '',
    '| Step | Repair | Plan | Why first | Effect | Command |',
    '|---:|---|---|---|---|---|',
    ...renderFirstRepairPathRows(model.first_repair_path),
    '',
    '### Risk Gate Queue',
    '',
    model.risk_gate_queue.summary,
    '',
    '| Gate | Plan | Status | Review lane | Risk tier | Missing protocol | Reason | Command |',
    '|---|---|---|---|---|---|---|---|',
    ...renderRiskGateQueueRows(model.risk_gate_queue),
    '',
    '### Orchestration Routing Board',
    '',
    model.orchestration_routing_board.summary,
    '',
    '| Route | Plan | Owner | Status | Review lane | Risk tier | Missing protocol | Reason | Command |',
    '|---|---|---|---|---|---|---|---|---|',
    ...renderOrchestrationRoutingRows(model.orchestration_routing_board),
    '',
    '### Command Runbook',
    '',
    model.command_runbook.summary,
    '',
    '| Verb | Plan | Purpose | Surface | Gate or lane | Reason | Command |',
    '|---|---|---|---|---|---|---|',
    ...renderCommandRunbookRows(model.command_runbook),
    '',
    '## Data Quality',
    '',
    '| Signal | Count | Sample plans |',
    '|---|---:|---|',
    ...Object.entries(model.data_quality).map(([key, value]) => `| ${escapeCell(key)} | ${value.count} | ${escapeCell(value.sample.join(', ') || 'none')} |`),
    '',
    '## Visual Overview',
    '',
    '### Status Flow',
    '',
    renderStatusMermaid(buckets),
    '',
    '### Review Lanes',
    '',
    renderReviewLaneMermaid(plans),
    '',
    '### Plan Interconnections',
    '',
    renderRelationshipMermaid(relationships),
    '',
    relationships.length > 40 ? `Showing first 40 of ${relationships.length} detected relationships.` : `Showing ${relationships.length} detected relationships.`,
    '',
    '## Plan Groupings',
    '',
    '### Clients',
    '',
    renderTopGrouping(model.groupings.client_code),
    '',
    '### Frameworks',
    '',
    renderTopGrouping(model.groupings.framework),
    '',
    '### Review Lanes',
    '',
    renderTopGrouping(model.groupings.review_lane),
    '',
    '### Relationship Intents',
    '',
    renderTopGrouping(model.relationship_groupings.intent),
    '',
    '### Relationship Sources',
    '',
    renderTopGrouping(model.relationship_groupings.type),
    '',
    '### Relationship Confidence',
    '',
    renderTopGrouping(model.relationship_groupings.confidence),
    '',
    '## Relationship Clusters',
    '',
    '| Cluster | Workstream | Why named this way | Plans | Relationships | Top framework | Suggested next plan | Sample plans |',
    '|---|---|---|---:|---:|---|---|---|',
    ...model.relationship_clusters.slice(0, 12).map((cluster) => `| ${escapeCell(cluster.id)} | ${escapeCell(cluster.label)} | ${escapeCell(cluster.label_reason)} | ${cluster.size} | ${cluster.relationships} | ${escapeCell(`${cluster.top_framework.label} (${cluster.top_framework.count})`)} | ${escapeCell(`${cluster.next_plan.task_id} (${cluster.next_plan.status})`)} | ${escapeCell(cluster.sample_plans.join(', '))} |`),
    '',
    '## Workstream Matrix',
    '',
    '| Cluster | Workstream | Plans | Links | Ready/In progress | Attention | Top intents | Status mix | Suggested next | Brief |',
    '|---|---|---:|---:|---:|---:|---|---|---|---|',
    ...renderWorkstreamMatrixRows(model.workstream_matrix, { links: true }),
    '',
    '## Workstream Drilldowns',
    '',
    model.workstream_drilldowns.summary,
    '',
    '| Workstream | Slice | Plans | Ready/In progress | Status mix | Top intents | Quality flags | Suggested next | Command |',
    '|---|---|---:|---:|---|---|---|---|---|',
    ...renderWorkstreamDrilldownRows(model.workstream_drilldowns),
    '',
    '## Workstream Connection Stories',
    '',
    '| Cluster | Workstream | Explanation | Example links | Bridge plans | Brief |',
    '|---|---|---|---|---|---|',
    ...renderWorkstreamStoryRows(model.workstream_stories),
    '',
    '## Impact Hubs',
    '',
    model.impact_hubs.summary,
    '',
    '| Plan | Role | Links | Incoming | Outgoing | Top intent | Workstream | Why it matters | Next command |',
    '|---|---|---:|---:|---:|---|---|---|---|',
    ...renderImpactHubRows(model.impact_hubs),
    '',
    '## Connection Hubs',
    '',
    '| Plan | Role | Links | Incoming | Outgoing | Top intent | Workstream | Next step |',
    '|---|---|---:|---:|---:|---|---|---|',
    ...renderRelationshipHubRows(model.relationship_hubs.slice(0, 12)),
    '',
    '## Action Paths',
    '',
    '| Plan | Status | Upstream | Downstream | Feeds from | Feeds into | Workstream | Next step |',
    '|---|---|---:|---:|---|---|---|---|',
    ...renderActionPathRows(model.action_paths.slice(0, 12)),
    '',
    '## Dependency & Sequence Chains',
    '',
    '| Chain | Hops | Intents | Workstream | Next plan | Next command | Map |',
    '|---|---:|---|---|---|---|---|',
    ...renderDependencySequenceChainRows(model.dependency_sequence_chains || []),
    '',
    '## Interconnection Table',
    '',
    '| Source | Relationship | Intent | Confidence | Target | Evidence |',
    '|---|---|---|---|---|---|'
  ];

  if (relationships.length === 0) {
    lines.push('| none | none | none | none | none | No relationship metadata found |');
  } else {
    for (const relationship of relationships) {
      const confidence = `${relationship.confidence || 'unknown'}: ${relationship.confidence_reason || 'No confidence reason recorded.'}`;
      lines.push(`| ${escapeCell(relationship.source)} | ${escapeCell(relationship.type)} | ${escapeCell(relationship.intent)} | ${escapeCell(confidence)} | ${escapeCell(relationship.target)} | ${escapeCell(relationship.evidence)} |`);
    }
  }

  lines.push(
    '',
    '## Plans',
    '',
    '| Status | Task | Client | Framework | Steps | Next step | Quality | Risk | Review | Approval | Next |',
    '|---|---|---|---|---:|---|---|---|---|---|---|'
  );

  for (const plan of plans) {
    const stepText = `${plan.step_counts.complete}/${plan.step_counts.total}`;
    const task = `[${escapeCell(plan.task_id)}](${plan.path})`;
    const nextStep = `${plan.next_step.step_id}: ${plan.next_step.description}`;
    lines.push(`| ${escapeCell(plan.status)} | ${task} | ${escapeCell(plan.client_code)} | ${escapeCell(plan.framework)} | ${stepText} | ${escapeCell(nextStep)} | ${escapeCell(plan.quality_flags.join(', ') || 'ok')} | ${escapeCell(plan.risk_tier)} | ${escapeCell(plan.review_lane)} | ${escapeCell(plan.approval)} | \`${escapeBackticks(plan.next_command)}\` |`);
  }

  lines.push(
    '',
    '## Notes',
    '',
    '- Run with `--include-client` only when client-plan visibility is explicitly needed.',
    '- Use `/review-task-plan <task-id>` before execution when approval or review state is missing.',
    '- Use `/run-plan <task-id>` only after the required distinct review and operator gates are satisfied.'
  );

  return `${lines.join('\n')}\n`;
}

function renderFocusedVisualPlanMarkdown(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const model = buildPlanVisibilityModel(projectRoot, { includeClient, generatedAt });
  const byId = new Map(model.plans.map((plan) => [plan.task_id, plan]));
  let subject = null;
  let selectedIds = new Set();
  let selectedRelationships = [];

  if (options.clusterId) {
    const cluster = model.relationship_clusters.find((item) => item.id === options.clusterId);
    if (!cluster) throw new Error(`Unknown relationship cluster: ${options.clusterId}`);
    subject = {
      type: 'cluster',
      id: cluster.id,
      title: `${cluster.label} (${cluster.id})`,
      description: `${cluster.relationships} relationships; top framework ${cluster.top_framework.label} (${cluster.top_framework.count}); suggested next plan ${cluster.next_plan.task_id} (${cluster.next_plan.status}).`
    };
    selectedIds = new Set(cluster.plan_ids);
    selectedRelationships = model.relationships.filter((relationship) => (
      selectedIds.has(relationship.source)
      && selectedIds.has(relationship.target)
    ));
  } else if (options.taskId) {
    const plan = byId.get(options.taskId);
    if (!plan) throw new Error(`Unknown task plan: ${options.taskId}`);
    subject = {
      type: 'plan',
      id: plan.task_id,
      title: plan.title,
      description: `${plan.status} plan in ${plan.framework}; next step ${plan.next_step.step_id}.`
    };
    selectedRelationships = model.relationships.filter((relationship) => (
      relationship.source === plan.task_id
      || relationship.target === plan.task_id
    ));
    selectedIds = new Set([
      plan.task_id,
      ...selectedRelationships.map((relationship) => relationship.source),
      ...selectedRelationships.map((relationship) => relationship.target)
    ]);
  } else {
    throw new Error('Pass either taskId or clusterId.');
  }

  const selectedPlans = [...selectedIds]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
  const statusBuckets = selectedPlans.reduce((acc, plan) => {
    acc[plan.status] = (acc[plan.status] || 0) + 1;
    return acc;
  }, {});
  const incoming = options.taskId
    ? selectedRelationships.filter((relationship) => relationship.target === options.taskId)
    : [];
  const outgoing = options.taskId
    ? selectedRelationships.filter((relationship) => relationship.source === options.taskId)
    : [];
  const focusedHubs = model.relationship_hubs
    .filter((hub) => selectedIds.has(hub.task_id))
    .slice(0, 8);
  const focusedActionPaths = model.action_paths
    .filter((item) => selectedIds.has(item.task_id))
    .slice(0, 8);

  const lines = [
    `# Visual Plan: ${subject.id}`,
    '',
    `generated_at: ${generatedAt}`,
    `scope: ${model.scope}`,
    `subject_type: ${subject.type}`,
    '',
    '> Derived visual context only. Task-plan JSON/MD, amendments, reviews, signals, and canonical command specs remain authority.',
    '',
    '## Focus',
    '',
    `- title: ${subject.title}`,
    `- summary: ${subject.description}`,
    `- visible plans: ${selectedPlans.length}`,
    `- visible relationships: ${selectedRelationships.length}`,
    '',
    '## Flowchart',
    '',
    renderRelationshipMermaid(selectedRelationships, 80),
    '',
    selectedRelationships.length > 80 ? `Showing first 80 of ${selectedRelationships.length} visible relationships.` : `Showing ${selectedRelationships.length} visible relationships.`,
    '',
    '## Status Mix',
    '',
    renderTopGrouping(statusBuckets),
    '',
    '## Connection Hubs',
    '',
    '| Plan | Role | Links | Incoming | Outgoing | Top intent | Workstream | Next step |',
    '|---|---|---:|---:|---:|---|---|---|',
    ...renderRelationshipHubRows(focusedHubs),
    '',
    '## Action Paths',
    '',
    '| Plan | Status | Upstream | Downstream | Feeds from | Feeds into | Workstream | Next step |',
    '|---|---|---:|---:|---|---|---|---|',
    ...renderActionPathRows(focusedActionPaths),
    '',
    '## Plans',
    '',
    '| Status | Task | Framework | Steps | Next step | Review | Risk | Source |',
    '|---|---|---|---:|---|---|---|---|'
  ];

  for (const plan of selectedPlans) {
    const stepText = `${plan.step_counts.complete}/${plan.step_counts.total}`;
    const nextStep = `${plan.next_step.step_id}: ${plan.next_step.description}`;
    lines.push(`| ${escapeCell(plan.status)} | ${escapeCell(plan.task_id)} | ${escapeCell(plan.framework)} | ${stepText} | ${escapeCell(nextStep)} | ${escapeCell(plan.review_lane)} | ${escapeCell(plan.risk_tier)} | [source](${plan.path}) |`);
  }

  if (options.taskId) {
    lines.push(
      '',
      '## Selected Plan Relationship Direction',
      '',
      `- incoming: ${incoming.length}`,
      `- outgoing: ${outgoing.length}`
    );
  }

  lines.push(
    '',
    '## Relationships',
    '',
    '| Source | Relationship | Intent | Confidence | Target | Evidence |',
    '|---|---|---|---|---|---|'
  );

  if (selectedRelationships.length === 0) {
    lines.push('| none | none | none | none | none | No visible relationships found for this focus. |');
  } else {
    for (const relationship of selectedRelationships) {
      const confidence = `${relationship.confidence || 'unknown'}: ${relationship.confidence_reason || 'No confidence reason recorded.'}`;
      lines.push(`| ${escapeCell(relationship.source)} | ${escapeCell(relationship.type)} | ${escapeCell(relationship.intent)} | ${escapeCell(confidence)} | ${escapeCell(relationship.target)} | ${escapeCell(relationship.evidence)} |`);
    }
  }

  lines.push(
    '',
    '## Operator Notes',
    '',
    '- Use this as a portable visual brief for review, discussion, or handoff.',
    '- Use the dashboard for broader filtering and source navigation.',
    '- Use `/review-task-plan <task-id>` or `/run-plan <task-id>` only from the authoritative plan state.'
  );

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Readable plan-document render ("three-into-one")
//
// renderPlanDocumentMarkdown produces ONE self-contained, human-readable
// document — useful to the operator, dealership stakeholders, AND agents.
// Unlike the focused visual brief (graph + dashboard tables), it reads the RAW
// plan JSON directly so the FULL step prose survives (the derived model
// stripRawPlan()s it away), and emits an inline SVG diagram (Mermaid does not
// survive md->html — md-to-html.js has no fenced-code support), an inline
// glossary so nothing is a dangling reference, and a clearly-marked Agent
// Grounding block.
//
// Tolerant of BOTH plan shapes:
//   - canonical `bounded_plan.steps[]` (step_id, full description,
//     framework_step, mode, is_gap, + bounded_plan-level required_gates[],
//     expected_outcomes[], risk_notes)
//   - older top-level `steps[]` (id, classification, depends_on, gate,
//     review_lane), as in strategy-north-star__plan.json
// Degrades gracefully when a field is absent.
// ---------------------------------------------------------------------------

// Locate a plan JSON by id across the system root and every client plans dir.
// Mirrors view-plan.js's findPlanJson so the doc render and the legacy alias
// resolve identically.
function findPlanJsonPath(projectRoot, id) {
  const candidates = [
    path.join(projectRoot, SYSTEM_PLAN_ROOT, `${id}__plan.json`)
  ];
  const clientsRoot = path.join(projectRoot, CLIENTS_ROOT);
  if (fs.existsSync(clientsRoot)) {
    for (const clientCode of fs.readdirSync(clientsRoot).sort()) {
      candidates.push(path.join(clientsRoot, clientCode, 'plans', `${id}__plan.json`));
    }
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// Return the canonical step array regardless of shape, plus which shape it is.
function resolvePlanSteps(plan) {
  if (Array.isArray(plan?.bounded_plan?.steps) && plan.bounded_plan.steps.length) {
    return { steps: plan.bounded_plan.steps, shape: 'bounded_plan' };
  }
  if (Array.isArray(plan?.steps) && plan.steps.length) {
    return { steps: plan.steps, shape: 'top-level' };
  }
  return { steps: [], shape: 'none' };
}

// Pull a stable id off a step under either shape.
function stepId(step) {
  return step.step_id || step.id || 'unnamed-step';
}

// Normalize a value into a string array for readable list rendering. Accepts a
// string (single item), an array, or nullish (empty).
function asList(value) {
  if (Array.isArray(value)) return value.filter((item) => item != null && String(item).trim());
  if (value == null) return [];
  const text = String(value).trim();
  return text ? [text] : [];
}

function buildPlanDocumentLead(plan, context = {}) {
  const title = context.title || plan?.title || plan?.task_summary || plan?.task_id || 'this plan';
  const scopeType = plan?.scope_type || (plan?.client_code ? 'client' : 'system');
  const clientCode = plan?.client_code ? ` (${plan.client_code})` : '';
  const scope = scopeType === 'client' ? `client${clientCode}` : scopeType;
  const status = context.status || classifyPlan(plan);
  const reviewLane = context.reviewLane || plan?.routing_expectations?.review_lane || plan?.review_lane || 'not-recorded';
  const steps = Array.isArray(context.steps) ? context.steps : resolvePlanSteps(plan).steps;
  const nextStep = steps.find((step) => {
    const stepStatus = String(step.status || step.state || '').toLowerCase();
    return !['complete', 'completed', 'done', 'closed'].includes(stepStatus);
  });
  const nextAction = nextStep
    ? `${stepId(nextStep)}: ${summarizeLeadText(nextStep.description || nextStep.summary || nextStep.name || 'No step description recorded.')}`
    : (context.nextCommand || inferNextCommand(plan));

  return `This is a ${scope} plan for ${title}; it is currently ${status}, review runs through ${reviewLane}, and the next action is ${nextAction}.`;
}

function summarizeLeadText(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text.replace(/[.。]+$/u, '');
  const sentence = text.match(/^(.+?[.!?])\s+/);
  if (sentence && sentence[1].length <= maxLength) {
    return sentence[1].replace(/[.。]+$/u, '');
  }
  return `${text.slice(0, maxLength - 1).trim().replace(/[.。]+$/u, '')}…`;
}

// ---- inline SVG DAG (folds + fixes view-plan.js's generator) --------------
// view-plan.js read plan.steps / step.depends_on / step.classification — an OLD
// shape that silently fails on canonical bounded_plan plans (no depends_on).
// This builder reads canonical steps and derives column order from step
// SEQUENCE (since there is no depends_on to lean on), overlaying model
// relationships as edges when both endpoints are the subject plan's own steps
// are not available — at the plan-document scale the nodes ARE the steps, so we
// sequence them and draw next-step edges. The old depends_on path is kept as a
// fallback for plans that still carry it.
function buildPlanDagSvg(plan, options = {}) {
  const title = options.title || plan.title || plan.task_id || 'plan';
  const { steps, shape } = resolvePlanSteps(plan);
  if (!steps.length) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="60">'
      + '<text x="12" y="34" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="13" fill="#7a0016">No steps to diagram.</text></svg>';
  }

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wrap = (text, n) => {
    const words = String(text || '').split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      if ((`${cur} ${w}`).trim().length > n) { out.push(cur.trim()); cur = w; } else cur += ` ${w}`;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.slice(0, 3);
  };

  const ids = steps.map(stepId);
  const byId = new Map(steps.map((s) => [stepId(s), s]));

  // Column (depth) per node. Prefer explicit depends_on (older shape); else
  // fall back to linear sequence so canonical plans still lay out left-to-right.
  const hasDeps = steps.some((s) => Array.isArray(s.depends_on) && s.depends_on.length);
  const depthMemo = new Map();
  function depth(id, seen = new Set()) {
    if (depthMemo.has(id)) return depthMemo.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const s = byId.get(id);
    const deps = (s && Array.isArray(s.depends_on) ? s.depends_on : []).filter((d) => byId.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(x, seen))) : 0;
    depthMemo.set(id, d);
    return d;
  }
  if (hasDeps) {
    ids.forEach((id) => depth(id));
  } else {
    ids.forEach((id, i) => depthMemo.set(id, i));
  }

  const cols = new Map();
  for (const s of steps) {
    const d = depthMemo.get(stepId(s)) || 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(s);
  }

  const COLW = 320;
  const ROWH = 120;
  const BOXW = 264;
  const BOXH = 88;
  const PADX = 36;
  const PADY = 54;
  const pos = new Map();
  let maxRows = 0;
  for (const [d, list] of cols) {
    maxRows = Math.max(maxRows, list.length);
    list.forEach((s, i) => {
      pos.set(stepId(s), { x: PADX + d * COLW, y: PADY + i * ROWH });
    });
  }
  const width = PADX * 2 + cols.size * COLW;
  const height = PADY * 2 + maxRows * ROWH;

  const colorFor = (step) => {
    const cl = String(step.classification || '').toLowerCase();
    if (step.is_gap === true || cl === 'gap') return { fill: '#fff3e6', stroke: '#b0420e', text: '#7a2d09' };
    if (cl === 'gate') return { fill: '#fdeae6', stroke: '#b00020', text: '#7a0016' };
    if (cl && /cover/.test(cl)) return { fill: '#e7f5ec', stroke: '#1e7b4d', text: '#155a38' };
    return { fill: '#eef1f5', stroke: '#5a636b', text: '#2a3138' };
  };

  // Edges: explicit depends_on when present, else sequential step->next-step.
  let edges = '';
  const edge = (fromId, toId) => {
    const from = pos.get(fromId);
    const to = pos.get(toId);
    if (!from || !to) return;
    const x1 = from.x + BOXW;
    const y1 = from.y + BOXH / 2;
    const x2 = to.x;
    const y2 = to.y + BOXH / 2;
    const mx = (x1 + x2) / 2;
    edges += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#9aa3ad" stroke-width="1.6" marker-end="url(#arrow)"/>`;
  };
  if (hasDeps) {
    for (const s of steps) {
      for (const dep of (s.depends_on || [])) edge(dep, stepId(s));
    }
  } else {
    for (let i = 0; i < ids.length - 1; i += 1) edge(ids[i], ids[i + 1]);
  }

  let nodes = '';
  for (const s of steps) {
    const p = pos.get(stepId(s));
    const c = colorFor(s);
    const tag = s.is_gap === true ? 'gap' : (s.mode || s.classification || '');
    const lines = wrap(s.description || s.summary || s.name, 38);
    const tspans = lines
      .map((ln, i) => `<tspan x="${p.x + 14}" dy="${i === 0 ? 0 : 14}">${esc(ln)}</tspan>`)
      .join('');
    nodes += `<g>
    <rect x="${p.x}" y="${p.y}" width="${BOXW}" height="${BOXH}" rx="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>
    <text x="${p.x + 14}" y="${p.y + 20}" font-weight="700" font-size="13" fill="${c.text}">${esc(stepId(s))} <tspan font-weight="400" font-size="10.5">[${esc(tag)}]</tspan></text>
    <text x="${p.x + 14}" y="${p.y + 40}" font-size="11" fill="#2a3138">${tspans}</text>
  </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system,Segoe UI,Inter,Arial,sans-serif">
  <defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#9aa3ad"/></marker></defs>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${PADX}" y="30" font-size="16" font-weight="700" fill="#0b1f3a">${esc(title)} (${esc(shape)} shape, ${steps.length} steps)</text>
  ${edges}
  ${nodes}
</svg>`;
}

// ---- inline glossary -------------------------------------------------------
// No glossary exists in the repo; this builds a small permissive term->def
// lookup (calibrate-then-tighten). Slash-command definitions are pulled live
// from the canonical command-index + per-command yaml so they never drift.
const STATIC_GLOSSARY = {
  'verify-local': 'Review lane: the producing actor self-verifies via local checks (node --check, tests, smokes). Cheapest lane; used when self-read is a reliable observer of the change.',
  'codex-bridge': 'Review lane: hand the plan/artifact to a distinct mind (Codex) for independent review before execution, because the producer cannot validate its own acceptance-grade outcome.',
  'operator-gate': 'Review lane: the human operator must explicitly approve before the work proceeds. Reserved for irreversible, client-facing, or money/account-touching surfaces.',
  low: 'Risk tier: reversible, scoped, low blast radius. Eligible for the cheapest review lane.',
  medium: 'Risk tier: cross-surface or harness-adjacent change; warrants a distinct-mind review before execution.',
  high: 'Risk tier: client-facing, irreversible, or new always-on infrastructure; requires operator gating and usually a convene.',
  gap: 'A step that builds something that does not yet exist (a capability gap), as opposed to covering an existing framework step.',
  'is_gap': 'Step flag (canonical shape): true means the step fills a capability gap rather than covering an existing framework step.'
};

// Build a term->definition map limited to terms that actually appear in the
// document text. Permissive: only emits a definition when the term is present,
// so the glossary never carries dangling entries.
function buildInlineGlossary(projectRoot, documentText) {
  const text = String(documentText || '');
  const defs = new Map();

  for (const [term, def] of Object.entries(STATIC_GLOSSARY)) {
    if (text.includes(term)) defs.set(term, def);
  }

  // Slash-commands used in the doc (e.g. /run-plan, /amend-plan) — define from
  // the canonical command-index description, which is generated from the yaml.
  const slashCommands = new Set();
  for (const match of text.matchAll(/(?:^|[\s(])\/([a-z][a-z0-9-]+)\b/g)) {
    slashCommands.add(match[1]);
  }
  if (slashCommands.size) {
    const indexPath = path.join(projectRoot, 'instructions', 'canonical', 'command-index.md');
    let indexText = '';
    try { indexText = fs.readFileSync(indexPath, 'utf8'); } catch { indexText = ''; }
    for (const command of [...slashCommands].sort()) {
      // command-index lines look like: - `run-plan` (COORDINATOR): `...path...`
      const lineRe = new RegExp(`\\\`${command}\\\`\\s*\\(([^)]+)\\):`);
      const m = indexText.match(lineRe);
      let def = null;
      // Prefer the richer per-command yaml description when present.
      const yamlPath = path.join(projectRoot, 'instructions', 'canonical', 'commands', `${command}.yaml`);
      const spec = readJson(yamlPath);
      if (spec && spec.description) {
        def = `Command (${spec.mode || (m ? m[1] : 'command')}): ${spec.description}.`;
      } else if (m) {
        def = `Command (${m[1]}): see instructions/canonical/commands/${command}.yaml.`;
      }
      if (def) defs.set(`/${command}`, def);
    }
  }

  return [...defs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ---- shared two-surface primitive ------------------------------------------
// The reusable "two-surface" pattern: a clearly-marked Agent Grounding block
// (structured machine data) plus a human-prose body. Returned as Markdown so
// the future Strategy North Star can back its tabs with the same engine. The
// caller supplies the grounding key/value pairs and the already-rendered prose
// body sections; this primitive only owns the SHAPE (marked heading + fenced
// structured block + prose), not the content. No North Star data adapters.
function renderTwoSurfaceMarkdown({ groundingTitle, grounding, proseTitle, proseBody }) {
  const lines = [];
  lines.push(`## ${groundingTitle || 'Agent Grounding (structured)'}`);
  lines.push('');
  lines.push('> Machine-readable grounding for agents. Authority remains the plan JSON/MD, amendments, reviews, signals, and canonical command specs.');
  lines.push('');
  const entries = Array.isArray(grounding) ? grounding : Object.entries(grounding || {});
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  for (const [key, value] of entries) {
    lines.push(`| ${escapeCell(key)} | ${escapeCell(value)} |`);
  }
  lines.push('');
  if (proseTitle) {
    lines.push(`## ${proseTitle}`);
    lines.push('');
  }
  if (proseBody) lines.push(proseBody);
  return lines.join('\n');
}

// ---- main readable plan-document render ------------------------------------
function renderPlanDocumentMarkdown(projectRoot, options = {}) {
  const taskId = options.taskId;
  if (!taskId) throw new Error('Pass taskId to renderPlanDocumentMarkdown.');
  const generatedAt = options.generatedAt || new Date().toISOString();

  const planPath = options.planPath || findPlanJsonPath(projectRoot, taskId);
  if (!planPath || !fs.existsSync(planPath)) {
    throw new Error(`No plan JSON found for "${taskId}" in task-plans/ or clients/*/plans/.`);
  }
  // Read the RAW plan JSON directly — the derived model strips full step prose.
  const plan = readJson(planPath);
  if (!plan) throw new Error(`Plan JSON at ${planPath} is unreadable (parse error).`);

  const { steps, shape } = resolvePlanSteps(plan);
  const planRel = toRelative(projectRoot, planPath);

  // Relationship/diagram layer only — pull from the derived model.
  let modelPlan = null;
  let relationships = [];
  try {
    const model = buildPlanVisibilityModel(projectRoot, {
      includeClient: planRel.startsWith('clients/'),
      generatedAt
    });
    modelPlan = model.plans.find((p) => p.task_id === (plan.task_id || taskId)) || null;
    relationships = model.relationships.filter((r) => (
      r.source === (plan.task_id || taskId) || r.target === (plan.task_id || taskId)
    ));
  } catch {
    modelPlan = null;
    relationships = [];
  }

  const title = plan.title || plan.task_summary || plan.task_id || taskId;
  const reviewLane = plan.routing_expectations?.review_lane || plan.review_lane || 'not-recorded';
  const reviewLaneRationale = plan.routing_expectations?.review_lane_rationale
    || plan.review_lane_rationale || 'Not recorded.';
  const riskTier = plan.routing_expectations?.risk_tier || plan.risk_tier || 'not-recorded';
  const status = classifyPlan(plan);
  const nextCommand = inferNextCommand(plan);

  // ---- (a) Context — readable prose lead (matches the readable-plan format:
  // a "Context" section in plain prose before any structured body) ----
  // Open with the title then Context prose — technical metadata + the authority
  // blockquote are demoted to a "## Document details" section at the bottom.
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(`**What this is:** ${buildPlanDocumentLead(plan, { title, status, reviewLane, nextCommand, steps })}`);
  lines.push('');
  const whatWhy = asList(plan.task_summary).concat(asList(plan.description));
  if (whatWhy.length) {
    for (const para of whatWhy) { lines.push(para); lines.push(''); }
  } else {
    lines.push('No task summary or description recorded.');
    lines.push('');
  }
  for (const justification of asList(plan.scope_justification)) {
    lines.push(`**Scope:** ${justification}`);
    lines.push('');
  }

  // ---- (b) Steps (in prose) — FULL prose per step ----
  lines.push('## Steps (in prose)');
  lines.push('');
  if (!steps.length) {
    lines.push('This plan records no steps.');
    lines.push('');
  } else {
    for (const step of steps) {
      lines.push(`### ${stepId(step)}`);
      lines.push('');
      const desc = step.description || step.summary || step.name || 'No step description recorded.';
      lines.push(desc);
      lines.push('');
      // Per-step attributes degrade gracefully across both shapes.
      const tags = [];
      if (step.is_gap === true || String(step.classification).toLowerCase() === 'gap') tags.push('fills a gap');
      if (step.mode) tags.push(`mode: ${step.mode}`);
      if (step.classification) tags.push(`classification: ${step.classification}`);
      if (step.framework_step) tags.push(`framework step: ${step.framework_step}`);
      if (step.review_lane) tags.push(`review lane: ${step.review_lane}`);
      if (tags.length) { lines.push(`*${tags.join(' · ')}*`); lines.push(''); }

      const gates = asList(step.required_gates).concat(asList(step.gate));
      if (gates.length) {
        lines.push('**Gates:**');
        for (const g of gates) lines.push(`- ${g}`);
        lines.push('');
      }
      const outcomes = asList(step.expected_outcomes);
      if (outcomes.length) {
        lines.push('**Expected outcomes:**');
        for (const o of outcomes) lines.push(`- ${o}`);
        lines.push('');
      }
      const risks = asList(step.risk_notes);
      if (risks.length) {
        lines.push('**Risks:**');
        for (const r of risks) lines.push(`- ${r}`);
        lines.push('');
      }
    }
  }

  // Plan-level gates/outcomes/risks (canonical bounded_plan carries these at
  // the plan level, not per step). Render them so nothing is dropped.
  const planGates = asList(plan.bounded_plan?.required_gates).concat(asList(plan.required_gates));
  const planOutcomes = asList(plan.bounded_plan?.expected_outcomes).concat(asList(plan.expected_outcomes));
  const planRisks = asList(plan.bounded_plan?.risk_notes).concat(asList(plan.risk_notes));
  if (planGates.length || planOutcomes.length || planRisks.length) {
    lines.push('## Gates & risks');
    lines.push('');
    if (planGates.length) {
      lines.push('**Required gates:**');
      for (const g of planGates) lines.push(`- ${g}`);
      lines.push('');
    }
    if (planOutcomes.length) {
      lines.push('**Expected outcomes:**');
      for (const o of planOutcomes) lines.push(`- ${o}`);
      lines.push('');
    }
    if (planRisks.length) {
      lines.push('**Risk notes:**');
      for (const r of planRisks) lines.push(`- ${r}`);
      lines.push('');
    }
  }

  // ---- (c) How it connects — embedded diagram (inline SVG; survives md->html) ----
  lines.push('## How it connects');
  lines.push('');
  lines.push(buildPlanDagSvg(plan, { title }));
  lines.push('');

  // ---- (e) Agent Grounding block (two-surface primitive) ----
  const grounding = [
    ['status', status],
    ['review_lane', reviewLane],
    ['review_lane_rationale', reviewLaneRationale],
    ['risk_tier', riskTier],
    ['next_command', nextCommand],
    ['steps', `${steps.length} (${shape} shape)`]
  ];
  if (relationships.length) {
    const rel = relationships
      .slice(0, 8)
      .map((r) => `${r.source} ${r.type} ${r.target}`)
      .join('; ');
    grounding.push(['key_relationships', rel]);
  }
  if (modelPlan?.quality_flags?.length) {
    grounding.push(['quality_flags', modelPlan.quality_flags.join(', ')]);
  }
  lines.push(renderTwoSurfaceMarkdown({
    groundingTitle: 'Agent grounding',
    grounding
  }));
  lines.push('');

  // ---- (f) Narrative — inline sibling <id>__plan.md when present ----
  const narrativePath = planPath.replace(/__plan\.json$/, '__plan.md');
  if (fs.existsSync(narrativePath)) {
    let narrative = '';
    try { narrative = fs.readFileSync(narrativePath, 'utf8'); } catch { narrative = ''; }
    if (narrative.trim()) {
      lines.push('## Narrative (hand-authored)');
      lines.push('');
      lines.push(`> Inlined from [${toRelative(projectRoot, narrativePath)}](${toRelative(projectRoot, narrativePath)}).`);
      lines.push('');
      lines.push(narrative.trim());
      lines.push('');
    }
  }

  // ---- (d) Glossary defined inline (built LAST so it sees all doc text) ----
  const bodyForGlossary = lines.join('\n');
  const glossary = buildInlineGlossary(projectRoot, bodyForGlossary);
  lines.push('## Glossary');
  lines.push('');
  if (!glossary.length) {
    lines.push('No specialized terms detected in this document.');
    lines.push('');
  } else {
    for (const [term, def] of glossary) {
      lines.push(`- **${term}** — ${def}`);
    }
    lines.push('');
  }

  // ---- (e) Document details — technical metadata + authority blockquote,
  // demoted from the top so the doc opens on Context. Built after the glossary
  // so the ISO timestamp / ids don't pollute term detection. ----
  lines.push('## Document details');
  lines.push('');
  lines.push(`generated_at: ${generatedAt}`);
  lines.push(`plan_id: ${plan.task_id || taskId}  ·  shape: ${shape}  ·  status: ${status}`);
  lines.push(`source: [${planRel}](${planRel})`);
  lines.push('');
  lines.push('> Readable plan document — one page for the operator, stakeholders, and agents. Authority remains the plan JSON/MD, amendments, reviews, signals, and canonical command specs.');
  lines.push('');

  // ---- (g) Optional self-containment lint note (advisory; never blocks) ----
  // Run the rendered Markdown through the deliverable self-containment lint and,
  // if it warns, note the count at the bottom. Fully guarded: any failure to run
  // the lint leaves the document unchanged.
  if (options.selfContainmentLint !== false) {
    const note = runSelfContainmentLintNote(projectRoot, lines.join('\n'));
    if (note) { lines.push(note); lines.push(''); }
  }

  return `${lines.join('\n')}\n`;
}

// Run the deliverable self-containment lint over rendered Markdown and return a
// one-line advisory note (or '' on clean / unavailable). The lint tool runs as
// a CLI (its module body self-executes), so we shell out with --json and read
// stdin. Never throws: any error returns '' so the render is unaffected.
function runSelfContainmentLintNote(projectRoot, markdown) {
  const lintPath = path.join(projectRoot, 'tools', 'artifacts', 'deliverable-self-containment-lint.js');
  if (!fs.existsSync(lintPath)) return '';
  try {
    const out = require('child_process').execFileSync(
      process.execPath,
      [lintPath, '--json'],
      { input: markdown, encoding: 'utf8', cwd: projectRoot }
    );
    const parsed = JSON.parse(out);
    const total = Number(parsed.total) || 0;
    if (!total) return '';
    const parts = Object.entries(parsed.counts || {})
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    return `> Self-containment lint (advisory, non-blocking): ${total} finding(s) — ${parts}. `
      + `Expected here: the document intentionally cites the plan JSON source path for provenance.`;
  } catch {
    return '';
  }
}

// Slugify a heading's inner HTML into a stable, anchor-safe id.
function slugifyHeading(innerHtml) {
  const text = String(innerHtml || '')
    .replace(/<[^>]+>/g, ' ')          // strip inline tags (code/em/etc.)
    .replace(/&[a-z]+;/gi, ' ')        // strip HTML entities
    .toLowerCase();
  const slug = text
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

// Wrap the readable Markdown via md-to-html.js into a self-contained,
// OFFLINE HTML document that matches the readable-plan format AND adds
// self-contained interactivity:
//   - a Context-led prose document (section order set by the Markdown render),
//   - native <details>/<summary> collapsible sections (no JS required to use),
//   - a sticky table-of-contents nav that jumps to each section (anchor links;
//     a little inline JS for smooth-scroll + active-highlight only),
//   - the inline SVG diagram embedded verbatim,
//   - the inline glossary.
// All CSS and JS are inline; the document opens from file:// with zero network.
//
// md-to-html has no fenced-code support and would mangle raw SVG embedded in
// prose, so we extract the SVG, convert the Markdown around it, and re-insert
// the SVG verbatim. md-to-html emits <h2>..<h4> without ids, so we post-process
// the body: add a slug id to every heading, then fold each top-level <h2>
// section (heading + everything until the next <h2>) into a <details> block.
function renderPlanDocumentHtml(projectRoot, options = {}) {
  const markdown = renderPlanDocumentMarkdown(projectRoot, options);
  const { mdToHtml, escapeHtml } = require('../../mcp/delesign/md-to-html');

  // Extract any inline <svg>...</svg> blocks so md-to-html doesn't escape them.
  const svgBlocks = [];
  const placeholderPrefix = 'SMOSSVGPLACEHOLDER';
  const withPlaceholders = markdown.replace(/<svg[\s\S]*?<\/svg>/g, (svg) => {
    const token = `${placeholderPrefix}${svgBlocks.length}END`;
    svgBlocks.push(svg);
    return `\n\n${token}\n\n`;
  });

  let bodyHtml = mdToHtml(withPlaceholders);
  svgBlocks.forEach((svg, i) => {
    const token = `${placeholderPrefix}${i}END`;
    // md-to-html wraps the lone placeholder line as <p>TOKEN</p>; replace either.
    bodyHtml = bodyHtml.replace(`<p>${token}</p>`, `<div class="diagram">${svg}</div>`);
    bodyHtml = bodyHtml.replace(token, `<div class="diagram">${svg}</div>`);
  });

  // Add slug ids to every heading so anchors/nav can target them; keep ids
  // unique even when two headings slugify the same.
  const usedIds = new Set();
  bodyHtml = bodyHtml.replace(/<(h[1-4])>([\s\S]*?)<\/\1>/g, (_m, tag, inner) => {
    let id = slugifyHeading(inner);
    let unique = id;
    let n = 2;
    while (usedIds.has(unique)) { unique = `${id}-${n}`; n += 1; }
    usedIds.add(unique);
    return `<${tag} id="${unique}">${inner}</${tag}>`;
  });

  // Split the body into top-level sections and fold each into a native
  // collapsible <details> (works offline with no JS). md-to-html maps the
  // document title (`# `) to <h2> and our `## ` section headings to <h3>, so the
  // section boundary is <h3>; the <h2> title + lead blockquote stays outside,
  // always visible. Collect the section id + visible title for the
  // table-of-contents nav.
  const toc = [];
  const sectionRe = /<h3 id="([^"]+)">([\s\S]*?)<\/h3>/g;
  const indices = [];
  let mm;
  while ((mm = sectionRe.exec(bodyHtml)) !== null) {
    indices.push({ start: mm.index, end: mm.index + mm[0].length, id: mm[1], inner: mm[2] });
  }
  let assembled;
  if (!indices.length) {
    assembled = bodyHtml;
  } else {
    const head = bodyHtml.slice(0, indices[0].start);
    const parts = [head];
    indices.forEach((sec, i) => {
      const bodyStart = sec.end;
      const bodyEnd = i + 1 < indices.length ? indices[i + 1].start : bodyHtml.length;
      const sectionBody = bodyHtml.slice(bodyStart, bodyEnd);
      const titleText = sec.inner.replace(/<[^>]+>/g, '');
      toc.push({ id: sec.id, title: titleText });
      // Default sections CLOSED so a non-technical reviewer can scan the section
      // headers first, then expand. EXCEPT Context, which stays open as the
      // landing orientation. (Deep-link clicks open a closed section via JS.)
      const isContext = /(^|[^a-z])context([^a-z]|$)/i.test(sec.id)
        || /^\s*context\s*$/i.test(titleText);
      const openAttr = isContext ? ' open' : '';
      parts.push(
        `<details${openAttr} class="section" id="section-${sec.id}">`
        + `<summary><span class="sec-title" id="${sec.id}">${sec.inner}</span></summary>`
        + `<div class="section-body">${sectionBody}</div>`
        + `</details>`
      );
    });
    assembled = parts.join('');
  }
  bodyHtml = assembled;

  const navHtml = toc.length
    ? `<nav class="toc" aria-label="Sections"><div class="toc-head">On this page</div><ul>`
      + toc.map((t) => `<li><a href="#section-${t.id}" data-target="section-${t.id}">${escapeHtml(t.title)}</a></li>`).join('')
      + `</ul></nav>`
    : '';

  // Inline JS only: smooth-scroll a nav click to its section (opening a
  // collapsed <details> first), and highlight the active section as you scroll.
  // No network, no external libs.
  const inlineJs = `
  (function(){
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
    function openAndScroll(id){
      var el = document.getElementById(id);
      if(!el) return;
      if(el.tagName === 'DETAILS') el.open = true;
      el.scrollIntoView({behavior:'smooth', block:'start'});
    }
    links.forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        var id = a.getAttribute('data-target');
        openAndScroll(id);
        if(history && history.replaceState) history.replaceState(null, '', '#'+id);
      });
    });
    var sections = Array.prototype.slice.call(document.querySelectorAll('details.section'));
    function setActive(){
      var best=null, bestTop=-Infinity;
      sections.forEach(function(s){
        var top = s.getBoundingClientRect().top;
        if(top <= 120 && top > bestTop){ bestTop = top; best = s; }
      });
      links.forEach(function(a){
        a.classList.toggle('active', best && a.getAttribute('data-target') === best.id);
      });
    }
    window.addEventListener('scroll', setActive, {passive:true});
    setActive();
    // Honor a deep link on load: open the targeted section.
    if(location.hash){ openAndScroll(location.hash.slice(1)); }
  })();`;

  const title = options.title || options.taskId || 'plan';
  const safeTitle = escapeHtml(title);
  const formatNav = renderVisualFormatNav(options.taskId || title, 'plan');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — plan document</title>
<style>
  body{margin:0;background:#f4f6f9;color:#1a1f24;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;line-height:1.55}
  .bar{background:#0b1f3a;color:#fff;padding:12px 22px;font-size:13px;position:sticky;top:0;z-index:5;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  .bar b{font-weight:700}
  .format-nav{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .format-nav a{color:#dbeafe;text-decoration:none;border:1px solid rgba(255,255,255,.24);border-radius:999px;padding:3px 9px;font-size:12px}
  .format-nav a[aria-current="page"]{background:#fff;color:#0b1f3a;font-weight:700}
  .layout{max-width:1180px;margin:0 auto;display:flex;gap:24px;align-items:flex-start;padding:18px}
  .toc{position:sticky;top:62px;flex:0 0 220px;background:#fff;border:1px solid #e2e7ee;border-radius:8px;padding:12px 10px;font-size:13px;max-height:calc(100vh - 90px);overflow:auto}
  .toc-head{font-weight:700;color:#0b1f3a;margin:2px 6px 8px;font-size:12px;letter-spacing:.03em;text-transform:uppercase}
  .toc ul{list-style:none;margin:0;padding:0}
  .toc li{margin:0}
  .toc a{display:block;padding:5px 8px;border-radius:6px;color:#3a4651;text-decoration:none}
  .toc a:hover{background:#eef1f5}
  .toc a.active{background:#0b1f3a;color:#fff;font-weight:600}
  .wrap{flex:1 1 auto;min-width:0;padding:24px;background:#fff;border:1px solid #e2e7ee;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  h1{font-size:24px;margin:.2em 0 .4em}
  details.section{border-bottom:1px solid #eef1f5;margin:0}
  details.section>summary{cursor:pointer;list-style:none;font-size:19px;font-weight:700;color:#0b1f3a;padding:14px 0 8px;border-bottom:1px solid #e2e7ee;margin-top:.4em}
  details.section>summary::-webkit-details-marker{display:none}
  details.section>summary::before{content:'▸';display:inline-block;width:1em;color:#8893a0;transition:transform .15s}
  details.section[open]>summary::before{transform:rotate(90deg)}
  .section-body{padding:6px 0 14px}
  h3{font-size:16px;margin-top:1.3em} h4{font-size:14px}
  code{background:#eef1f5;padding:1px 5px;border-radius:4px;font-size:.92em}
  table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13.5px} th,td{border:1px solid #dde3ea;padding:6px 9px;text-align:left;vertical-align:top} th{background:#f0f3f7}
  blockquote{border-left:3px solid #b6c2d1;margin:10px 0;padding:4px 14px;color:#52606d;background:#f7f9fb}
  .diagram{overflow:auto;margin:14px 0} .diagram svg{background:#fff;border:1px solid #e2e7ee;border-radius:8px}
  @media(max-width:780px){.layout{flex-direction:column}.toc{position:static;flex:1 1 auto;max-height:none;width:auto}}
</style></head>
<body><div class="bar"><span><b>${safeTitle}</b> — readable plan document (operator · stakeholder · agent)</span>${formatNav}</div>
<div class="layout">${navHtml}<div class="wrap">${bodyHtml}</div></div>
<script>${inlineJs}</script></body></html>`;
}

function renderVisualPlanLibraryMarkdown(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const clusterLimit = Number.isFinite(options.clusterLimit) ? options.clusterLimit : 8;
  const model = buildPlanVisibilityModel(projectRoot, { includeClient, generatedAt });
  const clusters = model.relationship_clusters.slice(0, clusterLimit);

  const lines = [
    '# Mythos Focused Visual Brief Library',
    '',
    `generated_at: ${generatedAt}`,
    `scope: ${model.scope}`,
    '',
    '> Derived visual context only. Task-plan JSON/MD, amendments, reviews, signals, and canonical command specs remain authority.',
    '',
    '## Included Briefs',
    '',
    '| Focus | Workstream | Type | Plans | Relationships | Link |',
    '|---|---|---|---:|---:|---|',
    '| plan-visibility-surface | Plan visibility surface | task plan | 4 | 10 | [open](plan-visibility-surface.md) |'
  ];

  for (const cluster of clusters) {
    lines.push(`| ${escapeCell(cluster.id)} | ${escapeCell(cluster.label)} | relationship cluster | ${cluster.size} | ${cluster.relationships} | [open](${cluster.id}.md) |`);
  }

  lines.push(
    '',
    '## Top Relationship Clusters',
    '',
    '| Cluster | Workstream | Why named this way | Plans | Relationships | Top framework | Suggested next plan | Status mix | Sample plans |',
    '|---|---|---|---:|---:|---|---|---|---|'
  );

  for (const cluster of clusters) {
    const statuses = Object.entries(cluster.statuses || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
    const nextPlan = `${cluster.next_plan.task_id} (${cluster.next_plan.status}): ${cluster.next_plan.reason}`;
    lines.push(`| ${escapeCell(cluster.id)} | ${escapeCell(cluster.label)} | ${escapeCell(cluster.label_reason)} | ${cluster.size} | ${cluster.relationships} | ${escapeCell(`${cluster.top_framework.label} (${cluster.top_framework.count})`)} | ${escapeCell(nextPlan)} | ${escapeCell(statuses)} | ${escapeCell(cluster.sample_plans.join(', '))} |`);
  }

  lines.push(
    '',
    '## Generate Another Brief',
    '',
    '- Plan: `npm run plans:visual -- --plan <task-id> --write`',
    '- Cluster: `npm run plans:visual -- --cluster <cluster-id> --write`',
    '- Editable draw.io plan: `npm run plans:visual:drawio -- --plan <task-id>`',
    '- Editable draw.io cluster: `npm run plans:visual:drawio -- --cluster <cluster-id>`',
    '- Import visual corrections: `npm run plans:visual:corrections -- --diagram _dev/reports/analysis/visual-plans/<id>.drawio`',
    '- Client-inclusive scope: add `--include-client` only when client-plan visibility is explicitly intended.',
    '',
    '## Dashboard',
    '',
    '- [Current system plan map](../plan-visibility__current.html)',
    '- [All plans map](../plan-visibility__all.html)'
  );

  return `${lines.join('\n')}\n`;
}

// Additive (claude): shared filename part + readable-doc generator used by the
// dashboard so VIEW links resolve to a real <id>.plan.html (never a dangling
// reference). Matches the filename the auto-publish hook + export-plan-document
// CLI write (`<task-id>.plan.html`). Fail-open: a render error returns null so
// the caller simply omits the VIEW link rather than producing a 404.
const VISUAL_PLAN_ROOT = path.join('_dev', 'reports', 'analysis', 'visual-plans');

function safeFilePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function visualFormatHref(taskId, suffix) {
  if (!taskId) return '';
  return `${encodeURIComponent(taskId)}.${suffix}.html`;
}

function renderVisualFormatNav(taskId, active) {
  if (!taskId) return '';
  const formats = [
    { id: 'plan', label: 'Readable', href: visualFormatHref(taskId, 'plan') },
    { id: 'steps', label: 'Steps', href: visualFormatHref(taskId, 'steps') },
    { id: 'plandoc', label: 'Layman', href: visualFormatHref(taskId, 'plandoc') }
  ];
  return '<nav class="format-nav" aria-label="Plan visual formats">'
    + formats.map((format) => (
      `<a href="${escapeHtml(format.href)}"${format.id === active ? ' aria-current="page"' : ''}>${escapeHtml(format.label)}</a>`
    )).join('')
    + '</nav>';
}

function existingVisualHref(projectRoot, taskId, suffix) {
  if (!taskId) return null;
  const absPath = path.join(projectRoot, VISUAL_PLAN_ROOT, `${taskId}.${suffix}.html`);
  return fs.existsSync(absPath) ? visualFormatHref(taskId, suffix) : null;
}

function ensureReadablePlanDoc(projectRoot, taskId) {
  if (!taskId) return null;
  const relHref = visualFormatHref(taskId, 'plan');
  const absPath = path.join(projectRoot, VISUAL_PLAN_ROOT, `${taskId}.plan.html`);
  if (fs.existsSync(absPath)) return relHref;
  try {
    const html = renderPlanDocumentHtml(projectRoot, { taskId });
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, html);
    return relHref;
  } catch {
    // No plan JSON, or render failed -> omit the VIEW link (no dangling 404).
    return null;
  }
}

function renderVisualPlanLibraryHtml(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const clusterLimit = Number.isFinite(options.clusterLimit) ? options.clusterLimit : DEFAULT_VISUAL_CLUSTER_LIMIT;
  const model = options.model || buildPlanVisibilityModel(projectRoot, { includeClient, generatedAt, visualClusterLimit: clusterLimit });
  const clusters = model.relationship_clusters.slice(0, clusterLimit);
  const rows = clusters.map((cluster) => {
    const statuses = Object.entries(cluster.statuses || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([status, count]) => ({ status, count }));
    const primaryStatus = statuses[0]?.status || 'none';
    const topFramework = cluster.top_framework?.label || 'not-recorded';
    const nextPlan = cluster.next_plan || {};

    // Additive (claude): point the VIEW link at the browser-viewable readable
    // plan document for a representative plan, and keep .drawio strictly as the
    // EDIT surface. This also removes the dangling cluster-N.drawio link (the
    // build never produces cluster-scoped .drawio files -> ERR_FILE_NOT_FOUND).
    // We only emit links to artifacts that exist or that we generate here, so
    // there are no dangling references.
    const sampleList = cluster.sample_plans || [];
    const representativePlan = (nextPlan.task_id && nextPlan.task_id !== 'none')
      ? nextPlan.task_id
      : (sampleList[0] || null);
    const viewHref = representativePlan
      ? ensureReadablePlanDoc(projectRoot, representativePlan)
      : null;
    const stepsHref = representativePlan
      ? existingVisualHref(projectRoot, representativePlan, 'steps')
      : null;
    const plandocHref = representativePlan
      ? existingVisualHref(projectRoot, representativePlan, 'plandoc')
      : null;
    const drawioHref = representativePlan
      && fs.existsSync(path.join(projectRoot, VISUAL_PLAN_ROOT, `${safeFilePart(representativePlan)}.drawio`))
      ? `${encodeURIComponent(representativePlan)}.drawio`
      : null;

    return {
      cluster_id: cluster.id,
      label: cluster.label || cluster.id,
      label_reason: cluster.label_reason || '',
      plans: cluster.size,
      relationships: cluster.relationships,
      top_framework: topFramework,
      primary_status: primaryStatus,
      status_mix: statuses,
      suggested_next: {
        task_id: nextPlan.task_id || 'none',
        status: nextPlan.status || 'not-recorded',
        reason: nextPlan.reason || '',
        next_command: nextPlan.next_command || ''
      },
      sample_plans: sampleList,
      representative_plan: representativePlan,
      brief_href: `${encodeURIComponent(cluster.id)}.md`,
      view_href: viewHref,
      steps_href: stepsHref,
      plandoc_href: plandocHref,
      drawio_href: drawioHref,
      baseline_href: `${encodeURIComponent(cluster.id)}.baseline.json`,
      corrections_href: `${encodeURIComponent(cluster.id)}.corrections.json`,
      map_href: `../plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}${nextPlan.task_id && nextPlan.task_id !== 'none' ? `&plan=${encodeURIComponent(nextPlan.task_id)}` : ''}`
    };
  });
  const dataJson = JSON.stringify({ generated_at: generatedAt, scope: model.scope, rows }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mythos Visual Brief Library</title>
  <style>
    :root { color-scheme: light; --bg: #f7f8fa; --panel: #fff; --ink: #1f2937; --muted: #667085; --line: #d8dee8; --accent: #2563eb; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--line); background: var(--panel); }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    main { max-width: 1180px; padding: 20px 24px 32px; }
    .subtle { color: var(--muted); }
    .toolbar { display: grid; grid-template-columns: minmax(240px, 1fr) 190px 210px; gap: 10px; margin: 0 0 14px; }
    input, select { width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink); font: inherit; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 14px 0; }
    .metric { padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .metric strong { display: block; font-size: 20px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    table { width: 100%; min-width: 980px; border-collapse: collapse; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #eef2f7; font-size: 12px; text-transform: uppercase; color: var(--muted); }
    a { color: var(--accent); }
    code { padding: 1px 4px; border-radius: 4px; background: #eef2f7; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .empty { padding: 16px; color: var(--muted); }
    .authority { margin-top: 18px; padding: 12px; border: 1px solid #f2c94c; border-radius: 8px; color: #713f12; background: #fffbeb; }
    @media (max-width: 820px) { .toolbar { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Mythos Visual Brief Library</h1>
    <div class="subtle">Generated ${escapeHtml(generatedAt)} · ${escapeHtml(model.scope)} · Derived context only</div>
  </header>
  <main>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search workstreams, plans, frameworks, next commands">
      <select id="status"><option value="">All primary statuses</option></select>
      <select id="framework"><option value="">All top frameworks</option></select>
    </div>
    <div class="summary" id="summary"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Workstream</th><th>Plans</th><th>Links</th><th>Status Mix</th><th>Framework</th><th>Suggested Next</th><th>Sample Plans</th><th>Open</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <div class="authority">Authority remains in task-plan JSON/MD, amendments, reviews, signals, and canonical command specs. These visual briefs and draw.io diagrams are generated views. Visual imports produce correction packets only.</div>
  </main>
  <script id="visual-library-data" type="application/json">${dataJson}</script>
  <script>
    const data = JSON.parse(document.getElementById('visual-library-data').textContent);
    const {CLIENT_CODE} = {
      search: document.getElementById('search'),
      status: document.getElementById('status'),
      framework: document.getElementById('framework'),
      summary: document.getElementById('summary'),
      rows: document.getElementById('rows')
    };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const uniq = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    function optionize(select, values) {
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
    }
    function searchable(row) {
      return [
        row.cluster_id,
        row.label,
        row.label_reason,
        row.top_framework,
        row.primary_status,
        row.suggested_next.task_id,
        row.suggested_next.status,
        row.suggested_next.reason,
        row.suggested_next.next_command,
        (row.sample_plans || []).join(' ')
      ].join(' ').toLowerCase();
    }
    function filteredRows() {
      const query = {CLIENT_CODE}.search.value.trim().toLowerCase();
      const status = {CLIENT_CODE}.status.value;
      const framework = {CLIENT_CODE}.framework.value;
      return data.rows.filter(row => (
        (!query || searchable(row).includes(query))
        && (!status || row.primary_status === status)
        && (!framework || row.top_framework === framework)
      ));
    }
    function statusMix(row) {
      return (row.status_mix || []).map(item => item.status + ': ' + item.count).join(', ') || 'none';
    }
    function render() {
      const rows = filteredRows();
      const plans = rows.reduce((sum, row) => sum + row.plans, 0);
      const relationships = rows.reduce((sum, row) => sum + row.relationships, 0);
      {CLIENT_CODE}.summary.innerHTML = [
        ['Visible briefs', rows.length + ' / ' + data.rows.length],
        ['Plans in view', plans],
        ['Links in view', relationships]
      ].map(([label, value]) => '<div class="metric"><span class="subtle">' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>').join('');
      if (!rows.length) {
        {CLIENT_CODE}.rows.innerHTML = '<tr><td class="empty" colspan="8">No visual briefs match the current filters.</td></tr>';
        return;
      }
      {CLIENT_CODE}.rows.innerHTML = rows.map(row => '<tr>'
        + '<td><strong>' + esc(row.label) + '</strong><div class="subtle">' + esc(row.cluster_id) + '</div><div class="subtle">' + esc(row.label_reason) + '</div></td>'
        + '<td>' + row.plans + '</td>'
        + '<td>' + row.relationships + '</td>'
        + '<td>' + esc(statusMix(row)) + '</td>'
        + '<td>' + esc(row.top_framework) + '</td>'
        + '<td>' + esc(row.suggested_next.task_id) + '<div class="subtle">' + esc(row.suggested_next.status) + '</div><code>' + esc(row.suggested_next.next_command || '') + '</code></td>'
        + '<td>' + esc((row.sample_plans || []).join(', ') || 'none') + '</td>'
        + '<td><div class="actions">'
          + (row.view_href ? '<a href="' + esc(row.view_href) + '">View</a>' : '')
          + (row.steps_href ? '<a href="' + esc(row.steps_href) + '">Steps</a>' : '')
          + (row.plandoc_href ? '<a href="' + esc(row.plandoc_href) + '">Layman</a>' : '')
          + '<a href="' + esc(row.brief_href) + '">Brief</a>'
          + '<a href="' + esc(row.map_href) + '">Map</a>'
          + (row.drawio_href ? '<a href="' + esc(row.drawio_href) + '">Edit (draw.io)</a>' : '')
          + '<a href="' + esc(row.corrections_href) + '">Corrections</a>'
        + '</div></td>'
        + '</tr>').join('');
    }
    optionize({CLIENT_CODE}.status, uniq(data.rows.map(row => row.primary_status)));
    optionize({CLIENT_CODE}.framework, uniq(data.rows.map(row => row.top_framework)));
    {CLIENT_CODE}.search.addEventListener('input', render);
    {CLIENT_CODE}.status.addEventListener('input', render);
    {CLIENT_CODE}.framework.addEventListener('input', render);
    render();
  </script>
</body>
</html>
`;
}

function buildVisualPlanAdapterManifest(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const clusterLimit = Number.isFinite(options.clusterLimit) ? options.clusterLimit : 8;
  const model = options.model || buildPlanVisibilityModel(projectRoot, { includeClient, generatedAt });
  const clusters = model.relationship_clusters.slice(0, clusterLimit);
  const planVisibility = model.plans.find((plan) => plan.task_id === 'plan-visibility-surface');
  const briefs = [];

  if (planVisibility) {
    briefs.push(buildAdapterPlanBrief(model, planVisibility));
  }

  for (const cluster of clusters) {
    briefs.push(buildAdapterClusterBrief(cluster));
  }

  return {
    schema_version: 'mythos.plan-visibility.visual-adapter.v1',
    generated_at: generatedAt,
    scope: model.scope,
    intended_adapter: {
      reference: 'BuilderIO/skills /visual-plan',
      mode: 'local-handoff',
      note: 'Use this manifest as structured input for a visual-plan surface; do not treat it as task-plan authority.'
    },
    authority: {
      status: 'derived_context_only',
      authoritative_sources: [
        'task-plan JSON/MD',
        'plan amendments',
        'reviews',
        'HandoffSignals',
        'canonical command specs'
      ],
      client_visibility: includeClient ? 'included_by_explicit_request' : 'excluded_by_default'
    },
    dashboard: {
      index: 'plan-visibility__index.html',
      current_system_map: 'plan-visibility__current.html',
      all_plans_map: 'plan-visibility__all.html',
      operator_brief: 'plan-visibility__operator-brief.md',
      system_model: 'plan-visibility__current.json',
      all_model: 'plan-visibility__all.json',
      visual_brief_library: 'visual-plans/index.md',
      smoke_screenshot: 'plan-visibility__current-smoke.png'
    },
    commands: {
      rebuild_dashboard: 'npm run plans:dashboard',
      locate_dashboard: 'npm run plans:where',
      locate_plan: 'npm run plans:where -- --plan <task-id>',
      generate_plan_brief: 'npm run plans:visual -- --plan <task-id> --write',
      generate_cluster_brief: 'npm run plans:visual -- --cluster <cluster-id> --write',
      generate_plan_drawio: 'npm run plans:visual:drawio -- --plan <task-id>',
      generate_cluster_drawio: 'npm run plans:visual:drawio -- --cluster <cluster-id>',
      import_drawio_corrections: 'npm run plans:visual:corrections -- --diagram _dev/reports/analysis/visual-plans/<id>.drawio',
      visual_smoke: 'npm run plans:dashboard:smoke'
    },
    counts: {
      plans: model.plans.length,
      relationships: model.relationships.length,
      workstreams: model.relationship_clusters.length,
      remediation_rows: Array.isArray(model.remediation_queue) ? model.remediation_queue.length : 0,
      visual_flowchart_artifacts: Array.isArray(model.visual_flowcharts?.items)
        ? model.visual_flowcharts.items.filter((item) => (item.mermaid_blocks || []).length > 0).length
        : 0,
      included_briefs: briefs.length
    },
    graph_health: model.graph_health,
    remediation_queue: (model.remediation_queue || []).slice(0, 24),
    visual_flowcharts: model.visual_flowcharts,
    briefs
  };
}

function buildAdapterPlanBrief(model, plan) {
  const incoming = model.relationships.filter((relationship) => relationship.target === plan.task_id);
  const outgoing = model.relationships.filter((relationship) => relationship.source === plan.task_id);
  const cluster = model.relationship_clusters.find((item) => (item.plan_ids || []).includes(plan.task_id));

  return {
    id: plan.task_id,
    kind: 'plan',
    label: plan.title || plan.task_id,
    markdown_path: `visual-plans/${plan.task_id}.md`,
    dashboard_href: cluster
      ? `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(plan.task_id)}`
      : `plan-visibility__current.html#plan=${encodeURIComponent(plan.task_id)}`,
    source_plan_path: plan.path,
    source_command: `npm run plans:visual -- --plan ${plan.task_id} --write`,
    status: plan.status,
    review_lane: plan.review_lane,
    risk_tier: plan.risk_tier,
    relationships: {
      incoming: incoming.length,
      outgoing: outgoing.length
    }
  };
}

function buildAdapterClusterBrief(cluster) {
  const next = cluster.next_plan || {};
  return {
    id: cluster.id,
    kind: 'relationship_cluster',
    label: cluster.label,
    markdown_path: `visual-plans/${cluster.id}.md`,
    dashboard_href: `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}${next.task_id && next.task_id !== 'none' ? `&plan=${encodeURIComponent(next.task_id)}` : ''}`,
    source_command: `npm run plans:visual -- --cluster ${cluster.id} --write`,
    plans: cluster.size,
    relationships: cluster.relationships,
    suggested_next_plan: next.task_id || 'none',
    label_reason: cluster.label_reason,
    sample_plans: cluster.sample_plans || []
  };
}

function renderPlanVisibilityOperatorBrief(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const model = buildPlanVisibilityModel(projectRoot, { includeClient, generatedAt });
  const quickViews = buildPlanVisibilityIndexQuickViews(model);
  const readyPlans = model.plans.filter((plan) => plan.status === 'ready').slice(0, 10);
  const dependencyTargets = new Set(
    model.relationships
      .filter((relationship) => relationship.intent === 'dependency')
      .map((relationship) => relationship.target)
  );
  const dependencyWatch = model.plans
    .filter((plan) => ['ready', 'in_progress'].includes(plan.status) && dependencyTargets.has(plan.task_id))
    .slice(0, 10);
  const topClusters = model.relationship_clusters.slice(0, 8);
  const topHubs = model.relationship_hubs.slice(0, 8);
  const topPaths = model.action_paths.slice(0, 8);

  const lines = [
    '# Mythos Plan Operator Brief',
    '',
    `generated_at: ${generatedAt}`,
    `scope: ${model.scope}`,
    '',
    '> Derived context only. Task-plan JSON/MD, amendments, reviews, signals, and canonical command specs remain authority.',
    '',
    '## Start Here',
    '',
    ...model.briefing.map((line) => `- ${line}`),
    '',
    '## Graph Health',
    '',
    model.graph_health.summary,
    '',
    '| Signal | Reading |',
    '|---|---|',
    ...renderGraphHealthRows(model.graph_health),
    '',
    '### Map Confidence Actions',
    '',
    '| Signal | Count | Action | Filter | Sample plans |',
    '|---|---:|---|---|---|',
    ...renderMapConfidenceActionRows(model.graph_health.recommendations),
    '',
    '### Remediation Queue',
    '',
    '| Signal | Plan | Status | Recommended fix | Filter | Next command |',
    '|---|---|---|---|---|---|',
    ...renderRemediationQueueRows(model.remediation_queue),
    '',
    '### Unlinked Plan Triage',
    '',
    model.unlinked_plan_triage.summary,
    '',
    '| Plan | Status | Review | Risk | Next step | Next command | Source |',
    '|---|---|---|---|---|---|---|',
    ...renderUnlinkedPlanTriageRows(model.unlinked_plan_triage),
    '',
    '### Visual Flowcharts',
    '',
    model.visual_flowcharts.summary,
    '',
    '| Artifact | Type | Mermaid blocks | Dashboard | Command |',
    '|---|---|---|---|---|',
    ...renderVisualFlowchartRows(model.visual_flowcharts),
    '',
    '### Visual Coverage Queue',
    '',
    model.visual_coverage.summary,
    '',
    '| Cluster | Workstream | Plans | Links | Reason | Generate command |',
    '|---|---|---:|---:|---|---|',
    ...renderVisualCoverageRows(model.visual_coverage),
    '',
    '### Recent Source Activity',
    '',
    model.recent_activity.summary,
    '',
    '| Modified | Plan | Status | Workstream | Next command | Source |',
    '|---|---|---|---|---|---|',
    ...renderRecentActivityRows(model.recent_activity),
    '',
    '### Plan Progress Timeline',
    '',
    model.plan_progress_timeline.summary,
    '',
    '| Modified | Plan | Status | Workstream | Next step | Next command | Quality signals |',
    '|---|---|---|---|---|---|---|',
    ...renderPlanProgressTimelineRows(model.plan_progress_timeline),
    '',
    '## Plan Action Board',
    '',
    model.plan_action_board.summary,
    '',
    '| Lane | Plan | Status | Workstream | Reason | Next command |',
    '|---|---|---|---|---|---|',
    ...renderPlanActionBoardRows(model.plan_action_board),
    '',
    '## Decision Guide',
    '',
    '1. Choose a slice: open Ready Plans for execution candidates, Dependency Links for blocked sequencing, or Largest Cluster for connected system work.',
    '2. Open the map: select a plan to inspect source, next step, incoming/outgoing links, workstream, hub role, and action paths.',
    '3. Open the brief: use a cluster card Open brief link when you need a portable flowchart or handoff artifact.',
    '4. Act from authority: run review or execution commands from the source task plan, not from the generated dashboard alone.',
    '',
    '## Quick Links',
    '',
    '| View | Link | Why |',
    '|---|---|---|',
    ...quickViews.map((view) => `| ${escapeCell(view.label)} | [open](${escapeCell(view.href)}) | ${escapeCell(view.description)} |`),
    '',
    '## Data Quality',
    '',
    '| Signal | Count | Sample plans |',
    '|---|---:|---|',
    ...Object.entries(model.data_quality).map(([key, value]) => `| ${escapeCell(key)} | ${value.count} | ${escapeCell(value.sample.join(', ') || 'none')} |`),
    '',
    '## Suggested Workstreams',
    '',
    '| Cluster | Workstream | Why named this way | Plans | Relationships | Suggested next | Reason | Map | Brief |',
    '|---|---|---|---:|---:|---|---|---|---|'
  ];

  if (topClusters.length === 0) {
    lines.push('| none | 0 | 0 | none | No relationship clusters detected. | none |');
  } else {
    for (const cluster of topClusters) {
      const next = cluster.next_plan;
      lines.push(`| ${escapeCell(cluster.id)} | ${escapeCell(cluster.label)} | ${escapeCell(cluster.label_reason)} | ${cluster.size} | ${cluster.relationships} | ${escapeCell(`${next.task_id} (${next.status})`)} | ${escapeCell(next.reason)} | [focus](plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}&plan=${encodeURIComponent(next.task_id)}) | [brief](visual-plans/${encodeURIComponent(cluster.id)}.md) |`);
    }
  }

  lines.push(
    '',
    '## Workstream Matrix',
    '',
    '| Cluster | Workstream | Plans | Links | Ready/In progress | Attention | Top intents | Status mix | Suggested next | Brief |',
    '|---|---|---:|---:|---:|---:|---|---|---|---|',
    ...renderWorkstreamMatrixRows(model.workstream_matrix, { links: true }),
    '',
    '## Workstream Connection Stories',
    '',
    '| Cluster | Workstream | Explanation | Example links | Bridge plans | Brief |',
    '|---|---|---|---|---|---|',
    ...renderWorkstreamStoryRows(model.workstream_stories),
    '',
    '## Impact Hubs',
    '',
    model.impact_hubs.summary,
    '',
    '| Plan | Role | Links | Incoming | Outgoing | Top intent | Workstream | Why it matters | Next command |',
    '|---|---|---:|---:|---:|---|---|---|---|',
    ...renderImpactHubRows(model.impact_hubs),
    '',
    '## Connection Hubs',
    '',
    '| Plan | Role | Links | Incoming | Outgoing | Top intent | Workstream | Next step |',
    '|---|---|---:|---:|---:|---|---|',
    ...renderRelationshipHubRows(topHubs),
    '',
    '## Action Paths',
    '',
    '| Plan | Status | Upstream | Downstream | Feeds from | Feeds into | Workstream | Next step |',
    '|---|---|---:|---:|---|---|---|---|',
    ...renderActionPathRows(topPaths),
    '',
    '## Ready Plans',
    '',
    '| Plan | Next step | Review | Risk | Source |',
    '|---|---|---|---|---|'
  );

  if (readyPlans.length === 0) {
    lines.push('| none | No ready plans in this scope. | none | none | none |');
  } else {
    for (const plan of readyPlans) {
      lines.push(`| ${escapeCell(plan.task_id)} | ${escapeCell(`${plan.next_step.step_id}: ${plan.next_step.description}`)} | ${escapeCell(plan.review_lane)} | ${escapeCell(plan.risk_tier)} | [source](${escapeCell(plan.path)}) |`);
    }
  }

  lines.push(
    '',
    '## Dependency Watch',
    '',
    '| Plan | Next step | Reason | Source |',
    '|---|---|---|---|'
  );

  if (dependencyWatch.length === 0) {
    lines.push('| none | No ready or in-progress plans have incoming dependency links. | none | none |');
  } else {
    for (const plan of dependencyWatch) {
      lines.push(`| ${escapeCell(plan.task_id)} | ${escapeCell(`${plan.next_step.step_id}: ${plan.next_step.description}`)} | incoming dependency relationship | [source](${escapeCell(plan.path)}) |`);
    }
  }

  lines.push(
    '',
    '## Artifacts',
    '',
    '- [Dashboard index](plan-visibility__index.html)',
    '- [Current system plan map](plan-visibility__current.html)',
    '- [Visual brief library](visual-plans/index.md)',
    '- [System JSON model](plan-visibility__current.json)'
  );

  return `${lines.join('\n')}\n`;
}

function buildPlanVisibilityModel(projectRoot, options = {}) {
  const includeClient = Boolean(options.includeClient);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const visualClusterLimit = Number.isFinite(options.visualClusterLimit)
    ? options.visualClusterLimit
    : DEFAULT_VISUAL_CLUSTER_LIMIT;
  const planSummaries = collectPlanSummaries(projectRoot, { includeClient });
  const relationships = collectPlanRelationships(planSummaries);
  const plans = annotatePlanQuality(stripRawPlan(planSummaries), relationships);
  const buckets = plans.reduce((acc, plan) => {
    acc[plan.status] = (acc[plan.status] || 0) + 1;
    return acc;
  }, {});
  const groupings = buildGroupings(plans);
  const relationshipGroupings = {
    type: countRelationshipsBy(relationships, 'type'),
    intent: countRelationshipsBy(relationships, 'intent'),
    confidence: countRelationshipsBy(relationships, 'confidence')
  };
  const relationshipClusters = buildRelationshipClusters(plans, relationships);
  const relationshipHubs = buildRelationshipHubs(plans, relationships, relationshipClusters);
  const impactHubs = buildImpactHubs(relationshipHubs);
  const workstreamStories = buildWorkstreamStories(plans, relationships, relationshipClusters, relationshipHubs);
  const actionPaths = buildActionPaths(plans, relationships, relationshipClusters);
  const dependencySequenceChains = buildDependencySequenceChains(plans, relationships, relationshipClusters);
  const workstreamMatrix = buildWorkstreamMatrix(plans, relationships, relationshipClusters, {
    projectRoot,
    generatedClusterLimit: visualClusterLimit
  });
  const workstreamDrilldowns = buildWorkstreamDrilldowns(plans, relationships, relationshipClusters);
  const dataQuality = buildDataQuality(plans, relationships);
  const graphHealth = buildGraphHealth(plans, relationships, relationshipGroupings, relationshipClusters, dataQuality);
  const remediationQueue = buildMapConfidenceRemediationQueue(plans, graphHealth.recommendations);
  const unlinkedPlanTriage = buildUnlinkedPlanTriage(plans);
  const priorityScan = buildPriorityScan(plans, relationships, relationshipClusters, relationshipHubs, remediationQueue);
  const briefing = buildBriefing(plans, relationships, buckets, groupings, relationshipGroupings, relationshipClusters);
  const visualFlowcharts = buildVisualFlowchartInventory({
    plans,
    relationships,
    relationship_clusters: relationshipClusters
  }, visualClusterLimit);
  const visualCoverage = buildVisualCoverage(workstreamMatrix);
  const recentActivity = buildRecentActivity(plans, relationshipClusters);
  const planProgressTimeline = buildPlanProgressTimeline(plans, relationshipClusters);
  const planActionBoard = buildPlanActionBoard(plans, relationships, relationshipClusters, remediationQueue, impactHubs);
  const protocolReadiness = buildProtocolReadiness(planSummaries, plans, relationshipClusters);
  const executionReadiness = buildExecutionReadiness(planActionBoard, protocolReadiness);
  const routingBlockers = buildRoutingBlockers(executionReadiness, protocolReadiness);
  const firstRepairPath = buildFirstRepairPath(executionReadiness, routingBlockers);
  const riskGateQueue = buildRiskGateQueue(plans, protocolReadiness, relationshipClusters);
  const orchestrationRoutingBoard = buildOrchestrationRoutingBoard(plans, protocolReadiness, riskGateQueue, relationshipClusters);
  const commandRunbook = buildCommandRunbook({
    firstRepairPath,
    riskGateQueue,
    executionReadiness,
    planActionBoard,
    protocolReadiness,
    workstreamDrilldowns
  });
  const mapReadingGuide = buildMapReadingGuide({
    plans,
    relationships,
    relationshipClusters,
    graphHealth,
    planActionBoard
  });
  const operatorQuestionRoutes = buildOperatorQuestionRoutes({
    buckets,
    dataQuality,
    graphHealth,
    priorityScan,
    planActionBoard,
    relationshipClusters,
    dependencySequenceChains,
    recentActivity
  });

  return {
    generated_at: generatedAt,
    scope: includeClient ? 'system+client' : 'system-only',
    plans,
    relationships,
    buckets,
    groupings,
    relationship_groupings: relationshipGroupings,
    relationship_clusters: relationshipClusters,
    relationship_hubs: relationshipHubs,
    impact_hubs: impactHubs,
    workstream_stories: workstreamStories,
    action_paths: actionPaths,
    dependency_sequence_chains: dependencySequenceChains,
    workstream_matrix: workstreamMatrix,
    workstream_drilldowns: workstreamDrilldowns,
    data_quality: dataQuality,
    graph_health: graphHealth,
    map_reading_guide: mapReadingGuide,
    protocol_readiness: protocolReadiness,
    remediation_queue: remediationQueue,
    unlinked_plan_triage: unlinkedPlanTriage,
    priority_scan: priorityScan,
    operator_question_routes: operatorQuestionRoutes,
    plan_action_board: planActionBoard,
    execution_readiness: executionReadiness,
    routing_blockers: routingBlockers,
    first_repair_path: firstRepairPath,
    risk_gate_queue: riskGateQueue,
    orchestration_routing_board: orchestrationRoutingBoard,
    command_runbook: commandRunbook,
    visual_flowcharts: visualFlowcharts,
    visual_coverage: visualCoverage,
    recent_activity: recentActivity,
    plan_progress_timeline: planProgressTimeline,
    briefing
  };
}

function renderPlanVisibilityHtml(projectRoot, options = {}) {
  const model = buildPlanVisibilityModel(projectRoot, options);
  const modelJson = JSON.stringify(model).replace(/</g, '\\u003c');
  const title = `Mythos Plan Map (${model.scope})`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #1d2430;
      --muted: #667085;
      --line: #d7dce3;
      --accent: #2563eb;
      --ready: #0f766e;
      --planned: #6b7280;
      --complete: #166534;
      --blocked: #b91c1c;
      --review: #7c3aed;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      padding: 20px 24px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 3;
    }
    h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 0; }
    .subtle { color: var(--muted); }
    main { padding: 18px 24px 28px; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
    }
    .card strong { display: block; font-size: 22px; line-height: 1.1; }
    .briefing {
      padding: 12px 14px;
    }
    .briefing ul {
      margin: 0;
      padding-left: 20px;
    }
    .briefing li {
      margin: 6px 0;
    }
    .overview {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 12px;
    }
    .overview-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcfe;
      min-width: 0;
    }
    .quality {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
      padding: 12px;
    }
    .clusters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
      padding: 12px;
    }
    .hubs {
      padding: 12px;
    }
    .paths {
      padding: 12px;
    }
    .cluster {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcfe;
      min-width: 0;
    }
    .cluster h3 {
      margin: 0 0 6px;
      font-size: 13px;
    }
    .cluster button {
      margin: 2px 4px 2px 0;
    }
    .cluster-focus {
      margin: 0 0 16px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #eef6ff;
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .overview-panel h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    .overview-panel ol {
      margin: 0;
      padding-left: 20px;
    }
    .overview-panel li {
      margin: 6px 0;
      overflow-wrap: anywhere;
    }
    .queue-reason {
      display: inline-block;
      margin-bottom: 2px;
      color: var(--ink);
      font-size: 12px;
      font-weight: 600;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) repeat(6, minmax(132px, 180px));
      gap: 10px;
      margin-bottom: 16px;
    }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 9px 10px;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(420px, 1.35fr) minmax(320px, 0.9fr);
      gap: 16px;
      align-items: start;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    section h2 {
      margin: 0;
      padding: 12px 14px;
      font-size: 15px;
      border-bottom: 1px solid var(--line);
      background: #fafbfc;
    }
    .graph-wrap { padding: 12px; }
    .graph-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .graph-controls label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--ink);
      white-space: nowrap;
    }
    .graph-controls input {
      width: auto;
      margin: 0;
    }
    .path-finder {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) auto auto;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
    }
    .path-finder button {
      white-space: nowrap;
    }
    .path-result {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcfe;
      color: var(--muted);
      font-size: 13px;
    }
    .path-result strong {
      color: var(--ink);
    }
    .path-result ol {
      margin: 8px 0 0;
      padding-left: 20px;
    }
    .path-result li {
      margin: 6px 0;
      overflow-wrap: anywhere;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      background: #ffffff;
    }
    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      display: inline-block;
    }
    svg { width: 100%; height: 520px; display: block; border: 1px solid var(--line); border-radius: 8px; background: #fbfcfe; }
    .table-wrap { max-height: 680px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: #fafbfc; z-index: 1; font-size: 12px; color: var(--muted); }
    tr[data-selected="true"] { background: #eff6ff; }
    button.linklike {
      border: 0;
      background: transparent;
      color: var(--accent);
      padding: 0;
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .source-link {
      color: var(--accent);
      text-decoration: none;
      font-size: 12px;
    }
    .source-link:hover { text-decoration: underline; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 7px; font-size: 12px; background: #eef2f7; }
    .pill.ready { color: var(--ready); background: #ccfbf1; }
    .pill.planned { color: var(--planned); background: #f3f4f6; }
    .pill.complete { color: var(--complete); background: #dcfce7; }
    .pill.blocked { color: var(--blocked); background: #fee2e2; }
    .pill.needs_review { color: var(--review); background: #ede9fe; }
    .detail { padding: 14px; }
    .detail dl { display: grid; grid-template-columns: 110px 1fr; gap: 8px 10px; margin: 0; }
    .detail dt { color: var(--muted); }
    .detail dd { margin: 0; overflow-wrap: anywhere; }
    .next-step {
      max-width: 280px;
      overflow-wrap: anywhere;
    }
    .relationships { margin-top: 14px; }
    .relationships li { margin: 6px 0; }
    .relationship-columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 10px;
    }
    .relationship-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcfe;
    }
    .relationship-panel h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    .selected-flow {
      margin-top: 12px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfe;
      overflow-x: auto;
    }
    .selected-flow svg {
      height: auto;
      min-width: 620px;
      border: 0;
      background: transparent;
    }
    .intent-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0;
    }
    .authority {
      margin-top: 16px;
      padding: 10px 12px;
      border: 1px solid #f2c94c;
      background: #fffbeb;
      border-radius: 8px;
      color: #713f12;
    }
    @media (max-width: 920px) {
      .toolbar, .layout, .overview { grid-template-columns: 1fr; }
      .relationship-columns { grid-template-columns: 1fr; }
      svg { height: 420px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Mythos Plan Map</h1>
    <div class="subtle">Generated ${escapeHtml(model.generated_at)} · ${escapeHtml(model.scope)} · Derived context only</div>
  </header>
  <main>
    <div class="cards" id="cards"></div>
    <section style="margin-bottom:16px">
      <h2>Briefing</h2>
      <div class="briefing" id="briefing"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Graph Health</h2>
      <div class="quality" id="graphHealth"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Map Confidence Actions</h2>
      <div class="quality" id="confidenceActions"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Remediation Queue</h2>
      <div class="hubs" id="remediationQueue"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Unlinked Plan Triage</h2>
      <div class="hubs" id="unlinkedPlanTriage"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Visual Coverage Queue</h2>
      <div class="hubs" id="visualCoverage"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Recent Source Activity</h2>
      <div class="hubs" id="recentActivity"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Plan Progress Timeline</h2>
      <div class="hubs" id="planProgressTimeline"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Plan Action Board</h2>
      <div class="hubs" id="planActionBoard"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Operator Overview</h2>
      <div class="overview" id="overview"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Data Quality</h2>
      <div class="quality" id="quality"></div>
    </section>
    <section style="margin-bottom:16px">
      <h2>Relationship Clusters</h2>
      <div class="clusters" id="clusters"></div>
    </section>
    <section>
      <h2>Workstream Matrix</h2>
      <div class="workstream-matrix" id="workstreamMatrix"></div>
    </section>
    <section>
      <h2>Workstream Connection Stories</h2>
      <div class="toolbar" style="margin-bottom:10px">
        <input id="storySearch" type="search" placeholder="Search workstream stories, evidence, bridge plans">
        <select id="storyIntent"><option value="">All story intents</option></select>
        <select id="storyRelationshipMode"><option value="">All story types</option><option value="linked">With relationship examples</option><option value="isolated">Isolated workstreams</option></select>
      </div>
      <div class="subtle" id="storySummary"></div>
      <div class="hubs" id="workstreamStories"></div>
    </section>
    <section>
      <h2>Impact Hubs</h2>
      <div class="hubs" id="impactHubs"></div>
    </section>
    <section>
      <h2>Connection Hubs</h2>
      <div class="hubs" id="hubs"></div>
    </section>
    <section>
      <h2>Action Paths</h2>
      <div class="paths" id="paths"></div>
    </section>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search plans, commands, paths">
      <select id="client"><option value="">All clients</option></select>
      <select id="framework"><option value="">All frameworks</option></select>
      <select id="status"><option value="">All statuses</option></select>
      <select id="review"><option value="">All review lanes</option></select>
      <select id="risk"><option value="">All risks</option></select>
      <select id="qualityFlag"><option value="">All quality signals</option></select>
      <select id="relationshipIntent"><option value="">All relationship intents</option></select>
      <select id="relationshipConfidence"><option value="">All relationship confidence</option></select>
    </div>
    <div class="cluster-focus" id="clusterFocus"><span id="clusterFocusText"></span><button class="linklike" type="button" id="clearCluster">Clear cluster focus</button></div>
    <div class="layout">
      <section>
        <h2>Relationship Graph</h2>
        <div class="graph-wrap">
          <div class="path-finder" aria-label="Connection path finder">
            <select id="pathFrom"><option value="">From plan</option></select>
            <select id="pathTo"><option value="">To plan</option></select>
            <button type="button" id="findPath">Find path</button>
            <button class="linklike" type="button" id="clearPath">Clear path</button>
          </div>
          <div class="path-result" id="pathResult">Choose two plans to trace their shortest visible connection path.</div>
          <div class="graph-controls">
            <span id="graphSummary">Showing filtered relationships</span>
            <label><input id="graphAll" type="checkbox"> All filtered plans</label>
            <label><input id="neighborhood" type="checkbox" checked> Selected neighborhood</label>
          </div>
          <div class="legend" id="legend"></div>
          <svg id="graph" role="img" aria-label="Plan relationship graph"></svg>
        </div>
      </section>
      <section>
        <h2>Selected Plan</h2>
        <div class="detail" id="detail">Select a plan to inspect its command, path, and relationships.</div>
      </section>
    </div>
    <section style="margin-top:16px">
      <h2>Visible Relationships</h2>
      <div class="hubs" id="visibleRelationships"></div>
    </section>
    <section style="margin-top:16px">
      <h2>Plans</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Status</th><th>Task</th><th>Client</th><th>Framework</th><th>Steps</th><th>Next Step</th><th>Quality</th><th>Risk</th><th>Review</th><th>Approval</th><th>Next</th></tr></thead>
          <tbody id="plans"></tbody>
        </table>
      </div>
    </section>
    <div class="authority">Authority remains in task-plan JSON/MD, amendments, reviews, signals, and canonical command specs. This page is a generated view.</div>
  </main>
  <script id="plan-data" type="application/json">${modelJson}</script>
  <script>
    const data = JSON.parse(document.getElementById('plan-data').textContent);
    const byId = new Map(data.plans.map(plan => [plan.task_id, plan]));
    const clustersById = new Map(data.relationship_clusters.map(cluster => [cluster.id, cluster]));
    const hashFilters = [
      ['q', 'search'],
      ['client', 'client'],
      ['framework', 'framework'],
      ['status', 'status'],
      ['review', 'review'],
      ['risk', 'risk'],
      ['quality', 'qualityFlag'],
      ['intent', 'relationshipIntent'],
      ['confidence', 'relationshipConfidence']
    ];
    const storyHashFilters = [
      ['storyQ', 'storySearch'],
      ['storyIntent', 'storyIntent'],
      ['storyMode', 'storyRelationshipMode']
    ];
    const state = { selected: null, filtered: data.plans.slice(), clusterId: null, path: null };
    const {CLIENT_CODE} = {
      cards: document.getElementById('cards'),
      briefing: document.getElementById('briefing'),
      graphHealth: document.getElementById('graphHealth'),
      confidenceActions: document.getElementById('confidenceActions'),
      remediationQueue: document.getElementById('remediationQueue'),
      unlinkedPlanTriage: document.getElementById('unlinkedPlanTriage'),
      visualCoverage: document.getElementById('visualCoverage'),
      recentActivity: document.getElementById('recentActivity'),
      planProgressTimeline: document.getElementById('planProgressTimeline'),
      planActionBoard: document.getElementById('planActionBoard'),
      overview: document.getElementById('overview'),
      quality: document.getElementById('quality'),
      clusters: document.getElementById('clusters'),
      workstreamMatrix: document.getElementById('workstreamMatrix'),
      storySearch: document.getElementById('storySearch'),
      storyIntent: document.getElementById('storyIntent'),
      storyRelationshipMode: document.getElementById('storyRelationshipMode'),
      storySummary: document.getElementById('storySummary'),
      workstreamStories: document.getElementById('workstreamStories'),
      impactHubs: document.getElementById('impactHubs'),
      hubs: document.getElementById('hubs'),
      paths: document.getElementById('paths'),
      visibleRelationships: document.getElementById('visibleRelationships'),
      search: document.getElementById('search'),
      status: document.getElementById('status'),
      client: document.getElementById('client'),
      framework: document.getElementById('framework'),
      review: document.getElementById('review'),
      risk: document.getElementById('risk'),
      qualityFlag: document.getElementById('qualityFlag'),
      relationshipIntent: document.getElementById('relationshipIntent'),
      relationshipConfidence: document.getElementById('relationshipConfidence'),
      clusterFocus: document.getElementById('clusterFocus'),
      clusterFocusText: document.getElementById('clusterFocusText'),
      clearCluster: document.getElementById('clearCluster'),
      pathFrom: document.getElementById('pathFrom'),
      pathTo: document.getElementById('pathTo'),
      findPath: document.getElementById('findPath'),
      clearPath: document.getElementById('clearPath'),
      pathResult: document.getElementById('pathResult'),
      neighborhood: document.getElementById('neighborhood'),
      graphSummary: document.getElementById('graphSummary'),
      graphAll: document.getElementById('graphAll'),
      legend: document.getElementById('legend'),
      plans: document.getElementById('plans'),
      detail: document.getElementById('detail'),
      graph: document.getElementById('graph')
    };

    function unique(field) {
      return [...new Set(data.plans.map(plan => plan[field] || 'not-recorded'))].sort();
    }

    function uniqueRelationships(field) {
      return [...new Set(data.relationships.map(relationship => relationship[field] || 'not-recorded'))].sort();
    }

    function uniquePlanArray(field) {
      return [...new Set(data.plans.flatMap(plan => Array.isArray(plan[field]) ? plan[field] : []))].sort();
    }

    function optionize(select, values) {
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
    }

    function optionizePlans(select) {
      const plans = data.plans
        .slice()
        .sort((a, b) => String(a.task_id).localeCompare(String(b.task_id)));
      for (const plan of plans) {
        const option = document.createElement('option');
        option.value = plan.task_id;
        option.textContent = plan.task_id + (plan.title ? ' · ' + plan.title : '');
        select.appendChild(option);
      }
    }

    function renderCards() {
      const items = [
        ['Plans', data.plans.length],
        ['Ready', data.buckets.ready || 0],
        ['Planned', data.buckets.planned || 0],
        ['Complete', data.buckets.complete || 0],
        ['Links', data.relationships.length]
      ];
      {CLIENT_CODE}.cards.innerHTML = items.map(([label, value]) => '<div class="card"><span class="subtle">' + label + '</span><strong>' + value + '</strong></div>').join('');
    }

    function renderBriefing() {
      {CLIENT_CODE}.briefing.innerHTML = '<ul>' + data.briefing.map(line => '<li>' + esc(line) + '</li>').join('') + '</ul>';
    }

    function renderGraphHealth() {
      const health = data.graph_health || {};
      const items = [
        ['Coverage', (health.coverage_percent ?? 0) + '%', (health.linked_plans || 0) + ' linked · ' + (health.unlinked_plans || 0) + ' unlinked'],
        ['Link density', health.links_per_plan ?? 0, 'links per visible plan'],
        ['Cluster coverage', (health.cluster_coverage_percent ?? 0) + '%', 'plans inside detected relationship clusters'],
        ['Top intents', formatEntries(health.top_intents), 'most common relationship purposes'],
        ['Top sources', formatEntries(health.top_sources), 'where detected links came from'],
        ['Weakest areas', formatWeakestAreas(health.weakest_areas), 'highest-count map confidence gaps']
      ];
      {CLIENT_CODE}.graphHealth.innerHTML = items.map(([label, value, detail]) => '<div class="overview-panel">'
        + '<h3>' + esc(label) + '</h3>'
        + '<strong>' + esc(value) + '</strong>'
        + '<div class="subtle">' + esc(detail) + '</div>'
        + '</div>').join('');
    }

    function renderConfidenceActions() {
      const actions = (data.graph_health && data.graph_health.recommendations) || [];
      if (!actions.length) {
        {CLIENT_CODE}.confidenceActions.innerHTML = '<div class="overview-panel"><h3>No action needed</h3><strong>0</strong><div class="subtle">No map-confidence recommendations detected.</div></div>';
        return;
      }
      {CLIENT_CODE}.confidenceActions.innerHTML = actions.map(item => '<div class="overview-panel">'
        + '<h3>' + esc(formatLabel(item.signal)) + '</h3>'
        + '<strong>' + esc(item.count) + ' · ' + esc(item.percent) + '%</strong>'
        + '<div class="subtle">' + esc(item.action) + '</div>'
        + '<div><a class="source-link" href="' + esc(item.dashboard_href) + '">Open filtered view</a></div>'
        + '<div class="subtle">' + esc((item.sample || []).join(', ') || 'No sample plans') + '</div>'
        + '</div>').join('');
    }

    function renderRemediationQueue() {
      const rows = (data.remediation_queue || []).slice(0, 24);
      if (!rows.length) {
        {CLIENT_CODE}.remediationQueue.innerHTML = '<p class="subtle">No map-confidence remediation rows detected.</p>';
        return;
      }
      {CLIENT_CODE}.remediationQueue.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Signal</th><th>Plan</th><th>Status</th><th>Recommended fix</th><th>Filter</th><th>Next</th></tr></thead><tbody>'
        + rows.map(row => '<tr>'
          + '<td>' + esc(formatLabel(row.signal)) + '</td>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(row.task_id) + '">' + esc(row.task_id) + '</button><div class="subtle">' + esc(row.title) + '</div><a class="source-link" data-source-link href="' + sourcePathHref(row.source) + '">Open source</a></td>'
          + '<td>' + esc(row.status) + '<div class="subtle">' + esc(row.review_lane) + ' · ' + esc(row.risk_tier) + '</div></td>'
          + '<td>' + esc(row.recommended_fix) + '</td>'
          + '<td><a class="source-link" href="' + esc(row.dashboard_href) + '">Open filtered view</a></td>'
          + '<td><code>' + esc(row.next_command) + '</code></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderUnlinkedPlanTriage() {
      const triage = data.unlinked_plan_triage || {};
      const rows = triage.rows || [];
      if (!rows.length) {
        {CLIENT_CODE}.unlinkedPlanTriage.innerHTML = '<p class="subtle">' + esc(triage.summary || 'Every visible plan has at least one detected relationship.') + '</p>';
        return;
      }
      {CLIENT_CODE}.unlinkedPlanTriage.innerHTML = '<p class="subtle">' + esc(triage.summary || '') + '</p>'
        + '<div class="table-wrap"><table><thead><tr><th>Plan</th><th>Status</th><th>Next step</th><th>Suggested repair</th><th>Next</th></tr></thead><tbody>'
        + rows.map(row => '<tr>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(row.task_id) + '">' + esc(row.task_id) + '</button><div class="subtle">' + esc(row.title) + '</div><a class="source-link" data-source-link href="' + sourcePathHref(row.source) + '">Open source</a> · <a class="source-link" href="' + esc(row.dashboard_href) + '">Open map</a></td>'
          + '<td>' + esc(row.status) + '<div class="subtle">' + esc(row.review_lane) + ' · ' + esc(row.risk_tier) + '</div></td>'
          + '<td><span class="next-step">' + esc(row.next_step.step_id + ': ' + row.next_step.description) + '</span></td>'
          + '<td>' + esc(row.suggested_fix) + '</td>'
          + '<td><code>' + esc(row.next_command) + '</code></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderVisualCoverage() {
      const coverage = data.visual_coverage || {};
      const rows = coverage.queue || [];
      if (!rows.length) {
        {CLIENT_CODE}.visualCoverage.innerHTML = '<p class="subtle">' + esc(coverage.summary || 'All detected workstreams have generated visual briefs.') + '</p>';
        return;
      }
      {CLIENT_CODE}.visualCoverage.innerHTML = '<p class="subtle">' + esc(coverage.summary || '') + '</p>'
        + '<div class="table-wrap"><table><thead><tr><th>Workstream</th><th>Plans</th><th>Links</th><th>Suggested next</th><th>Reason</th><th>Generate</th></tr></thead><tbody>'
        + rows.map(row => '<tr>'
          + '<td><button class="linklike" type="button" data-cluster-id="' + esc(row.cluster_id) + '">' + esc(row.label) + '</button><div class="subtle">' + esc(row.cluster_id) + '</div></td>'
          + '<td>' + row.plans + '</td>'
          + '<td>' + row.relationships + '</td>'
          + '<td>' + esc(row.suggested_next.task_id) + '<div class="subtle">' + esc(row.suggested_next.status) + '</div></td>'
          + '<td>' + esc(row.reason) + '</td>'
          + '<td><code>' + esc(row.command) + '</code></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderRecentActivity() {
      const activity = data.recent_activity || {};
      const rows = activity.items || [];
      if (!rows.length) {
        {CLIENT_CODE}.recentActivity.innerHTML = '<p class="subtle">' + esc(activity.summary || 'No recent source activity found.') + '</p>';
        return;
      }
      {CLIENT_CODE}.recentActivity.innerHTML = '<p class="subtle">' + esc(activity.summary || '') + '</p>'
        + '<div class="table-wrap"><table><thead><tr><th>Modified</th><th>Plan</th><th>Status</th><th>Workstream</th><th>Next</th><th>Source</th></tr></thead><tbody>'
        + rows.map(row => '<tr>'
          + '<td>' + esc(row.source_mtime) + '</td>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(row.task_id) + '">' + esc(row.task_id) + '</button><div class="subtle">' + esc(row.title) + '</div></td>'
          + '<td>' + esc(row.status) + '<div class="subtle">' + esc(row.review_lane) + ' · ' + esc(row.risk_tier) + '</div></td>'
          + '<td>' + (row.workstream_id ? '<button class="linklike" type="button" data-cluster-id="' + esc(row.workstream_id) + '">' + esc(row.workstream_label || row.workstream_id) + '</button>' : '<span class="subtle">not linked</span>') + '</td>'
          + '<td><code>' + esc(row.next_command) + '</code></td>'
          + '<td><a class="source-link" data-source-link href="' + sourcePathHref(row.source) + '">Open source</a></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderPlanProgressTimeline() {
      const timeline = data.plan_progress_timeline || {};
      const rows = timeline.items || [];
      if (!rows.length) {
        {CLIENT_CODE}.planProgressTimeline.innerHTML = '<p class="subtle">' + esc(timeline.summary || 'No plan progress timeline items found.') + '</p>';
        return;
      }
      {CLIENT_CODE}.planProgressTimeline.innerHTML = '<p class="subtle">' + esc(timeline.summary || '') + '</p>'
        + '<div class="table-wrap"><table><thead><tr><th>Modified</th><th>Plan</th><th>Status</th><th>Workstream</th><th>Next step</th><th>Next command</th><th>Signals</th></tr></thead><tbody>'
        + rows.map(row => '<tr>'
          + '<td>' + esc(row.modified_at) + '</td>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(row.task_id) + '">' + esc(row.task_id) + '</button><div class="subtle">' + esc(row.title) + '</div></td>'
          + '<td>' + esc(row.status) + '<div class="subtle">' + esc(row.review_lane) + ' · ' + esc(row.risk_tier) + '</div></td>'
          + '<td>' + (row.workstream_id ? '<button class="linklike" type="button" data-cluster-id="' + esc(row.workstream_id) + '">' + esc(row.workstream_label || row.workstream_id) + '</button>' : '<span class="subtle">not linked</span>') + '</td>'
          + '<td><span class="next-step">' + esc(row.next_step.step_id + ': ' + row.next_step.description) + '</span></td>'
          + '<td><code>' + esc(row.next_command) + '</code></td>'
          + '<td>' + ((row.quality_flags || []).length ? row.quality_flags.map(flag => '<span class="pill">' + esc(flag) + '</span>').join(' ') : '<span class="subtle">none</span>') + '</td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderPlanActionBoard() {
      const board = data.plan_action_board || {};
      const lanes = board.lanes || [];
      if (!lanes.length) {
        {CLIENT_CODE}.planActionBoard.innerHTML = '<p class="subtle">' + esc(board.summary || 'No action lanes are available.') + '</p>';
        return;
      }
      {CLIENT_CODE}.planActionBoard.innerHTML = '<p class="subtle">' + esc(board.summary || '') + '</p>'
        + '<div class="table-wrap"><table><thead><tr><th>Lane</th><th>Plan</th><th>Status</th><th>Workstream</th><th>Reason</th><th>Next</th></tr></thead><tbody>'
        + lanes.flatMap(lane => (lane.rows || []).map(row => '<tr>'
          + '<td>' + esc(lane.label) + '<div class="subtle">' + esc(lane.summary || '') + '</div></td>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(row.task_id) + '">' + esc(row.task_id) + '</button><div class="subtle">' + esc(row.title || '') + '</div><a class="source-link" data-source-link href="' + sourcePathHref(row.source) + '">Open source</a> · <a class="source-link" href="' + esc(row.dashboard_href) + '">Open map</a></td>'
          + '<td>' + esc(row.status) + '<div class="subtle">' + esc(row.review_lane) + ' · ' + esc(row.risk_tier) + '</div></td>'
          + '<td>' + esc(row.workstream_label || 'not linked') + '</td>'
          + '<td>' + esc(row.reason) + '</td>'
          + '<td><code>' + esc(row.next_command || 'not-recorded') + '</code></td>'
          + '</tr>')).join('')
        + '</tbody></table></div>';
    }

    function renderOverview() {
      const needsAttention = data.plans.filter(plan => ['blocked', 'needs_review', 'unreadable'].includes(plan.status)).slice(0, 8);
      const runnable = data.plans.filter(plan => ['ready', 'in_progress'].includes(plan.status)).slice(0, 8);
      const dependencyCounts = incomingIntentCounts('dependency');
      const dependencyWatch = data.plans
        .filter(plan => ['ready', 'in_progress'].includes(plan.status) && dependencyCounts.has(plan.task_id))
        .sort((a, b) => dependencyCounts.get(b.task_id) - dependencyCounts.get(a.task_id) || a.task_id.localeCompare(b.task_id))
        .slice(0, 8);
      const highRisk = data.plans.filter(plan => !['low', 'not-recorded', 'unknown', ''].includes(String(plan.risk_tier || '').toLowerCase())).slice(0, 8);
      {CLIENT_CODE}.overview.innerHTML = [
        renderOverviewPanel('Needs Attention', needsAttention, 'No blocked, unreadable, or review-waiting plans in this scope.', null, attentionReason),
        renderOverviewPanel('Runnable Now', runnable, 'No ready or in-progress plans in this scope.', null, runnableReason),
        renderOverviewPanel('Dependency Watch', dependencyWatch, 'No ready or in-progress plans have incoming dependency links in this scope.', dependencyCounts, dependencyReason),
        renderOverviewPanel('Risk Watch', highRisk, 'No elevated-risk plans recorded in this scope.', null, riskReason)
      ].join('');
    }

    function renderDataQuality() {
      {CLIENT_CODE}.quality.innerHTML = Object.entries(data.data_quality || {}).map(([key, value]) => '<div class="overview-panel">'
        + '<h3>' + esc(formatLabel(key)) + '</h3>'
        + '<strong>' + esc(value.count) + '</strong>'
        + '<div class="subtle">' + esc((value.sample || []).join(', ') || 'No sample plans') + '</div>'
        + '</div>').join('');
    }

    function formatEntries(entries) {
      if (!entries || !entries.length) return 'none';
      return entries.map(entry => entry.label + ': ' + entry.count).join(', ');
    }

    function formatWeakestAreas(areas) {
      if (!areas || !areas.length) return 'none';
      return areas.map(area => area.signal + ': ' + area.count).join(', ');
    }

    function renderClusters() {
      const clusters = data.relationship_clusters.slice(0, 8);
      {CLIENT_CODE}.clusters.innerHTML = clusters.map(cluster => '<div class="cluster">'
        + '<h3>' + esc(cluster.label || cluster.id) + '</h3>'
        + '<div class="subtle">' + esc(cluster.id) + ' · ' + esc(cluster.label_reason || 'Derived relationship cluster') + '</div>'
        + '<div class="subtle">' + cluster.size + ' plans · ' + cluster.relationships + ' links · ' + esc(cluster.top_framework.label) + ' (' + cluster.top_framework.count + ')</div>'
        + '<div><span class="queue-reason">Suggested next: ' + esc(cluster.next_plan.task_id) + ' · ' + esc(cluster.next_plan.reason) + '</span></div>'
        + '<div class="subtle">' + esc(cluster.next_plan.next_step) + '</div>'
        + '<button class="linklike" type="button" data-cluster-id="' + esc(cluster.id) + '">Focus cluster</button>'
        + '<a class="source-link" href="visual-plans/' + esc(cluster.id) + '.md">Open brief</a>'
        + '<div>' + cluster.sample_plans.map(id => '<button class="linklike" type="button" data-plan-id="' + esc(id) + '">' + esc(id) + '</button>').join('') + '</div>'
	        + '</div>').join('');
    }

    function renderWorkstreamMatrix() {
      const rows = data.workstream_matrix || [];
      if (!rows.length) {
        {CLIENT_CODE}.workstreamMatrix.innerHTML = '<p class="subtle">No relationship workstreams detected.</p>';
        return;
      }
      {CLIENT_CODE}.workstreamMatrix.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Workstream</th><th>Plans</th><th>Links</th><th>Ready</th><th>Attention</th><th>Top intents</th><th>Status mix</th><th>Suggested next</th><th>Brief</th></tr></thead><tbody>'
        + rows.map(row => '<tr>'
          + '<td><button class="linklike" type="button" data-cluster-id="' + esc(row.cluster_id) + '">' + esc(row.label) + '</button><div class="subtle">' + esc(row.cluster_id) + '</div></td>'
          + '<td>' + row.plans + '</td>'
          + '<td>' + row.relationships + '</td>'
          + '<td>' + row.ready_like + '</td>'
          + '<td>' + row.attention + '</td>'
          + '<td>' + esc(formatEntryList(row.top_intents)) + '</td>'
          + '<td>' + esc(formatEntryList(row.status_mix)) + '</td>'
          + '<td>' + esc(row.suggested_next.task_id) + '<div class="subtle">' + esc(row.suggested_next.status) + '</div></td>'
          + '<td>' + (row.brief_exists === false ? '<span class="subtle">not generated</span>' : '<a class="source-link" href="' + esc(row.brief_href) + '">Open brief</a>') + '</td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderWorkstreamStories() {
      const query = ({CLIENT_CODE}.storySearch.value || '').trim().toLowerCase();
      const intent = {CLIENT_CODE}.storyIntent.value;
      const mode = {CLIENT_CODE}.storyRelationshipMode.value;
      const allRows = data.workstream_stories || [];
      const rows = allRows.filter(row => {
        const hasExamples = (row.relationship_examples || []).length > 0;
        const text = [
          row.cluster_id,
          row.label,
          row.explanation,
          row.label_reason,
          formatEntryList(row.top_intents),
          formatEntryList(row.top_sources),
          row.suggested_next && row.suggested_next.task_id,
          ...(row.relationship_examples || []).flatMap(example => [example.source, example.target, example.intent, example.type, example.evidence]),
          ...(row.bridge_plans || []).flatMap(hub => [hub.task_id, hub.role, hub.top_intent])
        ].join(' ').toLowerCase();
        return (!query || text.includes(query))
          && (!intent || (row.top_intents || []).some(item => item.label === intent) || (row.relationship_examples || []).some(example => example.intent === intent))
          && (!mode || (mode === 'linked' ? hasExamples : !hasExamples));
      });
      if (!rows.length) {
        {CLIENT_CODE}.storySummary.textContent = 'Showing 0 of ' + allRows.length + ' workstream stories.';
        {CLIENT_CODE}.workstreamStories.innerHTML = '<p class="subtle">No workstream connection stories match the current filters.</p>';
        return;
      }
      {CLIENT_CODE}.storySummary.textContent = 'Showing ' + rows.length + ' of ' + allRows.length + ' workstream stories.';
      {CLIENT_CODE}.workstreamStories.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Workstream</th><th>Explanation</th><th>Example links</th><th>Bridge plans</th><th>Brief</th></tr></thead><tbody>'
        + rows.map(row => '<tr>'
          + '<td><button class="linklike" type="button" data-cluster-id="' + esc(row.cluster_id) + '">' + esc(row.label) + '</button><div class="subtle">' + esc(row.cluster_id) + ' · ' + row.plans + ' plans · ' + row.relationships + ' links</div></td>'
          + '<td>' + esc(row.explanation) + '</td>'
          + '<td>' + ((row.relationship_examples || []).length ? '<ol>' + (row.relationship_examples || []).slice(0, 3).map(example => '<li><button class="linklike" type="button" data-plan-id="' + esc(example.source) + '">' + esc(example.source) + '</button> -> <button class="linklike" type="button" data-plan-id="' + esc(example.target) + '">' + esc(example.target) + '</button><div class="subtle">' + esc(example.intent) + ' · ' + esc(example.evidence) + '</div></li>').join('') + '</ol>' : '<span class="subtle">none</span>') + '</td>'
          + '<td>' + ((row.bridge_plans || []).length ? (row.bridge_plans || []).map(hub => '<button class="linklike" type="button" data-plan-id="' + esc(hub.task_id) + '">' + esc(hub.task_id) + '</button><div class="subtle">' + esc(hub.role) + ' · ' + hub.total + ' links</div>').join('') : '<span class="subtle">none</span>') + '</td>'
          + '<td><a class="source-link" href="' + esc(row.brief_href) + '">Open brief</a></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderImpactHubs() {
      const impact = data.impact_hubs || {};
      const rows = impact.rows || [];
      if (!rows.length) {
        {CLIENT_CODE}.impactHubs.innerHTML = '<p class="subtle">' + esc(impact.summary || 'No connected impact hubs detected.') + '</p>';
        return;
      }
      {CLIENT_CODE}.impactHubs.innerHTML = '<p class="subtle">' + esc(impact.summary || '') + '</p>'
        + '<div class="table-wrap"><table><thead><tr><th>Plan</th><th>Role</th><th>Links</th><th>Workstream</th><th>Why it matters</th><th>Next</th></tr></thead><tbody>'
        + rows.map(hub => '<tr>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(hub.task_id) + '">' + esc(hub.task_id) + '</button><div class="subtle">' + esc(hub.status) + ' · ' + esc(hub.review_lane) + ' · ' + esc(hub.risk_tier) + '</div><a class="source-link" data-source-link href="' + sourcePathHref(hub.source) + '">Open source</a> · <a class="source-link" href="' + esc(hub.dashboard_href) + '">Open map</a></td>'
          + '<td>' + esc(hub.role) + '</td>'
          + '<td>' + hub.total + '<div class="subtle">' + hub.incoming + ' in · ' + hub.outgoing + ' out</div><div class="subtle">' + esc(hub.top_intent) + ' (' + hub.top_intent_count + ')</div></td>'
          + '<td>' + esc(hub.workstream_label || 'not linked') + '<div class="subtle">' + esc(hub.workstream_id || 'none') + '</div></td>'
          + '<td>' + esc(hub.why_it_matters) + '</td>'
          + '<td><code>' + esc(hub.next_command) + '</code></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderHubs() {
      const hubs = (data.relationship_hubs || []).slice(0, 10);
      if (!hubs.length) {
        {CLIENT_CODE}.hubs.innerHTML = '<p class="subtle">No connected plans detected.</p>';
        return;
      }
      {CLIENT_CODE}.hubs.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Plan</th><th>Role</th><th>Links</th><th>In</th><th>Out</th><th>Intent</th><th>Workstream</th></tr></thead><tbody>'
        + hubs.map(hub => '<tr>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(hub.task_id) + '">' + esc(hub.task_id) + '</button><div class="subtle">' + esc(hub.status) + ' · ' + esc(hub.review_lane) + ' · ' + esc(hub.risk_tier) + '</div></td>'
          + '<td>' + esc(hub.role) + '</td>'
          + '<td>' + hub.total + '</td>'
          + '<td>' + hub.incoming + '</td>'
          + '<td>' + hub.outgoing + '</td>'
          + '<td>' + esc(hub.top_intent) + ' (' + hub.top_intent_count + ')</td>'
          + '<td>' + esc(hub.cluster_label) + '<div class="subtle">' + esc(hub.cluster_id) + '</div></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderActionPaths() {
      const paths = (data.action_paths || []).slice(0, 10);
      if (!paths.length) {
        {CLIENT_CODE}.paths.innerHTML = '<p class="subtle">No dependency, sequence, review, or hierarchy paths detected.</p>';
        return;
      }
      {CLIENT_CODE}.paths.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Plan</th><th>Status</th><th>Up</th><th>Down</th><th>Feeds from</th><th>Feeds into</th><th>Workstream</th></tr></thead><tbody>'
        + paths.map(item => '<tr>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(item.task_id) + '">' + esc(item.task_id) + '</button><div class="subtle">' + esc(item.review_lane) + ' · ' + esc(item.risk_tier) + '</div></td>'
          + '<td>' + esc(item.status) + '</td>'
          + '<td>' + item.upstream_count + '</td>'
          + '<td>' + item.downstream_count + '</td>'
          + '<td>' + renderPathEndpointButtons(item.upstream) + '</td>'
          + '<td>' + renderPathEndpointButtons(item.downstream) + '</td>'
          + '<td>' + esc(item.cluster_label) + '<div class="subtle">' + esc(item.cluster_id) + '</div></td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function renderPathEndpointButtons(items) {
      if (!items || !items.length) return '<span class="subtle">none</span>';
      return items.map(item => '<button class="linklike" type="button" data-plan-id="' + esc(item.plan) + '">' + esc(item.plan) + '</button><span class="pill">' + esc(item.intent) + '</span>').join('<br>');
    }

    function incomingIntentCounts(intent) {
      const counts = new Map();
      for (const rel of data.relationships) {
        if (rel.intent === intent) counts.set(rel.target, (counts.get(rel.target) || 0) + 1);
      }
      return counts;
    }

    function renderOverviewPanel(label, plans, emptyText, relationCounts, reasonForPlan) {
      const body = plans.length
        ? '<ol>' + plans.map(plan => '<li><span class="queue-reason">Queue reason: ' + esc(reasonForPlan ? reasonForPlan(plan, relationCounts) : 'matched queue criteria') + '</span><br><button class="linklike" type="button" data-plan-id="' + esc(plan.task_id) + '">' + esc(plan.task_id) + '</button><div class="subtle">' + esc(plan.status) + ' · ' + esc(plan.review_lane) + ' · ' + esc(plan.risk_tier) + relationNote(plan, relationCounts) + '</div></li>').join('') + '</ol>'
        : '<p class="subtle">' + esc(emptyText) + '</p>';
      return '<div class="overview-panel"><h3>' + esc(label) + '</h3>' + body + '</div>';
    }

    function attentionReason(plan) {
      if (plan.status === 'blocked') return 'blocked plan';
      if (plan.status === 'needs_review') return 'waiting for review';
      if (plan.status === 'unreadable') return 'unreadable plan artifact';
      return 'needs operator attention';
    }

    function runnableReason(plan) {
      return plan.status === 'in_progress' ? 'already in progress' : 'approved or step-ready';
    }

    function dependencyReason(plan, relationCounts) {
      const count = relationCounts?.get(plan.task_id) || 0;
      return count + ' incoming dependency link' + (count === 1 ? '' : 's');
    }

    function riskReason(plan) {
      return 'risk tier is ' + plan.risk_tier;
    }

    function relationNote(plan, relationCounts) {
      if (!relationCounts || !relationCounts.has(plan.task_id)) return '';
      const count = relationCounts.get(plan.task_id);
      return ' · ' + count + ' incoming dependency link' + (count === 1 ? '' : 's');
    }

    function formatLabel(value) {
      return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    }

    function formatEntryList(entries) {
      return (entries || []).map(entry => entry.label + ': ' + entry.count).join(', ') || 'none';
    }

    function renderLegend() {
      const intents = uniqueRelationships('intent');
      {CLIENT_CODE}.legend.innerHTML = intents.map(intent => '<span class="legend-item"><span class="swatch" style="background:' + colorForIntent(intent) + '"></span>' + esc(intent) + '</span>').join('');
    }

    function applyFilters() {
      const q = {CLIENT_CODE}.search.value.trim().toLowerCase();
      const cluster = state.clusterId ? clustersById.get(state.clusterId) : null;
      const clusterIds = cluster ? new Set(cluster.plan_ids) : null;
      state.filtered = data.plans.filter(plan => {
        const haystack = [plan.task_id, plan.title, plan.path, plan.next_command, plan.status, plan.client_code, plan.framework, plan.review_lane, plan.risk_tier].join(' ').toLowerCase();
        const relationshipIntentMatch = !{CLIENT_CODE}.relationshipIntent.value || data.relationships.some(rel => (
          (rel.source === plan.task_id || rel.target === plan.task_id)
          && rel.intent === {CLIENT_CODE}.relationshipIntent.value
        ));
        const relationshipConfidenceMatch = !{CLIENT_CODE}.relationshipConfidence.value || data.relationships.some(rel => (
          (rel.source === plan.task_id || rel.target === plan.task_id)
          && rel.confidence === {CLIENT_CODE}.relationshipConfidence.value
        ));
        return (!clusterIds || clusterIds.has(plan.task_id))
          && (!q || haystack.includes(q))
          && (!{CLIENT_CODE}.client.value || plan.client_code === {CLIENT_CODE}.client.value)
          && (!{CLIENT_CODE}.framework.value || plan.framework === {CLIENT_CODE}.framework.value)
          && (!{CLIENT_CODE}.status.value || plan.status === {CLIENT_CODE}.status.value)
          && (!{CLIENT_CODE}.review.value || plan.review_lane === {CLIENT_CODE}.review.value)
          && (!{CLIENT_CODE}.risk.value || plan.risk_tier === {CLIENT_CODE}.risk.value)
          && (!{CLIENT_CODE}.qualityFlag.value || (plan.quality_flags || []).includes({CLIENT_CODE}.qualityFlag.value))
          && relationshipIntentMatch
          && relationshipConfidenceMatch;
      });
      renderClusterFocus();
      renderVisibleRelationships();
      renderTable();
      renderGraph();
    }

    function applyFiltersAndPersist() {
      applyFilters();
      updateHash();
    }

    function applyStoryFiltersAndPersist() {
      renderWorkstreamStories();
      updateHash();
    }

    function focusCluster(clusterId) {
      state.clusterId = clusterId;
      applyFilters();
      updateHash();
    }

    function clearClusterFocus() {
      state.clusterId = null;
      applyFilters();
      updateHash();
    }

    function renderClusterFocus() {
      const cluster = state.clusterId ? clustersById.get(state.clusterId) : null;
      if (!cluster) {
        {CLIENT_CODE}.clusterFocus.style.display = 'none';
        {CLIENT_CODE}.clusterFocusText.textContent = '';
        return;
      }
      {CLIENT_CODE}.clusterFocus.style.display = 'flex';
      {CLIENT_CODE}.clusterFocusText.textContent = 'Focused on ' + (cluster.label || cluster.id) + ' (' + cluster.id + '): ' + cluster.size + ' plans, ' + cluster.relationships + ' links';
    }

    function renderTable() {
      {CLIENT_CODE}.plans.innerHTML = '';
      for (const plan of state.filtered) {
        const tr = document.createElement('tr');
        tr.dataset.selected = state.selected === plan.task_id ? 'true' : 'false';
        tr.innerHTML = '<td><span class="pill ' + cssName(plan.status) + '">' + esc(plan.status) + '</span></td>'
        + '<td><button class="linklike" type="button">' + esc(plan.task_id) + '</button><div class="subtle">' + esc(plan.title) + '</div><a class="source-link" data-source-link href="' + sourceHref(plan) + '">Open source</a></td>'
          + '<td>' + esc(plan.client_code) + '</td>'
          + '<td>' + esc(plan.framework) + '</td>'
          + '<td>' + plan.step_counts.complete + '/' + plan.step_counts.total + '</td>'
          + '<td><div class="next-step"><strong>' + esc(plan.next_step.step_id) + '</strong><div class="subtle">' + esc(plan.next_step.description) + '</div></div></td>'
          + '<td>' + esc((plan.quality_flags || []).join(', ') || 'ok') + '</td>'
          + '<td>' + esc(plan.risk_tier) + '</td>'
          + '<td>' + esc(plan.review_lane) + '</td>'
          + '<td>' + esc(plan.approval) + '</td>'
          + '<td><code>' + esc(plan.next_command) + '</code></td>';
        tr.querySelector('button').addEventListener('click', () => selectPlan(plan.task_id));
        {CLIENT_CODE}.plans.appendChild(tr);
      }
    }

    function renderVisibleRelationships() {
      const links = relationshipsForVisiblePlans();
      if (!links.length) {
        {CLIENT_CODE}.visibleRelationships.innerHTML = '<p class="subtle">No relationships match the current filters.</p>';
        return;
      }
      {CLIENT_CODE}.visibleRelationships.innerHTML = '<div class="subtle">' + links.length + ' relationships match the current filters.</div>'
        + '<div class="table-wrap"><table><thead><tr><th>Source</th><th>Target</th><th>Type</th><th>Intent</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>'
        + links.map(rel => '<tr>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(rel.source) + '">' + esc(rel.source) + '</button></td>'
          + '<td><button class="linklike" type="button" data-plan-id="' + esc(rel.target) + '">' + esc(rel.target) + '</button></td>'
          + '<td><span class="pill">' + esc(rel.type) + '</span></td>'
          + '<td><span class="pill">' + esc(rel.intent) + '</span></td>'
          + '<td><span class="pill">' + esc(rel.confidence || 'unknown') + '</span><div class="subtle">' + esc(rel.confidence_reason || '') + '</div></td>'
          + '<td>' + esc(rel.evidence) + '</td>'
          + '</tr>').join('')
        + '</tbody></table></div>';
    }

    function selectPlan(taskId) {
      state.selected = taskId;
      const plan = byId.get(taskId);
      const links = relationshipsForVisiblePlans().filter(rel => rel.source === taskId || rel.target === taskId);
      const incoming = links.filter(rel => rel.target === taskId);
      const outgoing = links.filter(rel => rel.source === taskId);
      {CLIENT_CODE}.detail.innerHTML = '<dl>'
        + '<dt>Task</dt><dd>' + esc(plan.task_id) + '</dd>'
        + '<dt>Status</dt><dd>' + esc(plan.status) + '</dd>'
        + '<dt>Client</dt><dd>' + esc(plan.client_code) + '</dd>'
        + '<dt>Project</dt><dd>' + esc(plan.project_id) + '</dd>'
        + '<dt>Framework</dt><dd>' + esc(plan.framework) + '</dd>'
        + '<dt>Steps</dt><dd>' + plan.step_counts.complete + '/' + plan.step_counts.total + '</dd>'
        + '<dt>Next step</dt><dd><strong>' + esc(plan.next_step.step_id) + '</strong><div class="subtle">' + esc(plan.next_step.status) + ' · ' + esc(plan.next_step.mode) + '</div><div>' + esc(plan.next_step.description) + '</div></dd>'
        + '<dt>Quality</dt><dd>' + esc((plan.quality_flags || []).join(', ') || 'ok') + '</dd>'
        + '<dt>Risk</dt><dd>' + esc(plan.risk_tier) + '</dd>'
        + '<dt>Review</dt><dd>' + esc(plan.review_lane) + '</dd>'
        + '<dt>Approval</dt><dd>' + esc(plan.approval) + '</dd>'
        + '<dt>Next</dt><dd><code>' + esc(plan.next_command) + '</code></dd>'
        + '<dt>Path</dt><dd><a class="source-link" data-source-link href="' + sourceHref(plan) + '">' + esc(plan.path) + '</a></dd>'
        + '</dl>'
        + renderSelectedPlanContext(taskId)
        + renderSelectedPlanLocalFlow(taskId, incoming, outgoing)
        + '<div class="relationships"><strong>Relationships</strong>'
        + '<div class="intent-summary">' + renderIntentSummary(links) + '</div>'
        + (links.length ? '<div class="relationship-columns">'
          + renderRelationshipPanel('Incoming', incoming, taskId)
          + renderRelationshipPanel('Outgoing', outgoing, taskId)
          + '</div>' : '<p class="subtle">No detected relationships for this plan in the current filter.</p>')
        + '</div>';
      renderTable();
      renderGraph();
      updateHash();
    }

    function renderSelectedPlanLocalFlow(taskId, incoming, outgoing) {
      const left = incoming.slice(0, 3);
      const right = outgoing.slice(0, 3);
      const leftRows = left.map((rel, index) => selectedFlowNode(rel.source, 28, 54 + index * 54, rel, 'incoming')).join('');
      const rightRows = right.map((rel, index) => selectedFlowNode(rel.target, 490, 54 + index * 54, rel, 'outgoing')).join('');
      const leftLines = left.map((rel, index) => selectedFlowLine(176, 70 + index * 54, 292, 112, rel)).join('');
      const rightLines = right.map((rel, index) => selectedFlowLine(368, 112, 490, 70 + index * 54, rel)).join('');
      const emptyLeft = left.length ? '' : '<text x="28" y="82" font-size="12" fill="#667085">No incoming relationships in current filter</text>';
      const emptyRight = right.length ? '' : '<text x="490" y="82" font-size="12" fill="#667085">No outgoing relationships in current filter</text>';
      return '<div class="selected-flow" aria-label="Selected plan local flow">'
        + '<strong>Local flow</strong>'
        + '<svg viewBox="0 0 720 218" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Incoming plans feed the selected plan, which feeds outgoing plans">'
        + '<defs><marker id="flowArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="#667085" /></marker></defs>'
        + '<text x="28" y="26" font-size="12" font-weight="700" fill="#475467">Feeds from</text>'
        + '<text x="310" y="26" font-size="12" font-weight="700" fill="#475467">Selected</text>'
        + '<text x="490" y="26" font-size="12" font-weight="700" fill="#475467">Feeds into</text>'
        + leftLines + rightLines
        + emptyLeft + emptyRight
        + leftRows
        + '<rect x="286" y="82" width="96" height="60" rx="8" fill="#2563eb" />'
        + '<text x="334" y="106" text-anchor="middle" font-size="11" font-weight="800" fill="#ffffff">' + esc(shortFlowLabel(taskId)) + '</text>'
        + '<text x="334" y="126" text-anchor="middle" font-size="10" fill="#dbeafe">selected plan</text>'
        + rightRows
        + '</svg>'
        + (incoming.length > 3 || outgoing.length > 3 ? '<div class="subtle">Showing first three incoming and outgoing relationships. Full relationship lists are below.</div>' : '')
        + '</div>';
    }

    function selectedFlowNode(taskId, x, y, rel, direction) {
      const label = shortFlowLabel(taskId);
      const meta = rel.intent + ' · ' + (rel.confidence || 'unknown');
      const color = direction === 'incoming' ? '#e0f2fe' : '#ecfdf5';
      const stroke = direction === 'incoming' ? '#0369a1' : '#0f766e';
      return '<g>'
        + '<rect x="' + x + '" y="' + y + '" width="148" height="34" rx="7" fill="' + color + '" stroke="' + stroke + '" />'
        + '<text x="' + (x + 8) + '" y="' + (y + 14) + '" font-size="10" font-weight="800" fill="#1f2937">' + esc(label) + '</text>'
        + '<text x="' + (x + 8) + '" y="' + (y + 28) + '" font-size="9" fill="#667085">' + esc(meta) + '</text>'
        + '</g>';
    }

    function selectedFlowLine(x1, y1, x2, y2, rel) {
      return '<g>'
        + '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + colorForIntent(rel.intent) + '" stroke-width="2" opacity="0.75" marker-end="url(#flowArrow)" />'
        + '</g>';
    }

    function shortFlowLabel(value) {
      const text = String(value || '');
      return text.length > 22 ? text.slice(0, 19) + '...' : text;
    }

    function renderSelectedPlanContext(taskId) {
      const cluster = clusterForPlan(taskId);
      const hub = (data.relationship_hubs || []).find(item => item.task_id === taskId);
      const actionPath = (data.action_paths || []).find(item => item.task_id === taskId);
      const actionLanes = actionLanesForPlan(taskId);
      const connectionEvidence = connectionEvidenceForPlan(taskId);
      const upstream = actionPath ? renderPathEndpointButtons(actionPath.upstream) : '<span class="subtle">none</span>';
      const downstream = actionPath ? renderPathEndpointButtons(actionPath.downstream) : '<span class="subtle">none</span>';
      return '<div class="relationships"><strong>Plan Context</strong>'
        + '<dl>'
        + '<dt>Workstream</dt><dd>' + esc(cluster ? (cluster.label || cluster.id) + ' (' + cluster.id + ')' : 'No relationship cluster') + '</dd>'
        + '<dt>Hub role</dt><dd>' + (hub ? esc(hub.role + ' · ' + hub.total + ' links · ' + hub.incoming + ' in / ' + hub.outgoing + ' out · ' + hub.top_intent + ' (' + hub.top_intent_count + ')') : '<span class="subtle">No hub role in top connected plans.</span>') + '</dd>'
        + '<dt>Action lanes</dt><dd>' + renderActionLaneMembership(actionLanes) + '</dd>'
        + '<dt>Action path</dt><dd>' + (actionPath ? esc(actionPath.upstream_count + ' upstream / ' + actionPath.downstream_count + ' downstream') : '<span class="subtle">No dependency, sequence, review, or hierarchy path.</span>') + '</dd>'
        + '<dt>Feeds from</dt><dd>' + upstream + '</dd>'
        + '<dt>Feeds into</dt><dd>' + downstream + '</dd>'
        + '<dt>Connection evidence</dt><dd>' + renderConnectionEvidence(connectionEvidence) + '</dd>'
        + '</dl>'
        + '</div>';
    }

    function actionLanesForPlan(taskId) {
      const lanes = (data.plan_action_board && data.plan_action_board.lanes) || [];
      return lanes.flatMap(lane => (lane.rows || [])
        .filter(row => row.task_id === taskId)
        .map(row => ({ lane, row })));
    }

    function renderActionLaneMembership(matches) {
      if (!matches.length) return '<span class="subtle">Not currently in Plan Action Board lanes.</span>';
      return matches.map(match => '<div><span class="pill">' + esc(match.lane.label) + '</span> '
        + esc(match.row.reason)
        + '<div><code>' + esc(match.row.next_command || 'not-recorded') + '</code> · <a class="source-link" href="' + esc(match.row.dashboard_href) + '">Open lane view</a></div></div>').join('');
    }

    function connectionEvidenceForPlan(taskId) {
      return data.relationships
        .filter(rel => rel.source === taskId || rel.target === taskId)
        .map(rel => ({
          relationship: rel,
          direction: rel.target === taskId ? 'incoming' : 'outgoing',
          other: rel.target === taskId ? rel.source : rel.target
        }))
        .sort((a, b) => intentPriority(a.relationship.intent) - intentPriority(b.relationship.intent) || a.other.localeCompare(b.other))
        .slice(0, 6);
    }

    function renderConnectionEvidence(items) {
      if (!items.length) return '<span class="subtle">No relationship evidence for this plan.</span>';
      return '<ol>' + items.map(item => {
        const rel = item.relationship;
        const meaning = relationshipMeaning(item.direction, rel.intent, item.other);
        return '<li><button class="linklike" type="button" data-plan-id="' + esc(item.other) + '">' + esc(item.other) + '</button> '
          + '<span class="pill">' + esc(item.direction) + '</span> <span class="pill">' + esc(rel.intent) + '</span> <span class="pill">' + esc(rel.confidence || 'unknown') + '</span>'
          + '<div>' + esc(meaning) + '</div>'
          + '<div class="subtle">' + esc((rel.confidence_reason || 'No confidence reason recorded.') + ' · ' + rel.source + ' -> ' + rel.target + ' · ' + rel.type + ' · ' + rel.evidence) + '</div></li>';
      }).join('') + '</ol>';
    }

    function relationshipMeaning(direction, intent, otherTaskId) {
      const prefix = direction === 'incoming'
        ? otherTaskId + ' points at this plan'
        : 'This plan points at ' + otherTaskId;
      if (intent === 'dependency') return prefix + ' as a dependency signal.';
      if (intent === 'sequence') return prefix + ' as sequencing context.';
      if (intent === 'review') return prefix + ' as review context.';
      if (intent === 'hierarchy') return prefix + ' as parent/child hierarchy context.';
      if (intent === 'implementation') return prefix + ' as implementation context.';
      if (intent === 'coordination') return prefix + ' as coordination context.';
      if (intent === 'lifecycle') return prefix + ' as lifecycle context.';
      return prefix + ' as related context.';
    }

    function clusterForPlan(taskId) {
      return data.relationship_clusters.find(cluster => (cluster.plan_ids || []).includes(taskId));
    }

    function readHashState() {
      const params = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
      const clusterId = params.get('cluster');
      const planId = params.get('plan');
      if (clusterId && clustersById.has(clusterId)) state.clusterId = clusterId;
      if (planId && byId.has(planId)) state.selected = planId;
      for (const [key, elementName] of hashFilters) {
        const value = params.get(key);
        if (value !== null && {CLIENT_CODE}[elementName]) {CLIENT_CODE}[elementName].value = value;
      }
      for (const [key, elementName] of storyHashFilters) {
        const value = params.get(key);
        if (value !== null && {CLIENT_CODE}[elementName]) {CLIENT_CODE}[elementName].value = value;
      }
    }

    function updateHash() {
      const params = new URLSearchParams();
      if (state.clusterId) params.set('cluster', state.clusterId);
      if (state.selected) params.set('plan', state.selected);
      for (const [key, elementName] of hashFilters) {
        const value = {CLIENT_CODE}[elementName]?.value || '';
        if (value) params.set(key, value);
      }
      for (const [key, elementName] of storyHashFilters) {
        const value = {CLIENT_CODE}[elementName]?.value || '';
        if (value) params.set(key, value);
      }
      const nextHash = params.toString();
      const currentHash = String(window.location.hash || '').replace(/^#/, '');
      if (nextHash !== currentHash) {
        history.replaceState(null, '', nextHash ? '#' + nextHash : window.location.pathname + window.location.search);
      }
    }

    function relationshipsForVisiblePlans() {
      const visibleIds = new Set(state.filtered.map(plan => plan.task_id));
      return data.relationships.filter(rel => (
        visibleIds.has(rel.source)
        && visibleIds.has(rel.target)
        && (!{CLIENT_CODE}.relationshipIntent.value || rel.intent === {CLIENT_CODE}.relationshipIntent.value)
        && (!{CLIENT_CODE}.relationshipConfidence.value || rel.confidence === {CLIENT_CODE}.relationshipConfidence.value)
      ));
    }

    function relationshipKey(rel) {
      return [rel.source, rel.target, rel.type, rel.intent, rel.evidence].map(value => String(value || '')).join('\\u0000');
    }

    function findConnectionPath(from, to) {
      if (!from || !to) return { found: false, message: 'Choose two plans to trace their shortest visible connection path.' };
      if (from === to) return { found: true, from, to, hops: 0, planIds: [from], relationships: [] };
      const known = new Set(data.plans.map(plan => plan.task_id));
      if (!known.has(from) || !known.has(to)) return { found: false, message: 'Both endpoints must be known plan IDs.' };
      const adjacency = new Map([...known].map(id => [id, []]));
      for (const rel of data.relationships) {
        if (!known.has(rel.source) || !known.has(rel.target)) continue;
        adjacency.get(rel.source).push({ planId: rel.target, relationship: rel, traversed: 'forward' });
        adjacency.get(rel.target).push({ planId: rel.source, relationship: rel, traversed: 'reverse' });
      }
      const visited = new Set([from]);
      const queue = [{ planId: from, planIds: [from], relationships: [] }];
      while (queue.length) {
        const current = queue.shift();
        if (current.relationships.length >= 6) continue;
        const nextEdges = (adjacency.get(current.planId) || []).slice().sort((a, b) => {
          const intentCompare = intentPriority(a.relationship.intent) - intentPriority(b.relationship.intent);
          return intentCompare || a.planId.localeCompare(b.planId);
        });
        for (const edge of nextEdges) {
          if (visited.has(edge.planId)) continue;
          const next = {
            planId: edge.planId,
            planIds: [...current.planIds, edge.planId],
            relationships: [...current.relationships, edge]
          };
          if (edge.planId === to) {
            return { found: true, from, to, hops: next.relationships.length, planIds: next.planIds, relationships: next.relationships };
          }
          visited.add(edge.planId);
          queue.push(next);
        }
      }
      return { found: false, from, to, message: 'No connection path found within six relationship hops.' };
    }

    function intentPriority(intent) {
      const order = ['dependency', 'sequence', 'review', 'hierarchy', 'implementation', 'coordination', 'lifecycle'];
      const index = order.indexOf(intent);
      return index === -1 ? order.length : index;
    }

    function renderPathResult() {
      const path = state.path;
      if (!path) {
        {CLIENT_CODE}.pathResult.textContent = 'Choose two plans to trace their shortest visible connection path.';
        return;
      }
      if (!path.found) {
        {CLIENT_CODE}.pathResult.textContent = path.message || 'No connection path found.';
        return;
      }
      const sequence = path.planIds.map(id => '<button class="linklike" type="button" data-plan-id="' + esc(id) + '">' + esc(id) + '</button>').join(' -> ');
      const steps = path.relationships.map(edge => {
        const rel = edge.relationship;
        const traversed = edge.traversed === 'reverse' ? 'reverse traversal of ' : '';
        return '<li><strong>' + esc(rel.source) + ' -> ' + esc(rel.target) + '</strong> '
          + '<span class="pill">' + esc(rel.type) + '</span> <span class="pill">' + esc(rel.intent) + '</span>'
          + '<div class="subtle">' + esc(traversed + rel.evidence) + '</div></li>';
      }).join('');
      {CLIENT_CODE}.pathResult.innerHTML = '<strong>Connection path: ' + esc(path.from) + ' -> ' + esc(path.to) + '</strong>'
        + '<div>' + path.hops + ' hop' + (path.hops === 1 ? '' : 's') + ' · ' + sequence + '</div>'
        + (steps ? '<ol>' + steps + '</ol>' : '<div class="subtle">Same plan selected.</div>');
    }

    function runPathFinder() {
      state.path = findConnectionPath({CLIENT_CODE}.pathFrom.value, {CLIENT_CODE}.pathTo.value);
      renderPathResult();
      renderGraph();
    }

    function clearConnectionPath() {
      state.path = null;
      {CLIENT_CODE}.pathFrom.value = '';
      {CLIENT_CODE}.pathTo.value = '';
      renderPathResult();
      renderGraph();
    }

    function renderIntentSummary(links) {
      if (!links.length) return '<span class="subtle">No relationship intents in current filter.</span>';
      const counts = new Map();
      for (const rel of links) counts.set(rel.intent, (counts.get(rel.intent) || 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([intent, count]) => '<span class="pill">' + esc(intent) + ': ' + count + '</span>')
        .join('');
    }

    function renderRelationshipPanel(label, links, taskId) {
      const body = links.length
        ? '<ul>' + links.map(rel => {
          const other = rel.source === taskId ? rel.target : rel.source;
          return '<li><button class="linklike" type="button" data-plan-id="' + esc(other) + '">' + esc(other) + '</button> '
            + '<span class="pill">' + esc(rel.type) + '</span> <span class="pill">' + esc(rel.intent) + '</span>'
            + '<div class="subtle">' + esc(rel.evidence) + '</div></li>';
        }).join('') + '</ul>'
        : '<p class="subtle">None in current filter.</p>';
      return '<div class="relationship-panel"><h3>' + esc(label) + ' (' + links.length + ')</h3>' + body + '</div>';
    }

    function renderGraph() {
      const allLinks = relationshipsForVisiblePlans();
      let links = allLinks;
      let ids = [...new Set(links.flatMap(rel => [rel.source, rel.target]))];
      let mode = 'filtered relationships';
      if (state.path && state.path.found) {
        const pathKeys = new Set(state.path.relationships.map(edge => relationshipKey(edge.relationship)));
        links = data.relationships.filter(rel => pathKeys.has(relationshipKey(rel)));
        ids = state.path.planIds.slice();
        mode = 'connection path';
      } else if (state.selected && {CLIENT_CODE}.neighborhood.checked) {
        links = allLinks.filter(rel => rel.source === state.selected || rel.target === state.selected);
        ids = [...new Set([state.selected, ...links.flatMap(rel => [rel.source, rel.target])])];
        mode = 'selected neighborhood';
      } else if ({CLIENT_CODE}.graphAll.checked) {
        ids = state.filtered.map(plan => plan.task_id);
        mode = 'all filtered plans';
      }
      const truncated = !{CLIENT_CODE}.graphAll.checked && !state.path && ids.length > 80;
      if (truncated) ids = ids.slice(0, 80);
      const svg = {CLIENT_CODE}.graph;
      svg.innerHTML = '';
      svg.setAttribute('viewBox', '0 0 900 520');
      ensureArrowMarker(svg);
      {CLIENT_CODE}.graphSummary.textContent = 'Showing ' + mode + ': ' + ids.length + ' plans, ' + links.length + ' links' + (truncated ? ' (first 80 shown; enable All filtered plans to render the full filtered graph)' : '');
      if (ids.length === 0) {
        svg.innerHTML = '<text x="24" y="42" fill="#667085">No interconnections in the current filter.</text>';
        return;
      }
      const center = { x: 450, y: 260 };
      const radius = Math.min(210, 36 + ids.length * 8);
      const positions = new Map();
      ids.forEach((id, index) => {
        const angle = (Math.PI * 2 * index) / ids.length - Math.PI / 2;
        positions.set(id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
      });
      for (const rel of links) {
        if (!positions.has(rel.source) || !positions.has(rel.target)) continue;
        const a = positions.get(rel.source);
        const b = positions.get(rel.target);
        line(svg, a.x, a.y, b.x, b.y, rel);
      }
      for (const id of ids) {
        const p = positions.get(id);
        const selected = state.selected === id;
        node(svg, p.x, p.y, id, selected);
      }
    }

    function node(svg, x, y, id, selected) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.style.cursor = 'pointer';
      group.addEventListener('click', () => selectPlan(id));
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', selected ? 14 : 10);
      circle.setAttribute('fill', selected ? '#2563eb' : '#ffffff');
      circle.setAttribute('stroke', selected ? '#1d4ed8' : '#667085');
      circle.setAttribute('stroke-width', selected ? '3' : '1.5');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + 14);
      text.setAttribute('y', y + 4);
      text.setAttribute('font-size', '11');
      text.setAttribute('fill', '#1d2430');
      text.textContent = id.length > 32 ? id.slice(0, 29) + '...' : id;
      group.append(circle, text);
      svg.appendChild(group);
    }

    function ensureArrowMarker(svg) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '4');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'strokeWidth');
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arrow.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
      arrow.setAttribute('fill', '#667085');
      marker.appendChild(arrow);
      defs.appendChild(marker);
      svg.appendChild(defs);
    }

    function line(svg, x1, y1, x2, y2, rel) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.max(1, Math.hypot(dx, dy));
      const targetGap = 16;
      const endX = x2 - (dx / length) * targetGap;
      const endY = y2 - (dy / length) * targetGap;
      path.setAttribute('x1', x1);
      path.setAttribute('y1', y1);
      path.setAttribute('x2', endX);
      path.setAttribute('y2', endY);
      const strong = rel.type === 'parent' || rel.intent === 'dependency' || rel.intent === 'review';
      path.setAttribute('stroke', colorForIntent(rel.intent));
      path.setAttribute('stroke-width', strong ? '2' : '1.2');
      path.setAttribute('opacity', '0.8');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = rel.source + ' -> ' + rel.target + ' · ' + rel.type + ' · ' + rel.intent + ' · ' + (rel.confidence || 'unknown') + ' · ' + rel.evidence;
      path.appendChild(title);
      svg.appendChild(path);
    }

    function colorForIntent(intent) {
      if (intent === 'dependency') return '#b91c1c';
      if (intent === 'sequence') return '#2563eb';
      if (intent === 'review') return '#7c3aed';
      if (intent === 'hierarchy') return '#0f766e';
      if (intent === 'implementation') return '#166534';
      if (intent === 'coordination') return '#0369a1';
      if (intent === 'lifecycle') return '#a16207';
      return '#98a2b3';
    }

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function cssName(value) {
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function sourceHref(plan) {
      return '../../../' + String(plan.path || '').split('/').map(encodeURIComponent).join('/');
    }

    function sourcePathHref(sourcePath) {
      return '../../../' + String(sourcePath || '').split('/').map(encodeURIComponent).join('/');
    }

    optionize({CLIENT_CODE}.status, unique('status'));
    optionize({CLIENT_CODE}.client, unique('client_code'));
    optionize({CLIENT_CODE}.framework, unique('framework'));
    optionize({CLIENT_CODE}.review, unique('review_lane'));
    optionize({CLIENT_CODE}.risk, unique('risk_tier'));
    optionize({CLIENT_CODE}.qualityFlag, uniquePlanArray('quality_flags'));
    optionize({CLIENT_CODE}.relationshipIntent, uniqueRelationships('intent'));
    optionize({CLIENT_CODE}.relationshipConfidence, uniqueRelationships('confidence'));
    optionize({CLIENT_CODE}.storyIntent, [...new Set((data.workstream_stories || []).flatMap(row => [
      ...(row.top_intents || []).map(item => item.label),
      ...(row.relationship_examples || []).map(example => example.intent)
    ]).filter(Boolean))].sort());
    optionizePlans({CLIENT_CODE}.pathFrom);
    optionizePlans({CLIENT_CODE}.pathTo);
    for (const input of [{CLIENT_CODE}.search, {CLIENT_CODE}.client, {CLIENT_CODE}.framework, {CLIENT_CODE}.status, {CLIENT_CODE}.review, {CLIENT_CODE}.risk, {CLIENT_CODE}.qualityFlag, {CLIENT_CODE}.relationshipIntent, {CLIENT_CODE}.relationshipConfidence]) input.addEventListener('input', applyFiltersAndPersist);
    for (const input of [{CLIENT_CODE}.storySearch, {CLIENT_CODE}.storyIntent, {CLIENT_CODE}.storyRelationshipMode]) input.addEventListener('input', applyStoryFiltersAndPersist);
    {CLIENT_CODE}.findPath.addEventListener('click', runPathFinder);
    {CLIENT_CODE}.clearPath.addEventListener('click', clearConnectionPath);
    {CLIENT_CODE}.pathResult.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.neighborhood.addEventListener('input', renderGraph);
    {CLIENT_CODE}.graphAll.addEventListener('input', renderGraph);
    {CLIENT_CODE}.overview.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.clusters.addEventListener('click', event => {
      const clusterButton = event.target.closest('button[data-cluster-id]');
      if (clusterButton) {
        focusCluster(clusterButton.dataset.clusterId);
        return;
      }
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.workstreamMatrix.addEventListener('click', event => {
      const clusterButton = event.target.closest('button[data-cluster-id]');
      if (clusterButton) focusCluster(clusterButton.dataset.clusterId);
    });
    {CLIENT_CODE}.workstreamStories.addEventListener('click', event => {
      const clusterButton = event.target.closest('button[data-cluster-id]');
      if (clusterButton) focusCluster(clusterButton.dataset.clusterId);
      const planButton = event.target.closest('button[data-plan-id]');
      if (planButton) selectPlan(planButton.dataset.planId);
    });
    {CLIENT_CODE}.impactHubs.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.hubs.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.paths.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.visibleRelationships.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.remediationQueue.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.unlinkedPlanTriage.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    {CLIENT_CODE}.visualCoverage.addEventListener('click', event => {
      const button = event.target.closest('button[data-cluster-id]');
      if (button) focusCluster(button.dataset.clusterId);
    });
    {CLIENT_CODE}.recentActivity.addEventListener('click', event => {
      const planButton = event.target.closest('button[data-plan-id]');
      if (planButton) selectPlan(planButton.dataset.planId);
      const clusterButton = event.target.closest('button[data-cluster-id]');
      if (clusterButton) focusCluster(clusterButton.dataset.clusterId);
    });
    {CLIENT_CODE}.planProgressTimeline.addEventListener('click', event => {
      const planButton = event.target.closest('button[data-plan-id]');
      if (planButton) selectPlan(planButton.dataset.planId);
      const clusterButton = event.target.closest('button[data-cluster-id]');
      if (clusterButton) focusCluster(clusterButton.dataset.clusterId);
    });
    {CLIENT_CODE}.planActionBoard.addEventListener('click', event => {
      const planButton = event.target.closest('button[data-plan-id]');
      if (planButton) selectPlan(planButton.dataset.planId);
    });
    {CLIENT_CODE}.clearCluster.addEventListener('click', clearClusterFocus);
    {CLIENT_CODE}.detail.addEventListener('click', event => {
      const button = event.target.closest('button[data-plan-id]');
      if (button) selectPlan(button.dataset.planId);
    });
    renderCards();
    renderBriefing();
    renderGraphHealth();
    renderConfidenceActions();
    renderRemediationQueue();
    renderUnlinkedPlanTriage();
    renderVisualCoverage();
    renderRecentActivity();
    renderPlanProgressTimeline();
    renderPlanActionBoard();
    renderOverview();
    renderDataQuality();
    renderClusters();
    renderWorkstreamMatrix();
    renderImpactHubs();
    renderHubs();
    renderActionPaths();
    renderLegend();
    readHashState();
    renderWorkstreamStories();
    applyFilters();
    if (state.selected) selectPlan(state.selected);
  </script>
</body>
</html>
`;
}

function renderPlanVisibilityIndex(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const quickViews = options.quickViews || buildPlanVisibilityIndexQuickViews(options.model);
  const workstreams = options.workstreams || (options.model?.relationship_clusters || []).slice(0, 8);
  const relationshipHubs = options.relationshipHubs || (options.model?.relationship_hubs || []).slice(0, 8);
  const impactHubs = options.impactHubs || options.model?.impact_hubs;
  const buckets = options.buckets || options.model?.buckets || {};
  const dataQuality = options.dataQuality || options.model?.data_quality || {};
  const priorityScan = options.priorityScan || options.model?.priority_scan || [];
  const operatorQuestionRoutes = options.model?.operator_question_routes || [];
  const mapReadingGuide = options.model?.map_reading_guide;
  const protocolReadiness = options.model?.protocol_readiness;
  const planActionBoard = options.model?.plan_action_board;
  const executionReadiness = options.model?.execution_readiness;
  const routingBlockers = options.model?.routing_blockers;
  const firstRepairPath = options.model?.first_repair_path;
  const riskGateQueue = options.model?.risk_gate_queue;
  const orchestrationRoutingBoard = options.model?.orchestration_routing_board;
  const commandRunbook = options.model?.command_runbook;
  const graphHealth = options.model?.graph_health;
  const remediationQueue = options.model?.remediation_queue || [];
  const unlinkedPlanTriage = options.model?.unlinked_plan_triage;
  const workstreamStories = options.model?.workstream_stories || [];
  const workstreamMatrix = options.model?.workstream_matrix || [];
  const workstreamDrilldowns = options.model?.workstream_drilldowns;
  const actionPaths = options.model?.action_paths || [];
  const dependencySequenceChains = options.model?.dependency_sequence_chains || [];
  const relationships = options.model?.relationships || [];
  const visualFlowcharts = options.model?.visual_flowcharts;
  const visualCoverage = options.model?.visual_coverage;
  const recentActivity = options.model?.recent_activity;
  const planProgressTimeline = options.model?.plan_progress_timeline;
  const reviewLaneGrouping = options.model?.groupings?.review_lane || {};
  const relationshipConfidence = options.model?.relationship_groupings?.confidence || {};
  const links = options.links || {
    systemHtml: 'plan-visibility__current.html',
    allHtml: 'plan-visibility__all.html',
    systemMarkdown: 'plan-visibility__current.md',
    allMarkdown: 'plan-visibility__all.md',
    operatorBrief: 'plan-visibility__operator-brief.md',
    systemJson: 'plan-visibility__current.json',
    allJson: 'plan-visibility__all.json',
    adapterManifest: 'visual-plans/visual-plan-adapter-manifest.json',
    focusedLibrary: 'visual-plans/index.html',
    focusedLibraryMarkdown: 'visual-plans/index.md',
    focusedPlan: 'visual-plans/plan-visibility-surface.md',
    focusedCluster: 'visual-plans/cluster-1.md'
  };
  const sectionLinks = [
    { id: 'operator-question-router', label: 'Question Router', purpose: 'common operator questions mapped to exact views' },
    { id: 'how-to-read-map', label: 'How To Read', purpose: 'map vocabulary, use, and trust boundaries' },
    { id: 'protocol-readiness', label: 'Protocol Readiness', purpose: 'plan-task fields, routing, subtasks, and evidence repair' },
    { id: 'priority-scan', label: 'Priority Scan', purpose: 'first recommended plans and workstreams to inspect' },
    { id: 'plan-action-board', label: 'Plan Action Board', purpose: 'runnable, dependency-watch, map-repair, and impact lanes' },
    { id: 'execution-readiness', label: 'Execution Readiness', purpose: 'routeable work vs protocol, dependency, and map repair first' },
    { id: 'routing-blockers', label: 'Routing Blockers', purpose: 'why ready-looking work is not routeable yet' },
    { id: 'first-repair-path', label: 'First Repair Path', purpose: 'ordered repair path before routing' },
    { id: 'risk-gate-queue', label: 'Risk Gate Queue', purpose: 'ready-looking work grouped by gate owner' },
    { id: 'orchestration-routing-board', label: 'Orchestration Routing', purpose: 'local, bridge, operator, and repair-before-dispatch routes' },
    { id: 'command-runbook', label: 'Command Runbook', purpose: 'current suggested commands grouped by purpose and source surface' },
    { id: 'review-lane-routing', label: 'Review Lane Routing', purpose: 'who validates work before it clears' },
    { id: 'plan-protocol-flow', label: 'Plan Protocol Flow', purpose: '/dl through plan, review, execution, audit, and handoff' },
    { id: 'workstream-overview', label: 'Workstream Overview', purpose: 'largest connected workstreams' },
    { id: 'largest-workstream-breakdown', label: 'Largest Workstream Breakdown', purpose: 'status, intent, bridge, and suggested next context' },
    { id: 'workstream-drilldowns', label: 'Workstream Drilldowns', purpose: 'large workstreams split into smaller slices' },
    { id: 'interconnection-paths', label: 'Interconnection Paths', purpose: 'upstream feeders and downstream dependents' },
    { id: 'dependency-sequence-chains', label: 'Dependency Chains', purpose: 'multi-hop dependency and sequence routes' },
    { id: 'connection-evidence-spotlight', label: 'Connection Evidence Spotlight', purpose: 'why representative graph links exist' },
    { id: 'subtask-hierarchy-spotlight', label: 'Subtask Hierarchy Spotlight', purpose: 'parent/child/subtask relationships' },
    { id: 'workstream-connection-stories', label: 'Workstream Connection Stories', purpose: 'why workstreams are grouped together' },
    { id: 'bridge-plans', label: 'Bridge Plans', purpose: 'highly connected plans that explain interlocks' },
    { id: 'relationship-types', label: 'Relationship Types', purpose: 'dominant relationship intents' },
    { id: 'relationship-confidence', label: 'Relationship Confidence', purpose: 'declared vs derived edge confidence' },
    { id: 'map-quality', label: 'Map Quality', purpose: 'weaknesses in the generated map' },
    { id: 'visual-flowcharts', label: 'Visual Flowcharts', purpose: 'Mermaid and portable brief artifacts' }
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mythos Plan Visibility Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --ink: #1f2937;
      --muted: #667085;
      --line: #d8dee8;
      --accent: #2563eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }
    header {
      padding: 24px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    main { max-width: 980px; padding: 22px 24px 32px; }
    .subtle { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin: 18px 0;
    }
    .card {
      display: block;
      min-height: 136px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .card strong { display: block; margin-bottom: 6px; font-size: 18px; color: var(--accent); }
    .files {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    .files a { color: var(--accent); overflow-wrap: anywhere; }
    .quick-views {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin: 12px 0 20px;
    }
    .quick-view {
      display: block;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .quick-view strong { display: block; color: var(--accent); }
    .workstreams {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
      margin: 12px 0 20px;
    }
    .workstream {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .workstream strong { display: block; color: var(--accent); }
    .workstream-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 8px;
    }
    .workstream-actions a { color: var(--accent); }
    .route-map {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .route {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .route strong { display: block; margin-bottom: 4px; }
    .section-nav {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin: 18px 0;
    }
    .section-nav a {
      display: block;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .section-nav strong { display: block; color: var(--accent); }
    .priority-scan {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .priority-card {
      display: block;
      min-height: 128px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .priority-card strong { display: block; color: var(--accent); }
    .priority-card code { display: inline-block; margin-top: 6px; }
    .protocol-flow {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .protocol-flow svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .protocol-flow text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .workstream-overview {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .workstream-overview svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .workstream-overview text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .workstream-breakdown {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .workstream-breakdown svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .workstream-breakdown text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .interconnection-paths {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .interconnection-path {
      display: block;
      min-height: 150px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .interconnection-path strong { display: block; color: var(--accent); }
    .dependency-chains {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .dependency-chain {
      display: block;
      min-height: 150px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .dependency-chain strong { display: block; color: var(--accent); }
    .path-line {
      margin: 8px 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .evidence-spotlight {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .evidence-card {
      display: block;
      min-height: 150px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .evidence-card strong { display: block; color: var(--accent); }
    .evidence-card p { margin: 8px 0 0; }
    .hierarchy-spotlight {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .hierarchy-card {
      display: block;
      min-height: 150px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .hierarchy-card strong { display: block; color: var(--accent); }
    .child-line {
      margin: 8px 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .bridge-overview {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .bridge-overview svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .bridge-overview text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .intent-overview {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .intent-overview svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .intent-overview text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .status-overview {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .status-overview svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .status-overview text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .quality-overview {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .quality-overview svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .quality-overview text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .action-flow {
      margin: 18px 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-x: auto;
    }
    .action-flow svg {
      display: block;
      min-width: 900px;
      width: 100%;
      height: auto;
    }
    .action-flow text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .review-routing {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .review-route {
      display: block;
      min-height: 120px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: inherit;
      background: var(--panel);
      text-decoration: none;
    }
    .review-route strong { display: block; color: var(--accent); }
    .review-route .count { display: block; margin: 6px 0; font-size: 22px; font-weight: 700; }
    .decision-guide {
      margin: 18px 0;
      padding-left: 22px;
    }
    .decision-guide li { margin: 8px 0; }
    code {
      padding: 1px 4px;
      border-radius: 4px;
      background: #eef2f7;
      overflow-wrap: anywhere;
    }
    .authority {
      margin-top: 18px;
      padding: 12px;
      border: 1px solid #f2c94c;
      border-radius: 8px;
      color: #713f12;
      background: #fffbeb;
    }
  </style>
</head>
<body>
  <header>
    <h1>Mythos Plan Visibility Dashboard</h1>
    <div class="subtle">Generated ${escapeHtml(generatedAt)} · Derived context only</div>
  </header>
  <main>
    <h2>Route Map</h2>
    <div class="route-map">
      <div class="route"><strong>Start here</strong><span class="subtle">Open the current system map for the default scan: briefing, queues, clusters, graph, filters, and source links.</span></div>
      <div class="route"><strong>Follow a workstream</strong><span class="subtle">Use Relationship Clusters, then Focus cluster. Cluster cards show a suggested next plan and the next step to inspect.</span></div>
      <div class="route"><strong>Share a view</strong><span class="subtle">Filtered dashboard URLs preserve search, filters, selected plan, and focused cluster in the URL hash.</span></div>
      <div class="route"><strong>Make a brief</strong><span class="subtle">Use the visual brief library for portable Markdown flowcharts, or run <code>npm run plans:visual -- --plan &lt;task-id&gt; --write</code>.</span></div>
    </div>
    <h2 id="dashboard-navigator">Dashboard Navigator</h2>
    ${renderIndexSectionNavigator(sectionLinks)}
    <h2 id="operator-question-router">Operator Question Router</h2>
    <div class="route-map">
      ${renderIndexOperatorQuestionRoutes(operatorQuestionRoutes)}
    </div>
    <h2 id="how-to-read-map">How To Read This Map</h2>
    <div class="route-map">
      ${renderIndexMapReadingGuide(mapReadingGuide)}
    </div>
    <h2 id="protocol-readiness">Protocol Readiness</h2>
    ${renderIndexProtocolReadiness(protocolReadiness)}
    <h2 id="priority-scan">Priority Scan</h2>
    ${renderIndexPriorityScan(priorityScan)}
    <h2 id="plan-action-board">Plan Action Board</h2>
    <div class="route-map">
      ${renderIndexPlanActionBoard(planActionBoard)}
    </div>
    <h2 id="execution-readiness">Execution Readiness</h2>
    <div class="route-map">
      ${renderIndexExecutionReadiness(executionReadiness)}
    </div>
    <h2 id="routing-blockers">Routing Blockers</h2>
    <div class="route-map">
      ${renderIndexRoutingBlockers(routingBlockers)}
    </div>
    <h2 id="first-repair-path">First Repair Path</h2>
    <div class="route-map">
      ${renderIndexFirstRepairPath(firstRepairPath)}
    </div>
    <h2 id="risk-gate-queue">Risk Gate Queue</h2>
    <div class="route-map">
      ${renderIndexRiskGateQueue(riskGateQueue)}
    </div>
    <h2 id="orchestration-routing-board">Orchestration Routing Board</h2>
    <div class="route-map">
      ${renderIndexOrchestrationRoutingBoard(orchestrationRoutingBoard)}
    </div>
    <h2 id="command-runbook">Command Runbook</h2>
    <div class="route-map">
      ${renderIndexCommandRunbook(commandRunbook)}
    </div>
    <h2 id="review-lane-routing">Review Lane Routing</h2>
    ${renderIndexReviewLaneRouting(reviewLaneGrouping)}
    <h2 id="action-readiness-flow">Action Readiness Flow</h2>
    ${renderIndexActionReadinessFlow(planActionBoard)}
    <h2 id="plan-protocol-flow">Plan Protocol Flow</h2>
    ${renderPlanProtocolFlowSvg()}
    <h2 id="workstream-overview">Workstream Overview</h2>
    ${renderIndexWorkstreamOverview(workstreams)}
    <h2 id="largest-workstream-breakdown">Largest Workstream Breakdown</h2>
    ${renderIndexLargestWorkstreamBreakdown(workstreams, workstreamMatrix, relationshipHubs)}
    <h2 id="workstream-drilldowns">Workstream Drilldowns</h2>
    <div class="route-map">
      ${renderIndexWorkstreamDrilldowns(workstreamDrilldowns)}
    </div>
    <h2 id="interconnection-paths">Interconnection Paths</h2>
    ${renderIndexInterconnectionPaths(actionPaths)}
    <h2 id="dependency-sequence-chains">Dependency & Sequence Chains</h2>
    ${renderIndexDependencySequenceChains(dependencySequenceChains)}
    <h2 id="connection-evidence-spotlight">Connection Evidence Spotlight</h2>
    ${renderIndexConnectionEvidenceSpotlight(relationships)}
    <h2 id="subtask-hierarchy-spotlight">Subtask Hierarchy Spotlight</h2>
    ${renderIndexSubtaskHierarchySpotlight(relationships)}
    <h2 id="workstream-connection-stories">Workstream Connection Stories</h2>
    <div class="route-map">
      ${renderIndexWorkstreamStories(workstreamStories)}
    </div>
    <h2 id="bridge-plans">Bridge Plans</h2>
    ${renderIndexBridgePlanOverview(relationshipHubs)}
    <h2 id="impact-hubs">Impact Hubs</h2>
    <div class="route-map">
      ${renderIndexImpactHubs(impactHubs)}
    </div>
    <h2 id="relationship-types">Relationship Types</h2>
    ${renderIndexRelationshipIntentOverview(graphHealth?.top_intents)}
    <h2 id="relationship-confidence">Relationship Confidence</h2>
    ${renderIndexRelationshipConfidenceOverview(relationshipConfidence)}
    <h2 id="status-overview">Status Overview</h2>
    ${renderIndexStatusOverview(buckets)}
    <h2 id="map-quality">Map Quality</h2>
    ${renderIndexMapQualityOverview(dataQuality)}
    <h2>Decision Guide</h2>
    <ol class="decision-guide">
      <li><strong>Choose a slice:</strong> open Ready Plans for execution candidates, Dependency Links for blocked sequencing, or Largest Cluster for connected system work.</li>
      <li><strong>Open the map:</strong> select a plan to inspect source, next step, incoming/outgoing links, workstream, hub role, and action paths.</li>
      <li><strong>Open the brief:</strong> use a cluster card's Open brief link when you need a portable flowchart or handoff artifact.</li>
      <li><strong>Act from authority:</strong> run review or execution commands from the source task plan, not from the generated dashboard alone.</li>
    </ol>
    <h2>Graph Health</h2>
    <div class="route-map">
      ${renderIndexGraphHealth(graphHealth)}
    </div>
    <h2>Map Confidence Actions</h2>
    <div class="route-map">
      ${renderIndexConfidenceActions(graphHealth?.recommendations)}
    </div>
    <h2>Remediation Queue</h2>
    <div class="route-map">
      ${renderIndexRemediationQueue(remediationQueue)}
    </div>
    <h2>Unlinked Plan Triage</h2>
    <div class="route-map">
      ${renderIndexUnlinkedPlanTriage(unlinkedPlanTriage)}
    </div>
    <h2 id="visual-flowcharts">Visual Flowcharts</h2>
    <div class="route-map">
      ${renderIndexVisualFlowcharts(visualFlowcharts)}
    </div>
    <h2>Visual Coverage Queue</h2>
    <div class="route-map">
      ${renderIndexVisualCoverage(visualCoverage)}
    </div>
    <h2>Recent Source Activity</h2>
    <div class="route-map">
      ${renderIndexRecentActivity(recentActivity)}
    </div>
    <h2>Plan Progress Timeline</h2>
    <div class="route-map">
      ${renderIndexPlanProgressTimeline(planProgressTimeline)}
    </div>
    <h2>Quick Views</h2>
    <div class="quick-views">
      ${quickViews.map((view) => `<a class="quick-view" href="${escapeHtml(view.href)}"><strong>${escapeHtml(view.label)}</strong><span class="subtle">${escapeHtml(view.description)}</span></a>`).join('\n      ')}
    </div>
    <h2>Workstream Routes</h2>
    <div class="workstreams">
      ${renderIndexWorkstreamRoutes(workstreams)}
    </div>
    <div class="grid">
      <a class="card" href="${escapeHtml(links.systemHtml)}">
        <strong>Current System Plan Map</strong>
        Default view. System task plans only, with search, filters, selected-plan detail, and relationship graph.
      </a>
      <a class="card" href="${escapeHtml(links.allHtml)}">
        <strong>All Plans Map</strong>
        Explicit broad view including client plan roots. Use only when client-plan visibility is intended.
      </a>
    </div>
    <h2>Generated Files</h2>
    <div class="files">
      <a href="${escapeHtml(links.systemMarkdown)}">system Markdown</a>
      <a href="${escapeHtml(links.allMarkdown)}">all-plans Markdown</a>
      <a href="${escapeHtml(links.operatorBrief)}">operator brief</a>
      <a href="${escapeHtml(links.systemJson)}">system JSON model</a>
      <a href="${escapeHtml(links.allJson)}">all-plans JSON model</a>
      <a href="${escapeHtml(links.adapterManifest)}">visual-plan adapter manifest</a>
    </div>
    <h2>Focused Visual Briefs</h2>
    <div class="files">
      <a href="${escapeHtml(links.focusedLibrary)}">visual brief library</a>
      <a href="${escapeHtml(links.focusedLibraryMarkdown)}">visual brief library Markdown</a>
      <a href="${escapeHtml(links.focusedPlan)}">plan-visibility-surface visual brief</a>
      <a href="${escapeHtml(links.focusedCluster)}">largest cluster visual brief</a>
    </div>
    <div class="authority">Authority remains in task-plan JSON/MD, amendments, reviews, signals, and canonical command specs. These dashboard files are generated views.</div>
  </main>
</body>
</html>
`;
}

function renderPlanProtocolFlowSvg() {
  const nodes = [
    { x: 24, y: 34, label: '/dl', detail: 'concept routing' },
    { x: 174, y: 34, label: 'concept-init', detail: 'durable concept' },
    { x: 354, y: 34, label: 'plan-task', detail: 'bounded plan' },
    { x: 534, y: 34, label: 'review-task-plan', detail: 'gate before work' },
    { x: 714, y: 34, label: 'run-plan', detail: 'execute slice' },
    { x: 354, y: 150, label: 'review-progress', detail: 'findings first' },
    { x: 534, y: 150, label: 'completion audit', detail: 'evidence check' },
    { x: 714, y: 150, label: 'next-session', detail: 'handoff state' }
  ];
  const nodeByLabel = new Map(nodes.map((node) => [node.label, node]));
  const edges = [
    ['/dl', 'concept-init'],
    ['concept-init', 'plan-task'],
    ['plan-task', 'review-task-plan'],
    ['review-task-plan', 'run-plan'],
    ['run-plan', 'review-progress'],
    ['review-progress', 'completion audit'],
    ['completion audit', 'next-session'],
    ['completion audit', 'plan-task']
  ];
  const edgeMarkup = edges.map(([from, to]) => {
    const a = nodeByLabel.get(from);
    const b = nodeByLabel.get(to);
    const x1 = a.x + 138;
    const y1 = a.y + 34;
    const x2 = b.x - 10;
    const y2 = b.y + 34;
    if (from === 'run-plan' && to === 'review-progress') {
      return '<path d="M 783 102 C 760 132, 548 132, 458 150" fill="none" stroke="#667085" stroke-width="1.6" marker-end="url(#protocol-arrow)" />';
    }
    if (from === 'completion audit' && to === 'plan-task') {
      return '<path d="M 534 184 C 456 222, 328 218, 300 102" fill="none" stroke="#a16207" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#protocol-arrow-warn)" />';
    }
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#667085" stroke-width="1.6" marker-end="url(#protocol-arrow)" />';
  }).join('\n        ');
  const nodeMarkup = nodes.map((node) => (
    '<g>\n'
    + '          <rect x="' + node.x + '" y="' + node.y + '" width="138" height="68" rx="8" fill="#ffffff" stroke="#d8dee8" />\n'
    + '          <text x="' + (node.x + 14) + '" y="' + (node.y + 30) + '" font-size="14" font-weight="700" fill="#1f2937">' + escapeHtml(node.label) + '</text>\n'
    + '          <text x="' + (node.x + 14) + '" y="' + (node.y + 51) + '" font-size="12" fill="#667085">' + escapeHtml(node.detail) + '</text>\n'
    + '        </g>'
  )).join('\n        ');
  return `<div class="protocol-flow" role="img" aria-label="Mythos plan protocol flow from concept routing through handoff">
      <svg viewBox="0 0 900 250" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="protocol-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M 0 0 L 9 4.5 L 0 9 z" fill="#667085" />
          </marker>
          <marker id="protocol-arrow-warn" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M 0 0 L 9 4.5 L 0 9 z" fill="#a16207" />
          </marker>
        </defs>
        ${edgeMarkup}
        ${nodeMarkup}
        <text x="306" y="232" font-size="12" fill="#a16207">If evidence fails, amend or repair the plan before another execution pass.</text>
      </svg>
    </div>`;
}

function renderIndexPriorityScan(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="priority-scan"><div class="priority-card"><strong>No priority scan items</strong><span class="subtle">Run the dashboard after task plans have ready work, connected workstreams, or map-confidence gaps.</span></div></div>';
  }

  return `<div class="priority-scan">
      ${items.slice(0, 6).map((item) => {
        const href = item.href || (item.task_id ? `plan-visibility__current.html#plan=${encodeURIComponent(item.task_id)}` : 'plan-visibility__current.html');
        const status = item.status || 'not-recorded';
        const task = item.task_id || 'not-recorded';
        const command = item.next_command || 'none';
        const source = item.source ? `<div class="subtle">source: ${escapeHtml(item.source)}</div>` : '';
        return `<a class="priority-card" href="${escapeHtml(href)}">
          <strong>${escapeHtml(item.label || item.kind || 'Priority item')}</strong>
          <div>${escapeHtml(task)} · ${escapeHtml(status)}</div>
          <div class="subtle">${escapeHtml(item.reason || 'No reason recorded.')}</div>
          ${source}
          <code>${escapeHtml(command)}</code>
        </a>`;
      }).join('\n      ')}
    </div>`;
}

function renderIndexOperatorQuestionRoutes(routes) {
  if (!Array.isArray(routes) || routes.length === 0) {
    return '<div class="route"><strong>No question routes</strong><span class="subtle">No operator question routes were generated for this model.</span></div>';
  }

  return routes.slice(0, 8).map((route) => `<a class="route" href="${escapeHtml(route.href || 'plan-visibility__index.html')}">
          <strong>${escapeHtml(route.question || 'Operator question')}</strong>
          <span class="subtle">${escapeHtml(route.answer || 'No answer recorded.')}</span>
          <div class="path-line">${escapeHtml(route.count_label || 'not-recorded')} · ${escapeHtml(route.evidence || 'No evidence recorded.')}</div>
          <code>${escapeHtml(route.command || 'not-recorded')}</code>
        </a>`).join('\n      ');
}

function renderIndexMapReadingGuide(guide) {
  const items = guide?.items || [];
  if (!items.length) {
    return '<div class="route"><strong>No map guide</strong><span class="subtle">No map-reading guide was generated for this model.</span></div>';
  }

  return items.slice(0, 8).map((item) => `<div class="route">
          <strong>${escapeHtml(item.term || 'Map term')}</strong>
          <span class="subtle">${escapeHtml(item.meaning || 'No meaning recorded.')}</span>
          <div class="path-line">${escapeHtml(item.use || 'No use guidance recorded.')}</div>
          <div class="subtle">Trust boundary: ${escapeHtml(item.trust_boundary || 'Use source task plans as authority.')}</div>
        </div>`).join('\n      ');
}

function renderIndexProtocolReadiness(protocolReadiness) {
  if (!protocolReadiness) {
    return '<div class="route-map"><div class="route"><strong>No protocol readiness model</strong><span class="subtle">No protocol readiness data was generated for this model.</span></div></div>';
  }

  const totals = protocolReadiness.totals || {};
  const rows = protocolReadiness.rows || [];
  const checks = protocolReadiness.checks || [];
  const topMissing = checks
    .filter((check) => check.missing_count > 0)
    .sort((a, b) => b.missing_count - a.missing_count || a.label.localeCompare(b.label))
    .slice(0, 3);
  const repairRows = rows
    .filter((row) => row.protocol_state === 'needs_protocol_repair')
    .slice(0, 6);

  return `<div class="route-map">
      <div class="route">
        <strong>Protocol-ready plans</strong>
        <span class="count">${Number(totals.protocol_ready || 0)} / ${Number(totals.visible_plans || 0)}</span>
        <div class="subtle">${escapeHtml(protocolReadiness.summary || 'Protocol readiness summary unavailable.')}</div>
      </div>
      ${topMissing.map((check) => `<div class="route">
        <strong>${escapeHtml(check.label)}</strong>
        <span class="count">${Number(check.missing_count || 0)} missing</span>
        <div class="subtle">${escapeHtml(check.repair || 'Repair guidance unavailable.')}</div>
        <div class="path-line">${escapeHtml((check.sample || []).join(', ') || 'No sample recorded.')}</div>
      </div>`).join('\n      ')}
      ${repairRows.map((row) => `<a class="route" href="${escapeHtml(row.dashboard_href || 'plan-visibility__current.html')}">
        <strong>${escapeHtml(row.task_id)}</strong>
        <span class="subtle">${escapeHtml(row.reason || 'Protocol repair needed.')}</span>
        <div class="path-line">${escapeHtml((row.missing_fields || []).join(', ') || 'none')}</div>
        <code>${escapeHtml(row.recommended_command || 'not-recorded')}</code>
      </a>`).join('\n      ')}
    </div>`;
}

function renderIndexSectionNavigator(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  return `<div class="section-nav">
      ${sections.map((section) => `<a href="#${escapeHtml(section.id)}"><strong>${escapeHtml(section.label)}</strong><span class="subtle">${escapeHtml(section.purpose)}</span></a>`).join('\n      ')}
    </div>`;
}

function renderIndexReviewLaneRouting(grouping) {
  const entries = Object.entries(grouping || {})
    .map(([label, count]) => ({ label: label || 'not-recorded', count: Number(count) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => reviewLanePriority(a.label) - reviewLanePriority(b.label) || b.count - a.count || a.label.localeCompare(b.label));
  if (!entries.length) {
    return '<div class="review-routing"><div class="review-route"><strong>No review lanes recorded</strong><span class="subtle">Add routing_expectations.review_lane to task plans so validation ownership is visible.</span></div></div>';
  }
  return `<div class="review-routing">
      ${entries.map((entry) => {
        const href = reviewLaneHref(entry.label);
        return `<a class="review-route" href="${escapeHtml(href)}">
          <strong>${escapeHtml(reviewLaneLabel(entry.label))}</strong>
          <span class="count">${entry.count} plans</span>
          <span class="subtle">${escapeHtml(reviewLanePurpose(entry.label))}</span>
        </a>`;
      }).join('\n      ')}
    </div>`;
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
  if (normalized === 'not-recorded' || normalized === 'unknown') return 'plan-visibility__current.html#quality=missing_review_lane';
  return `plan-visibility__current.html#review=${encodeURIComponent(normalized)}`;
}

function renderIndexWorkstreamOverview(workstreams) {
  if (!Array.isArray(workstreams) || workstreams.length === 0) {
    return '<div class="workstream-overview"><span class="subtle">No connected workstreams detected yet.</span></div>';
  }
  const visible = workstreams.slice(0, 8);
  const maxSize = Math.max(1, ...visible.map((cluster) => Number(cluster.size) || 0));
  const positions = [
    [120, 95],
    [320, 95],
    [520, 95],
    [720, 95],
    [120, 245],
    [320, 245],
    [520, 245],
    [720, 245]
  ];
  const nodes = visible.map((cluster, index) => {
    const [x, y] = positions[index];
    const size = Number(cluster.size) || 0;
    const links = Number(cluster.relationships) || 0;
    const radius = 26 + Math.round((Math.sqrt(size) / Math.sqrt(maxSize)) * 34);
    const href = `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}${cluster.next_plan?.task_id && cluster.next_plan.task_id !== 'none' ? `&plan=${encodeURIComponent(cluster.next_plan.task_id)}` : ''}`;
    const label = truncateSvgLabel(cluster.label || cluster.id, 24);
    const detail = `${size} plans · ${links} links`;
    const next = cluster.next_plan?.task_id && cluster.next_plan.task_id !== 'none'
      ? `next: ${cluster.next_plan.task_id}`
      : 'next: none recorded';
    return `<a href="${escapeHtml(href)}">
          <g>
            <circle cx="${x}" cy="${y}" r="${radius}" fill="#eff6ff" stroke="#2563eb" stroke-width="2" />
            <text x="${x}" y="${y - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#1f2937">${escapeHtml(label)}</text>
            <text x="${x}" y="${y + 12}" text-anchor="middle" font-size="12" fill="#667085">${escapeHtml(detail)}</text>
            <text x="${x}" y="${y + radius + 22}" text-anchor="middle" font-size="11" fill="#667085">${escapeHtml(truncateSvgLabel(next, 28))}</text>
          </g>
        </a>`;
  }).join('\n        ');
  return `<div class="workstream-overview" role="img" aria-label="Top connected workstreams sized by plan count">
      <svg viewBox="0 0 900 330" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="28" font-size="13" fill="#667085">Top connected workstreams; larger circles contain more task plans. Click a circle to open its focused map.</text>
        ${nodes}
      </svg>
    </div>`;
}

function renderIndexLargestWorkstreamBreakdown(workstreams, workstreamMatrix, hubs) {
  const largest = Array.isArray(workstreams) ? workstreams[0] : null;
  if (!largest) {
    return '<div class="workstream-breakdown"><span class="subtle">No largest workstream is available yet.</span></div>';
  }
  const matrix = (workstreamMatrix || []).find((row) => row.cluster_id === largest.id) || {};
  const clusterHubs = (hubs || []).filter((hub) => hub.cluster_id === largest.id).slice(0, 3);
  const statusRows = topEntries(largest.statuses || {}, 5);
  const intentRows = matrix.top_intents || [];
  const maxStatus = Math.max(1, ...statusRows.map((row) => Number(row.count) || 0));
  const maxIntent = Math.max(1, ...intentRows.map((row) => Number(row.count) || 0));
  const href = `plan-visibility__current.html#cluster=${encodeURIComponent(largest.id)}${largest.next_plan?.task_id && largest.next_plan.task_id !== 'none' ? `&plan=${encodeURIComponent(largest.next_plan.task_id)}` : ''}`;
  const statusBars = statusRows.map((row, index) => {
    const y = 98 + index * 34;
    const width = Math.max(18, Math.round(((Number(row.count) || 0) / maxStatus) * 230));
    return `<g>
          <text x="38" y="${y + 15}" font-size="12" font-weight="700" fill="#1f2937">${escapeHtml(row.label)}</text>
          <rect x="130" y="${y}" width="${width}" height="20" rx="4" fill="${statusOverviewColor(row.label)}" />
          <text x="${140 + width}" y="${y + 15}" font-size="11" fill="#667085">${Number(row.count) || 0}</text>
        </g>`;
  }).join('\n        ');
  const intentBars = intentRows.slice(0, 5).map((row, index) => {
    const y = 98 + index * 34;
    const width = Math.max(18, Math.round(((Number(row.count) || 0) / maxIntent) * 230));
    return `<g>
          <text x="360" y="${y + 15}" font-size="12" font-weight="700" fill="#1f2937">${escapeHtml(row.label)}</text>
          <rect x="462" y="${y}" width="${width}" height="20" rx="4" fill="${colorForIntentOverview(row.label)}" />
          <text x="${472 + width}" y="${y + 15}" font-size="11" fill="#667085">${Number(row.count) || 0}</text>
        </g>`;
  }).join('\n        ');
  const hubText = clusterHubs.length
    ? clusterHubs.map((hub, index) => `<text x="690" y="${112 + index * 24}" font-size="11" fill="#475467">${escapeHtml(truncateSvgLabel(`${hub.task_id} · ${hub.role} · ${hub.total} links`, 32))}</text>`).join('\n        ')
    : '<text x="690" y="112" font-size="11" fill="#667085">No top bridge plans in this workstream.</text>';
  const next = largest.next_plan || {};
  return `<div class="workstream-breakdown" role="img" aria-label="Largest workstream breakdown by status, intent, and bridge plans">
      <svg viewBox="0 0 900 310" xmlns="http://www.w3.org/2000/svg">
        <a href="${escapeHtml(href)}">
          <rect x="24" y="42" width="852" height="38" rx="8" fill="#eff6ff" stroke="#2563eb" />
          <text x="38" y="66" font-size="14" font-weight="800" fill="#1f2937">${escapeHtml(largest.label || largest.id)} · ${Number(largest.size) || 0} plans · ${Number(largest.relationships) || 0} links</text>
          <text x="690" y="66" font-size="12" fill="#2563eb">Open focused map</text>
        </a>
        <text x="38" y="92" font-size="12" font-weight="800" fill="#475467">Status mix</text>
        ${statusBars}
        <text x="360" y="92" font-size="12" font-weight="800" fill="#475467">Top intents</text>
        ${intentBars || '<text x="360" y="112" font-size="11" fill="#667085">No intent data.</text>'}
        <text x="690" y="92" font-size="12" font-weight="800" fill="#475467">Bridge plans</text>
        ${hubText}
        <text x="38" y="286" font-size="12" fill="#667085">Suggested next: ${escapeHtml(next.task_id || 'none')} (${escapeHtml(next.status || 'not-recorded')}) · ${escapeHtml(truncateSvgLabel(next.reason || 'No reason recorded.', 80))}</text>
      </svg>
    </div>`;
}

function renderIndexSubtaskHierarchySpotlight(relationships) {
  const hierarchy = (relationships || []).filter((relationship) => relationship.intent === 'hierarchy');
  if (!hierarchy.length) {
    return '<div class="hierarchy-spotlight"><div class="hierarchy-card"><strong>No hierarchy links</strong><span class="subtle">No parent, child, or subtask-style hierarchy relationships were detected in the current model.</span></div></div>';
  }

  const byParent = new Map();
  for (const relationship of hierarchy) {
    const rows = byParent.get(relationship.target) || [];
    rows.push(relationship);
    byParent.set(relationship.target, rows);
  }

  const cards = [...byParent.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([parent, rows]) => {
      const children = rows.slice(0, 4).map((relationship) => `${relationship.source} (${relationship.confidence || 'not-recorded'})`).join(' + ');
      const strongest = rows.slice().sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence))[0] || {};
      const href = `plan-visibility__current.html#plan=${encodeURIComponent(parent)}&intent=hierarchy`;
      return `<a class="hierarchy-card" href="${escapeHtml(href)}">
        <strong>${escapeHtml(parent)}</strong>
        <div class="subtle">${rows.length} child/subtask relationship${rows.length === 1 ? '' : 's'} · strongest confidence ${escapeHtml(strongest.confidence || 'not-recorded')}</div>
        <div class="child-line">children: ${escapeHtml(children || 'none')}</div>
        <p class="subtle">${escapeHtml(truncateSvgLabel(strongest.evidence || 'No evidence snippet recorded.', 150))}</p>
      </a>`;
    }).join('\n      ');

  return `<div class="hierarchy-spotlight">
      ${cards}
    </div>`;
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 0;
  if (confidence === 'medium') return 1;
  if (confidence === 'derived') return 2;
  return 9;
}

function renderIndexConnectionEvidenceSpotlight(relationships) {
  if (!Array.isArray(relationships) || relationships.length === 0) {
    return '<div class="evidence-spotlight"><div class="evidence-card"><strong>No relationship evidence</strong><span class="subtle">No source-to-target relationship evidence is available in the current model.</span></div></div>';
  }

  const rank = { high: 0, medium: 1, derived: 2 };
  const intentRank = { dependency: 0, sequence: 1, review: 2, hierarchy: 3, coordination: 4, implementation: 5, mention: 6 };
  const cards = relationships
    .slice()
    .sort((a, b) => (
      (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9)
      || (intentRank[a.intent] ?? 9) - (intentRank[b.intent] ?? 9)
      || String(a.source || '').localeCompare(String(b.source || ''))
      || String(a.target || '').localeCompare(String(b.target || ''))
    ))
    .slice(0, 6)
    .map((relationship) => {
      const href = `plan-visibility__current.html#from=${encodeURIComponent(relationship.source)}&to=${encodeURIComponent(relationship.target)}`;
      const route = `${relationship.source} -> ${relationship.target}`;
      return `<a class="evidence-card" href="${escapeHtml(href)}">
        <strong>${escapeHtml(route)}</strong>
        <div class="subtle">${escapeHtml(relationship.intent || 'not-recorded')} · ${escapeHtml(relationship.type || 'not-recorded')} · ${escapeHtml(relationship.confidence || 'not-recorded')}</div>
        <p>${escapeHtml(truncateSvgLabel(relationship.evidence || 'No evidence snippet recorded.', 150))}</p>
        <div class="subtle">${escapeHtml(relationship.confidence_reason || 'No confidence rationale recorded.')}</div>
      </a>`;
    }).join('\n      ');

  return `<div class="evidence-spotlight">
      ${cards}
    </div>`;
}

function renderIndexInterconnectionPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return '<div class="interconnection-paths"><div class="interconnection-path"><strong>No action paths</strong><span class="subtle">No dependency, sequence, review, or hierarchy paths were detected in the current model.</span></div></div>';
  }

  const cards = paths.slice(0, 6).map((item) => {
    const href = `plan-visibility__current.html#cluster=${encodeURIComponent(item.cluster_id || 'none')}&plan=${encodeURIComponent(item.task_id)}`;
    const upstream = (item.upstream || []).slice(0, 2).map((relationship) => `${relationship.plan} (${relationship.intent})`).join(' + ') || 'no upstream';
    const downstream = (item.downstream || []).slice(0, 2).map((relationship) => `${relationship.plan} (${relationship.intent})`).join(' + ') || 'no downstream';
    const nextStep = item.next_step?.step_id && item.next_step.step_id !== 'none'
      ? `${item.next_step.step_id}: ${item.next_step.description || 'No description recorded.'}`
      : item.next_step?.description || 'No next step recorded.';
    return `<a class="interconnection-path" href="${escapeHtml(href)}">
        <strong>${escapeHtml(item.task_id)}</strong>
        <div class="subtle">${escapeHtml(item.status || 'not-recorded')} · ${escapeHtml(item.cluster_label || 'not linked')} · ${Number(item.upstream_count) || 0} upstream / ${Number(item.downstream_count) || 0} downstream</div>
        <div class="path-line">feeds from: ${escapeHtml(upstream)}</div>
        <div class="path-line">feeds into: ${escapeHtml(downstream)}</div>
        <code>${escapeHtml(item.next_command || 'not-recorded')}</code>
        <div class="subtle">${escapeHtml(truncateSvgLabel(nextStep, 120))}</div>
      </a>`;
  }).join('\n      ');

  return `<div class="interconnection-paths">
      ${cards}
    </div>`;
}

function renderIndexDependencySequenceChains(chains) {
  if (!Array.isArray(chains) || chains.length === 0) {
    return '<div class="dependency-chains"><div class="dependency-chain"><strong>No dependency chains</strong><span class="subtle">No multi-hop dependency or sequence chains were detected in the current model.</span></div></div>';
  }

  const cards = chains.slice(0, 6).map((chain) => {
    const href = chain.dashboard_href || `plan-visibility__current.html#from=${encodeURIComponent(chain.start_task_id || '')}&to=${encodeURIComponent(chain.end_task_id || '')}`;
    const intents = (chain.intents || []).join(', ') || 'not-recorded';
    const nextStep = chain.next_step?.step_id && chain.next_step.step_id !== 'none'
      ? `${chain.next_step.step_id}: ${chain.next_step.description || 'No description recorded.'}`
      : chain.next_step?.description || 'No next step recorded.';
    return `<a class="dependency-chain" href="${escapeHtml(href)}">
        <strong>${escapeHtml(chain.summary || `${chain.start_task_id || 'unknown'} -> ${chain.end_task_id || 'unknown'}`)}</strong>
        <div class="subtle">${Number(chain.hops) || 0} hops · ${escapeHtml(intents)} · ${escapeHtml(chain.cluster_label || 'not linked')}</div>
        <div class="path-line">next: ${escapeHtml(chain.next_task_id || 'none')}</div>
        <code>${escapeHtml(chain.next_command || 'not-recorded')}</code>
        <div class="subtle">${escapeHtml(truncateSvgLabel(nextStep, 120))}</div>
      </a>`;
  }).join('\n      ');

  return `<div class="dependency-chains">
      ${cards}
    </div>`;
}

function renderIndexBridgePlanOverview(hubs) {
  if (!Array.isArray(hubs) || hubs.length === 0) {
    return '<div class="bridge-overview"><span class="subtle">No bridge plans detected yet.</span></div>';
  }
  const visible = hubs.slice(0, 8);
  const maxLinks = Math.max(1, ...visible.map((hub) => Number(hub.total) || 0));
  const positions = [
    [105, 96],
    [300, 96],
    [495, 96],
    [690, 96],
    [105, 248],
    [300, 248],
    [495, 248],
    [690, 248]
  ];
  const nodes = visible.map((hub, index) => {
    const [x, y] = positions[index];
    const total = Number(hub.total) || 0;
    const incoming = Number(hub.incoming) || 0;
    const outgoing = Number(hub.outgoing) || 0;
    const radius = 24 + Math.round((Math.sqrt(total) / Math.sqrt(maxLinks)) * 32);
    const href = `plan-visibility__current.html#plan=${encodeURIComponent(hub.task_id)}`;
    const label = truncateSvgLabel(hub.task_id, 24);
    const detail = `${total} links · ${incoming} in / ${outgoing} out`;
    const role = `${hub.role || 'hub'} · ${hub.top_intent || 'unknown'}`;
    return `<a href="${escapeHtml(href)}">
          <g>
            <circle cx="${x}" cy="${y}" r="${radius}" fill="#f5f3ff" stroke="#7c3aed" stroke-width="2" />
            <text x="${x}" y="${y - 10}" text-anchor="middle" font-size="13" font-weight="700" fill="#1f2937">${escapeHtml(label)}</text>
            <text x="${x}" y="${y + 10}" text-anchor="middle" font-size="12" fill="#667085">${escapeHtml(detail)}</text>
            <text x="${x}" y="${y + radius + 22}" text-anchor="middle" font-size="11" fill="#667085">${escapeHtml(truncateSvgLabel(role, 28))}</text>
          </g>
        </a>`;
  }).join('\n        ');
  return `<div class="bridge-overview" role="img" aria-label="Highly connected bridge plans sized by relationship count">
      <svg viewBox="0 0 900 335" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="28" font-size="13" fill="#667085">Highly connected bridge plans; larger circles have more incoming and outgoing relationships. Click a circle to inspect the plan.</text>
        ${nodes}
      </svg>
    </div>`;
}

function renderIndexRelationshipIntentOverview(intents) {
  if (!Array.isArray(intents) || intents.length === 0) {
    return '<div class="intent-overview"><span class="subtle">No relationship intent data detected yet.</span></div>';
  }
  const visible = intents.slice(0, 8);
  const maxCount = Math.max(1, ...visible.map((entry) => Number(entry.count) || 0));
  const rows = visible.map((entry, index) => {
    const y = 58 + index * 36;
    const count = Number(entry.count) || 0;
    const label = String(entry.label || 'not-recorded');
    const width = Math.max(18, Math.round((count / maxCount) * 520));
    const href = `plan-visibility__current.html#intent=${encodeURIComponent(label)}`;
    const color = colorForIntentOverview(label);
    return `<a href="${escapeHtml(href)}">
          <g>
            <text x="28" y="${y + 16}" font-size="13" font-weight="700" fill="#1f2937">${escapeHtml(label)}</text>
            <rect x="172" y="${y}" width="${width}" height="22" rx="4" fill="${color}" />
            <text x="${182 + width}" y="${y + 16}" font-size="12" fill="#667085">${count} links</text>
          </g>
        </a>`;
  }).join('\n        ');
  const height = Math.max(120, 76 + visible.length * 36);
  return `<div class="intent-overview" role="img" aria-label="Relationship type overview sorted by link count">
      <svg viewBox="0 0 900 ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="28" font-size="13" fill="#667085">Relationship types detected in the plan map. Click a bar to open the matching relationship-intent filter.</text>
        ${rows}
      </svg>
    </div>`;
}

function renderIndexRelationshipConfidenceOverview(confidence) {
  const entries = Object.entries(confidence || {})
    .map(([label, count]) => ({ label, count: Number(count) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => confidencePriority(a.label) - confidencePriority(b.label) || b.count - a.count);
  if (!entries.length) {
    return '<div class="intent-overview"><span class="subtle">No relationship confidence data detected yet.</span></div>';
  }
  const maxCount = Math.max(1, ...entries.map((entry) => entry.count));
  const rows = entries.map((entry, index) => {
    const y = 58 + index * 42;
    const width = Math.max(18, Math.round((entry.count / maxCount) * 520));
    const href = `plan-visibility__current.html#confidence=${encodeURIComponent(entry.label)}`;
    const color = colorForConfidence(entry.label);
    const note = confidenceNote(entry.label);
    return `<a href="${escapeHtml(href)}">
          <g>
            <text x="28" y="${y + 16}" font-size="13" font-weight="700" fill="#1f2937">${escapeHtml(entry.label)}</text>
            <rect x="172" y="${y}" width="${width}" height="22" rx="4" fill="${color}" />
            <text x="${182 + width}" y="${y + 16}" font-size="12" fill="#667085">${entry.count} links · ${escapeHtml(note)}</text>
          </g>
        </a>`;
  }).join('\n        ');
  const height = 78 + entries.length * 42;
  return `<div class="intent-overview" role="img" aria-label="Relationship confidence distribution with filtered links">
      <svg viewBox="0 0 900 ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="28" font-size="13" fill="#667085">Confidence labels distinguish declared metadata links from derived task-id mention links. Click a bar to inspect those edges.</text>
        ${rows}
      </svg>
    </div>`;
}

function confidencePriority(label) {
  const order = { high: 0, medium: 1, derived: 2, unknown: 3 };
  return order[label] ?? 9;
}

function colorForConfidence(label) {
  if (label === 'high') return '#15803d';
  if (label === 'medium') return '#a16207';
  if (label === 'derived') return '#64748b';
  return '#98a2b3';
}

function confidenceNote(label) {
  if (label === 'high') return 'declared metadata';
  if (label === 'medium') return 'declared related metadata';
  if (label === 'derived') return 'task-id mention';
  return 'not classified';
}

function renderIndexStatusOverview(buckets) {
  const statuses = ['ready', 'in_progress', 'needs_review', 'blocked', 'planned', 'complete', 'unreadable']
    .map((status) => ({ status, count: Number(buckets?.[status]) || 0 }))
    .filter((entry) => entry.count > 0);
  if (statuses.length === 0) {
    return '<div class="status-overview"><span class="subtle">No status bucket data detected yet.</span></div>';
  }
  const maxCount = Math.max(1, ...statuses.map((entry) => entry.count));
  const rows = statuses.map((entry, index) => {
    const y = 58 + index * 36;
    const width = Math.max(18, Math.round((entry.count / maxCount) * 520));
    const href = `plan-visibility__current.html#status=${encodeURIComponent(entry.status)}`;
    const label = entry.status.replace(/_/g, ' ');
    return `<a href="${escapeHtml(href)}">
          <g>
            <text x="28" y="${y + 16}" font-size="13" font-weight="700" fill="#1f2937">${escapeHtml(label)}</text>
            <rect x="172" y="${y}" width="${width}" height="22" rx="4" fill="${statusOverviewColor(entry.status)}" />
            <text x="${182 + width}" y="${y + 16}" font-size="12" fill="#667085">${entry.count} plans</text>
          </g>
        </a>`;
  }).join('\n        ');
  const height = Math.max(120, 76 + statuses.length * 36);
  return `<div class="status-overview" role="img" aria-label="Plan status overview sorted by operational order">
      <svg viewBox="0 0 900 ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="28" font-size="13" fill="#667085">Plan status buckets. Click a bar to open the matching status filter.</text>
        ${rows}
      </svg>
    </div>`;
}

function renderIndexMapQualityOverview(dataQuality) {
  const entries = Object.entries(dataQuality || {})
    .map(([signal, value]) => ({ signal, count: Number(value?.count) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal))
    .slice(0, 8);
  if (entries.length === 0) {
    return '<div class="quality-overview"><span class="subtle">No map-quality gaps detected yet.</span></div>';
  }
  const maxCount = Math.max(1, ...entries.map((entry) => entry.count));
  const rows = entries.map((entry, index) => {
    const y = 58 + index * 36;
    const width = Math.max(18, Math.round((entry.count / maxCount) * 520));
    const href = `plan-visibility__current.html#quality=${encodeURIComponent(entry.signal)}`;
    const label = entry.signal.replace(/_/g, ' ');
    return `<a href="${escapeHtml(href)}">
          <g>
            <text x="28" y="${y + 16}" font-size="13" font-weight="700" fill="#1f2937">${escapeHtml(label)}</text>
            <rect x="212" y="${y}" width="${width}" height="22" rx="4" fill="${qualityOverviewColor(entry.signal)}" />
            <text x="${222 + width}" y="${y + 16}" font-size="12" fill="#667085">${entry.count} plans</text>
          </g>
        </a>`;
  }).join('\n        ');
  const height = Math.max(120, 76 + entries.length * 36);
  return `<div class="quality-overview" role="img" aria-label="Plan map quality gaps sorted by affected plan count">
      <svg viewBox="0 0 900 ${height}" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="28" font-size="13" fill="#667085">Map-quality gaps that reduce confidence in the plan graph. Click a bar to open the matching quality filter.</text>
        ${rows}
      </svg>
    </div>`;
}

function qualityOverviewColor(signal) {
  if (signal === 'unlinked') return '#b91c1c';
  if (signal === 'missing_review_lane') return '#7c3aed';
  if (signal === 'missing_risk_tier') return '#a16207';
  if (signal === 'no_bounded_steps') return '#0369a1';
  if (signal === 'high_risk_ready') return '#dc2626';
  return '#98a2b3';
}

function statusOverviewColor(status) {
  if (status === 'ready') return '#0f766e';
  if (status === 'in_progress') return '#0369a1';
  if (status === 'needs_review') return '#7c3aed';
  if (status === 'blocked') return '#b91c1c';
  if (status === 'planned') return '#667085';
  if (status === 'complete') return '#166534';
  return '#98a2b3';
}

function colorForIntentOverview(intent) {
  if (intent === 'dependency') return '#b91c1c';
  if (intent === 'sequence') return '#2563eb';
  if (intent === 'review') return '#7c3aed';
  if (intent === 'hierarchy') return '#0f766e';
  if (intent === 'implementation') return '#166534';
  if (intent === 'coordination') return '#0369a1';
  if (intent === 'lifecycle') return '#a16207';
  if (intent === 'mention') return '#475467';
  return '#98a2b3';
}

function truncateSvgLabel(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildPlanVisibilityIndexQuickViews(model) {
  const base = 'plan-visibility__current.html';
  const largestCluster = model?.relationship_clusters?.[0];
  const suggested = largestCluster?.next_plan;
  const views = [
    {
      label: 'Ready Plans',
      href: `${base}#status=ready`,
      description: 'Open the system map filtered to plans classified as ready.'
    },
    {
      label: 'Dependency Links',
      href: `${base}#intent=dependency`,
      description: 'Open plans connected by dependency-intent relationships.'
    },
    {
      label: 'Unlinked Plans',
      href: `${base}#quality=unlinked`,
      description: 'Open plans with no detected relationships so isolated work is visible.'
    },
    {
      label: 'Data Quality Gaps',
      href: `${base}#quality=missing_review_lane`,
      description: 'Open plans missing review-lane metadata; use quality filters for other map-confidence gaps.'
    }
  ];

  if (largestCluster) {
    views.push({
      label: 'Largest Cluster',
      href: `${base}#cluster=${encodeURIComponent(largestCluster.id)}`,
      description: `${largestCluster.label || largestCluster.id}: ${largestCluster.size} plans and ${largestCluster.relationships} links.`
    });
  }

  if (largestCluster && suggested?.task_id && suggested.task_id !== 'none') {
    views.push({
      label: 'Suggested Next In Largest Cluster',
      href: `${base}#cluster=${encodeURIComponent(largestCluster.id)}&plan=${encodeURIComponent(suggested.task_id)}`,
      description: `${largestCluster.label || largestCluster.id}: ${suggested.task_id} (${suggested.status}) · ${suggested.reason}.`
    });
  }

  return views;
}

function renderIndexWorkstreamRoutes(workstreams) {
  if (!Array.isArray(workstreams) || workstreams.length === 0) {
    return '<div class="workstream"><strong>No relationship clusters detected</strong><span class="subtle">Run the dashboard again after task plans have explicit or derived relationships.</span></div>';
  }

  return workstreams.map((cluster) => {
    const next = cluster.next_plan || {};
    const focusHref = `plan-visibility__current.html#cluster=${encodeURIComponent(cluster.id)}${next.task_id && next.task_id !== 'none' ? `&plan=${encodeURIComponent(next.task_id)}` : ''}`;
    const briefHref = `visual-plans/${encodeURIComponent(cluster.id)}.md`;
    const suggested = next.task_id && next.task_id !== 'none'
      ? `${next.task_id} (${next.status || 'not-recorded'})`
      : 'No suggested next plan';
    return `<div class="workstream">
        <strong>${escapeHtml(cluster.label || cluster.id)}</strong>
        <div class="subtle">${escapeHtml(cluster.id)} · ${Number(cluster.size) || 0} plans · ${Number(cluster.relationships) || 0} links</div>
        <div>Suggested next: ${escapeHtml(suggested)}</div>
        <div class="subtle">${escapeHtml(cluster.label_reason || 'No label reason recorded.')}</div>
        <div class="workstream-actions"><a href="${escapeHtml(focusHref)}">Open map</a><a href="${escapeHtml(briefHref)}">Open brief</a></div>
      </div>`;
  }).join('\n      ');
}

function renderIndexGraphHealth(graphHealth) {
  if (!graphHealth) {
    return '<div class="route"><strong>No graph health data</strong><span class="subtle">Run npm run plans:dashboard to rebuild the model.</span></div>';
  }

  const items = [
    ['Coverage', `${graphHealth.coverage_percent}%`, `${graphHealth.linked_plans} linked plans; ${graphHealth.unlinked_plans} unlinked.`],
    ['Link density', graphHealth.links_per_plan, 'Detected relationships per visible plan.'],
    ['Top intents', formatEntryList(graphHealth.top_intents), 'Most common relationship purposes.'],
    ['Weakest areas', formatWeakestAreas(graphHealth.weakest_areas), 'Highest-count confidence gaps.']
  ];

  return items.map(([label, value, detail]) => `<div class="route"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span><div class="subtle">${escapeHtml(detail)}</div></div>`).join('\n      ');
}

function renderIndexConfidenceActions(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return '<div class="route"><strong>No map-confidence actions</strong><span class="subtle">No current graph-health recommendations.</span></div>';
  }

  return recommendations.slice(0, 4).map((item) => `<div class="route">
        <strong>${escapeHtml(item.signal)}</strong>
        <span>${escapeHtml(`${item.count} plans · ${item.percent}%`)}</span>
        <div class="subtle">${escapeHtml(item.action)}</div>
        <a href="${escapeHtml(item.dashboard_href)}">Open filtered view</a>
      </div>`).join('\n      ');
}

function renderIndexRemediationQueue(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<div class="route"><strong>No remediation queue</strong><span class="subtle">No map-confidence remediation rows detected.</span></div>';
  }

  return rows.slice(0, 4).map((row) => `<div class="route">
        <strong>${escapeHtml(row.task_id)}</strong>
        <span>${escapeHtml(row.signal)} · ${escapeHtml(row.status)}</span>
        <div class="subtle">${escapeHtml(row.recommended_fix)}</div>
        <div class="workstream-actions"><a href="${escapeHtml(row.dashboard_href)}">Open filter</a><a href="${escapeHtml(indexSourceHref(row.source))}">Open source</a></div>
      </div>`).join('\n      ');
}

function renderIndexPlanActionBoard(actionBoard) {
  const lanes = actionBoard?.lanes || [];
  if (!lanes.length) {
    return `<div class="route"><strong>No action board</strong><span class="subtle">${escapeHtml(actionBoard?.summary || 'No action lanes are available.')}</span></div>`;
  }

  return lanes.map((lane) => {
    const first = (lane.rows || [])[0];
    const links = first
      ? `<div class="workstream-actions"><a href="${escapeHtml(first.dashboard_href)}">Open first</a><a href="${escapeHtml(indexSourceHref(first.source))}">Open source</a></div>`
      : '';
    const command = first?.next_command ? `<code>${escapeHtml(first.next_command)}</code>` : '';
    return `<div class="route">
        <strong>${escapeHtml(lane.label)}</strong>
        <span>${escapeHtml(lane.summary || '')}</span>
        <div class="subtle">${escapeHtml(first ? `${first.task_id}: ${first.reason}` : 'No plans in this lane.')}</div>
        ${command}
        ${links}
      </div>`;
  }).join('\n      ');
}

function renderIndexExecutionReadiness(executionReadiness) {
  const lanes = executionReadiness?.lanes || [];
  if (!lanes.length) {
    return `<div class="route"><strong>No execution readiness</strong><span class="subtle">${escapeHtml(executionReadiness?.summary || 'No execution-readiness lanes are available.')}</span></div>`;
  }

  return lanes.map((lane) => {
    const first = (lane.rows || [])[0];
    const missing = first?.missing_protocol_fields?.length
      ? `<div class="path-line">${escapeHtml(first.missing_protocol_fields.join(', '))}</div>`
      : '';
    const links = first
      ? `<div class="workstream-actions"><a href="${escapeHtml(first.dashboard_href)}">Open first</a><a href="${escapeHtml(indexSourceHref(first.source))}">Open source</a></div>`
      : '';
    const command = first?.recommended_command ? `<code>${escapeHtml(first.recommended_command)}</code>` : '';
    return `<div class="route">
        <strong>${escapeHtml(lane.label)}</strong>
        <span>${escapeHtml(lane.summary || '')}</span>
        <div class="subtle">${escapeHtml(first ? `${first.task_id}: ${first.reason}` : 'No plans in this lane.')}</div>
        ${missing}
        ${command}
        ${links}
      </div>`;
  }).join('\n      ');
}

function renderIndexRoutingBlockers(routingBlockers) {
  if (!routingBlockers) {
    return '<div class="route"><strong>No routing blockers</strong><span class="subtle">No routing-blocker summary was generated.</span></div>';
  }

  const blockers = routingBlockers.blockers || [];
  const summaryCard = `<div class="route">
        <strong>Routeability</strong>
        <span>${Number(routingBlockers.ready_to_route || 0)} ready to route · ${Number(routingBlockers.blocker_total || 0)} blocker rows</span>
        <div class="subtle">${escapeHtml(routingBlockers.summary || 'No routing-blocker summary recorded.')}</div>
      </div>`;
  const blockerCards = blockers.map((item) => `<a class="route" href="${escapeHtml(item.href || 'plan-visibility__index.html#execution-readiness')}">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${Number(item.count || 0)} rows · first: ${escapeHtml(item.first_task_id || 'none')}</span>
        <div class="subtle">${escapeHtml(item.reason || 'No blocker reason recorded.')}</div>
        <code>${escapeHtml(item.command || 'none')}</code>
      </a>`).join('\n      ');
  return `${summaryCard}\n      ${blockerCards}`;
}

function renderIndexFirstRepairPath(firstRepairPath) {
  if (!firstRepairPath) {
    return '<div class="route"><strong>No first repair path</strong><span class="subtle">No first-repair-path summary was generated.</span></div>';
  }

  const steps = firstRepairPath.steps || [];
  const summaryCard = `<div class="route">
        <strong>Recommended first step</strong>
        <span>${escapeHtml(firstRepairPath.recommended_first_step?.label || 'No current step')}</span>
        <div class="subtle">${escapeHtml(firstRepairPath.summary || 'No first repair path summary recorded.')}</div>
      </div>`;
  const stepCards = steps.map((step, index) => `<a class="route" href="${escapeHtml(step.href || 'plan-visibility__index.html#execution-readiness')}">
        <strong>${index + 1}. ${escapeHtml(step.label)}</strong>
        <span>${escapeHtml(step.task_id || 'none')} · ${escapeHtml(step.lane_label || step.lane_id || 'not-recorded')}</span>
        <div class="subtle">${escapeHtml(step.why_first || 'No priority reason recorded.')}</div>
        <div class="subtle">${escapeHtml(step.effect || 'No effect recorded.')}</div>
        <code>${escapeHtml(step.command || 'none')}</code>
      </a>`).join('\n      ');
  return `${summaryCard}\n      ${stepCards || '<div class="route"><strong>No repair steps</strong><span class="subtle">No current execution-readiness rows are available.</span></div>'}`;
}

function renderIndexRiskGateQueue(queue) {
  if (!queue) {
    return '<div class="route"><strong>No risk gate queue</strong><span class="subtle">No risk-gate summary was generated.</span></div>';
  }

  const rows = queue.rows || [];
  const summaryCard = `<div class="route">
        <strong>Gate summary</strong>
        <span>${Number(queue.totals?.candidates || 0)} candidates · ${Number(queue.totals?.operator_gate || 0)} operator · ${Number(queue.totals?.codex_bridge || 0)} bridge</span>
        <div class="subtle">${escapeHtml(queue.summary || 'No risk-gate summary recorded.')}</div>
      </div>`;
  const cards = rows.slice(0, 8).map((row) => `<a class="route" href="${escapeHtml(row.dashboard_href || 'plan-visibility__current.html')}">
        <strong>${escapeHtml(row.gate_label)} · ${escapeHtml(row.task_id)}</strong>
        <span>${escapeHtml(row.status)} · ${escapeHtml(row.review_lane)} · ${escapeHtml(row.risk_tier)}</span>
        <div class="subtle">${escapeHtml(row.reason || 'No gate reason recorded.')}</div>
        <code>${escapeHtml(row.recommended_command || 'not-recorded')}</code>
      </a>`).join('\n      ');
  return `${summaryCard}\n      ${cards || '<div class="route"><strong>No gate rows</strong><span class="subtle">No ready-looking risk-gated rows are available.</span></div>'}`;
}

function renderIndexCommandRunbook(runbook) {
  if (!runbook) {
    return '<div class="route"><strong>No command runbook</strong><span class="subtle">No command-runbook summary was generated.</span></div>';
  }

  const groups = runbook.groups || [];
  const summaryCard = `<div class="route">
        <strong>Command groups</strong>
        <span>${Number(runbook.total_commands || 0)} suggestions · ${groups.length} verbs</span>
        <div class="subtle">${escapeHtml(runbook.summary || 'No command-runbook summary recorded.')}</div>
      </div>`;
  const cards = groups.map((group) => {
    const first = (group.rows || [])[0];
    const href = first?.dashboard_href || 'plan-visibility__current.html';
    return `<a class="route" href="${escapeHtml(href)}">
        <strong>${escapeHtml(group.verb)}</strong>
        <span>${Number(group.count || 0)} suggestions · ${escapeHtml(group.purpose || '')}</span>
        <div class="subtle">${escapeHtml(first ? `${first.task_id}: ${first.reason}` : 'No first command row recorded.')}</div>
        <code>${escapeHtml(first?.command || 'not-recorded')}</code>
      </a>`;
  }).join('\n      ');
  return `${summaryCard}\n      ${cards || '<div class="route"><strong>No command rows</strong><span class="subtle">No derived command suggestions are available.</span></div>'}`;
}

function renderIndexOrchestrationRoutingBoard(board) {
  if (!board) {
    return '<div class="route"><strong>No orchestration routing</strong><span class="subtle">No orchestration-routing summary was generated.</span></div>';
  }

  const lanes = board.lanes || [];
  const summaryCard = `<div class="route">
        <strong>Route summary</strong>
        <span>${lanes.reduce((total, lane) => total + Number(lane.count || 0), 0)} classified plans · ${lanes.length} routes</span>
        <div class="subtle">${escapeHtml(board.summary || 'No orchestration-routing summary recorded.')}</div>
      </div>`;
  const cards = lanes.map((lane) => {
    const first = (lane.rows || [])[0];
    const href = first?.dashboard_href || 'plan-visibility__current.html';
    return `<a class="route" href="${escapeHtml(href)}">
        <strong>${escapeHtml(lane.label)}</strong>
        <span>${Number(lane.count || 0)} plans · first: ${escapeHtml(first?.task_id || 'none')}</span>
        <div class="subtle">${escapeHtml(lane.purpose || '')}</div>
        <div class="subtle">${escapeHtml(first ? `${first.route_owner}: ${first.reason}` : 'No current rows in this route.')}</div>
        <code>${escapeHtml(first?.recommended_command || 'none')}</code>
      </a>`;
  }).join('\n      ');
  return `${summaryCard}\n      ${cards || '<div class="route"><strong>No route rows</strong><span class="subtle">No orchestration routes are available.</span></div>'}`;
}

function renderIndexActionReadinessFlow(actionBoard) {
  const lanes = (actionBoard?.lanes || []).filter((lane) => lane && lane.id);
  if (!lanes.length) {
    return '<div class="action-flow"><span class="subtle">No action-readiness flow is available yet.</span></div>';
  }

  const ordered = ['runnable_now', 'dependency_watch', 'map_repairs', 'impact_review']
    .map((id) => lanes.find((lane) => lane.id === id))
    .filter(Boolean);
  const visible = ordered.length ? ordered : lanes.slice(0, 4);
  const totalRows = visible.reduce((total, lane) => total + ((lane.rows || []).length), 0);
  const maxRows = Math.max(1, ...visible.map((lane) => (lane.rows || []).length));
  const laneNodes = visible.map((lane, index) => {
    const x = 350 + index * 132;
    const rows = (lane.rows || []).length;
    const radius = 34 + Math.round((rows / maxRows) * 18);
    const href = actionReadinessLaneHref(lane);
    const color = actionReadinessColor(lane.id);
    const first = (lane.rows || [])[0];
    const subtitle = first?.task_id || 'no current plan';
    return `<a href="${escapeHtml(href)}">
            <g>
              <line x1="246" y1="124" x2="${x - radius}" y2="124" stroke="#d8dee8" stroke-width="3" />
              <circle cx="${x}" cy="124" r="${radius}" fill="${color}" opacity="0.92" />
              <text x="${x}" y="112" text-anchor="middle" font-size="12" font-weight="700" fill="#ffffff">${escapeHtml(lane.label)}</text>
              <text x="${x}" y="130" text-anchor="middle" font-size="20" font-weight="800" fill="#ffffff">${rows}</text>
              <text x="${x}" y="148" text-anchor="middle" font-size="10" fill="#ffffff">shown</text>
              <text x="${x}" y="194" text-anchor="middle" font-size="11" fill="#475467">${escapeHtml(subtitle)}</text>
            </g>
          </a>`;
  }).join('\n          ');

  return `<div class="action-flow" role="img" aria-label="Action readiness flow from visible plans to action lanes">
      <svg viewBox="0 0 900 230" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="30" font-size="13" fill="#667085">Action Readiness Flow shows where current visible work lands before execution. Click a lane to inspect the first map route for that lane.</text>
        <g>
          <rect x="34" y="78" width="212" height="92" rx="8" fill="#eef2f7" stroke="#d8dee8" />
          <text x="140" y="108" text-anchor="middle" font-size="14" font-weight="800" fill="#1f2937">Visible action candidates</text>
          <text x="140" y="135" text-anchor="middle" font-size="28" font-weight="800" fill="#1f2937">${totalRows}</text>
          <text x="140" y="154" text-anchor="middle" font-size="11" fill="#667085">shown across action lanes</text>
        </g>
        ${laneNodes}
      </svg>
    </div>`;
}

function actionReadinessLaneHref(lane) {
  const first = (lane.rows || [])[0];
  if (first?.dashboard_href) return first.dashboard_href;
  if (lane.id === 'runnable_now') return 'plan-visibility__current.html#status=ready';
  if (lane.id === 'dependency_watch') return 'plan-visibility__current.html#intent=dependency';
  if (lane.id === 'map_repairs') return 'plan-visibility__current.html#quality=missing_review_lane';
  if (lane.id === 'impact_review') return 'plan-visibility__current.html';
  return 'plan-visibility__current.html';
}

function actionReadinessColor(id) {
  if (id === 'runnable_now') return '#0f766e';
  if (id === 'dependency_watch') return '#b91c1c';
  if (id === 'map_repairs') return '#a16207';
  if (id === 'impact_review') return '#7c3aed';
  return '#64748b';
}

function renderIndexUnlinkedPlanTriage(triage) {
  const rows = triage?.rows || [];
  if (!rows.length) {
    return `<div class="route"><strong>All visible plans linked</strong><span class="subtle">${escapeHtml(triage?.summary || 'Every visible plan has at least one detected relationship.')}</span></div>`;
  }

  return rows.slice(0, 6).map((row) => `<div class="route">
        <strong>${escapeHtml(row.task_id)}</strong>
        <span>${escapeHtml(row.status)} · ${escapeHtml(row.review_lane)} · ${escapeHtml(row.risk_tier)}</span>
        <div class="subtle">${escapeHtml(row.suggested_fix)}</div>
        <code>${escapeHtml(row.next_command)}</code>
        <div class="workstream-actions"><a href="${escapeHtml(row.dashboard_href)}">Open map</a><a href="${escapeHtml(indexSourceHref(row.source))}">Open source</a></div>
      </div>`).join('\n      ');
}

function renderIndexImpactHubs(impactHubs) {
  const rows = impactHubs?.rows || [];
  if (!rows.length) {
    return `<div class="route"><strong>No impact hubs</strong><span class="subtle">${escapeHtml(impactHubs?.summary || 'No connected impact hubs were detected.')}</span></div>`;
  }

  return rows.slice(0, 6).map((hub) => `<div class="route">
        <strong>${escapeHtml(hub.task_id)}</strong>
        <span>${escapeHtml(hub.role)} · ${escapeHtml(String(hub.total))} links · ${escapeHtml(hub.workstream_label || 'not linked')}</span>
        <div class="subtle">${escapeHtml(hub.why_it_matters)}</div>
        <code>${escapeHtml(hub.next_command || 'not-recorded')}</code>
        <div class="workstream-actions"><a href="${escapeHtml(hub.dashboard_href)}">Open map</a><a href="${escapeHtml(indexSourceHref(hub.source))}">Open source</a></div>
      </div>`).join('\n      ');
}

function renderIndexVisualFlowcharts(inventory) {
  const items = inventory?.items || [];
  if (!items.length) {
    return '<div class="route"><strong>No visual flowcharts</strong><span class="subtle">Run npm run plans:dashboard to rebuild generated visual artifacts.</span></div>';
  }

  return items.slice(0, 6).map((item) => `<div class="route">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.kind)} · ${escapeHtml((item.mermaid_blocks || []).join(', ') || 'index')}</span>
        <div class="subtle">${escapeHtml(item.description)}</div>
        <div class="workstream-actions"><a href="${escapeHtml(item.path)}">Open artifact</a><a href="${escapeHtml(item.dashboard_href)}">Open map</a></div>
      </div>`).join('\n      ');
}

function renderIndexVisualCoverage(coverage) {
  const rows = coverage?.queue || [];
  if (!rows.length) {
    return `<div class="route">
        <strong>Visual coverage complete</strong>
        <span class="subtle">${escapeHtml(coverage?.summary || 'All detected workstreams have generated visual briefs.')}</span>
      </div>`;
  }

  return rows.slice(0, 6).map((row) => `<div class="route">
        <strong>${escapeHtml(row.label)}</strong>
        <span>${escapeHtml(row.cluster_id)} · ${row.plans} plans · ${row.relationships} links</span>
        <div class="subtle">${escapeHtml(row.reason)}</div>
        <div class="workstream-actions"><a href="${escapeHtml(row.dashboard_href)}">Open map</a><code>${escapeHtml(row.command)}</code></div>
      </div>`).join('\n      ');
}

function renderIndexWorkstreamStories(stories) {
  const rows = stories || [];
  if (!rows.length) {
    return '<div class="route"><strong>No workstream stories</strong><span class="subtle">No relationship examples are available yet.</span></div>';
  }

  return rows.slice(0, 4).map((story) => {
    const example = story.relationship_examples?.[0];
    const exampleText = example
      ? `${example.source} -> ${example.target} (${example.intent})`
      : 'No example link recorded.';
    return `<div class="route">
        <strong>${escapeHtml(story.label || story.cluster_id)}</strong>
        <span>${escapeHtml(story.cluster_id)} · ${story.plans} plans · ${story.relationships} links</span>
        <div class="subtle">${escapeHtml(story.explanation)}</div>
        <div class="subtle">Example: ${escapeHtml(exampleText)}</div>
        <div class="workstream-actions"><a href="${escapeHtml(story.dashboard_href)}">Open map</a><a href="${escapeHtml(story.brief_href)}">Open brief</a></div>
      </div>`;
  }).join('\n      ');
}

function renderIndexWorkstreamDrilldowns(drilldowns) {
  const rows = (drilldowns?.drilldowns || [])
    .flatMap((drilldown) => (drilldown.slices || []).slice(0, 3).map((slice) => ({ drilldown, slice })))
    .slice(0, 9);
  if (!rows.length) {
    return `<div class="route"><strong>No workstream drilldowns</strong><span class="subtle">${escapeHtml(drilldowns?.summary || 'No multi-plan workstreams are available for drilldown.')}</span></div>`;
  }

  const summary = `<div class="route">
        <strong>Drilldown summary</strong>
        <span>${Number(drilldowns.shown_workstreams || 0)} workstreams shown</span>
        <div class="subtle">${escapeHtml(drilldowns.summary || 'Workstream drilldowns generated from current relationship clusters.')}</div>
      </div>`;
  const cards = rows.map(({ drilldown, slice }) => {
    const next = slice.suggested_next || {};
    return `<a class="route" href="${escapeHtml(next.dashboard_href || drilldown.dashboard_href || 'plan-visibility__current.html')}">
        <strong>${escapeHtml(drilldown.label)} · ${escapeHtml(slice.label)}</strong>
        <span>${slice.plans} plans · ${slice.ready_like} ready/in progress · ${slice.relationships} links</span>
        <div class="subtle">Status: ${escapeHtml(formatEntryList(slice.status_mix))}</div>
        <div class="subtle">Quality: ${escapeHtml(formatEntryList(slice.quality_flags))}</div>
        <code>${escapeHtml(next.next_command || 'not-recorded')}</code>
      </a>`;
  }).join('\n      ');
  return `${summary}\n      ${cards}`;
}

function renderIndexRecentActivity(activity) {
  const rows = activity?.items || [];
  if (!rows.length) {
    return `<div class="route">
        <strong>No recent activity</strong>
        <span class="subtle">${escapeHtml(activity?.summary || 'No visible task-plan source changes were found.')}</span>
      </div>`;
  }

  return rows.slice(0, 6).map((row) => `<div class="route">
        <strong>${escapeHtml(row.task_id)}</strong>
        <span>${escapeHtml(row.status)} · ${escapeHtml(row.source_mtime)}</span>
        <div class="subtle">${escapeHtml(row.workstream_label || 'not linked')} · ${escapeHtml(row.next_command)}</div>
        <div class="workstream-actions"><a href="${escapeHtml(row.dashboard_href)}">Open map</a><a href="${escapeHtml(indexSourceHref(row.source))}">Open source</a></div>
      </div>`).join('\n      ');
}

function renderIndexPlanProgressTimeline(timeline) {
  const rows = timeline?.items || [];
  if (!rows.length) {
    return `<div class="route">
        <strong>No plan progress timeline</strong>
        <span class="subtle">${escapeHtml(timeline?.summary || 'No visible plan progress timestamps are available.')}</span>
      </div>`;
  }

  return rows.slice(0, 8).map((row) => {
    const step = row.next_step || {};
    const nextStep = `${step.step_id || 'none'}: ${step.description || 'No next step recorded.'}`;
    return `<div class="route">
        <strong>${escapeHtml(row.task_id)}</strong>
        <span>${escapeHtml(row.status)} · ${escapeHtml(row.modified_at)}</span>
        <div class="subtle">${escapeHtml(row.workstream_label || 'not linked')} · ${escapeHtml(nextStep)}</div>
        <code>${escapeHtml(row.next_command || 'not-recorded')}</code>
        <div class="workstream-actions"><a href="${escapeHtml(row.dashboard_href)}">Open map</a><a href="${escapeHtml(indexSourceHref(row.source))}">Open source</a></div>
      </div>`;
  }).join('\n      ');
}

function indexSourceHref(sourcePath) {
  return `../../../${String(sourcePath || '').split('/').map(encodeURIComponent).join('/')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function escapeBackticks(value) {
  return String(value ?? '').replace(/`/g, '\\`');
}

module.exports = {
  SYSTEM_PLAN_ROOT,
  walkPlanFiles,
  classifyPlan,
  summarizeSteps,
  inferNextCommand,
  buildPlanDocumentLead,
  buildPlanVisibilityModel,
  buildVisualFlowchartInventory,
  buildVisualCoverage,
  buildPlanVisibilityIndexQuickViews,
  buildGroupings,
  collectPlanSummaries,
  collectPlanRelationships,
  renderPlanVisibilityMarkdown,
  renderPlanVisibilityOperatorBrief,
  renderFocusedVisualPlanMarkdown,
  renderPlanDocumentMarkdown,
  renderPlanDocumentHtml,
  renderTwoSurfaceMarkdown,
  buildPlanDagSvg,
  buildInlineGlossary,
  findPlanJsonPath,
  buildVisualPlanAdapterManifest,
  renderVisualPlanLibraryHtml,
  renderVisualPlanLibraryMarkdown,
  renderPlanVisibilityHtml,
  renderPlanVisibilityIndex
};
