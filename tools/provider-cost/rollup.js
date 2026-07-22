'use strict';

const fs = require('fs');
const path = require('path');
const { readLedger } = require('./ledger');

/**
 * Relative path from project root to the run-level rollup directory.
 * @type {string}
 */
const RUN_ROLLUP_DIR = path.join('_dev', 'reports', 'analysis', 'cost-rollups', 'runs');

/**
 * Relative path from project root to the routing rollup directory.
 * @type {string}
 */
const ROUTING_ROLLUP_DIR = path.join('_dev', 'reports', 'analysis', 'cost-rollups', 'routing');

/**
 * Ensure the parent directory of a file path exists, creating it recursively
 * if necessary.
 *
 * @param {string} filePath - Absolute path to a file.
 */
function ensureDir(filePath) {
  var dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Parse a time-window string (e.g. '7d', '30d') into milliseconds.
 *
 * @param {string} window - Duration string with numeric value and unit suffix.
 *   Supported units: 'd' (days), 'h' (hours), 'm' (minutes).
 * @returns {number} Duration in milliseconds.
 * @throws {Error} On unrecognized format.
 */
function parseWindow(window) {
  var match = /^(\d+)([dhm])$/.exec(window);
  if (!match) {
    throw new Error(
      'Unrecognized window format "' + window + '". ' +
      'Expected format: <number><unit> where unit is d (days), h (hours), or m (minutes).'
    );
  }

  var value = parseInt(match[1], 10);
  var unit = match[2];
  var multipliers = { d: 86400000, h: 3600000, m: 60000 };

  return value * multipliers[unit];
}

/**
 * Compute the average of a numeric array. Returns 0 for empty arrays.
 *
 * @param {number[]} values
 * @returns {number}
 */
function avg(values) {
  if (values.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}

/**
 * Sum canonical_cost.total_amount across entries.
 *
 * @param {Array<object>} entries - Ledger entries with canonical_cost.
 * @returns {number} Total USD cost.
 */
function sumCost(entries) {
  var total = 0;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].canonical_cost && typeof entries[i].canonical_cost.total_amount === 'number') {
      total += entries[i].canonical_cost.total_amount;
    }
  }
  return total;
}

/**
 * Generate a run-level cost rollup from ledger entries.
 *
 * Reads all entries matching the given runId, computes aggregate cost metrics,
 * and writes the rollup to disk.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {string} runId - The run identifier to roll up.
 * @returns {RunRollup} The generated rollup, also written to
 *   `_dev/reports/analysis/cost-rollups/runs/{runId}.json`.
 */
function generateRunRollup(projectRoot, runId) {
  var entries = readLedger(projectRoot, { runId: runId });

  var totalUsd = sumCost(entries);
  var successEntries = entries.filter(function (e) { return e.status === 'success'; });
  var errorEntries = entries.filter(function (e) { return e.status === 'error'; });

  var latencies = [];
  for (var i = 0; i < entries.length; i++) {
    if (typeof entries[i].latency_ms === 'number') {
      latencies.push(entries[i].latency_ms);
    }
  }

  // Group by provider
  var byProvider = {};
  for (var j = 0; j < entries.length; j++) {
    var p = entries[j].provider;
    if (!byProvider[p]) {
      byProvider[p] = [];
    }
    byProvider[p].push(entries[j]);
  }

  var providerBreakdown = {};
  var providers = Object.keys(byProvider);
  for (var k = 0; k < providers.length; k++) {
    var providerName = providers[k];
    var providerEntries = byProvider[providerName];
    providerBreakdown[providerName] = {
      call_count: providerEntries.length,
      total_usd: sumCost(providerEntries),
      success_count: providerEntries.filter(function (e) { return e.status === 'success'; }).length,
      error_count: providerEntries.filter(function (e) { return e.status === 'error'; }).length
    };
  }

  // Group by pricing_mode
  var byPricingMode = {};
  for (var m = 0; m < entries.length; m++) {
    var mode = entries[m].pricing ? entries[m].pricing.pricing_mode : 'unknown';
    if (!byPricingMode[mode]) {
      byPricingMode[mode] = 0;
    }
    byPricingMode[mode]++;
  }

  var rollup = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    entry_count: entries.length,
    canonical_total_usd: totalUsd,
    cost_per_run_usd: totalUsd,
    success_count: successEntries.length,
    error_count: errorEntries.length,
    avg_latency_ms: avg(latencies),
    provider_breakdown: providerBreakdown,
    pricing_mode_counts: byPricingMode
  };

  var outFile = path.join(projectRoot, RUN_ROLLUP_DIR, runId + '.json');
  ensureDir(outFile);
  fs.writeFileSync(outFile, JSON.stringify(rollup, null, 2) + '\n', 'utf8');

  return rollup;
}

/**
 * Generate a routing efficiency rollup for a time window and scope.
 *
 * Reads all ledger entries within the window, filters by scope, and computes
 * metrics useful for cost-aware routing decisions.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {string} window - Time window, e.g. '7d', '30d'.
 * @param {string} scope - Scope filter: 'all', 'system', or 'client-{CODE}'.
 * @returns {RoutingRollup} The generated rollup, also written to
 *   `_dev/reports/analysis/cost-rollups/routing/{window}__{scope}.json`.
 */
function generateRoutingRollup(projectRoot, window, scope) {
  var windowMs = parseWindow(window);
  var since = new Date(Date.now() - windowMs).toISOString();

  var entries = readLedger(projectRoot, { since: since });

  // Apply scope filter
  if (scope === 'system') {
    entries = entries.filter(function (e) { return e.scope_type === 'system'; });
  } else if (scope && scope.indexOf('client-') === 0) {
    var clientCode = scope.slice('client-'.length);
    entries = entries.filter(function (e) { return e.client_code === clientCode; });
  }
  // 'all' means no additional filtering

  var totalUsd = sumCost(entries);

  // Distinct run IDs
  var runIdSet = {};
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].run_id) {
      runIdSet[entries[i].run_id] = true;
    }
  }
  var runIds = Object.keys(runIdSet);
  var runCount = runIds.length;

  // Compute per-run metrics
  var costPerRunUsd = runCount > 0 ? totalUsd / runCount : 0;

  // Entries flagged as accepted runs (policy.billable === true as proxy)
  var billableEntries = entries.filter(function (e) {
    return e.policy && e.policy.billable === true;
  });
  var billableRunIds = {};
  for (var b = 0; b < billableEntries.length; b++) {
    if (billableEntries[b].run_id) {
      billableRunIds[billableEntries[b].run_id] = true;
    }
  }
  var acceptedRunCount = Object.keys(billableRunIds).length;
  var costPerAcceptedRunUsd = acceptedRunCount > 0 ? totalUsd / acceptedRunCount : 0;

  // Entries with cost_confidence of 'verified_complete'
  var verifiedEntries = entries.filter(function (e) {
    return e.policy && e.policy.cost_confidence === 'verified_complete';
  });
  var verifiedRunIds = {};
  for (var v = 0; v < verifiedEntries.length; v++) {
    if (verifiedEntries[v].run_id) {
      verifiedRunIds[verifiedEntries[v].run_id] = true;
    }
  }
  var verifiedRunCount = Object.keys(verifiedRunIds).length;
  var costPerVerifiedCompleteUsd = verifiedRunCount > 0 ? totalUsd / verifiedRunCount : 0;

  // False-pass entries (cost_confidence === 'false_pass')
  var falsePassEntries = entries.filter(function (e) {
    return e.policy && e.policy.cost_confidence === 'false_pass';
  });
  var falsePassRunIds = {};
  for (var f = 0; f < falsePassEntries.length; f++) {
    if (falsePassEntries[f].run_id) {
      falsePassRunIds[falsePassEntries[f].run_id] = true;
    }
  }
  var falsePassRunCount = Object.keys(falsePassRunIds).length;
  var costPerFalsePassUsd = falsePassRunCount > 0 ? sumCost(falsePassEntries) / falsePassRunCount : 0;

  // Review agreement: ratio of verified_complete to total runs
  var reviewAgreement = runCount > 0 ? verifiedRunCount / runCount : 0;

  // Average latency
  var latencies = [];
  for (var l = 0; l < entries.length; l++) {
    if (typeof entries[l].latency_ms === 'number') {
      latencies.push(entries[l].latency_ms);
    }
  }

  // Routing eligibility breakdown
  var routeEligible = entries.filter(function (e) {
    return e.policy && e.policy.eligible_for_cost_routing === true;
  });
  var routeIneligible = entries.length - routeEligible.length;

  var rollup = {
    window: window,
    scope: scope,
    generated_at: new Date().toISOString(),
    since: since,
    entry_count: entries.length,
    run_count: runCount,
    canonical_total_usd: totalUsd,
    cost_per_run_usd: costPerRunUsd,
    cost_per_accepted_run_usd: costPerAcceptedRunUsd,
    cost_per_verified_complete_usd: costPerVerifiedCompleteUsd,
    cost_per_false_pass_usd: costPerFalsePassUsd,
    review_agreement: reviewAgreement,
    avg_latency_ms: avg(latencies),
    routing_eligibility: {
      eligible: routeEligible.length,
      ineligible: routeIneligible
    }
  };

  var fileName = window + '__' + scope + '.json';
  var outFile = path.join(projectRoot, ROUTING_ROLLUP_DIR, fileName);
  ensureDir(outFile);
  fs.writeFileSync(outFile, JSON.stringify(rollup, null, 2) + '\n', 'utf8');

  return rollup;
}

/**
 * @typedef {object} RunRollup
 * @property {string} run_id
 * @property {string} generated_at - ISO timestamp.
 * @property {number} entry_count
 * @property {number} canonical_total_usd
 * @property {number} cost_per_run_usd
 * @property {number} success_count
 * @property {number} error_count
 * @property {number} avg_latency_ms
 * @property {object} provider_breakdown - Keyed by provider name.
 * @property {object} pricing_mode_counts - Keyed by pricing_mode.
 */

/**
 * @typedef {object} RoutingRollup
 * @property {string} window
 * @property {string} scope
 * @property {string} generated_at - ISO timestamp.
 * @property {string} since - ISO timestamp of window start.
 * @property {number} entry_count
 * @property {number} run_count
 * @property {number} canonical_total_usd
 * @property {number} cost_per_run_usd
 * @property {number} cost_per_accepted_run_usd
 * @property {number} cost_per_verified_complete_usd
 * @property {number} cost_per_false_pass_usd
 * @property {number} review_agreement
 * @property {number} avg_latency_ms
 * @property {object} routing_eligibility
 */

module.exports = {
  RUN_ROLLUP_DIR,
  ROUTING_ROLLUP_DIR,
  generateRunRollup,
  generateRoutingRollup
};
