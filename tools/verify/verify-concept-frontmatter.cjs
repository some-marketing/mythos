#!/usr/bin/env node
/**
 * verify-concept-frontmatter.cjs — Walks _dev/concepts/ and validates concept
 * doc frontmatter against tools/verify/lib/concept-frontmatter.cjs.
 *
 * Exit codes:
 *   0  — all concept docs pass (no violations; warnings allowed)
 *   1  — at least one concept doc has a violation (malformed field)
 *
 * Usage:
 *   node tools/verify/verify-concept-frontmatter.cjs [repoRoot]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  isConceptDocPath,
  validateConceptFrontmatter,
  REPO_ROOT
} = require('./lib/concept-frontmatter.cjs');

const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : REPO_ROOT;
const conceptsDir = path.join(repoRoot, '_dev', 'concepts');

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
    } else if (e.isFile() && full.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(conceptsDir);
const conceptDocs = allFiles.filter(f => isConceptDocPath(f));

let totalViolations = 0;
let totalWarnings = 0;
const failures = [];
const warningEntries = [];

for (const doc of conceptDocs) {
  const result = validateConceptFrontmatter(doc);
  const rel = path.relative(repoRoot, doc);
  if (result.violations.length > 0) {
    totalViolations += result.violations.length;
    failures.push({ rel, violations: result.violations });
  }
  if (result.warnings.length > 0) {
    totalWarnings += result.warnings.length;
    warningEntries.push({ rel, warnings: result.warnings });
  }
}

const summary = {
  scanned: conceptDocs.length,
  violations: totalViolations,
  warnings: totalWarnings,
  legacy_grandfathered: warningEntries.length
};

if (totalViolations === 0) {
  process.stdout.write(
    `PASS — concept-frontmatter: scanned ${summary.scanned}, ` +
    `violations 0, warnings ${summary.warnings} ` +
    `(${summary.legacy_grandfathered} legacy concept docs missing fields — non-blocking)\n`
  );
  process.exit(0);
}

process.stdout.write(`FAIL — concept-frontmatter: ${totalViolations} violations across ${failures.length} files\n`);
for (const f of failures) {
  process.stdout.write(`  ${f.rel}\n`);
  for (const v of f.violations) {
    process.stdout.write(`    - ${v}\n`);
  }
}
process.exit(1);
