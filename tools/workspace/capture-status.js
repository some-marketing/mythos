#!/usr/bin/env node
'use strict';

const { parseArgs } = require('./lib/args');
const { inspectCapture } = require('./lib/capture-candidate');
const { die, requireCaptureRoot } = require('./lib/workspace');

function help() {
  console.log(`
Show capture readiness and missing fields.

Usage:
  node tools/workspace/capture-status.js --capture <capture-root>
`.trim());
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const captureArg = args.capture;
if (!captureArg) die('Missing --capture <capture-root>');

const { captureRoot } = requireCaptureRoot(captureArg);
const inspection = inspectCapture(captureRoot);

console.log(`Capture: ${captureRoot}`);
console.log(`- status: ${inspection.meta.status}`);
console.log(`- normalization: ${inspection.meta.normalization_status}`);
console.log(`- ready for scaffold: ${inspection.ready ? 'yes' : 'no'}`);
console.log(`- imported files: ${inspection.importedFiles.length}`);
console.log(`- steps: ${inspection.steps.length}`);
console.log(`- decisions: ${inspection.decisions.length}`);
if (inspection.missing.length) {
  console.log(`- missing: ${inspection.missing.join(', ')}`);
}
if (inspection.notes.length) {
  console.log(`- notes: ${inspection.notes.join(' | ')}`);
}
