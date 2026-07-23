/**
 * concept-frontmatter.cjs — Validator library for concept-doc frontmatter fields.
 *
 * Concept docs under _dev/concepts/ should declare an "Epistemic mode:" field
 * (per _dev/concepts/epistemic-authority-triad.md) and a "Triadic form:"
 * field (per _dev/concepts/triadic-forms.md).
 *
 * This validator runs in two regimes:
 *   - REQUIRED (fail): when both fields are PRESENT but malformed.
 *   - WARN (no fail): when fields are absent. Most existing concept docs
 *     pre-date the doctrine; absence is grandfathered. Authoring-time enforcement
 *     happens at /concept-init template + future verify-promotion-to-required.
 *
 * Exports:
 *   isConceptDocPath(filePath)           -> boolean
 *   validateConceptFrontmatter(filePath, options) -> { ok, violations, warnings }
 *     options.content (string, optional): use this content instead of disk read.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

const INCLUDE_DIR = '_dev/concepts/';
const EXCLUDE_NAMES = new Set([
  '_README.md',
  'README.md'
]);
const EXCLUDE_DIR_PARTS = new Set([
  '_templates',
  '_commands',
  'archive',
  'context',
  'dispatch',
  'responses',
  'synthesis'
]);

/**
 * Decide whether a path is a concept doc under _dev/concepts/.
 * Bundle members live at _dev/concepts/<slug>/concept.md; flat concepts at
 * _dev/concepts/<slug>.md. Skip templates, commands, README, and bundle
 * subdirectories that are not concept.md.
 */
function isConceptDocPath(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
  const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
  if (!rel.startsWith(INCLUDE_DIR)) return false;
  if (!rel.endsWith('.md')) return false;
  const base = path.basename(rel);
  if (EXCLUDE_NAMES.has(base)) return false;
  const parts = rel.split('/');
  // _dev/concepts/<x>.md (flat) — parts.length === 3, basename != README
  if (parts.length === 3) return true;
  // _dev/concepts/<slug>/concept.md (bundle root) — parts.length === 4
  if (parts.length === 4 && base === 'concept.md') return true;
  // anything else (subdirs like context/, dispatch/, etc.) — skip
  for (const p of parts.slice(2, -1)) {
    if (EXCLUDE_DIR_PARTS.has(p)) return false;
  }
  return false;
}

const MODE_PATTERN = /^\*\*Epistemic mode:\*\*\s+Mode\s+([123])\b/m;
const TRIADIC_PATTERN = /^\*\*Triadic form:\*\*\s+(yes|no)\b/im;

function validateConceptFrontmatter(filePath, options = {}) {
  let content = options.content;
  if (content === undefined) {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return {
        ok: false,
        violations: [`unable to read: ${err.message}`],
        warnings: []
      };
    }
  }
  // Look only in the first 80 lines (frontmatter region).
  const head = content.split('\n').slice(0, 80).join('\n');

  const violations = [];
  const warnings = [];

  const modeMatch = head.match(MODE_PATTERN);
  const triadicMatch = head.match(TRIADIC_PATTERN);

  // Soft (grandfather) — absence is a warning, not a failure.
  if (!modeMatch) {
    warnings.push('missing "Epistemic mode:" field (legacy concept; add when next touched)');
  }
  if (!triadicMatch) {
    warnings.push('missing "Triadic form:" field (legacy concept; add when next touched)');
  }

  // Hard — present-but-malformed is a failure.
  // (regex above already constrains valid forms; if there's a "Epistemic mode:" line
  // that doesn't match MODE_PATTERN, flag it)
  const modeLine = head.match(/^\*\*Epistemic mode:.*$/m);
  if (modeLine && !modeMatch) {
    violations.push(`malformed "Epistemic mode:" — expected "Mode 1|2|3", got: ${modeLine[0].slice(0, 120)}`);
  }
  const triadicLine = head.match(/^\*\*Triadic form:.*$/im);
  if (triadicLine && !triadicMatch) {
    violations.push(`malformed "Triadic form:" — expected "yes" or "no", got: ${triadicLine[0].slice(0, 120)}`);
  }

  return {
    ok: violations.length === 0,
    violations,
    warnings
  };
}

module.exports = {
  isConceptDocPath,
  validateConceptFrontmatter,
  REPO_ROOT
};
