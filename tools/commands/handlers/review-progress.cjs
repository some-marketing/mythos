'use strict';

const fs = require('fs');
const path = require('path');

const { resolveTaskPlanPaths } = require('../../planning/lib/resolve-task-plan');
const { getTraceContext } = require('../../telemetry/dispatches/lib/trace-context.cjs');
const { inspectAdapterTarget } = require('./review-progress-adapters.cjs');

function safeSlug(value) {
  return String(value || 'repo')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^_dev\/reports\/analysis\/task-plans\//, '')
    .replace(/__plan\.json$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'repo';
}

function parseTarget(argsText) {
  const tokens = String(argsText || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const target = tokens.find((token) => !token.startsWith('--')) || 'repo';
  return target.replace(/^["']|["']$/g, '');
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function readJsonSafe(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath));
}

function analysisPath(projectRoot, name) {
  return path.join(projectRoot, '_dev', 'reports', 'analysis', name);
}

function relatedArtifactPaths(projectRoot, scope) {
  const analysisDir = analysisPath(projectRoot, '');
  const reviewDir = analysisPath(projectRoot, 'task-plan-reviews');
  const outcomeDir = analysisPath(projectRoot, 'task-outcomes');
  const candidates = [
    path.join(reviewDir, `${scope}__review.json`),
    path.join(reviewDir, `${scope}__review.md`),
    path.join(outcomeDir, `${scope}.json`)
  ];
  if (fs.existsSync(analysisDir)) {
    for (const file of fs.readdirSync(analysisDir)) {
      if (file.includes(scope) && /^(codex-cli-run|codex-last-message|dispatch-bridge|review-progress)__/.test(file)) {
        candidates.push(path.join(analysisDir, file));
      }
    }
  }
  return Array.from(new Set(candidates)).filter(fileExists);
}

function planStepStats(plan) {
  const steps = plan && plan.bounded_plan && Array.isArray(plan.bounded_plan.steps)
    ? plan.bounded_plan.steps
    : [];
  const counts = { total: steps.length, complete: 0, planned: 0, blocked: 0, other: 0 };
  for (const step of steps) {
    const status = String(step.status || '').toLowerCase();
    if (status === 'complete' || status === 'completed') counts.complete += 1;
    else if (status === 'planned') counts.planned += 1;
    else if (status === 'blocked') counts.blocked += 1;
    else counts.other += 1;
  }
  return counts;
}

function failure(id, severity, expected, observed, evidence, recommendedNextAction) {
  return {
    id,
    severity,
    expected,
    observed,
    evidence,
    recommended_next_action: recommendedNextAction
  };
}

function inspectPlanTarget(projectRoot, target) {
  let resolved = null;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, target);
  } catch {
    resolved = null;
  }

  if (!resolved) {
    return {
      scope: safeSlug(target || 'repo'),
      sourceOfTruth: [],
      reviewedPaths: [],
      plan: null,
      failures: [
        failure(
          'target-not-found',
          'blocker',
          'Review target resolves to a task plan or readable path.',
          `No task plan resolved for "${target || '(empty)'}".`,
          target || '(empty)',
          `/review-progress ${target || 'repo'} after creating or correcting the target reference.`
        )
      ],
      warnings: []
    };
  }

  const parsed = readJsonSafe(resolved.jsonPath);
  const scope = safeSlug(parsed.ok && parsed.data.task_id ? parsed.data.task_id : target);
  const sourceOfTruth = [rel(projectRoot, resolved.jsonPath)];
  const reviewedPaths = [...sourceOfTruth];
  const failures = [];
  const warnings = [];

  if (!fileExists(resolved.markdownPath)) {
    failures.push(failure(
      'paired-markdown-missing',
      'warning',
      'Task plan has a paired markdown summary.',
      'Paired markdown summary is missing.',
      rel(projectRoot, resolved.markdownPath),
      `/amend-plan ${scope}`
    ));
  } else {
    reviewedPaths.push(rel(projectRoot, resolved.markdownPath));
  }

  if (!parsed.ok) {
    failures.push(failure(
      'plan-json-unreadable',
      'blocker',
      'Task plan JSON parses cleanly.',
      parsed.error,
      rel(projectRoot, resolved.jsonPath),
      `/repair-plan ${scope}`
    ));
    return { scope, sourceOfTruth, reviewedPaths, plan: null, failures, warnings };
  }

  const plan = parsed.data;
  const stats = planStepStats(plan);
  const outcome = plan.outcome_delta || null;
  const outcomeArtifactPath = path.join(
    projectRoot,
    '_dev',
    'reports',
    'analysis',
    'task-outcomes',
    `${scope}.json`
  );
  const outcomeArtifact = fileExists(outcomeArtifactPath) ? readJsonSafe(outcomeArtifactPath) : null;
  const durableOutcome = outcomeArtifact && outcomeArtifact.ok
    ? outcomeArtifact.data.outcome_delta
    : null;
  const durableCompletionEvidence = outcomeArtifact && outcomeArtifact.ok && (
    outcomeArtifact.data.completion_evidence
    || (durableOutcome && durableOutcome.completion_evidence)
  );
  const planCompletionEvidence = outcome && outcome.completion_evidence;
  let verificationPassed = false;
  if (durableCompletionEvidence && typeof durableCompletionEvidence.verification_passed === 'boolean') {
    verificationPassed = durableCompletionEvidence.verification_passed;
  } else if (planCompletionEvidence && typeof planCompletionEvidence.verification_passed === 'boolean') {
    verificationPassed = planCompletionEvidence.verification_passed;
  } else if (outcome && typeof outcome.verification_passed === 'boolean') {
    verificationPassed = outcome.verification_passed;
  }
  if (stats.total === 0) {
    failures.push(failure(
      'no-bounded-steps',
      'warning',
      'Plan records bounded_plan.steps for progress review.',
      'No bounded steps recorded.',
      rel(projectRoot, resolved.jsonPath),
      `/amend-plan ${scope}`
    ));
  }
  if (outcome && outcome.completed === true && stats.total > 0 && stats.complete < stats.total) {
    failures.push(failure(
      'completion-claim-with-incomplete-steps',
      'blocker',
      'A completed outcome has all bounded steps marked complete.',
      `${stats.complete}/${stats.total} bounded steps are complete.`,
      rel(projectRoot, resolved.jsonPath),
      `/amend-plan ${scope}`
    ));
  }
  if (outcome && outcome.completed === true && !verificationPassed) {
    failures.push(failure(
      'completion-claim-without-verification',
      'blocker',
      'A completed outcome records verification_passed: true.',
      'Completed outcome does not record verification_passed: true.',
      rel(projectRoot, resolved.jsonPath),
      `/review-progress ${scope}`
    ));
  }

  const related = relatedArtifactPaths(projectRoot, scope);
  for (const item of related) reviewedPaths.push(rel(projectRoot, item));
  if (outcome && outcome.completed === true && !related.some((item) => item.includes('/task-outcomes/'))) {
    warnings.push('Completed plan has no sibling task-outcomes artifact found.');
  }

  return { scope, sourceOfTruth, reviewedPaths: Array.from(new Set(reviewedPaths)), plan, failures, warnings };
}

function renderMarkdown(review) {
  const lines = [];
  lines.push(`# Review Progress: ${review.scope}`);
  lines.push('');
  lines.push(`Reviewed at: ${review.reviewed_at}`);
  lines.push(`Scope: \`${review.scope_input || review.scope}\``);
  lines.push('Mode: REVIEW_ONLY deterministic runner');
  lines.push(`Adapter: \`${review.adapter_id}\` (${review.scope_type})`);
  lines.push(`Structural state: \`${review.structural_state}\``);
  lines.push('Semantic review required: yes');
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  if (review.failures.length === 0) {
    lines.push('No deterministic expectation failures found.');
  } else {
    for (const item of review.failures) {
      lines.push(`### ${item.severity.toUpperCase()}: ${item.id}`);
      lines.push('');
      lines.push(`Expected: ${item.expected}`);
      lines.push('');
      lines.push(`Observed: ${item.observed}`);
      lines.push('');
      lines.push(`Evidence: \`${item.evidence}\``);
      lines.push('');
      lines.push(`Recommended next action: \`${item.recommended_next_action}\``);
      lines.push('');
    }
  }
  if (review.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of review.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  lines.push('## Source Of Truth');
  lines.push('');
  if (review.source_of_truth.length === 0) lines.push('- (none resolved)');
  else for (const item of review.source_of_truth) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Evidence Read');
  lines.push('');
  if (review.reviewed_paths.length === 0) lines.push('- (none)');
  else for (const item of review.reviewed_paths) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Scope Summary');
  lines.push('');
  lines.push(review.summary);
  lines.push('');
  lines.push('## Deterministic Limitation');
  lines.push('');
  lines.push('This handler checks local artifacts and obvious expectation failures. It does not replace a distinct-mind semantic review.');
  lines.push('');
  return lines.join('\n');
}

function writeArtifacts(projectRoot, review) {
  const outputDir = analysisPath(projectRoot, '');
  fs.mkdirSync(outputDir, { recursive: true });
  const base = `review-progress__${review.scope}`;
  const mdPath = path.join(outputDir, `${base}.md`);
  const failuresPath = path.join(outputDir, `${base}.expectation-failures.json`);
  fs.writeFileSync(mdPath, renderMarkdown(review));
  fs.writeFileSync(failuresPath, JSON.stringify({
    scope: review.scope,
    reviewed_at: review.reviewed_at,
    scope_type: review.scope_type,
    adapter_id: review.adapter_id,
    structural_state: review.structural_state,
    semantic_review_required: review.semantic_review_required,
    fallback_reason: review.fallback_reason,
    source_of_truth: review.source_of_truth,
    failures: review.failures
  }, null, 2) + '\n');
  return { markdownPath: mdPath, failuresPath };
}

function buildReviewProgress(projectRoot, target, opts = {}) {
  const inspected = inspectPlanTarget(projectRoot, target || 'repo');
  const isTaskPlan = inspected.sourceOfTruth.some((item) => item.endsWith('__plan.json'));
  const plan = isTaskPlan ? inspected.plan : null;
  const adapted = isTaskPlan ? null : inspectAdapterTarget(projectRoot, target || 'repo', opts);
  const stats = planStepStats(plan);
  const selected = isTaskPlan ? {
    scope: inspected.scope,
    scopeType: 'task-plan',
    adapterId: 'task-plan-v1',
    sourceOfTruth: inspected.sourceOfTruth,
    reviewedPaths: inspected.reviewedPaths,
    failures: inspected.failures,
    warnings: inspected.warnings,
    fallbackReason: inspected.failures.some((item) => item.id === 'plan-json-unreadable') ? 'plan_json_unreadable' : null,
    summary: plan
      ? `Task plan ${inspected.scope}: ${stats.complete}/${stats.total} bounded steps complete; ${inspected.failures.length} deterministic finding(s).`
      : `Task plan ${inspected.scope}: source could not be parsed; ${inspected.failures.length} deterministic finding(s).`
  } : adapted;
  const structuralState = selected.fallbackReason
    ? 'unknown'
    : (selected.failures.length > 0 ? 'findings' : 'structurally_clear');
  const trace = getTraceContext();
  return {
    schema: 'ReviewProgress/2.0',
    scope: safeSlug(selected.scope),
    scope_input: target || '',
    scope_type: selected.scopeType,
    adapter_id: selected.adapterId,
    reviewed_at: (opts.now ? new Date(opts.now) : new Date()).toISOString(),
    structural_state: structuralState,
    semantic_review_required: true,
    fallback_reason: selected.fallbackReason,
    source_of_truth: selected.sourceOfTruth,
    reviewed_paths: Array.from(new Set(selected.reviewedPaths)),
    summary: selected.summary,
    failures: selected.failures,
    warnings: selected.warnings,
    trace_id: trace.trace_id === 'unknown' ? null : trace.trace_id,
    span_id: trace.span_id === 'unknown' ? null : trace.span_id,
    authority: 'report_only'
  };
}

function formatStdout(review, outputs) {
  const lines = [];
  lines.push(`Review progress: ${review.scope}`);
  if (review.failures.length === 0) {
    lines.push('Findings: none from deterministic artifact checks.');
  } else {
    lines.push('Findings:');
    for (const item of review.failures) {
      lines.push(`- ${item.severity.toUpperCase()} ${item.id}: ${item.observed} Evidence: ${item.evidence}`);
    }
  }
  if (outputs) {
    lines.push(`Markdown: ${outputs.markdown}`);
    lines.push(`Expectation failures: ${outputs.expectation_failures}`);
  }
  lines.push(`Summary: ${review.summary}`);
  lines.push(`Structural state: ${review.structural_state}; semantic review required: yes.`);
  lines.push('Limitation: deterministic local checks only; use bridge review for semantic acceptance.');
  return lines.join('\n');
}

function reviewProgress(projectRoot, argsText, options = {}) {
  const target = parseTarget(argsText);
  const review = buildReviewProgress(projectRoot, target, options);
  const outputs = options.write === false ? null : writeArtifacts(projectRoot, review);
  const outputSummary = outputs ? {
    markdown: rel(projectRoot, outputs.markdownPath),
    expectation_failures: rel(projectRoot, outputs.failuresPath)
  } : null;
  const payload = {
    ok: true,
    status: 'review_generated',
    scope: review.scope,
    findings: review.failures.length,
    warnings: review.warnings,
    structural_state: review.structural_state,
    semantic_review_required: review.semantic_review_required,
    adapter_id: review.adapter_id,
    fallback_reason: review.fallback_reason,
    output: outputSummary,
    next_command: review.failures.length > 0
      ? review.failures[0].recommended_next_action
      : `/debrief-run ${review.scope}`
  };
  return {
    exitCode: 0,
    stdout: options.json === false
      ? formatStdout(review, outputSummary)
      : JSON.stringify(payload, null, 2),
    stderr: ''
  };
}

module.exports = {
  buildReviewProgress,
  formatStdout,
  inspectPlanTarget,
  parseTarget,
  renderMarkdown,
  reviewProgress,
  writeArtifacts
};
