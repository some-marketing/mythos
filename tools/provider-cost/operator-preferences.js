'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Relative path from project root to the operator preferences file.
 * @type {string}
 */
const PREFS_PATH = path.join('_dev', 'config', 'operator-preferences.json');

/**
 * Default operator preferences.
 * Canonical currency is always USD; display defaults to CAD for this operator.
 *
 * @type {OperatorPreferences}
 */
const DEFAULT_PREFERENCES = Object.freeze({
  operator_id: 'default',
  display_currency: 'CAD',
  display_locale: 'en-CA',
  canonical_currency: 'USD',
  fx_source: 'manual',
  fx_refresh_policy: 'per_session',
  cost_threshold_usd: null
});

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
 * Load operator preferences, creating the file with defaults if missing.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @returns {OperatorPreferences} The loaded (or default) preferences.
 */
function loadPreferences(projectRoot) {
  var prefsFile = path.join(projectRoot, PREFS_PATH);

  if (fs.existsSync(prefsFile)) {
    var raw = fs.readFileSync(prefsFile, 'utf8');
    var parsed = JSON.parse(raw);

    // Merge with defaults to ensure all fields are present
    return Object.assign({}, DEFAULT_PREFERENCES, parsed);
  }

  // Write defaults to disk so the operator can edit them
  ensureDir(prefsFile);
  fs.writeFileSync(prefsFile, JSON.stringify(DEFAULT_PREFERENCES, null, 2) + '\n', 'utf8');

  return Object.assign({}, DEFAULT_PREFERENCES);
}

/**
 * Save operator preferences to disk.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {OperatorPreferences} prefs - Preferences to save.
 */
function savePreferences(projectRoot, prefs) {
  var prefsFile = path.join(projectRoot, PREFS_PATH);
  ensureDir(prefsFile);
  fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2) + '\n', 'utf8');
}

/**
 * @typedef {object} OperatorPreferences
 * @property {string} operator_id - Operator identity.
 * @property {string} display_currency - Display currency code, e.g. 'CAD'.
 * @property {string} display_locale - Display locale, e.g. 'en-CA'.
 * @property {string} canonical_currency - Always 'USD'.
 * @property {string} fx_source - FX rate source, e.g. 'manual' or 'api'.
 * @property {string} fx_refresh_policy - When to refresh FX rates, e.g. 'daily' or 'per_session'.
 * @property {number|null} cost_threshold_usd - 24h USD spend threshold for dispatch warnings. Null means no enforcement.
 */

module.exports = {
  PREFS_PATH,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences
};
