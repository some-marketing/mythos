'use strict';

const fs = require('fs');
const path = require('path');

const { validate } = require('../../verify/lib/schema.cjs');
const { readJsonAsYaml } = require('../../instructions/lib/io');
const { validateTaskPlan } = require('./validate-task-plan');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONTRACT_REL_PATH = 'instructions/canonical/harness-plan-output-contract.yaml';
const TASK_PLAN_SCHEMA_REL_PATH = 'tools/planning/task-intake.schema.json';
const NON_AUTHORITY_WARNING = '[NON-AUTHORITY PREVIEW - UNSAFE FOR RUN-PLAN]';

function rel(filePath, rootDir = PROJECT_ROOT) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function resolveMaybe(rootDir, filePath) {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
}

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function loadContract(rootDir = PROJECT_ROOT) {
  return readJsonAsYaml(path.join(rootDir, CONTRACT_REL_PATH));
}

function readJsonCandidate(jsonPath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) };
  } catch (error) {
    return { ok: false, error };
  }
}

function pushIssue(issues, pathValue, message, recommendedRoute = 'repair-plan') {
  issues.push({
    path: pathValue || '/',
    message,
    operator_message: message,
    recommended_route: recommendedRoute
  });
}

function hasPlanLikeShape(value) {
  return Boolean(value && typeof value === 'object' && (
    value.schema === 'TaskPlan/1.0'
    || value.task_id
    || value.title
    || value.bounded_plan
    || value.current_state
    || value.question_work
    || value.desired_state
  ));
}

function statusForNonJson(category, markdownPath) {
  if (category === 'unsupported') return 'unsupported';
  if (category === 'adapter_mediated_translator') return 'adapter_needed';
  if (category === 'native_canonical_writer' || category === 'repo_tool_mediated_writer') return 'repair_needed';
  if (markdownPath) return 'preview_only';
  return 'unsupported';
}

function classifyHarnessPlanOutput(input = {}, opts = {}) {
  const rootDir = opts.projectRoot || PROJECT_ROOT;
  const contract = opts.contract || loadContract(rootDir);
  const jsonPath = resolveMaybe(rootDir, input.jsonPath || input.planJsonPath || '');
  const markdownPath = resolveMaybe(rootDir, input.markdownPath || input.planMarkdownPath || '');
  const category = input.category || input.harnessCategory || 'unknown';
  const issues = [];
  const warnings = [];
  const evidence = {
    contract_path: CONTRACT_REL_PATH,
    json_path: jsonPath ? rel(jsonPath, rootDir) : null,
    markdown_path: markdownPath ? rel(markdownPath, rootDir) : null,
    harness: input.harness || null,
    category
  };

  if (!jsonPath || !exists(jsonPath)) {
    const status = statusForNonJson(category, markdownPath);
    const hasMarkdown = exists(markdownPath);
    const message = hasMarkdown
      ? 'Markdown or visual plan output exists, but no canonical TaskPlan/1.0 JSON was provided.'
      : 'No canonical TaskPlan/1.0 JSON was provided.';
    pushIssue(
      issues,
      '/jsonPath',
      `${message} Create or repair canonical JSON before /run-plan.`,
      status === 'adapter_needed' ? 'adapter-review' : 'plan-task'
    );
    return {
      schema: 'HarnessPlanOutputClassification/1.0',
      ok: false,
      status,
      runnable: false,
      visual_warning: NON_AUTHORITY_WARNING,
      operator_message: contract.statuses.find((entry) => entry.id === status)?.operator_message || message,
      evidence,
      issues,
      warnings
    };
  }

  const parsed = readJsonCandidate(jsonPath);
  if (!parsed.ok) {
    pushIssue(issues, '/json', `Candidate JSON could not be parsed: ${parsed.error.message}`, 'repair-plan');
    return {
      schema: 'HarnessPlanOutputClassification/1.0',
      ok: false,
      status: 'invalid',
      runnable: false,
      visual_warning: NON_AUTHORITY_WARNING,
      operator_message: 'The candidate artifact could not be parsed or inspected safely.',
      evidence,
      issues,
      warnings
    };
  }

  const plan = parsed.value;
  if (plan.schema !== 'TaskPlan/1.0') {
    const status = hasPlanLikeShape(plan) ? 'repair_needed' : statusForNonJson(category, markdownPath);
    pushIssue(
      issues,
      '/schema',
      `Candidate schema "${plan.schema || '(missing)'}" is not TaskPlan/1.0.`,
      status === 'adapter_needed' ? 'adapter-review' : 'repair-plan'
    );
    return {
      schema: 'HarnessPlanOutputClassification/1.0',
      ok: false,
      status,
      runnable: false,
      visual_warning: NON_AUTHORITY_WARNING,
      operator_message: status === 'adapter_needed'
        ? 'Plan-like output requires a reviewed adapter before it can become TaskPlan/1.0 authority.'
        : 'Plan-like JSON exists, but it must be repaired before /run-plan.',
      evidence,
      issues,
      warnings
    };
  }

  const taskPlanSchema = JSON.parse(fs.readFileSync(path.join(rootDir, TASK_PLAN_SCHEMA_REL_PATH), 'utf8'));
  const schemaErrors = validate(plan, taskPlanSchema, { rootSchema: taskPlanSchema, path: '' });
  const routeResult = validateTaskPlan(plan, { projectRoot: rootDir });

  for (const error of schemaErrors) {
    pushIssue(issues, error.path || '/', `TaskPlan schema error: ${error.message}`, 'repair-plan');
  }
  for (const error of routeResult.errors || []) {
    pushIssue(issues, error.path || '/', `Methodology routing error: ${error.message}`, 'repair-plan');
  }
  for (const warning of routeResult.warnings || []) {
    warnings.push({
      path: warning.path || '/',
      message: warning.message,
      operator_message: warning.message,
      recommended_route: 'review-task-plan'
    });
  }
  if (markdownPath && !exists(markdownPath)) {
    warnings.push({
      path: '/markdownPath',
      message: 'Paired Markdown was declared but does not exist.',
      operator_message: 'The runnable JSON can be inspected, but the operator-readable paired Markdown is missing.',
      recommended_route: 'repair-plan'
    });
  }

  const ok = schemaErrors.length === 0 && routeResult.ok;
  return {
    schema: 'HarnessPlanOutputClassification/1.0',
    ok,
    status: ok ? 'canonical' : 'repair_needed',
    runnable: ok,
    visual_warning: ok ? null : NON_AUTHORITY_WARNING,
    operator_message: ok
      ? 'Canonical TaskPlan/1.0 JSON passed schema and methodology validation.'
      : 'Plan-like JSON exists, but it must be repaired before /run-plan.',
    evidence,
    issues,
    warnings
  };
}

module.exports = {
  CONTRACT_REL_PATH,
  NON_AUTHORITY_WARNING,
  classifyHarnessPlanOutput,
  loadContract
};
