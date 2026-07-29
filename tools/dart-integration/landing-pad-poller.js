#!/usr/bin/env node
'use strict';

const dart = require('./lib/dart-api');
const {
  DEFAULT_AGENT_NAME,
  handleLandingPadAgentEvent,
} = require('./lib/landing-pad-agent');

const BOARD_NAME = 'Landing Pad/Tasks';
const SORTER_COMMENT_MARKER = 'Mythos Landing Pad Sorter reviewed this intake';

function parseArgs(argv) {
  const args = {
    watch: false,
    intervalSeconds: 300,
    limit: 50,
    assign: false,
    commentOnly: false,
    json: false,
    dryRun: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--watch') {
      args.watch = true;
    } else if (arg === '--interval-seconds') {
      i += 1;
      args.intervalSeconds = Number(argv[i]);
    } else if (arg === '--limit') {
      i += 1;
      args.limit = Number(argv[i]);
    } else if (arg === '--assign-agent') {
      args.assign = true;
    } else if (arg === '--comment-only') {
      args.commentOnly = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.intervalSeconds) || args.intervalSeconds < 10) {
    throw new Error('--interval-seconds must be at least 10.');
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive number.');
  }

  return args;
}

function help() {
  console.log(`
Poll Landing Pad/Tasks and run the Mythos Landing Pad Sorter as the Mythos Dart user.

This is an outbound Dart API poller. It does not require ngrok.

Usage:
  npm run dart:landing-pad:sort
  npm run dart:landing-pad:watch -- --interval-seconds 300

Options:
  --watch                 Keep polling until stopped
  --interval-seconds <n>  Watch interval; default 300
  --limit <n>             Max open Landing Pad tasks to scan; default 50
  --assign-agent          Also assign to the sorter agent; disabled by default because Dart agent automations may mark tasks Done
  --comment-only          Do not create routed tasks or close source tasks; leave recommendations only
  --dry-run               Report what would be processed without writing Dart
  --json                  Print structured output
  --help                  Show this help
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTask(item) {
  const task = item && item.item ? item.item : item;
  return {
    id: String(task.id || task.duid || ''),
    title: String(task.title || ''),
    assignee: String(task.assignee || ''),
    status: String(task.status || ''),
    dartboard: String(task.dartboard || ''),
    updated_at: String(task.updatedAt || task.updated_at || ''),
  };
}

function commentsFrom(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.results)) return result.results;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

async function hasSorterComment(taskId, deps = dart) {
  const comments = commentsFrom(await deps.listComments(taskId));
  return comments.some((comment) => String(comment.text || '').includes(SORTER_COMMENT_MARKER));
}

async function fetchLandingPadTasks(limit, deps = dart) {
  const result = await deps.listTasks(BOARD_NAME, { is_completed: false, limit });
  const summaries = result && result.results ? result.results : [];
  const tasks = await Promise.all(summaries.map(async (summary) => {
    try {
      return normalizeTask(await deps.getTask(summary.id));
    } catch {
      return normalizeTask(summary);
    }
  }));
  return tasks.filter((task) => task.id);
}

async function processTask(task, options, deps = dart) {
  const alreadyReviewed = await hasSorterComment(task.id, deps);
  if (alreadyReviewed) {
    return {
      task_id: task.id,
      title: task.title,
      action: 'skipped',
      reason: 'already reviewed',
    };
  }

  if (options.dryRun) {
    return {
      task_id: task.id,
      title: task.title,
      action: 'would_sort',
      assign_to: options.assign ? DEFAULT_AGENT_NAME : null,
    };
  }

  let assigned = false;
  if (options.assign && task.assignee !== DEFAULT_AGENT_NAME) {
    await deps.updateTask(task.id, {
      id: task.id,
      assignee: DEFAULT_AGENT_NAME,
    });
    assigned = true;
  }

  const result = await handleLandingPadAgentEvent(
    { task: { id: task.id } },
    { dart: deps },
    { mode: options.commentOnly ? 'poller comment-only' : 'poller routed-task' },
  );

  return {
    task_id: task.id,
    title: result.title,
    action: result.routed_task_id ? 'routed' : 'commented',
    assigned,
    classification: result.classification.classification,
    confidence: result.classification.confidence.tier,
    target_board: result.classification.routing.target_board,
    routed_task_id: result.routed_task_id,
    routed_task_board: result.routed_task_board,
    source_status: result.source_status,
    commented: result.commented,
  };
}

async function runOnce(options, deps = dart) {
  const tasks = await fetchLandingPadTasks(options.limit, deps);
  const results = [];
  for (const task of tasks) {
    results.push(await processTask(task, options, deps));
  }
  return {
    ok: true,
    board: BOARD_NAME,
    scanned: tasks.length,
    processed: results.filter((result) => result.action === 'routed' || result.action === 'commented').length,
    routed: results.filter((result) => result.action === 'routed').length,
    commented: results.filter((result) => result.action === 'commented').length,
    skipped: results.filter((result) => result.action === 'skipped').length,
    dry_run: options.dryRun,
    results,
  };
}

function printSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`Landing Pad scan: ${summary.scanned} task(s), ${summary.routed} routed, ${summary.commented} commented, ${summary.skipped} skipped.`);
  for (const result of summary.results) {
    if (result.action === 'routed') {
      console.log(`- routed ${result.task_id}: created ${result.routed_task_id} on ${result.routed_task_board}`);
    } else if (result.action === 'commented') {
      console.log(`- commented ${result.task_id}: ${result.classification} -> ${result.target_board || 'review'}`);
    } else if (result.action === 'would_sort') {
      console.log(`- would sort ${result.task_id}: ${result.title}`);
    } else {
      console.log(`- skipped ${result.task_id}: ${result.reason}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }

  do {
    const summary = await runOnce(args);
    printSummary(summary, args);
    if (!args.watch) break;
    await sleep(args.intervalSeconds * 1000);
  } while (true);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  BOARD_NAME,
  SORTER_COMMENT_MARKER,
  fetchLandingPadTasks,
  hasSorterComment,
  processTask,
  runOnce,
};
