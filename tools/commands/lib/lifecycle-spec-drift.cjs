'use strict';

// Blocking spec-drift detector for lifecycle mechanical runners (plan
// session-lifecycle-mechanical-runners, S4).
//
// A mechanical runner may only execute a canonical lifecycle spec when its
// declared step coverage is a total, ordered match over the live spec's
// `process` array. Any difference is drift and must fail loud — the runner
// refuses the mechanical path and the operator falls back to YAML spec
// inference (/shutdown --manual).

const STEP_RE = /^Step (\d+[a-z]?) — ([^:]+):/;

function normalizeLabel(label) {
  return String(label || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Parse a canonical spec `process` array into ordered step identities.
 *
 * Entries matching /^Step (\d+[a-z]?) — ([^:]+):/ become named steps.
 * A non-matching first entry is classified `preamble`, a non-matching last
 * entry is classified `postamble`; both are INCLUDED in the count check.
 * Any other non-matching entry is classified `unrecognized-<index>` so it
 * can never silently pass a coverage check.
 *
 * Labels for preamble/postamble/unrecognized entries are the entry text up
 * to the first ':' (trimmed), so wording changes to those entries are also
 * detected as drift.
 */
function parseSpecSteps(specProcessArray) {
  if (!Array.isArray(specProcessArray)) {
    throw new TypeError('parseSpecSteps expects the canonical spec `process` array.');
  }
  const lastIndex = specProcessArray.length - 1;
  return specProcessArray.map((text, index) => {
    const raw = String(text || '');
    const match = raw.match(STEP_RE);
    if (match) {
      return { index, kind: 'step', step_id: match[1], label: match[2].trim(), text: raw };
    }
    let kind;
    let stepId;
    if (index === 0) {
      kind = 'preamble';
      stepId = 'preamble';
    } else if (index === lastIndex) {
      kind = 'postamble';
      stepId = 'postamble';
    } else {
      kind = 'unrecognized';
      stepId = `unrecognized-${index}`;
    }
    const label = raw.split(':')[0].trim();
    return { index, kind, step_id: stepId, label, text: raw };
  });
}

/**
 * Compare declared coverage (ordered array of { step_id, label, ... })
 * against parsed spec steps. Fails loud on:
 *  - step count difference
 *  - order difference
 *  - identity difference (step_id or normalized label)
 *  - any spec step absent from coverage
 *  - any coverage entry absent from the spec
 *
 * Returns { ok, mismatches: [{ type, detail, index? }] }.
 */
function checkDrift(declaredCoverage, specSteps) {
  const mismatches = [];
  const coverage = Array.isArray(declaredCoverage) ? declaredCoverage : [];
  const spec = Array.isArray(specSteps) ? specSteps : [];

  if (coverage.length !== spec.length) {
    mismatches.push({
      type: 'step_count',
      detail: `live spec has ${spec.length} process entries; declared coverage has ${coverage.length}`
    });
  }

  const specIds = spec.map((entry) => String(entry.step_id));
  const coverageIds = coverage.map((entry) => String(entry.step_id));

  const shared = Math.min(spec.length, coverage.length);
  for (let i = 0; i < shared; i += 1) {
    const specEntry = spec[i];
    const coverageEntry = coverage[i];
    const specId = String(specEntry.step_id);
    const coverageId = String(coverageEntry.step_id);
    if (specId !== coverageId) {
      const bothExistElsewhere = specIds.includes(coverageId) && coverageIds.includes(specId);
      mismatches.push({
        type: bothExistElsewhere ? 'order' : 'identity',
        index: i,
        detail: `position ${i}: live spec step_id "${specId}" vs declared coverage step_id "${coverageId}"`
      });
      continue;
    }
    if (normalizeLabel(specEntry.label) !== normalizeLabel(coverageEntry.label)) {
      mismatches.push({
        type: 'identity',
        index: i,
        detail: `step "${specId}": live spec label "${specEntry.label}" vs declared coverage label "${coverageEntry.label}"`
      });
    }
  }

  for (const entry of spec) {
    if (!coverageIds.includes(String(entry.step_id))) {
      mismatches.push({
        type: 'missing_in_coverage',
        detail: `live spec step "${entry.step_id}" (${entry.label}) has no declared coverage entry`
      });
    }
  }
  for (const entry of coverage) {
    if (!specIds.includes(String(entry.step_id))) {
      mismatches.push({
        type: 'extra_in_coverage',
        detail: `declared coverage entry "${entry.step_id}" (${entry.label}) does not exist in the live spec`
      });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

function renderDriftReport(result, context = {}) {
  const lines = [];
  const specPath = context.specPath ? ` (${context.specPath})` : '';
  if (result.ok) {
    lines.push(`Lifecycle spec drift check: CLEAN${specPath}`);
    if (typeof context.stepCount === 'number') {
      lines.push(`Declared coverage matches all ${context.stepCount} live spec process entries in order.`);
    }
  } else {
    lines.push(`Lifecycle spec drift check: DRIFT DETECTED${specPath}`);
    for (const mismatch of result.mismatches) {
      lines.push(`- [${mismatch.type}] ${mismatch.detail}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  STEP_RE,
  normalizeLabel,
  parseSpecSteps,
  checkDrift,
  renderDriftReport
};
