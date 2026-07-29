'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { classifyHarnessPlanOutput } = require('./harness-plan-output-contract');
const { resolveWriteRoot } = require('./resolve-task-plan');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function rel(filePath, rootDir = PROJECT_ROOT) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function resolveInsideProject(projectRoot, relPath, label) {
  const abs = path.resolve(projectRoot, relPath || '');
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, abs);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must resolve inside the project root: ${relPath}`);
  }
  return abs;
}

function markerPathFor(projectRoot, plan, clientCode = null) {
  if (plan.scope_type === 'client') {
    if (!clientCode && !plan.client_code) throw new Error('Client promotion requires --client or plan.client_code.');
    return path.join(projectRoot, 'clients', clientCode || plan.client_code, 'state', 'plan-task-review-state', `${plan.task_id}.json`);
  }
  return path.join(projectRoot, '_dev', 'state', 'plan-task-review-state', `${plan.task_id}.json`);
}

function loadTranslationManifest(manifestPath, projectRoot = PROJECT_ROOT) {
  const absManifest = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(projectRoot, manifestPath);
  const manifest = readJson(absManifest);
  if (manifest.schema !== 'GeminiPlanTranslation/1.0') {
    throw new Error(`Unsupported translation manifest schema "${manifest.schema || '(missing)'}".`);
  }
  const jsonPath = resolveInsideProject(projectRoot, manifest.json_path, 'manifest.json_path');
  const markdownPath = resolveInsideProject(projectRoot, manifest.markdown_path, 'manifest.markdown_path');
  if (!fs.existsSync(jsonPath)) throw new Error(`Candidate JSON not found: ${manifest.json_path}`);
  if (!fs.existsSync(markdownPath)) throw new Error(`Candidate Markdown not found: ${manifest.markdown_path}`);

  return {
    manifest,
    manifestPath: absManifest,
    jsonPath,
    markdownPath
  };
}

function buildPromotedPlan(candidatePlan, promotion) {
  return {
    ...candidatePlan,
    storage_root: promotion.storageRootRel,
    exact_next_command: `/review-task-plan ${candidatePlan.task_id}`,
    candidate_promotion: {
      schema: 'PlanCandidatePromotion/1.0',
      promoted_from: promotion.manifestRel,
      source_json: promotion.sourceJsonRel,
      source_markdown: promotion.sourceMarkdownRel,
      promoted_at: promotion.promotedAt,
      promoted_by: promotion.promotedBy,
      authority_state: 'pending-review',
      next_required_command: `/review-task-plan ${candidatePlan.task_id}`
    },
    outcome_delta: {
      ...(candidatePlan.outcome_delta || {}),
      operator_accepted: false,
      gates_triggered: Array.from(new Set([
        ...((candidatePlan.outcome_delta && candidatePlan.outcome_delta.gates_triggered) || []),
        'candidate-promoted-pending-review'
      ]))
    }
  };
}

function buildReviewState(plan, promotion) {
  return {
    schema: 'PlanTaskReviewState/1.0',
    task_id: plan.task_id,
    plan_id: plan.task_id,
    last_event: 'candidate_promoted_pending_review',
    reviewed_at: null,
    recorded_by: promotion.promotedBy,
    verdict: 'pending-review',
    big: plan.routing_expectations?.risk_tier === 'high',
    distinct_reviews: [],
    distinct_reviews_pending: [
      {
        actor: 'codex-or-distinct-reviewer',
        harness: 'pending',
        artifact: null,
        at: null,
        verdict: 'pending',
        reason: 'Candidate was promoted from Gemini translation output and must pass /review-task-plan before /run-plan.'
      }
    ],
    operator_stamp: null,
    candidate_promotion: {
      manifest: promotion.manifestRel,
      source_json: promotion.sourceJsonRel,
      source_markdown: promotion.sourceMarkdownRel,
      promoted_json: promotion.promotedJsonRel,
      promoted_markdown: promotion.promotedMarkdownRel,
      promoted_at: promotion.promotedAt,
      promoted_by: promotion.promotedBy,
      review_status: 'pending'
    },
    next_command: `/review-task-plan ${plan.task_id}`,
    pipeline_rule: 'candidate promotion -> /review-task-plan -> operator stamp -> /run-plan; promotion is not approval'
  };
}

function promoteGeminiPlanCandidate(opts = {}) {
  const projectRoot = opts.projectRoot || PROJECT_ROOT;
  const promotedBy = opts.promotedBy || 'codex';
  const promotedAt = opts.promotedAt || new Date().toISOString();
  if (!opts.manifestPath) throw new Error('manifestPath is required.');

  const loaded = loadTranslationManifest(opts.manifestPath, projectRoot);
  const candidatePlan = readJson(loaded.jsonPath);
  if (candidatePlan.schema !== 'TaskPlan/1.0') {
    throw new Error(`Candidate plan schema is not TaskPlan/1.0: ${candidatePlan.schema || '(missing)'}`);
  }

  const classification = classifyHarnessPlanOutput({
    jsonPath: loaded.jsonPath,
    markdownPath: loaded.markdownPath,
    harness: 'gemini',
    category: 'adapter_mediated_translator'
  }, { projectRoot });
  if (!classification.ok) {
    throw new Error(`Candidate validation failed: ${classification.operator_message}`);
  }

  const targetScope = opts.scopeType || candidatePlan.scope_type || 'system';
  const clientCode = opts.clientCode || candidatePlan.client_code || null;
  const writeRoot = resolveWriteRoot(projectRoot, targetScope, clientCode);
  const storageRootRel = rel(writeRoot, projectRoot);
  const targetJson = path.join(writeRoot, `${candidatePlan.task_id}__plan.json`);
  const targetMarkdown = path.join(writeRoot, `${candidatePlan.task_id}__plan.md`);
  const markerPath = markerPathFor(projectRoot, { ...candidatePlan, scope_type: targetScope, client_code: clientCode }, clientCode);

  if (!opts.allowOverwrite) {
    for (const target of [targetJson, targetMarkdown, markerPath]) {
      if (fs.existsSync(target)) throw new Error(`Refusing to overwrite existing promotion target: ${rel(target, projectRoot)}`);
    }
  }

  const promotion = {
    manifestRel: rel(loaded.manifestPath, projectRoot),
    sourceJsonRel: rel(loaded.jsonPath, projectRoot),
    sourceMarkdownRel: rel(loaded.markdownPath, projectRoot),
    promotedJsonRel: rel(targetJson, projectRoot),
    promotedMarkdownRel: rel(targetMarkdown, projectRoot),
    storageRootRel,
    promotedAt,
    promotedBy
  };
  const promotedPlan = buildPromotedPlan({
    ...candidatePlan,
    scope_type: targetScope,
    client_code: targetScope === 'client' ? clientCode : candidatePlan.client_code || null
  }, promotion);
  const promotedMarkdown = fs.readFileSync(loaded.markdownPath, 'utf8')
    .replace('This is a translated Gemini candidate. It is not active Mythos plan authority until reviewed and explicitly promoted.', 'This plan was promoted from a translated Gemini candidate. It is pending review and is not approved for /run-plan until /review-task-plan records approval.');
  const reviewState = buildReviewState(promotedPlan, promotion);

  ensureDir(writeRoot);
  ensureDir(path.dirname(markerPath));
  fs.writeFileSync(targetJson, `${JSON.stringify(promotedPlan, null, 2)}\n`, 'utf8');
  fs.writeFileSync(targetMarkdown, promotedMarkdown, 'utf8');
  fs.writeFileSync(markerPath, `${JSON.stringify(reviewState, null, 2)}\n`, 'utf8');

  return {
    schema: 'GeminiPlanCandidatePromotion/1.0',
    task_id: candidatePlan.task_id,
    promoted_json: rel(targetJson, projectRoot),
    promoted_markdown: rel(targetMarkdown, projectRoot),
    review_state: rel(markerPath, projectRoot),
    next_command: `/review-task-plan ${candidatePlan.task_id}`,
    validation: classification,
    hashes: {
      json: sha256Text(JSON.stringify(promotedPlan, null, 2) + '\n'),
      markdown: sha256Text(promotedMarkdown)
    }
  };
}

module.exports = {
  buildPromotedPlan,
  buildReviewState,
  loadTranslationManifest,
  promoteGeminiPlanCandidate
};
