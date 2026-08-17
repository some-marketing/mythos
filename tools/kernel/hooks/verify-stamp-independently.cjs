'use strict';

// tools/kernel/hooks/verify-stamp-independently.cjs -- SECOND, independently-
// authored verifier for pretooluse-live (plan pretooluse-live-second-verifier,
// S2, REDESIGNED after kernel-triad rejection of an audit-log-only first
// design -- see _dev/reports/analysis/pretooluse-live-second-verifier__guard-spec.md
// for the full rejection record and redesign rationale).
//
// Independence contract: this module NEVER requires pretool-remote-mutation-
// gate.cjs and NEVER calls stampInvalidReason(), loadStamps(), scopeCovers(),
// or classifyCommand() from it. It reads the SAME stamp sidecar files
// (ground truth, not a lossy log) and reaches its own verdict via freshly
// authored validity and scope-match predicates. Per kernel-triad review
// (2026-08-17): this is "independent implementation over shared ground
// truth," not "independent semantic authority" -- both implementations still
// share the RemoteMutationStamp/1.0 schema's semantics (expiry boundary,
// source_doc requirements, `re:` scope-entry convention). Disagreement
// between the two implementations over that ONE shared schema is exactly the
// property this module exists to catch; a shared misreading of the schema
// itself is a disclosed, not-fully-closable common-mode risk (named in the
// guard-spec, not hidden here).

const fs = require('fs');
const path = require('path');

const STAMPS_DIR_REL = path.join('_dev', 'state', 'remote-mutation-stamps');
const STAMP_SCHEMA = 'RemoteMutationStamp/1.0';

// Independently declared, not derived from classifyCommand() -- per kernel-
// triad review (round 2, codex): independentScopeCovers must be able to
// grant an EXACT-KEY scope entry (e.g. "ssh:mutate"), not only a `re:`
// pattern match against raw text, or it silently verifies a narrower
// property than the primary gate's scopeCovers() does. The caller (the
// live-probe wiring) passes the canary's raw command text; this constant is
// this module's own, separately maintained belief about what key that
// command should classify as -- if the two ever drift, that drift is itself
// exactly the kind of finding this second verifier should be able to surface
// (as a MODULE-DRIFT observation, not silently reconciled).
const CANARY_MUTATING_KEY = 'ssh:mutate';

function stampsDir(repoRoot) {
  return path.resolve(repoRoot, STAMPS_DIR_REL);
}

/**
 * Snapshot the stamps directory as { filename: mtimeMs }. Used to detect
 * whether the directory changed between the primary leg's read and this
 * module's read (kernel-triad review round 2, codex: a stamp created,
 * voided, or expiring between the two reads is a race, not a genuine
 * predicate disagreement, and must be reported as such).
 */
function fingerprintStampsDir(repoRoot, statSync) {
  const stat = statSync || fs.statSync;
  const dir = stampsDir(repoRoot);
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (_) {
    return null; // directory missing is itself a stable, comparable state
  }
  const snapshot = {};
  for (const name of names.sort()) {
    try {
      snapshot[name] = stat(path.join(dir, name)).mtimeMs;
    } catch (_) {
      snapshot[name] = null; // file vanished mid-scan; comparable as null
    }
  }
  return snapshot;
}

function fingerprintsEqual(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] === a[k]);
}

/**
 * Freshly authored validity predicate. Interprets the same real-world facts
 * pretool-remote-mutation-gate.cjs's stampInvalidReason() does (both must
 * agree on what the stamp schema MEANS, or they'd be answering different
 * questions) but via independently authored logic: a positive-conditions
 * list reduced to the first failing condition, rather than the primary's
 * sequential early-return chain.
 *
 * Returns a reason string if invalid, or null if valid.
 */
function independentStampInvalidReason(stamp, nowMs, existsSyncFn) {
  const existsSync = existsSyncFn || fs.existsSync;
  const checks = [
    [() => stamp && typeof stamp === 'object', 'not an object'],
    [() => stamp.schema === STAMP_SCHEMA, `schema is not ${STAMP_SCHEMA}`],
    [() => typeof stamp.stamp_id === 'string' && stamp.stamp_id.length > 0, 'missing stamp_id'],
    [() => typeof stamp.granted_at === 'string' && !Number.isNaN(Date.parse(stamp.granted_at)), 'missing/unparseable granted_at'],
    [() => typeof stamp.operator_authorization === 'string' && stamp.operator_authorization.trim().length > 0, 'missing explicit operator authorization line'],
    [() => Array.isArray(stamp.scope) && stamp.scope.length > 0, 'empty scope'],
    [() => Array.isArray(stamp.conditions) && stamp.conditions.length > 0, 'no conditions named'],
    [() => stamp.voided !== true, 'voided'],
    [() => !stamp.superseded_by, `superseded by ${stamp.superseded_by}`],
    [() => typeof stamp.source_doc === 'string' && stamp.source_doc.length > 0, 'missing source_doc']
  ];
  for (const [predicate, reason] of checks) {
    let result;
    try {
      result = predicate();
    } catch (_) {
      return reason; // a predicate that throws is treated as failing -- fail-closed
    }
    if (!result) return reason;
  }

  // Expiry: independently parsed and compared, same boundary semantics
  // (exp <= nowMs is expired) as the primary, since both must agree on what
  // "expired" means for the SAME timestamp field -- disagreement here would
  // be a real, useful finding, not a design flaw to route around.
  if (stamp.expires_at) {
    const exp = Date.parse(stamp.expires_at);
    if (Number.isNaN(exp)) return 'unparseable expires_at';
    if (exp <= nowMs) return `expired at ${stamp.expires_at}`;
  }

  // source_doc existence, resolved relative to repoRoot the same way the
  // primary does (absolute paths pass through, relative paths join to
  // repoRoot) -- independently implemented existence check, not a shared
  // helper function.
  const docPath = path.isAbsolute(stamp.source_doc)
    ? stamp.source_doc
    : path.join(stamp.__repoRoot || '', stamp.source_doc);
  try {
    if (!existsSync(docPath)) return `source_doc missing on disk: ${stamp.source_doc}`;
  } catch (_) {
    return 'source_doc unreadable';
  }

  return null;
}

/**
 * Freshly authored scope-match predicate. Grants on either an exact-key
 * match (case-insensitive) or a `re:`-prefixed regex tested against the raw
 * command text -- same two grant shapes the primary's scopeCovers()
 * recognizes, independently implemented.
 */
function independentScopeCovers(stamp, key, rawCommand) {
  if (!stamp || !Array.isArray(stamp.scope)) return false;
  for (const entry of stamp.scope) {
    const trimmed = String(entry || '').trim();
    if (!trimmed) continue;
    if (trimmed.slice(0, 3) === 're:') {
      const pattern = trimmed.slice(3);
      let matches = false;
      try {
        matches = new RegExp(pattern, 'i').test(String(rawCommand || ''));
      } catch (_) {
        matches = false; // an unparseable pattern grants nothing, fail-closed
      }
      if (matches) return true;
      continue;
    }
    if (trimmed.toLowerCase() === String(key || '').toLowerCase()) return true;
  }
  return false;
}

/**
 * Read every stamp sidecar independently and determine whether ANY
 * independently-valid stamp independently covers the given raw command for
 * CANARY_MUTATING_KEY. This is the module's own from-scratch answer to
 * "is this command currently authorized?" -- reached without touching any
 * function from pretool-remote-mutation-gate.cjs.
 */
function independentCoverageVerdict(repoRoot, rawCommand, nowMs, opts) {
  const o = opts || {};
  const dir = stampsDir(repoRoot);
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (err) {
    return { ok: false, reason_code: 'STAMPS-DIR-UNREADABLE', detail: err.message, checked: [] };
  }
  const checked = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let stamp;
    try {
      stamp = JSON.parse(fs.readFileSync(file, 'utf8'));
      stamp.__repoRoot = repoRoot;
    } catch (err) {
      return { ok: false, reason_code: 'STAMP-UNPARSEABLE', detail: `${name}: ${err.message}`, checked };
    }
    const invalidReason = independentStampInvalidReason(stamp, nowMs, o.existsSync);
    if (invalidReason) {
      checked.push({ file: name, stamp_id: stamp.stamp_id, covers: false, invalid_reason: invalidReason });
      continue;
    }
    const covers = independentScopeCovers(stamp, CANARY_MUTATING_KEY, rawCommand);
    checked.push({ file: name, stamp_id: stamp.stamp_id, covers });
    if (covers) {
      return { ok: true, covered: true, coveringStamp: { file: name, stamp_id: stamp.stamp_id }, checked };
    }
  }
  return { ok: true, covered: false, checked };
}

/**
 * The public entry point, called by live-probe.cjs as the fourth leg.
 *
 * primaryVerdict: { covered: boolean } -- the primary path's own conclusion
 * for the SAME command (derived by the caller from its existing
 * verifyStampScopes()/evaluate() results). This module does not compute the
 * primary verdict itself -- it is handed in, so this module's own code path
 * never touches the primary's logic.
 *
 * opts.nowMs: shared clock, captured ONCE by the caller for both the primary
 * and independent reads (kernel-triad review round 2: comparing two
 * independently-fetched Date.now() values would itself be a race).
 * opts.beforeFingerprint / opts.statSync: race-detection support -- the
 * caller snapshots the stamps directory before the primary read; this
 * function re-snapshots after its own read and compares, per the race
 * policy below.
 */
function verifyStampIndependently(repoRoot, rawCommand, primaryVerdict, opts) {
  const o = opts || {};
  const nowMs = typeof o.nowMs === 'number' ? o.nowMs : Date.now();

  const beforeFingerprint = o.beforeFingerprint !== undefined
    ? o.beforeFingerprint
    : fingerprintStampsDir(repoRoot, o.statSync);

  const verdict = independentCoverageVerdict(repoRoot, rawCommand, nowMs, o);
  if (!verdict.ok) {
    return {
      ok: false,
      reason_code: verdict.reason_code,
      detail: verdict.detail,
      independent_covered: null,
      primary_covered: primaryVerdict ? Boolean(primaryVerdict.covered) : null,
      checked: verdict.checked
    };
  }

  const afterFingerprint = fingerprintStampsDir(repoRoot, o.statSync);
  if (!fingerprintsEqual(beforeFingerprint, afterFingerprint)) {
    // Kernel-triad review round 2 (codex): a stamp directory change between
    // the primary and independent reads is a race, not a predicate
    // disagreement -- report it distinctly, fail-closed (never PROCEED on a
    // race), and let the caller decide whether to retry once.
    return {
      ok: false,
      reason_code: 'STAMP-STATE-CHANGED-DURING-PROBE',
      detail: 'the stamps directory changed between the primary and independent reads -- not a genuine disagreement, re-run to get a consistent snapshot',
      independent_covered: verdict.covered,
      primary_covered: primaryVerdict ? Boolean(primaryVerdict.covered) : null,
      checked: verdict.checked
    };
  }

  if (!primaryVerdict) {
    // Independent leg ran without a primary verdict to compare against
    // (e.g. wiring succeeded but the direct leg itself failed before
    // producing a scope verdict) -- preserved as diagnostic evidence per
    // kernel-triad review round 2 (codex: "run whenever wiring succeeds...
    // preserve diagnostic evidence rather than being suppressed"), not
    // scored as agreement or disagreement.
    return {
      ok: true,
      reason_code: 'INDEPENDENT-ONLY-NO-PRIMARY-COMPARISON',
      detail: 'independent verdict recorded; no primary verdict was available to compare against this run',
      independent_covered: verdict.covered,
      primary_covered: null,
      checked: verdict.checked
    };
  }

  const primaryCovered = Boolean(primaryVerdict.covered);
  if (primaryCovered !== verdict.covered) {
    return {
      ok: false,
      reason_code: 'DISAGREEMENT',
      detail: `primary path says covered=${primaryCovered}, independent verifier says covered=${verdict.covered}`,
      independent_covered: verdict.covered,
      primary_covered: primaryCovered,
      checked: verdict.checked
    };
  }

  return {
    ok: true,
    reason_code: 'CONSISTENT',
    detail: `both the primary path and the independent verifier agree: covered=${verdict.covered}`,
    independent_covered: verdict.covered,
    primary_covered: primaryCovered,
    checked: verdict.checked
  };
}

module.exports = {
  STAMPS_DIR_REL,
  STAMP_SCHEMA,
  CANARY_MUTATING_KEY,
  stampsDir,
  fingerprintStampsDir,
  fingerprintsEqual,
  independentStampInvalidReason,
  independentScopeCovers,
  independentCoverageVerdict,
  verifyStampIndependently
};
