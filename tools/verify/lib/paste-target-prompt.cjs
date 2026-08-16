/**
 * paste-target-prompt.cjs — Validator library for paste-target prompt artifacts.
 *
 * A "paste-target prompt" is a markdown file whose body IS the prompt to be
 * pasted into another model's input. The file body must not be wrapped in an
 * outer fence, must not open with operator-facing extraction prose, must not
 * open with a rationale header, and must not be predominantly explanatory
 * prose wrapping a single fenced block.
 *
 * Exports:
 *   isPromptTargetPath(filePath)            -> boolean
 *   validatePasteTargetPrompt(filePath, options) -> { ok, violations }
 *     options.content (string, optional): use this content instead of reading
 *       filePath from disk; enables pre-write validation.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

const INCLUDE_GLOBS = [
  'tools/codex/prompt-system/*.md',
  '_dev/reports/analysis/*-bridge-prompt__*.md',
  '_dev/reports/bridge-prompts/*.md',
  '*handoff*.md',
  'clients/*/next-session-handoff*.md'
];

const EXCLUDE_GLOBS = [
  '*__rationale.md',
  '*/README.md',
  'README.md',
  '_dev/reports/analysis/convene-runs/**/*.md',
  'archive/**',
  '_dev/archive/**',
  '**/archive/**',
  'framework_candidates/**',
  'frameworks/**/.claude/**',
  'tools/codex/prompt-system/templates/**',
  'node_modules/**',
  '.git/**'
];

/**
 * Convert a glob pattern to a RegExp. Supports `*` (any chars except `/`) and
 * `**` (any chars including `/`).
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegex(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // ** matches any chars including /
        re += '.*';
        i += 2;
        // consume optional trailing slash
        if (glob[i] === '/') {
          re += '/?';
          i += 1;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if ('.+^$(){}|[]\\'.includes(ch)) {
      re += '\\' + ch;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

const INCLUDE_RES = INCLUDE_GLOBS.map(globToRegex);
const EXCLUDE_RES = EXCLUDE_GLOBS.map(globToRegex);

/**
 * Convert a possibly-absolute filePath to a repo-root-relative POSIX path.
 *
 * @param {string} filePath
 * @returns {string}
 */
function toRelative(filePath) {
  let p = String(filePath);
  if (path.isAbsolute(p)) {
    const rel = path.relative(REPO_ROOT, p);
    if (!rel.startsWith('..')) p = rel;
  }
  return p.split(path.sep).join('/').replace(/^\.\//, '');
}

/**
 * Test whether a path matches any of the patterns. Patterns containing '/'
 * are matched against the full relative path; patterns with no '/' are also
 * matched against the basename so e.g. `*handoff*.md` finds files in any dir.
 *
 * @param {string} relPath
 * @param {RegExp[]} regexes
 * @param {string[]} globs
 * @returns {boolean}
 */
function matchesAny(relPath, regexes, globs) {
  const base = relPath.split('/').pop();
  for (let i = 0; i < regexes.length; i += 1) {
    if (regexes[i].test(relPath)) return true;
    if (!globs[i].includes('/') && regexes[i].test(base)) return true;
  }
  return false;
}

/**
 * Decide whether filePath is a paste-target prompt artifact subject to the
 * content rules.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isPromptTargetPath(filePath) {
  const rel = toRelative(filePath);
  if (matchesAny(rel, EXCLUDE_RES, EXCLUDE_GLOBS)) return false;
  if (!matchesAny(rel, INCLUDE_RES, INCLUDE_GLOBS)) return false;
  return true;
}

// ─── Content rule helpers ────────────────────────────────────────────────

const FENCE_RE = /^```[a-zA-Z0-9_-]*\s*$/;

const EXTRACTION_PROSE_PATTERNS = [
  /^copy the (prompt|block|following|text)/i,
  /^paste (this|the following|below)/i,
  /^below is the (prompt|following)/i,
  /^use this prompt/i,
  /^here is the prompt/i,
  /^the (prompt|paste-target) (is|follows) below/i
];

const RATIONALE_PATTERNS = [
  /^#+ ?rationale\b/i,
  /^#+ ?why this prompt\b/i,
  /^rationale [—-]/i
];

function findFirstNonBlankLine(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') return { line: lines[i], index: i };
  }
  return null;
}

function findLastNonBlankLine(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== '') return { line: lines[i], index: i };
  }
  return null;
}

/**
 * RULE-1 no-outer-fence: the entire body is wrapped in one outer fence.
 */
function checkOuterFence(lines) {
  const first = findFirstNonBlankLine(lines);
  const last = findLastNonBlankLine(lines);
  if (!first || !last || first.index === last.index) return null;
  const firstTrim = first.line.trim();
  const lastTrim = last.line.trim();
  if (!FENCE_RE.test(firstTrim)) return null;
  if (lastTrim !== '```') return null;
  // Count fence lines total
  let fenceCount = 0;
  for (const l of lines) {
    if (FENCE_RE.test(l.trim())) fenceCount += 1;
  }
  if (fenceCount !== 2) return null;
  return {
    rule: 'RULE-1',
    name: 'no-outer-fence',
    message:
      'file is wrapped in a single outer triple-backtick fence; remove the outer fence — the file body IS the prompt',
    line: first.index + 1
  };
}

/**
 * RULE-2 no-extraction-prose-first-line.
 */
function checkExtractionProse(lines) {
  const first = findFirstNonBlankLine(lines);
  if (!first) return null;
  const trimmed = first.line.trim();
  for (const pat of EXTRACTION_PROSE_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        rule: 'RULE-2',
        name: 'no-extraction-prose-first-line',
        message: `first non-blank line is operator-facing extraction prose ('${trimmed}'); the file body IS the prompt — remove this header`,
        line: first.index + 1
      };
    }
  }
  return null;
}

/**
 * RULE-3 no-rationale-opener.
 */
function checkRationaleOpener(lines) {
  const first = findFirstNonBlankLine(lines);
  if (!first) return null;
  const trimmed = first.line.trim();
  for (const pat of RATIONALE_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        rule: 'RULE-3',
        name: 'no-rationale-opener',
        message: `file opens with rationale/explanation header ('${trimmed}'); rationale belongs in a sibling __rationale.md file, not the prompt itself`,
        line: first.index + 1
      };
    }
  }
  // Special case: /^#+ ?why\b/i if line also contains "this prompt" or "this file"
  if (/^#+ ?why\b/i.test(trimmed) && /(this prompt|this file)/i.test(trimmed)) {
    return {
      rule: 'RULE-3',
      name: 'no-rationale-opener',
      message: `file opens with rationale/explanation header ('${trimmed}'); rationale belongs in a sibling __rationale.md file, not the prompt itself`,
      line: first.index + 1
    };
  }
  return null;
}

/**
 * RULE-4 prose-then-single-fenced-block (heuristic, conservative).
 */
function checkProseThenFenced(lines) {
  // Identify fence opener/closer pairs
  const fenceLineIdx = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_RE.test(lines[i].trim())) fenceLineIdx.push(i);
  }
  if (fenceLineIdx.length !== 2) return null;
  const openerIdx = fenceLineIdx[0];
  const closerIdx = fenceLineIdx[1];

  const totalNonBlank = lines.filter((l) => l.trim() !== '').length;
  if (totalNonBlank === 0) return null;

  let proseBefore = 0;
  for (let i = 0; i < openerIdx; i += 1) {
    if (lines[i].trim() !== '') proseBefore += 1;
  }
  let inFence = 0;
  for (let i = openerIdx + 1; i < closerIdx; i += 1) {
    if (lines[i].trim() !== '') inFence += 1;
  }

  if (proseBefore <= 5) return null;
  if (proseBefore / totalNonBlank <= 0.3) return null;
  if (inFence / totalNonBlank <= 0.5) return null;

  return {
    rule: 'RULE-4',
    name: 'prose-then-single-fenced-block',
    message:
      'file appears to be explanatory prose wrapping a single fenced prompt — extract the fenced content as the file body',
    line: openerIdx + 1
  };
}

/**
 * Validate a paste-target prompt artifact.
 *
 * @param {string} filePath
 * @param {{ content?: string }} [options]
 * @returns {{ ok: boolean, violations: Array<{rule:string,name:string,message:string,line?:number}> }}
 */
function validatePasteTargetPrompt(filePath, options) {
  const opts = options || {};
  let content;
  if (typeof opts.content === 'string') {
    content = opts.content;
  } else {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return {
        ok: false,
        violations: [
          {
            rule: 'IO',
            name: 'read-failed',
            message: `failed to read ${filePath}: ${err.message}`
          }
        ]
      };
    }
  }
  const lines = content.split(/\r?\n/);
  const violations = [];
  const r1 = checkOuterFence(lines);
  if (r1) violations.push(r1);
  const r2 = checkExtractionProse(lines);
  if (r2) violations.push(r2);
  const r3 = checkRationaleOpener(lines);
  if (r3) violations.push(r3);
  const r4 = checkProseThenFenced(lines);
  if (r4) violations.push(r4);
  return { ok: violations.length === 0, violations };
}

module.exports = {
  isPromptTargetPath,
  validatePasteTargetPrompt,
  // exported for tests/diagnostics
  _internal: {
    INCLUDE_GLOBS,
    EXCLUDE_GLOBS,
    globToRegex,
    toRelative
  }
};
