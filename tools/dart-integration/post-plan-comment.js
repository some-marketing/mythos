#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dart = require('./lib/dart-api.js');
const { resolveTaskPlanPaths } = require('./lib/resolve-task-plan');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function requireValue(argv, index, flag) {
  if (index + 1 >= argv.length || String(argv[index + 1] || '').startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return argv[index + 1];
}

function parseArgs(argv) {
  const args = {
    plan: '',
    commentFile: '',
    dryRun: false,
    preflight: false,
    idempotencyKey: '',
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      args.plan = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--comment-file') {
      args.commentFile = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--preflight') {
      args.preflight = true;
    } else if (arg === '--idempotency-key') {
      args.idempotencyKey = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--json') {
      args.json = true;
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
    'Usage: node tools/dart-integration/post-plan-comment.js --plan <task-id|plan-path> --comment-file <path> [--dry-run|--preflight] [--json]',
    '',
    'Posts a prepared markdown comment to an existing Dart task linked by plan.dart_task_id.',
    'It never creates Dart tasks and never rewrites the plan.',
    '',
    'Modes:',
    '  --dry-run     Validate plan/comment readiness without contacting Dart.',
    '  --preflight   Validate readiness and Dart credential identity without posting.',
    '  --idempotency-key <key>  Skip posting when a prior comment already carries this key or the same body.'
  ].join('\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveCommentPath(projectRoot, commentFile) {
  const filePath = path.isAbsolute(commentFile)
    ? commentFile
    : path.resolve(projectRoot, commentFile);
  if (!fs.existsSync(filePath)) {
    throw new Error(`comment file not found: ${commentFile}`);
  }
  return filePath;
}

function buildReadySummary(projectRoot, args) {
  if (!args.plan) {
    throw new Error('--plan is required');
  }
  if (!args.commentFile) {
    throw new Error('--comment-file is required');
  }

  const resolved = resolveTaskPlanPaths(projectRoot, args.plan);
  if (!resolved || !fs.existsSync(resolved.jsonPath)) {
    throw new Error(`plan not found: ${args.plan}`);
  }

  const plan = readJson(resolved.jsonPath);
  if (!plan.dart_task_id) {
    throw new Error(`plan has no dart_task_id: ${path.relative(projectRoot, resolved.jsonPath).replace(/\\/g, '/')}`);
  }

  const commentPath = resolveCommentPath(projectRoot, args.commentFile);
  const comment = fs.readFileSync(commentPath, 'utf8');
  if (!comment.trim()) {
    throw new Error(`comment file is empty: ${args.commentFile}`);
  }

  return {
    action: args.dryRun ? 'comment-dry-run' : 'comment-ready',
    task_id: plan.task_id || path.basename(resolved.jsonPath).replace(/__plan\.json$/, ''),
    dart_task_id: plan.dart_task_id,
    plan_path: path.relative(projectRoot, resolved.jsonPath).replace(/\\/g, '/'),
    comment_file: path.relative(projectRoot, commentPath).replace(/\\/g, '/'),
    idempotency_key: args.idempotencyKey || '',
    comment
  };
}

function formatText(summary) {
  if (summary.action === 'comment-posted') {
    return `Dart comment posted to ${summary.dart_task_id}${summary.comment_id ? ` (${summary.comment_id})` : ''}`;
  }
  if (summary.action === 'comment-skipped-existing') {
    return `Skipped: Dart task ${summary.dart_task_id} already has comment ${summary.existing_comment_id || '(unknown)'} for ${summary.idempotency_key || 'this body'}`;
  }
  if (summary.action === 'comment-dry-run') {
    return `Dry run: would post ${summary.comment_file} to Dart task ${summary.dart_task_id} for plan ${summary.task_id}`;
  }
  if (summary.action === 'comment-preflight') {
    return `Preflight: ${summary.auth.ok ? 'Dart credentials valid' : `Dart credentials ${summary.auth.state || 'not ready'}`} for task ${summary.dart_task_id}`;
  }
  return `${summary.action}: ${summary.task_id}`;
}

function commentsFrom(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.results)) return result.results;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function idempotencyMarker(key) {
  const safe = String(key || '').trim();
  return safe ? `Mythos comment idempotency: ${safe}` : '';
}

function prepareCommentWithMarker(comment, key) {
  const marker = idempotencyMarker(key);
  if (!marker) return comment;
  if (String(comment || '').includes(marker)) return comment;
  return `${comment.trimEnd()}\n\n${marker}\n`;
}

function findExistingComment(comments, comment, key) {
  const marker = idempotencyMarker(key);
  const normalizedBody = String(comment || '').trim();
  for (const item of commentsFrom(comments)) {
    const text = String(item.text || item.body || item.comment || '');
    if (marker && text.includes(marker)) {
      return {
        id: item.id || item.comment_id || null,
        reason: 'idempotency-key'
      };
    }
    if (normalizedBody && text.trim() === normalizedBody) {
      return {
        id: item.id || item.comment_id || null,
        reason: 'same-body'
      };
    }
  }
  return null;
}

async function run(projectRoot, args, deps = {}) {
  const client = deps.dart || dart;
  const summary = buildReadySummary(projectRoot, args);
  if (args.dryRun) {
    delete summary.comment;
    return summary;
  }

  if (args.preflight) {
    const auth = await client.probeAuthState();
    delete summary.comment;
    return {
      ...summary,
      action: 'comment-preflight',
      auth: {
        ok: Boolean(auth.ok),
        state: auth.state || 'unknown',
        source: auth.source || auth.token_source || 'unknown',
        code: auth.code || null,
        error: auth.error || null
      },
      recovery_commands: auth.ok ? [] : [
        'npm run dart:identity:check',
        `node tools/dart-integration/post-plan-comment.js --plan ${summary.task_id} --comment-file ${summary.comment_file} --preflight --json`
      ]
    };
  }

  try {
    const idempotencyKey = String(args.idempotencyKey || '').trim();
    if (idempotencyKey && typeof client.listComments === 'function') {
      const existing = findExistingComment(
        await client.listComments(summary.dart_task_id),
        summary.comment,
        idempotencyKey
      );
      if (existing) {
        delete summary.comment;
        return {
          ...summary,
          action: 'comment-skipped-existing',
          existing_comment_id: existing.id,
          skip_reason: existing.reason
        };
      }
    }
    const commentText = prepareCommentWithMarker(summary.comment, idempotencyKey);
    const comment = await client.addComment(summary.dart_task_id, commentText);
    delete summary.comment;
    return {
      ...summary,
      action: 'comment-posted',
      comment_id: comment && comment.item && comment.item.id || null
    };
  } catch (error) {
    delete summary.comment;
    const nextCommand = [
      'npm run dart:identity:check',
      `node tools/dart-integration/post-plan-comment.js --plan ${summary.task_id} --comment-file ${summary.comment_file}`
    ];
    const wrapped = new Error(`Dart comment failed: ${error.message}`);
    wrapped.summary = {
      ...summary,
      action: 'comment-failed',
      error: error.message,
      recovery_commands: nextCommand
    };
    throw wrapped;
  }
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

  try {
    const summary = await run(PROJECT_ROOT, args);
    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(formatText(summary));
    }
    if (args.preflight && summary.auth && !summary.auth.ok) {
      process.exit(1);
    }
  } catch (error) {
    if (args.json && error.summary) {
      console.error(JSON.stringify(error.summary, null, 2));
    } else {
      console.error(error.message);
      if (error.summary && Array.isArray(error.summary.recovery_commands)) {
        console.error('Recovery:');
        for (const command of error.summary.recovery_commands) {
          console.error(`  ${command}`);
        }
      }
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildReadySummary,
  commentsFrom,
  findExistingComment,
  formatText,
  idempotencyMarker,
  parseArgs,
  prepareCommentWithMarker,
  run,
  usage
};
