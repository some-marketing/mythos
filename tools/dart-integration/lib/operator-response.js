'use strict';

// ---------------------------------------------------------------------------
// operator-response.js — PURE detection engine for the operator-response checker.
//
// Mirrors the relay.js split: this module is pure (a world snapshot in, decisions
// out, no network). The thin Dart IO + side effects live in
// ../operator-response-poller.js.
//
// What it answers: "Since we last looked, has the operator answered any
// Decision-Needed task assigned to them?" An answer is either (a) a NEW comment
// authored by the operator (keyed by comment id — Dart comments carry no
// timestamp) or (b) the task status moving OFF "Decision Needed".
//
// BOUNDED BY DESIGN: this layer only DETECTS and extracts the answer. It never
// executes the resumed work. The poller turns a detected response into a resume
// packet + a handoff-signal file + acknowledgement, which a human or
// /orchestrate-loop picks up.
// ---------------------------------------------------------------------------

const OPERATOR_DEFAULT = process.env.DART_OPERATOR_USER || 'operator'; // human operator's Dart user display name
const AGENT_USER = 'Mythos'; // agent Dart user (mythos-bot@example.com)
const DECISION_STATUS = 'Decision Needed';
const ACTIVE_STATUS = 'Doing';

/** Pull a plan reference embedded in a task description as `Mythos-Plan-Ref: <path>`. */
function extractPlanRef(description) {
  const m = String(description || '').match(/Mythos-Plan-Ref:\s*(\S+)/);
  return m ? m[1] : null;
}

// Secret-shaped tokens are stripped before any operator answer is written to a
// durable artifact (resume packet, signal) or posted back. Operator answers can
// contain pasted credentials; durable Mythos artifacts must never carry them.
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z\-_]{20,}/g, // Google API key
  /ya29\.[0-9A-Za-z\-_]+/g, // Google OAuth access token
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style secret key
  /xox[baprs]-[0-9A-Za-z-]{10,}/g, // Slack token
  /gh[pousr]_[0-9A-Za-z]{20,}/g, // GitHub token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(client_secret|refresh_token|access_token|api[_-]?key|password|bearer)\b\s*[:=]\s*\S+/gi,
];

/** Redact secret-shaped substrings from text bound for a durable artifact. */
function redactSecrets(text) {
  let s = String(text || '');
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[REDACTED]');
  return s;
}

/**
 * Detect operator responses across a world snapshot.
 *
 * @param {Object} world
 * @param {Array}  world.tasks            - [{ id, title, status, description, assignees:[], dartboard }]
 * @param {Object} world.commentsByTask   - { [taskId]: [{ id, author, text }] }
 * @param {Object} world.state            - { seen: { [taskId]: { status, ackedCommentIds:[] } } }
 * @param {Object} [opts]
 * @param {string}  [opts.operator]       - operator name to match comment authors against
 * @param {boolean} [opts.seedUnknown]    - default true. On first sight of a task
 *                                          (no prior state), record a baseline and
 *                                          do NOT fire — so pre-existing answers that
 *                                          predate the checker are not retroactively
 *                                          "resumed". Only changes after baseline fire.
 * @returns {{ responses: Array, nextState: Object }}
 */
function detectResponses({ tasks = [], commentsByTask = {}, state = {} } = {}, opts = {}) {
  const operator = opts.operator || OPERATOR_DEFAULT;
  const seedUnknown = opts.seedUnknown !== false;
  const seen = (state && state.seen) || {};
  const nextSeen = {};
  const responses = [];

  for (const task of tasks) {
    const id = String(task.id);
    const isKnown = Object.prototype.hasOwnProperty.call(seen, id);
    const prev = seen[id] || { status: null, ackedCommentIds: [] };
    const ackedIds = new Set(prev.ackedCommentIds || []);
    const comments = commentsByTask[id] || [];

    // (a) operator-authored comments we have not acknowledged yet
    const freshOperatorComments = comments.filter(
      (c) => String(c.author || '') === operator && !ackedIds.has(String(c.id)),
    );

    // (b) the task moved off Decision-Needed since we last recorded it as Decision-Needed
    const statusMovedOff = prev.status === DECISION_STATUS && task.status !== DECISION_STATUS;

    // Cold-start: an unknown task is baselined (its current operator comments get
    // acked below) and does not fire. Known tasks fire on change.
    const fireable = isKnown || !seedUnknown;

    if (fireable && (freshOperatorComments.length > 0 || statusMovedOff)) {
      responses.push({
        task_id: id,
        title: task.title || '',
        plan_ref: extractPlanRef(task.description),
        operator,
        dartboard: task.dartboard || '',
        status_before: prev.status,
        status_after: task.status || '',
        status_moved_off_decision: statusMovedOff,
        answer_comments: freshOperatorComments.map((c) => ({ id: String(c.id), text: String(c.text || '') })),
      });
    }

    // Carry forward: record current status and mark fresh operator comment ids acked.
    nextSeen[id] = {
      status: task.status || '',
      ackedCommentIds: Array.from(
        new Set([...(prev.ackedCommentIds || []), ...freshOperatorComments.map((c) => String(c.id))]),
      ),
    };
  }

  // Preserve state for task ids not present in this snapshot (do not forget history).
  for (const id of Object.keys(seen)) {
    if (!(id in nextSeen)) nextSeen[id] = seen[id];
  }

  return { responses, nextState: { seen: nextSeen } };
}

/**
 * Standing rule: the Mythos user owns any active (Doing) task. Returns the
 * assignment actions needed to make that true. Pure — caller applies them.
 *
 * @param {Array} tasks - [{ id, title, status, assignees:[] }]
 * @param {Object} [opts] - { agent, activeStatus }
 * @returns {Array} [{ task_id, title, assign }]
 */
function decideActiveAssignments(tasks = [], opts = {}) {
  const agent = opts.agent || AGENT_USER;
  const active = opts.activeStatus || ACTIVE_STATUS;
  return tasks
    .filter((t) => t.status === active && !(t.assignees || []).map(String).includes(agent))
    // MERGE — never replace. Return the full desired assignee list so the caller
    // adds Mythos without clobbering an existing human assignee.
    .map((t) => ({
      task_id: String(t.id),
      title: t.title || '',
      assignees: Array.from(new Set([...(t.assignees || []).map(String), agent])),
    }));
}

module.exports = {
  OPERATOR_DEFAULT,
  AGENT_USER,
  DECISION_STATUS,
  ACTIVE_STATUS,
  extractPlanRef,
  redactSecrets,
  detectResponses,
  decideActiveAssignments,
};
