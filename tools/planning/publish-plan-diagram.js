#!/usr/bin/env node
'use strict';

const dart = require('../dart-integration/lib/dart-api.js');
const {
  EVENT_ENUM,
  writePlanDiagramPublication
} = require('./lib/plan-diagram-publication.cjs');

function requireValue(argv, index, flag) {
  if (index + 1 >= argv.length || String(argv[index + 1] || '').startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return argv[index + 1];
}

function parseArgs(argv) {
  const args = {
    plan: '',
    event: 'manual',
    publishUrl: '',
    includeClient: false,
    force: false,
    applyComment: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      args.plan = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--event') {
      args.event = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--publish-url') {
      args.publishUrl = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--include-client') {
      args.includeClient = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--apply-comment') {
      args.applyComment = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/publish-plan-diagram.js --plan <task-id> [--event <event>] [--publish-url <https-url>] [--apply-comment] [--force] [--include-client]',
    '',
    `Events: ${Array.from(EVENT_ENUM).join(', ')}`,
    '',
    'Writes a PlanDiagramPublication/1.0 packet plus Dart comment draft.',
    'Default is local/dry-run. --apply-comment appends to an existing plan.dart_task_id only; it never creates a Dart task.'
  ].join('\n');
}

async function runPublisher(projectRoot, args, deps = {}) {
  if (!args.plan) {
    throw new Error('--plan is required');
  }

  const writer = deps.writePlanDiagramPublication || writePlanDiagramPublication;
  const dartClient = deps.dart || dart;
  const result = writer(projectRoot, args);

  const summary = {
    action: 'publication-written',
    task_id: result.publication.task_id,
    event: result.publication.lifecycle_event,
    publication: result.paths.publicationPath,
    comment_draft: result.paths.commentPath,
    diagram: result.paths.diagramPath,
    baseline: result.paths.baselinePath,
    dart_task_id: result.publication.dart.task_id,
    applied_comment: false
  };

  if (args.applyComment) {
    if (!result.publication.dart.task_id) {
      summary.action = 'publication-written-comment-not-applied';
      summary.reason = 'plan has no dart_task_id; publisher does not create Dart tasks';
      return summary;
    }
    const comment = await dartClient.addComment(result.publication.dart.task_id, result.comment);
    summary.action = 'publication-written-comment-applied';
    summary.applied_comment = true;
    summary.comment_id = comment && comment.item && comment.item.id || null;
  }

  return summary;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
  if (args.help) {
    console.log(usage());
    return;
  }

  let summary;
  try {
    summary = await runPublisher(process.cwd(), args);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  runPublisher,
  usage
};
