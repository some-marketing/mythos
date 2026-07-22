'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveTaskPlanPaths,
  listAmendments
} = require('../../planning/lib/resolve-task-plan');
const {
  NARRATIVE_SCHEMA,
  computePlanContentHashes,
  reviewArtifactPaths
} = require('../lib/review-task-plan-narrative.cjs');

const REQUIRED_PLAN_FIELDS = [
  'task_id',
  'description',
  'source',
  'requested_by',
  'timestamp',
  'scope_type',
  'storage_root'
];

function safeReadJson(filePath) {
  try {
    return {
      ok: true,
      data: JSON.parse(fs.readFileSync(filePath, 'utf8'))
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  }
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath);
}

function validateTaskPlanShape(plan) {
  const blockers = [];
  if (!plan || typeof plan !== 'object') {
    return ['Plan JSON did not parse to an object.'];
  }
  for (const field of REQUIRED_PLAN_FIELDS) {
    if (plan[field] === undefined || plan[field] === null || plan[field] === '') {
      blockers.push(`Missing required field: ${field}`);
    }
  }
  if (plan.scope_type && !['system', 'client'].includes(plan.scope_type)) {
    blockers.push(`Invalid scope_type: ${plan.scope_type}`);
  }
  if (plan.scope_type === 'client' && !plan.client_code) {
    blockers.push('Client-scoped plan is missing client_code.');
  }
  return blockers;
}

function renderReviewMarkdown(review) {
  const lines = [];
  lines.push(`# Task Plan Review: ${review.task_id || review.target}`);
  lines.push('');
  lines.push(`- **Status:** ${review.status}`);
  lines.push(`- **Command:** ${review.command}`);
  lines.push(`- **Generated:** ${review.generated_at}`);
  lines.push(`- **Plan JSON:** ${review.paths.json}`);
  lines.push(`- **Plan Markdown:** ${review.paths.markdown}`);
  lines.push(`- **Storage Root:** ${review.storage_root}`);
  lines.push(`- **Scope:** ${review.scope_type}${review.client_code ? ` (${review.client_code})` : ''}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Title:** ${review.title || '(none)'}`);
  lines.push(`- **Description:** ${review.description || '(none)'}`);
  lines.push(`- **Review lane:** ${review.review_lane || '(not declared)'}`);
  lines.push(`- **Risk tier:** ${review.risk_tier || '(not declared)'}`);
  lines.push('');
  lines.push('## Structural Findings');
  lines.push('');
  if (review.blockers.length === 0) {
    lines.push('- No blocking structural defects found.');
  } else {
    for (const blocker of review.blockers) lines.push(`- BLOCKER: ${blocker}`);
  }
  if (review.warnings.length > 0) {
    for (const warning of review.warnings) lines.push(`- WARNING: ${warning}`);
  }
  lines.push('');
  lines.push('## Owned Artifacts Audit');
  lines.push('');
  if (!review.owned_artifacts_audit) {
    lines.push('- No owned_artifacts audit was available for this plan.');
  } else {
    lines.push(`- Existing: ${review.owned_artifacts_audit.existing.length}`);
    lines.push(`- Missing: ${review.owned_artifacts_audit.missing.length}`);
    lines.push(`- Planned new: ${review.owned_artifacts_audit.planned_new.length}`);
    lines.push(`- Glob patterns not validated: ${review.owned_artifacts_audit.glob_patterns_not_validated.length}`);
    for (const missing of review.owned_artifacts_audit.missing) {
      lines.push(`- Missing artifact: ${missing}`);
    }
  }
  lines.push('');
  lines.push('## Amendments');
  lines.push('');
  if (review.amendments.length === 0) {
    lines.push('- No amendment artifacts found.');
  } else {
    for (const amendment of review.amendments) {
      lines.push(`- ${amendment.timestamp}: ${amendment.json}`);
    }
  }
  lines.push('');
  lines.push('## Deterministic Handoff');
  lines.push('');
  if (review.blockers.length > 0) {
    lines.push(`Next: repair or amend the plan before execution. Do not run \`/run-plan ${review.task_id || review.target}\` yet.`);
  } else {
    lines.push('Structural precheck passed. This scratch artifact is not a narrative verdict and never authorizes execution.');
    lines.push('- The active reviewer must read the full plan and write the separately bound canonical review pair.');
  }
  lines.push(`- Expected narrative run ID: ${review.narrative_completion_expected.run_id}`);
  lines.push(`- Expected plan content hash: ${review.narrative_completion_expected.plan_content_hash}`);
  lines.push('');
  return lines.join('\n');
}

function buildReview(projectRoot, target, resolved, plan, command, options = {}) {
  const blockers = validateTaskPlanShape(plan);
  const warnings = [];

  if (!fs.existsSync(resolved.markdownPath)) {
    warnings.push('Paired markdown summary is missing.');
  }
  for (const warning of resolved.audit_warnings || []) {
    warnings.push(`${warning.code}: ${warning.detail}`);
  }

  const audit = resolved.owned_artifacts_audit || null;
  if (audit && audit.missing.length > 0) {
    warnings.push(`Owned artifacts audit found ${audit.missing.length} missing required artifact(s).`);
  }

  const taskId = plan.task_id || path.basename(resolved.jsonPath).replace(/__plan\.json$/, '');
  const amendments = listAmendments(resolved.storageRoot, taskId).map((entry) => ({
    timestamp: entry.timestamp,
    json: rel(projectRoot, entry.jsonPath),
    markdown: rel(projectRoot, entry.markdownPath)
  }));

  const routing = plan.routing_expectations || plan.routing_metadata || plan.execution_closeout || {};

  const hashes = computePlanContentHashes(resolved.jsonPath, resolved.markdownPath);
  const runId = String(
    options.runId || process.env.MYTHOS_REVIEW_RUN_ID || `standalone-${Date.now()}`
  );

  return {
    schema: 'TaskPlanReview/1.0',
    command,
    target,
    generated_at: new Date().toISOString(),
    status: blockers.length > 0 ? 'structural_precheck_blocked' : 'structural_precheck_complete',
    task_id: taskId,
    title: plan.title || plan.task_summary || '',
    description: plan.description || '',
    scope_type: plan.scope_type || '',
    client_code: plan.client_code || null,
    storage_root: plan.storage_root || rel(projectRoot, resolved.storageRoot),
    review_lane: plan.review_lane || routing.review_lane || '',
    risk_tier: plan.risk_tier || routing.risk_tier || '',
    paths: {
      json: rel(projectRoot, resolved.jsonPath),
      markdown: rel(projectRoot, resolved.markdownPath)
    },
    narrative_completion_expected: {
      schema: NARRATIVE_SCHEMA,
      run_id: runId,
      ...hashes,
      status: 'pending'
    },
    blockers,
    warnings,
    owned_artifacts_audit: audit,
    amendments
  };
}

function writeReviewArtifacts(projectRoot, review) {
  const outputDir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'task-plan-reviews');
  fs.mkdirSync(outputDir, { recursive: true });
  const paths = reviewArtifactPaths(projectRoot, review.task_id || review.target);
  const jsonPath = paths.scratch_json;
  const markdownPath = paths.scratch_markdown;
  fs.writeFileSync(jsonPath, JSON.stringify(review, null, 2) + '\n');
  fs.writeFileSync(markdownPath, renderReviewMarkdown(review));
  return {
    jsonPath,
    markdownPath
  };
}

function reviewOutputOverride(options = {}) {
  const json = options.reviewOutputJson || process.env.MYTHOS_REVIEW_OUTPUT_JSON || '';
  const markdown = options.reviewOutputMarkdown || process.env.MYTHOS_REVIEW_OUTPUT_MARKDOWN || '';
  return json || markdown ? { json, markdown } : null;
}

function reviewTaskPlan(projectRoot, argsText, options = {}) {
  const target = String(argsText || '').trim();
  if (!target) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Usage: /review-task-plan <task-id|plan-path>'
    };
  }

  let resolved;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, target);
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: err.message };
  }

  if (!resolved) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Task plan not found: ${target}`
    };
  }

  const parsed = safeReadJson(resolved.jsonPath);
  if (!parsed.ok) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Failed to read plan JSON ${rel(projectRoot, resolved.jsonPath)}: ${parsed.error}`
    };
  }

  const review = buildReview(projectRoot, target, resolved, parsed.data, '/review-task-plan ' + target, options);
  const artifacts = reviewArtifactPaths(projectRoot, review.task_id, reviewOutputOverride(options));
  const outputs = options.write === false
    ? null
    : writeReviewArtifacts(projectRoot, review);

  const stdout = {
    ok: review.blockers.length === 0,
    status: review.status,
    task_id: review.task_id,
    blockers: review.blockers,
    warnings: review.warnings,
    output: outputs ? {
      json: rel(projectRoot, outputs.jsonPath),
      markdown: rel(projectRoot, outputs.markdownPath)
    } : null,
    canonical_output: {
      json: rel(projectRoot, artifacts.canonical_json),
      markdown: rel(projectRoot, artifacts.canonical_markdown)
    },
    narrative_completion_expected: review.narrative_completion_expected,
    next_command: review.blockers.length === 0 ? `/review-task-plan ${review.task_id}` : `/amend-plan ${review.task_id}`
  };

  return {
    exitCode: review.blockers.length === 0 ? 0 : 2,
    stdout: options.json === false
      ? `Review ${review.status}: ${review.task_id}${outputs ? `\nWrote ${rel(projectRoot, outputs.markdownPath)}` : ''}`
      : JSON.stringify(stdout, null, 2),
    stderr: ''
  };
}

module.exports = {
  buildReview,
  renderReviewMarkdown,
  reviewTaskPlan,
  validateTaskPlanShape,
  writeReviewArtifacts
};
