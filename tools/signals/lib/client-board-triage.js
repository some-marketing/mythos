/**
 * client-board-triage.js — Shared classification contract for client-board intake.
 *
 * Used by:
 *   - /triage-client-board (slash command)
 *   - watch-client-board-loop.js (hourly listener)
 *
 * This is the single source of truth for classification categories,
 * fingerprinting, and delta detection.
 */

'use strict';

const crypto = require('crypto');

/**
 * Valid classification categories for intake items.
 * Exactly one must be assigned per item.
 */
const CLASSIFICATIONS = Object.freeze([
  'pick_up_now',
  'plan_first',
  'needs_clarification',
  'update_existing',
  'blocked',
  'ignore'
]);

/**
 * Classifications that may advance to planning/execution.
 */
const ACTIONABLE_CLASSIFICATIONS = Object.freeze([
  'pick_up_now',
  'plan_first'
]);

/**
 * Classifications that require human intervention before advancing.
 */
const BLOCKED_CLASSIFICATIONS = Object.freeze([
  'needs_clarification',
  'blocked'
]);

/**
 * Handoff map: classification → recommended next command template.
 */
const HANDOFF_MAP = Object.freeze({
  pick_up_now: '/plan-task "$SUMMARY" --client $CLIENT',
  plan_first: '/plan-task "$SUMMARY" --client $CLIENT',
  needs_clarification: null,
  update_existing: null,
  blocked: null,
  ignore: null
});

/**
 * Compute a stable fingerprint for a single triage item.
 * Used to detect whether an item's classification or summary changed between scans.
 *
 * @param {object} item - A triage item with at minimum: id, classification, summary
 * @returns {string} A hex SHA-256 fingerprint
 */
function fingerprintItem(item) {
  const payload = [
    String(item.id || ''),
    String(item.classification || ''),
    String(item.summary || ''),
    String(item.status || ''),
    String(item.title || '')
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Compute a stable summary fingerprint for an entire board triage result.
 * If the fingerprint is unchanged between scans, no signal should be emitted.
 *
 * @param {object[]} items - Array of triage items (each with id, classification, summary)
 * @returns {string} A hex SHA-256 fingerprint
 */
function fingerprintBoard(items) {
  const sorted = [...items].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  const payload = sorted.map((item) => fingerprintItem(item)).join(':');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

/**
 * Detect material changes between previous and current triage results.
 *
 * @param {object} previousState - Previous board state from state file (tasks map, fingerprint)
 * @param {object[]} currentItems - Current triage items
 * @returns {object} Delta report: { materialChange, newItems, removedIds, reclassified, newActionable, newBlocked, summary }
 */
function detectDeltas(previousState, currentItems) {
  const prevTasks = previousState.tasks || {};
  const prevIds = new Set(Object.keys(prevTasks));
  const currIds = new Set(currentItems.map((item) => String(item.id)));

  const newItems = currentItems.filter((item) => !prevIds.has(String(item.id)));
  const removedIds = [...prevIds].filter((id) => !currIds.has(id));

  const reclassified = currentItems.filter((item) => {
    const prev = prevTasks[String(item.id)];
    if (!prev) return false;
    return prev.classification !== item.classification;
  });

  const newActionable = currentItems.filter((item) => {
    const prev = prevTasks[String(item.id)];
    const wasActionable = prev && ACTIONABLE_CLASSIFICATIONS.includes(prev.classification);
    const isActionable = ACTIONABLE_CLASSIFICATIONS.includes(item.classification);
    return isActionable && (!prev || !wasActionable);
  });

  const newBlocked = currentItems.filter((item) => {
    const prev = prevTasks[String(item.id)];
    const wasBlocked = prev && BLOCKED_CLASSIFICATIONS.includes(prev.classification);
    const isBlocked = BLOCKED_CLASSIFICATIONS.includes(item.classification);
    return isBlocked && (!prev || !wasBlocked);
  });

  const materialChange = newItems.length > 0
    || removedIds.length > 0
    || reclassified.length > 0
    || newActionable.length > 0
    || newBlocked.length > 0;

  return {
    materialChange,
    newItems,
    removedIds,
    reclassified,
    newActionable,
    newBlocked,
    summary: materialChange
      ? `${newItems.length} new, ${removedIds.length} removed, ${reclassified.length} reclassified, ${newActionable.length} newly actionable, ${newBlocked.length} newly blocked`
      : 'No material changes'
  };
}

/**
 * Build the per-board state entry from current triage items.
 *
 * @param {object[]} items - Current triage items
 * @returns {object} State entry with tasks map, fingerprint, and timestamp
 */
function buildBoardState(items) {
  const tasks = {};
  for (const item of items) {
    tasks[String(item.id)] = {
      title: String(item.title || ''),
      classification: String(item.classification || ''),
      summary: String(item.summary || ''),
      fingerprint: fingerprintItem(item)
    };
  }
  return {
    last_scan: new Date().toISOString(),
    fingerprint: fingerprintBoard(items),
    task_count: items.length,
    tasks
  };
}

/**
 * Format a handoff command for an actionable item.
 *
 * @param {string} classification - The item's classification
 * @param {string} summary - Short summary of the item
 * @param {string} clientCode - Client code (e.g. "CLIENTA")
 * @returns {string|null} The recommended next command, or null if not actionable
 */
function formatHandoff(classification, summary, clientCode) {
  const template = HANDOFF_MAP[classification];
  if (!template) return null;
  return template
    .replace('$SUMMARY', summary)
    .replace('$CLIENT', clientCode);
}

// ─── Auto-sort: repo-aware classification ──────────────────────────────────

/**
 * Gather repo context for a client to enable smarter auto-classification.
 * Reads: active workstreams, live signals, existing triage artifacts, task-plan artifacts.
 *
 * @param {string} projectRoot
 * @param {string} clientCode
 * @returns {object} repoContext
 */
function gatherRepoContext(projectRoot, clientCode) {
  const fs = require('fs');
  const path = require('path');
  const ARTIFACT_DIR = path.join(projectRoot, '_dev/reports/analysis');
  const SIGNAL_DIR = path.join(projectRoot, '_dev/reports/signals');

  const context = {
    activeWorkstreams: [],
    existingTriageMap: {},
    liveSignalScopes: [],
    taskPlanTitles: []
  };

  // 1. Load latest triage artifact for existing classifications
  const triagePrefix = `client-board-triage__${clientCode.toLowerCase()}__`;
  const watchPrefix = `client-board-watch__`;
  try {
    const files = fs.readdirSync(ARTIFACT_DIR)
      .filter((f) => (f.startsWith(triagePrefix) || f.startsWith(watchPrefix)) && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(path.join(ARTIFACT_DIR, files[0]), 'utf8'));
      const items = data.items || data.tasks || [];
      for (const item of items) {
        if (item.id) context.existingTriageMap[item.id] = item;
      }
    }
  } catch { /* no prior triage */ }

  // 2. Load active workstreams
  const wsPath = path.join(ARTIFACT_DIR, 'plan-active-workstreams.next-step.json');
  try {
    if (fs.existsSync(wsPath)) {
      const ws = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
      if (Array.isArray(ws.active_queues)) {
        context.activeWorkstreams = ws.active_queues.map((q) => ({
          name: q.name || q.label || '',
          keyword: (q.name || q.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          taskIds: q.task_ids || []
        }));
      }
    }
  } catch { /* no workstreams */ }

  // 3. Scan live signals for signal scopes (helps detect in-flight work)
  try {
    if (fs.existsSync(SIGNAL_DIR)) {
      const files = fs.readdirSync(SIGNAL_DIR).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        try {
          const sig = JSON.parse(fs.readFileSync(path.join(SIGNAL_DIR, f), 'utf8'));
          if (sig.schema === 'HandoffSignal/1.0' && sig.lifecycle_state === 'live') {
            if (sig.signal_scope) context.liveSignalScopes.push(sig.signal_scope);
            if (sig.scope) context.liveSignalScopes.push(sig.scope);
          }
        } catch { /* skip bad signal */ }
      }
    }
  } catch { /* no signals */ }

  // 4. Scan task-plan artifacts for in-progress planning (system + client roots)
  try {
    const { listAllTaskPlans } = require('../../planning/lib/resolve-task-plan');
    const allPlans = listAllTaskPlans(projectRoot);
    for (const entry of allPlans) {
      try {
        const plan = JSON.parse(fs.readFileSync(entry.jsonPath, 'utf8'));
        if (plan.title) context.taskPlanTitles.push(plan.title.toLowerCase());
        if (plan.task_summary) context.taskPlanTitles.push(plan.task_summary.toLowerCase());
      } catch { /* skip bad plan */ }
    }
  } catch { /* no task-plans */ }

  return context;
}

/**
 * Tokenize a title into meaningful keywords for fuzzy matching.
 */
function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .filter((w) => !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this',
  'are', 'was', 'been', 'has', 'have', 'had', 'not', 'but',
  'all', 'can', 'will', 'new', 'add', 'get', 'set', 'use',
  'also', 'each', 'when', 'how', 'its', 'our', 'per', 'any'
]);

/**
 * Compute token overlap score between two strings.
 * Returns 0-1 (1 = perfect match on meaningful keywords).
 */
function tokenOverlap(a, b) {
  const tokensA = tokenize(a);
  const tokensB = new Set(tokenize(b));
  if (tokensA.length === 0 || tokensB.size === 0) return 0;
  const matches = tokensA.filter((t) => tokensB.has(t)).length;
  return matches / Math.max(tokensA.length, tokensB.size);
}

/**
 * Classify a Dart task using repo context for smarter auto-sorting.
 *
 * Classification priority:
 * 1. Preserve prior LLM classification if unchanged task
 * 2. Completed/done status → ignore
 * 3. Decision Needed status → needs_clarification
 * 4. Blocked status → blocked
 * 5. High overlap with active workstream or task plan → update_existing
 * 6. High overlap with live signal scope → update_existing
 * 7. Currently "Doing" → update_existing (already in progress)
 * 8. Default → plan_first
 *
 * @param {object} task - Normalized Dart task { id, title, status, description, assignee, priority }
 * @param {object} repoContext - From gatherRepoContext()
 * @returns {object} { ...task, classification, summary, overlap, match_source }
 */
function classifyTask(task, repoContext = {}) {
  const title = (task.title || '').toLowerCase();
  const status = (task.status || '').toLowerCase();
  const existingMap = repoContext.existingTriageMap || {};

  // 1. Preserve prior classification if task title + status unchanged
  const prior = existingMap[task.id];
  if (prior && prior.classification) {
    const titleMatch = (prior.title || '').toLowerCase() === title;
    const statusMatch = !prior.status || (prior.status || '').toLowerCase() === status;
    if (titleMatch && statusMatch) {
      return {
        ...task,
        classification: prior.classification,
        summary: prior.summary || task.title,
        overlap: prior.overlap || '',
        match_source: 'prior_triage'
      };
    }
  }

  // 2. Completed → ignore
  if (status.includes('done') || status.includes('complete') || status.includes('finished')) {
    return { ...task, classification: 'ignore', summary: task.title, overlap: '', match_source: 'status' };
  }

  // 3. Decision Needed → needs_clarification
  if (status.includes('decision')) {
    return { ...task, classification: 'needs_clarification', summary: task.title, overlap: '', match_source: 'status' };
  }

  // 4. Blocked → blocked
  if (status.includes('block') && !status.includes('unblock')) {
    return { ...task, classification: 'blocked', summary: task.title, overlap: '', match_source: 'status' };
  }

  // 5. Check overlap with active workstreams (token matching)
  const activeWorkstreams = repoContext.activeWorkstreams || [];
  for (const ws of activeWorkstreams) {
    if ((ws.taskIds || []).includes(task.id)) {
      return { ...task, classification: 'update_existing', summary: task.title, overlap: ws.name, match_source: 'workstream_id' };
    }
    if (ws.keyword && tokenOverlap(task.title, ws.name) > 0.4) {
      return { ...task, classification: 'update_existing', summary: task.title, overlap: ws.name, match_source: 'workstream_keyword' };
    }
  }

  // 6. Check overlap with task plan titles
  const taskPlanTitles = repoContext.taskPlanTitles || [];
  for (const planTitle of taskPlanTitles) {
    if (tokenOverlap(task.title, planTitle) > 0.4) {
      return { ...task, classification: 'update_existing', summary: task.title, overlap: `task plan: ${planTitle}`, match_source: 'task_plan' };
    }
  }

  // 7. Check overlap with live signal scopes
  const liveScopes = repoContext.liveSignalScopes || [];
  for (const scope of liveScopes) {
    if (tokenOverlap(task.title, scope) > 0.35) {
      return { ...task, classification: 'update_existing', summary: task.title, overlap: `signal: ${scope}`, match_source: 'live_signal' };
    }
  }

  // 8. Currently in progress → update_existing
  if (status.includes('doing') || status.includes('in progress') || status.includes('in-progress')) {
    return { ...task, classification: 'update_existing', summary: task.title, overlap: 'currently in progress', match_source: 'status' };
  }

  // 9. Default → plan_first
  return { ...task, classification: 'plan_first', summary: task.title, overlap: '', match_source: 'default' };
}

// ─── Overlap and dedupe detection ──────────────────────────────────────────

/**
 * Detect near-duplicate items within a single board.
 * Two items are near-duplicates if their title token overlap > threshold.
 *
 * @param {object[]} tasks - Array of normalized Dart tasks
 * @param {number} [threshold=0.6] - Token overlap threshold
 * @returns {Array<{ a: object, b: object, score: number }>}
 */
function detectIntraBoardDuplicates(tasks, threshold = 0.6) {
  const pairs = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const score = tokenOverlap(tasks[i].title, tasks[j].title);
      if (score >= threshold) {
        pairs.push({ a: tasks[i], b: tasks[j], score });
      }
    }
  }
  return pairs;
}

/**
 * Detect parent/subtask relationships in a Dart task set.
 * Tasks with a parentId that matches another task's id are subtasks.
 *
 * @param {object[]} tasks - Array of Dart tasks (with parentId field)
 * @returns {Map<string, string[]>} Map of parent id → array of child ids
 */
function detectParentChildRelationships(tasks) {
  const map = new Map();
  const taskIds = new Set(tasks.map((t) => t.id));

  for (const task of tasks) {
    const parentId = task.parentId || task.parent_id || '';
    if (parentId && taskIds.has(parentId)) {
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId).push(task.id);
    }
  }
  return map;
}

/**
 * Check if a task overlaps with items in a project task index.
 *
 * @param {object} task - Normalized Dart task
 * @param {string} projectRoot
 * @param {string} clientCode
 * @returns {{ overlaps: boolean, source: string, detail: string }[]}
 */
function checkProjectTaskOverlap(task, projectRoot, clientCode) {
  const fs = require('fs');
  const path = require('path');
  const overlaps = [];

  // Scan client project directories for task indexes
  const clientDir = path.join(projectRoot, 'clients', clientCode);
  try {
    if (!fs.existsSync(clientDir)) return overlaps;
    const projects = fs.readdirSync(clientDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'tools' && d.name !== 'shared');

    for (const proj of projects) {
      const indexPath = path.join(clientDir, proj.name, 'project.json');
      if (!fs.existsSync(indexPath)) continue;

      try {
        const projectData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        // Check if any linked task IDs match
        const linkedIds = projectData.linked_task_ids || projectData.dart_task_ids || [];
        if (linkedIds.includes(task.id)) {
          overlaps.push({
            overlaps: true,
            source: `project:${proj.name}`,
            detail: `Task ${task.id} is linked in project ${proj.name}`
          });
        }
        // Check title overlap with project name/description
        const projectTitle = (projectData.name || projectData.title || proj.name).toLowerCase();
        if (tokenOverlap(task.title, projectTitle) > 0.4) {
          overlaps.push({
            overlaps: true,
            source: `project:${proj.name}`,
            detail: `Title overlap with project "${projectTitle}"`
          });
        }
      } catch { /* skip bad project */ }
    }
  } catch { /* no client dir */ }

  return overlaps;
}

// ─── Artifact schema ───────────────────────────────────────────────────────

/**
 * Standard artifact schema version. Both /triage-client-board and the watcher
 * must produce artifacts conforming to this schema.
 */
const TRIAGE_ARTIFACT_SCHEMA = 'ClientBoardTriage/1.0';

/**
 * Build a standardized triage artifact JSON object.
 * Used by both the watcher and /triage-client-board to ensure format consistency.
 *
 * @param {object} opts
 * @param {string} opts.source - 'watcher' or 'triage-command'
 * @param {string} opts.client_code
 * @param {string} opts.board_name
 * @param {string} [opts.scope]
 * @param {object[]} opts.items - Classified items
 * @param {object} [opts.deltas] - Delta report from detectDeltas()
 * @param {object[]} [opts.duplicates] - From detectIntraBoardDuplicates()
 * @param {object} [opts.parent_child_map] - From detectParentChildRelationships()
 * @returns {object} Standardized triage artifact
 */
function buildTriageArtifact(opts) {
  const counts = {};
  for (const c of CLASSIFICATIONS) counts[c] = 0;
  for (const item of opts.items) counts[item.classification]++;

  return {
    schema: TRIAGE_ARTIFACT_SCHEMA,
    source: opts.source,
    timestamp: new Date().toISOString(),
    client_code: opts.client_code,
    board_name: opts.board_name,
    scope: opts.scope || '',
    item_count: opts.items.length,
    classification_counts: counts,
    material_change: opts.deltas ? opts.deltas.materialChange : true,
    delta_summary: opts.deltas ? opts.deltas.summary : 'Initial scan',
    deltas: opts.deltas ? {
      new_items: opts.deltas.newItems.map((i) => ({ id: i.id, title: i.title, classification: i.classification })),
      removed_ids: opts.deltas.removedIds,
      reclassified: opts.deltas.reclassified.map((i) => ({ id: i.id, title: i.title, classification: i.classification })),
      new_actionable: opts.deltas.newActionable.map((i) => ({ id: i.id, title: i.title, classification: i.classification })),
      new_blocked: opts.deltas.newBlocked.map((i) => ({ id: i.id, title: i.title, classification: i.classification }))
    } : null,
    duplicates: (opts.duplicates || []).map((d) => ({
      a: { id: d.a.id, title: d.a.title },
      b: { id: d.b.id, title: d.b.title },
      score: d.score
    })),
    items: opts.items.map((i) => ({
      id: i.id,
      title: i.title,
      classification: i.classification,
      summary: i.summary || i.title,
      status: i.status || '',
      priority: i.priority || '',
      assignee: i.assignee || '',
      overlap: i.overlap || '',
      match_source: i.match_source || '',
      parent_id: i.parentId || i.parent_id || '',
      next_command: formatHandoff(i.classification, i.summary || i.title, opts.client_code) || null
    }))
  };
}

/**
 * Read the latest triage artifact for a client+board.
 * Searches both watcher and triage-command artifacts.
 *
 * @param {string} projectRoot
 * @param {string} clientCode
 * @param {string} [boardName] - Optional board name filter
 * @returns {{ artifact: object, path: string } | null}
 */
function readLatestTriageArtifact(projectRoot, clientCode, boardName) {
  const fs = require('fs');
  const path = require('path');
  const ARTIFACT_DIR = path.join(projectRoot, '_dev/reports/analysis');

  const clientLower = clientCode.toLowerCase();
  try {
    const files = fs.readdirSync(ARTIFACT_DIR)
      .filter((f) => {
        if (!f.endsWith('.json')) return false;
        if (f.startsWith(`client-board-triage__${clientLower}__`)) return true;
        if (f.startsWith(`client-board-watch__${clientLower}__`)) return true;
        if (boardName) {
          const boardKey = `${clientLower}__${boardName.replace(/\s+/g, '-').toLowerCase()}`;
          if (f.startsWith(`client-board-watch__${boardKey}__`)) return true;
        }
        return false;
      })
      .sort()
      .reverse();

    if (files.length === 0) return null;
    const filePath = path.join(ARTIFACT_DIR, files[0]);
    return {
      artifact: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      path: filePath
    };
  } catch {
    return null;
  }
}

// ─── Dart writeback payloads ───────────────────────────────────────────────

function buildDecisionNeededComment(item) {
  const decision = item.decision_needed || item.question || item.overlap || item.summary || 'missing decision context';
  const why = item.decision_why || item.why_it_matters || item.rationale || 'work cannot be scoped or advanced until this is answered';
  const response = item.decision_response_needed || item.next_input_needed || 'reply with the chosen direction or the missing requirement';

  return [
    `Decision needed: ${decision}`,
    `Why it matters: ${why}`,
    `Needed to unblock: ${response}`
  ].join('\n');
}

/**
 * Build a Dart writeback payload for a classified intake item.
 * This produces the payload — the caller is responsible for confirmation gates.
 *
 * @param {object} item - Classified triage item
 * @param {string} clientCode
 * @param {object} [planContext] - Optional plan context if /plan-task was run
 * @returns {object} Writeback payload with action, comment_body, and metadata
 */
function buildWritebackPayload(item, clientCode, planContext) {
  const base = {
    task_id: item.id,
    task_title: item.title,
    client_code: clientCode,
    timestamp: new Date().toISOString()
  };

  switch (item.classification) {
    case 'pick_up_now':
    case 'plan_first': {
      if (planContext) {
        const framework = planContext.framework || 'TBD';
        const runCmd = planContext.run_command || `/run-plan ${item.id}`;
        return {
          ...base,
          action: 'add_comment',
          comment_type: 'planning_breadcrumb',
          comment_body: `Plan ready → ${framework}\nRun: \`${runCmd}\``,
          status_update: null
        };
      }
      return {
        ...base,
        action: 'add_comment',
        comment_type: 'planning_breadcrumb',
        comment_body: `Planning started`,
        status_update: null
      };
    }
    case 'needs_clarification':
      return {
        ...base,
        action: 'add_comment',
        comment_type: 'clarification_request',
        comment_body: buildDecisionNeededComment(item),
        status_update: 'Decision Needed'
      };
    case 'blocked':
      return {
        ...base,
        action: 'add_comment',
        comment_type: 'blocker_note',
        comment_body: `Blocked: ${item.overlap || 'dependency not met'}`,
        status_update: null
      };
    case 'update_existing':
      return {
        ...base,
        action: 'add_comment',
        comment_type: 'merge_note',
        comment_body: `Overlaps existing work: ${item.overlap || 'related work in progress'}`,
        status_update: null
      };
    default:
      return null;
  }
}

/**
 * Build an evidence/closeout writeback payload for a completed item.
 *
 * @param {string} taskId - Dart task ID
 * @param {string} title - Task title
 * @param {object} evidence - { commit_hash, artifact_paths, summary }
 * @returns {object} Writeback payload
 */
function buildCloseoutWriteback(taskId, title, evidence) {
  return {
    task_id: taskId,
    task_title: title,
    timestamp: new Date().toISOString(),
    action: 'update_description_footer',
    comment_type: 'evidence',
    comment_body: `**Evidence:** [${evidence.commit_hash}](${evidence.commit_url || ''})\n\n${evidence.summary || ''}`,
    description_footer: `**Evidence:** [${evidence.commit_hash}](${evidence.commit_url || ''})`,
    artifact_paths: evidence.artifact_paths || [],
    status_update: 'Done'
  };
}

module.exports = {
  CLASSIFICATIONS,
  ACTIONABLE_CLASSIFICATIONS,
  BLOCKED_CLASSIFICATIONS,
  HANDOFF_MAP,
  TRIAGE_ARTIFACT_SCHEMA,
  fingerprintItem,
  fingerprintBoard,
  detectDeltas,
  buildBoardState,
  formatHandoff,
  gatherRepoContext,
  classifyTask,
  tokenOverlap,
  detectIntraBoardDuplicates,
  detectParentChildRelationships,
  checkProjectTaskOverlap,
  buildTriageArtifact,
  readLatestTriageArtifact,
  buildDecisionNeededComment,
  buildWritebackPayload,
  buildCloseoutWriteback
};
