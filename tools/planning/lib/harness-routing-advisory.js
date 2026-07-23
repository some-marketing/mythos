'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_COMPARISON_PATH = path.join(
  DEFAULT_PROJECT_ROOT,
  '_dev',
  'reports',
  'analysis',
  'harness-capability-comparison.json'
);

const DEFAULT_STALE_HOURS = 48;

const STATE_SCORE = Object.freeze({
  native: 6,
  repo_emulated: 5,
  adapter_mediated: 4,
  review_only: 3,
  candidate_only: 2,
  unknown: 1,
  unsupported: 0,
  not_applicable: -1
});

const ROLE_CAPABILITIES = Object.freeze({
  planning: ['plan_authority', 'context_cross_session', 'operator_surfaces'],
  execution: ['runtime_entrypoints', 'mcp_tools', 'lifecycle_hooks'],
  review: ['bridge_convene_suitability', 'plan_authority', 'operator_surfaces'],
  bridge_convene: ['bridge_convene_suitability', 'delegation_orchestration', 'runtime_entrypoints'],
  operator_surfaces: ['operator_surfaces', 'context_cross_session', 'plan_authority']
});

function rel(filePath, projectRoot = DEFAULT_PROJECT_ROOT) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function comparisonPath(projectRoot, opts = {}) {
  if (opts.comparisonPath) {
    return path.isAbsolute(opts.comparisonPath)
      ? opts.comparisonPath
      : path.join(projectRoot, opts.comparisonPath);
  }
  return path.join(projectRoot, '_dev', 'reports', 'analysis', 'harness-capability-comparison.json');
}

function parseTime(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function modelFreshness(model, filePath, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const staleHours = Number.isFinite(opts.staleHours) ? opts.staleHours : DEFAULT_STALE_HOURS;
  const timestamp = parseTime(model && (model.timestamp || model.inventory_timestamp));
  const warnings = [];

  if (!timestamp) {
    warnings.push('Harness comparison timestamp is missing or invalid.');
    return {
      state: 'unknown',
      timestamp: null,
      age_hours: null,
      stale_after_hours: staleHours,
      warnings
    };
  }

  const ageHours = Math.max(0, (now.getTime() - timestamp.getTime()) / 3600000);
  if (ageHours > staleHours) {
    warnings.push(`Harness comparison is stale: ${ageHours.toFixed(1)}h old; refresh with npm run harness:capability:comparison.`);
  }

  return {
    state: ageHours > staleHours ? 'stale' : 'fresh',
    timestamp: timestamp.toISOString(),
    age_hours: Number(ageHours.toFixed(2)),
    stale_after_hours: staleHours,
    source_path: rel(filePath, opts.projectRoot || DEFAULT_PROJECT_ROOT),
    warnings
  };
}

function validateModelShape(model) {
  const errors = [];
  if (!model || typeof model !== 'object') errors.push('model is not an object');
  if (model && model.schema !== 'HarnessCapabilityComparison/1.0') errors.push('schema is not HarnessCapabilityComparison/1.0');
  if (model && !Array.isArray(model.matrix)) errors.push('matrix is missing');
  if (model && !Array.isArray(model.columns)) errors.push('columns are missing');
  return errors;
}

function coverageSummary(model) {
  const coverage = model && model.comparison_coverage && typeof model.comparison_coverage === 'object'
    ? model.comparison_coverage
    : {};
  const requiredSubjects = Array.isArray(coverage.required_subjects) ? coverage.required_subjects : [];
  const presentSubjects = Array.isArray(coverage.present_subjects) ? coverage.present_subjects : [];
  const missingSubjects = Array.isArray(coverage.missing_subjects) ? coverage.missing_subjects : [];
  const findings = Array.isArray(coverage.findings) ? coverage.findings : [];
  const warnings = [];

  for (const subject of missingSubjects) {
    warnings.push(`Harness comparison coverage is incomplete: required subject "${subject}" is missing from inventory.`);
  }
  for (const finding of findings) {
    if (finding && finding.harness && finding.observed && !missingSubjects.includes(finding.harness)) {
      warnings.push(`Harness comparison coverage finding for ${finding.harness}: ${finding.observed}`);
    }
  }

  return {
    state: missingSubjects.length > 0 || findings.length > 0 ? 'warning' : 'ok',
    required_subjects: requiredSubjects,
    present_subjects: presentSubjects,
    missing_subjects: missingSubjects,
    findings,
    warnings
  };
}

function capabilityMap(row) {
  const out = {};
  for (const capability of row.capabilities || []) {
    if (capability && capability.id) out[capability.id] = capability;
  }
  return out;
}

function scoreCapability(capability) {
  if (!capability) return 0;
  return STATE_SCORE[capability.state] ?? 0;
}

function scoreHarness(row, capabilityIds) {
  const caps = capabilityMap(row);
  let total = 0;
  let counted = 0;
  for (const id of capabilityIds) {
    const score = scoreCapability(caps[id]);
    if (score >= 0) {
      total += score;
      counted += 1;
    }
  }
  return counted ? total / counted : 0;
}

function bestEvidence(row, capabilityIds) {
  const caps = capabilityMap(row);
  for (const id of capabilityIds) {
    const cap = caps[id];
    if (cap && cap.evidence_path) {
      return {
        capability: id,
        state: cap.state || 'unknown',
        evidence_kind: cap.evidence_kind || 'unknown',
        evidence_path: cap.evidence_path,
        freshness: cap.freshness || ''
      };
    }
  }
  return {
    capability: capabilityIds[0] || 'unknown',
    state: 'unknown',
    evidence_kind: 'unknown',
    evidence_path: '',
    freshness: ''
  };
}

function caveatsForHarness(row) {
  const caps = capabilityMap(row);
  const caveats = [];
  if (row.harness === 'codex' && caps.lifecycle_hooks && caps.lifecycle_hooks.state === 'repo_emulated') {
    caveats.push('Codex lifecycle hooks are repo-emulated, not native.');
  }
  if (row.harness === 'gemini' && caps.plan_authority && caps.plan_authority.state === 'candidate_only') {
    caveats.push('Gemini plan output is candidate-only until translated/promoted and reviewed.');
  }
  if (caps.plan_authority && ['unsupported', 'unknown', 'candidate_only'].includes(caps.plan_authority.state)) {
    caveats.push(`Plan authority is ${caps.plan_authority.state}; do not treat this harness as directly runnable for Mythos task plans.`);
  }
  return caveats;
}

function rankForRole(model, role, opts = {}) {
  const capabilityIds = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES.planning;
  const rows = Array.isArray(model.matrix) ? model.matrix : [];
  return rows
    .map((row) => ({
      harness: row.harness,
      score: Number(scoreHarness(row, capabilityIds).toFixed(2)),
      evidence: bestEvidence(row, capabilityIds),
      caveats: caveatsForHarness(row)
    }))
    .sort((a, b) => b.score - a.score || String(a.harness).localeCompare(String(b.harness)))
    .slice(0, opts.limit || 2);
}

function buildHarnessRoutingAdvisory(projectRoot = DEFAULT_PROJECT_ROOT, opts = {}) {
  const sourcePath = comparisonPath(projectRoot, opts);
  const task = String(opts.task || opts.taskDescription || '').trim();
  if (!fs.existsSync(sourcePath)) {
    return {
      schema: 'HarnessRoutingAdvisory/1.0',
      status: 'warning',
      task,
      source_path: rel(sourcePath, projectRoot),
      warnings: [
        'Harness capability comparison is missing; refresh with npm run harness:capability:comparison.'
      ],
      roles: {},
      safeguards: advisorySafeguards()
    };
  }

  let model;
  try {
    model = readJson(sourcePath);
  } catch (error) {
    return {
      schema: 'HarnessRoutingAdvisory/1.0',
      status: 'warning',
      task,
      source_path: rel(sourcePath, projectRoot),
      warnings: [`Harness capability comparison could not be parsed: ${error.message}`],
      roles: {},
      safeguards: advisorySafeguards()
    };
  }

  const shapeErrors = validateModelShape(model);
  const freshness = modelFreshness(model, sourcePath, { ...opts, projectRoot });
  const coverage = coverageSummary(model);
  const warnings = [...shapeErrors, ...freshness.warnings, ...coverage.warnings];
  if (shapeErrors.length > 0) {
    return {
      schema: 'HarnessRoutingAdvisory/1.0',
      status: 'warning',
      task,
      source_path: rel(sourcePath, projectRoot),
      freshness,
      comparison_coverage: coverage,
      warnings,
      roles: {},
      safeguards: advisorySafeguards()
    };
  }

  const roles = {};
  for (const role of Object.keys(ROLE_CAPABILITIES)) {
    roles[role] = {
      capability_ids: ROLE_CAPABILITIES[role],
      recommendations: rankForRole(model, role, { limit: opts.limit || 2 })
    };
  }

  return {
    schema: 'HarnessRoutingAdvisory/1.0',
    status: freshness.state === 'stale' || coverage.state === 'warning' ? 'warning' : 'ok',
    task,
    source_path: rel(sourcePath, projectRoot),
    freshness,
    comparison_coverage: coverage,
    warnings,
    roles,
    safeguards: advisorySafeguards()
  };
}

function advisorySafeguards() {
  return [
    'Advisory only: does not dispatch actors or execute routes.',
    'Does not mutate adapter declarations, hooks, skills, plugins, MCP servers, Dart, or task plans.',
    'Does not approve or promote candidate plans.'
  ];
}

function formatRecommendation(item) {
  const evidence = item.evidence || {};
  const caveat = item.caveats && item.caveats.length ? ` Caveat: ${item.caveats[0]}` : '';
  return `${item.harness} (${evidence.capability}: ${evidence.state}; evidence: ${evidence.evidence_path || 'not-recorded'}; freshness: ${evidence.freshness || 'not-recorded'}).${caveat}`;
}

function formatHarnessRoutingAdvisory(advisory) {
  const lines = [];
  lines.push('Harness routing advisory:');
  if (advisory?.comparison_coverage) {
    const coverage = advisory.comparison_coverage;
    lines.push(`- Coverage: ${coverage.present_subjects.length}/${coverage.required_subjects.length} required harness subjects present; missing ${coverage.missing_subjects.length}.`);
  }
  if (!advisory || advisory.status === 'warning') {
    for (const warning of advisory?.warnings || ['Harness routing advisory unavailable.']) {
      lines.push(`- Warning: ${warning}`);
    }
  }

  const roles = advisory?.roles || {};
  for (const role of ['planning', 'execution', 'review', 'bridge_convene', 'operator_surfaces']) {
    const recommendations = roles[role]?.recommendations || [];
    if (recommendations.length === 0) continue;
    lines.push(`- ${role}: ${recommendations.map(formatRecommendation).join(' | ')}`);
  }

  for (const safeguard of advisory?.safeguards || advisorySafeguards()) {
    lines.push(`- ${safeguard}`);
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_COMPARISON_PATH,
  ROLE_CAPABILITIES,
  advisorySafeguards,
  buildHarnessRoutingAdvisory,
  caveatsForHarness,
  formatHarnessRoutingAdvisory,
  coverageSummary,
  modelFreshness,
  rankForRole,
  validateModelShape
};
