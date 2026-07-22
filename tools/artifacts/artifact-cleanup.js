#!/usr/bin/env node
'use strict';

/**
 * artifact-cleanup.js — Policy-driven cleanup of Mythos artifacts.
 *
 * Reads retention-policy.json and applies cleanup rules:
 * - Finds files exceeding their retention period (single-tier) or generational
 *   tier thresholds (hot -> archive -> delete)
 * - Assigns each file to the MOST SPECIFIC matching surface (deepest path key)
 *   so a child surface's tighter policy overrides a broad parent policy
 * - Respects protected patterns (never deletes learning evidence, originals, manifests)
 * - Respects preserve_latest (keeps the most recent file per surface)
 * - Supports dry-run (default), --execute, and --force modes
 *
 * Safety / autonomy contract (grounding A3, A5):
 *   This tool DEFAULTS TO DRY-RUN. Mutation happens only under --execute.
 *   Promotion of any surface to unattended --execute scheduling requires a
 *   recorded observation window (a bounded run of dry-run cycles captured as a
 *   durable artifact) before it is trusted to run unattended — dry-run output
 *   is the observation substrate for that promotion decision.
 *
 * Non-interactive safety (F5/F7): in a non-TTY context (scheduled/CI), the tool
 *   never blocks on a readline prompt. Non-TTY --execute without --force is
 *   downgraded to a report-only run (exit 0); pass --force to actually mutate
 *   under automation.
 *
 * Glob resolution and protected-pattern matching use node:fs glob (verified
 * stdlib on Node >= 22), replacing the prior hand-rolled glob->regex transpiler
 * that F7 flagged as an accidental-deletion risk.
 *
 * Every --execute run appends a lane-health receipt to
 *   _dev/reports/lifecycle/hygiene-lane-health.jsonl  (grounding A2).
 *
 * Usage:
 *   node tools/artifacts/artifact-cleanup.js [--dry-run] [--execute] [--force] [--surface <name>] [--verbose]
 *
 * --dry-run   (default) Preview what would be cleaned up
 * --execute   Actually perform cleanup
 * --force     Skip confirmation prompt (for CI/automation)
 * --surface   Filter to a specific surface key
 * --verbose   Show per-file details
 *
 * Exit code 0 = success, 1 = error
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseArgs } = require('../workspace/lib/args');
// MDS tools-port: hygiene-lane-health.cjs is private repo-hygiene telemetry
// machinery, not shipped — matching the same optional-require pattern
// export-public.cjs itself uses for the identical module (appendReceipt=null,
// lane-health receipts become a no-op rather than a crash).
let appendReceipt = null;
try { ({ appendReceipt } = require('../maintenance/lib/hygiene-lane-health.cjs')); } catch { /* lane-health optional */ }

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function help() {
  console.log(`
Policy-driven cleanup of Mythos artifacts.

Usage:
  node tools/artifacts/artifact-cleanup.js [options]

Options:
  --dry-run    (default) Preview what would be cleaned up
  --execute    Actually perform cleanup (delete or archive)
  --force      Skip confirmation prompt (for CI/automation)
  --surface    Filter to a specific surface key
  --verbose    Show per-file details
  --help       Show this help

Actions:
  delete   - Remove files that exceed retention
  archive  - Move files to _dev/archive/{year}-{month}/{surface}/

Protected files (matching patterns in retention-policy.json) are never deleted.
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

// Resolve a surface key to its absolute file paths using node:fs glob.
// node:fs glob (Node >= 22) excludes dotfiles by default, matching the prior
// walker's behavior of skipping any entry whose name starts with '.'.
// Directories are filtered out; only regular files are returned.
function globFiles(pattern, root = PROJECT_ROOT) {
  const out = [];
  let matches;
  try {
    matches = fs.globSync(pattern, { cwd: root, withFileTypes: true });
  } catch {
    return out;
  }
  for (const dirent of matches) {
    if (!dirent.isFile()) continue;
    // Dirent from globSync carries parentPath; build the absolute path.
    const base = dirent.parentPath || dirent.path || root;
    out.push(path.resolve(base, dirent.name));
  }
  return out;
}

function resolveSurfaceFiles(surfaceKey, root = PROJECT_ROOT) {
  const seen = new Set();
  const patterns = [];

  if (surfaceKey.includes('*')) {
    // Glob key: match the leaf itself (file leaves like *.json) AND any files
    // nested under a matched directory (dir leaves like end-session-closeout__*).
    patterns.push(surfaceKey, `${surfaceKey}/**/*`);
  } else {
    const abs = path.join(root, surfaceKey);
    let stat = null;
    try { stat = fs.statSync(abs); } catch { stat = null; }
    if (!stat) return [];
    if (stat.isDirectory()) patterns.push(`${surfaceKey}/**/*`);
    else if (stat.isFile()) return [abs];
    else return [];
  }

  for (const pattern of patterns) {
    for (const filePath of globFiles(pattern, root)) {
      seen.add(filePath);
    }
  }
  return Array.from(seen);
}

// Specificity of a surface key: deeper path wins, then longer string wins.
// Used to assign each file to exactly one owning surface so a child surface's
// tighter generational policy overrides a broad parent policy.
function surfaceSpecificity(surfaceKey) {
  return { depth: surfaceKey.split('/').length, len: surfaceKey.length };
}

function moreSpecific(a, b) {
  const sa = surfaceSpecificity(a);
  const sb = surfaceSpecificity(b);
  if (sa.depth !== sb.depth) return sa.depth > sb.depth;
  return sa.len > sb.len;
}

function getFileStat(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

// Expand every protected pattern into a concrete set of absolute file paths
// using node:fs glob, once, up front. Membership testing against that set is
// exactly equivalent to per-file pattern matching for files that exist (the
// only files cleanup ever considers) and eliminates the hand-rolled
// glob->regex transpiler that F7 flagged as an accidental-deletion risk.
function buildProtectedSet(protectedPatterns, root = PROJECT_ROOT) {
  const set = new Set();
  for (const pattern of protectedPatterns) {
    for (const filePath of globFiles(pattern, root)) {
      set.add(filePath);
    }
  }
  return set;
}

// Resolve the governing action for a file given a surface config.
// Generational (tiers[]): the tier with the largest `after` that is <= age
// governs; files younger than the smallest `after` are hot (kept -> null).
// Single-tier (retention + action): kept until age exceeds retention.
// Returns an action string ('archive'|'delete') or null when the file is kept.
function resolveActionForAge(surfaceConfig, ageMs) {
  if (Array.isArray(surfaceConfig.tiers) && surfaceConfig.tiers.length > 0) {
    let chosen = null;
    let chosenAfter = -1;
    for (const tier of surfaceConfig.tiers) {
      const afterMs = parseDuration(tier.after);
      if (afterMs === null) continue;
      if (ageMs > afterMs && afterMs > chosenAfter) {
        chosen = tier.action || 'delete';
        chosenAfter = afterMs;
      }
    }
    return chosen;
  }
  const retentionMs = parseDuration(surfaceConfig.retention);
  if (retentionMs === null) return null;
  if (ageMs <= retentionMs) return null;
  return surfaceConfig.action || 'delete';
}

function archivePath(filePath, surfaceKey) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const surfaceSlug = surfaceKey.replace(/[/*]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const rel = path.relative(PROJECT_ROOT, filePath);
  return path.join(PROJECT_ROOT, '_dev', 'archive', `${year}-${month}`, surfaceSlug, path.basename(rel));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

// ── Main ──

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const executeMode = Boolean(args.execute);
  const forceMode = Boolean(args.force);
  const verbose = Boolean(args.verbose);
  const surfaceFilter = args.surface || null;
  const dryRun = !executeMode;

  const policy = loadPolicy();
  const now = Date.now();

  const plan = []; // { filePath, surfaceKey, action, age, size }

  const surfaceKeys = Object.keys(policy.surfaces)
    .filter((k) => !surfaceFilter || k === surfaceFilter);

  // Assign each file to exactly one owning surface: the most specific key that
  // resolves it. This lets a child surface's tighter generational policy govern
  // files that a broad parent surface would otherwise also sweep.
  const owner = new Map(); // absFilePath -> surfaceKey
  for (const surfaceKey of surfaceKeys) {
    for (const filePath of resolveSurfaceFiles(surfaceKey)) {
      const current = owner.get(filePath);
      if (!current || moreSpecific(surfaceKey, current)) {
        owner.set(filePath, surfaceKey);
      }
    }
  }

  // Regroup owned files by surface.
  const filesBySurface = new Map();
  for (const [filePath, surfaceKey] of owner) {
    if (!filesBySurface.has(surfaceKey)) filesBySurface.set(surfaceKey, []);
    filesBySurface.get(surfaceKey).push(filePath);
  }

  const protectedSet = buildProtectedSet(policy.protected || []);

  for (const surfaceKey of surfaceKeys) {
    const surfaceConfig = policy.surfaces[surfaceKey];
    const files = filesBySurface.get(surfaceKey) || [];

    // Build file info list with stats
    const fileInfos = [];
    for (const filePath of files) {
      const stat = getFileStat(filePath);
      if (!stat) continue;
      fileInfos.push({ filePath, ...stat, age: now - stat.mtime });
    }

    // Sort by mtime descending (newest first) for preserve_latest
    fileInfos.sort((a, b) => b.mtime - a.mtime);

    for (let i = 0; i < fileInfos.length; i++) {
      const info = fileInfos[i];

      // Skip the newest file if preserve_latest is set
      if (surfaceConfig.preserve_latest && i === 0) continue;

      // Determine the governing action (single-tier or generational tiers).
      const action = resolveActionForAge(surfaceConfig, info.age);
      if (!action) continue; // file is still hot / within retention

      // Skip protected files
      if (protectedSet.has(info.filePath)) continue;

      plan.push({
        filePath: info.filePath,
        relPath: path.relative(PROJECT_ROOT, info.filePath),
        surfaceKey,
        action,
        age: info.age,
        size: info.size
      });
    }
  }

  // ── Report ──

  if (dryRun) {
    console.log('Mythos Artifact Cleanup — DRY RUN');
    console.log('=================================\n');
  } else {
    console.log('Mythos Artifact Cleanup — EXECUTE MODE');
    console.log('======================================\n');
  }

  if (plan.length === 0) {
    console.log('Nothing to clean up. All artifacts are within retention policy.');
    process.exit(0);
  }

  // Group by surface
  const grouped = {};
  for (const item of plan) {
    if (!grouped[item.surfaceKey]) grouped[item.surfaceKey] = [];
    grouped[item.surfaceKey].push(item);
  }

  let totalFiles = 0;
  let totalSize = 0;

  for (const [surface, items] of Object.entries(grouped)) {
    const surfaceSize = items.reduce((acc, i) => acc + i.size, 0);
    totalFiles += items.length;
    totalSize += surfaceSize;

    const action = items[0].action;
    console.log(`Surface: ${surface}`);
    console.log(`  Action: ${action}`);
    console.log(`  Files to ${action}: ${items.length} (${formatBytes(surfaceSize)})`);

    if (verbose) {
      for (const item of items) {
        console.log(`    ${item.relPath} (${formatBytes(item.size)}, ${formatAge(item.age)} old)`);
      }
    }
    console.log('');
  }

  console.log(`Total: ${totalFiles} files, ${formatBytes(totalSize)}`);
  console.log('');

  if (dryRun) {
    console.log('This was a dry run. Use --execute to perform cleanup.');
    process.exit(0);
  }

  // ── Confirmation ──
  //
  // Non-TTY safety (F5/F7): a scheduled/CI run has no interactive stdin. Never
  // block on readline there. Without --force, a non-TTY execute run is
  // downgraded to report-only so the scheduler can observe intended actions
  // without an unattended mutation and without hanging.

  const interactive = Boolean(process.stdin.isTTY);

  if (!forceMode) {
    if (!interactive) {
      console.log('Non-interactive context detected (no TTY) and --force not set.');
      console.log('Report-only: no files were modified. Pass --force to mutate under automation.');
      writeLaneHealthReceipt({
        decision: 'report-only',
        target: 'artifact-cleanup-plan',
        verification: { reason: 'non-tty-no-force', planned_files: totalFiles, planned_bytes: totalSize },
        outcome: 'noop'
      });
      process.exit(0);
    }
    const proceed = await confirm(`Proceed with cleanup of ${totalFiles} files? (y/N) `);
    if (!proceed) {
      console.log('Aborted.');
      writeLaneHealthReceipt({
        decision: 'aborted',
        target: 'artifact-cleanup-plan',
        verification: { reason: 'operator-declined', planned_files: totalFiles, planned_bytes: totalSize },
        outcome: 'noop'
      });
      process.exit(0);
    }
  }

  // ── Execute ──

  let deletedCount = 0;
  let archivedCount = 0;
  let errorCount = 0;

  for (const item of plan) {
    try {
      if (item.action === 'archive') {
        const dest = archivePath(item.filePath, item.surfaceKey);
        ensureDir(path.dirname(dest));
        fs.renameSync(item.filePath, dest);
        archivedCount++;
        if (verbose) console.log(`  archived: ${item.relPath} -> ${path.relative(PROJECT_ROOT, dest)}`);
      } else {
        // delete
        fs.unlinkSync(item.filePath);
        deletedCount++;
        if (verbose) console.log(`  deleted: ${item.relPath}`);
      }
    } catch (err) {
      errorCount++;
      console.error(`  FAILED: ${item.relPath}: ${err.message}`);
    }
  }

  console.log('\nCleanup complete.');
  if (deletedCount > 0) console.log(`  Deleted: ${deletedCount} files`);
  if (archivedCount > 0) console.log(`  Archived: ${archivedCount} files`);
  if (errorCount > 0) console.log(`  Errors: ${errorCount}`);

  // Log the cleanup event
  logCleanupEvent({ deletedCount, archivedCount, errorCount, totalSize });

  // Lane-health receipt for the applied action (grounding A2).
  writeLaneHealthReceipt({
    decision: 'applied',
    target: 'artifact-cleanup',
    verification: {
      reason: forceMode ? 'forced' : 'operator-confirmed',
      deleted: deletedCount,
      archived: archivedCount,
      errors: errorCount,
      bytes_freed: totalSize
    },
    outcome: errorCount > 0 ? 'partial' : 'success'
  });

  process.exit(errorCount > 0 ? 1 : 0);
}

// A2 lane-health receipt: one durable line per apply-mode decision. Delegates to
// the shared canonical writer so every hygiene lane emits the identical schema
// (schema/timestamp/tool/decision/verification/outcome, optional target).
function writeLaneHealthReceipt(fields, opts) {
  if (!appendReceipt) return null; // lane-health machinery not shipped; receipts are a no-op
  return appendReceipt({ tool: 'artifact-cleanup', ...fields }, opts);
}

function logCleanupEvent(stats) {
  const logDir = path.join(PROJECT_ROOT, '_dev', 'logs');
  const logPath = path.join(logDir, 'lifecycle.jsonl');

  try {
    ensureDir(logDir);
    const entry = {
      ts: new Date().toISOString(),
      event: 'artifact.cleanup',
      deleted: stats.deletedCount,
      archived: stats.archivedCount,
      errors: stats.errorCount,
      bytes_freed: stats.totalSize
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Non-fatal: logging failure should not break cleanup
  }
}

if (require.main === module) {
  main().catch((err) => {
    die(err.message);
  });
}

module.exports = {
  globFiles,
  resolveSurfaceFiles,
  surfaceSpecificity,
  moreSpecific,
  buildProtectedSet,
  resolveActionForAge,
  parseDuration,
  writeLaneHealthReceipt
};
