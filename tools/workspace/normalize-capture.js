#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { exists, writeText } = require('./lib/fs');
const { inspectCapture, updateCaptureMeta } = require('./lib/capture-candidate');
const { die, requireCaptureRoot } = require('./lib/workspace');
const { loadFeedbackEntries, loadSignalEntries } = require('./lib/learning-ledger');

function help() {
  console.log(`
Normalize and validate a capture bundle.

Usage:
  node tools/workspace/normalize-capture.js --capture <capture-root>
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
const normalizationStatus = inspection.ready ? 'normalized' : 'incomplete';
const status = inspection.ready ? 'ready_for_scaffold' : 'incomplete';

updateCaptureMeta(captureRoot, {
  normalization_status: normalizationStatus,
  normalization_notes: inspection.missing,
  status
});

// Validate learning artifacts if present
const learningRoot = path.join(captureRoot, 'learning');
const learningNotes = [];
let feedbackCount = 0;
let signalCount = 0;
let learningErrors = [];

if (exists(learningRoot)) {
  try {
    const feedbackEntries = loadFeedbackEntries(learningRoot);
    feedbackCount = feedbackEntries.length;
  } catch (err) {
    learningErrors.push(`Feedback validation error: ${err.message}`);
  }
  try {
    const signalEntries = loadSignalEntries(learningRoot);
    signalCount = signalEntries.length;
  } catch (err) {
    learningErrors.push(`Signal validation error: ${err.message}`);
  }
}

if (feedbackCount === 0) {
  learningNotes.push('No feedback entries recorded. Add feedback before promotion.');
}
if (signalCount === 0) {
  learningNotes.push('No signal entries recorded. Add signals before promotion.');
}

const reportLines = [
  `Capture root: \`${captureRoot}\``,
  `Ready for scaffold: **${inspection.ready ? 'yes' : 'no'}**`,
  '',
  'Missing required items:',
  ...(inspection.missing.length ? inspection.missing.map((item) => `- ${item}`) : ['- none']),
  '',
  'Advisory notes:',
  ...(inspection.notes.length ? inspection.notes.map((item) => `- ${item}`) : ['- none']),
  '',
  'Learning evidence:',
  `- feedback entries: ${feedbackCount}`,
  `- signal entries: ${signalCount}`,
  ...(learningNotes.length ? learningNotes.map((item) => `- ${item}`) : []),
  ...(learningErrors.length ? learningErrors.map((item) => `- ERROR: ${item}`) : [])
];
writeText(path.join(captureRoot, 'NORMALIZATION_REPORT.md'), `# Normalization Report\n\n${reportLines.join('\n')}\n`);

console.log(`OK normalized capture: ${captureRoot}`);
console.log(`- ready for scaffold: ${inspection.ready ? 'yes' : 'no'}`);
console.log(`- learning: feedback=${feedbackCount}, signal=${signalCount}`);
if (inspection.missing.length) {
  console.log(`- missing: ${inspection.missing.join(', ')}`);
}
if (learningErrors.length) {
  console.log(`- learning errors: ${learningErrors.join(', ')}`);
}
