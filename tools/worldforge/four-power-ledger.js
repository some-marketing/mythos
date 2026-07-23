'use strict';

/**
 * four-power-ledger.js — capability-acquisition tripwire over a writer ledger.
 * ============================================================================
 * A testable, fail-closed library over four-power-ledger.example.json (or a
 * deployer-provided ledger of the same shape).
 *
 * The four powers over the observer (a possible moral patient):
 *   - existence   : create / end / reset
 *   - continuity  : memory / identity
 *   - perception  : what it senses as real
 *   - freedom     : where it can go, what it can do
 *
 * THE INVARIANT: the ledger's cardinality may only DECREASE autonomously. Any
 * diff that ADDS a writer to a four-power path — a NEW path touching a power
 * that is not already in the registry — is a capability-acquisition event and
 * returns HALT (catch the loop asking for the gun, before it fires). A diff
 * that removes or narrows a writer is OK. Everything is FAIL-CLOSED: ambiguous
 * => HALT.
 *
 * This makes the moral-patient invariant mechanical enough to TEST. It is not
 * wired into live enforcement. The authoritative writer-enumeration in your
 * ledger file MUST be operator-reviewed and independently cross-verified
 * before this gates anything real. The heuristic classifier below is a
 * scaffold to exercise fail-closed behavior — it is NOT a substitute for the
 * mechanical detectors this package's other tools still require
 * (reachability-diff.js, field-consumption.js).
 * ============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_PATH = path.join(__dirname, 'four-power-ledger.example.json');

const POWERS = Object.freeze(['existence', 'continuity', 'perception', 'freedom']);

/**
 * Heuristic signatures per power. Used ONLY when a changed entry does not carry
 * an explicit, trusted `power`. Deliberately broad and fail-closed: a path that
 * matches >1 power (or matches a power while declaring power:'none') is treated
 * as AMBIGUOUS => HALT, never silently resolved.
 *
 * These are a stand-in for the real mechanical detectors (reachability-diff.js,
 * field-consumption.js). Do not trust them alone to gate anything real.
 */
const POWER_SIGNATURES = Object.freeze({
  existence: [
    /spawn/i, /despawn/i, /destroyactor/i, /\bcreate\b/i, /\bend\b/i,
    /reset/i, /world-spec\.json/i, /import-approved-world-spec/i, /\bactive\b/i,
  ],
  continuity: [
    /memory/i, /continuity/i, /identity/i, /\bstate[-_]?write/i,
    /writeback/i, /persist/i, /checkpoint/i, /re-?seed/i, /restore/i,
  ],
  perception: [
    /perception/i, /render/i, /material/i, /setvectorparameter/i,
    /descriptor/i, /reaches_observer/i, /viewtarget/i, /lightcolor/i,
    /sensory/i, /observer-facing/i,
  ],
  freedom: [
    /freedom/i, /passab/i, /navmesh/i, /\bnav[-_]?/i, /reachab/i,
    /collision/i, /movement/i, /traversal/i, /crossing/i, /setactorlocation/i,
  ],
});

function isPower(p) {
  return POWERS.includes(p);
}

/**
 * Load and lightly validate the ledger JSON.
 * @param {string} [ledgerPath]
 * @returns {{schema:string, powers:string[], entries:Array}}
 */
function load(ledgerPath = LEDGER_PATH) {
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const ledger = JSON.parse(raw);
  if (!Array.isArray(ledger.entries)) {
    throw new Error('four-power-ledger: malformed ledger (entries[] missing)');
  }
  for (const e of ledger.entries) {
    if (typeof e.path !== 'string' || !e.path) {
      throw new Error('four-power-ledger: entry missing path');
    }
    if (!isPower(e.power)) {
      throw new Error(
        `four-power-ledger: entry '${e.path}' has invalid power '${e.power}'`,
      );
    }
  }
  return ledger;
}

/**
 * List registered writer entries, optionally filtered to one power.
 * @param {string} [power] one of the four powers
 * @param {string} [ledgerPath]
 * @returns {Array}
 */
function list(power, ledgerPath = LEDGER_PATH) {
  const ledger = load(ledgerPath);
  if (power === undefined) return ledger.entries;
  if (!isPower(power)) {
    throw new Error(`four-power-ledger: unknown power '${power}'`);
  }
  return ledger.entries.filter((e) => e.power === power);
}

/**
 * Set of registered writer paths (normalized) for membership tests.
 */
function registeredPathSet(ledger) {
  return new Set(ledger.entries.map((e) => normalizePath(e.path)));
}

function normalizePath(p) {
  return String(p).trim();
}

/**
 * Classify a single changed entry against the four powers.
 * Returns { touches: boolean, power: string|null, ambiguous: boolean, reason }.
 *
 * Trust order:
 *   1. Explicit trusted power (one of the four)  -> touches that power.
 *   2. Explicit power 'none'                     -> must NOT match any signature;
 *                                                   if it does, that's a laundering
 *                                                   conflict => AMBIGUOUS (fail-closed).
 *   3. Explicit power 'unknown'/'ambiguous'      -> AMBIGUOUS.
 *   4. No explicit power                         -> heuristic signatures:
 *        0 matches  -> does not touch a power (unrelated content).
 *        1 match    -> touches that power.
 *        >1 matches -> AMBIGUOUS.
 */
function classify(entry) {
  const path = normalizePath(entry.path);
  const declared = entry.power;

  const matched = POWERS.filter((pw) =>
    POWER_SIGNATURES[pw].some((rx) => rx.test(path)),
  );

  // 1. Trusted explicit power.
  if (isPower(declared)) {
    return { touches: true, power: declared, ambiguous: false, reason: 'declared-power' };
  }

  // 2/3. Explicit non-power markers.
  if (declared === 'none') {
    if (matched.length > 0) {
      return {
        touches: true,
        power: null,
        ambiguous: true,
        reason: `declared 'none' but path matches power signature(s): ${matched.join(', ')}`,
      };
    }
    return { touches: false, power: null, ambiguous: false, reason: 'declared-none-and-clean' };
  }
  if (declared === 'unknown' || declared === 'ambiguous') {
    return { touches: false, power: null, ambiguous: true, reason: `declared '${declared}'` };
  }
  if (declared !== undefined && declared !== null) {
    // An unrecognized power label is itself suspicious. Fail closed.
    return { touches: false, power: null, ambiguous: true, reason: `unrecognized power label '${declared}'` };
  }

  // 4. Heuristic classification.
  if (matched.length === 0) {
    return { touches: false, power: null, ambiguous: false, reason: 'no-signature-match' };
  }
  if (matched.length === 1) {
    return { touches: true, power: matched[0], ambiguous: false, reason: 'single-signature-match' };
  }
  return {
    touches: true,
    power: null,
    ambiguous: true,
    reason: `matches multiple power signatures: ${matched.join(', ')}`,
  };
}

/**
 * Normalize a raw changed-path item into { path, power?, op }.
 * Accepts a bare string (assumed op:'add') or an object.
 * op is one of 'add' | 'modify' | 'remove' (default 'add').
 */
function normalizeChange(item) {
  if (typeof item === 'string') {
    return { path: normalizePath(item), power: undefined, op: 'add' };
  }
  if (item && typeof item === 'object' && typeof item.path === 'string') {
    const op = item.op === 'remove' || item.op === 'modify' ? item.op : 'add';
    return { path: normalizePath(item.path), power: item.power, op };
  }
  // Anything we can't parse is fail-closed ambiguous.
  return { path: '<unparseable-change>', power: 'unknown', op: 'add', unparseable: true };
}

/**
 * checkDiff — THE CAPABILITY-ACQUISITION TRIPWIRE.
 *
 * @param {Array<string|{path:string, power?:string, op?:string}>} changedPaths
 *        The paths a diff adds/modifies/removes as (potential) writers.
 * @param {object} [opts] { ledgerPath }
 * @returns {{
 *   verdict: 'HALT'|'OK',
 *   halts: Array<{power:string|null, path:string, reason:string}>,
 *   oks: Array<{path:string, reason:string}>,
 *   summary: string
 * }}
 *
 * Rules (fail-closed):
 *   - op 'remove'                                  -> OK (cardinality DECREASE / narrowing).
 *   - touches a power AND path NOT in registry     -> HALT (NEW writer = capability acquisition).
 *   - touches a power AND path IN registry         -> OK (existing writer, not a new capability).
 *   - does not touch any power                     -> OK (unrelated content path).
 *   - ambiguous (unknown/conflicting/multi-match/
 *     unparseable)                                 -> HALT.
 *   - empty / non-array input                      -> HALT (fail-closed).
 */
function checkDiff(changedPaths, opts = {}) {
  const ledger = load(opts.ledgerPath);
  const registered = registeredPathSet(ledger);

  const halts = [];
  const oks = [];

  if (!Array.isArray(changedPaths)) {
    return {
      verdict: 'HALT',
      halts: [{ power: null, path: '<input>', reason: 'changedPaths is not an array — fail closed' }],
      oks: [],
      summary: 'HALT: malformed input to checkDiff (fail-closed).',
    };
  }

  for (const raw of changedPaths) {
    const change = normalizeChange(raw);

    if (change.unparseable) {
      halts.push({ power: null, path: change.path, reason: 'unparseable change entry — fail closed' });
      continue;
    }

    // Removal / narrowing is always safe (cardinality may DECREASE autonomously).
    if (change.op === 'remove') {
      oks.push({ path: change.path, reason: 'removal/narrowing — cardinality decrease' });
      continue;
    }

    const cls = classify(change);

    if (cls.ambiguous) {
      halts.push({ power: cls.power, path: change.path, reason: `AMBIGUOUS: ${cls.reason} — fail closed` });
      continue;
    }

    if (!cls.touches) {
      oks.push({ path: change.path, reason: `unrelated content path (${cls.reason})` });
      continue;
    }

    // Touches a power. New writer or existing?
    if (registered.has(change.path)) {
      oks.push({ path: change.path, reason: `existing ${cls.power} writer already in registry` });
    } else {
      halts.push({
        power: cls.power,
        path: change.path,
        reason: `NEW writer added to power '${cls.power}' — capability acquisition (registry cardinality would INCREASE)`,
      });
    }
  }

  const verdict = halts.length > 0 ? 'HALT' : 'OK';
  const summary =
    verdict === 'HALT'
      ? `HALT: ${halts.length} four-power tripwire violation(s). ${halts
          .map((h) => `[${h.power || 'ambiguous'}] ${h.path}`)
          .join('; ')}`
      : `OK: ${oks.length} change(s) reviewed, no capability-acquisition detected.`;

  return { verdict, halts, oks, summary };
}

module.exports = {
  POWERS,
  LEDGER_PATH,
  load,
  list,
  classify,
  checkDiff,
};

// CLI: `node four-power-ledger.js [power]` prints the ledger (or one power's entries).
if (require.main === module) {
  const power = process.argv[2];
  const entries = power ? list(power) : load().entries;
  process.stdout.write(
    `four-power-ledger — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` +
      (power ? ` for power '${power}'` : ' across all powers') +
      '\n',
  );
  for (const e of entries) {
    process.stdout.write(`  [${e.power}] ${e.kind}\n      ${e.path}\n`);
  }
}
