'use strict';

/**
 * canonical-root.cjs — the ONE canonical repo-root source for Node hooks/scripts.
 *
 * env-path-hardening s1 decision: every Node writer that computes a repo root
 * and then mkdir/writes under it MUST resolve through this module instead of
 * process.cwd(), process.env.CLAUDE_PROJECT_DIR||cwd, or per-file
 * __dirname re-derivation. Resolution here is location-relative (this file
 * lives at <root>/tools/lib/), never the process cwd, never a hardcoded
 * absolute path — that is exactly the class of bug this module exists to kill.
 *
 * Validity = the resolved root must contain ALL stable repo anchors. A root
 * that fails anchor validation is a stale/foreign root; mkdir under it is the
 * silent-resurrection failure mode (mkdir -p never ENOENTs).
 *
 * Modes:
 *   'hard'            -> throw (code ECANONROOT). Caller MUST NOT mkdir/write.
 *   'circuit-breaker' -> log loud to stderr, return best-effort root so the
 *                        caller proceeds. Used during the staged rollout until
 *                        s5 verification clean-passes on all retrofitted writers,
 *                        then callers are promoted to 'hard'.
 */

const fs = require('fs');
const path = require('path');

const RESOLVED_ROOT = path.resolve(__dirname, '..', '..');
const ENV_OVERRIDE = 'SM_OS_ROOT';
const ANCHORS = ['instructions/canonical', '.git', 'package.json'];

function isValidRoot(root) {
  try {
    return ANCHORS.every((a) => fs.existsSync(path.join(root, a)));
  } catch {
    return false;
  }
}

function resolveCanonicalRoot(opts) {
  const mode = (opts && opts.mode) || 'hard';
  const envRoot = process.env[ENV_OVERRIDE];
  const candidate = path.resolve(envRoot || RESOLVED_ROOT);
  if (isValidRoot(candidate)) return candidate;

  const base =
    `[canonical-root] resolved repo root FAILED anchor validation: ${candidate} ` +
    `(required anchors: ${ANCHORS.join(', ')}; source: ${envRoot ? ENV_OVERRIDE + ' env' : '__dirname-relative'})`;

  if (mode === 'circuit-breaker') {
    process.stderr.write(
      base + ' [circuit-breaker: proceeding with best-effort root, NOT yet hard-refusing]\n'
    );
    return candidate;
  }
  const err = new Error(base + ' [hard mode: refusing — do NOT mkdir/write under this root]');
  err.code = 'ECANONROOT';
  throw err;
}

module.exports = { resolveCanonicalRoot, isValidRoot, RESOLVED_ROOT, ENV_OVERRIDE, ANCHORS };
