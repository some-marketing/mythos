'use strict';

// Safe-persistence policy for .claude/settings.local.json.
// Authority: _dev/policies/permission-envelope.md § Safe-persistence blocklist.
//
// The function classifyPersistCandidate(pattern, envelope) returns:
//   { allowed: boolean, reason: string | null }
//
// It is deterministic, pure, and side-effect-free. No file I/O. Callers are
// responsible for actually writing to .claude/settings.local.json after this
// function has approved each pattern.

const BLOCKED_EXACT = new Set([
  'Bash(*)',
  'Write(*)',
  'Edit(*)',
  'NotebookEdit(*)'
]);

// Substring matches that ban persistence regardless of family.
const BLOCKED_SUBSTRINGS = [
  'sudo',
  'rm -rf',
  'rm -r ',
  'chmod -R',
  '--no-verify',
  '--no-gpg-sign',
  '-c commit.gpgsign=false',
  '--force',
  'git push --force',
  'git reset --hard',
  'dontAsk'
];

function classifyPersistCandidate(pattern, envelope) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { allowed: false, reason: 'pattern must be a non-empty string' };
  }
  if (BLOCKED_EXACT.has(pattern)) {
    return { allowed: false, reason: `blocked: bare wildcard for write/execute family (${pattern})` };
  }
  for (const needle of BLOCKED_SUBSTRINGS) {
    if (pattern.indexOf(needle) !== -1) {
      return { allowed: false, reason: `blocked: pattern contains forbidden token (${JSON.stringify(needle)})` };
    }
  }
  if (envelope && Array.isArray(envelope.operator_gated)) {
    if (envelope.operator_gated.indexOf(pattern) !== -1) {
      return { allowed: false, reason: 'blocked: envelope marks pattern operator_gated (never auto-persist)' };
    }
  }
  return { allowed: true, reason: null };
}

function filterPersistCandidates(patterns, envelope) {
  const allowed = [];
  const rejected = [];
  for (const pattern of patterns || []) {
    const verdict = classifyPersistCandidate(pattern, envelope);
    if (verdict.allowed) {
      allowed.push(pattern);
    } else {
      rejected.push({ pattern, reason: verdict.reason });
    }
  }
  return { allowed, rejected };
}

module.exports = {
  BLOCKED_EXACT: Array.from(BLOCKED_EXACT),
  BLOCKED_SUBSTRINGS: BLOCKED_SUBSTRINGS.slice(),
  classifyPersistCandidate,
  filterPersistCandidates
};
