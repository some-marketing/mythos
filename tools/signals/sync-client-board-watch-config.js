#!/usr/bin/env node
'use strict';

/**
 * sync-client-board-watch-config.js - Generate watch config from client registry.
 *
 * Reads each clients/{code}/client.json, extracts Dart board mappings, and
 * merges them into _dev/config/client-board-watch.json. Preserves manual
 * overrides (scope, scan_interval_minutes, enabled) for boards that already exist.
 *
 * Read-only with respect to Dart. Only reads local repo files.
 *
 * Usage:
 *   node tools/signals/sync-client-board-watch-config.js [options]
 *
 * Options:
 *   --dry-run    Preview changes without writing
 *   --json       Output structured JSON diff
 *   --help       Show this help
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../workspace/lib/args');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLIENTS_DIR = path.join(PROJECT_ROOT, 'clients');
const CONFIG_PATH = path.join(PROJECT_ROOT, '_dev/config/client-board-watch.json');

// Clients to skip (templates, not real clients)
const SKIP_DIRS = new Set(['_template']);

// ─── Board extraction ─────────────────────────────────────────────────────

/**
 * Extract Dart board entries from a client.json.
 * Handles both single-board and multi-board schemas.
 *
 * @param {string} clientCode
 * @param {object} clientJson
 * @returns {Array<{ client_code, board_name, scope }>}
 */
function extractBoards(clientCode, clientJson) {
  const dart = clientJson.dart;
  if (!dart) return [];

  const boards = [];

  // Multi-board schema: dart.dartboards[]
  if (Array.isArray(dart.dartboards)) {
    for (const db of dart.dartboards) {
      if (!db.name) continue;
      boards.push({
        client_code: clientCode,
        board_name: db.name,
        scope: db.scope || ''
      });
    }
    return boards;
  }

  // Single-board schema: dart.dartboard
  if (dart.dartboard) {
    boards.push({
      client_code: clientCode,
      board_name: dart.dartboard,
      scope: ''
    });
  }

  return boards;
}

/**
 * Build a stable key for matching existing config entries.
 */
function boardKey(entry) {
  return `${entry.client_code}::${entry.board_name}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help || args.h) {
    console.log(`
Sync client-board-watch.json from clients/*/client.json Dart mappings.

Usage:
  node tools/signals/sync-client-board-watch-config.js [options]

Options:
  --dry-run    Preview changes without writing
  --json       Output structured JSON diff
  --help       Show this help
`.trim());
    process.exit(0);
  }

  const dryRun = Boolean(args.dry_run);
  const jsonOutput = Boolean(args.json);

  // 1. Read existing config
  let existingConfig = {
    schema: 'ClientBoardWatch/1.0',
    description: 'Watched client Dart boards for hourly intake triage. Read-only — no Dart mutation.',
    defaults: { scan_interval_minutes: 60, enabled: true, source: 'dart' },
    boards: []
  };

  if (fs.existsSync(CONFIG_PATH)) {
    existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  // Index existing boards for override preservation
  const existingByKey = new Map();
  for (const board of existingConfig.boards) {
    existingByKey.set(boardKey(board), board);
  }

  // 2. Scan client registry
  const discovered = [];
  const skipped = [];
  const clientDirs = fs.readdirSync(CLIENTS_DIR).filter((d) => {
    if (SKIP_DIRS.has(d)) return false;
    if (d.startsWith('.')) return false; // skip hidden dirs
    const stat = fs.statSync(path.join(CLIENTS_DIR, d));
    return stat.isDirectory();
  });

  for (const dir of clientDirs) {
    const clientJsonPath = path.join(CLIENTS_DIR, dir, 'client.json');
    if (!fs.existsSync(clientJsonPath)) {
      skipped.push({ client: dir, reason: 'no client.json' });
      continue;
    }

    let clientJson;
    try {
      clientJson = JSON.parse(fs.readFileSync(clientJsonPath, 'utf8'));
    } catch (err) {
      skipped.push({ client: dir, reason: `parse error: ${err.message}` });
      continue;
    }

    const code = clientJson.code || dir;
    const boards = extractBoards(code, clientJson);

    if (boards.length === 0) {
      skipped.push({ client: code, reason: 'no Dart boards configured' });
      continue;
    }

    discovered.push(...boards);
  }

  // 3. Merge: discovered boards + existing overrides
  const mergedBoards = [];
  const added = [];
  const preserved = [];

  for (const disc of discovered) {
    const key = boardKey(disc);
    const existing = existingByKey.get(key);

    if (existing) {
      // Preserve manual overrides
      preserved.push(key);
      mergedBoards.push({
        client_code: disc.client_code,
        board_name: disc.board_name,
        scope: existing.scope || disc.scope,
        enabled: existing.enabled !== undefined ? existing.enabled : true,
        scan_interval_minutes: existing.scan_interval_minutes || 60
      });
      existingByKey.delete(key);
    } else {
      // New board from registry
      added.push(key);
      mergedBoards.push({
        client_code: disc.client_code,
        board_name: disc.board_name,
        scope: disc.scope,
        enabled: true,
        scan_interval_minutes: 60
      });
    }
  }

  // Boards in existing config but NOT in client registry (manual additions)
  const manualRetained = [];
  for (const [key, board] of existingByKey) {
    manualRetained.push(key);
    mergedBoards.push(board);
  }

  // Sort by client_code then board_name for stable output
  mergedBoards.sort((a, b) =>
    a.client_code.localeCompare(b.client_code) || a.board_name.localeCompare(b.board_name)
  );

  // 4. Build result
  const newConfig = {
    ...existingConfig,
    boards: mergedBoards,
    _sync: {
      last_synced: new Date().toISOString(),
      source: 'clients/*/client.json',
      boards_discovered: discovered.length,
      boards_added: added.length,
      boards_preserved: preserved.length,
      manual_retained: manualRetained.length,
      clients_skipped: skipped.length
    }
  };

  const diff = {
    timestamp: new Date().toISOString(),
    dry_run: dryRun,
    added,
    preserved,
    manual_retained: manualRetained,
    skipped,
    total_boards: mergedBoards.length,
    config_path: CONFIG_PATH
  };

  // 5. Output
  if (jsonOutput) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    console.log('Client Board Watch Config Sync');
    console.log('==============================');
    console.log(`Source: clients/*/client.json`);
    console.log(`Target: ${path.relative(PROJECT_ROOT, CONFIG_PATH)}`);
    console.log('');

    if (added.length > 0) {
      console.log(`Added (${added.length}):`);
      for (const key of added) console.log(`  + ${key}`);
      console.log('');
    }

    if (preserved.length > 0) {
      console.log(`Preserved (${preserved.length}):`);
      for (const key of preserved) console.log(`  = ${key}`);
      console.log('');
    }

    if (manualRetained.length > 0) {
      console.log(`Manual (not in registry, kept) (${manualRetained.length}):`);
      for (const key of manualRetained) console.log(`  ~ ${key}`);
      console.log('');
    }

    if (skipped.length > 0) {
      console.log(`Skipped clients (${skipped.length}):`);
      for (const s of skipped) console.log(`  - ${s.client}: ${s.reason}`);
      console.log('');
    }

    console.log(`Total boards: ${mergedBoards.length}`);
  }

  // 6. Write (unless dry-run)
  if (!dryRun) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2) + '\n');
    console.log(`\nWritten: ${path.relative(PROJECT_ROOT, CONFIG_PATH)}`);
  } else {
    console.log('\n[dry-run] No files written. Remove --dry-run to apply.');
    if (!jsonOutput) {
      console.log('\nResulting config would be:');
      console.log(JSON.stringify(newConfig, null, 2));
    }
  }
}

main();
