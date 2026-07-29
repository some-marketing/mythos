'use strict';

/**
 * orchestrate.js — Codex-managed runner for /orchestrate.
 */

const { resolveTaskPlanPaths } = require('../../planning/lib/resolve-task-plan');
const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');
const fs = require('fs');
const path = require('path');

function orchestrate(projectRoot, argsText, options = {}) {
  const ref = (argsText || '').split(/\s+/)[0];
  if (!ref) {
    return { exitCode: 1, stdout: '', stderr: 'Missing task-id/plan-id argument.' };
  }

  // 1. Resolve Plan
  let resolved;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, ref);
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: err.message };
  }

  if (!resolved) {
    return { exitCode: 1, stdout: '', stderr: `Plan not found: ${ref}` };
  }

  const planJson = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
  const planMd = fs.readFileSync(resolved.markdownPath, 'utf8');

  // 2. Run ADAPTER - synthesize prose description
  const taskId = planJson.task_id;
  const scopeType = planJson.scope_type;
  const clientCode = planJson.client_code;
  const summary = planJson.task_summary;
  const scopeIdentity = planJson.scope_identity || null;
  const routing = planJson.routing_expectations || {};
  const bounded = planJson.bounded_plan || {};

  const lines = [
    `# PROSE TASK DESCRIPTION (Synthesized from ${taskId})`,
    '',
    `**Plan id + scope**: ${taskId}, ${scopeType}${clientCode ? ` (${clientCode})` : ''}`,
    `**Task summary**: ${summary}`,
    ''
  ];

  if (scopeIdentity) {
    lines.push('**plan.scope_identity**:');
    lines.push(`- workstream_scope: ${scopeIdentity.workstream_scope}`);
    lines.push(`- session_or_run_id: ${scopeIdentity.session_or_run_id}`);
    lines.push(`- working_surface: ${JSON.stringify(scopeIdentity.working_surface)}`);
    lines.push(`- custody_hierarchy: ${JSON.stringify(scopeIdentity.custody_hierarchy)}`);
    lines.push(`- owned_artifacts: ${JSON.stringify(scopeIdentity.owned_artifacts)}`);
    lines.push(`- forbidden_artifacts: ${JSON.stringify(scopeIdentity.forbidden_artifacts)}`);
  } else {
    lines.push('**Legacy warning**: plan.scope_identity is absent. Custody gap explicitly stated.');
  }

  lines.push('');
  lines.push(`**Routing expectations**: risk_tier=${routing.risk_tier}, review_lane=${routing.review_lane}`);
  lines.push(`Rationale: ${routing.review_lane_rationale}`);

  lines.push('');
  lines.push('**Bounded plan shape**:');
  if (bounded.steps) {
    bounded.steps.forEach(s => lines.push(`- ${s.step_id}: ${s.description}`));
  }
  lines.push(`Required gates: ${JSON.stringify(bounded.required_gates || [])}`);
  lines.push(`Expected outcomes: ${JSON.stringify(bounded.expected_outcomes || [])}`);

  lines.push('');
  lines.push(`**Risk notes**: ${bounded.risk_notes || 'None'}`);
  
  lines.push('');
  lines.push(`**Resolved artifact paths**:`);
  lines.push(`- JSON: ${path.relative(projectRoot, resolved.jsonPath)}`);
  lines.push(`- MD: ${path.relative(projectRoot, resolved.markdownPath)}`);

  // 3. Stamp Trace Context
  const nextEnv = buildNextTraceEnv({
    scope: taskId,
    executionMode: 'managed'
  });

  return {
    exitCode: 0,
    stdout: [
      `[telemetry] trace_id=${nextEnv.MYTHOS_TRACE_ID} span_id=${nextEnv.MYTHOS_SPAN_ID}`,
      '',
      lines.join('\n'),
      '',
      'INVOKING ORCHESTRATE SKILL...',
      'Please use the orchestrate skill with the above task description.'
    ].join('\n'),
    stderr: ''
  };
}

module.exports = { orchestrate };
