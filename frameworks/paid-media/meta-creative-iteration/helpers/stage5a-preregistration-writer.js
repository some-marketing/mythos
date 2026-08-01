'use strict';
//
// Stage 5a — Pre-Registration Writer
//
// Locks the experimental design before Stage 6 readout fires. Six required
// fields, all non-optional once locked. Stage 6 refuses to read out without a
// valid locked artifact. Amendments allowed only with explicit operator
// approval and a recorded reason.

const REQUIRED_FIELDS = [
  'iteration_id',
  'primary_metric',
  'attribution_window',
  'conversion_event',
  'sample_size_minimum',
  'learning_phase_handling',
  'stopping_rules'
];

const VALID_LEARNING_PHASE_VALUES = ['skip-during-learning', 'include-with-caveat', 'wait-for-exit'];

const PRACTICAL_SAMPLE_SIZE_FLOOR = 30;

function validatePreregistration(payload) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (payload.sample_size_minimum !== undefined && payload.sample_size_minimum !== null) {
    if (!Number.isInteger(payload.sample_size_minimum) || payload.sample_size_minimum < 1) {
      errors.push('sample_size_minimum must be a positive integer');
    } else if (payload.sample_size_minimum < PRACTICAL_SAMPLE_SIZE_FLOOR && !payload.sample_size_floor_override_reason) {
      errors.push(
        `sample_size_minimum=${payload.sample_size_minimum} is below the practical floor of ${PRACTICAL_SAMPLE_SIZE_FLOOR}; supply sample_size_floor_override_reason to proceed`
      );
    }
  }

  if (payload.learning_phase_handling && !VALID_LEARNING_PHASE_VALUES.includes(payload.learning_phase_handling)) {
    errors.push(
      `learning_phase_handling must be one of ${VALID_LEARNING_PHASE_VALUES.join(', ')}; got ${payload.learning_phase_handling}`
    );
  }

  if (payload.stopping_rules !== undefined) {
    if (!Array.isArray(payload.stopping_rules) || payload.stopping_rules.length === 0) {
      errors.push('stopping_rules must be a non-empty array of observable conditions');
    }
  }

  return { valid: errors.length === 0, errors };
}

function buildPreregistration({
  iterationId,
  primaryMetric,
  attributionWindow,
  conversionEvent,
  sampleSizeMinimum,
  learningPhaseHandling,
  stoppingRules,
  sampleSizeFloorOverrideReason,
  operatorApprovalTimestamp
}) {
  const payload = {
    timestamp: new Date().toISOString(),
    iteration_id: iterationId,
    primary_metric: primaryMetric,
    attribution_window: attributionWindow,
    conversion_event: conversionEvent,
    sample_size_minimum: sampleSizeMinimum,
    learning_phase_handling: learningPhaseHandling,
    stopping_rules: stoppingRules,
    locked: false,
    operator_approval_timestamp: null,
    amendments: []
  };
  if (sampleSizeFloorOverrideReason) {
    payload.sample_size_floor_override_reason = sampleSizeFloorOverrideReason;
  }

  const validation = validatePreregistration(payload);
  if (!validation.valid) {
    return {
      success: false,
      payload,
      errors: validation.errors
    };
  }

  if (operatorApprovalTimestamp) {
    payload.locked = true;
    payload.operator_approval_timestamp = operatorApprovalTimestamp;
  }

  return {
    success: true,
    payload,
    locked: payload.locked
  };
}

function amendPreregistration({ existing, fieldChanged, newValue, reason, operatorApproval }) {
  if (!existing) {
    throw new Error('existing pre-registration required');
  }
  if (!operatorApproval) {
    return {
      success: false,
      error: 'amendments require explicit operator approval; operatorApproval must be true'
    };
  }
  if (!REQUIRED_FIELDS.includes(fieldChanged)) {
    return {
      success: false,
      error: `cannot amend non-tracked field: ${fieldChanged}`
    };
  }
  const previousValue = existing[fieldChanged];
  const updated = {
    ...existing,
    [fieldChanged]: newValue,
    amendments: [
      ...(existing.amendments || []),
      {
        timestamp: new Date().toISOString(),
        field_changed: fieldChanged,
        previous_value: previousValue,
        new_value: newValue,
        reason,
        operator_approval: true
      }
    ]
  };

  const validation = validatePreregistration(updated);
  if (!validation.valid) {
    return {
      success: false,
      payload: updated,
      errors: validation.errors
    };
  }
  return { success: true, payload: updated };
}

module.exports = {
  validatePreregistration,
  buildPreregistration,
  amendPreregistration,
  REQUIRED_FIELDS,
  VALID_LEARNING_PHASE_VALUES,
  PRACTICAL_SAMPLE_SIZE_FLOOR
};
