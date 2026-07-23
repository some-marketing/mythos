'use strict';

// Compatibility wrapper for Gemini-specific callers. The source of truth is
// the shared bridge target policy, not this file.

const {
  BRIDGE_MODEL_SOURCE,
  getBridgeTransportPolicy,
  normalizeText,
  resolveBridgeTargetModel,
  validateBridgeTargetModel
} = require('./bridge-target-policy');

const GEMINI_LOCAL_CLI_POLICY = getBridgeTransportPolicy('gemini', 'local-cli');

const CURRENT_GEMINI_BRIDGE_MODELS = Object.freeze(GEMINI_LOCAL_CLI_POLICY.current_models.slice());
const DEFAULT_GEMINI_BRIDGE_MODEL = GEMINI_LOCAL_CLI_POLICY.default_model;
const STALE_GEMINI_BRIDGE_MODELS = Object.freeze(GEMINI_LOCAL_CLI_POLICY.stale_models.slice());
const GEMINI_BRIDGE_MODEL_SOURCE = Object.freeze({
  checked_at: BRIDGE_MODEL_SOURCE.checked_at,
  model_docs: GEMINI_LOCAL_CLI_POLICY.model_docs,
  cli_docs: GEMINI_LOCAL_CLI_POLICY.bridge_docs
});

function normalizeModelName(model) {
  return normalizeText(model);
}

function isCurrentGeminiBridgeModel(model) {
  return CURRENT_GEMINI_BRIDGE_MODELS.includes(normalizeModelName(model));
}

function isStaleGeminiBridgeModel(model) {
  return STALE_GEMINI_BRIDGE_MODELS.includes(normalizeModelName(model));
}

function validateGeminiBridgeModel(model) {
  return validateBridgeTargetModel('gemini', model, { transport: 'local-cli' });
}

function resolveGeminiBridgeModel(model) {
  return resolveBridgeTargetModel('gemini', model || DEFAULT_GEMINI_BRIDGE_MODEL, {
    transport: 'local-cli'
  });
}

module.exports = {
  CURRENT_GEMINI_BRIDGE_MODELS,
  DEFAULT_GEMINI_BRIDGE_MODEL,
  GEMINI_BRIDGE_MODEL_SOURCE,
  STALE_GEMINI_BRIDGE_MODELS,
  isCurrentGeminiBridgeModel,
  isStaleGeminiBridgeModel,
  normalizeModelName,
  resolveGeminiBridgeModel,
  validateGeminiBridgeModel
};
