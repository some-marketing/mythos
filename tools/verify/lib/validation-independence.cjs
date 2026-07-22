/**
 * Validation Independence Checker
 *
 * Verifies that validation meets the independence requirements for the
 * declared trust tier. Part of G4-meaningful-independence-and-anti-theater-validation.
 */

'use strict';

const TIER_REQUIREMENTS = {
  instruction_only: { required: false },
  report_write_scoped: { required: false },
  patch_scoped: { required: true, min_dimensions: 1, must_include_one_of: ['actor_role', 'harness'] },
  external_service_touching: { required: true, min_dimensions: 2, must_include: ['harness'], must_include_one_of: ['evidence_path', 'evaluation_objective'] },
  meta_modifying: { required: true, min_dimensions: 2, must_include: ['actor_role', 'harness'] }
};

function checkIndependence(record) {
  const tier = record.trust_tier;
  const req = TIER_REQUIREMENTS[tier];

  if (!req) {
    return { valid: false, error: `Unknown trust tier: ${tier}` };
  }

  if (!req.required) {
    return { valid: true, independence_required: false, tier };
  }

  const dims = record.dimensions_satisfied || [];
  const dimNames = dims.map(d => d.dimension);
  const errors = [];

  if (dims.length < req.min_dimensions) {
    errors.push(`Requires ${req.min_dimensions} independence dimension(s), found ${dims.length}`);
  }

  if (req.must_include) {
    for (const d of req.must_include) {
      if (!dimNames.includes(d)) {
        errors.push(`Missing required dimension: ${d}`);
      }
    }
  }

  if (req.must_include_one_of) {
    if (!req.must_include_one_of.some(d => dimNames.includes(d))) {
      errors.push(`Must include at least one of: ${req.must_include_one_of.join(', ')}`);
    }
  }

  // Anti-theater: check that producer and validator values actually differ
  for (const dim of dims) {
    if (dim.producer_value === dim.validator_value) {
      errors.push(`Dimension ${dim.dimension} has same value for producer and validator: ${dim.producer_value}`);
    }
  }

  if (!record.anti_theater_check) {
    errors.push('anti_theater_check is false or missing — validator must examine evidence artifacts directly');
  }

  return {
    valid: errors.length === 0,
    independence_required: true,
    tier,
    dimensions_count: dims.length,
    errors: errors.length > 0 ? errors : undefined
  };
}

module.exports = { checkIndependence, TIER_REQUIREMENTS };
