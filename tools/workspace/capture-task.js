#!/usr/bin/env node
'use strict';

const path = require('path');
const { parseArgs } = require('./lib/args');
const { copyPath, ensureDir, exists, readJson, writeJson, writeText } = require('./lib/fs');
const { inspectCapture, updateCaptureMeta } = require('./lib/capture-candidate');
const {
  die,
  loadProject,
  relPosix,
  requireProjectRoot,
  slugify,
  timestampId,
  writeMarkdownTemplate
} = require('./lib/workspace');
const { writeSignalEntry, writeFeedbackEntry } = require('./lib/learning-ledger');

function help() {
  console.log(`
Capture a successful task from anywhere on disk into a normalized Mythos project bundle.

Usage:
  node tools/workspace/capture-task.js --into <project-root> --task-type <task-type> [--from <path>] [--files <a,b,c>] [--summary] [--source <manual|llm|hybrid>] [--feedback <outcome>] [--signal <result>]

Learning options:
  --feedback <outcome>   Record initial user feedback (accepted|accepted_with_edits|rejected|partial)
  --signal <result>      Record initial system signal (pass|fail|partial|advisory)
`.trim());
}

function detectSourceType({ fromPath, filesArg, summary }) {
  const hasFrom = Boolean(fromPath);
  const hasFiles = Boolean(filesArg);
  const hasSummary = Boolean(summary);
  if ((hasFrom || hasFiles) && hasSummary) return 'hybrid';
  if (hasFiles) return 'files';
  if (hasFrom) return exists(fromPath) && require('fs').statSync(fromPath).isDirectory() ? 'folder' : 'files';
  if (hasSummary) return 'summary';
  return 'summary';
}

function parseFilesArg(filesArg) {
  if (!filesArg) return [];
  return String(filesArg)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function copyImportedPath(srcPath, importedRoot) {
  const baseName = slugify(path.basename(srcPath, path.extname(srcPath))) || 'imported';
  const ext = path.extname(srcPath);
  const targetBase = path.join(importedRoot, `${baseName}${ext}`);
  let targetPath = targetBase;
  let counter = 2;
  while (exists(targetPath)) {
    targetPath = path.join(importedRoot, `${baseName}-${counter}${ext}`);
    counter += 1;
  }
  copyPath(srcPath, targetPath);
  return targetPath;
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const projectArg = args.into || args.project;
const taskType = String(args.task_type || '').trim();
const sourceMode = String(args.source || 'hybrid').trim();
const fromPath = args.from ? path.resolve(String(args.from)) : null;
const filePaths = parseFilesArg(args.files);
const summary = Boolean(args.summary);
const feedbackOutcome = args.feedback ? String(args.feedback).trim() : null;
const signalResult = args.signal ? String(args.signal).trim() : null;

if (feedbackOutcome && !['accepted', 'accepted_with_edits', 'rejected', 'partial'].includes(feedbackOutcome)) {
  die('Invalid --feedback. Expected one of: accepted, accepted_with_edits, rejected, partial');
}
if (signalResult && !['pass', 'fail', 'partial', 'advisory'].includes(signalResult)) {
  die('Invalid --signal. Expected one of: pass, fail, partial, advisory');
}

if (!projectArg) die('Missing --into <project-root>');
if (!taskType) die('Missing --task-type <task-type>');
if (!['manual', 'llm', 'hybrid'].includes(sourceMode)) {
  die('Invalid --source. Expected one of: manual, llm, hybrid');
}
if (!fromPath && !filePaths.length && !summary) {
  die('Provide at least one of --from, --files, or --summary');
}
if (fromPath && !exists(fromPath)) die(`--from path not found: ${fromPath}`);
for (const filePath of filePaths) {
  if (!exists(filePath)) die(`--files path not found: ${filePath}`);
}

const { projectRoot } = requireProjectRoot(projectArg);
const project = loadProject(projectRoot);

const capturesRoot = path.join(projectRoot, 'captures');
ensureDir(capturesRoot);
const captureId = timestampId(taskType);
const captureRoot = path.join(capturesRoot, captureId);
ensureDir(captureRoot);
ensureDir(path.join(captureRoot, 'artifacts', 'imported'));
ensureDir(path.join(captureRoot, 'outputs'));

const importedFiles = [];
const importedRoot = path.join(captureRoot, 'artifacts', 'imported');

if (fromPath) {
  const copied = copyImportedPath(fromPath, importedRoot);
  importedFiles.push(relPosix(captureRoot, copied));
}
for (const filePath of filePaths) {
  const copied = copyImportedPath(filePath, importedRoot);
  importedFiles.push(relPosix(captureRoot, copied));
}

writeMarkdownTemplate(path.join(captureRoot, 'goal.md'), [
  '# Goal',
  '',
  `Describe what success looked like for this ${taskType} run.`,
  '',
  'TODO: Capture the business goal, the deliverable, and the acceptance threshold.'
]);

writeMarkdownTemplate(path.join(captureRoot, 'context.md'), [
  '# Context',
  '',
  `Task type: \`${taskType}\``,
  `Project: \`${project.project_name || path.basename(projectRoot)}\``,
  '',
  'Imported evidence:',
  ...(importedFiles.length ? importedFiles.map((file) => `- \`${file}\``) : ['- None imported. Use summary mode notes instead.']),
  '',
  'TODO: Add the operating context, relevant constraints, and any non-secret dependencies.'
]);

writeText(path.join(captureRoot, 'steps.jsonl'), '');
writeText(path.join(captureRoot, 'decisions.jsonl'), '');

writeJson(path.join(captureRoot, 'success_criteria.json'), {
  criteria: [],
  notes: ['TODO: Add at least one success criterion before normalization can mark this capture ready.']
});

writeMarkdownTemplate(path.join(captureRoot, 'retrospective.md'), [
  '# Retrospective',
  '',
  'TODO: Record what was stable, what required judgment, and what would likely vary on the next run.'
]);

writeMarkdownTemplate(path.join(captureRoot, 'failures_and_recoveries.md'), [
  '# Failures And Recoveries',
  '',
  'TODO: If anything failed during the successful run, note how it was detected and corrected.'
]);

writeJson(path.join(captureRoot, 'CAPTURE_META.json'), {
  capture_id: captureId,
  task_type: taskType,
  service_category: String(project.service || 'unclassified'),
  source_mode: sourceMode,
  source_type: detectSourceType({ fromPath, filesArg: filePaths.length ? filePaths.join(',') : '', summary }),
  source_root: fromPath || (filePaths.length ? filePaths[0] : '[summary-only]'),
  imported_files: importedFiles,
  normalization_status: importedFiles.length || summary ? 'raw' : 'incomplete',
  normalization_notes: [],
  operator: process.env.USER || 'unknown',
  created_at: new Date().toISOString(),
  status: 'incomplete'
});

const inspection = inspectCapture(captureRoot);
updateCaptureMeta(captureRoot, {
  normalization_status: inspection.ready ? 'normalized' : 'incomplete',
  normalization_notes: inspection.missing
});

// Create learning directory and write optional feedback/signal entries
const learningRoot = path.join(captureRoot, 'learning');
ensureDir(learningRoot);
ensureDir(path.join(learningRoot, 'feedback'));
ensureDir(path.join(learningRoot, 'signals'));

const learningEntries = { feedback: 0, signal: 0 };
const frameworkId = `${String(project.service || 'unclassified')}/${taskType}`;

if (feedbackOutcome) {
  writeFeedbackEntry(learningRoot, {
    entry_id: `feedback-${captureId}`,
    framework_id: frameworkId,
    outcome: feedbackOutcome,
    captured_at: new Date().toISOString()
  });
  learningEntries.feedback = 1;
}

if (signalResult) {
  writeSignalEntry(learningRoot, {
    entry_id: `signal-${captureId}`,
    signal_type: 'validation',
    result: signalResult,
    source: 'capture-task',
    captured_at: new Date().toISOString()
  });
  learningEntries.signal = 1;
}

console.log(`OK captured task: ${captureRoot}`);
console.log(`- task type: ${taskType}`);
console.log(`- imported files: ${inspection.importedFiles.length}`);
console.log(`- ready for scaffold: ${inspection.ready ? 'yes' : 'no'}`);
console.log(`- learning: feedback=${learningEntries.feedback}, signal=${learningEntries.signal}`);
if (inspection.missing.length) {
  console.log(`- missing: ${inspection.missing.join(', ')}`);
}
