'use strict';

const path = require('path');

const {
  classifyLandingPadTask,
  loadRoutingTable,
} = require('./landing-pad-classifier');
const {
  normalizeTaskContent,
} = require('./task-content-normalizer');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_AGENT_NAME = 'Mythos Landing Pad Sorter';
const DEFAULT_SOURCE_BOARD = 'Landing Pad/Tasks';
const DEFAULT_SOURCE_DONE_STATUS = 'Done';

function extractTaskId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(
    payload.taskId ||
    payload.task_id ||
    (payload.task && (payload.task.id || payload.task.duid)) ||
    (payload.data && payload.data.task && (payload.data.task.id || payload.data.task.duid)) ||
    (payload.body && payload.body.task && (payload.body.task.id || payload.body.task.duid)) ||
    ''
  ).trim();
}

function normalizeDartTask(task) {
  const item = task && task.item ? task.item : task;
  return {
    id: String(item.id || item.duid || ''),
    title: String(item.title || ''),
    status: String(item.status || ''),
    description: String(item.description || ''),
    assignee: String(item.assignee || ''),
    priority: String(item.priority || ''),
    updated_at: String(item.updatedAt || item.updated_at || ''),
    dartboard: String(item.dartboard || ''),
    tags: item.tags || [],
  };
}

function classifyTask(task, options = {}) {
  const routingTable = options.routingTable || loadRoutingTable(options.projectRoot || PROJECT_ROOT);
  const normalizedTask = normalizeDartTask(task);
  const classification = classifyLandingPadTask(normalizedTask, routingTable);
  const normalizedContent = normalizeTaskContent(normalizedTask);
  classification.normalized = {
    title: normalizedContent.title,
    description: normalizedContent.description,
    changed: normalizedContent.changed,
  };
  return classification;
}

function actionLine(classification) {
  if (classification.classification === 'route_to_board') {
    return `Create a routed task on \`${classification.routing.target_board}\`, then close the Landing Pad intake.`;
  }
  if (classification.classification === 'needs_review') {
    return 'Keep in Landing Pad and ask for one routing decision.';
  }
  if (classification.classification === 'no_work') {
    return 'No task creation needed; summarize and mark Done after human review.';
  }
  return 'Keep in Landing Pad; no reliable route found.';
}

function shouldCreateRoutedTask(classification) {
  return Boolean(
    classification &&
    classification.classification === 'route_to_board' &&
    classification.routing &&
    classification.routing.target_board
  );
}

function buildRecursiveTaskKernel(sourceTask, classification) {
  const targetBoard = classification.routing && classification.routing.target_board
    ? classification.routing.target_board
    : 'unresolved Dart board';
  const targetClient = classification.routing && classification.routing.target_client
    ? classification.routing.target_client
    : 'unresolved client';
  const shape = classification.brief_or_deliverable || 'brief';

  if (classification.classification === 'route_to_board') {
    return {
      currentState: `Landing Pad intake \`dart:${sourceTask.id}\` has been classified for ${targetClient} and can be routed to \`${targetBoard}\`.`,
      questionWork: `What is the one ${shape} workstream this intake should become on the target board?`,
      desiredState: `A routed Dart task exists on \`${targetBoard}\`, the source intake is closed, and any further questions are handled inside the routed task.`,
    };
  }

  if (classification.classification === 'needs_review') {
    return {
      currentState: `Landing Pad intake \`dart:${sourceTask.id}\` has routing ambiguity.`,
      questionWork: 'Which board, client, or existing workstream should own this intake?',
      desiredState: 'The intake has one resolved owner, or it is explicitly left in Landing Pad with the blocking question named.',
    };
  }

  if (classification.classification === 'no_work') {
    return {
      currentState: `Landing Pad intake \`dart:${sourceTask.id}\` appears informational only.`,
      questionWork: 'Does this intake require any tracked follow-up work?',
      desiredState: 'No routed task is created unless a human operator identifies a concrete work question.',
    };
  }

  return {
    currentState: `Landing Pad intake \`dart:${sourceTask.id}\` could not be routed automatically.`,
    questionWork: 'What is the missing signal needed to classify this intake?',
    desiredState: 'The intake is retained with the exact missing routing signal recorded.',
  };
}

function formatTaskKernel(kernel) {
  return [
    '## Current State',
    kernel.currentState,
    '',
    '## Question / Work',
    kernel.questionWork,
    '',
    '## Desired State',
    kernel.desiredState,
  ].join('\n');
}

function buildRoutedTaskDescription(sourceTask, classification) {
  const normalized = classification.normalized || {};
  const body = String(normalized.description || sourceTask.description || '').trim();
  const kernel = buildRecursiveTaskKernel(sourceTask, classification);
  const lines = [
    formatTaskKernel(kernel),
  ];

  if (body) {
    lines.push('', '## Source Intake', body);
  }

  lines.push(
    '',
    '---',
    `Source: ${DEFAULT_SOURCE_BOARD}`,
    `Source task: dart:${sourceTask.id}`,
    `Routed by: ${DEFAULT_AGENT_NAME}`,
    `Routing reason: ${classification.confidence.rationale}`,
  );

  if (classification.routing.target_client) {
    lines.push(`Target client: ${classification.routing.target_client}`);
  }
  if (classification.brief_or_deliverable) {
    lines.push(`Suggested task shape: ${classification.brief_or_deliverable}`);
  }
  if (normalized.changed) {
    lines.push('Content cleanup: forwarded/reply artifacts were normalized before creating this task.');
  }

  return lines.join('\n');
}

function buildRoutedTaskItem(sourceTask, classification) {
  const normalized = classification.normalized || {};
  const item = {
    title: String(normalized.title || sourceTask.title || 'Routed Landing Pad intake').trim(),
    dartboard: classification.routing.target_board,
    status: 'To-do',
    description: buildRoutedTaskDescription(sourceTask, classification),
  };

  if (sourceTask.priority) item.priority = sourceTask.priority;
  if (Array.isArray(sourceTask.tags) && sourceTask.tags.length > 0) item.tags = sourceTask.tags;
  return item;
}

function formatRoutedTaskSourceComment(sourceTask, classification) {
  const kernel = buildRecursiveTaskKernel(sourceTask, classification);
  return [
    `Created from Landing Pad intake \`dart:${sourceTask.id}\`.`,
    `Question / Work: ${kernel.questionWork}`,
    `Routing confidence: ${classification.confidence.tier} (${Math.round((classification.confidence.score || 0) * 100)}%)`,
    `Routing reason: ${classification.confidence.rationale}`,
  ].join('\n');
}

function formatSorterComment(classification, options = {}) {
  const mode = options.mode || 'dry-run';
  const agentName = options.agentName || DEFAULT_AGENT_NAME;
  const confidencePct = Math.round((classification.confidence.score || 0) * 100);
  const lines = [
    `**${agentName} reviewed this intake.**`,
    '',
    `Mode: ${mode}`,
    `Recommendation: ${actionLine(classification)}`,
    `Classification: \`${classification.classification}\``,
    `Confidence: ${classification.confidence.tier} (${confidencePct}%)`,
    `Reason: ${classification.confidence.rationale}`,
    `Work decision: \`${classification.work_decision}\``,
  ];

  if (classification.routing.target_client) {
    lines.push(`Target client: \`${classification.routing.target_client}\``);
  }
  if (classification.routing.target_board) {
    lines.push(`Target board: \`${classification.routing.target_board}\``);
  }
  if (classification.brief_or_deliverable) {
    lines.push(`Suggested task shape: \`${classification.brief_or_deliverable}\``);
  }
  const kernel = buildRecursiveTaskKernel({ id: options.sourceTaskId || 'source' }, classification);
  lines.push(
    '',
    'Recursive task kernel:',
    `- Current State: ${kernel.currentState}`,
    `- Question / Work: ${kernel.questionWork}`,
    `- Desired State: ${kernel.desiredState}`,
  );
  if (classification.normalized && classification.normalized.changed) {
    lines.push('Content cleanup: forwarded/reply artifacts detected; use normalized content before creating follow-on tasks.');
  }

  if (options.routedTask) {
    lines.push(
      '',
      `Created routed task: \`${options.routedTask.id}\` on \`${options.routedTask.dartboard}\`.`,
      `Landing Pad source status: \`${options.sourceStatus || DEFAULT_SOURCE_DONE_STATUS}\`.`,
    );
  } else {
    lines.push('', 'No routed task was created; keep this intake in Landing Pad for review.');
  }
  return lines.join('\n');
}

async function handleLandingPadAgentEvent(payload, deps, options = {}) {
  const taskId = extractTaskId(payload);
  if (!taskId) {
    const error = new Error('Dart agent payload did not include a task id.');
    error.statusCode = 400;
    throw error;
  }

  const rawTask = await deps.dart.getTask(taskId);
  const task = normalizeDartTask(rawTask);
  if (!task.id) {
    const error = new Error(`Dart task ${taskId} could not be normalized.`);
    error.statusCode = 502;
    throw error;
  }

  const classification = classifyTask(task, options);
  let routedTask = null;

  if (!options.commentOnly && shouldCreateRoutedTask(classification)) {
    const created = await deps.dart.createTask(buildRoutedTaskItem(task, classification));
    routedTask = normalizeDartTask(created);
    if (!routedTask.id) {
      const error = new Error(`Created routed task for ${task.id} could not be normalized.`);
      error.statusCode = 502;
      throw error;
    }
  }

  const sourceStatus = options.sourceStatus || DEFAULT_SOURCE_DONE_STATUS;
  const comment = formatSorterComment(classification, {
    ...options,
    sourceTaskId: task.id,
    routedTask,
    sourceStatus,
  });

  if (!options.noComment) {
    if (routedTask) {
      await deps.dart.addComment(routedTask.id, formatRoutedTaskSourceComment(task, classification));
    }
    await deps.dart.addComment(task.id, comment);
  }

  if (routedTask && !options.noSourceUpdate) {
    await deps.dart.updateTask(task.id, {
      id: task.id,
      status: sourceStatus,
    });
  }

  return {
    ok: true,
    task_id: task.id,
    title: task.title,
    dartboard: task.dartboard,
    classification,
    routed_task_id: routedTask ? routedTask.id : null,
    routed_task_title: routedTask ? routedTask.title : null,
    routed_task_board: routedTask ? routedTask.dartboard : null,
    source_status: routedTask && !options.noSourceUpdate ? sourceStatus : task.status,
    comment,
    commented: !options.noComment,
  };
}

module.exports = {
  DEFAULT_AGENT_NAME,
  DEFAULT_SOURCE_BOARD,
  DEFAULT_SOURCE_DONE_STATUS,
  actionLine,
  buildRoutedTaskDescription,
  buildRoutedTaskItem,
  buildRecursiveTaskKernel,
  classifyTask,
  extractTaskId,
  formatTaskKernel,
  formatRoutedTaskSourceComment,
  formatSorterComment,
  handleLandingPadAgentEvent,
  normalizeDartTask,
  shouldCreateRoutedTask,
};
