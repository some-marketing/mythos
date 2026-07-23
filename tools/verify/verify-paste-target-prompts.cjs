#!/usr/bin/env node
/**
 * verify-paste-target-prompts.cjs — Walk the repo and validate every
 * paste-target prompt artifact against the content rules in
 * tools/verify/lib/paste-target-prompt.cjs.
 *
 * Usage: node tools/verify/verify-paste-target-prompts.cjs [project-root]
 *
 * Exit code 0 = PASS, 1 = FAIL.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  isPromptTargetPath,
  validatePasteTargetPrompt
} = require('./lib/paste-target-prompt.cjs');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'archive'
]);

// Additional directory paths (relative to root) to skip entirely.
const SKIP_REL_DIRS = new Set([
  '_dev/archive',
  '_dev/reports/analysis/convene-runs',
  '_dev/prompts/templates',
  'framework_candidates'
]);

function walk(root, rel, files) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_REL_DIRS.has(childRel)) continue;
      walk(root, childRel, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(childRel);
    }
  }
}

function main() {
  const argv = process.argv[2];
  const projectRoot = argv && !argv.startsWith('--')
    ? path.resolve(argv)
    : path.resolve(__dirname, '../..');

  const allMd = [];
  walk(projectRoot, '', allMd);

  const targets = allMd.filter(isPromptTargetPath);
  const failures = [];
  for (const rel of targets) {
    const abs = path.join(projectRoot, rel);
    const result = validatePasteTargetPrompt(abs);
    if (!result.ok) failures.push({ path: rel, violations: result.violations });
  }

  if (failures.length > 0) {
    for (const f of failures) {
      for (const v of f.violations) {
        const lineSuffix = v.line ? `:${v.line}` : '';
        process.stderr.write(`${f.path}${lineSuffix}: ${v.rule} ${v.name}: ${v.message}\n`);
      }
    }
    const total = failures.reduce((n, f) => n + f.violations.length, 0);
    process.stdout.write(`Found ${total} paste-target violations across ${failures.length} files.\n`);
    process.exit(1);
  }

  process.stdout.write(`paste-target-prompt validation: PASS (${targets.length} files checked)\n`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { main };
