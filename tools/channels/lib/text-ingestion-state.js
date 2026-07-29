'use strict';

/**
 * text-ingestion-state.js -- State management for the text ingestion bridge.
 *
 * Provides config loading, state persistence, and contact allowlist checks.
 * One-way read-only: this module never sends messages or exposes outbound paths.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_SCHEMAS = ['TextIngestionBridge/1.0', 'TextIngestionBridge/1.1'];
const STATE_SCHEMA = 'TextIngestionState/1.0';

const CONFIG_REL_PATH = '_dev/config/text-ingestion.json';
const STATE_REL_PATH = '_dev/state/text-ingestion.state.json';

/**
 * Load and validate the text ingestion bridge config.
 *
 * @param {string} projectRoot - Absolute path to the repo root
 * @returns {object} Parsed and validated config object
 * @throws {Error} If the config file is missing or has an unexpected schema
 */
function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, CONFIG_REL_PATH);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Text ingestion config not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);

  if (!CONFIG_SCHEMAS.includes(config.schema)) {
    throw new Error(
      `Unexpected config schema "${config.schema}", expected one of ${CONFIG_SCHEMAS.join(', ')}`
    );
  }

  // Validate safety invariant: outbound_messaging must be NEVER
  if (!config.safety || config.safety.outbound_messaging !== 'NEVER') {
    throw new Error(
      'Safety violation: outbound_messaging must be "NEVER". This bridge is read-only.'
    );
  }

  return config;
}

/**
 * Load the persisted ingestion state, or return a default empty state.
 *
 * @param {string} projectRoot - Absolute path to the repo root
 * @returns {object} State object with per-contact watermarks
 */
function loadState(projectRoot) {
  const statePath = path.join(projectRoot, STATE_REL_PATH);
  if (!fs.existsSync(statePath)) {
    return { schema: STATE_SCHEMA, contacts: {} };
  }
  const raw = fs.readFileSync(statePath, 'utf8');
  const state = JSON.parse(raw);

  if (state.schema !== STATE_SCHEMA) {
    // Incompatible state file -- return fresh state
    return { schema: STATE_SCHEMA, contacts: {} };
  }

  return state;
}

/**
 * Save ingestion state atomically (write-tmp then rename).
 *
 * @param {string} projectRoot - Absolute path to the repo root
 * @param {object} state - State object to persist
 */
function saveState(projectRoot, state) {
  const statePath = path.join(projectRoot, STATE_REL_PATH);
  const stateDir = path.dirname(statePath);
  fs.mkdirSync(stateDir, { recursive: true });

  const tmpPath = statePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, statePath);
}

/**
 * Check whether a given handle is an enabled contact in the config.
 *
 * @param {string} handle - The iMessage handle address to check
 * @param {object} config - Loaded config object
 * @returns {boolean} True if the handle matches an enabled contact
 */
function isContactAllowed(handle, config) {
  if (!handle || !config || !Array.isArray(config.contacts)) return false;
  const normalized = String(handle).trim().toLowerCase();
  return config.contacts.some(
    (c) => c.enabled && c.handle && String(c.handle).trim().toLowerCase() === normalized
  );
}

/**
 * Get the display name for a handle from the config.
 *
 * @param {string} handle - The iMessage handle address
 * @param {object} config - Loaded config object
 * @returns {string} Display name, or "Unknown" if not found
 */
function getContactName(handle, config) {
  if (!handle || !config || !Array.isArray(config.contacts)) return 'Unknown';
  const normalized = String(handle).trim().toLowerCase();
  const contact = config.contacts.find(
    (c) => c.handle && String(c.handle).trim().toLowerCase() === normalized
  );
  return contact ? contact.name : 'Unknown';
}

/**
 * Get the client code associated with a handle, if any.
 *
 * @param {string} handle - The iMessage handle address
 * @param {object} config - Loaded config object
 * @returns {string|null} Client code or null
 */
function getContactClientCode(handle, config) {
  if (!handle || !config || !Array.isArray(config.contacts)) return null;
  const normalized = String(handle).trim().toLowerCase();
  const contact = config.contacts.find(
    (c) => c.handle && String(c.handle).trim().toLowerCase() === normalized
  );
  return contact ? contact.client_code || null : null;
}

/**
 * Get the last-seen message ROWID for a handle (dedup watermark).
 *
 * @param {string} handle - The iMessage handle address
 * @param {object} state - Loaded state object
 * @returns {number|null} Last seen message ROWID, or null if none
 */
function getLastSeenId(handle, state) {
  if (!handle || !state || !state.contacts) return null;
  const normalized = String(handle).trim().toLowerCase();
  const entry = state.contacts[normalized];
  return entry ? entry.last_seen_message_id : null;
}

/**
 * Update the last-seen watermark for a handle.
 *
 * @param {string} handle - The iMessage handle address
 * @param {number} messageId - The ROWID of the latest processed message
 * @param {object} state - State object to update (mutated in place)
 * @returns {object} The updated state object
 */
function updateLastSeen(handle, messageId, state) {
  if (!handle || !state) return state;
  const normalized = String(handle).trim().toLowerCase();

  if (!state.contacts) {
    state.contacts = {};
  }

  const existing = state.contacts[normalized] || {
    last_seen_message_id: null,
    last_scan: null,
    messages_ingested: 0
  };

  existing.last_seen_message_id = messageId;
  existing.last_scan = new Date().toISOString();
  existing.messages_ingested = (existing.messages_ingested || 0) + 1;

  state.contacts[normalized] = existing;
  return state;
}

module.exports = {
  CONFIG_SCHEMAS,
  STATE_SCHEMA,
  CONFIG_REL_PATH,
  STATE_REL_PATH,
  loadConfig,
  loadState,
  saveState,
  isContactAllowed,
  getContactName,
  getContactClientCode,
  getLastSeenId,
  updateLastSeen
};
