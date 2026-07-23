'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { resolveTaskPlanPaths } = require('../../planning/lib/resolve-task-plan');

const NARRATIVE_SCHEMA = 'TaskPlanNarrativeCompletion/1.0';

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function safeTaskId(value) {
  return String(value || 'task-plan')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'task-plan';
}

function computePlanContentHashes(jsonPath, markdownPath) {
  const json = fs.readFileSync(jsonPath);
  const markdown = fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath) : Buffer.alloc(0);
  const combined = Buffer.concat([
    Buffer.from('plan-json\0'), json,
    Buffer.from('\0plan-markdown\0'), markdown
  ]);
  return {
    plan_content_hash: sha256(combined),
    plan_json_sha256: sha256(json),
    plan_markdown_sha256: sha256(markdown)
  };
}

function parseReviewTaskPlanTarget(command) {
  const text = String(command || '').trim();
  const match = text.match(/^\/review-task-plan\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (!match) return '';
  const target = match[1] || match[2] || match[3] || '';
  if (!target || target.startsWith('--')) return '';
  if (/\s--(?:approve|reject)(?:\s|$)/.test(text)) return '';
  return target;
}

function resolveReviewOutputOverride(projectRoot, taskId, override) {
  if (!override || typeof override !== 'object') return null;
  const outputDir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'task-plan-reviews');
  const id = safeTaskId(taskId);
  const jsonInput = String(override.json || override.json_path || '').trim();
  const markdownInput = String(override.markdown || override.markdown_path || '').trim();
  if (!jsonInput || !markdownInput) {
    throw new Error('Review output override must provide both JSON and Markdown paths.');
  }
  const jsonPath = path.isAbsolute(jsonInput) ? path.resolve(jsonInput) : path.resolve(projectRoot, jsonInput);
  const markdownPath = path.isAbsolute(markdownInput) ? path.resolve(markdownInput) : path.resolve(projectRoot, markdownInput);
  for (const [label, filePath, extension] of [
    ['JSON', jsonPath, '.json'],
    ['Markdown', markdownPath, '.md']
  ]) {
    const relative = path.relative(outputDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(relative) !== '.') {
      throw new Error(`Review output override ${label} must stay in ${path.relative(projectRoot, outputDir)}.`);
    }
    if (!path.basename(filePath).startsWith(`${id}__review`) || path.extname(filePath) !== extension) {
      throw new Error(`Review output override ${label} must be a ${id}__review*${extension} artifact.`);
    }
  }
  return { json: jsonPath, markdown: markdownPath };
}

function reviewArtifactPaths(projectRoot, taskId, override = null) {
  const outputDir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'task-plan-reviews');
  const id = safeTaskId(taskId);
  const resolvedOverride = resolveReviewOutputOverride(projectRoot, taskId, override);
  return {
    canonical_json: resolvedOverride ? resolvedOverride.json : path.join(outputDir, `${id}__review.json`),
    canonical_markdown: resolvedOverride ? resolvedOverride.markdown : path.join(outputDir, `${id}__review.md`),
    scratch_json: path.join(outputDir, `${id}__review.structural-precheck.json`),
    scratch_markdown: path.join(outputDir, `${id}__review.structural-precheck.md`)
  };
}

function buildNarrativeRunContract(projectRoot, signalInfo, runId) {
  const command = signalInfo && signalInfo.signal
    ? signalInfo.signal.recommended_next_command
    : '';
  const target = parseReviewTaskPlanTarget(command);
  if (!target) return null;

  const resolved = resolveTaskPlanPaths(projectRoot, target);
  if (!resolved) return null;
  const plan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
  const taskId = plan.task_id || path.basename(resolved.jsonPath).replace(/__plan\.json$/, '');
  const hashes = computePlanContentHashes(resolved.jsonPath, resolved.markdownPath);
  const reviewOutput = signalInfo && signalInfo.signal && signalInfo.signal.execution
    ? signalInfo.signal.execution.review_output
    : null;
  const artifacts = reviewArtifactPaths(projectRoot, taskId, reviewOutput);

  return {
    schema: NARRATIVE_SCHEMA,
    run_id: String(runId),
    task_id: taskId,
    target,
    ...hashes,
    plan_json_path: resolved.jsonPath,
    plan_markdown_path: resolved.markdownPath,
    ...artifacts
  };
}

function relativeContract(projectRoot, contract) {
  if (!contract) return null;
  const result = { ...contract };
  for (const key of [
    'plan_json_path', 'plan_markdown_path', 'canonical_json', 'canonical_markdown',
    'scratch_json', 'scratch_markdown'
  ]) {
    result[key] = path.relative(projectRoot, contract[key]);
  }
  return result;
}

function renderNarrativeContractPrompt(projectRoot, contract) {
  if (!contract) return '';
  const rel = relativeContract(projectRoot, contract);
  const markdownBinding = JSON.stringify({
    schema: NARRATIVE_SCHEMA,
    run_id: contract.run_id,
    plan_content_hash: contract.plan_content_hash,
    status: 'complete'
  });
  return [
    '',
    '## Required /review-task-plan narrative completion contract',
    '',
    `This bridge run is \`${contract.run_id}\` and reviews plan content hash \`${contract.plan_content_hash}\`.`,
    `The deterministic command writes precheck-only scratch files at \`${rel.scratch_json}\` and \`${rel.scratch_markdown}\`; they are not a verdict and must never be copied over the canonical pair.`,
    `After running the command, read \`${rel.plan_json_path}\`, \`${rel.plan_markdown_path}\`, and the active amendment/repair evidence in full. Form the substantive narrative judgment, then write the canonical pair at \`${rel.canonical_json}\` and \`${rel.canonical_markdown}\`.`,
    'The canonical JSON must keep `schema: "TaskPlanReview/1.0"` and include exactly this completion object:',
    '```json',
    JSON.stringify({
      schema: NARRATIVE_SCHEMA,
      run_id: contract.run_id,
      plan_content_hash: contract.plan_content_hash,
      plan_json_sha256: contract.plan_json_sha256,
      plan_markdown_sha256: contract.plan_markdown_sha256,
      status: 'complete'
    }, null, 2),
    '```',
    'under the key `narrative_completion`.',
    'The canonical Markdown must contain this exact machine-readable line:',
    `\`<!-- sm_os_narrative_completion: ${markdownBinding} -->\``,
    'Do not report the review complete until both canonical files carry this run/hash binding. A successful CLI exit without the bound pair is classified as `narrative_incomplete`.',
    ''
  ].join('\n');
}

function readMarkdownBinding(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/<!--\s*sm_os_narrative_completion:\s*(\{[^\n]+\})\s*-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

function checkNarrativeCompletion(projectRoot, contract) {
  if (!contract) return { required: false, complete: true, reasons: [] };
  const reasons = [];
  let currentHashes;
  try {
    currentHashes = computePlanContentHashes(contract.plan_json_path, contract.plan_markdown_path);
    if (currentHashes.plan_content_hash !== contract.plan_content_hash) {
      reasons.push('reviewed plan content changed during the narrative run');
    }
  } catch (err) {
    reasons.push(`reviewed plan content could not be rehashed: ${err.message}`);
  }

  for (const [label, scratchPath] of [['JSON', contract.scratch_json], ['Markdown', contract.scratch_markdown]]) {
    if (!fs.existsSync(scratchPath)) {
      reasons.push(`structural precheck ${label} missing: ${path.relative(projectRoot, scratchPath)}`);
    }
  }
  if (fs.existsSync(contract.scratch_json)) {
    try {
      const scratch = JSON.parse(fs.readFileSync(contract.scratch_json, 'utf8'));
      const expected = scratch.narrative_completion_expected || {};
      if (expected.run_id !== contract.run_id || expected.plan_content_hash !== contract.plan_content_hash) {
        reasons.push('structural precheck JSON is not bound to this run and plan content hash');
      }
    } catch (err) {
      reasons.push(`structural precheck JSON unreadable: ${err.message}`);
    }
  }

  let jsonBinding = null;
  if (!fs.existsSync(contract.canonical_json)) {
    reasons.push(`canonical review JSON missing: ${path.relative(projectRoot, contract.canonical_json)}`);
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(contract.canonical_json, 'utf8'));
      if (parsed.schema !== 'TaskPlanReview/1.0') {
        reasons.push('canonical review JSON has wrong review schema');
      }
      jsonBinding = parsed.narrative_completion || null;
    } catch (err) {
      reasons.push(`canonical review JSON unreadable: ${err.message}`);
    }
  }

  let markdownBinding = null;
  if (!fs.existsSync(contract.canonical_markdown)) {
    reasons.push(`canonical review Markdown missing: ${path.relative(projectRoot, contract.canonical_markdown)}`);
  } else {
    try {
      markdownBinding = readMarkdownBinding(contract.canonical_markdown);
    } catch (err) {
      reasons.push(`canonical review Markdown unreadable: ${err.message}`);
    }
  }

  for (const [label, binding] of [['JSON', jsonBinding], ['Markdown', markdownBinding]]) {
    if (!binding) {
      reasons.push(`canonical review ${label} lacks narrative completion binding`);
      continue;
    }
    if (binding.schema !== NARRATIVE_SCHEMA) reasons.push(`canonical review ${label} has wrong narrative schema`);
    if (binding.run_id !== contract.run_id) reasons.push(`canonical review ${label} is not bound to run ${contract.run_id}`);
    if (binding.plan_content_hash !== contract.plan_content_hash) reasons.push(`canonical review ${label} is not bound to the reviewed plan hash`);
    if (binding.status !== 'complete') reasons.push(`canonical review ${label} narrative status is not complete`);
  }

  if (jsonBinding) {
    if (jsonBinding.plan_json_sha256 !== contract.plan_json_sha256) reasons.push('canonical review JSON has wrong plan JSON hash');
    if (jsonBinding.plan_markdown_sha256 !== contract.plan_markdown_sha256) reasons.push('canonical review JSON has wrong plan Markdown hash');
  }

  return {
    required: true,
    complete: reasons.length === 0,
    reasons,
    contract: relativeContract(projectRoot, contract),
    scratch_present: fs.existsSync(contract.scratch_json) || fs.existsSync(contract.scratch_markdown)
  };
}

module.exports = {
  NARRATIVE_SCHEMA,
  buildNarrativeRunContract,
  checkNarrativeCompletion,
  computePlanContentHashes,
  parseReviewTaskPlanTarget,
  readMarkdownBinding,
  relativeContract,
  renderNarrativeContractPrompt,
  resolveReviewOutputOverride,
  reviewArtifactPaths,
  safeTaskId
};
