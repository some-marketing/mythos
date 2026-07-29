'use strict';

/**
 * iteration-cap.js — W3 — numeric per-run iteration counter for a loop-instance.
 *
 * Loop-protocol law candidate inv 9 (Interruptability): the iteration cap is
 * ENFORCED by a numeric limit held in loop-instance run state, decremented per
 * iteration and HARD-STOPPING at zero — NOT a prose maximum. Absence of this
 * state counter for an instance is an ADOPTION BLOCKER.
 *
 * State lives at:
 *   _dev/state/loop-classification-ledger/<instance>.itercap.json
 * File shape: { instance, initial, remaining, ts }
 *
 * Semantics:
 *   init(instance, n)     -> FIRST-TIME init only; writes remaining=n; returns state.
 *   init(instance, n, {operatorToken}) -> RE-INIT of an existing cap. Requires an
 *                            operator-signed token AND writes an append-only audit
 *                            entry. Without the token, re-init THROWS. This closes
 *                            Fable finding #3 ("a resettable counter is theater"):
 *                            a loop can no longer exhaust its cap and silently
 *                            re-init to keep going.
 *   decrement(instance)   -> consumes one iteration; returns remaining (never < 0).
 *                            When already exhausted (0), it stays 0 (hard stop).
 *   isExhausted(instance) -> true once remaining <= 0.
 *
 * TOKEN INTEGRITY IS STUBBED (presence-only): this lib checks that a non-empty
 * operatorToken string is PRESENT, mirroring the presence-only operator_stamp
 * pattern in plan-review-state.js. It does NOT cryptographically verify the token
 * — real signature/HMAC verification against an operator-writable-only marker is
 * Layer-2 arming work (see the v3 law "Backstop" clause), NOT built here. A
 * hand-written token passes presence here but must be re-verified at arming.
 *
 * The audit trail lives at:
 *   _dev/state/loop-classification-ledger/<instance>.itercap-audit.jsonl
 * (append-only; one JSON object per line).
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

function capPath(instance) {
  if (!instance || typeof instance !== 'string') {
    throw new Error('iteration-cap: instance id (non-empty string) is required');
  }
  if (/[\\/]/.test(instance)) {
    throw new Error(`iteration-cap: instance id must not contain path separators: ${instance}`);
  }
  return path.join(STATE_DIR, `${instance}.itercap.json`);
}

/**
 * Path to the append-only re-init audit trail (JSONL) for an instance.
 * @param {string} instance
 * @returns {string}
 */
function auditPath(instance) {
  if (!instance || typeof instance !== 'string') {
    throw new Error('iteration-cap: instance id (non-empty string) is required');
  }
  if (/[\\/]/.test(instance)) {
    throw new Error(`iteration-cap: instance id must not contain path separators: ${instance}`);
  }
  return path.join(STATE_DIR, `${instance}.itercap-audit.jsonl`);
}

/**
 * Append (never rewrite) one audit record to the instance re-init trail.
 * @param {string} instance
 * @param {object} record
 */
function appendAudit(instance, record) {
  ensureDir();
  fs.appendFileSync(auditPath(instance), JSON.stringify(record) + '\n', 'utf8');
}

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadState(instance) {
  const p = capPath(instance);
  if (!fs.existsSync(p)) {
    throw new Error(`iteration-cap: no cap initialized for instance "${instance}" — call init() first`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`iteration-cap: corrupt cap file ${p}: ${err.message}`);
  }
  if (typeof parsed.remaining !== 'number') {
    throw new Error(`iteration-cap: malformed cap file ${p} (missing numeric remaining)`);
  }
  return parsed;
}

function writeState(instance, state) {
  ensureDir();
  fs.writeFileSync(capPath(instance), JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}

/**
 * Initialize the iteration cap for an instance to n iterations.
 *
 * FIRST-TIME init (no cap state exists yet) is allowed with no token.
 *
 * RE-INIT (a cap file already exists — ANY prior state, exhausted or not)
 * REQUIRES opts.operatorToken (a non-empty operator-signed token) and writes an
 * append-only audit entry. Without the token, re-init THROWS. This is the
 * hardening for Fable finding #3: a resettable counter is theater; the loop
 * cannot silently reset its own energy backstop.
 *
 * @param {string} instance
 * @param {number} n  non-negative integer iteration budget
 * @param {{ operatorToken?:string, reason?:string }} [opts]
 * @returns {{instance:string, initial:number, remaining:number, ts:string, reinit_count:number}}
 */
function init(instance, n, opts) {
  opts = opts || {};
  // Validate n FIRST so a bad n reports the numeric error regardless of re-init
  // state (preserves the "-1 -> non-negative integer" contract on re-init too).
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`iteration-cap.init: n must be a non-negative integer, got ${n}`);
  }

  const existing = fs.existsSync(capPath(instance));
  if (existing) {
    // RE-INIT: any prior state (even remaining=0) requires an operator token.
    const token = opts.operatorToken;
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new Error(
        `iteration-cap.init: re-init of an existing cap for instance "${instance}" requires ` +
          'an operator-signed token (opts.operatorToken). A cap cannot be silently reset — ' +
          'this is the interruptability backstop (v3 law, invariant 9).'
      );
    }
    let prior = null;
    try {
      prior = loadState(instance);
    } catch (_) {
      prior = null;
    }
    const priorReinit = (prior && typeof prior.reinit_count === 'number') ? prior.reinit_count : 0;
    const state = {
      instance,
      initial: n,
      remaining: n,
      ts: new Date().toISOString(),
      reinit_count: priorReinit + 1,
    };
    // Append-only audit BEFORE the state write, so a re-init is always witnessed.
    appendAudit(instance, {
      event: 'reinit',
      instance,
      ts: state.ts,
      n,
      prior_remaining: prior ? prior.remaining : null,
      reinit_count: state.reinit_count,
      operator_token_present: true,
      // Presence-only: record a short prefix ref, NOT the token itself.
      operator_token_ref: token.slice(0, 8),
      reason: opts.reason || null,
    });
    return writeState(instance, state);
  }

  // FIRST-TIME init.
  return writeState(instance, {
    instance,
    initial: n,
    remaining: n,
    ts: new Date().toISOString(),
    reinit_count: 0,
  });
}

/**
 * Consume one iteration. Returns the remaining count AFTER decrement.
 * Hard-stops at zero: never returns a negative value; decrementing an already
 * exhausted counter is a no-op that keeps remaining at 0.
 * @param {string} instance
 * @returns {number} remaining iterations
 */
function decrement(instance) {
  const state = loadState(instance);
  if (state.remaining <= 0) {
    // Hard stop: already exhausted, do not go negative.
    state.remaining = 0;
    state.ts = new Date().toISOString();
    writeState(instance, state);
    return 0;
  }
  state.remaining -= 1;
  state.ts = new Date().toISOString();
  writeState(instance, state);
  return state.remaining;
}

/**
 * @param {string} instance
 * @returns {boolean} true once the iteration budget is exhausted.
 */
function isExhausted(instance) {
  return loadState(instance).remaining <= 0;
}

/**
 * Read current remaining without mutating. Throws if uninitialized.
 * @param {string} instance
 * @returns {number}
 */
function remaining(instance) {
  return loadState(instance).remaining;
}

module.exports = {
  init,
  decrement,
  isExhausted,
  remaining,
  capPath,
  auditPath,
  STATE_DIR,
};
