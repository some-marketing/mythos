'use strict';

/**
 * guard-now-write.cjs — PreToolUse hook (matcher: Write|Edit).
 *
 * FALSIFIER CONTRACT:
 *   _dev/state/session-present.json is the NOW falsifier. It is TOOL-PATH
 *   IMMUTABLE, not filesystem immutable. This guard blocks Claude's
 *   harness-visible Write/Edit tool surface from mutating the NOW.
 *   Non-harness-path writes (Bash shell, subshell) are still physically
 *   possible but DETECTED by the doctrine-reflex via missing
 *   writer-attestation (verdict=stall).
 *
 * Behavior:
 *   Reads CLAUDE_TOOL_INPUT env var (JSON: { file_path: "..." }). If the
 *   resolved absolute path is _dev/state/session-present.json, prints a
 *   refusal and exits 2 (non-zero). Claude Code treats non-zero exit as
 *   a hook rejection for PreToolUse.
 *
 * Protected paths (exact-match):
 *   _dev/state/session-present.json
 *   _dev/state/session-drift-log.json
 *   _dev/state/intellect-quarantine.json
 */

const path = require('path');
const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');

// S0 canonical-root retrofit: repo root resolves LOCATION-RELATIVE via the one
// canonical resolver (mode:'hard') instead of process.cwd(). Resolved lazily +
// memoized so that require()-ing this module from the advisory pretool-arc-guard
// hook can NEVER throw at load time on a broken root; and when run standalone as
// a hook, resolution happens inside main()'s try/catch (fail-open on error).
let _projectRoot = null;
function getProjectRoot() {
  if (_projectRoot === null) {
    _projectRoot = resolveCanonicalRoot({ mode: 'hard' });
  }
  return _projectRoot;
}
const PROTECTED_RELATIVE = [
  '_dev/state/session-present.json',
  '_dev/state/session-drift-log.json',
  '_dev/state/intellect-quarantine.json'
];
function getProtectedAbsolute() {
  const root = getProjectRoot();
  return PROTECTED_RELATIVE.map((p) => path.resolve(root, p));
}

function resolveTarget(input) {
  if (!input || typeof input !== 'object') return null;
  const candidates = [
    input.file_path,
    input.filePath,
    input.path,
    input.target_file,
    (input.tool_input && input.tool_input.file_path)
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) {
      return path.isAbsolute(c) ? c : path.resolve(getProjectRoot(), c);
    }
  }
  return null;
}

function isProtected(absPath) {
  if (!absPath) return false;
  return getProtectedAbsolute().includes(absPath);
}

function main() {
  const raw = process.env.CLAUDE_TOOL_INPUT || '{}';
  let input;
  try {
    input = JSON.parse(raw);
  } catch (_) {
    input = {};
  }
  const target = resolveTarget(input);
  if (!isProtected(target)) {
    return 0;
  }
  const rel = path.relative(getProjectRoot(), target);
  const msg = [
    'GUARDRAIL: NOW falsifier is tool-path immutable.',
    `Refused Write/Edit to ${rel}.`,
    'The NOW is harness-write-only. This state file is appended by hooks',
    '(inject-grounding-card.cjs, PostToolUse/Stop/bridge-return/worker-return',
    'reflex firings) under a harness-signed writer-attestation envelope.',
    'Tool-path writes are refused; non-tool-path writes are detected via',
    'missing writer-attestation by doctrine-reflex.cjs (verdict=stall).',
    '(control-loop-lobe plan — s04 FALSIFIER CONTRACT)'
  ].join('\n');
  process.stderr.write(msg + '\n');
  return 2;
}

if (require.main === module) {
  try {
    const code = main();
    process.exit(code);
  } catch (err) {
    process.stderr.write(`[guard-now-write] ${err.message}\n`);
    process.exit(0); // fail-open on internal error, never on intentional refusal
  }
}

module.exports = {
  resolveTarget,
  isProtected,
  getProjectRoot,
  PROTECTED_RELATIVE,
  getProtectedAbsolute
};
