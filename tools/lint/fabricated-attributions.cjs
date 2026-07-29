#!/usr/bin/env node
'use strict';
//
// tools/lint/fabricated-attributions.cjs
//
// Scans authored / generated content for fabricated testimonial-shaped quotes
// with named-source attributions (e.g. `"…great" — Halifax Theatre Notes, 2023`).
// Invoked by instructions/canonical/commands/lint-attributions.yaml and the
// .claude/skills/lint-attributions skill. Built for the
// external-skill-harvest-integration plan, Stage A (SA.2) — the yaml already
// invoked this path but the file did not exist (live bug).
//
// Behaviour:
//   - Accepts a file path, directory, or glob as $ARGUMENTS.
//   - Detects quote+attribution patterns (em-dash attribution, markdown
//     blockquote attribution, structured testimonial JSON fields).
//   - Cross-checks each attribution against project evidence sources
//     (intake.json testimonial/credential fields, testimonials/credits/press
//     files); evidence-backed attributions are NOT flagged.
//   - Lorem-ipsum bodies with lorem/absent attributions are placeholder-acceptable.
//   - Also runs the WARN-tier advisory slop bank (tools/lint/slop-patterns.js)
//     over prose targets and surfaces hits as advisory notes (never fail).
//   - Emits text by default, JSON with --json. Non-throwing on clean input.
//   - Exit 0 on clean / advisory-only; exit 1 only if fabricated findings exist
//     (advisory slop hits never change exit code).
//
// Usage:
//   node tools/lint/fabricated-attributions.cjs <file|dir|glob> [<more> ...] [--json] [--signal <path>]
//
const fs = require('fs');
const path = require('path');

let signalLib = null;
try {
  signalLib = require('../verify/lib/signal.cjs');
} catch {
  signalLib = null;
}

let slopLib = null;
try {
  slopLib = require('./slop-patterns.js');
} catch {
  slopLib = null;
}

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm', '.txt', '.json', '.yaml', '.yml']);
const PROSE_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm', '.txt']);

// ── Detection patterns ───────────────────────────────────────────────────────
// A "name-shaped" attribution: capitalized words, possibly with role/org and a
// year. Deliberately conservative to keep false-positives low.
const NAME_SHAPED =
  '(?:[A-Z][\\w.&\'-]+(?:\\s+[A-Z][\\w.&\'-]+){0,5}(?:,\\s*[A-Z][\\w.&\'’ -]+)?(?:,\\s*(?:19|20)\\d{2})?)';

// Pattern 1 — quote on one line, em-dash attribution after it.
const EMDASH_ATTR = new RegExp(
  `["“][^"”\\n]{6,}["”]\\s*(?:\\n\\s*)?[—–-]{1,2}\\s*(${NAME_SHAPED})`,
  'g'
);
// Pattern 2 — markdown blockquote whose next line is an em-dash attribution.
const BLOCKQUOTE_ATTR = new RegExp(
  `^>\\s*.+\\n>?\\s*[—–-]{1,2}\\s*(${NAME_SHAPED})`,
  'gm'
);
// Pattern 3 — structured testimonial fields in JSON/YAML.
const STRUCTURED_AUTHOR = /["']?(?:author|attribution|cite|source)["']?\s*[:=]\s*["']([^"'\n]{2,})["']/gi;

// Lorem-ipsum body heuristic.
const LOREM = /lorem ipsum|dolor sit amet/i;
// Explicit placeholder markers — acceptable.
const PLACEHOLDER = /\[(?:testimonial|citation|attribution|name|source)[^\]]*pending[^\]]*\]|pending\s*[—–-]\s*client|\[pending/i;

// Evidence-source filenames to scan within the project tree of each target.
const EVIDENCE_FILE_RE = /(?:intake|testimonials?|credits?|press)\.(?:json|md|yaml|yml)$/i;

function isTextFile(file) {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function expandTargets(args) {
  const files = new Set();
  for (const arg of args) {
    let stat = null;
    try {
      stat = fs.statSync(arg);
    } catch {
      stat = null;
    }
    if (stat && stat.isFile()) {
      files.add(path.resolve(arg));
      continue;
    }
    if (stat && stat.isDirectory()) {
      walkDir(arg, files);
      continue;
    }
    // Treat as glob.
    try {
      for (const match of fs.globSync(arg)) {
        const resolved = path.resolve(match);
        try {
          if (fs.statSync(resolved).isFile()) files.add(resolved);
        } catch { /* ignore */ }
      }
    } catch { /* ignore unsupported glob */ }
  }
  return [...files].filter(isTextFile);
}

function walkDir(dir, acc) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, acc);
    else if (e.isFile() && isTextFile(full)) acc.add(path.resolve(full));
  }
}

// Collect evidence attribution strings reachable from a target file's tree by
// walking up to a reasonable root and reading evidence files.
function collectEvidenceStrings(targetFile) {
  const strings = new Set();
  let dir = path.dirname(targetFile);
  const seenRoots = [];
  // Walk up to 6 levels collecting evidence files in each directory.
  for (let i = 0; i < 6 && dir && dir !== path.dirname(dir); i++) {
    seenRoots.push(dir);
    dir = path.dirname(dir);
  }
  for (const root of seenRoots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && EVIDENCE_FILE_RE.test(e.name)) {
        try {
          const raw = fs.readFileSync(path.join(root, e.name), 'utf8');
          // Pull capitalized name-ish tokens + any quoted values as evidence.
          for (const m of raw.matchAll(/[A-Z][\w.&'-]+(?:\s+[A-Z][\w.&'-]+){0,5}/g)) {
            strings.add(m[0].toLowerCase());
          }
        } catch { /* ignore */ }
      }
    }
  }
  return strings;
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function classify(quoteBody, attribution, evidence) {
  const attrLower = String(attribution || '').toLowerCase().trim();
  if (PLACEHOLDER.test(quoteBody) || PLACEHOLDER.test(attribution)) return 'placeholder-acceptable';
  if (LOREM.test(quoteBody) && (LOREM.test(attribution) || !attribution)) return 'placeholder-acceptable';
  for (const ev of evidence) {
    if (ev && attrLower && (ev.includes(attrLower) || attrLower.includes(ev))) return 'evidence-backed';
  }
  return 'fabricated';
}

function scanFile(file) {
  const findings = [];
  const advisories = [];
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return { findings, advisories };
  }
  const evidence = collectEvidenceStrings(file);

  const record = (match, attribution, pattern) => {
    const body = match[0];
    const verdict = classify(body, attribution, evidence);
    if (verdict === 'fabricated') {
      findings.push({
        file,
        line: lineOf(content, match.index),
        quote: body.replace(/\s+/g, ' ').slice(0, 160),
        attribution: String(attribution).trim(),
        pattern,
        classification: verdict,
        evidence: 'none found in intake/testimonials/credits/press',
        fix: 'replace attribution with "— [pending — client to provide]" or use lorem ipsum body'
      });
    }
  };

  for (const m of content.matchAll(EMDASH_ATTR)) record(m, m[1], 'emdash-attribution');
  for (const m of content.matchAll(BLOCKQUOTE_ATTR)) record(m, m[1], 'blockquote-attribution');
  for (const m of content.matchAll(STRUCTURED_AUTHOR)) record(m, m[1], 'structured-author-field');

  // Advisory WARN-tier slop bank over prose targets (never affects exit code).
  if (slopLib && PROSE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    for (const hit of slopLib.scanSlop(content)) {
      advisories.push({ file, ...hit });
    }
  }

  return { findings, advisories };
}

function emitSignal(signalPath, findings, advisories, scannedCount) {
  if (!signalLib) return;
  const signal = signalLib.createSignal('lint-attributions', 'lint:fabricated-attributions');
  signalLib.addCheck(signal, {
    id: 'no-fabricated-attributions',
    category: 'content-integrity',
    severity: 'critical',
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    message: findings.length === 0
      ? `No fabricated attributions across ${scannedCount} file(s).`
      : `${findings.length} fabricated attribution(s) detected.`,
    fix_hint: findings.length ? 'Replace with placeholder or cite real evidence.' : undefined
  });
  signalLib.addCheck(signal, {
    id: 'slop-advisory',
    category: 'content-quality',
    severity: 'warning',
    status: advisories.length === 0 ? 'PASS' : 'WARN',
    message: advisories.length === 0
      ? 'No advisory anti-slop patterns flagged.'
      : `${advisories.length} advisory anti-slop pattern hit(s) (WARN, non-blocking).`
  });
  signalLib.writeSignal(signal, signalPath);
}

function main() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes('--json');
  let signalPath = null;
  const sigIdx = argv.indexOf('--signal');
  if (sigIdx >= 0) signalPath = argv[sigIdx + 1];

  const targets = argv.filter((a, i) =>
    !a.startsWith('--') && !(sigIdx >= 0 && i === sigIdx + 1)
  );

  if (targets.length === 0) {
    console.error('usage: node tools/lint/fabricated-attributions.cjs <file|dir|glob> [...] [--json] [--signal <path>]');
    process.exit(2);
  }

  const files = expandTargets(targets);
  let findings = [];
  let advisories = [];
  for (const f of files) {
    const r = scanFile(f);
    findings = findings.concat(r.findings);
    advisories = advisories.concat(r.advisories);
  }

  if (signalPath) emitSignal(signalPath, findings, advisories, files.length);

  if (jsonOut) {
    console.log(JSON.stringify({
      scanned: files.length,
      fabricated: findings.length,
      advisory_slop: advisories.length,
      findings,
      advisories
    }, null, 2));
  } else {
    for (const f of findings) {
      console.log(`FABRICATED: ${f.file}:${f.line}`);
      console.log(`  Quote:       ${f.quote}`);
      console.log(`  Attribution: ${f.attribution}`);
      console.log(`  Pattern:     ${f.pattern}`);
      console.log(`  Evidence:    ${f.evidence}`);
      console.log(`  Fix:         ${f.fix}`);
    }
    if (advisories.length) {
      console.log(`\nAdvisory (anti-slop, WARN — non-blocking):`);
      for (const a of advisories) {
        console.log(`  warn  [${a.category}] ${a.hit} — ${a.note}  (${a.file})`);
      }
    }
    console.log(`\nScanned: ${files.length} file(s)`);
    console.log(`Findings: ${findings.length} fabricated · ${advisories.length} advisory-slop`);
    if (findings.length) console.log(`Action required: ${findings.length} fabricated attribution(s) need replacement before delivery`);
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

module.exports = { scanFile, classify, expandTargets, EMDASH_ATTR, BLOCKQUOTE_ATTR };

if (require.main === module) {
  main();
}
