'use strict';

/**
 * durable-artifact.cjs — the ONE source of truth for scratch-vs-durable path
 * classification.
 *
 * Why this exists: scripts that write to `_dev/state/**` or `_dev/reports/**`
 * expect those writes to survive across sessions; scripts that write to a
 * scratchpad or the OS tmpdir expect the opposite. Nothing enforced that
 * distinction consistently, so writers guessed per-callsite. This module
 * gives every writer one string-based classifier to call instead of
 * re-deriving the rule.
 *
 * Capability tier (harness-runtime-contract terms): L1 pure-lib —
 * classification only; ADVISORY: nothing enforces this module is called.
 * A caller can still write to a scratch path without ever consulting
 * isScratch/isDurable. This module answers "what class is this path", not
 * "was the right class used here".
 *
 * Classification is purely string-based (path.resolve + prefix/segment
 * checks) — no fs calls — so it works on paths that do not exist yet.
 *
 * Neither-class paths: a path that is neither under a scratch root nor under
 * a durable root (e.g. "/Users/admin/Desktop/foo.txt") returns false from
 * BOTH isScratch and isDurable. The two predicates are not complements of
 * each other.
 *
 * Module use:
 *   const { isScratch, isDurable, durablePath } = require('<root>/tools/lib/durable-artifact.cjs');
 *   isScratch('/tmp/foo.json');                 // true
 *   isDurable('_dev/state/run-001.json');       // true (repo-relative)
 *   durablePath('state', 'run-001.json');       // '_dev/state/run-001.json'
 */

const os = require('os');
const path = require('path');

const DURABLE_KIND_DIRS = {
  state: '_dev/state',
  report: '_dev/reports',
  reports: '_dev/reports',
};

/**
 * macOS resolves /tmp and /var as symlinks into /private/tmp and
 * /private/var, but plenty of code (including os.tmpdir() on some setups)
 * still hands back the unresolved /var/... spelling. Normalize the leading
 * /var segment to /private/var so both spellings compare equal, without
 * touching any other path.
 */
function normalizeVarPrefix(abs) {
  if (abs === '/var' || abs.startsWith('/var/')) {
    return '/private' + abs;
  }
  return abs;
}

/** True if `abs` is exactly `prefix` or nested under it. */
function isUnderPrefix(abs, prefix) {
  return abs === prefix || abs.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
}

/** Resolve a possibly-relative path to absolute, against `root` when relative. */
function resolveAbs(p, root) {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
}

/**
 * True when `p` is a scratch/throwaway location: under /private/tmp,
 * under /tmp, contains a /scratchpad/ path segment, or under the OS tmpdir
 * (os.tmpdir()). `root` (default process.cwd()) resolves relative input.
 */
function isScratch(p, root = process.cwd()) {
  const abs = resolveAbs(p, root);
  const absNorm = normalizeVarPrefix(abs);

  if (isUnderPrefix(absNorm, '/private/tmp')) return true;
  if (isUnderPrefix(abs, '/tmp')) return true;

  const segments = abs.split(path.sep);
  if (segments.includes('scratchpad')) return true;

  const tmpdirNorm = normalizeVarPrefix(path.resolve(os.tmpdir()));
  if (isUnderPrefix(absNorm, tmpdirNorm)) return true;

  return false;
}

/**
 * True when `p` is under a durable root: _dev/state/ or _dev/reports/,
 * relative to `root` (default process.cwd(), intended to be the repo root).
 * Always false for scratch paths and for paths outside `root` entirely.
 */
function isDurable(p, root = process.cwd()) {
  const repoRoot = path.resolve(root);
  const abs = resolveAbs(p, root);
  const rel = path.relative(repoRoot, abs);

  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;

  const relPosix = rel.split(path.sep).join('/');
  return (
    relPosix === '_dev/state' ||
    relPosix.startsWith('_dev/state/') ||
    relPosix === '_dev/reports' ||
    relPosix.startsWith('_dev/reports/')
  );
}

/**
 * Build a repo-relative durable path for `name` under the given durable
 * `kind` ('state', 'report', or 'reports'). Throws on an unknown kind or a
 * `name` containing '..'.
 */
function durablePath(kind, name) {
  const dir = DURABLE_KIND_DIRS[kind];
  if (!dir) {
    throw new Error(`[durable-artifact] unknown kind "${kind}"; expected one of: ${Object.keys(DURABLE_KIND_DIRS).join(', ')}`);
  }
  if (typeof name !== 'string' || name.split(/[\\/]/).includes('..')) {
    throw new Error(`[durable-artifact] name must not contain ".." segments: ${JSON.stringify(name)}`);
  }
  return path.posix.join(dir, name);
}

module.exports = { isScratch, isDurable, durablePath };
