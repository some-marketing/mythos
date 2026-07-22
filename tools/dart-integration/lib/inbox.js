'use strict';

const DEFAULT_ASSIGNEE = 'Mythos';
const DEFAULT_AGENT_ASSIGNEE = 'Mythos Landing Pad Sorter';
const DEFAULT_LIMIT = 100;
const DEFAULT_MYTHOS_BOARD_PREFIX = 'Mythos/';
const REVIEWISH_STATUSES = new Set(['Review', 'Done']);
const ACTIVE_STATUSES = new Set(['Doing', 'Review']);

function parseTaskLink(description, label) {
  if (!description) return '';
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i');
  const match = String(description).match(pattern);
  return match ? match[1].trim() : '';
}

function normalizeTask(raw) {
  const description = raw.description || '';
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees
    : (raw.assignee ? [raw.assignee] : []);
  return {
    id: raw.id || '',
    title: raw.title || '(untitled)',
    dartboard: raw.dartboard || '',
    status: raw.status || '',
    priority: raw.priority || '',
    type: raw.type || '',
    assignee: raw.assignee || '',
    assignees,
    dueAt: raw.dueAt || raw.due_at || '',
    updatedAt: raw.updatedAt || raw.updated_at || '',
    url: raw.url || raw.dart_url || '',
    description,
    plan: parseTaskLink(description, 'Plan'),
    context: parseTaskLink(description, 'Context'),
    evidence: parseTaskLink(description, 'Evidence'),
    comments: raw.comments || [],
  };
}

function assigneeNeedles(options = {}) {
  return [
    options.assignee || DEFAULT_ASSIGNEE,
    ...(options.assigneeAliases || []),
  ].map((value) => String(value).toLowerCase()).filter(Boolean);
}

function taskMentionsAgent(task, options = {}) {
  const needles = [
    options.assignee || DEFAULT_ASSIGNEE,
    ...(options.assigneeAliases || []),
    'mythos-bot@example.com',
  ].map((value) => String(value).toLowerCase());
  const haystack = `${task.title}\n${task.description || ''}`.toLowerCase();
  return needles.some((needle) => needle && haystack.includes(needle));
}

function commentMentionsAgent(task, options = {}) {
  const needles = [
    options.assignee || DEFAULT_ASSIGNEE,
    ...(options.assigneeAliases || []),
    'mythos-bot@example.com',
  ].map((value) => String(value).toLowerCase()).filter(Boolean);
  const comments = Array.isArray(task.comments) ? task.comments : [];
  return comments.some((comment) => {
    const text = String(comment.text || '').toLowerCase();
    return needles.some((needle) => text.includes(needle));
  });
}

function latestRelevantComment(task, options = {}) {
  const needles = [
    options.assignee || DEFAULT_ASSIGNEE,
    ...(options.assigneeAliases || []),
    'mythos-bot@example.com',
  ].map((value) => String(value).toLowerCase()).filter(Boolean);
  const comments = Array.isArray(task.comments) ? task.comments : [];
  return comments.find((comment) => {
    const text = String(comment.text || '').toLowerCase();
    return needles.some((needle) => text.includes(needle));
  }) || null;
}

function taskAssignedToAgent(task, options = {}) {
  const needles = assigneeNeedles(options);
  const values = [
    task.assignee,
    ...task.assignees,
  ].map((value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.toLowerCase();
    return `${value.name || ''} ${value.email || ''}`.toLowerCase();
  });
  return values.some((value) => needles.some((needle) => value.includes(needle)));
}

function taskOnMythosBoard(task) {
  return String(task.dartboard || '').startsWith(DEFAULT_MYTHOS_BOARD_PREFIX);
}

function taskRank(task) {
  const statusRank = {
    'Decision Needed': 0,
    Doing: 1,
    'To-do': 2,
  };
  const priorityRank = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return [
    statusRank[task.status] ?? 9,
    priorityRank[String(task.priority).toLowerCase()] ?? 9,
    task.updatedAt ? -Date.parse(task.updatedAt) || 0 : 0,
    task.title,
  ];
}

function compareTasks(a, b) {
  const ar = taskRank(a);
  const br = taskRank(b);
  for (let i = 0; i < ar.length; i += 1) {
    if (ar[i] < br[i]) return -1;
    if (ar[i] > br[i]) return 1;
  }
  return 0;
}

function recommendationForTask(task) {
  const issues = task.collaborationIssues || [];
  if (issues.includes('done_missing_evidence')) {
    return 'Add Git evidence link before treating this as complete.';
  }
  if (issues.includes('evidence_linked_status_not_review_or_done')) {
    return 'Evidence exists; reconcile Dart status with completion state.';
  }
  if (issues.includes('active_missing_context')) {
    return 'Link the Git context before continuing execution.';
  }
  if (task.status === 'Decision Needed') {
    return 'Human decision needed before execution.';
  }
  if (task.status === 'Doing') {
    return task.plan ? 'Continue from linked plan/context.' : 'Inspect task context and continue active work.';
  }
  if (task.status === 'To-do') {
    return task.plan ? 'Review linked plan, then route execution.' : 'Plan or clarify before execution.';
  }
  return 'Inspect status and decide next action.';
}

function collaborationIssues(task) {
  const issues = [];
  if (ACTIVE_STATUSES.has(task.status) && !task.context) {
    issues.push('active_missing_context');
  }
  if (task.status === 'To-do' && !task.plan && !task.context) {
    issues.push('todo_missing_plan_or_context');
  }
  if (REVIEWISH_STATUSES.has(task.status) && !task.evidence) {
    issues.push('done_missing_evidence');
  }
  if (task.evidence && !REVIEWISH_STATUSES.has(task.status)) {
    issues.push('evidence_linked_status_not_review_or_done');
  }
  return issues;
}

function uniqueTasks(tasks) {
  const seen = new Set();
  const result = [];
  for (const task of tasks) {
    if (!task.id || seen.has(task.id)) continue;
    seen.add(task.id);
    result.push(task);
  }
  return result;
}

function buildInbox(tasks, options = {}) {
  const assignee = options.assignee || DEFAULT_ASSIGNEE;
  const normalized = uniqueTasks(tasks.map(normalizeTask)).sort(compareTasks);
  const byStatus = {};

  for (const task of normalized) {
    const status = task.status || '(no status)';
    byStatus[status] = (byStatus[status] || 0) + 1;
    task.assignedToAgent = taskAssignedToAgent(task, options);
    task.mentionsAgent = taskMentionsAgent(task, options) || commentMentionsAgent(task, options);
    task.relevantComment = latestRelevantComment(task, options);
    task.onMythosBoard = taskOnMythosBoard(task);
    task.collaborationIssues = collaborationIssues(task);
    task.recommendation = recommendationForTask(task);
  }

  const assigned = normalized.filter((task) => task.assignedToAgent);
  const mentions = normalized.filter((task) => task.mentionsAgent && !task.assignedToAgent);
  const decisionNeeded = normalized.filter((task) => task.status === 'Decision Needed');
  const linkGaps = normalized.filter((task) => task.collaborationIssues.length > 0);
  const completionMismatches = normalized.filter((task) => (
    task.collaborationIssues.includes('done_missing_evidence') ||
    task.collaborationIssues.includes('evidence_linked_status_not_review_or_done')
  ));

  return {
    assignee,
    count: normalized.length,
    byStatus,
    assignedCount: assigned.length,
    mentionCount: mentions.length,
    decisionNeededCount: decisionNeeded.length,
    linkGapCount: linkGaps.length,
    completionMismatchCount: completionMismatches.length,
    assigned,
    mentions,
    decisionNeeded,
    linkGaps,
    completionMismatches,
    tasks: normalized,
  };
}

function formatTask(task, index) {
  const fields = [
    task.dartboard,
    task.status,
    task.priority ? `priority=${task.priority}` : '',
    task.dueAt ? `due=${task.dueAt}` : '',
  ].filter(Boolean);

  const lines = [
    `${index + 1}. ${task.title}`,
    `   id=${task.id}${fields.length ? ` | ${fields.join(' | ')}` : ''}`,
    `   next=${task.recommendation}`,
  ];

  if (task.collaborationIssues && task.collaborationIssues.length) {
    lines.push(`   issues=${task.collaborationIssues.join(', ')}`);
  }
  if (task.plan) lines.push(`   plan=${task.plan}`);
  if (task.context) lines.push(`   context=${task.context}`);
  if (task.evidence) lines.push(`   evidence=${task.evidence}`);
  if (task.url) lines.push(`   url=${task.url}`);
  if (task.relevantComment) {
    const text = String(task.relevantComment.text || '').replace(/\s+/g, ' ').trim();
    lines.push(`   comment=${text.slice(0, 220)}`);
  }

  return lines.join('\n');
}

function formatSection(title, tasks) {
  const lines = [`${title}: ${tasks.length}`];
  if (tasks.length === 0) return lines.join('\n');
  lines.push(...tasks.map(formatTask));
  return lines.join('\n\n');
}

function formatInbox(inbox) {
  const lines = [
    `Dart Collaboration Inbox: ${inbox.assignee}`,
    `Relevant tasks scanned: ${inbox.count}`,
    `Assigned: ${inbox.assignedCount} | Mentions: ${inbox.mentionCount} | Decisions: ${inbox.decisionNeededCount} | Link gaps: ${inbox.linkGapCount} | Completion mismatches: ${inbox.completionMismatchCount}`,
  ];

  const statusParts = Object.entries(inbox.byStatus)
    .map(([status, count]) => `${status}: ${count}`);
  if (statusParts.length) {
    lines.push(`By status: ${statusParts.join(', ')}`);
  }

  if (inbox.count === 0) {
    lines.push('', 'No relevant Dart collaboration items are currently visible for Mythos.');
    return lines.join('\n');
  }

  lines.push(
    '',
    formatSection('Assigned to Mythos', inbox.assigned),
    '',
    formatSection('Mentions / Conversation Pulls', inbox.mentions),
    '',
    formatSection('Decision Needed', inbox.decisionNeeded),
    '',
    formatSection('Dart-Git Link Gaps', inbox.linkGaps),
    '',
    formatSection('Completion Mismatches', inbox.completionMismatches),
  );
  return lines.join('\n\n');
}

module.exports = {
  DEFAULT_ASSIGNEE,
  DEFAULT_AGENT_ASSIGNEE,
  DEFAULT_LIMIT,
  buildInbox,
  commentMentionsAgent,
  collaborationIssues,
  formatInbox,
  normalizeTask,
  recommendationForTask,
  taskAssignedToAgent,
  taskMentionsAgent,
};
