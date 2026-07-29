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
  const outputDir = path.join(projectRoot, 'reconciliation_output');
  const artifacts = [
    'CONTRADICTION_REPORT.md',
    'reconciliation_summary.json',
    'reconciliation_log.json'
  ];
  const found = artifacts.filter(a => fs.existsSync(path.join(outputDir, a)));
  console.log(JSON.stringify({
    framework_id: project.framework_id,
    project_name: project.project_name,
    intake_dir: 'intake',
    outputs_dir: 'reconciliation_output',
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
version-reconciliation project CLI

Commands:
  status    Show project status and artifact progress
  validate  Check project directory structure
  help      Show this help

Framework commands (run from Mythos repo):
  /version-reconciliation:reconcile <version-a> <version-b>
  /version-reconciliation:status
`.trim());
  process.exit(0);
}

console.error(`Unknown command: ${command}\nRun with 'help' for usage.`);
process.exit(1);
