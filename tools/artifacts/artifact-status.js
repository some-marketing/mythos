#!/usr/bin/env node
'use strict';

/**
 * artifact-status.js — Report artifact counts, sizes, and retention state.
 *
 * Scans known artifact surfaces defined in retention-policy.json and reports:
 * - file counts per surface
 * - total size per surface
 * - oldest and newest files
 * - files exceeding retention policy
 * - what would be cleaned up (dry-run preview)
 *
 * Usage:
 *   node tools/artifacts/artifact-status.js [--verbose] [--surface <name>]
 *
 * Exit code 0 = clean, 1 = surfaces exceed retention policy
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../workspace/lib/args');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function help() {
  console.log(`
Report artifact counts, sizes, and retention policy state.

Usage:
  node tools/artifacts/artifact-status.js [--verbose] [--surface <name>]

Options:
  --verbose    Show per-file details
  --surface    Filter to a specific surface key
  --help       Show this help

Reads retention-policy.json and scans artifact directories.
`.trim());
}

function loadPolicy() {
  const policyPath = path.join(__dirname, 'retention-policy.json');
  try {
    return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (err) {
    die(`Failed to read retention-policy.json: ${err.message}`);
  }
}

function parseDuration(durationStr) {
  const match = String(durationStr).match(/^(\d+)d$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 24 * 60 * 60 * 1000;
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

/**
 * Resolve a surface key to actual files.
 * Handles both directory paths and glob-like patterns.
 */
function resolveSurfaceFiles(surfaceKey) {
  const files = [];

  if (surfaceKey.includes('*')) {
    // Glob-like pattern: _handoffs/*/gemini-response-turn-*.json
    const parts = surfaceKey.split('/');
    const resolvedBase = path.join(PROJECT_ROOT, parts[0]);

    if (!fs.existsSync(resolvedBase)) return files;

    walkGlob(resolvedBase, parts.slice(1), '', files);
  } else {
    // Simple directory path
    const dirPath = path.join(PROJECT_ROOT, surfaceKey);
    if (!fs.existsSync(dirPath)) return files;

    const stat = fs.statSync(dirPath);
    if (stat.isDirectory()) {
      collectFilesRecursive(dirPath, files);
    } else if (stat.isFile()) {
      files.push(dirPath);
    }
  }

  return files;
}

function walkGlob(currentDir, remainingParts, relPath, results) {
  if (!fs.existsSync(currentDir)) return;

  if (remainingParts.length === 0) return;

  const part = remainingParts[0];
  const rest = remainingParts.slice(1);

  if (part === '*') {
    // Match any single directory entry
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const entryPath = path.join(currentDir, entry.name);
        if (rest.length === 0) {
          // * is the last segment
          if (entry.isFile()) results.push(entryPath);
        } else {
          if (entry.isDirectory()) {
            walkGlob(entryPath, rest, path.join(relPath, entry.name), results);
          }
        }
      }
    } catch {
      // directory not readable
    }
  } else if (part.includes('*')) {
    // Wildcard within filename: gemini-response-turn-*.json
    const regex = new RegExp(
      '^' + part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (regex.test(entry.name)) {
          const entryPath = path.join(currentDir, entry.name);
          if (rest.length === 0) {
            if (entry.isFile()) results.push(entryPath);
          } else if (entry.isDirectory()) {
            walkGlob(entryPath, rest, path.join(relPath, entry.name), results);
          }
        }
      }
    } catch {
      // directory not readable
    }
  } else {
    // Literal path segment
    const nextDir = path.join(currentDir, part);
    if (rest.length === 0) {
      if (fs.existsSync(nextDir)) {
        const stat = fs.statSync(nextDir);
        if (stat.isFile()) results.push(nextDir);
        else if (stat.isDirectory()) collectFilesRecursive(nextDir, results);
      }
    } else {
      walkGlob(nextDir, rest, path.join(relPath, part), results);
    }
  }
}

function collectFilesRecursive(dirPath, results) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        collectFilesRecursive(fullPath, results);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory not readable
  }
}

function getFileStat(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
  } catch {
    return null;
  }
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

// ── Main ──

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const verbose = Boolean(args.verbose);
const surfaceFilter = args.surface || null;

const policy = loadPolicy();
const now = Date.now();
let anyExceeded = false;

const summaries = [];

for (const [surfaceKey, surfaceConfig] of Object.entries(policy.surfaces)) {
  if (surfaceFilter && surfaceKey !== surfaceFilter) continue;

  const files = resolveSurfaceFiles(surfaceKey);
  const retentionMs = parseDuration(surfaceConfig.retention);

  let totalSize = 0;
  let oldest = Infinity;
  let newest = 0;
  let exceededCount = 0;
  let exceededSize = 0;
  let protectedCount = 0;
  const fileDetails = [];

  for (const filePath of files) {
    const stat = getFileStat(filePath);
    if (!stat) continue;

    const age = now - stat.mtime;
    totalSize += stat.size;
    if (stat.mtime < oldest) oldest = stat.mtime;
    if (stat.mtime > newest) newest = stat.mtime;

    const prot = isProtected(filePath, policy.protected);
    if (prot) protectedCount++;

    const exceeded = retentionMs && age > retentionMs && !prot;
    if (exceeded) {
      exceededCount++;
      exceededSize += stat.size;
    }

    fileDetails.push({
      path: path.relative(PROJECT_ROOT, filePath),
      size: stat.size,
      age,
      protected: prot,
      exceeded
    });
  }

  if (exceededCount > 0) anyExceeded = true;

  summaries.push({
    surface: surfaceKey,
    description: surfaceConfig.description,
    retention: surfaceConfig.retention,
    action: surfaceConfig.action,
    fileCount: files.length,
    totalSize,
    oldest: oldest === Infinity ? null : oldest,
    newest: newest === 0 ? null : newest,
    exceededCount,
    exceededSize,
    protectedCount,
    fileDetails
  });
}

// ── Output ──

console.log('Mythos Artifact Status Report');
console.log('============================\n');

if (summaries.length === 0) {
  console.log('No surfaces matched.');
  process.exit(0);
}

for (const s of summaries) {
  const statusIcon = s.exceededCount > 0 ? 'EXCEEDED' : 'OK';
  console.log(`Surface: ${s.surface} [${statusIcon}]`);
  console.log(`  Description: ${s.description}`);
  console.log(`  Retention: ${s.retention} / Action: ${s.action}`);
  console.log(`  Files: ${s.fileCount} / Size: ${formatBytes(s.totalSize)}`);
  if (s.oldest) {
    console.log(`  Oldest: ${formatAge(now - s.oldest)} ago`);
  }
  if (s.newest) {
    console.log(`  Newest: ${formatAge(now - s.newest)} ago`);
  }
  if (s.protectedCount > 0) {
    console.log(`  Protected: ${s.protectedCount} files`);
  }
  if (s.exceededCount > 0) {
    console.log(`  Exceeded retention: ${s.exceededCount} files (${formatBytes(s.exceededSize)})`);
  }

  if (verbose && s.fileDetails.length > 0) {
    console.log('  Files:');
    // Sort by age descending (oldest first)
    const sorted = [...s.fileDetails].sort((a, b) => b.age - a.age);
    for (const f of sorted) {
      const flags = [];
      if (f.protected) flags.push('protected');
      if (f.exceeded) flags.push('exceeded');
      const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
      console.log(`    ${f.path} (${formatBytes(f.size)}, ${formatAge(f.age)} old)${flagStr}`);
    }
  }

  console.log('');
}

// Summary line
const totalFiles = summaries.reduce((acc, s) => acc + s.fileCount, 0);
const totalSize = summaries.reduce((acc, s) => acc + s.totalSize, 0);
const totalExceeded = summaries.reduce((acc, s) => acc + s.exceededCount, 0);

console.log('Summary');
console.log('-------');
console.log(`Surfaces scanned: ${summaries.length}`);
console.log(`Total files: ${totalFiles}`);
console.log(`Total size: ${formatBytes(totalSize)}`);
console.log(`Files exceeding retention: ${totalExceeded}`);

if (anyExceeded) {
  console.log('\nRun `npm run artifacts:cleanup -- --dry-run` to preview cleanup actions.');
}

process.exit(anyExceeded ? 1 : 0);
