#!/usr/bin/env node
'use strict';

const dart = require('./lib/dart-api');
const { verifyDartIdentity } = require('./lib/identity');
const {
  DEFAULT_AGENT_ASSIGNEE,
  DEFAULT_ASSIGNEE,
  DEFAULT_LIMIT,
  buildInbox,
  formatInbox,
} = require('./lib/inbox');

function parseArgs(argv) {
  const args = {
    assignee: DEFAULT_ASSIGNEE,
    limit: DEFAULT_LIMIT,
    json: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--assignee') {
      i += 1;
      args.assignee = argv[i] || args.assignee;
    } else if (arg === '--limit') {
      i += 1;
      args.limit = Number(argv[i] || args.limit);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    throw new Error('--limit must be a positive number');
  }

  return args;
}

function help() {
  console.log(`
List the Mythos Dart inbox from the repo-local Dart API token.

Usage:
  node tools/dart-integration/inbox.js [--json] [--limit 100]

Options:
  --json             Print machine-readable output
  --assignee <name>  Assignee to query (default: Mythos)
  --limit <n>        Max tasks to fetch (default: 100)

This command is read-only. It verifies the Dart API token is authenticated as
Mythos <mythos-bot@example.com> before reporting the inbox.
`.trim());
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }

  const config = await dart.getConfig();
  const identity = verifyDartIdentity(config);
  if (!identity.ok) {
    throw new Error(`Refusing inbox read. ${identity.reason}`);
  }

  const allTasks = [];
  const pushResults = (result) => {
    const tasks = result && result.results ? result.results : [];
    allTasks.push(...tasks);
  };

  pushResults(await dart.listTasks(null, {
    assignee: args.assignee,
    is_completed: false,
    limit: args.limit,
  }));

  if (args.assignee === DEFAULT_ASSIGNEE) {
    pushResults(await dart.listTasks(null, {
      assignee: DEFAULT_AGENT_ASSIGNEE,
      is_completed: false,
      limit: args.limit,
    }));
  }

  pushResults(await dart.listTasks(null, {
    status: 'Decision Needed',
    is_completed: false,
    limit: args.limit,
  }));

  const mythosBoards = (config.dartboards || []).filter((board) => board.startsWith('Mythos/'));
  for (const board of mythosBoards) {
    pushResults(await dart.listTasks(board, {
      limit: args.limit,
    }));
  }

  const byId = new Map();
  for (const task of allTasks) {
    if (task && task.id && !byId.has(task.id)) byId.set(task.id, task);
  }

  await Promise.all(Array.from(byId.values()).map(async (task) => {
    try {
      const commentsResult = await dart.listComments(task.id);
      task.comments = commentsResult && commentsResult.results ? commentsResult.results : [];
    } catch {
      task.comments = [];
    }
  }));

  const inbox = buildInbox(Array.from(byId.values()), {
    assignee: args.assignee,
    assigneeAliases: args.assignee === DEFAULT_ASSIGNEE ? [DEFAULT_AGENT_ASSIGNEE] : [],
  });

  if (args.json) {
    console.log(JSON.stringify({
      identity,
      inbox,
    }, null, 2));
  } else {
    console.log(formatInbox(inbox));
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
