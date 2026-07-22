#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { exists, isDir } = require('./lib/fs');
const { getSmosRoot, die } = require('./lib/workspace');
const { loadRunState, finalizeRunState } = require('./lib/run-state');
const { loadOutputContract, inspectOutputs, computeOutputReadiness } = require('./lib/output-contract');

function help() {
  console.log(`
Finalize a framework run by validating outputs and updating run state.

Usage:
  node tools/workspace/finalize-run.js --run-state <path> --framework <service/name> --output <output-root>
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const runStateArg = args.run_state;
const frameworkArg = args.framework;
const outputArg = args.output;

if (!runStateArg) die('Missing --run-state <path>');
if (!frameworkArg) die('Missing --framework <service/name>');
if (!outputArg) die('Missing --output <output-root>');

const runStatePath = path.resolve(runStateArg);
const outputRoot = path.resolve(outputArg);

if (!exists(runStatePath)) die(`Run state not found: ${runStatePath}`);
if (!exists(outputRoot) || !isDir(outputRoot)) die(`Output root not found: ${outputRoot}`);

const smosRoot = getSmosRoot();
const frameworkRoot = path.join(smosRoot, 'frameworks', ...frameworkArg.split('/'));
const manifestPath = path.join(frameworkRoot, 'manifest.json');

if (!exists(manifestPath)) die(`Framework manifest not found: ${manifestPath}`);

// Load run state
const state = loadRunState(runStatePath);
console.log(`Run: ${state.run_id} (${state.framework_id})`);
console.log(`Prompts logged: ${state.prompt_log.length}`);
console.log(`Artifacts produced: ${state.artifacts_produced.length}`);

// Load contract and validate outputs
const { contract, findings: contractFindings } = loadOutputContract(manifestPath);
const outputFindings = inspectOutputs(outputRoot, contract, frameworkRoot);
const allFindings = [...contractFindings, ...outputFindings];
const readiness = computeOutputReadiness(allFindings);

// Finalize
finalizeRunState(runStatePath, readiness);

// Print summary
const severityOrder = ['blocker', 'warning', 'info'];
for (const sev of severityOrder) {
  const items = allFindings.filter((f) => f.severity === sev);
  if (items.length === 0) continue;
  console.log(`\n${sev.toUpperCase()} (${items.length}):`);
  for (const item of items) {
    console.log(`  [${item.code}] ${item.message}`);
  }
}

console.log(`\n--- Run Finalized ---`);
console.log(`Status: ${readiness.ready ? 'completed' : 'failed'}`);
console.log(`Blockers: ${readiness.blockerCount}`);
console.log(`Warnings: ${readiness.warningCount}`);

process.exit(readiness.ready ? 0 : 1);
