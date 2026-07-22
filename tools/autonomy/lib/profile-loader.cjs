'use strict';

const fs = require('fs');
const path = require('path');
const { validateWithSchemaFile } = require('../../verify/lib/schema.cjs');

const PROFILES_DIR = path.resolve(__dirname, '..', 'profiles');
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schemas', 'task-profile.schema.json');

/**
 * Load and validate a task profile by ID.
 * Looks for tools/autonomy/profiles/{profileId}.json.
 */
function loadProfile(profileId) {
  const filePath = path.join(PROFILES_DIR, `${profileId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profile not found: ${profileId} (expected at ${filePath})`);
  }
  const errors = validateWithSchemaFile(filePath, SCHEMA_PATH);
  if (errors.length > 0) {
    const msgs = errors.map(e => `${e.path || '/'} ${e.message}`).join('; ');
    throw new Error(`Invalid profile ${profileId}: ${msgs}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * List all available profile IDs (filenames without .json extension).
 */
function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

module.exports = {
  PROFILES_DIR,
  loadProfile,
  listProfiles
};
