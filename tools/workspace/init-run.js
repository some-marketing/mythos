#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { exists, isDir } = require('./lib/fs');
const { die } = require('./lib/workspace');
const { initRunState } = require('./lib/run-state');

function help() {
  console.log(`
Initialize a run state for a framework execution.

Usage:
  node tools/workspace/init-run.js --framework <service/name> --output <output-root>
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const frameworkArg = args.framework;
const outputArg = args.output;

if (!frameworkArg) die('Missing --framework <service/name>');
if (!outputArg) die('Missing --output <output-root>');

const outputRoot = path.resolve(outputArg);
if (!exists(outputRoot) || !isDir(outputRoot)) die(`Output root not found: ${outputRoot}`);

const { statePath, runId } = initRunState(outputRoot, frameworkArg);

console.log(`OK run state initialized.`);
console.log(`- run_id: ${runId}`);
console.log(`- state: ${statePath}`);
