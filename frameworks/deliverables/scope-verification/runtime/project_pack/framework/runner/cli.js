#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const projectJsonPath = path.join(projectRoot, 'project.json');

if (!fs.existsSync(projectJsonPath)) {
  console.error(`Missing project.json in ${projectRoot}`);
  process.exit(1);
}

const [,, command = 'status'] = process.argv;

if (command === 'status') {
  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const outputDir = path.join(projectRoot, 'verification_output');
  const artifacts = [
    'source_manifest.json',
    'categorized_inventory.json',
    'scope_claims.json',
    'comparison_matrix.json',
    'DISCREPANCY_REPORT.md',
    'verification_summary.json'
  ];
  const found = artifacts.filter(a => fs.existsSync(path.join(outputDir, a)));
  console.log(JSON.stringify({
    framework_id: project.framework_id,
    project_name: project.project_name,
    intake_dir: 'intake',
    outputs_dir: 'verification_output',
    artifacts_expected: artifacts.length,
    artifacts_found: found.length,
    complete: found.length === artifacts.length,
    missing: artifacts.filter(a => !found.includes(a))
  }, null, 2));
  process.exit(0);
}

if (command === 'validate') {
  const required = ['project.json', 'intake', 'outputs'];
  const missing = required.filter(rel => !fs.existsSync(path.join(projectRoot, rel)));
  if (missing.length) {
    for (const m of missing) console.error(`Missing ${m}`);
    process.exit(1);
  }
  console.log('OK project structure looks valid.');
  process.exit(0);
}

if (command === 'help') {
  console.log(`
scope-verification project CLI

Commands:
  status    Show project status and artifact progress
  validate  Check project directory structure
  help      Show this help

Framework commands (run from Mythos repo):
  /scope-verification:verify <scope-document> <source-data>
  /scope-verification:status
`.trim());
  process.exit(0);
}

console.error(`Unknown command: ${command}\nRun with 'help' for usage.`);
process.exit(1);
