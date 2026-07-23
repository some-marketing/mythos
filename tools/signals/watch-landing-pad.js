#!/usr/bin/env node
'use strict';

/**
 * watch-landing-pad.js -- Hourly dry-run listener for the Landing Pad/Tasks fallback board.
 *
 * Architecture:
 *   - Daily: fetches open tasks from Dart and caches locally (--refresh or auto when stale)
 *   - Hourly: reads cached snapshot, classifies using the landing-pad classifier,
 *     writes artifacts/signals only on material change
 *
 * Phase 1: ALWAYS dry-run. Never mutates Dart regardless of flags.
 *
 * Usage:
 *   node tools/signals/watch-landing-pad.js [options]
 *
 * Options:
 *   --once          Run one scan cycle and exit
 *   --refresh       Force-refresh Dart cache even if fresh
 *   --dry-run       Explicit dry-run flag (always true in Phase 1)
 *   --json          Output structured JSON summary
 *   --help          Show this help
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { parseArgs } = require('../workspace/lib/args');
const {
  loadRoutingTable,
  classifyLandingPadTask,
  buildRoutingArtifact
} = require('./lib/landing-pad-classifier');
const {
  normalizeTaskContent
} = require('./lib/task-content-normalizer');
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
const CONFIG_PATH = path.join(PROJECT_ROOT, '_dev/config/landing-pad-sorter.json');
const STATE_PATH = path.join(PROJECT_ROOT, '_dev/state/landing-pad-sorter.state.json');
const SIGNAL_DIR = path.join(PROJECT_ROOT, '_dev/reports/signals');
const ARTIFACT_DIR = path.join(PROJECT_ROOT, '_dev/reports/analysis');

const BOARD_KEY = 'landing-pad__tasks';
const BOARD_NAME = 'Landing Pad/Tasks';

const DEFAULT_INTERVAL_SECONDS = 3600;

// ---- Helpers ---------------------------------------------------------------

function help() {
  console.log(`
Landing-pad sorter: classifies General/Tasks fallback-board items and suggests routing.
Phase 1 is ALWAYS dry-run -- no Dart mutations.

Daily: fetches from Dart and caches locally (auto-refresh when stale, or --refresh).
Hourly: reads cache, classifies, writes artifacts/signals on material change.

Usage:
  node tools/signals/watch-landing-pad.js [options]

Options:
  --once          Run one scan cycle and exit
  --refresh       Force-refresh Dart cache even if fresh
  --dry-run       Explicit dry-run flag (always true in Phase 1)
  --json          Output structured JSON summary
  --help          Show this help
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Landing-pad config not found: ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { schema: 'LandingPadSorterState/1.0', last_scan: null, task_fingerprints: {} };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---- Dart task normalization -----------------------------------------------

/**
 * Normalize a raw Dart task into the standard shape.
 *
 * @param {object} task
 * @returns {object}
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

// ---- Board fetching (cache-aware) ------------------------------------------

/**
 * Fetch tasks from the General/Tasks fallback board.
 * Reads from cache first, falls back to Dart CLI, then stale cache.
 *
 * @param {object} opts - { forceRefresh, cacheMaxAgeMs }
 * @returns {{ tasks: object[], source: string }}
 */
function fetchFallbackBoardTasks(opts = {}) {
  const cacheMaxAgeMs = opts.cacheMaxAgeMs || DEFAULT_MAX_AGE_MS;

  // 1. Check cache first (unless force-refresh)
  if (!opts.forceRefresh) {
    const cached = readCache(PROJECT_ROOT, BOARD_KEY, { maxAgeMs: cacheMaxAgeMs });
    if (cached && cached.tasks.length > 0) {
      const ageMin = Math.round(cacheAgeMinutes(PROJECT_ROOT, BOARD_KEY));
      console.log(`  Cache hit (${ageMin}m old, ${cached.tasks.length} tasks)`);
      return { tasks: cached.tasks.map(normalizeDartTask), source: 'cache' };
    }
  }

  // 2. Try Dart CLI refresh
  try {
    const result = execSync(
      `npx dart-tools list-tasks --dartboard "${BOARD_NAME}" --is-completed false --limit 100 --no-defaults true`,
      { cwd: PROJECT_ROOT, timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const tasks = parseDartCliOutput(result);
    if (tasks.length > 0) {
      writeCache(PROJECT_ROOT, BOARD_KEY, tasks, {
        client_code: '',
        board_name: BOARD_NAME
      });
      console.log(`  Dart refresh: ${tasks.length} tasks cached`);
      return { tasks: tasks.map(normalizeDartTask), source: 'dart_cli' };
    }
  } catch { /* Dart CLI not available */ }

  // 3. Fall back to stale cache
  const staleCache = readCache(PROJECT_ROOT, BOARD_KEY, { maxAgeMs: Infinity });
  if (staleCache && staleCache.tasks.length > 0) {
    const ageMin = Math.round(cacheAgeMinutes(PROJECT_ROOT, BOARD_KEY));
    console.log(`  Using stale cache (${ageMin}m old, ${staleCache.tasks.length} tasks)`);
    return { tasks: staleCache.tasks.map(normalizeDartTask), source: 'stale_cache' };
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

// ---- Fingerprinting and delta detection ------------------------------------

const crypto = require('crypto');

/**
 * Build a fingerprint for a classified task.
 *
 * @param {object} classified
 * @returns {string}
 */
function fingerprintClassified(classified) {
  const payload = [
    classified.task_id,
    classified.classification,
    classified.confidence.tier,
    classified.routing.target_board || '',
    classified.work_decision
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Detect material changes between previous and current classification runs.
 *
 * @param {object} prevState
 * @param {object[]} classifiedTasks
 * @returns {object}
 */
function detectDeltas(prevState, classifiedTasks) {
  const prevFingerprints = prevState.task_fingerprints || {};
  const prevIds = new Set(Object.keys(prevFingerprints));

  const newTasks = [];
  const reclassified = [];
  const removedIds = [];

  for (const task of classifiedTasks) {
    const id = task.task_id;
    const fp = fingerprintClassified(task);

    if (!prevIds.has(id)) {
      newTasks.push(task);
    } else if (prevFingerprints[id] !== fp) {
      reclassified.push(task);
    }
    prevIds.delete(id);
  }

  // Any IDs remaining in prevIds were removed
  for (const id of prevIds) {
    removedIds.push(id);
  }

  const materialChange = newTasks.length > 0 || reclassified.length > 0 || removedIds.length > 0;

  return {
    materialChange,
    newTasks,
    reclassified,
    removedIds,
    summary: materialChange
      ? `${newTasks.length} new, ${removedIds.length} removed, ${reclassified.length} reclassified`
      : 'No material changes'
  };
}

// ---- Artifact writing ------------------------------------------------------

/**
 * Write markdown and JSON artifacts for a classification run.
 *
 * @param {object[]} classifiedTasks
 * @param {object} routingArtifact
 * @param {object} deltas
 * @param {string} ts
 * @returns {{ mdPath: string, jsonPath: string }}
 */
function writeArtifacts(classifiedTasks, routingArtifact, deltas, ts) {
  const mdPath = path.join(ARTIFACT_DIR, `landing-pad-sort__${ts}.md`);
  const jsonPath = path.join(ARTIFACT_DIR, `landing-pad-sort__${ts}.json`);

  // JSON artifact
  routingArtifact.delta_summary = deltas.summary;
  routingArtifact.material_change = deltas.materialChange;
  routingArtifact.artifact_paths = {
    markdown: path.relative(PROJECT_ROOT, mdPath),
    json: path.relative(PROJECT_ROOT, jsonPath)
  };

  // Markdown report
  const mdLines = [
    `# Landing Pad Sort: General/Tasks`,
    ``,
    `**Scan time:** ${routingArtifact.timestamp}`,
    `**Mode:** ${routingArtifact.mode} (Phase 1 -- always dry-run)`,
    `**Tasks scanned:** ${classifiedTasks.length}`,
    `**Material change:** ${deltas.materialChange ? 'YES' : 'No'}`,
    `**Delta:** ${deltas.summary}`,
    ``
  ];

  // Summary counts
  mdLines.push(`## Classification Summary`);
  mdLines.push('');
  const counts = routingArtifact.classification_counts;
  mdLines.push(`- Route to board: ${counts.route_to_board}`);
  mdLines.push(`- Needs review: ${counts.needs_review}`);
  mdLines.push(`- No work (informational): ${counts.no_work}`);
  mdLines.push(`- Retain (no match): ${counts.retain}`);
  mdLines.push('');

  // Confidence breakdown
  mdLines.push(`## Confidence Breakdown`);
  mdLines.push('');
  const tiers = routingArtifact.confidence_tier_counts;
  mdLines.push(`- High: ${tiers.high}`);
  mdLines.push(`- Medium: ${tiers.medium}`);
  mdLines.push(`- Low: ${tiers.low}`);
  mdLines.push('');

  // Routing suggestions
  const routableTasks = classifiedTasks.filter((t) => t.classification === 'route_to_board');
  if (routableTasks.length > 0) {
    mdLines.push(`## Suggested Routing (${routableTasks.length})`);
    mdLines.push('');
    for (const task of routableTasks) {
      mdLines.push(`- **${task.title}** -> \`${task.routing.target_board}\` (${task.confidence.tier}, ${Math.round(task.confidence.score * 100)}%)`);
    }
    mdLines.push('');
  }

  // Needs review
  const reviewTasks = classifiedTasks.filter((t) => t.classification === 'needs_review');
  if (reviewTasks.length > 0) {
    mdLines.push(`## Needs Review (${reviewTasks.length})`);
    mdLines.push('');
    for (const task of reviewTasks) {
      mdLines.push(`- **${task.title}** -- ${task.confidence.rationale}`);
    }
    mdLines.push('');
  }

  // No-work items
  const noWorkTasks = classifiedTasks.filter((t) => t.classification === 'no_work');
  if (noWorkTasks.length > 0) {
    mdLines.push(`## Informational / No Work (${noWorkTasks.length})`);
    mdLines.push('');
    mdLines.push('Recommended action: mark done with comment');
    mdLines.push('');
    for (const task of noWorkTasks) {
      mdLines.push(`- **${task.title}**`);
    }
    mdLines.push('');
  }

  // Content normalization preview
  const normalizedTasks = classifiedTasks.filter((t) => t.normalized && t.normalized.changed);
  if (normalizedTasks.length > 0) {
    mdLines.push(`## Content Normalization Preview (${normalizedTasks.length})`);
    mdLines.push('');
    mdLines.push('These tasks have email/meeting artifacts that would be cleaned up:');
    mdLines.push('');
    for (const task of normalizedTasks) {
      mdLines.push(`### ${task.title}`);
      mdLines.push('');
      mdLines.push(`**Cleaned title:** ${task.normalized.title}`);
      mdLines.push('');
      const descPreview = (task.normalized.description || '').slice(0, 300);
      mdLines.push(`**Cleaned description preview:**`);
      mdLines.push(`> ${descPreview.replace(/\n/g, '\n> ')}${task.normalized.description.length > 300 ? '...' : ''}`);
      mdLines.push('');
    }
  }

  // Full table
  mdLines.push('## All Items');
  mdLines.push('');
  mdLines.push('| Title | Classification | Confidence | Target Board | Work Decision |');
  mdLines.push('|-------|---------------|------------|-------------|---------------|');
  for (const task of classifiedTasks) {
    const board = task.routing.target_board || '--';
    mdLines.push(`| ${task.title} | ${task.classification} | ${task.confidence.tier} (${Math.round(task.confidence.score * 100)}%) | ${board} | ${task.work_decision} |`);
  }
  mdLines.push('');

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(mdPath, mdLines.join('\n'));
  fs.writeFileSync(jsonPath, JSON.stringify(routingArtifact, null, 2));

  return { mdPath, jsonPath };
}

// ---- Signal emission -------------------------------------------------------

/**
 * Emit a coordination signal when material changes are detected.
 *
 * @param {object} deltas
 * @param {object} artifactPaths - { markdown, json }
 * @param {object[]} classifiedTasks
 * @returns {string|null} Signal file path, or null if skipped
 */
function emitSortSignal(deltas, artifactPaths, classifiedTasks) {
  const signalPath = path.join(SIGNAL_DIR, 'landing-pad-sort.signal.json');

  // Check if existing signal has the same fingerprint
  if (fs.existsSync(signalPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
      if (existing.lifecycle_state === 'live' && existing.delta_summary === deltas.summary) {
        return null; // unchanged, skip
      }
    } catch { /* overwrite corrupted signal */ }
  }

  const routableCount = classifiedTasks.filter((t) => t.classification === 'route_to_board').length;
  const reviewCount = classifiedTasks.filter((t) => t.classification === 'needs_review').length;
  const noWorkCount = classifiedTasks.filter((t) => t.classification === 'no_work').length;

  const signal = createHandoffSignal(
    'landing-pad-sorter',
    'landing-pad:General/Tasks',
    'ready-for-review',
    {
      artifacts: [
        artifactPaths.markdown,
        artifactPaths.json
      ],
      recommended_next_actor: 'operator',
      recommended_next_command: '/triage-client-board General --board "General/Tasks"',
      next_step_detail: [
        `Review landing-pad classification for General/Tasks`,
        `${routableCount} tasks ready to route, ${reviewCount} need review, ${noWorkCount} informational`,
        `Phase 1: dry-run only -- confirm routing suggestions before Phase 2 enables moves`
      ],
      signal_scope: 'landing-pad-sort'
    }
  );

  // Attach extra fields for context
  signal.board_name = BOARD_NAME;
  signal.delta_summary = deltas.summary;
  signal.classification_counts = {
    route_to_board: routableCount,
    needs_review: reviewCount,
    no_work: noWorkCount,
    retain: classifiedTasks.filter((t) => t.classification === 'retain').length
  };

  fs.mkdirSync(SIGNAL_DIR, { recursive: true });
  fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));
  return signalPath;
}

// ---- Main scan logic -------------------------------------------------------

/**
 * Run a single scan cycle.
 *
 * @param {object} config
 * @param {object} state
 * @param {object} opts
 * @returns {object} Scan result
 */
async function scanLandingPad(config, state, opts = {}) {
  const ts = timestamp();

  console.log(`[${new Date().toISOString()}] Scanning landing pad: ${BOARD_NAME}`);

  // 1. Fetch tasks from fallback board
  const { tasks: rawTasks, source } = fetchFallbackBoardTasks({
    forceRefresh: opts.forceRefresh,
    cacheMaxAgeMs: opts.cacheMaxAgeMs
  });

  if (rawTasks.length === 0) {
    console.log(`  No open tasks found (source: ${source}). Nothing to classify.`);
    return { materialChange: false, itemCount: 0, source };
  }

  // 2. Load routing table
  const routingTable = loadRoutingTable(PROJECT_ROOT);

  // 3. Classify each task and normalize content
  const classifiedTasks = rawTasks.map((task) => {
    const classified = classifyLandingPadTask(task, routingTable);
    const normalized = normalizeTaskContent(task);
    classified.normalized = {
      title: normalized.title,
      description: normalized.description,
      changed: normalized.changed
    };
    return classified;
  });

  // 4. Build routing artifact
  const routingArtifact = buildRoutingArtifact(classifiedTasks, config);

  // 5. Detect deltas
  const deltas = detectDeltas(state, classifiedTasks);

  if (!deltas.materialChange) {
    console.log(`  No material changes. Skipping artifacts.`);
    state.last_scan = new Date().toISOString();
    return { materialChange: false, itemCount: classifiedTasks.length, source };
  }

  console.log(`  Delta: ${deltas.summary}`);

  // Phase 1: always dry-run
  console.log(`  [Phase 1 dry-run] Writing classification artifacts (no Dart mutation)`);

  // 6. Write artifacts
  const { mdPath, jsonPath } = writeArtifacts(classifiedTasks, routingArtifact, deltas, ts);
  const relMd = path.relative(PROJECT_ROOT, mdPath);
  const relJson = path.relative(PROJECT_ROOT, jsonPath);
  console.log(`  Artifacts: ${relMd}`);

  // 7. Update state
  const newFingerprints = {};
  for (const task of classifiedTasks) {
    newFingerprints[task.task_id] = fingerprintClassified(task);
  }
  state.last_scan = new Date().toISOString();
  state.task_fingerprints = newFingerprints;

  // 8. Emit signal
  let signalPath = null;
  signalPath = emitSortSignal(deltas, { markdown: relMd, json: relJson }, classifiedTasks);
  if (signalPath) {
    console.log(`  Signal: ${path.relative(PROJECT_ROOT, signalPath)}`);
  } else {
    console.log(`  Signal: skipped (unchanged fingerprint)`);
  }

  return {
    materialChange: true,
    itemCount: classifiedTasks.length,
    source,
    deltas,
    artifactPaths: { md: relMd, json: relJson },
    signalPath: signalPath ? path.relative(PROJECT_ROOT, signalPath) : null,
    routingArtifact
  };
}

// ---- Entry point -----------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const once = Boolean(args.once);
  const forceRefresh = Boolean(args.refresh);
  const jsonOutput = Boolean(args.json);
  // Phase 1: always dry-run regardless of flag
  const dryRun = true;

  const cacheMaxAgeMs = DEFAULT_MAX_AGE_MS;

  do {
    const config = loadConfig();
    const state = loadState();

    const result = await scanLandingPad(config, state, {
      forceRefresh,
      cacheMaxAgeMs
    });

    // Persist state (safe even in dry-run -- state is local, not Dart)
    if (result.materialChange) {
      saveState(state);
    }

    if (jsonOutput) {
      const output = {
        timestamp: new Date().toISOString(),
        mode: 'dry-run',
        phase: 1,
        source_board: BOARD_NAME,
        tasks_scanned: result.itemCount,
        material_change: result.materialChange,
        source: result.source
      };
      if (result.routingArtifact) {
        output.classification_counts = result.routingArtifact.classification_counts;
        output.confidence_tier_counts = result.routingArtifact.confidence_tier_counts;
      }
      if (result.artifactPaths) {
        output.artifact_paths = result.artifactPaths;
      }
      if (result.deltas) {
        output.delta_summary = result.deltas.summary;
      }
      console.log(JSON.stringify(output, null, 2));
    }

    if (once) break;

    // Sleep until next cycle
    const intervalMs = (config.defaults.scan_interval_minutes || 60) * 60 * 1000;
    console.log(`[${new Date().toISOString()}] Next scan in ${Math.round(intervalMs / 60000)} minutes.`);
    await sleep(intervalMs);

  } while (true);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
