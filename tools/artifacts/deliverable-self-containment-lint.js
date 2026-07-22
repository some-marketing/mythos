#!/usr/bin/env node
'use strict';

/**
 * deliverable-self-containment-lint.js — operator-facing artifact self-containment lint.
 *
 * The operator's #1 recurring pain: a deliverable that is not self-contained —
 * it uses an acronym never defined, points the reader at a repo file they can't
 * open, or says "see X / go find Y" instead of carrying the content inline. This
 * lint scans an operator-facing text artifact and WARNS (line-numbered, with a
 * suggested fix) on three families:
 *
 *   (a) UNDEFINED-JARGON   — an acronym / jargon token used without a
 *                            define-on-first-use expansion anywhere in the doc.
 *   (b) UNFINDABLE-REF      — a reference to a repo path, tools/..., _dev/...,
 *                            clients/..., or an absolute /Users/... path that an
 *                            operator reading the deliverable cannot open.
 *   (c) GO-FIND-REDIRECT    — "see <file>", "go find", "as referenced in X",
 *                            "refer to", "per the attached" — patterns that send
 *                            the reader elsewhere instead of stating it inline.
 *
 * DESIGN CONSTRAINT (the system's own council warned against over-enforcement):
 *   This lint NEVER hard-blocks and NEVER exits non-zero on findings. Findings
 *   are advisory WARN only. Exit 0 on a clean OR a flagged artifact; exit 2 only
 *   on a usage / IO error. The goal is to help the author make the deliverable
 *   self-contained, not to police a pipeline into paralysis.
 *
 * This is the self-containment companion to the stakeholder-voice-linter agent
 * (which lints for Mythos-internal *vocabulary leaks*) and reuses the same shared
 * leak-pattern source of truth for the repo-path family where they overlap.
 *
 * Stdlib-only (no npm install). Read-only — never modifies the scanned file.
 *
 * Usage:
 *   node tools/artifacts/deliverable-self-containment-lint.js <file>
 *   node tools/artifacts/deliverable-self-containment-lint.js --json <file>
 *   cat draft.md | node tools/artifacts/deliverable-self-containment-lint.js   # stdin
 *
 * Exit codes: 0 = scanned (clean or with findings), 2 = usage / IO error.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// (b) UNFINDABLE-REF — repo paths an operator cannot open.
// Reuses the canonical repo-path leak regex from the shared leak-patterns lib
// where available; falls back to an equivalent inline pattern if the lib is not
// importable (e.g. tool copied out of tree).
// ---------------------------------------------------------------------------
// Broad operator-can't-open path family: absolute /Users paths, and any
// top-level repo directory ref (tools/..., _dev/..., clients/CODE/...,
// frameworks/..., instructions/...). Wider than the designer-message
// leak-patterns `repo-abs-path` (which is scoped to tools/mcp/ only): an
// operator deliverable can't open ANY in-repo path, so we union the canonical
// leak regex with this broader set to stay aligned where they overlap.
function loadRepoPathRegex() {
  const broad = '\\/Users\\/[^\\s)]+|\\b(?:tools|_dev|clients|frameworks|instructions)\\/[A-Za-z0-9_-]+';
  let sources = [broad];
  try {
    const { getPatternById } = require(
      path.join(__dirname, '..', 'mcp', 'delesign', 'lib', 'leak-patterns.js')
    );
    const p = getPatternById('repo-abs-path');
    if (p && p.regex) sources.push(p.regex.source);
  } catch (_) {
    /* leak-patterns lib unavailable — broad pattern alone is sufficient */
  }
  return new RegExp(sources.join('|'), 'gi');
}

const REPO_PATH_RE = loadRepoPathRegex();

// ---------------------------------------------------------------------------
// (c) GO-FIND-REDIRECT — phrases that punt the reader elsewhere.
// ---------------------------------------------------------------------------
const REDIRECT_PATTERNS = [
  {
    id: 'see-file',
    re: /\b(see|refer to|go (?:find|look|to)|as (?:referenced|noted|described|outlined) in|per (?:the )?(?:attached|above|below)|check the)\b/gi,
    suggest: 'State the referenced content inline instead of pointing the reader elsewhere.',
  },
];

// ---------------------------------------------------------------------------
// (a) UNDEFINED-JARGON — acronyms / jargon used without define-on-first-use.
//
// Acronym detection: a 2-6 char ALL-CAPS token (optionally with digits) is a
// candidate. It is considered DEFINED if, anywhere in the doc, it appears in a
// define-on-first-use shape:
//     "Customer Relationship Management (CRM)"   ← gloss-before-acronym
//     "CRM (Customer Relationship Management)"   ← acronym-before-gloss
// COMMON_OK is a small allowlist of acronyms an operator reads without a gloss.
// ---------------------------------------------------------------------------
const ACRONYM_RE = /\b([A-Z][A-Z0-9]{1,5})\b/g;

const COMMON_OK = new Set([
  // Everyday business / units an operator reads without expansion.
  'CEO', 'CFO', 'COO', 'CTO', 'HR', 'PR', 'FAQ', 'ASAP', 'ETA', 'TBD', 'EOD',
  'USD', 'CAD', 'GST', 'HST', 'PST', 'EST', 'AM', 'PM', 'OK', 'ID', 'URL',
  'PDF', 'HTML', 'CSV', 'API', 'UI', 'UX', 'SEO', 'PPC', 'CPC', 'CPM', 'CTR',
  'ROI', 'ROAS', 'KPI', 'B2B', 'B2C', 'Q1', 'Q2', 'Q3', 'Q4', 'A', 'I',
  // Channel / platform names an operator already knows.
  'FB', 'IG', 'YT', 'TV', 'SMS', 'DM', 'GA', 'GA4', 'GTM',
]);

function readInput(argPath) {
  if (argPath) {
    const full = path.resolve(argPath);
    return { source: full, text: fs.readFileSync(full, 'utf8') };
  }
  // stdin
  const text = fs.readFileSync(0, 'utf8');
  return { source: '<stdin>', text };
}

/**
 * Build the set of acronyms that ARE defined-on-first-use anywhere in the text.
 * Matches both "Gloss Words (ACR)" and "ACR (Gloss Words)" shapes.
 */
function definedAcronyms(text) {
  const defined = new Set();

  // ACR (Gloss ...) — acronym immediately followed by a parenthetical.
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,5})\s*\(([^)]+)\)/g)) {
    defined.add(m[1]);
  }
  // Gloss Words (ACR) — parenthetical acronym whose letters trace the preceding
  // capitalized words (loose check: the acronym appears inside parens after words).
  for (const m of text.matchAll(/\(([A-Z][A-Z0-9]{1,5})\)/g)) {
    defined.add(m[1]);
  }
  return defined;
}

function lineOf(text, index) {
  // 1-based line number for a char offset.
  return text.slice(0, index).split('\n').length;
}

function snippet(line, term) {
  const i = line.indexOf(term);
  const start = Math.max(0, i - 30);
  const end = Math.min(line.length, i + term.length + 30);
  return (start > 0 ? '…' : '') + line.slice(start, end).trim() + (end < line.length ? '…' : '');
}

function lint(text) {
  const findings = [];
  const lines = text.split('\n');
  const defined = definedAcronyms(text);
  const seenAcronymFirst = new Set(); // report each undefined acronym once (first use)

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    // (b) UNFINDABLE-REF
    REPO_PATH_RE.lastIndex = 0;
    let m;
    while ((m = REPO_PATH_RE.exec(line)) !== null) {
      findings.push({
        line: lineNo,
        family: 'UNFINDABLE-REF',
        match: m[0],
        snippet: snippet(line, m[0]),
        suggest: 'Operator cannot open repo/internal paths. Restate the relevant content inline, or link to an operator-accessible location.',
      });
    }

    // (c) GO-FIND-REDIRECT
    for (const p of REDIRECT_PATTERNS) {
      p.re.lastIndex = 0;
      let r;
      while ((r = p.re.exec(line)) !== null) {
        findings.push({
          line: lineNo,
          family: 'GO-FIND-REDIRECT',
          match: r[0],
          snippet: snippet(line, r[0]),
          suggest: p.suggest,
        });
      }
    }

    // (a) UNDEFINED-JARGON (acronyms)
    ACRONYM_RE.lastIndex = 0;
    let a;
    while ((a = ACRONYM_RE.exec(line)) !== null) {
      const acr = a[1];
      if (COMMON_OK.has(acr)) continue;
      if (defined.has(acr)) continue;
      if (seenAcronymFirst.has(acr)) continue;
      seenAcronymFirst.add(acr);
      findings.push({
        line: lineNo,
        family: 'UNDEFINED-JARGON',
        match: acr,
        snippet: snippet(line, acr),
        suggest: `Acronym "${acr}" is used without a definition. Spell it out on first use, e.g. "Full Name (${acr})".`,
      });
    }
  });

  findings.sort((x, y) => x.line - y.line);
  return findings;
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const positional = argv.filter((a) => a !== '--json');
  const filePath = positional[0] || null;

  let input;
  try {
    input = readInput(filePath);
  } catch (e) {
    process.stderr.write(`deliverable-self-containment-lint: cannot read input: ${e.message}\n`);
    process.stderr.write('usage: node tools/artifacts/deliverable-self-containment-lint.js [--json] <file>   (or pipe text on stdin)\n');
    process.exit(2);
  }

  const findings = lint(input.text);
  const counts = findings.reduce((acc, f) => {
    acc[f.family] = (acc[f.family] || 0) + 1;
    return acc;
  }, {});

  if (json) {
    process.stdout.write(JSON.stringify({
      schema: 'DeliverableSelfContainmentLint/1.0',
      verdict: 'advisory', // never blocks
      source: input.source,
      counts,
      total: findings.length,
      findings,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(`deliverable-self-containment-lint — ${input.source}\n`);
    process.stdout.write('advisory WARN only — this lint never blocks delivery.\n\n');
    if (findings.length === 0) {
      process.stdout.write('No self-containment issues found. Deliverable reads as self-contained.\n');
    } else {
      for (const f of findings) {
        process.stdout.write(`  [WARN ${f.family}] line ${f.line}: ${f.match}\n`);
        process.stdout.write(`      ${f.snippet}\n`);
        process.stdout.write(`      → ${f.suggest}\n`);
      }
      const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
      process.stdout.write(`\n${findings.length} advisory finding(s): ${parts}\n`);
    }
  }

  // Advisory tool: never exit non-zero on findings (over-enforcement guard).
  process.exit(0);
}

main();
