'use strict';

/**
 * index.js — Provider Cost Visibility infrastructure.
 *
 * Re-exports every public symbol from the provider-cost modules
 * so consumers can require a single entry point:
 *
 *   const cost = require('../tools/provider-cost');
 */

const {
  LEDGER_PATH,
  VALID_PRICING_MODES,
  VALID_PROVIDER_TYPES,
  VALID_STATUSES,
  validateEntry,
  appendCostEntry,
  readLedger
} = require('./ledger');

const {
  RUN_ROLLUP_DIR,
  ROUTING_ROLLUP_DIR,
  generateRunRollup,
  generateRoutingRollup
} = require('./rollup');

const {
  PREFS_PATH,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences
} = require('./operator-preferences');

const { checkCostGate } = require('./cost-gate');

module.exports = {
  // Ledger
  LEDGER_PATH,
  VALID_PRICING_MODES,
  VALID_PROVIDER_TYPES,
  VALID_STATUSES,
  validateEntry,
  appendCostEntry,
  readLedger,

  // Rollups
  RUN_ROLLUP_DIR,
  ROUTING_ROLLUP_DIR,
  generateRunRollup,
  generateRoutingRollup,

  // Operator preferences
  PREFS_PATH,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,

  // Cost gate
  checkCostGate
};
