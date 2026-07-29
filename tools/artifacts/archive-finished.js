#!/usr/bin/env node
'use strict';

/**
 * archive-finished.js — Archive finished analysis artifacts from the hot surface.
 *
 * Targets: _dev/reports/analysis/
 * Behavior: archive-only (moves files to _dev/archive/{year}-{month}/analysis/)
 * Default: dry-run (preview what would be archived)
 *
 * This tool has NO delete capability. It only moves files.
 *
 * Usage:
 *   node tools/artifacts/archive-finished.js [--execute] [--age <days>] [--verbose]
 *
 * Options:
 *   --execute    Actually move files (default is dry-run)
 *   --age        Minimum age in days to consider finished (default: 7)
 *   --verbose    Show per-file details
 *   --help       Show this help
 *
 * Exit code 0 = success, 1 = error
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../workspace/lib/args');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SURFACE_KEY = '_dev/reports/analysis';
const SURFACE_DIR = path.join(PROJECT_ROOT, SURFACE_KEY);
const POLICY_PATH = path.join(__dirname, 'retention-policy.json');

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function help() {
  console.log(`
Archive finished analysis artifacts from _dev/reports/analysis/.

This tool ONLY archives (moves files). It never deletes.

Usage:
  node tools/artifacts/archive-finished.js [options]

Options:
  --execute    Actually move files (default is dry-run preview)
  --age <n>    Minimum age in days to consider finished (default: 7)
  --verbose    Show per-file details
  --help       Show this help

Archive destination: _dev/archive/{year}-{month}/analysis/
Archive log: _dev/logs/archive.jsonl
`.trim());
}

function loadPolicy() {
  try {
    return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  } catch (err) {
    die(`Failed to read retention-policy.json: ${err.message}`);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatAge(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function isProtected(filePath, protectedPatterns) {
  const rel = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
  for (const pattern of protectedPatterns) {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__GLOBSTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__GLOBSTAR__/g, '.*') + '$'
    );
    if (regex.test(rel)) return true;
  }
  return false;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function archiveDestination(filePath) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return path.join(PROJECT_ROOT, '_dev', 'archive', `${year}-${month}`, 'analysis', path.basename(filePath));
}

function appendArchiveLog(entry) {
  const logDir = path.join(PROJECT_ROOT, '_dev', 'logs');
  const logPath = path.join(logDir, 'archive.jsonl');
  try {
    ensureDir(logDir);
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Non-fatal: logging failure should not block archive
  }
}

// ── Main ──

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const executeMode = Boolean(args.execute);
const dryRun = !executeMode;
const ageThresholdDays = parseInt(args.age || '7', 10);
if (isNaN(ageThresholdDays) || ageThresholdDays < 0) {
  die(`Invalid --age value: "${args.age}". Must be a non-negative integer.`);
}
const verbose = Boolean(args.verbose);
const ageThresholdMs = ageThresholdDays * 24 * 60 * 60 * 1000;
const now = Date.now();

const policy = loadPolicy();
const protectedPatterns = policy.protected || [];

// ── Scan surface ──

if (!fs.existsSync(SURFACE_DIR)) {
  console.log(`Surface directory does not exist: ${SURFACE_KEY}`);
  process.exit(0);
}

const entries = fs.readdirSync(SURFACE_DIR, { withFileTypes: true });
const fileInfos = [];

for (const entry of entries) {
  if (entry.name.startsWith('.')) continue;
  if (!entry.isFile()) continue;

  const filePath = path.join(SURFACE_DIR, entry.name);
  try {
    const stat = fs.statSync(filePath);
    fileInfos.push({
      filePath,
      relPath: path.relative(PROJECT_ROOT, filePath),
      name: entry.name,
      size: stat.size,
      mtime: stat.mtimeMs,
      age: now - stat.mtimeMs
    });
  } catch {
    // Skip unreadable files
  }
}

// Sort newest first
fileInfos.sort((a, b) => b.mtime - a.mtime);

// ── Identify archive candidates ──

const candidates = [];
const skipped = [];

for (let i = 0; i < fileInfos.length; i++) {
  const info = fileInfos[i];

  // Preserve the newest file (preserve-latest)
  if (i === 0) {
    skipped.push({ ...info, reason: 'newest (preserve-latest)' });
    continue;
  }

  // Skip files within age threshold
  if (info.age < ageThresholdMs) {
    skipped.push({ ...info, reason: `younger than ${ageThresholdDays}d threshold` });
    continue;
  }

  // Skip protected files
  if (isProtected(info.filePath, protectedPatterns)) {
    skipped.push({ ...info, reason: 'protected by retention policy' });
    continue;
  }

  candidates.push(info);
}

// ── Report ──

if (dryRun) {
  console.log('Archive Finished Analysis Artifacts — DRY RUN');
  console.log('==============================================\n');
} else {
  console.log('Archive Finished Analysis Artifacts — EXECUTE');
  console.log('=============================================\n');
}

console.log(`Surface: ${SURFACE_KEY}`);
console.log(`Age threshold: ${ageThresholdDays} days`);
console.log(`Total files: ${fileInfos.length}`);
console.log(`Archive candidates: ${candidates.length}`);
console.log(`Skipped: ${skipped.length}`);
console.log('');

if (verbose && skipped.length > 0) {
  console.log('Skipped files:');
  for (const s of skipped) {
    console.log(`  ${s.name} (${formatAge(s.age)} old) — ${s.reason}`);
  }
  console.log('');
}

if (candidates.length === 0) {
  console.log('Nothing to archive. All files are within threshold or protected.');
  process.exit(0);
}

const totalSize = candidates.reduce((acc, c) => acc + c.size, 0);
console.log(`Files to archive: ${candidates.length} (${formatBytes(totalSize)})`);

if (verbose || dryRun) {
  console.log('');
  for (const c of candidates) {
    const dest = path.relative(PROJECT_ROOT, archiveDestination(c.filePath));
    console.log(`  ${c.relPath} (${formatBytes(c.size)}, ${formatAge(c.age)} old)`);
    console.log(`    -> ${dest}`);
  }
}

console.log('');

if (dryRun) {
  console.log('This was a dry run. Use --execute to perform the archive.');

  // Log dry-run entries too for auditability
  for (const c of candidates) {
    appendArchiveLog({
      ts: new Date().toISOString(),
      event: 'artifact.archive',
      source: c.relPath,
      destination: path.relative(PROJECT_ROOT, archiveDestination(c.filePath)),
      surface: SURFACE_KEY,
      reason: 'finished',
      size_bytes: c.size,
      operator: 'archive-finished',
      dry_run: true
    });
  }

  process.exit(0);
}

// ── Execute archive ──

let archivedCount = 0;
let errorCount = 0;

for (const c of candidates) {
  const dest = archiveDestination(c.filePath);
  try {
    ensureDir(path.dirname(dest));
    if (fs.existsSync(dest)) {
      console.error(`  SKIPPED: ${c.relPath} — destination already exists: ${path.relative(PROJECT_ROOT, dest)}`);
      errorCount++;
      continue;
    }
    fs.renameSync(c.filePath, dest);
    archivedCount++;

    appendArchiveLog({
      ts: new Date().toISOString(),
      event: 'artifact.archive',
      source: c.relPath,
      destination: path.relative(PROJECT_ROOT, dest),
      surface: SURFACE_KEY,
      reason: 'finished',
      size_bytes: c.size,
      operator: 'archive-finished',
      dry_run: false
    });

    if (verbose) {
      console.log(`  archived: ${c.relPath} -> ${path.relative(PROJECT_ROOT, dest)}`);
    }
  } catch (err) {
    errorCount++;
    console.error(`  FAILED: ${c.relPath}: ${err.message}`);
  }
}

console.log('Archive complete.');
console.log(`  Archived: ${archivedCount} files`);
if (errorCount > 0) console.log(`  Errors: ${errorCount}`);

process.exit(errorCount > 0 ? 1 : 0);
