'use strict';

const {
  DEFAULT_SOURCE_BOARD,
  extractTaskId,
  handleLandingPadAgentEvent,
  normalizeDartTask,
} = require('./landing-pad-agent');

const SORTER_COMMENT_MARKER = 'Mythos Landing Pad Sorter reviewed this intake';
const DEFAULT_EVENT_TYPE = 'dart.event';

function normalizeBridgeEvent(payload = {}) {
  const data = payload.client_payload || payload.data || payload;
  return {
    event_type: String(
      data.event_type ||
      data.eventType ||
      payload.event_type ||
      DEFAULT_EVENT_TYPE
    ),
    task_id: extractTaskId(data),
    comment_id: String(data.comment_id || data.commentId || (data.comment && data.comment.id) || ''),
    raw: data,
  };
}

function commentsFrom(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.results)) return result.results;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

async function hasSorterComment(dart, taskId) {
  const comments = commentsFrom(await dart.listComments(taskId));
  return comments.some((comment) => String(comment.text || '').includes(SORTER_COMMENT_MARKER));
}

async function handleBridgeEvent(payload, deps, options = {}) {
  if (!deps || !deps.dart) {
    throw new Error('handleBridgeEvent requires deps.dart.');
  }

  const event = normalizeBridgeEvent(payload);
  if (!event.task_id) {
    return {
      ok: true,
      action: 'ignored',
      reason: 'no task id in event',
      event_type: event.event_type,
    };
  }

  const rawTask = await deps.dart.getTask(event.task_id);
  const task = normalizeDartTask(rawTask);
  if (!task.id) {
    throw new Error(`Dart task ${event.task_id} could not be normalized.`);
  }

  if (task.dartboard === DEFAULT_SOURCE_BOARD) {
    if (await hasSorterComment(deps.dart, task.id)) {
      return {
        ok: true,
        action: 'skipped',
        reason: 'already reviewed',
        event_type: event.event_type,
        task_id: task.id,
        title: task.title,
        dartboard: task.dartboard,
      };
    }

    const result = await handleLandingPadAgentEvent(
      { task: { id: task.id } },
      { dart: deps.dart },
      { mode: options.mode || 'cloud bridge dry-run' },
    );

    return {
      ok: true,
      action: 'landing_pad_sorted',
      event_type: event.event_type,
      task_id: result.task_id,
      title: result.title,
      dartboard: result.dartboard,
      classification: result.classification.classification,
      confidence: result.classification.confidence.tier,
      target_board: result.classification.routing.target_board,
      routed_task_id: result.routed_task_id,
      routed_task_board: result.routed_task_board,
      source_status: result.source_status,
      commented: result.commented,
    };
  }

  return {
    ok: true,
    action: 'observed',
    event_type: event.event_type,
    task_id: task.id,
    title: task.title,
    dartboard: task.dartboard,
  };
}

module.exports = {
  DEFAULT_EVENT_TYPE,
  SORTER_COMMENT_MARKER,
  commentsFrom,
  handleBridgeEvent,
  hasSorterComment,
  normalizeBridgeEvent,
};
