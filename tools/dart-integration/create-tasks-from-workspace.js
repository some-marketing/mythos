#!/usr/bin/env node
/**
 * Create Dart tasks from a dart-collaboration `tasks/` workspace directory.
 *
 * Supports TWO index.json shapes; the shape is auto-detected:
 *
 * ── SHAPE A: FLAT (2-level Brief -> Implementation) — original/back-compat ──
 *   index.json is an array of entries, or `{ "tasks": [...] }`, optionally with a
 *   leading `_note`. Each entry:
 *     { slug, type ("Brief"|"Implementation"), title, assignee, suggested_board,
 *       status, parent, context_file, dart_url, dart_task_id }
 *   One markdown file per task, `<slug>.md` (Brief is `BRIEF__*.md`, impls are
 *   `IMPL__*.md`). The H1 line is the title; the remaining body is the description.
 *   The Brief is created FIRST; each Implementation parents onto the Brief id.
 *
 * ── SHAPE B: NESTED (3-level Owner Summary -> For <Person> -> Implementation) ──
 *   index.json is an object with top-level `owner_summary` AND `groups[]`:
 *     {
 *       owner_summary: { title, assignee, doc, board, dart_task_id, dart_url },
 *       groups: [
 *         { slug:"FOR__<person>", title, assignee, board, dart_task_id, dart_url,
 *           tasks: [ { slug:"IMPL__...", title, dart_task_id, dart_url }, ... ] }
 *       ]
 *     }
 *   Create order: Owner Summary parent (description from `owner_summary.doc`, a path
 *   relative to the tasks dir, H1 stripped) -> each `For <Person>` group
 *   (parentId = ownerSummaryId; description from `FOR__<slug>.md` if present) ->
 *   each child task (parentId = forGroupId; description from `IMPL__*.md` /
 *   `<slug>.md`). Board: entry `board`/`suggested_board`, else --default-board.
 *
 * Usage:
 *   node tools/dart-integration/create-tasks-from-workspace.js <tasks-dir> [options]
 *
 * Options:
 *   --dry-run                 Print each item that WOULD be created (JSON). Creates
 *                             nothing and performs no writeback. Already-created
 *                             entries (those with dart_task_id) are reported as
 *                             "skip: already created" — a fully-built nested tree
 *                             therefore yields ZERO creates.
 *   --reparent                OPT-IN. For an already-created child whose live parent
 *                             differs from its intended group, call
 *                             updateTask({id, parentId}) to move it. WITHOUT this
 *                             flag, mis-parents are only REPORTED ("mis-parented (run
 *                             --reparent to fix)") and never moved.
 *   --default-board "<name>"  Fallback dartboard when an entry has no board.
 *   --help, -h                Show usage.
 *
 * Behavior (both shapes):
 *   - Description: resolve the entry's md file; strip a single leading `# H1`.
 *   - Idempotent: an entry that already carries `dart_task_id` is SKIPPED (never
 *     recreated). On create, `dart_task_id` + `dart_url` are written back into the
 *     matching entry and the file is persisted (pretty).
 *   - Re-parenting live tasks is OPT-IN (see --reparent). Default never moves an
 *     already-created task.
 *   - Assignee passthrough: entry `assignee` -> `assignees:[name]`. If Dart rejects
 *     the item (e.g. "Chris" is not yet a Dart user), the resilient create retries
 *     with a reduced item that drops parentId/assignees/tags and flags `reduced:true`
 *     so the caller logs that linkage needs a manual fix.
 *   - Board: entry board, else --default-board, else hard error.
 *   - Defaults: status "To-do", priority "High", tags ['Engineering','client-project']
 *     (overridable per-entry via entry.tags / entry.priority / entry.status).
 *   - Exits non-zero only on a hard failure (parent create fails, or
 *     index/board unresolvable).
 *
 * No live execution is performed unless this script is run directly against a real
 * workspace; credential handling is entirely delegated to lib/dart-api.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dart = require('./lib/dart-api.js');

const DEFAULT_STATUS = 'To-do';
const DEFAULT_PRIORITY = 'High';
const DEFAULT_TAGS = ['Engineering', 'client-project'];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--reparent') args.reparent = true;
    else if (a === '--default-board') args.defaultBoard = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

const USAGE =
  'Usage: node tools/dart-integration/create-tasks-from-workspace.js <tasks-dir> ' +
  '[--dry-run] [--reparent] [--default-board "<board>"]';

// ---------------------------------------------------------------------------
// Index + markdown loading
// ---------------------------------------------------------------------------

/**
 * Load and normalize index.json into { indexPath, raw, entries }.
 * `raw` is the parsed top-level object/array (preserved for writeback so we keep
 * any _note and the original container shape). `entries` is the task array.
 */
function loadIndexRaw(tasksDir) {
  const indexPath = path.join(tasksDir, 'index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error('index.json not found in tasks dir: ' + indexPath);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (e) {
    throw new Error('failed to parse index.json: ' + e.message);
  }
  return { indexPath, raw };
}

/**
 * Resolve the FLAT-shape task array from a parsed index (array, or { tasks: [...] }).
 * Throws for shapes that are neither flat nor nested.
 */
function normalizeFlatEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.tasks)) return raw.tasks;
  throw new Error(
    'index.json must be an array, an object with a `tasks` array, or the nested ' +
    'owner_summary/groups shape'
  );
}

/**
 * Back-compat convenience: parse + normalize the FLAT shape in one call.
 * Retained for callers/tests that expect { indexPath, raw, entries }.
 */
function loadIndex(tasksDir) {
  const { indexPath, raw } = loadIndexRaw(tasksDir);
  return { indexPath, raw, entries: normalizeFlatEntries(raw) };
}

/**
 * Persist the index back to disk, pretty-printed, preserving the original
 * container shape (array vs { _note, tasks: [...] } vs nested owner_summary/groups).
 */
function persistIndex(indexPath, raw) {
  fs.writeFileSync(indexPath, JSON.stringify(raw, null, 2) + '\n');
}

/**
 * Pure index-shape detector. Returns 'nested' when the parsed index has BOTH a
 * top-level `owner_summary` object AND a `groups` array (the 3-level shape);
 * otherwise 'flat' (the original array / { tasks: [...] } 2-level shape).
 */
function detectIndexShape(raw) {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    raw.owner_summary &&
    typeof raw.owner_summary === 'object' &&
    Array.isArray(raw.groups)
  ) {
    return 'nested';
  }
  return 'flat';
}

/**
 * Strip a single leading `# H1` line from markdown text and trim surrounding
 * blank lines. Pure helper.
 */
function stripH1(text) {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  if (start < lines.length && /^#\s+/.test(lines[start])) start++;
  return lines.slice(start).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
}

/**
 * Resolve the markdown file for an entry and return the body with the leading
 * `# H1` line stripped. Resolution order:
 *   1. If `entry.doc` is set, treat it as a path relative to the tasks dir.
 *   2. Otherwise look for `<slug>.md` in the tasks dir.
 * Returns '' if the file is missing.
 */
function loadDescription(tasksDir, entry) {
  let mdPath;
  if (entry.doc) {
    mdPath = path.resolve(tasksDir, entry.doc);
  } else if (entry.slug) {
    mdPath = path.join(tasksDir, entry.slug + '.md');
  } else {
    return '';
  }
  if (!fs.existsSync(mdPath)) return '';
  return stripH1(fs.readFileSync(mdPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Item construction
// ---------------------------------------------------------------------------

/**
 * Build the full Dart item for an entry. `parentId` is attached for
 * implementations once the Brief id is known.
 */
function buildItem(entry, tasksDir, defaultBoard, parentId) {
  const dartboard = entry.suggested_board || entry.board || defaultBoard;
  if (!dartboard) {
    throw new Error(
      'no dartboard for entry "' + (entry.slug || entry.title) + '": entry has no ' +
      'suggested_board/board and no --default-board was provided'
    );
  }
  const item = {
    title: entry.title || entry.slug,
    dartboard: dartboard,
    status: entry.status || DEFAULT_STATUS,
    priority: entry.priority || DEFAULT_PRIORITY,
    description: loadDescription(tasksDir, entry),
    tags: Array.isArray(entry.tags) && entry.tags.length ? entry.tags : DEFAULT_TAGS.slice(),
  };
  // Assignee passthrough — let the resilient-create path handle rejection of an
  // unknown Dart user rather than failing or hardcoding a user list.
  if (entry.assignee) item.assignees = [entry.assignee];
  if (parentId) item.parentId = parentId;
  return item;
}

/**
 * Pure create-plan derivation for the NESTED (3-level) shape.
 *
 * Walks owner_summary -> groups[] -> groups[].tasks[] in create order and returns
 * an ordered array of nodes, each describing what SHOULD happen to one entry — with
 * NO side effects and NO network. Idempotency + parent-wiring are decided here so
 * the executor (and the unit tests) share one source of truth.
 *
 * Each node:
 *   {
 *     entry,            // the live index entry object (mutated on writeback by caller)
 *     kind,             // 'owner_summary' | 'for_grouping' | 'implementation'
 *     label,            // human label for logging
 *     parentEntry,      // the entry that should be this node's parent (null for owner)
 *     action,           // 'create' (no dart_task_id) | 'skip' (already created)
 *     misParented,      // true when action=skip AND live parent != intended parent
 *   }
 *
 * `parentEntry.dart_task_id` is the intended live parent id. A child is considered
 * mis-parented only when it is already created AND carries a recorded
 * `dart_parent_id` that differs from the intended parent's id. (When no
 * `dart_parent_id` is recorded we cannot assert mis-parenting without a live read,
 * so we do not flag it.)
 */
function deriveNestedPlan(raw) {
  const nodes = [];
  const owner = raw.owner_summary;

  const ownerNode = {
    entry: owner,
    kind: 'owner_summary',
    label: owner.title || 'Owner Summary',
    parentEntry: null,
    action: owner.dart_task_id ? 'skip' : 'create',
    misParented: false,
  };
  nodes.push(ownerNode);

  for (const group of raw.groups) {
    const groupNode = {
      entry: group,
      kind: 'for_grouping',
      label: group.title || group.slug,
      parentEntry: owner,
      action: group.dart_task_id ? 'skip' : 'create',
      misParented: isMisParented(group, owner),
    };
    nodes.push(groupNode);

    const tasks = Array.isArray(group.tasks) ? group.tasks : [];
    for (const task of tasks) {
      // Defensive: a group whose only "task" is itself (a checklist-carrier whose
      // task slug equals the group slug) is not a separate child — skip it.
      if (task.slug && task.slug === group.slug) continue;
      nodes.push({
        entry: task,
        kind: 'implementation',
        label: task.title || task.slug,
        parentEntry: group,
        action: task.dart_task_id ? 'skip' : 'create',
        misParented: isMisParented(task, group),
      });
    }
  }

  return nodes;
}

/**
 * An already-created entry is mis-parented when it records a live parent
 * (`dart_parent_id`) that differs from the intended parent's `dart_task_id`.
 * Pure; returns false unless we can positively assert the mismatch.
 */
function isMisParented(entry, intendedParent) {
  if (!entry.dart_task_id) return false; // not created yet -> not mis-parented
  if (!intendedParent || !intendedParent.dart_task_id) return false;
  if (!entry.dart_parent_id) return false; // no recorded live parent -> cannot assert
  return entry.dart_parent_id !== intendedParent.dart_task_id;
}

/**
 * Resilient create: try the full item; on rejection, retry with a reduced item
 * that drops parentId/assignees/tags. Returns { created, reduced }.
 * Throws only if even the reduced create fails.
 */
async function resilientCreate(item) {
  try {
    const created = await dart.createTask(item);
    return { created, reduced: false };
  } catch (err) {
    // Auth/credential errors are not "bad item" — never silently reduce past them.
    if (err && err.code === 'DART_TOKEN_INVALID') throw err;
    const reducedItem = {
      title: item.title,
      dartboard: item.dartboard,
      status: item.status,
      priority: item.priority,
      description: item.description,
    };
    const created = await dart.createTask(reducedItem);
    return { created, reduced: true };
  }
}

function extractCreated(created) {
  const taskItem = created && created.item ? created.item : null;
  return {
    id: taskItem ? taskItem.id : null,
    htmlUrl: taskItem ? taskItem.htmlUrl : null,
  };
}

// ---------------------------------------------------------------------------
// Nested (3-level) executor
// ---------------------------------------------------------------------------

/**
 * Execute the NESTED shape: Owner Summary -> For <Person> groups -> impl children.
 * Uses deriveNestedPlan() for the create/skip/parent decisions, then performs the
 * side effects (create + writeback, opt-in reparent). Honors --dry-run.
 */
async function runNested({ indexPath, raw, tasksDir, args }) {
  const nodes = deriveNestedPlan(raw);
  const summary = { created: [], skipped: [], reduced: [], reparented: [], misParented: [] };
  const isDry = !!args.dryRun;

  for (const node of nodes) {
    const { entry, kind, label, parentEntry } = node;

    // SKIP already-created entries (idempotency). Report mis-parents; only fix
    // them when --reparent is explicitly passed.
    if (node.action === 'skip') {
      console.log('skip: already created —', (entry.slug || label), '(' + entry.dart_task_id + ')');
      summary.skipped.push(entry.slug || label);

      if (node.misParented) {
        const intended = parentEntry.dart_task_id;
        if (args.reparent) {
          if (isDry) {
            console.log('[DRY-RUN] would reparent', (entry.slug || label), '-> parent', intended);
          } else {
            await dart.updateTask(entry.dart_task_id, { id: entry.dart_task_id, parentId: intended });
            entry.dart_parent_id = intended;
            persistIndex(indexPath, raw);
            console.log('reparented:', (entry.slug || label), '-> parent', intended);
          }
          summary.reparented.push(entry.slug || label);
        } else {
          console.log('mis-parented (run --reparent to fix):', (entry.slug || label),
            'live parent', entry.dart_parent_id, '!= intended', intended);
          summary.misParented.push(entry.slug || label);
        }
      }
      continue;
    }

    // CREATE: parent id is the intended parent's recorded/just-created dart_task_id.
    const parentId = parentEntry ? parentEntry.dart_task_id || undefined : undefined;

    // Board inheritance: impl children rarely carry their own board — fall back to
    // the parent group's board, then to --default-board.
    const fallbackBoard = (parentEntry && parentEntry.board) || args.defaultBoard;

    let item;
    try {
      item = buildItem(entry, tasksDir, fallbackBoard, parentId);
    } catch (e) {
      console.error('ERROR:', e.message);
      process.exit(1);
    }

    if (isDry) {
      console.log('[DRY-RUN] would create (' + kind + '):');
      console.log(JSON.stringify(item, null, 2));
      continue;
    }

    const isParentNode = kind === 'owner_summary';
    let result;
    try {
      result = await resilientCreate(item);
    } catch (e) {
      if (isParentNode) {
        console.error('ERROR: Owner Summary creation failed for', label + ':', e.message);
        process.exit(1);
      }
      console.error('WARN: create failed for', (entry.slug || label) + ':', e.message, '— continuing');
      continue;
    }

    const { id, htmlUrl } = extractCreated(result.created);
    if (!id) {
      if (isParentNode) {
        console.error('ERROR: Owner Summary create returned no id for', label);
        process.exit(1);
      }
      console.error('WARN: create returned no id for', (entry.slug || label), '— skipping writeback');
      continue;
    }

    entry.dart_task_id = id;
    if (htmlUrl) entry.dart_url = htmlUrl;
    if (!result.reduced && parentId) entry.dart_parent_id = parentId;
    persistIndex(indexPath, raw);

    if (result.reduced) {
      summary.reduced.push({ slug: entry.slug || label, id, htmlUrl });
      console.log(
        'reduced: created', (entry.slug || label), '(' + id + ') WITHOUT parent/assignee/tags — ' +
        'manual fix needed for linkage' +
        (item.assignees ? ' (assignee "' + item.assignees[0] + '" may be unknown to Dart)' : '')
      );
    } else {
      summary.created.push({ slug: entry.slug || label, id, htmlUrl });
      console.log('created:', (entry.slug || label), '(' + id + ')', htmlUrl || '');
    }
  }

  printNestedSummary(summary, isDry);
}

function printNestedSummary(summary, isDryRun) {
  console.log('\n--- summary' + (isDryRun ? ' (dry-run)' : '') + ' (nested 3-level) ---');
  console.log(
    'created ' + summary.created.length +
    ', skipped ' + summary.skipped.length +
    ', reduced ' + summary.reduced.length +
    ', reparented ' + summary.reparented.length +
    ', mis-parented ' + summary.misParented.length
  );
  summary.created.forEach((c) => console.log('  created     ' + c.slug + '  ' + c.id + '  ' + (c.htmlUrl || '')));
  summary.reduced.forEach((c) => console.log('  reduced     ' + c.slug + '  ' + c.id + '  ' + (c.htmlUrl || '') + '  (linkage needs manual fix)'));
  summary.reparented.forEach((s) => console.log('  reparented  ' + s));
  summary.misParented.forEach((s) => console.log('  mis-parented ' + s + '  (run --reparent to fix)'));
  summary.skipped.forEach((s) => console.log('  skipped     ' + s));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    console.error(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const tasksDir = path.resolve(args._[0]);
  if (!fs.existsSync(tasksDir) || !fs.statSync(tasksDir).isDirectory()) {
    console.error('ERROR: tasks dir not found or not a directory:', tasksDir);
    process.exit(1);
  }

  let index;
  try {
    index = loadIndexRaw(tasksDir);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
  const { indexPath, raw } = index;

  // Branch on detected shape. NESTED (owner_summary + groups) -> 3-level path;
  // anything else falls back to the original FLAT 2-level path unchanged.
  if (detectIndexShape(raw) === 'nested') {
    await runNested({ indexPath, raw, tasksDir, args });
    return;
  }

  const entries = normalizeFlatEntries(raw);

  // Partition: Brief(s) first, then Implementations. There is normally one Brief.
  const briefs = entries.filter((e) => e.type === 'Brief');
  const impls = entries.filter((e) => e.type !== 'Brief');
  const ordered = briefs.concat(impls);

  const summary = { created: [], skipped: [], reduced: [] };

  // Track the resolved Brief id so implementations can parent onto it.
  // Prefer the first Brief's id (pre-existing or freshly created).
  let briefId = null;
  const existingBrief = briefs.find((e) => e.dart_task_id);
  if (existingBrief) briefId = existingBrief.dart_task_id;

  // --- DRY RUN -------------------------------------------------------------
  if (args.dryRun) {
    for (const entry of ordered) {
      if (entry.dart_task_id) {
        console.log('skip: already created —', entry.slug, '(' + entry.dart_task_id + ')');
        summary.skipped.push(entry.slug);
        continue;
      }
      const parentId = entry.type === 'Brief' ? undefined : briefId || '<brief-id-pending>';
      let item;
      try {
        item = buildItem(entry, tasksDir, args.defaultBoard, parentId);
      } catch (e) {
        console.error('ERROR:', e.message);
        process.exit(1);
      }
      console.log('[DRY-RUN] would create (' + entry.type + '):');
      console.log(JSON.stringify(item, null, 2));
    }
    printSummary(summary, true);
    return;
  }

  // --- LIVE ----------------------------------------------------------------
  for (const entry of ordered) {
    // Idempotency: never recreate.
    if (entry.dart_task_id) {
      console.log('skip: already created —', entry.slug, '(' + entry.dart_task_id + ')');
      summary.skipped.push(entry.slug);
      if (entry.type === 'Brief' && !briefId) briefId = entry.dart_task_id;
      continue;
    }

    const isBrief = entry.type === 'Brief';
    const parentId = isBrief ? undefined : briefId || undefined;

    let item;
    try {
      item = buildItem(entry, tasksDir, args.defaultBoard, parentId);
    } catch (e) {
      // Unresolvable board is a hard failure.
      console.error('ERROR:', e.message);
      process.exit(1);
    }

    let result;
    try {
      result = await resilientCreate(item);
    } catch (e) {
      if (isBrief) {
        // Brief creation failing is a hard failure — implementations cannot parent.
        console.error('ERROR: Brief creation failed for', entry.slug + ':', e.message);
        process.exit(1);
      }
      console.error('WARN: create failed for', entry.slug + ':', e.message, '— continuing');
      continue;
    }

    const { id, htmlUrl } = extractCreated(result.created);
    if (!id) {
      if (isBrief) {
        console.error('ERROR: Brief create returned no id for', entry.slug);
        process.exit(1);
      }
      console.error('WARN: create returned no id for', entry.slug, '— skipping writeback');
      continue;
    }

    // Writeback into the entry (mutates `raw` through the shared entry reference).
    entry.dart_task_id = id;
    if (htmlUrl) entry.dart_url = htmlUrl;
    persistIndex(indexPath, raw);

    if (isBrief && !briefId) briefId = id;

    if (result.reduced) {
      summary.reduced.push({ slug: entry.slug, id, htmlUrl });
      console.log(
        'reduced: created', entry.slug, '(' + id + ') WITHOUT parent/assignee/tags — ' +
        'manual fix needed for linkage' +
        (item.assignees ? ' (assignee "' + item.assignees[0] + '" may be unknown to Dart)' : '')
      );
    } else {
      summary.created.push({ slug: entry.slug, id, htmlUrl });
      console.log('created:', entry.slug, '(' + id + ')', htmlUrl || '');
    }
  }

  printSummary(summary, false);
}

function printSummary(summary, isDryRun) {
  console.log('\n--- summary' + (isDryRun ? ' (dry-run)' : '') + ' ---');
  console.log(
    'created ' + summary.created.length +
    ', skipped ' + summary.skipped.length +
    ', reduced ' + summary.reduced.length
  );
  summary.created.forEach((c) => console.log('  created  ' + c.slug + '  ' + c.id + '  ' + (c.htmlUrl || '')));
  summary.reduced.forEach((c) => console.log('  reduced  ' + c.slug + '  ' + c.id + '  ' + (c.htmlUrl || '') + '  (linkage needs manual fix)'));
  summary.skipped.forEach((s) => console.log('  skipped  ' + s));
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}

module.exports = {
  parseArgs,
  loadIndex,
  loadIndexRaw,
  normalizeFlatEntries,
  detectIndexShape,
  deriveNestedPlan,
  isMisParented,
  loadDescription,
  stripH1,
  buildItem,
  resilientCreate,
  runNested,
};
