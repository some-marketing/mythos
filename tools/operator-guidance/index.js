'use strict';

/**
 * index.js — Operator Guidance enforcement system.
 *
 * Re-exports every public symbol from the operator-guidance modules
 * so consumers can require a single entry point:
 *
 *   const guidance = require('../tools/operator-guidance');
 */

const { OPERATOR_GUIDANCE_SCHEMA, PHASE_1_COMMANDS, ACCEPTANCE_ALIASES } = require('./schema');
const { renderGuidance, renderAlternatives, renderImprovementRequest } = require('./renderer');
const { validateGuidance, GENERIC_ASK_PATTERNS } = require('./validator');
const { resolveOperatorInput } = require('./acceptance-controller');

module.exports = {
  // Schema
  OPERATOR_GUIDANCE_SCHEMA,
  PHASE_1_COMMANDS,
  ACCEPTANCE_ALIASES,

  // Renderer
  renderGuidance,
  renderAlternatives,
  renderImprovementRequest,

  // Validator
  validateGuidance,
  GENERIC_ASK_PATTERNS,

  // Acceptance controller
  resolveOperatorInput
};
