'use strict';
//
// Stage 2 — Model-Visible Diversity Audit
//
// Pure function: takes 3-5 framework choices each tagged with their mapped
// dimensions (offer_angle, proof_type, format, visual_composition,
// landing_intent, funnel_stage), returns pass/fail with named distinct
// and collapsed dimensions.
//
// The audit catches the failure mode the convene flagged 2026-05-01:
// "Five frameworks all selling the same offer in the same funnel stage with
// the same proof type can collapse into one model neighborhood — that is one
// test, not five."

const DIMENSIONS = [
  'offer_angle',
  'proof_type',
  'format',
  'visual_composition',
  'landing_intent',
  'funnel_stage'
];

const REQUIRED_DISTINCT_DIMENSIONS = 3;

function auditDiversity(mix) {
  if (!Array.isArray(mix)) {
    throw new Error('mix must be an array');
  }
  if (mix.length < 3 || mix.length > 5) {
    return {
      verdict: 'fail',
      reason: `mix size must be 3-5; got ${mix.length}`,
      distinct_dimensions: [],
      collapsed_dimensions: [],
      replacement_suggestions: [
        mix.length < 3 ? 'add frameworks until size is at least 3' : 'remove frameworks until size is at most 5'
      ]
    };
  }

  for (const item of mix) {
    if (!item || typeof item !== 'object' || !item.framework_id || !item.mapped_dimensions) {
      return {
        verdict: 'fail',
        reason: 'every mix item must have framework_id and mapped_dimensions',
        distinct_dimensions: [],
        collapsed_dimensions: [],
        replacement_suggestions: ['ensure each framework choice carries explicit mapped_dimensions per Stage 2 prompt schema']
      };
    }
    for (const d of DIMENSIONS) {
      if (typeof item.mapped_dimensions[d] !== 'string' || item.mapped_dimensions[d].trim() === '') {
        return {
          verdict: 'fail',
          reason: `framework_id "${item.framework_id}" missing or empty mapped_dimensions.${d}`,
          distinct_dimensions: [],
          collapsed_dimensions: [],
          replacement_suggestions: [`map dimension ${d} for ${item.framework_id} before audit`]
        };
      }
    }
  }

  const distinct = [];
  const collapsed = [];

  for (const dim of DIMENSIONS) {
    const valuesSeen = new Set();
    for (const item of mix) {
      const v = item.mapped_dimensions[dim].toLowerCase().trim();
      valuesSeen.add(v);
    }
    if (valuesSeen.size >= 2) {
      distinct.push(dim);
    } else {
      collapsed.push(dim);
    }
  }

  if (distinct.length >= REQUIRED_DISTINCT_DIMENSIONS) {
    return {
      verdict: 'pass',
      distinct_dimensions: distinct,
      collapsed_dimensions: collapsed,
      replacement_suggestions: []
    };
  }

  const suggestions = [];
  for (const dim of collapsed) {
    suggestions.push(
      `swap one framework so its ${dim} differs from the rest — e.g., currently the mix is uniform on ${dim}=${mix[0].mapped_dimensions[dim]}`
    );
  }
  if (suggestions.length === 0) {
    suggestions.push('the mix has no actionable differentiator; revisit Stage 1 — the chosen hypothesis may be too narrow to admit structural variety');
  }

  return {
    verdict: 'fail',
    reason: `audit found only ${distinct.length} model-visible distinct dimension(s); minimum is ${REQUIRED_DISTINCT_DIMENSIONS}`,
    distinct_dimensions: distinct,
    collapsed_dimensions: collapsed,
    replacement_suggestions: suggestions
  };
}

module.exports = {
  auditDiversity,
  DIMENSIONS,
  REQUIRED_DISTINCT_DIMENSIONS
};
