'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Relative path from project root to the append-only cost ledger.
 * @type {string}
 */
const LEDGER_PATH = path.join('_dev', 'logs', 'provider-costs.jsonl');

/**
 * Valid pricing modes as defined by the Provider Cost Visibility Law.
 * @type {ReadonlyArray<string>}
 */
const VALID_PRICING_MODES = Object.freeze([
  'actual',
  'estimated',
  'zero_local',
  'unknown'
]);

/**
 * Valid provider types.
 * @type {ReadonlyArray<string>}
 */
const VALID_PROVIDER_TYPES = Object.freeze(['api', 'local', 'browser']);

/**
 * Valid entry statuses.
 * @type {ReadonlyArray<string>}
 */
const VALID_STATUSES = Object.freeze(['success', 'error', 'timeout']);

/**
 * Validate a ProviderCostEntry before writing.
 * Throws on any violation of the Provider Cost Visibility Law.
 *
 * @param {ProviderCostEntry} entry
 * @throws {Error} On validation failure.
 */
function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('entry must be a non-null object');
  }

  // Required string fields
  const requiredStrings = [
    'recorded_at', 'request_id', 'actor_id',
    'provider', 'provider_type', 'model_id', 'status'
  ];
  for (const field of requiredStrings) {
    if (typeof entry[field] !== 'string' || entry[field].length === 0) {
      throw new Error('entry.' + field + ' is required and must be a non-empty string');
    }
  }

  // provider_type must be valid
  if (!VALID_PROVIDER_TYPES.includes(entry.provider_type)) {
    throw new Error(
      'entry.provider_type must be one of: ' + VALID_PROVIDER_TYPES.join(', ') +
      ' (got "' + entry.provider_type + '")'
    );
  }

  // status must be valid
  if (!VALID_STATUSES.includes(entry.status)) {
    throw new Error(
      'entry.status must be one of: ' + VALID_STATUSES.join(', ') +
      ' (got "' + entry.status + '")'
    );
  }

  // pricing object
  if (!entry.pricing || typeof entry.pricing !== 'object') {
    throw new Error('entry.pricing is required and must be an object');
  }
  if (!VALID_PRICING_MODES.includes(entry.pricing.pricing_mode)) {
    throw new Error(
      'entry.pricing.pricing_mode must be one of: ' + VALID_PRICING_MODES.join(', ') +
      ' (got "' + entry.pricing.pricing_mode + '")'
    );
  }

  // canonical_cost object
  if (!entry.canonical_cost || typeof entry.canonical_cost !== 'object') {
    throw new Error('entry.canonical_cost is required and must be an object');
  }
  if (entry.canonical_cost.currency !== 'USD') {
    throw new Error(
      'entry.canonical_cost.currency must be "USD" (got "' +
      entry.canonical_cost.currency + '")'
    );
  }
  if (typeof entry.canonical_cost.total_amount !== 'number') {
    throw new Error('entry.canonical_cost.total_amount must be a number');
  }

  // Local models must use zero_local
  if (entry.provider_type === 'local' && entry.pricing.pricing_mode !== 'zero_local') {
    throw new Error(
      'Local models must use pricing_mode "zero_local", not "' +
      entry.pricing.pricing_mode + '"'
    );
  }

  // policy object
  if (!entry.policy || typeof entry.policy !== 'object') {
    throw new Error('entry.policy is required and must be an object');
  }
  if (typeof entry.policy.billable !== 'boolean') {
    throw new Error('entry.policy.billable must be a boolean');
  }
  if (typeof entry.policy.local_only !== 'boolean') {
    throw new Error('entry.policy.local_only must be a boolean');
  }
  if (typeof entry.policy.eligible_for_cost_routing !== 'boolean') {
    throw new Error('entry.policy.eligible_for_cost_routing must be a boolean');
  }

  // When pricing_mode is "unknown", must not be eligible for cost routing
  if (
    entry.pricing.pricing_mode === 'unknown' &&
    entry.policy.eligible_for_cost_routing === true
  ) {
    throw new Error(
      'Entries with pricing_mode "unknown" must not be eligible_for_cost_routing'
    );
  }
}

/**
 * Ensure the parent directory of a file path exists, creating it recursively
 * if necessary.
 *
 * @param {string} filePath - Absolute path to a file.
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append a provider cost entry to the ledger.
 *
 * Validates the entry against the Provider Cost Visibility Law before writing.
 * Creates the ledger file and parent directories if they do not exist.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {ProviderCostEntry} entry - The cost entry to append.
 * @throws {Error} On validation failure or write error.
 */
function appendCostEntry(projectRoot, entry) {
  validateEntry(entry);

  const ledgerFile = path.join(projectRoot, LEDGER_PATH);
  ensureDir(ledgerFile);

  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(ledgerFile, line, 'utf8');
}

/**
 * Read all ledger entries, optionally filtered.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {object} [filter] - Optional filters.
 * @param {string} [filter.runId] - Filter by run_id.
 * @param {string} [filter.taskId] - Filter by task_id.
 * @param {string} [filter.provider] - Filter by provider name.
 * @param {string} [filter.since] - ISO timestamp; only entries at or after this time.
 * @returns {ProviderCostEntry[]} Array of matching entries.
 */
function readLedger(projectRoot, filter) {
  const ledgerFile = path.join(projectRoot, LEDGER_PATH);

  if (!fs.existsSync(ledgerFile)) {
    return [];
  }

  const raw = fs.readFileSync(ledgerFile, 'utf8');
  const lines = raw.split('\n').filter(function (line) {
    return line.trim().length > 0;
  });

  var entries = [];
  for (var i = 0; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i]));
    } catch (e) {
      // Skip malformed lines — the ledger is append-only, never edited
    }
  }

  if (!filter) {
    return entries;
  }

  if (filter.runId) {
    entries = entries.filter(function (e) { return e.run_id === filter.runId; });
  }
  if (filter.taskId) {
    entries = entries.filter(function (e) { return e.task_id === filter.taskId; });
  }
  if (filter.provider) {
    entries = entries.filter(function (e) { return e.provider === filter.provider; });
  }
  if (filter.since) {
    entries = entries.filter(function (e) { return e.recorded_at >= filter.since; });
  }

  return entries;
}

/**
 * @typedef {object} ProviderCostEntry
 * @property {string} recorded_at - ISO timestamp.
 * @property {string} request_id - Unique request identifier.
 * @property {string} [dispatch_id] - Dispatch identifier.
 * @property {string} [run_id] - Run identifier.
 * @property {string} [task_id] - Task identifier.
 * @property {string} [plan_id] - Plan identifier.
 * @property {string} [command] - Originating command.
 * @property {string} [scope_type] - 'system' | 'client'.
 * @property {string} [client_code] - Client code when scope_type is 'client'.
 * @property {string} actor_id - Identity of the actor making the call.
 * @property {string} [harness_id] - Harness identifier.
 * @property {string} provider - Provider name, e.g. 'anthropic', 'openai', 'ollama'.
 * @property {string} [provider_subtype] - Provider subtype.
 * @property {string} provider_type - 'api' | 'local' | 'browser'.
 * @property {string} model_id - Canonical model identifier.
 * @property {string} [provider_model_id] - Provider-specific model identifier.
 * @property {string} [model_family] - Model family grouping.
 * @property {string} status - 'success' | 'error' | 'timeout'.
 * @property {number} [latency_ms] - Request latency in milliseconds.
 * @property {object} [usage] - Token usage metrics.
 * @property {number} [usage.input_tokens] - Input token count.
 * @property {number} [usage.output_tokens] - Output token count.
 * @property {number} [usage.total_tokens] - Total token count.
 * @property {object} pricing - Pricing metadata.
 * @property {string} pricing.pricing_mode - 'actual' | 'estimated' | 'zero_local' | 'unknown'.
 * @property {string} [pricing.pricing_source] - Source of pricing data.
 * @property {string} [pricing.pricing_version] - Version of pricing data.
 * @property {string} [pricing.price_basis] - Basis for price calculation.
 * @property {object} canonical_cost - Canonical cost in USD.
 * @property {string} canonical_cost.currency - Always 'USD'.
 * @property {number} canonical_cost.total_amount - Total cost in USD.
 * @property {object} [display_cost] - Operator display-currency cost.
 * @property {string} [display_cost.currency] - Display currency code.
 * @property {string} [display_cost.locale] - Display locale.
 * @property {number} [display_cost.fx_rate] - FX rate from USD to display currency.
 * @property {string} [display_cost.fx_source] - Source of FX rate.
 * @property {string} [display_cost.fx_timestamp] - When FX rate was fetched.
 * @property {number} [display_cost.total_amount] - Total in display currency.
 * @property {string} [display_cost.formatted_total] - Locale-formatted total.
 * @property {object} policy - Cost policy flags.
 * @property {boolean} policy.billable - Whether this cost is billable.
 * @property {boolean} policy.local_only - Whether this was a local-only call.
 * @property {boolean} policy.eligible_for_cost_routing - Whether eligible for cost-aware routing.
 * @property {string} [policy.cost_confidence] - Confidence level of the cost data.
 */

module.exports = {
  LEDGER_PATH,
  VALID_PRICING_MODES,
  VALID_PROVIDER_TYPES,
  VALID_STATUSES,
  validateEntry,
  appendCostEntry,
  readLedger
};
