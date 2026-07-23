'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { lintPlanAudienceFraming } = require('./plan-audience-framing-lint.cjs');
const { resolveTaskPlanPaths } = require('../../planning/lib/resolve-task-plan.js');

const DEFAULT_AUDIENCES = ['owner', 'media_buyer'];
const DEFAULT_FIELDS = ['what', 'why'];

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function planSteps(plan) {
  if (Array.isArray(plan?.bounded_plan?.steps)) return plan.bounded_plan.steps;
  if (Array.isArray(plan?.steps)) return plan.steps;
  return [];
}

function stepId(step, index) {
  return normalizeText(step.step_id || step.id || `step-${index + 1}`);
}

function sourceFieldForStep(step) {
  if (normalizeText(step.description)) return 'description';
  if (normalizeText(step.summary)) return 'summary';
  if (normalizeText(step.name)) return 'name';
  return 'step_id';
}

function sourceTextForStep(step, index) {
  const sourceField = sourceFieldForStep(step);
  const text = sourceField === 'step_id' ? stepId(step, index) : normalizeText(step[sourceField]);
  return {
    sourceField,
    text: text || stepId(step, index)
  };
}

function provenanceHandleForStep(step, index, sourceField) {
  return `bounded_plan.steps.${stepId(step, index)}.${sourceField}`;
}

function sourceDerivedCandidate({ step, index, field }) {
  const source = sourceTextForStep(step, index);
  const prefix = field === 'what'
    ? 'This is intended to surface the source-plan step'
    : 'The hypothesis is that this preserves the source-plan context';
  return {
    text: `${prefix}: ${source.text}`,
    provenance_handle: provenanceHandleForStep(step, index, source.sourceField),
    source_field: source.sourceField,
    provenance_state: 'source-derived'
  };
}

function isExistingVoicing(value) {
  if (typeof value === 'string') return normalizeText(value).length > 0;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeText(value.text).length > 0;
  }
  return false;
}

function ensureAudienceEntry(step, audience) {
  if (!step.audiences || typeof step.audiences !== 'object' || Array.isArray(step.audiences)) {
    step.audiences = {};
  }
  if (!step.audiences[audience] || typeof step.audiences[audience] !== 'object' || Array.isArray(step.audiences[audience])) {
    step.audiences[audience] = {};
  }
  return step.audiences[audience];
}

function enrichPlanAudiences(plan, options = {}) {
  const enriched = clone(plan);
  const steps = planSteps(enriched);
  const audiences = options.audiences || DEFAULT_AUDIENCES;
  const fields = options.fields || DEFAULT_FIELDS;
  const candidateFactory = options.candidateFactory || sourceDerivedCandidate;
  const preserveExisting = options.preserveExisting !== false;
  const changes = [];

  steps.forEach((step, index) => {
    for (const audience of audiences) {
      const entry = ensureAudienceEntry(step, audience);
      for (const field of fields) {
        if (preserveExisting && isExistingVoicing(entry[field])) {
          continue;
        }
        const candidate = candidateFactory({ plan: enriched, step, index, audience, field });
        entry[field] = {
          text: normalizeText(candidate?.text),
          provenance_handle: normalizeText(candidate?.provenance_handle),
          source_field: normalizeText(candidate?.source_field),
          provenance_state: normalizeText(candidate?.provenance_state || 'source-derived')
        };
        changes.push({
          step_id: stepId(step, index),
          audience,
          field,
          provenance_handle: entry[field].provenance_handle,
          source_field: entry[field].source_field,
          provenance_state: entry[field].provenance_state
        });
      }
    }
  });

  const lint = lintPlanAudienceFraming(enriched, {
    ...(options.lintOptions || {}),
    enrichment: 'offline-source-derived'
  });

  return {
    schema: 'PlanAudienceEnrichment/1.0',
    ok: lint.ok,
    changed: changes.length,
    changes,
    lint,
    plan: enriched
  };
}

function readPlanForEnrichment(projectRoot, planRef) {
  const resolved = resolveTaskPlanPaths(projectRoot, planRef);
  if (!resolved) throw new Error(`No task plan found for ${planRef}`);
  const plan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
  return { resolved, plan };
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function enrichPlanFile(projectRoot, options = {}) {
  const planRef = options.plan || options.planPath;
  if (!planRef) throw new Error('--plan is required');
  const { resolved, plan } = readPlanForEnrichment(projectRoot, planRef);
  const result = enrichPlanAudiences(plan, {
    audiences: options.audiences,
    fields: options.fields,
    preserveExisting: options.preserveExisting,
    lintOptions: {
      plan_path: path.relative(projectRoot, resolved.jsonPath).split(path.sep).join('/')
    }
  });

  const outputPath = options.outputPath ? path.resolve(projectRoot, options.outputPath) : '';
  const writeTarget = options.write ? resolved.jsonPath : outputPath;
  if ((options.write || outputPath) && !result.ok) {
    const codes = result.lint.findings.map((item) => `${item.step_id}/${item.audience}/${item.field}:${item.code}`).join(', ');
    throw new Error(`Plan audience enrichment failed lint; refusing to write: ${codes}`);
  }
  if (writeTarget) {
    writeJsonFile(writeTarget, result.plan);
  }

  return {
    schema: result.schema,
    ok: result.ok,
    source_plan: path.relative(projectRoot, resolved.jsonPath).split(path.sep).join('/'),
    output_plan: writeTarget ? path.relative(projectRoot, writeTarget).split(path.sep).join('/') : '',
    write: Boolean(options.write),
    changed: result.changed,
    changes: result.changes,
    lint: result.lint,
    plan: result.plan
  };
}

module.exports = {
  DEFAULT_AUDIENCES,
  DEFAULT_FIELDS,
  enrichPlanAudiences,
  enrichPlanFile,
  sourceDerivedCandidate
};
