'use strict';

const OBSERVATIONAL_MARKER_RE = /\b(intended to|intended-to|hypothesis|consistent with|observed|observation|appears to|may|might|could|designed to|aims to|planned to)\b/i;
const CAUSAL_RE = /\b(this will|will|closes?|reduces?|increases?|because|drives?|captures?|converts?|improves?|boosts?|creates?|prevents?|solves?)\b/i;
const EVALUATIVE_RE = /\b(better|best|highest[- ]leverage|low[- ]risk|textbook|obvious|clearly|easy win|guaranteed|likely captures?)\b/i;
const OBSERVATIONAL_STATE = new Set(['source-derived', 'enriched', 'authored', 'needs-authoring']);

function normalizeText(value) {
  return String(value || '').trim();
}

function compact(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function cloneSourcePlan(plan) {
  const cloned = JSON.parse(JSON.stringify(plan || {}));
  const steps = cloned && cloned.bounded_plan && Array.isArray(cloned.bounded_plan.steps)
    ? cloned.bounded_plan.steps
    : [];
  for (const step of steps) {
    delete step.audiences;
  }
  return cloned;
}

function sourceCorpusForPlan(plan) {
  return JSON.stringify(cloneSourcePlan(plan)).toLowerCase();
}

function extractNumbers(text) {
  const values = new Set();
  for (const match of normalizeText(text).matchAll(/\$?\b\d+(?:[,.]\d+)*(?:\s*[-–]\s*\d+(?:[,.]\d+)*)?(?:\s*\/\s*[a-z]+)?%?\b/g)) {
    values.add(compact(match[0]).toLowerCase());
  }
  return [...values];
}

function extractEntities(text) {
  const ignored = new Set([
    'Owner', 'Media', 'Buyer', 'What', 'Why', 'This', 'The', 'A', 'An', 'It',
    'So', 'If', 'When', 'Stage', 'Build', 'Patch', 'Review', 'Gate'
  ]);
  const entities = new Set();
  for (const match of normalizeText(text).matchAll(/\b[A-Z][A-Za-z0-9&._-]*(?:\s+[A-Z][A-Za-z0-9&._-]*){0,4}\b/g)) {
    const entity = compact(match[0]);
    if (!entity || ignored.has(entity)) continue;
    if (/^[A-Z]$/.test(entity)) continue;
    entities.add(entity);
  }
  return [...entities];
}

function sourceContains(sourceCorpus, value) {
  const needle = compact(value).toLowerCase();
  if (!needle) return true;
  return sourceCorpus.includes(needle);
}

function splitSentences(text) {
  const normalized = compact(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizeAudienceField(entry, field) {
  if (!entry || typeof entry !== 'object') {
    return { text: '', provenance_handle: '', source_field: '', provenance_state: '', shape: 'missing' };
  }

  const raw = entry[field];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      text: normalizeText(raw.text),
      provenance_handle: normalizeText(raw.provenance_handle),
      source_field: normalizeText(raw.source_field),
      provenance_state: normalizeText(raw.provenance_state),
      shape: 'nested'
    };
  }

  return {
    text: normalizeText(raw),
    provenance_handle: normalizeText(entry[`${field}_provenance`]),
    source_field: normalizeText(entry[`${field}_source_field`] || entry.source_field),
    provenance_state: normalizeText(entry[`${field}_provenance_state`] || entry.provenance_state || entry.source),
    shape: raw == null ? 'missing' : 'flat'
  };
}

function claimTypesForText(text) {
  const claimTypes = new Set();
  if (CAUSAL_RE.test(text)) claimTypes.add('causal');
  if (EVALUATIVE_RE.test(text)) claimTypes.add('evaluative');
  if (/\$|\b\d/.test(text)) claimTypes.add('quantitative');
  if (/\b(risk|gate|decision|approve|approval|dependency|depends)\b/i.test(text)) claimTypes.add('risk-decision');
  return [...claimTypes].sort();
}

function finding({ step, audience, field, code, severity = 'error', message, text, value }) {
  return {
    step_id: normalizeText(step && step.step_id),
    audience,
    field,
    code,
    severity,
    message,
    value: value == null ? '' : String(value),
    text: compact(text).slice(0, 240)
  };
}

function lintAudienceField({ plan, step, audience, field, normalized, sourceCorpus }) {
  const findings = [];
  const text = normalized.text;
  if (!text) return findings;

  for (const sentence of splitSentences(text)) {
    const risky = CAUSAL_RE.test(sentence) || EVALUATIVE_RE.test(sentence);
    if (risky && !OBSERVATIONAL_MARKER_RE.test(sentence)) {
      findings.push(finding({
        step,
        audience,
        field,
        code: 'non_observational_framing',
        message: 'Audience voicing uses causal/evaluative framing without observational language.',
        text: sentence
      }));
    }
  }

  if (!normalized.provenance_handle) {
    findings.push(finding({
      step,
      audience,
      field,
      code: 'missing_provenance_handle',
      message: 'Audience voicing needs an exportable per-item provenance handle.',
      text
    }));
  }

  if (normalized.shape === 'nested') {
    if (!normalized.source_field) {
      findings.push(finding({
        step,
        audience,
        field,
        code: 'missing_source_field',
        message: 'Nested audience voicing needs source_field so the claim can be traced.',
        text
      }));
    }
    if (!OBSERVATIONAL_STATE.has(normalized.provenance_state)) {
      findings.push(finding({
        step,
        audience,
        field,
        code: 'invalid_provenance_state',
        message: 'Nested audience voicing needs provenance_state in source-derived, enriched, authored, or needs-authoring.',
        text,
        value: normalized.provenance_state
      }));
    }
  }

  for (const number of extractNumbers(text)) {
    if (!sourceContains(sourceCorpus, number)) {
      findings.push(finding({
        step,
        audience,
        field,
        code: 'unsupported_number',
        message: 'Audience voicing contains a number not present in the non-audience source plan.',
        text,
        value: number
      }));
    }
  }

  for (const entity of extractEntities(text)) {
    if (!sourceContains(sourceCorpus, entity)) {
      findings.push(finding({
        step,
        audience,
        field,
        code: 'unsupported_entity',
        message: 'Audience voicing contains a named entity not present in the non-audience source plan.',
        text,
        value: entity
      }));
    }
  }

  return findings;
}

function lintClaimTypeConstancy({ step, normalizedByAudience }) {
  const findings = [];
  for (const field of ['what', 'why']) {
    const rows = [];
    for (const [audience, fields] of Object.entries(normalizedByAudience)) {
      const normalized = fields[field];
      if (!normalized || !normalized.text) continue;
      rows.push({ audience, types: claimTypesForText(normalized.text), text: normalized.text });
    }
    if (rows.length < 2) continue;
    const baselineRow = rows.find((row) => row.audience === 'owner') || rows[0];
    const baseline = baselineRow.types.join(',');
    for (const row of rows) {
      if (row.audience === baselineRow.audience) continue;
      const current = row.types.join(',');
      if (current !== baseline) {
        findings.push(finding({
          step,
          audience: row.audience,
          field,
          code: 'claim_type_mismatch',
          message: 'Audience lenses changed claim type for the same plan field.',
          text: row.text,
          value: `${baselineRow.audience}:${baseline || 'none'} vs ${row.audience}:${current || 'none'}`
        }));
      }
    }
  }
  return findings;
}

function lintPlanAudienceFraming(plan, options = {}) {
  const findings = [];
  const steps = plan && plan.bounded_plan && Array.isArray(plan.bounded_plan.steps)
    ? plan.bounded_plan.steps
    : [];
  const sourceCorpus = sourceCorpusForPlan(plan);

  for (const step of steps) {
    const audiences = step && step.audiences && typeof step.audiences === 'object' ? step.audiences : {};
    const normalizedByAudience = {};
    for (const [audience, entry] of Object.entries(audiences)) {
      normalizedByAudience[audience] = {
        what: normalizeAudienceField(entry, 'what'),
        why: normalizeAudienceField(entry, 'why')
      };
      for (const field of ['what', 'why']) {
        findings.push(...lintAudienceField({
          plan,
          step,
          audience,
          field,
          normalized: normalizedByAudience[audience][field],
          sourceCorpus
        }));
      }
    }
    findings.push(...lintClaimTypeConstancy({ step, normalizedByAudience }));
  }

  const errors = findings.filter((item) => item.severity === 'error');
  return {
    schema: 'PlanAudienceFramingLint/1.0',
    ok: errors.length === 0,
    checked_steps: steps.length,
    checked_audience_fields: steps.reduce((count, step) => {
      const audiences = step && step.audiences && typeof step.audiences === 'object' ? step.audiences : {};
      return count + Object.keys(audiences).length * 2;
    }, 0),
    findings,
    options
  };
}

module.exports = {
  claimTypesForText,
  extractEntities,
  extractNumbers,
  lintPlanAudienceFraming,
  normalizeAudienceField,
  splitSentences
};
