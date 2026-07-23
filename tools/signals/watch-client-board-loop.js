#!/usr/bin/env node
'use strict';

/**
 * watch-client-board-loop.js — Hourly intake listener for watched client Dart boards.
 *
 * Architecture:
 *   - Daily: fetches open tasks from Dart and caches locally (--refresh or auto when stale)
 *   - Hourly: reads cached snapshot, classifies using shared triage contract,
 *     compares against stored state, writes artifacts/signals only on material change
 *
 * Read-only: never mutates Dart. No auto-claiming, no auto-planning, no auto-execution.
 *
 * Usage:
 *   node tools/signals/watch-client-board-loop.js [options]
 *
 * Options:
 *   --once                  Run one scan cycle and exit
 *   --refresh               Force-refresh Dart cache even if fresh
 *   --client <code>         Restrict to one client code
 *   --board <name>          Restrict to one board name
 *   --interval-seconds <n>  Override scan interval (default: from config or 3600)
 *   --cache-max-age <hrs>   Max cache age in hours before auto-refresh (default: 24)
 *   --dry-run               Print what would happen without writing artifacts/state
 *   --json                  Output structured JSON summary
 *   --help                  Show this help
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { parseArgs } = require('../workspace/lib/args');
const {
  CLASSIFICATIONS,
  ACTIONABLE_CLASSIFICATIONS,
  BLOCKED_CLASSIFICATIONS,
  detectDeltas,
  buildBoardState,
  fingerprintBoard,
  formatHandoff,
  gatherRepoContext,
  classifyTask,
  detectIntraBoardDuplicates,
  buildTriageArtifact
} = require('./lib/client-board-triage');
const {
  readCache,
  writeCache,
  isFresh,
  cacheAgeMinutes,
  DEFAULT_MAX_AGE_MS
} = require('./lib/dart-board-cache');
const {
  createHandoffSignal
} = require('../verify/lib/signal.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, '_dev/config/client-board-watch.json');
const STATE_PATH = path.join(PROJECT_ROOT, '_dev/state/client-board-watch.state.json');
const SIGNAL_DIR = path.join(PROJECT_ROOT, '_dev/reports/signals');
const ARTIFACT_DIR = path.join(PROJECT_ROOT, '_dev/reports/analysis');

const DEFAULT_INTERVAL_SECONDS = 3600;

// ─── Helpers ───────────────────────────────────────────────────────────────

function help() {
  console.log(`
Hourly intake listener for watched client Dart boards. Read-only — no Dart mutation.

Daily: fetches from Dart and caches locally (auto-refresh when stale, or --refresh).
Hourly: reads cache, classifies, compares state, writes artifacts/signals on change.

Usage:
  node tools/signals/watch-client-board-loop.js [options]

Options:
  --once                  Run one scan cycle and exit
  --refresh               Force-refresh Dart cache even if fresh
  --client <code>         Restrict to one client code
  --board <name>          Restrict to one board name
  --interval-seconds <n>  Override scan interval (default: ${DEFAULT_INTERVAL_SECONDS})
  --cache-max-age <hrs>   Max cache age in hours before auto-refresh (default: 24)
  --dry-run               Print what would happen without writing artifacts/state
  --json                  Output structured JSON summary
  --help                  Show this help
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Watch config not found: ${CONFIG_PATH}`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // v2.0: watch-all mode - discover boards from Dart workspace config cache
  if (config.mode === 'watch-all') {
    const excludeSet = new Set(config.exclude_boards || []);
    const boards = discoverBoards(excludeSet);
    return {
      ...config,
      defaults: { scan_interval_minutes: config.scan_interval_minutes || 60, enabled: true, source: 'dart' },
      boards
    };
  }

  return config;
}

/**
 * Discover boards from Dart workspace config cache and client-routing.json.
 * Falls back to client-routing.json if no workspace cache exists.
 */
function discoverBoards(excludeSet) {
  const boards = [];
  const seen = new Set();

  // Build client lookup from client-routing.json
  const clientLookup = {}; // dartboard_full -> client_code
  const routingPath = path.join(PROJECT_ROOT, 'tools/dart-integration/client-routing.json');
  if (fs.existsSync(routingPath)) {
    const routing = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
    for (const [code, client] of Object.entries(routing.clients || {})) {
      if (client.dartboards) {
        for (const db of Object.values(client.dartboards)) {
          if (db) clientLookup[db] = code;
        }
      }
    }
  }

  // Read Dart workspace config cache (seeded by cron or manual run)
  const dartConfigCache = path.join(PROJECT_ROOT, '_dev/state/dart-workspace-config.json');
  if (fs.existsSync(dartConfigCache)) {
    try {
      const wsConfig = JSON.parse(fs.readFileSync(dartConfigCache, 'utf8'));
      for (const dartboard of (wsConfig.dartboards || [])) {
        if (excludeSet.has(dartboard)) continue;
        if (seen.has(dartboard)) continue;
        seen.add(dartboard);
        const parts = dartboard.split('/');
        const space = parts[0] || '';
        const boardName = parts.slice(1).join('/') || dartboard;
        const clientCode = clientLookup[dartboard] || space.toUpperCase().replace(/[^A-Z0-9]/g, '');
        boards.push({
          client_code: clientCode,
          board_name: boardName,
          scope: '',
          enabled: true,
          scan_interval_minutes: 60
        });
      }
    } catch { /* ignore corrupt cache */ }
  }

  // Fallback: also scan client-routing.json for any boards not yet seen
  for (const [fullPath, code] of Object.entries(clientLookup)) {
    if (excludeSet.has(fullPath)) continue;
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    const parts = fullPath.split('/');
    const boardName = parts.slice(1).join('/') || fullPath;
    boards.push({
      client_code: code,
      board_name: boardName,
      scope: '',
      enabled: true,
      scan_interval_minutes: 60
    });
  }

  return boards;
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { schema: 'ClientBoardWatchState/1.0', boards: {} };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function boardKey(boardEntry) {
  return `${boardEntry.client_code}__${boardEntry.board_name}`.replace(/[^a-zA-Z0-9_]+/g, '-').toLowerCase();
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
}

// ─── Dart board fetching (cache-aware) ─────────────────────────────────────

/**
 * Normalize a raw Dart task into the standard shape.
 */
function normalizeDartTask(task) {
  return {
    id: String(task.id || task.duid || ''),
    title: String(task.title || ''),
    status: String(task.status || task.status_title || ''),
    description: String(task.description || ''),
    assignee: String(task.assignee || task.assignee_name || ''),
    priority: String(task.priority || task.priority_int || ''),
    updated_at: String(task.updated_at || task.updatedAt || '')
  };
}

/**
 * Fetch open tasks for a board. Reads from local cache if fresh,
 * otherwise attempts a Dart CLI refresh, then falls back to triage artifacts.
 *
 * @param {string} key - Board key for cache lookup
 * @param {object} boardEntry - Board config entry
 * @param {object} opts - { forceRefresh, cacheMaxAgeMs }
 * @returns {{ tasks: object[], source: string }}
 */
function fetchBoardTasks(key, boardEntry, opts = {}) {
  const cacheMaxAgeMs = opts.cacheMaxAgeMs || DEFAULT_MAX_AGE_MS;

  // 1. Check cache first (unless force-refresh)
  if (!opts.forceRefresh) {
    const cached = readCache(PROJECT_ROOT, key, { maxAgeMs: cacheMaxAgeMs });
    if (cached && cached.tasks.length > 0) {
      const ageMin = Math.round(cacheAgeMinutes(PROJECT_ROOT, key));
      console.log(`  Cache hit (${ageMin}m old, ${cached.tasks.length} tasks)`);
      return { tasks: cached.tasks.map(normalizeDartTask), source: 'cache' };
    }
  }

  // 2. Try Dart CLI refresh
  try {
    const result = execSync(
      `npx dart-tools list-tasks --dartboard "${boardEntry.board_name}" --is-completed false --limit 100 --no-defaults true`,
      { cwd: PROJECT_ROOT, timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const tasks = parseDartCliOutput(result);
    if (tasks.length > 0) {
      writeCache(PROJECT_ROOT, key, tasks, {
        client_code: boardEntry.client_code,
        board_name: boardEntry.board_name
      });
      console.log(`  Dart refresh: ${tasks.length} tasks cached`);
      return { tasks: tasks.map(normalizeDartTask), source: 'dart_cli' };
    }
  } catch { /* Dart CLI not available */ }

  // 3. Fall back to existing cache (even if stale) or triage artifacts
  const staleCache = readCache(PROJECT_ROOT, key, { maxAgeMs: Infinity });
  if (staleCache && staleCache.tasks.length > 0) {
    const ageMin = Math.round(cacheAgeMinutes(PROJECT_ROOT, key));
    console.log(`  Using stale cache (${ageMin}m old, ${staleCache.tasks.length} tasks)`);
    return { tasks: staleCache.tasks.map(normalizeDartTask), source: 'stale_cache' };
  }

  // 4. Last resort: read from latest triage artifact
  const tasks = fetchFromTriageArtifact(boardEntry);
  if (tasks.length > 0) {
    console.log(`  Loaded ${tasks.length} tasks from prior triage artifact`);
    return { tasks, source: 'triage_artifact' };
  }

  return { tasks: [], source: 'none' };
}

function parseDartCliOutput(output) {
  try {
    const data = JSON.parse(output);
    if (Array.isArray(data)) return data;
    if (data.results && Array.isArray(data.results)) return data.results;
    return [];
  } catch {
    return [];
  }
}

function fetchFromTriageArtifact(boardEntry) {
  const clientLower = boardEntry.client_code.toLowerCase();
  const boardKeyLower = boardKey(boardEntry);
  // Check both triage and watch artifacts
  const prefixes = [
    `client-board-triage__${clientLower}__`,
    `client-board-watch__${boardKeyLower}__`
  ];
  try {
    const files = fs.readdirSync(ARTIFACT_DIR)
      .filter((f) => prefixes.some((p) => f.startsWith(p)) && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) return [];
    const data = JSON.parse(fs.readFileSync(path.join(ARTIFACT_DIR, files[0]), 'utf8'));
    return (data.items || data.tasks || []).map(normalizeDartTask);
  } catch {
    return [];
  }
}

// ─── Artifact writing ──────────────────────────────────────────────────────

function writeTriageArtifacts(boardEntry, classifiedItems, deltas, duplicates, ts) {
  const key = boardKey(boardEntry);
  const mdPath = path.join(ARTIFACT_DIR, `client-board-watch__${key}__${ts}.md`);
  const jsonPath = path.join(ARTIFACT_DIR, `client-board-watch__${key}__${ts}.json`);

  // Build standardized JSON artifact via shared lib
  const jsonReport = buildTriageArtifact({
    source: 'watcher',
    client_code: boardEntry.client_code,
    board_name: boardEntry.board_name,
    scope: boardEntry.scope || '',
    items: classifiedItems,
    deltas,
    duplicates
  });
  jsonReport.artifact_paths = {
    markdown: path.relative(PROJECT_ROOT, mdPath),
    json: path.relative(PROJECT_ROOT, jsonPath)
  };

  // Markdown report
  const mdLines = [
    `# Client Board Watch: ${boardEntry.client_code} / ${boardEntry.board_name}`,
    ``,
    `**Scan time:** ${jsonReport.timestamp}`,
    `**Items scanned:** ${classifiedItems.length}`,
    `**Material change:** ${deltas.materialChange ? 'YES' : 'No'}`,
    `**Delta summary:** ${deltas.summary}`,
    ``
  ];

  if (deltas.newItems.length > 0) {
    mdLines.push(`## New Items (${deltas.newItems.length})`);
    for (const item of deltas.newItems) {
      mdLines.push(`- **${item.title}** → \`${item.classification}\``);
    }
    mdLines.push('');
  }

  if (deltas.reclassified.length > 0) {
    mdLines.push(`## Reclassified (${deltas.reclassified.length})`);
    for (const item of deltas.reclassified) {
      mdLines.push(`- **${item.title}** → \`${item.classification}\``);
    }
    mdLines.push('');
  }

  if (deltas.newActionable.length > 0) {
    mdLines.push(`## Newly Actionable (${deltas.newActionable.length})`);
    for (const item of deltas.newActionable) {
      mdLines.push(`- **${item.title}** → \`${item.classification}\` → \`/claim-intake ${boardEntry.client_code} --item ${item.id}\``);
    }
    mdLines.push('');
  }

  if (deltas.newBlocked.length > 0) {
    mdLines.push(`## Newly Blocked (${deltas.newBlocked.length})`);
    for (const item of deltas.newBlocked) {
      mdLines.push(`- **${item.title}** → \`${item.classification}\``);
    }
    mdLines.push('');
  }

  if (duplicates.length > 0) {
    mdLines.push(`## Potential Duplicates (${duplicates.length})`);
    for (const d of duplicates) {
      mdLines.push(`- **${d.a.title}** ↔ **${d.b.title}** (${Math.round(d.score * 100)}% overlap)`);
    }
    mdLines.push('');
  }

  mdLines.push('## All Items');
  mdLines.push('');
  mdLines.push('| Title | Classification | Overlap | Match Source |');
  mdLines.push('|-------|---------------|---------|-------------|');
  for (const item of classifiedItems) {
    mdLines.push(`| ${item.title} | ${item.classification} | ${item.overlap || '—'} | ${item.match_source || '—'} |`);
  }
  mdLines.push('');

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(mdPath, mdLines.join('\n'));
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  return { mdPath, jsonPath, jsonReport };
}

// ─── Signal emission ───────────────────────────────────────────────────────

function emitIntakeSignal(boardEntry, deltas, artifactPaths) {
  const key = boardKey(boardEntry);
  const signalPath = path.join(SIGNAL_DIR, `client-board-intake__${key}.signal.json`);

  // Check if existing signal has the same fingerprint — skip if unchanged
  if (fs.existsSync(signalPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
      if (existing.lifecycle_state === 'live' && existing.delta_summary === deltas.summary) {
        return null; // fingerprint unchanged, don't re-emit
      }
    } catch { /* overwrite corrupted signal */ }
  }

  const actionableIds = deltas.newActionable.map((i) => i.id);
  const signal = createHandoffSignal(
    'client-board-watch',
    `client-intake:${boardEntry.client_code}:${boardEntry.board_name}`,
    'ready-for-review',
    {
      artifacts: [
        artifactPaths.markdown,
        artifactPaths.json
      ],
      recommended_next_actor: 'operator',
      recommended_next_command: `/triage-client-board ${boardEntry.client_code} --board "${boardEntry.board_name}"`,
      next_step_detail: [
        `Review the intake deltas for ${boardEntry.client_code} / ${boardEntry.board_name}`,
        `${deltas.newActionable.length} newly actionable items detected`,
        `Run /triage-client-board for full LLM-assisted classification`
      ],
      signal_scope: `client-board-intake:${key}`
    }
  );

  // Attach extra fields for intake-specific context
  signal.client_code = boardEntry.client_code;
  signal.board_name = boardEntry.board_name;
  signal.changed_item_ids = actionableIds;
  signal.delta_summary = deltas.summary;

  fs.mkdirSync(SIGNAL_DIR, { recursive: true });
  fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));
  return signalPath;
}

// ─── Main scan logic ───────────────────────────────────────────────────────

async function scanBoard(boardEntry, state, opts = {}) {
  const key = boardKey(boardEntry);
  const ts = timestamp();
  const previousBoardState = state.boards[key] || { tasks: {}, fingerprint: '' };

  console.log(`[${new Date().toISOString()}] Scanning: ${boardEntry.client_code} / ${boardEntry.board_name}`);

  // 1. Fetch current board tasks (cache-aware)
  const { tasks: rawTasks, source } = fetchBoardTasks(key, boardEntry, {
    forceRefresh: opts.forceRefresh,
    cacheMaxAgeMs: opts.cacheMaxAgeMs
  });
  if (rawTasks.length === 0) {
    console.log(`  No open tasks found (source: ${source}). Skipping.`);
    return { key, materialChange: false, itemCount: 0, source };
  }

  // 2. Gather repo context for overlap detection (shared lib)
  const repoContext = gatherRepoContext(PROJECT_ROOT, boardEntry.client_code);

  // 3. Classify each task (shared lib — repo-aware)
  const classifiedItems = rawTasks.map((task) => classifyTask(task, repoContext));

  // 4. Detect deltas against stored state
  const deltas = detectDeltas(previousBoardState, classifiedItems);

  // 5. Check board-level fingerprint
  const currentFingerprint = fingerprintBoard(classifiedItems);
  if (currentFingerprint === previousBoardState.fingerprint && !deltas.materialChange) {
    console.log(`  No changes (fingerprint match). Skipping artifacts.`);
    // Still update last_scan timestamp
    state.boards[key] = {
      ...previousBoardState,
      last_scan: new Date().toISOString()
    };
    return { key, materialChange: false, itemCount: classifiedItems.length };
  }

  // 5b. Detect intra-board duplicates
  const duplicates = detectIntraBoardDuplicates(classifiedItems);
  if (duplicates.length > 0) {
    console.log(`  Potential duplicates: ${duplicates.length} pair(s)`);
  }

  if (opts.dryRun) {
    console.log(`  [dry-run] Would write artifacts. Delta: ${deltas.summary}`);
    return { key, materialChange: deltas.materialChange, itemCount: classifiedItems.length, deltas };
  }

  // 6. Write artifacts
  const relMd = `_dev/reports/analysis/client-board-watch__${key}__${ts}.md`;
  const relJson = `_dev/reports/analysis/client-board-watch__${key}__${ts}.json`;
  const { mdPath, jsonPath } = writeTriageArtifacts(boardEntry, classifiedItems, deltas, duplicates, ts);
  console.log(`  Artifacts: ${path.relative(PROJECT_ROOT, mdPath)}`);

  // 7. Update state
  state.boards[key] = buildBoardState(classifiedItems);

  // 8. Emit signal only if material change
  let signalPath = null;
  if (deltas.materialChange) {
    signalPath = emitIntakeSignal(boardEntry, deltas, {
      markdown: path.relative(PROJECT_ROOT, mdPath),
      json: path.relative(PROJECT_ROOT, jsonPath)
    });
    if (signalPath) {
      console.log(`  Signal: ${path.relative(PROJECT_ROOT, signalPath)}`);
    } else {
      console.log(`  Signal: skipped (unchanged fingerprint)`);
    }
  }

  return {
    key,
    materialChange: deltas.materialChange,
    itemCount: classifiedItems.length,
    deltas,
    artifactPaths: { md: relMd, json: relJson },
    signalPath: signalPath ? path.relative(PROJECT_ROOT, signalPath) : null
  };
}

// ─── Entry point ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const once = Boolean(args.once);
  const forceRefresh = Boolean(args.refresh);
  const dryRun = Boolean(args.dry_run);
  const jsonOutput = Boolean(args.json);
  const clientFilter = String(args.client || '').trim().toUpperCase();
  const boardFilter = String(args.board || '').trim();
  const intervalOverride = args.interval_seconds ? Number(args.interval_seconds) : null;
  const cacheMaxAgeHrs = args.cache_max_age ? Number(args.cache_max_age) : 24;
  const cacheMaxAgeMs = cacheMaxAgeHrs * 60 * 60 * 1000;

  if (intervalOverride != null && (!Number.isFinite(intervalOverride) || intervalOverride <= 0)) {
    console.error('ERROR: --interval-seconds must be a positive number');
    process.exit(1);
  }

  do {
    const config = loadConfig();
    const state = loadState();

    const boards = config.boards.filter((b) => {
      if (!b.enabled) return false;
      if (clientFilter && b.client_code.toUpperCase() !== clientFilter) return false;
      if (boardFilter && b.board_name !== boardFilter) return false;
      return true;
    });

    if (boards.length === 0) {
      console.log(`[${new Date().toISOString()}] No enabled boards match filters.`);
    }

    const results = [];
    for (const board of boards) {
      // Check interval: skip if scanned too recently
      const key = boardKey(board);
      const prevState = state.boards[key];
      const defaultInterval = (config.defaults && config.defaults.scan_interval_minutes) || config.scan_interval_minutes || 60;
      const intervalMs = ((intervalOverride || board.scan_interval_minutes || defaultInterval) * 60) * 1000;

      if (prevState && prevState.last_scan && !once) {
        const elapsed = Date.now() - new Date(prevState.last_scan).getTime();
        if (elapsed < intervalMs) {
          console.log(`[${new Date().toISOString()}] Skipping ${board.client_code}/${board.board_name}: scanned ${Math.round(elapsed / 60000)}m ago (interval: ${Math.round(intervalMs / 60000)}m)`);
          continue;
        }
      }

      const result = await scanBoard(board, state, { dryRun, forceRefresh, cacheMaxAgeMs });
      results.push(result);
    }

    // Persist state
    if (!dryRun && results.length > 0) {
      saveState(state);
    }

    if (jsonOutput) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        boards_scanned: results.length,
        material_changes: results.filter((r) => r.materialChange).length,
        results
      }, null, 2));
    }

    if (once) break;

    // Sleep until next cycle — use minimum configured interval
    const defaultInterval = (config.defaults && config.defaults.scan_interval_minutes) || config.scan_interval_minutes || 60;
    const sleepMs = (intervalOverride || defaultInterval) * 60 * 1000;
    console.log(`[${new Date().toISOString()}] Next scan in ${Math.round(sleepMs / 60000)} minutes.`);
    await sleep(sleepMs);

  } while (true);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
