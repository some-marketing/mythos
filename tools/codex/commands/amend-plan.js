'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  resolveTaskPlanPaths,
  OPERATOR_GATE_STATUSES,
  validateOperatorGates
} = require('../../planning/lib/resolve-task-plan');
const { isAuthorityField } = require('../../planning/lib/repair-vs-amend-classifier');

function parseArgs(argsText) {
  const tokens = String(argsText || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return token.slice(1, -1);
    return token;
  }) || [];
  const out = { _: [] };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-/g, '_');
    const next = tokens[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function safeStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function rel(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function buildOperatorGate(args, now) {
  const gateId = String(args.gate_id || '').trim();
  if (!gateId) return null;
  const status = String(args.gate_status || 'open').trim();
  let resolution = args.gate_resolution ? String(args.gate_resolution) : null;
  if (args.gate_resolution_file) {
    resolution = fs.readFileSync(String(args.gate_resolution_file), 'utf8').replace(/\n$/, '');
  }
  const gate = {
    id: gateId,
    status,
    question: args.gate_question ? String(args.gate_question) : null,
    resolution,
    decided_at: status === 'open' ? null : now.toISOString(),
    supersedes_gate_id: args.gate_supersedes ? String(args.gate_supersedes) : null
  };
  return gate;
}

function renderMarkdown(amendment) {
  const lines = [
    `# Plan Amendment: ${amendment.plan_id}`,
    '',
    `- Amendment: \`${amendment.amendment_id}\``,
    `- Timestamp: ${amendment.timestamp}`,
    `- Trigger: ${amendment.trigger}`,
    `- Plan remains executable: ${amendment.plan_still_executable}`,
    '',
    '## Divergences',
    ''
  ];
  if (amendment.divergences.length === 0) {
    lines.push('- No material divergence was supplied. This is a review-request overlay only.');
  } else {
    for (const item of amendment.divergences) {
      lines.push(`- **${item.type}**${item.step_id ? ` (${item.step_id})` : ''}: ${item.observed}`);
      lines.push(`  - Original: ${item.original}`);
      lines.push(`  - Proposed handling: ${item.recommended_action}`);
    }
  }
  if (Array.isArray(amendment.operator_gates) && amendment.operator_gates.length > 0) {
    lines.push('', '## Operator Gates', '');
    for (const gate of amendment.operator_gates) {
      lines.push(`- **${gate.id}** — status: \`${gate.status}\`${gate.decided_at ? ` (decided ${gate.decided_at})` : ''}`);
      if (gate.question) lines.push(`  - Question: ${gate.question}`);
      if (gate.resolution) lines.push(`  - Resolution: ${gate.resolution}`);
      if (gate.supersedes_gate_id) lines.push(`  - Supersedes: \`${gate.supersedes_gate_id}\``);
    }
  }
  lines.push('', '## Exact Next Command', '', `\`${amendment.next_command}\``, '');
  return lines.join('\n');
}

function amendPlan(projectRoot, argsText, options = {}) {
  const args = parseArgs(argsText);
  const ref = String(args._[0] || '').trim();
  if (!ref) return { exitCode: 2, stdout: '', stderr: 'Usage: /amend-plan <task-id|path>' };

  let resolved;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, ref);
  } catch (error) {
    return { exitCode: 2, stdout: '', stderr: error.message };
  }
  if (!resolved || !fs.existsSync(resolved.jsonPath) || !fs.existsSync(resolved.markdownPath)) {
    return { exitCode: 2, stdout: '', stderr: `Task plan pair not found: ${ref}` };
  }

  const requestedField = String(args.field || '').trim();
  if (requestedField && isAuthorityField(requestedField)) {
    return {
      exitCode: 2,
      stdout: `Authority field "${requestedField}" cannot be changed by /amend-plan. Exact next command: /repair-plan ${ref}`,
      stderr: ''
    };
  }

  const plan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
  const before = { json: sha256(resolved.jsonPath), md: sha256(resolved.markdownPath) };
  const now = new Date();
  const amendmentId = `${plan.task_id || ref}__amendment__${safeStamp(now)}`;
  const type = String(args.type || '').trim();
  const divergences = type ? [{
    id: String(args.id || `${amendmentId}__1`),
    type,
    step_id: args.step_id || null,
    original: String(args.original || 'Not supplied'),
    observed: String(args.observed || 'Operator requested an amendment review.'),
    evidence_refs: args.evidence ? [String(args.evidence)] : [],
    recommended_action: String(args.recommended_action || 'Review the overlay before further execution.')
  }] : [];

  const operatorGate = buildOperatorGate(args, now);
  if (args.gate_status && !operatorGate) {
    return { exitCode: 2, stdout: '', stderr: '--gate-status requires --gate-id.' };
  }
  if (operatorGate && !OPERATOR_GATE_STATUSES.has(operatorGate.status)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Invalid --gate-status "${operatorGate.status}". Must be one of: ${Array.from(OPERATOR_GATE_STATUSES).join(', ')}`
    };
  }

  const amendment = {
    schema: operatorGate ? 'PlanAmendment/1.1' : 'PlanAmendment/1.0',
    plan_id: plan.task_id || ref,
    plan_path: rel(projectRoot, resolved.jsonPath),
    amendment_id: amendmentId,
    timestamp: now.toISOString(),
    amended_by_actor_id: 'codex',
    amended_by_harness_id: 'codex-managed-command',
    trigger: String(args.trigger || 'Operator requested deterministic amendment review; no material execution fact was supplied.'),
    divergences,
    risk_reassessment: {
      original_risk_tier: plan.routing_expectations?.risk_tier || 'unknown',
      amended_risk_tier: plan.routing_expectations?.risk_tier || 'unknown',
      original_review_lane: plan.routing_expectations?.review_lane || 'unknown',
      amended_review_lane: plan.routing_expectations?.review_lane || 'unknown',
      rationale: 'No authority change is permitted in an amendment overlay.'
    },
    plan_still_executable: true,
    next_command: `/review-task-plan ${plan.task_id || ref}`,
    supersedes_prior_amendment: null,
    base_plan_hashes: before
  };
  if (operatorGate) {
    amendment.operator_gates = [operatorGate];
    const gateValidation = validateOperatorGates(amendment);
    if (gateValidation.errors.length > 0) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: 'operator_gates validation failed: ' + gateValidation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
      };
    }
  }

  let jsonPath = path.join(resolved.storageRoot, amendmentId + '.json');
  let mdPath = path.join(resolved.storageRoot, amendmentId + '.md');
  // Timestamps have second resolution; two writes in the same second must not
  // silently overwrite an earlier overlay.
  let collisionSuffix = 1;
  while (fs.existsSync(jsonPath) || fs.existsSync(mdPath)) {
    const suffixedId = `${amendmentId}-${collisionSuffix}`;
    jsonPath = path.join(resolved.storageRoot, suffixedId + '.json');
    mdPath = path.join(resolved.storageRoot, suffixedId + '.md');
    amendment.amendment_id = suffixedId;
    collisionSuffix += 1;
  }
  if (options.write === false) {
    return { exitCode: 0, stdout: JSON.stringify(amendment, null, 2), stderr: '', outputs: [] };
  }
  fs.writeFileSync(jsonPath, JSON.stringify(amendment, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(amendment), 'utf8');

  const after = { json: sha256(resolved.jsonPath), md: sha256(resolved.markdownPath) };
  if (before.json !== after.json || before.md !== after.md) {
    try { fs.unlinkSync(jsonPath); } catch {}
    try { fs.unlinkSync(mdPath); } catch {}
    return { exitCode: 2, stdout: '', stderr: 'Base plan changed during amendment write; overlay removed and operation failed closed.' };
  }

  return {
    exitCode: 0,
    stdout: JSON.stringify({
      ok: true,
      status: 'amendment_written',
      task_id: amendment.plan_id,
      base_plan_hashes_unchanged: true,
      outputs: { json: rel(projectRoot, jsonPath), markdown: rel(projectRoot, mdPath) },
      next_command: amendment.next_command
    }, null, 2),
    stderr: '',
    outputs: [rel(projectRoot, jsonPath), rel(projectRoot, mdPath)]
  };
}

module.exports = { amendPlan, parseArgs, renderMarkdown };
