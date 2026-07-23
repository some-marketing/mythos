'use strict';

const path = require('path');

const { readCurrentArc } = require('./arc-state-writer.cjs');
const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');

// S0 canonical-root retrofit: repo root resolves LOCATION-RELATIVE via the one
// canonical resolver (mode:'hard') instead of __dirname re-derivation. Resolved
// lazily + memoized so that require()-ing this module from the advisory
// pretool-arc-guard hook can NEVER throw at load time on a broken root.
let _projectRoot = null;
function getProjectRoot() {
  if (_projectRoot === null) {
    _projectRoot = resolveCanonicalRoot({ mode: 'hard' });
  }
  return _projectRoot;
}

function normalizeRepoPath(value) {
  if (!value) return '';
  const normalized = String(value).replace(/\\/g, '/');
  if (path.isAbsolute(normalized)) {
    const rel = path.relative(getProjectRoot(), normalized).replace(/\\/g, '/');
    return rel.startsWith('..') ? normalized : rel;
  }
  return normalized.replace(/^\.\//, '');
}

function globToRegExp(pattern) {
  const normalized = normalizeRepoPath(pattern);
  const parts = normalized.split('/');
  const regexParts = parts.map(part => {
    if (part === '**') return '.*';
    return part
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*');
  });
  
  let regex = regexParts.join('/');
  // Handle leading/trailing slashes and double-globstars
  regex = regex.replace(/\/+\.\*/g, '(/.*)?');
  regex = regex.replace(/\.\*\/+/g, '(.*?/)?');
  
  return new RegExp(`^${regex}$`);
}

function pathMatchesPattern(candidatePath, pattern) {
  if (!pattern) return false;
  const normalizedPattern = normalizeRepoPath(pattern);
  const candidate = normalizeRepoPath(candidatePath);
  return globToRegExp(normalizedPattern).test(candidate);
}

function pathMatchesAny(candidatePath, patterns) {
  return (patterns || []).some((pattern) => pathMatchesPattern(candidatePath, pattern));
}

function isPatternCoveredByParent(childPattern, parentPattern) {
  const child = normalizeRepoPath(childPattern);
  const parent = normalizeRepoPath(parentPattern);
  if (!child || !parent) return false;
  if (child === parent) return true;
  if (parent.endsWith('/**')) {
    const prefix = parent.slice(0, -3);
    return child === prefix || child.startsWith(prefix + '/');
  }
  const wildcardIndex = parent.indexOf('*');
  if (wildcardIndex >= 0) {
    const prefix = parent.slice(0, wildcardIndex);
    return child.startsWith(prefix);
  }
  return child === parent || child.startsWith(parent + '/');
}

function isWriteSetSubset(childPatterns, parentPatterns) {
  const children = childPatterns || [];
  const parents = parentPatterns || [];
  return children.every((child) =>
    parents.some((parent) => isPatternCoveredByParent(child, parent))
  );
}

function isForbiddenSuperset(childPatterns, parentPatterns) {
  const children = childPatterns || [];
  const parents = parentPatterns || [];
  return parents.every((parent) =>
    children.some((child) => isPatternCoveredByParent(parent, child))
  );
}

function checkWriteTargetAgainstArc(currentArc, intendedPath) {
  if (!currentArc) {
    return {
      allowed: false,
      reason: 'no_current_arc',
      current_arc: null
    };
  }

  const normalizedPath = normalizeRepoPath(intendedPath);
  if (
    pathMatchesAny(normalizedPath, currentArc.forbidden_artifacts || [])
  ) {
    return {
      allowed: false,
      reason: 'forbidden_artifact',
      current_arc: currentArc,
      violation: {
        class: 'forbidden_artifact',
        declared_write_set: currentArc.declared_write_set || [],
        forbidden_artifacts: currentArc.forbidden_artifacts || [],
        intended_path: normalizedPath
      }
    };
  }

  if (
    pathMatchesAny(normalizedPath, currentArc.declared_write_set || [])
  ) {
    return {
      allowed: true,
      reason: 'within_declared_write_set',
      current_arc: currentArc
    };
  }

  return {
    allowed: false,
    reason: 'outside_declared_write_set',
    current_arc: currentArc,
    violation: {
      class: 'outside_declared_write_set',
      declared_write_set: currentArc.declared_write_set || [],
      forbidden_artifacts: currentArc.forbidden_artifacts || [],
      intended_path: normalizedPath
    }
  };
}

function checkWriteTarget(actorId, intendedPath, opts) {
  const currentArc = opts && opts.currentArc ? opts.currentArc : readCurrentArc(actorId);
  return checkWriteTargetAgainstArc(currentArc, intendedPath);
}

// --- S2: cross-session conflict check ---------------------------------------
//
// The pre-existing arc check above answers "may THIS actor write here, given
// its OWN declared write-set?" S2 adds the orthogonal question: "does this
// write collide with a DIFFERENT live actor's reserved write-set?" — the
// cross-session race this workstream exists to kill. It reads the S1
// write-set-registry (the UNION of OTHER live actors' reservations, already
// TTL-pruned) and returns a TYPED conflict naming the conflicting actor(s) and
// the overlapping path. ADVISORY ONLY: nothing is blocked here. S3 is where
// `conflict: true` becomes a refused write, gated on S2.5 probation evidence
// and operator ratification.
//
// The registry is required LAZILY (call-time, not module-load) on purpose:
// write-set-registry.cjs require()s THIS module at its own load, so a top-level
// require here would be a circular dependency whose export object is only
// half-populated depending on load order. By call time both modules are fully
// initialized, so the lazy require is always complete.

const CROSS_SESSION_CONFLICT = 'cross_session_write_conflict';

/**
 * checkCrossSessionConflict(intendedPath, actor, opts) — S2. ADVISORY ONLY.
 *
 * actor: { sessionId, pid } identifying the CURRENT writer. Its own
 *   reservation is excluded from the overlap set (you never conflict with
 *   yourself); falls back to the ambient session/pid when omitted.
 * opts: { now, nowMs, force, logger } forwarded to the registry read.
 *   logger defaults to a typed stderr INFO line; pass { logger: null } to
 *   suppress logging (the structured result is still returned).
 *
 * Returns:
 *   {
 *     class: 'cross_session_write_conflict',
 *     conflict: boolean,                 // overlaps >=1 DIFFERENT live actor
 *     intended_path: <normalized repo-relative path>,
 *     actor: { session_id, pid },
 *     conflicting_actors: [{ session_id, pid, actor_id, matched_glob }],
 *     registry_coverage_gap: boolean     // current writer holds NO reservation
 *                                        // itself yet overlaps another's
 *   }
 */
function checkCrossSessionConflict(intendedPath, actor, opts) {
  const options = opts || {};
  const registry = require('./write-set-registry.cjs'); // lazy — see note above
  const advisory = registry.check(intendedPath, actor || {}, {
    now: options.now,
    nowMs: options.nowMs,
    force: options.force,
    logger: null // S2 owns its own typed logging below; suppress S1's INFO line
  });

  const result = {
    class: CROSS_SESSION_CONFLICT,
    conflict: advisory.conflict,
    intended_path: advisory.path,
    actor: {
      session_id: advisory.actor_session_id,
      pid: advisory.actor_pid
    },
    conflicting_actors: advisory.overlaps.map((o) => ({
      session_id: o.session_id,
      pid: o.pid,
      actor_id: o.actor_id,
      matched_glob: o.matched_glob
    })),
    registry_coverage_gap: advisory.un_arc_overlap
  };

  if (result.conflict) {
    const logger = options.logger === undefined ? defaultConflictLogger : options.logger;
    if (logger) {
      logger(formatCrossSessionConflict(result));
    }
  }

  return result;
}

function formatCrossSessionConflict(result) {
  const others = result.conflicting_actors
    .map((o) => `${o.actor_id || o.session_id}#${o.pid}(${o.matched_glob})`)
    .join(', ');
  const gap = result.registry_coverage_gap
    ? ' [registry-coverage-gap: writer holds no reservation]'
    : '';
  return (
    `INFO [scope-isolation S2] cross-session write conflict (advisory): ` +
    `write to "${result.intended_path}" by session=${result.actor.session_id || 'unknown'} ` +
    `pid=${result.actor.pid} conflicts with live reservation(s) of ${others}${gap} ` +
    `(no enforcement; logged only)`
  );
}

function defaultConflictLogger(line) {
  process.stderr.write(line + '\n');
}

/**
 * checkWriteTargetAndConflicts(actorId, intendedPath, opts) — S2 advisory
 * superset combining BOTH dimensions in one call for callers/telemetry: the
 * pre-existing intra-session arc check AND the new cross-session conflict
 * check. `allowed`/`reason` reflect ONLY the arc check (unchanged S0 behavior);
 * the new `cross_session` field carries the typed conflict. ADVISORY: this
 * never blocks — S3 is where `cross_session.conflict` becomes a refusal.
 *
 * opts: { currentArc, actor:{sessionId,pid} | sessionId,pid, now, nowMs, force,
 *   logger } — arc opts and registry opts share one bag.
 */
function checkWriteTargetAndConflicts(actorId, intendedPath, opts) {
  const options = opts || {};
  const arcResult = checkWriteTarget(actorId, intendedPath, options);
  const actor =
    options.actor || { sessionId: options.sessionId, pid: options.pid };
  const crossSession = checkCrossSessionConflict(intendedPath, actor, options);
  return { ...arcResult, cross_session: crossSession };
}

module.exports = {
  getProjectRoot,
  normalizeRepoPath,
  globToRegExp,
  pathMatchesPattern,
  pathMatchesAny,
  isPatternCoveredByParent,
  isWriteSetSubset,
  isForbiddenSuperset,
  checkWriteTargetAgainstArc,
  checkWriteTarget,
  // S2 cross-session conflict surface (advisory)
  CROSS_SESSION_CONFLICT,
  checkCrossSessionConflict,
  checkWriteTargetAndConflicts,
  formatCrossSessionConflict
};
