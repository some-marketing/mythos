'use strict';

/**
 * objection-ledger.js — W3 — durable per-loop-instance OPEN-OBJECTION ledger.
 *
 * Implements condition (1) of the Loop Convergence Bounding Law v3
 * (_dev/concepts/self-improving-loop-protocol/staging/canonical/loop-convergence-bounding-law-v3.md):
 *
 *   "Open-objection ledger EMPTY. Every material objection has a durable ID;
 *    count/close fields are authored/signed by the objecting adversary's roster
 *    entry (lib-mediated writer, mirroring plan-review-state.js — NOT the
 *    coordinator). An objection moves to CLOSED only by the objecting family or
 *    the operator. Expiry -> UNRESOLVED_OPERATOR_DECISION, which is loop-terminal
 *    and never ledger-clearing (an expired objection still blocks DRY)."
 *
 * WRITER DISCIPLINE (mirrors tools/planning/lib/plan-review-state.js): the ledger
 * is NEVER hand-authored. All mutation goes through raise/close/expire, each of
 * which validates shape + custody + atomic-writes. There is NO raw external
 * writer. Closure custody is enforced HERE (in the writer), not by a downstream
 * gate: closeObjection() throws unless the closer is the objecting family or the
 * operator.
 *
 * CUSTODY NOTE (Universal Custody Quantifier): the ledger is "victory evidence"
 * held under non-defendant custody. The coordinator/defending family cannot close
 * an objection it did not raise. That is the whole point — this converts
 * convergence from a coordinator-measured novelty derivative into an
 * adversary-controlled resolution level.
 *
 * State lives at:
 *   _dev/state/loop-classification-ledger/<instance>.objections.json
 * File shape:
 *   { instance, version, objections: [ <objection>, ... ] }
 * Objection shape:
 *   { id, raised_by:{actor,harness,family}, summary, raised_at,
 *     status:'open'|'closed'|'UNRESOLVED_OPERATOR_DECISION',
 *     closed_by:{actor,harness,family,role}|null, close_signature:string|null,
 *     closed_at:string|null, expiry_reason:string|null }
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const STATE_DIR = path.join(
  PROJECT_ROOT,
  '_dev',
  'state',
  'loop-classification-ledger'
);

const LEDGER_VERSION = 1;

const STATUS_OPEN = 'open';
const STATUS_CLOSED = 'closed';
// Loop-terminal expiry status. NEVER clears the ledger for DRY purposes.
const STATUS_UNRESOLVED = 'UNRESOLVED_OPERATOR_DECISION';

const VALID_STATUSES = new Set([STATUS_OPEN, STATUS_CLOSED, STATUS_UNRESOLVED]);

function ledgerPath(instance) {
  if (!instance || typeof instance !== 'string') {
    throw new Error('objection-ledger: instance id (non-empty string) is required');
  }
  if (/[\\/]/.test(instance)) {
    throw new Error(`objection-ledger: instance id must not contain path separators: ${instance}`);
  }
  return path.join(STATE_DIR, `${instance}.objections.json`);
}

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function _isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate a family/roster sub-object ({actor, harness, family}). role optional.
 * @param {*} who
 * @param {string} field
 */
function _validateWho(who, field, opts) {
  opts = opts || {};
  if (!_isPlainObject(who)) {
    throw new Error(`${field} must be an object with {actor, harness, family}`);
  }
  for (const k of ['actor', 'harness', 'family']) {
    if (typeof who[k] !== 'string' || who[k].length === 0) {
      throw new Error(`${field}.${k} must be a non-empty string`);
    }
  }
  if (opts.requireRole && (typeof who.role !== 'string' || who.role.length === 0)) {
    throw new Error(`${field}.role must be a non-empty string`);
  }
}

/**
 * Load the raw ledger file object for an instance (empty shape if absent).
 * @param {string} instance
 * @returns {{ instance:string, version:number, objections:Array }}
 */
function load(instance) {
  const p = ledgerPath(instance);
  if (!fs.existsSync(p)) {
    return { instance, version: LEDGER_VERSION, objections: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`objection-ledger: corrupt ledger file ${p}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.objections)) {
    throw new Error(`objection-ledger: malformed ledger file ${p} (missing objections[])`);
  }
  return parsed;
}

function _write(instance, ledger) {
  ensureDir();
  const p = ledgerPath(instance);
  const payload = JSON.stringify(ledger, null, 2) + '\n';
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, p);
  return ledger;
}

/**
 * Raise (append) a material objection. Status starts OPEN.
 *
 * @param {string} instance
 * @param {{ id:string, raised_by:{actor,harness,family}, summary?:string, raised_at?:string }} objection
 * @returns {object} the stored objection
 */
function raiseObjection(instance, objection) {
  if (!_isPlainObject(objection)) {
    throw new Error('objection-ledger.raiseObjection: objection object is required');
  }
  if (typeof objection.id !== 'string' || objection.id.length === 0) {
    throw new Error('objection-ledger.raiseObjection: objection.id (non-empty string) is required');
  }
  _validateWho(objection.raised_by, 'objection.raised_by');
  if (
    objection.summary !== undefined &&
    objection.summary !== null &&
    typeof objection.summary !== 'string'
  ) {
    throw new Error('objection-ledger.raiseObjection: objection.summary must be a string when present');
  }

  const ledger = load(instance);
  if (ledger.objections.some((o) => o && o.id === objection.id)) {
    throw new Error(
      `objection-ledger.raiseObjection: objection id "${objection.id}" already exists for instance "${instance}"`
    );
  }

  const stored = {
    id: objection.id,
    raised_by: {
      actor: objection.raised_by.actor,
      harness: objection.raised_by.harness,
      family: objection.raised_by.family,
    },
    summary: objection.summary || '',
    raised_at: objection.raised_at || new Date().toISOString(),
    status: STATUS_OPEN,
    closed_by: null,
    close_signature: null,
    closed_at: null,
    expiry_reason: null,
  };

  ledger.instance = instance;
  ledger.version = ledger.version || LEDGER_VERSION;
  ledger.objections.push(stored);
  _write(instance, ledger);
  return stored;
}

function _findOrThrow(ledger, id, instance) {
  const idx = ledger.objections.findIndex((o) => o && o.id === id);
  if (idx < 0) {
    throw new Error(`objection-ledger: no objection with id "${id}" for instance "${instance}"`);
  }
  return idx;
}

/**
 * Close an objection. CUSTODY-ENFORCED IN THE WRITER: allowed ONLY by the
 * objecting family or the operator. Any other closer (notably the coordinator /
 * defending family) is rejected.
 *
 * An UNRESOLVED_OPERATOR_DECISION objection is loop-terminal and CANNOT be
 * closed by a family — only the operator may close it (it represents an
 * escalation the human must resolve).
 *
 * @param {string} instance
 * @param {string} id
 * @param {{ closed_by:{actor,harness,family,role?}, close_signature:string }} closer
 * @returns {object} the updated objection
 */
function closeObjection(instance, id, closer) {
  if (!_isPlainObject(closer)) {
    throw new Error('objection-ledger.closeObjection: closer object is required');
  }
  _validateWho(closer.closed_by, 'closer.closed_by');
  if (typeof closer.close_signature !== 'string' || closer.close_signature.length === 0) {
    throw new Error('objection-ledger.closeObjection: closer.close_signature (non-empty string) is required');
  }

  const ledger = load(instance);
  const idx = _findOrThrow(ledger, id, instance);
  const obj = ledger.objections[idx];

  const closerRole = String(closer.closed_by.role || '').toLowerCase();
  const isOperator =
    closerRole === 'operator' || String(closer.closed_by.family).toLowerCase() === 'operator';
  const isObjectingFamily = closer.closed_by.family === obj.raised_by.family;

  // CUSTODY GATE — writer-enforced.
  if (obj.status === STATUS_UNRESOLVED && !isOperator) {
    throw new Error(
      `objection-ledger.closeObjection: objection "${id}" is UNRESOLVED_OPERATOR_DECISION ` +
        '(loop-terminal); only the operator may close it'
    );
  }
  if (!isObjectingFamily && !isOperator) {
    throw new Error(
      `objection-ledger.closeObjection: closure of "${id}" refused — closer family ` +
        `"${closer.closed_by.family}" is neither the objecting family ("${obj.raised_by.family}") ` +
        'nor the operator. Closure is allowed ONLY by the objecting family or the operator.'
    );
  }

  obj.status = STATUS_CLOSED;
  obj.closed_by = {
    actor: closer.closed_by.actor,
    harness: closer.closed_by.harness,
    family: closer.closed_by.family,
    role: closer.closed_by.role || null,
  };
  obj.close_signature = closer.close_signature;
  obj.closed_at = new Date().toISOString();
  _write(instance, ledger);
  return obj;
}

/**
 * Expire an OPEN objection to UNRESOLVED_OPERATOR_DECISION. This status is
 * loop-terminal and NEVER clears the ledger for DRY — an expired objection still
 * blocks convergence and routes to the operator.
 *
 * @param {string} instance
 * @param {string} id
 * @param {{ reason?:string }} [opts]
 * @returns {object} the updated objection
 */
function expireObjection(instance, id, opts) {
  opts = opts || {};
  const ledger = load(instance);
  const idx = _findOrThrow(ledger, id, instance);
  const obj = ledger.objections[idx];
  if (obj.status === STATUS_CLOSED) {
    throw new Error(
      `objection-ledger.expireObjection: objection "${id}" is already CLOSED; cannot expire a closed objection`
    );
  }
  obj.status = STATUS_UNRESOLVED;
  obj.expiry_reason = opts.reason || 'iteration-cap exhaustion / unresolved';
  _write(instance, ledger);
  return obj;
}

/**
 * All objections for an instance (append order).
 * @param {string} instance
 * @returns {Array<object>}
 */
function read(instance) {
  return load(instance).objections;
}

/**
 * The objections that still BLOCK dry — everything that is not CLOSED. Includes
 * UNRESOLVED_OPERATOR_DECISION (by design: expiry never clears).
 * @param {string} instance
 * @returns {Array<object>}
 */
function blockingObjections(instance) {
  return load(instance).objections.filter((o) => o && o.status !== STATUS_CLOSED);
}

/**
 * Is the ledger CLEAR for DRY? True only if every objection is CLOSED (or there
 * are none). An open OR UNRESOLVED_OPERATOR_DECISION objection makes it false.
 *
 * @param {string} instance
 * @returns {boolean}
 */
function isLedgerClearForDry(instance) {
  return blockingObjections(instance).length === 0;
}

module.exports = {
  raiseObjection,
  closeObjection,
  expireObjection,
  read,
  blockingObjections,
  isLedgerClearForDry,
  ledgerPath,
  load,
  STATE_DIR,
  LEDGER_VERSION,
  STATUS_OPEN,
  STATUS_CLOSED,
  STATUS_UNRESOLVED,
  VALID_STATUSES,
};
