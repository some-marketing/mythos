'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { importCorrections, writeDrawioExport } = require('./drawio-plan-corrections.cjs');
const { resolveTaskPlanPaths } = require('./resolve-task-plan.js');
const {
  buildAttachmentRequest,
  buildDiagramArtifactComment,
  validatePublishUrl
} = require('../../dart-integration/lib/diagram-artifact-links.js');

const VISUAL_ROOT = path.join('_dev', 'reports', 'analysis', 'visual-plans');
const DASHBOARD_PATH = path.join('_dev', 'reports', 'analysis', 'plan-visibility__index.html');
const VISUAL_LIBRARY_PATH = path.join(VISUAL_ROOT, 'index.html');
const EVENT_ENUM = new Set([
  'plan_created',
  'plan_amended',
  'plan_repaired',
  'visual_corrections_imported',
  'plan_completed',
  'session_closeout',
  'manual'
]);

function repoRel(projectRoot, filePath) {
  if (!filePath) return '';
  return path.relative(projectRoot, path.resolve(projectRoot, filePath)).split(path.sep).join('/');
}

function normalizeSlash(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function safeSlug(value) {
  return String(value || 'visual-plan').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function stepStatusSummary(plan) {
  const steps = plan && plan.bounded_plan && Array.isArray(plan.bounded_plan.steps)
    ? plan.bounded_plan.steps
    : [];
  const counts = {};
  for (const step of steps) {
    const status = step && step.status ? String(step.status) : 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return {
    total: steps.length,
    counts,
    steps: steps.map((step) => ({
      step_id: step.step_id || null,
      status: step.status || 'unknown',
      mode: step.mode || null,
      description: step.description || ''
    }))
  };
}

function discoverRelatedArtifacts(projectRoot, taskId) {
  const visualDir = path.join(projectRoot, VISUAL_ROOT);
  if (!fs.existsSync(visualDir)) return [];
  const prefix = `${safeSlug(taskId)}.`;
  const canonical = new Set([
    `${safeSlug(taskId)}.drawio`,
    `${safeSlug(taskId)}.baseline.json`,
    `${safeSlug(taskId)}.publication.json`,
    `${safeSlug(taskId)}.dart-comment.md`
  ]);
  return fs.readdirSync(visualDir)
    .filter((name) => name.startsWith(prefix))
    .filter((name) => !canonical.has(name))
    .sort()
    .map((name) => ({
      label: name,
      path: normalizeSlash(path.join(VISUAL_ROOT, name))
    }));
}

function pendingDrawioCorrections(projectRoot, options = {}) {
  const diagramPath = options.diagramPath;
  const baselinePath = options.baselinePath;
  if (!diagramPath || !baselinePath) return { pending: false, corrections: [] };
  if (!fs.existsSync(path.resolve(projectRoot, diagramPath))) return { pending: false, corrections: [] };
  if (!fs.existsSync(path.resolve(projectRoot, baselinePath))) return { pending: false, corrections: [] };
  try {
    const imported = importCorrections(projectRoot, {
      diagramPath,
      baselinePath,
      importedAt: options.generatedAt || new Date().toISOString()
    });
    const corrections = imported && imported.packet && Array.isArray(imported.packet.corrections)
      ? imported.packet.corrections
      : [];
    return {
      pending: corrections.length > 0,
      corrections
    };
  } catch (error) {
    return {
      pending: true,
      corrections: [],
      error: error.message
    };
  }
}

function assertEvent(eventName) {
  const value = eventName || 'manual';
  if (!EVENT_ENUM.has(value)) {
    throw new Error(`Unknown lifecycle event "${value}". Expected one of: ${Array.from(EVENT_ENUM).join(', ')}`);
  }
  return value;
}

function buildPlanDiagramPublication(projectRoot, options = {}) {
  const taskRef = options.taskId || options.plan;
  if (!taskRef) throw new Error('--plan is required');
  const lifecycleEvent = assertEvent(options.event || 'manual');
  const publishValidation = validatePublishUrl(options.publishUrl || '');
  if (!publishValidation.ok) {
    throw new Error(`Invalid --publish-url: ${publishValidation.reason}`);
  }
  const resolved = resolveTaskPlanPaths(projectRoot, taskRef);
  if (!resolved) throw new Error(`No task plan found for ${taskRef}`);
  const plan = readJson(resolved.jsonPath);
  const taskId = plan.task_id || path.basename(resolved.jsonPath, '__plan.json');
  const generatedAt = options.generatedAt || new Date().toISOString();
  const diagramPath = options.output || path.join(VISUAL_ROOT, `${safeSlug(taskId)}.drawio`);
  const baselinePath = options.baselineOutput || path.join(VISUAL_ROOT, `${safeSlug(taskId)}.baseline.json`);

  if (!options.force) {
    const pending = pendingDrawioCorrections(projectRoot, {
      diagramPath,
      baselinePath,
      generatedAt
    });
    if (pending.pending) {
      const detail = pending.error
        ? ` (${pending.error})`
        : ` (${pending.corrections.length} pending correction(s))`;
      throw new Error(`Refusing to overwrite ${diagramPath}; unimported operator edits may exist${detail}. Re-run with --force only after preserving or importing corrections.`);
    }
  }

  const drawio = writeDrawioExport(projectRoot, {
    taskId,
    includeClient: Boolean(options.includeClient),
    output: diagramPath,
    baselineOutput: baselinePath,
    generatedAt
  });

  const publicationPath = options.publicationOutput || path.join(VISUAL_ROOT, `${safeSlug(taskId)}.publication.json`);
  const commentPath = options.commentOutput || path.join(VISUAL_ROOT, `${safeSlug(taskId)}.dart-comment.md`);
  const artifacts = {
    plan_json: repoRel(projectRoot, resolved.jsonPath),
    plan_markdown: repoRel(projectRoot, resolved.markdownPath),
    diagram: normalizeSlash(drawio.diagramPath),
    baseline: normalizeSlash(drawio.baselinePath),
    publication: normalizeSlash(publicationPath),
    dart_comment_draft: normalizeSlash(commentPath),
    visual_library: VISUAL_LIBRARY_PATH,
    dashboard: DASHBOARD_PATH,
    related: discoverRelatedArtifacts(projectRoot, taskId)
  };
  const publication = {
    schema: 'PlanDiagramPublication/1.0',
    generated_at: generatedAt,
    lifecycle_event: lifecycleEvent,
    source: 'mythos.plan-diagram-publication',
    authority: 'derived_context_only',
    task_id: taskId,
    plan: {
      task_id: taskId,
      title: plan.title || taskId,
      status: plan.status || 'unknown',
      scope_type: plan.scope_type || resolved.resolvedFrom || 'unknown',
      dart_task_id: plan.dart_task_id || null,
      parent_task_id: plan.parent_task_id || null,
      review_lane: plan.routing_expectations && plan.routing_expectations.review_lane || null,
      risk_tier: plan.routing_expectations && plan.routing_expectations.risk_tier || null,
      step_status_summary: stepStatusSummary(plan),
      required_gates: plan.bounded_plan && Array.isArray(plan.bounded_plan.required_gates)
        ? plan.bounded_plan.required_gates
        : []
    },
    artifacts,
    links: {
      publish_url: publishValidation.value || '',
      attachment_request: buildAttachmentRequest({
        taskId: plan.dart_task_id || null,
        publishUrl: publishValidation.value || '',
        title: `Mythos plan diagram: ${plan.title || taskId}`
      })
    },
    dart: {
      task_id: plan.dart_task_id || null,
      comment_path: commentPath,
      apply_comment_allowed: Boolean(plan.dart_task_id),
      apply_comment_precondition: 'Requires existing plan.dart_task_id; this publisher never creates Dart tasks.'
    },
    hook_safety: {
      automatic_hooks_enabled_in_v1: false,
      forbidden_trigger_sources: [
        '_dev/reports/analysis/visual-plans/*.publication.json',
        '_dev/reports/analysis/visual-plans/*.dart-comment.md'
      ],
      future_hook_requirements: [
        'SMOS_PLAN_HOOKS_ENABLED=1',
        'NODE_ENV must not equal test',
        'SMOS_IN_PUBLISH_HOOK=1 re-entrancy guard'
      ]
    }
  };

  const comment = buildDiagramArtifactComment(publication);
  return {
    publication,
    comment,
    paths: {
      publicationPath: normalizeSlash(publicationPath),
      commentPath: normalizeSlash(commentPath),
      diagramPath: normalizeSlash(drawio.diagramPath),
      baselinePath: normalizeSlash(drawio.baselinePath)
    }
  };
}

function writePlanDiagramPublication(projectRoot, options = {}) {
  const built = buildPlanDiagramPublication(projectRoot, options);
  writeText(path.resolve(projectRoot, built.paths.publicationPath), `${JSON.stringify(built.publication, null, 2)}\n`);
  writeText(path.resolve(projectRoot, built.paths.commentPath), `${built.comment}\n`);
  return built;
}

module.exports = {
  EVENT_ENUM,
  assertEvent,
  pendingDrawioCorrections,
  buildPlanDiagramPublication,
  writePlanDiagramPublication
};
