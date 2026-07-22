'use strict';

const fs = require('fs');
const path = require('path');
const { validate } = require('../../verify/lib/schema.cjs');

const LOG_DIR = path.resolve(__dirname, '..', '..', '..', '_dev', 'autonomy');
const LOG_FILE = path.join(LOG_DIR, 'run-log.jsonl');
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schemas', 'run-log-entry.schema.json');

let _schema = null;
function getSchema() {
  if (!_schema) _schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return _schema;
}

/**
 * Append a run-log entry as one JSONL line.
 * Validates against the run-log-entry schema before writing.
 * Creates the log directory if it does not exist.
 */
function appendEntry(entry) {
  const errors = validate(entry, getSchema(), { rootSchema: getSchema(), path: '' });
  if (errors.length > 0) {
    const msgs = errors.map(e => `${e.path || '/'} ${e.message}`).join('; ');
    throw new Error(`Invalid run-log entry: ${msgs}`);
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

/**
 * Read all run-log entries, optionally filtered.
 * Returns an empty array if the log file does not exist.
 */
function readLog(filterFn) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const entries = lines.map(line => JSON.parse(line));
  return filterFn ? entries.filter(filterFn) : entries;
}

/**
 * Print summary stats for the run log, grouped by profile.
 */
function printStats() {
  const entries = readLog();
  if (entries.length === 0) {
    console.log('No run-log entries found.');
    return;
  }

  const byProfile = {};
  for (const e of entries) {
    if (!byProfile[e.profile_id]) byProfile[e.profile_id] = [];
    byProfile[e.profile_id].push(e);
  }

  for (const [profileId, runs] of Object.entries(byProfile)) {
    const frameworks = new Set(runs.filter(r => r.framework_id).map(r => r.framework_id));
    const passes = runs.filter(r => r.verdict === 'PASS').length;
    const fails = runs.filter(r => r.verdict === 'FAIL').length;
    const withActions = runs.filter(r => r.has_next_actions).length;
    const timestamps = runs.map(r => r.timestamp).sort();

    console.log(`Profile: ${profileId}`);
    console.log(`  Total runs: ${runs.length}`);
    console.log(`  Distinct frameworks: ${frameworks.size}`);
    console.log(`  Pass rate: ${runs.length > 0 ? (passes / runs.length).toFixed(3) : 'N/A'}`);
    console.log(`  FAIL entries: ${fails}`);
    console.log(`  Entries with next_actions: ${withActions}`);
    console.log(`  Earliest: ${timestamps[0] ? timestamps[0].slice(0, 10) : 'N/A'}, Latest: ${timestamps[timestamps.length - 1] ? timestamps[timestamps.length - 1].slice(0, 10) : 'N/A'}`);
    console.log('');
  }
}

module.exports = {
  LOG_DIR,
  LOG_FILE,
  appendEntry,
  readLog,
  printStats
};
