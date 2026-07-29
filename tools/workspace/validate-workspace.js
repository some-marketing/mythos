#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { exists, listDirs, readText } = require('./lib/fs');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function help() {
  console.log(`
Validate a client workspace.

Usage (external):
  node tools/workspace/validate-workspace.js --workspace <path>

Usage (private operations):
  node tools/workspace/validate-workspace.js --client-code <CODE>
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const smosRoot = path.resolve(__dirname, '..', '..');
let workspaceRoot;
if (args.client_code) {
  workspaceRoot = path.join(smosRoot, 'clients', String(args.client_code).trim());
} else if (args.workspace) {
  workspaceRoot = path.resolve(String(args.workspace));
} else {
  die('Missing --workspace <path> or --client-code <CODE>');
}

const isInternal = workspaceRoot.startsWith(path.join(smosRoot, 'clients') + path.sep);

// Core requirements for both modes
const required = ['WORKSPACE_MANIFEST.json', 'README.md', 'projects'];

if (isInternal) {
  // Internal mode: root client.json is the identity source
  required.push('client.json');
} else {
  // External mode: full workspace scaffold expected
  required.push('config/client.json', 'config/defaults.json', '.gitignore', '.env.example', 'secrets/README.md', 'framework_exports');
}

const missing = required.filter((p) => !exists(path.join(workspaceRoot, p)));
if (missing.length) {
  console.error(`Workspace validation failed (${isInternal ? 'internal' : 'external'} mode). Missing:`);
  for (const m of missing) console.error(`- ${m}`);
  process.exit(1);
}

if (!isInternal) {
  const gitignoreText = readText(path.join(workspaceRoot, '.gitignore'));
  if (!gitignoreText.includes('secrets/*')) {
    console.warn('WARN .gitignore does not appear to ignore secrets/: expected `secrets/*`');
  }
}

const projects = listDirs(path.join(workspaceRoot, 'projects'));
const projectIssues = [];
for (const projectName of projects) {
  const projectRoot = path.join(workspaceRoot, 'projects', projectName);
  const projectJsonPath = path.join(projectRoot, 'project.json');
  if (!exists(projectJsonPath)) {
    projectIssues.push({ project: projectName, missing: 'project.json' });
    continue;
  }

  for (const rel of ['outputs', 'captures', 'framework_candidates']) {
    if (!exists(path.join(projectRoot, rel))) {
      projectIssues.push({ project: projectName, missing: rel });
    }
  }

  let frameworkId = '';
  try {
    frameworkId = String(JSON.parse(readText(projectJsonPath))?.framework_id || '').trim();
  } catch {
    projectIssues.push({ project: projectName, missing: 'project.json (invalid JSON)' });
    continue;
  }

  // Only enforce runtime for frameworks that require a runnable pack today.
  if (frameworkId === 'wordpress/qa') {
    const requiredProjectPaths = [
      'framework/runner/cli.js',
      'playwright_phased_runner/runner/run-phased.js',
      'playwright_phased_runner/package.json'
    ];
    for (const rel of requiredProjectPaths) {
      if (!exists(path.join(projectRoot, rel))) {
        projectIssues.push({ project: projectName, missing: rel });
      }
    }
  }
}

if (projectIssues.length) {
  console.error('Workspace validation warnings (project runtime missing):');
  for (const issue of projectIssues) {
    console.error(`- ${issue.project}: missing ${issue.missing}`);
  }
  process.exit(1);
}

console.log(`OK workspace structure looks valid (${isInternal ? 'internal' : 'external'} mode).`);
console.log(`- workspace: ${workspaceRoot}`);
console.log(`- projects: ${projects.length ? projects.join(', ') : '(none)'}`);
