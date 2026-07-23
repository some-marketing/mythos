'use strict';

/**
 * ledger.js — W3 — per-instance classification ledger writer/reader.
 *
 * The reclassification RATCHET diffs against this ledger (loop-protocol law
 * candidate §2, F-v2-4). Every classification decision for a path in a
 * loop-instance is recorded here so a later down-layer relabel can be caught.
 *
 * Record shape (INTERFACE.md §"ledger.js record"):
 *   { path, layer, classified_by:{ actor, harness, family }, ts, change_ref }
 *
 * Operator-signed reclassify entries (written by ledger-ratchet.cjs) are the
 * SAME shape with additional { kind:'reclassify', reclassify:{...}, signature }
 * fields. append() accepts either; the extra fields pass through untouched.
 *
 * Ledgers live at: _dev/state/loop-classification-ledger/<instance>.json
 * File shape: { instance, version, entries: [ <record>, ... ] }
 *
 * Down-layer reclassification (L1 -> L0/L0.5) is a fail->pass ratchet event.
 * Consumers that see a down-layer diff WITHOUT a matching operator reclassify
 * entry MUST treat it as a ratchet violation (BLOCK).
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const LEDGER_DIR = path.join(
  PROJECT_ROOT,
  '_dev',
  'state',
  'loop-classification-ledger'
);

const LEDGER_VERSION = 1;
const VALID_LAYERS = ['L0', 'L0.5', 'L1', 'L2'];

/**
 * Absolute path to the ledger file for an instance.
 * @param {string} instance
 * @returns {string}
 */
function ledgerPath(instance) {
  if (!instance || typeof instance !== 'string') {
    throw new Error('ledger: instance id (non-empty string) is required');
  }
  if (/[\\/]/.test(instance)) {
    throw new Error(`ledger: instance id must not contain path separators: ${instance}`);
  }
  return path.join(LEDGER_DIR, `${instance}.json`);
}

function ensureDir() {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
}

/**
 * Load the raw ledger file object for an instance (creating an empty shape if absent).
 * @param {string} instance
 * @returns {{ instance:string, version:number, entries:Array }}
 */
function load(instance) {
  const p = ledgerPath(instance);
  if (!fs.existsSync(p)) {
    return { instance, version: LEDGER_VERSION, entries: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`ledger: corrupt ledger file ${p}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`ledger: malformed ledger file ${p} (missing entries[])`);
  }
  return parsed;
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('ledger.append: record object is required');
  }
  if (!record.path || typeof record.path !== 'string') {
    throw new Error('ledger.append: record.path (non-empty string) is required');
  }
  if (!VALID_LAYERS.includes(record.layer)) {
    throw new Error(
      `ledger.append: record.layer must be one of ${VALID_LAYERS.join(', ')}, got ${record.layer}`
    );
  }
  const cb = record.classified_by;
  if (!cb || typeof cb !== 'object') {
    throw new Error('ledger.append: record.classified_by{actor,harness,family} is required');
  }
  for (const k of ['actor', 'harness', 'family']) {
    if (!cb[k] || typeof cb[k] !== 'string') {
      throw new Error(`ledger.append: record.classified_by.${k} (non-empty string) is required`);
    }
  }
}

/**
 * Append a classification record to an instance ledger. Stamps `ts` (ISO-8601)
 * if the caller did not provide one. Returns the stored entry.
 *
 * @param {string} instance
 * @param {{ path:string, layer:string, classified_by:{actor:string,harness:string,family:string}, ts?:string, change_ref?:string }} record
 * @returns {object} the stored entry
 */
function append(instance, record) {
  validateRecord(record);
  ensureDir();
  const ledger = load(instance);

  const entry = {
    ...record,
    path: record.path,
    layer: record.layer,
    classified_by: {
      actor: record.classified_by.actor,
      harness: record.classified_by.harness,
      family: record.classified_by.family,
    },
    ts: record.ts || new Date().toISOString(),
    change_ref: record.change_ref || null,
  };

  ledger.instance = instance;
  ledger.version = ledger.version || LEDGER_VERSION;
  ledger.entries.push(entry);

  fs.writeFileSync(ledgerPath(instance), JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  return entry;
}

/**
 * Read all entries for an instance (chronological append order).
 * @param {string} instance
 * @returns {Array<object>}
 */
function read(instance) {
  return load(instance).entries;
}

/**
 * Find the CURRENTLY-EFFECTIVE layer for a path in an instance ledger — the
 * layer of the most recent entry (including operator reclassify entries) whose
 * `path` matches. Returns null if the path was never classified.
 *
 * @param {string} instance
 * @param {string} targetPath
 * @returns {string|null}
 */
function findLayer(instance, targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('ledger.findLayer: targetPath (non-empty string) is required');
  }
  const entries = load(instance).entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].path === targetPath) {
      return entries[i].layer;
    }
  }
  return null;
}

module.exports = {
  append,
  read,
  findLayer,
  ledgerPath,
  LEDGER_DIR,
  LEDGER_VERSION,
  VALID_LAYERS,
};
