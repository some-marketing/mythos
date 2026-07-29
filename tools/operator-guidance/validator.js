'use strict';

/**
 * validator.js — Validate operator guidance payloads against the schema.
 *
 * Performs structural and content-quality checks to ensure guidance
 * payloads are actionable before they reach the operator.
 */

const { OPERATOR_GUIDANCE_SCHEMA } = require('./schema');

/**
 * Generic phrases that fail the improvement_request.ask quality gate.
 * The ask must be concrete enough to elicit specific operator input.
 * @type {RegExp[]}
 */
const GENERIC_ASK_PATTERNS = [
  /^let me know/i,
  /^any feedback/i,
  /^any thoughts/i,
  /^what do you think/i,
  /^anything else/i,
  /^please advise/i,
  /^let us know/i
];

/**
 * Validate operator guidance payload against the schema.
 *
 * @param {object} payload - The guidance payload to validate
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateGuidance(payload) {
  const errors = [];

  // Null / type guard
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  // Required top-level fields
  for (const key of OPERATOR_GUIDANCE_SCHEMA.required) {
    if (!(key in payload)) {
      errors.push(`Missing required field: ${key}`);
    }
  }

  // command_source must be a non-empty string
  if ('command_source' in payload) {
    if (typeof payload.command_source !== 'string' || !payload.command_source.trim()) {
      errors.push('command_source must be a non-empty string');
    }
  }

  // primary_action shape (optional but validated when present)
  if (payload.primary_action != null) {
    if (typeof payload.primary_action !== 'object') {
      errors.push('primary_action must be an object');
    } else {
      if (!payload.primary_action.command) {
        errors.push('primary_action.command is required when primary_action is present');
      }
      if (!payload.primary_action.why) {
        errors.push('primary_action.why is required when primary_action is present');
      }
      if (payload.primary_action.canonical_accept != null) {
        const allowed = ['yes', 'y'];
        if (!allowed.includes(payload.primary_action.canonical_accept)) {
          errors.push(`primary_action.canonical_accept must be one of: ${allowed.join(', ')}`);
        }
      }
    }
  }

  // next_steps
  if ('next_steps' in payload) {
    if (!Array.isArray(payload.next_steps)) {
      errors.push('next_steps must be an array');
    } else {
      if (payload.next_steps.length < 1) {
        errors.push('next_steps must contain at least 1 item');
      }
      for (let i = 0; i < payload.next_steps.length; i++) {
        const step = payload.next_steps[i];
        if (!step || typeof step !== 'object') {
          errors.push(`next_steps[${i}] must be an object`);
          continue;
        }
        for (const field of ['condition', 'command', 'why']) {
          if (!step[field] || typeof step[field] !== 'string' || !step[field].trim()) {
            errors.push(`next_steps[${i}].${field} is required and must be a non-empty string`);
          }
        }
      }
    }
  }

  // improvement_request
  if ('improvement_request' in payload) {
    const ir = payload.improvement_request;
    if (!ir || typeof ir !== 'object') {
      errors.push('improvement_request must be an object');
    } else {
      // ask — required and must be concrete
      if (!ir.ask || typeof ir.ask !== 'string' || !ir.ask.trim()) {
        errors.push('improvement_request.ask is required and must be a non-empty string');
      } else {
        const isGeneric = GENERIC_ASK_PATTERNS.some((re) => re.test(ir.ask.trim()));
        if (isGeneric) {
          errors.push('improvement_request.ask is too generic — must be a concrete request for operator input');
        }
      }

      // examples — required, at least 1 item
      if (!Array.isArray(ir.examples)) {
        errors.push('improvement_request.examples must be an array');
      } else if (ir.examples.length < 1) {
        errors.push('improvement_request.examples must contain at least 1 item');
      } else {
        for (let i = 0; i < ir.examples.length; i++) {
          if (typeof ir.examples[i] !== 'string' || !ir.examples[i].trim()) {
            errors.push(`improvement_request.examples[${i}] must be a non-empty string`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

module.exports = { validateGuidance, GENERIC_ASK_PATTERNS };
