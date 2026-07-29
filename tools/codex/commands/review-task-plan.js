'use strict';

const fs = require('fs');
const path = require('path');

const { listAmendments, resolveOperatorGates, resolveTaskPlanPaths } = require('../../planning/lib/resolve-task-plan');
const { parseFlagArgs, readJsonSafe, readUtf8, rel } = require('./_shared');
const {
  resolveStateMarkerPath,
  readStateMarker,
  writeStateMarker,
  approveRepair,
  rejectRepair
} = require('../../planning/lib/plan-review-state');

/**
 * Discover the most recent PlanRepair/1.0 manifest sibling for a task.
 * Returns { manifestPath, manifest } or null.
 */
function discoverLatestRepairManifest(storageRoot, taskId) {
  if (!storageRoot || !taskId) return null;
  let entries;
  try {
    entries = fs.readdirSync(storageRoot);
  } catch (_) {
    return null;
  }
  const prefix = `${taskId}__repair__`;
  const matches = entries
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort(); // filename timestamps sort lexicographically
  if (matches.length === 0) return null;
  const latest = matches[matches.length - 1];
  const manifestPath = path.join(storageRoot, latest);
  const manifest = readJsonSafe(manifestPath);
  if (!manifest) return null;
  return { manifestPath, manifest };
}

function abbrevHash(h) {
  if (typeof h !== 'string' || h.length < 12) return h || '(none)';
  return h.slice(0, 12);
}

function truncateReason(s, max) {
  if (typeof s !== 'string') return '(none)';
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/**
 * Build the resolved operator-gate view for this plan's amendment chain.
 * Returns { gates, blocking_gates, lines } where lines is the renderable
 * summary block for the review output.
 */
function summarizeResolvedGates(storageRoot, taskId) {
  // Active-only for gate-state resolution: a superseded/applied amendment
  // cannot block execution via its operator_gates. listAmendments default
  // already filters resolved lifecycle states.
  const active = listAmendments(storageRoot, taskId);
  const ordered = active.slice().reverse(); // oldest-first for chain resolution
  const chain = ordered.map((a) => readJsonSafe(a.jsonPath)).filter(Boolean);
  const view = resolveOperatorGates(chain);

  const lines = [];
  if (view.gates.length === 0) {
    lines.push('(no operator_gates declared in amendment chain — PlanAmendment/1.0 treated as empty)');
  } else {
    for (const g of view.gates) {
      const id = g.id || '(unnamed)';
      const status = g.status || '(unknown)';
      const q = g.question || '';
      const detail = status === 'resolved' && g.resolution
        ? ` -> ${g.resolution}`
        : (g.reason ? ` (${g.reason})` : '');
      lines.push(`[${status}] ${id}: ${q}${detail}`);
    }
  }

  return {
    gates: view.gates,
    blocking_gates: view.blocking_gates,
    lines
  };
}

function formatArray(items) {
  if (!Array.isArray(items) || items.length === 0) return ['(none)'];
  return items.map((item) => String(item));
}

function formatListish(items) {
  if (Array.isArray(items)) return formatArray(items);
  if (typeof items === 'string' && items.trim()) return [items.trim()];
  return ['(none)'];
}

function summarizeSteps(plan) {
  const steps = (((plan || {}).bounded_plan || {}).steps || []);
  if (!Array.isArray(steps) || steps.length === 0) return ['(none)'];
  return steps.map((step, index) => {
    const stepId = step && (step.step_id || step.id);
    const id = stepId ? `${stepId}: ` : `${index + 1}. `;
    const text = step && step.description ? step.description : JSON.stringify(step);
    return `${id}${text}`;
  });
}

function summarizeAmendments(projectRoot, storageRoot, taskId) {
  const allAmendments = listAmendments(storageRoot, taskId, { includeSuperseded: true });
  const activeAmendments = allAmendments.filter((a) => a.active);
  const historicalAmendments = allAmendments.filter((a) => !a.active);

  const renderRow = (amendment) => {
    const parsed = readJsonSafe(amendment.jsonPath);
    const divergenceSummary = Array.isArray(parsed && parsed.divergences) && parsed.divergences.length > 0
      ? parsed.divergences.map((d) => (typeof d === 'object' && d !== null ? JSON.stringify(d) : String(d))).join(', ')
      : 'no divergence labels recorded';
    const lifecycle = parsed && (parsed.lifecycle_state || parsed.execution_status);
    const suffix = lifecycle ? ` [${lifecycle}]` : '';
    return {
      line: `${path.basename(amendment.jsonPath)}${suffix} — ${divergenceSummary}`,
      parsed: parsed
    };
  };

  const lines = [];
  const outputs = [];

  if (allAmendments.length === 0) {
    lines.push('(none)');
  } else {
    if (activeAmendments.length === 0) {
      lines.push('(no active amendments)');
    } else {
      for (const amendment of activeAmendments.slice(0, 3)) {
        const row = renderRow(amendment);
        lines.push(row.line);
        outputs.push(rel(projectRoot, amendment.jsonPath));
        if (row.parsed && amendment.markdownPath) outputs.push(rel(projectRoot, amendment.markdownPath));
      }
    }
    if (historicalAmendments.length > 0) {
      lines.push('Historical (resolved / superseded):');
      for (const amendment of historicalAmendments.slice(0, 3)) {
        const row = renderRow(amendment);
        lines.push(`  ${row.line}`);
      }
    }
  }

  return { lines, outputs, activeCount: activeAmendments.length };
}

function runReviewTaskPlan(projectRoot, opts = {}) {
  const args = Array.isArray(opts.args) ? opts.args : [];
  const { flags, positionals } = parseFlagArgs(args);
  const ref = String(positionals[0] || args[0] || '').trim();
  if (!ref) {
    return {
      exitCode: 2,
      stdout: 'Missing task-plan reference. Provide --exact "/review-task-plan <task-id|path>".',
      stderr: '',
      outputs: []
    };
  }

  let resolved;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, ref);
  } catch (error) {
    return {
      exitCode: 2,
      stdout: `Unable to resolve task plan "${ref}".\n${error.message}`,
      stderr: '',
      outputs: []
    };
  }

  if (!resolved) {
    return {
      exitCode: 2,
      stdout: `Task plan not found: ${ref}`,
      stderr: '',
      outputs: []
    };
  }

  const plan = readJsonSafe(resolved.jsonPath);
  if (!plan) {
    return {
      exitCode: 2,
      stdout: `Task plan JSON is missing or unreadable: ${rel(projectRoot, resolved.jsonPath)}`,
      stderr: '',
      outputs: []
    };
  }

  // Repair approval / rejection transitions. These are CLI-style side-effects
  // that flip the state-marker produced by /repair-plan, unblocking /run-plan
  // (on approve) or recording rejection provenance. When neither flag is
  // supplied, ordinary review behavior below runs unchanged.
  const wantsApprove = flags.approve === true || flags.approve === 'true';
  const wantsReject = flags.reject === true || flags.reject === 'true';
  if (wantsApprove || wantsReject) {
    const approvalRef = typeof flags.approval_ref === 'string' ? flags.approval_ref.trim() : '';
    if (!approvalRef) {
      return {
        exitCode: 2,
        stdout: `/review-task-plan ${plan.task_id || ref}: --${wantsApprove ? 'approve' : 'reject'} requires --approval-ref <path>.`,
        stderr: '',
        outputs: []
      };
    }
    const markerPath = resolveStateMarkerPath(projectRoot, plan.task_id || ref, {
      clientCode: resolved.clientCode || undefined
    });
    let currentMarker;
    try {
      currentMarker = readStateMarker(markerPath);
    } catch (err) {
      return {
        exitCode: 2,
        stdout: `State marker at ${markerPath} is malformed: ${err.message}`,
        stderr: '',
        outputs: []
      };
    }
    if (!currentMarker) {
      return {
        exitCode: 2,
        stdout: `No repair state marker present for ${plan.task_id || ref}; nothing to ${wantsApprove ? 'approve' : 'reject'}.`,
        stderr: '',
        outputs: []
      };
    }
    if (
      currentMarker.last_event !== 'post_repair' ||
      !currentMarker.post_repair ||
      currentMarker.post_repair.review_status !== 'pending'
    ) {
      return {
        exitCode: 2,
        stdout: `Repair for ${plan.task_id || ref} is not in pending state (last_event=${currentMarker.last_event}, review_status=${(currentMarker.post_repair || {}).review_status}). No transition applied.`,
        stderr: '',
        outputs: []
      };
    }
    const decidedAt = new Date().toISOString();
    const decidedByActorId =
      typeof flags.decided_by_actor_id === 'string' && flags.decided_by_actor_id.trim()
        ? flags.decided_by_actor_id.trim()
        : 'operator';
    let nextMarker;
    try {
      nextMarker = (wantsApprove ? approveRepair : rejectRepair)(
        currentMarker,
        approvalRef,
        decidedAt,
        decidedByActorId
      );
    } catch (err) {
      return {
        exitCode: 2,
        stdout: `Failed to build post-review marker: ${err.message}`,
        stderr: '',
        outputs: []
      };
    }
    writeStateMarker(markerPath, nextMarker);
    const relMarker = rel(projectRoot, markerPath);
    const lines = wantsApprove
      ? [
          `Managed command executed: /review-task-plan --approve ${plan.task_id || ref}`,
          `State marker: ${relMarker}`,
          `Approval reference: ${approvalRef}`,
          `Decided at: ${decidedAt}`,
          'Repair approved. /run-plan is now unblocked.',
          `Exact next command: /run-plan ${plan.task_id || ref}`
        ]
      : [
          `Managed command executed: /review-task-plan --reject ${plan.task_id || ref}`,
          `State marker: ${relMarker}`,
          `Approval reference: ${approvalRef}`,
          `Decided at: ${decidedAt}`,
          'Repair rejected. /run-plan remains blocked.',
          `Exact next command: /repair-plan ${plan.task_id || ref} (or /amend-plan ${plan.task_id || ref} if the failure is overlay-level)`
        ];
    return {
      exitCode: 0,
      stdout: lines.join('\n'),
      stderr: '',
      outputs: [relMarker]
    };
  }

  const markdownExists = !!readUtf8(resolved.markdownPath);
  const routing = plan.routing_expectations || {};
  const boundedPlan = plan.bounded_plan || {};
  const amendmentSummary = summarizeAmendments(projectRoot, resolved.storageRoot, plan.task_id || ref);
  const resolvedGates = summarizeResolvedGates(resolved.storageRoot, plan.task_id || ref);

  // Discover latest PlanRepair manifest sibling (if any) and read repair marker.
  const repairDiscovery = discoverLatestRepairManifest(resolved.storageRoot, plan.task_id || ref);
  const repairStateMarkerPath = resolveStateMarkerPath(projectRoot, plan.task_id || ref, {
    clientCode: resolved.clientCode || undefined
  });
  let repairMarker = null;
  try {
    repairMarker = readStateMarker(repairStateMarkerPath);
  } catch (_) {
    repairMarker = null;
  }
  const repairContextLines = [];
  const repairOutputs = [];
  if (repairDiscovery) {
    const m = repairDiscovery.manifest;
    repairContextLines.push('');
    repairContextLines.push('Repair Context (latest PlanRepair/1.0 manifest):');
    repairContextLines.push(`- manifest: ${rel(projectRoot, repairDiscovery.manifestPath)}`);
    repairContextLines.push(`- repair_id: ${m.repair_id || '(missing)'}`);
    repairContextLines.push(`- timestamp: ${m.timestamp || '(missing)'}`);
    repairContextLines.push(
      `- fields_touched_json: ${Array.isArray(m.fields_touched_json) ? m.fields_touched_json.join(', ') || '(none)' : '(none)'}`
    );
    repairContextLines.push(
      `- fields_touched_md: ${Array.isArray(m.fields_touched_md) ? m.fields_touched_md.join(', ') || '(none)' : '(none)'}`
    );
    const preJ = (m.pre_repair_hashes || {}).json;
    const preM = (m.pre_repair_hashes || {}).md;
    const postJ = (m.post_repair_hashes || {}).json;
    const postM = (m.post_repair_hashes || {}).md;
    repairContextLines.push(`- pre_repair_hashes:  json=${abbrevHash(preJ)} md=${abbrevHash(preM)}`);
    repairContextLines.push(`- post_repair_hashes: json=${abbrevHash(postJ)} md=${abbrevHash(postM)}`);
    repairContextLines.push(`- reason: ${truncateReason(m.reason, 200)}`);
    repairContextLines.push(`- review_reference (defect-surfacing): ${m.review_reference || '(missing)'}`);
    if (repairMarker) {
      repairContextLines.push(
        `- state_marker: last_event=${repairMarker.last_event} review_status=${(repairMarker.post_repair || {}).review_status || '(unknown)'}`
      );
    }
    repairContextLines.push('');
    repairContextLines.push('If the repair is correct: /review-task-plan --approve ' + (plan.task_id || ref) + ' --approval-ref <path>');
    repairContextLines.push('If the repair is incorrect: /review-task-plan --reject ' + (plan.task_id || ref) + ' --approval-ref <path>');
    repairOutputs.push(rel(projectRoot, repairDiscovery.manifestPath));
  }
  const scopeType = String(plan.scope_type || (resolved.clientCode ? 'client' : 'system')).trim();
  const matchedFramework = plan.matched_framework ||
    plan.framework_id ||
    (((plan || {}).similarity_assessment || {}).top_framework) ||
    '(none recorded)';

  const lines = [
    `Managed command executed: /review-task-plan ${plan.task_id || ref}`,
    '',
    `Plan JSON: ${rel(projectRoot, resolved.jsonPath)}`,
    `Plan Markdown: ${rel(projectRoot, resolved.markdownPath)}${markdownExists ? '' : ' (missing)'}`,
    `Scope: ${scopeType}${resolved.clientCode ? ` (${resolved.clientCode})` : ''}`,
    `Task Summary: ${plan.task_summary || '(missing task_summary)'}`,
    `Matched Framework: ${matchedFramework}`,
    `Review Lane: ${routing.review_lane || '(none recorded)'}`,
    `Risk Tier: ${routing.risk_tier || '(none recorded)'}`,
    '',
    'Bounded Steps:',
    ...summarizeSteps(plan).map((line) => `- ${line}`),
    '',
    'Required Gates:',
    ...formatArray(boundedPlan.required_gates).map((line) => `- ${line}`),
    '',
    'Expected Outcomes:',
    ...formatArray(boundedPlan.expected_outcomes).map((line) => `- ${line}`),
    '',
    'Risk Notes:',
    ...formatListish(boundedPlan.risk_notes).map((line) => `- ${line}`),
    '',
    'Amendments:',
    ...amendmentSummary.lines.map((line) => `- ${line}`),
    ...repairContextLines,
    '',
    'Resolved Operator Gates (PlanAmendment/1.1 chain view):',
    ...resolvedGates.lines.map((line) => `- ${line}`),
    ...(resolvedGates.blocking_gates.length > 0
      ? ['', `BLOCKING: ${resolvedGates.blocking_gates.length} gate(s) with status=open — /run-plan will fail-fast until resolved.`]
      : []),
    '',
    'Conditional next steps:',
    ...(resolvedGates.blocking_gates.length > 0
      ? [`- Open operator_gates present: /amend-plan ${plan.task_id || ref} to resolve/waive/defer before /run-plan`]
      : []),
    ...(resolvedGates.blocking_gates.length > 0
      ? [`- Unresolved operator gates present (${resolvedGates.blocking_gates.map((g) => g.id || '(unnamed)').join(', ')}): resolve or waive before running — see Amendments above`]
      : []),
    `- If approved as a bounded leaf: /run-plan ${plan.task_id || ref}`,
    `- If scope or routing truth changed materially: /amend-plan ${plan.task_id || ref}`,
    `- If this behaves like orchestration housing instead of a leaf: promote or review the housing artifact before execution`
  ];

  return {
    exitCode: 0,
    stdout: lines.join('\n'),
    stderr: '',
    outputs: [
      rel(projectRoot, resolved.jsonPath),
      rel(projectRoot, resolved.markdownPath),
      ...amendmentSummary.outputs,
      ...repairOutputs
    ]
  };
}

module.exports = {
  runReviewTaskPlan
};
