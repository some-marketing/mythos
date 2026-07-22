'use strict';

const fs = require('fs');
const path = require('path');

// Optional user-populated model-pin config. When present, lets you pin a
// specific model version for a given actor + risk/task/scope combination —
// e.g. always use a "pro"-tier Gemini model for high-risk consequence-grade
// convenes, and a cheaper/faster tier for low-risk exploratory ones. Absent
// this file, no model is pinned and the adapter's own CLI default applies.
//
// Shape:
// {
//   "<actor>": {
//     "high": "model-id-for-high-risk",
//     "low": "model-id-for-low-risk"
//   }
// }
const MODEL_PINS_PATH = path.join(__dirname, '..', 'convene-model-pins.json');

function loadModelPins() {
  try {
    if (!fs.existsSync(MODEL_PINS_PATH)) return {};
    return JSON.parse(fs.readFileSync(MODEL_PINS_PATH, 'utf8')) || {};
  } catch (err) {
    process.stderr.write(`[convene] ignoring malformed convene-model-pins.json: ${err.message}\n`);
    return {};
  }
}

/**
 * resolveConveneModel — determine the model to pin for a convene slot, based
 * on an optional user-populated convene-model-pins.json. Returns '' (no pin)
 * when the file is absent or has no matching entry for the actor/risk tier.
 *
 * @param {object} opts { actor, riskTier, taskShape, scopeTier }
 * @returns {string} the model name to pin, or '' if no pin.
 */
function resolveConveneModel(opts = {}) {
  const actor = String(opts.actor || '').trim().toLowerCase();
  if (!actor) return '';

  const pins = loadModelPins();
  const actorPins = pins[actor];
  if (!actorPins || typeof actorPins !== 'object') return '';

  const riskTier = String(opts.riskTier || opts.risk_tier || 'low').trim().toLowerCase();
  return String(actorPins[riskTier] || actorPins.default || '');
}

module.exports = {
  MODEL_PINS_PATH,
  resolveConveneModel
};
