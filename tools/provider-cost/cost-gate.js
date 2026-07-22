'use strict';

const { loadPreferences } = require('./operator-preferences');
const { readLedger } = require('./ledger');

/**
 * @typedef {object} CostGateResult
 * @property {boolean} enforced - Whether cost threshold enforcement is active.
 * @property {boolean} [exceeded] - True if 24h spend exceeds the threshold.
 * @property {number} [current_usd] - Current 24h spend in USD.
 * @property {number} [threshold_usd] - Configured threshold in USD.
 * @property {string} [message] - Human-readable status message.
 * @property {string} [error] - Error message if the check failed gracefully.
 */

/**
 * Check whether recent provider spend has exceeded the operator's configured
 * cost threshold.
 *
 * The check is intentionally fail-open: if any error occurs while loading
 * preferences or reading the ledger, the function returns
 * `{ enforced: false, error: ... }` so that dispatch is never blocked by a
 * broken cost path.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @returns {CostGateResult}
 */
function checkCostGate(projectRoot) {
  try {
    const prefs = loadPreferences(projectRoot);

    if (prefs.cost_threshold_usd == null) {
      return { enforced: false };
    }

    const threshold = Number(prefs.cost_threshold_usd);
    if (isNaN(threshold) || threshold <= 0) {
      return { enforced: false };
    }

    const since = new Date(Date.now() - 86400000).toISOString();
    const entries = readLedger(projectRoot, { since: since });

    var currentUsd = 0;
    for (var i = 0; i < entries.length; i++) {
      if (
        entries[i].canonical_cost &&
        typeof entries[i].canonical_cost.total_amount === 'number'
      ) {
        currentUsd += entries[i].canonical_cost.total_amount;
      }
    }

    var exceeded = currentUsd >= threshold;
    var message = exceeded
      ? 'Cost threshold exceeded: $' + currentUsd.toFixed(4) + ' USD spent in last 24h (threshold: $' + threshold.toFixed(2) + ' USD)'
      : 'Cost within threshold: $' + currentUsd.toFixed(4) + ' USD of $' + threshold.toFixed(2) + ' USD limit';

    return {
      enforced: true,
      exceeded: exceeded,
      current_usd: currentUsd,
      threshold_usd: threshold,
      message: message
    };
  } catch (err) {
    return { enforced: false, error: err.message };
  }
}

module.exports = { checkCostGate };
