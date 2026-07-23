#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STATE_ROOT = path.join('_dev', 'state', 'plan-diagram-publication-hooks');
const LOG_PATH = path.join('_dev', 'reports', 'lifecycle', 'plan-diagram-publication-hook.jsonl');

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '../../..');
}

function toolInput(payload) {
  if (payload && payload.tool_input && typeof payload.tool_input === 'object') return payload.tool_input;
  try {
    const parsed = JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toolName(payload) {
  return String(payload && payload.tool_name || payload && payload.tool || process.env.CLAUDE_TOOL_NAME || '');
}

function normalizeRel(projectRootPath, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(projectRootPath, filePath);
  return path.relative(projectRootPath, abs).split(path.sep).join('/');
}

function isPlanJsonPath(relPath) {
  if (!relPath || relPath.includes('/visual-plans/')) return false;
  return (
    /^_dev\/reports\/analysis\/task-plans\/.+__(plan|repair)__(.+)\.json$/.test(relPath)
    || /^_dev\/reports\/analysis\/task-plans\/.+__amendment__.+\.json$/.test(relPath)
    || /^_dev\/reports\/analysis\/task-plans\/.+__plan\.json$/.test(relPath)
    || /^clients\/[^/]+\/plans\/.+__(plan|repair)__(.+)\.json$/.test(relPath)
    || /^clients\/[^/]+\/plans\/.+__amendment__.+\.json$/.test(relPath)
    || /^clients\/[^/]+\/plans\/.+__plan\.json$/.test(relPath)
  );
}

function isTaskPlanPath(relPath) {
  return /__plan\.json$/.test(relPath);
}

function eventForPlan(plan, relPath) {
  if (/__amendment__/.test(relPath)) return 'plan_amended';
  if (/__repair__/.test(relPath)) return 'plan_repaired';
  if (String(plan && plan.status || '').toLowerCase() === 'completed') return 'plan_completed';
  return 'plan_created';
}

function safeTaskId(plan, relPath) {
  if (plan && typeof plan.task_id === 'string' && plan.task_id.trim()) return plan.task_id.trim();
  const base = path.basename(relPath, '.json');
  return base.replace(/__(plan|amendment|repair).*$/, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const READABLE_DOC_ROOT = path.join('_dev', 'reports', 'analysis', 'visual-plans');

// Additive (claude): generate the browser-viewable readable plan document
// alongside the existing draw.io publication. Reuses the codex-verified
// renderPlanDocumentHtml render — never rebuilds it. Fail-open: any error is
// swallowed so the readable doc can never block or break the plan write or the
// existing publication behavior.
function writeReadableDoc(projectRootPath, taskId, options = {}) {
  const renderer = options.readableDocRenderer
    || require('../lib/plan-visibility.js').renderPlanDocumentHtml;
  const html = renderer(projectRootPath, { taskId });
  const docPath = path.join(projectRootPath, READABLE_DOC_ROOT, `${taskId}.plan.html`);
  fs.mkdirSync(path.dirname(docPath), { recursive: true });
  fs.writeFileSync(docPath, html);
  return normalizeRel(projectRootPath, docPath);
}

function writeStepPlanDoc(projectRootPath, taskId, relPath, options = {}) {
  const writer = options.stepPlanWriter
    || require('../lib/step-plan-renderer.cjs').writeStepPlanArtifacts;
  const taskRef = relPath.startsWith('clients/') ? relPath : taskId;
  const artifacts = writer(projectRootPath, { plan: taskRef });
  return artifacts.paths;
}

// Additive (claude): generate the layman work-unit-grouped plandoc HTML alongside
// the existing step-plan and readable-doc outputs.
// Guarded by SMOS_PLANDOC_ENABLED=1 (DEFAULT OFF).
// Fail-open: errors write a plandoc_error to the JSONL log and emit a
// plandoc-hook-failures HandoffSignal — they never throw or block plan writes.
function writePlandocDoc(projectRootPath, taskId, plan, logEntry, options = {}) {
  const env = options.env || process.env;
  if (env.SMOS_PLANDOC_ENABLED !== '1') return null;

  try {
    const renderer = options.plandocRenderer
      || require('../lib/plandoc-renderer.cjs').renderPlandocHtml;
    const html = renderer(plan);
    const docPath = path.join(projectRootPath, READABLE_DOC_ROOT, `${taskId}.plandoc.html`);
    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    fs.writeFileSync(docPath, html);
    const relDoc = normalizeRel(projectRootPath, docPath);
    if (logEntry) logEntry.plandoc_path = relDoc;
    return relDoc;
  } catch (error) {
    // Fail-open: record error in log entry and emit a surfaced HandoffSignal.
    if (logEntry) logEntry.plandoc_error = error.message;
    try {
      const { createHandoffSignal } = require('../../verify/lib/signal.cjs');
      const signalDir = path.join(projectRootPath, '_dev', 'reports', 'signals');
      fs.mkdirSync(signalDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const signalPath = path.join(signalDir, `blocked__${ts}__plandoc-hook-failures.json`);
      const signal = createHandoffSignal(
        'plandoc-hook',
        `plandoc-hook-failures:${taskId}`,
        'blocked',
        {
          artifacts: [],
          blocked_by: [`plandoc render failed for task_id=${taskId}: ${error.message}`],
          recommended_next_actor: 'operator',
          recommended_next_command: 'inspect plandoc-hook-failures signal'
        }
      );
      fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2) + '\n');
    } catch (_signalErr) {
      // Signal emission is also best-effort — never throw from hook.
    }
    return null;
  }
}

function appendLog(projectRootPath, entry) {
  try {
    const logPath = path.join(projectRootPath, LOG_PATH);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Hook logging is best-effort only.
  }
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function readState(projectRootPath, taskId) {
  try {
    return readJson(path.join(projectRootPath, STATE_ROOT, `${taskId}.json`));
  } catch {
    return {};
  }
}

function writeState(projectRootPath, taskId, state) {
  const statePath = path.join(projectRootPath, STATE_ROOT, `${taskId}.json`);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function runDartBridge(projectRootPath, args, env, runCommand) {
  const runner = runCommand || spawnSync;
  return runner('npm', ['run', 'dart:plan:create-task', '--', ...args], {
    cwd: projectRootPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      CLAUDE_PROJECT_DIR: projectRootPath
    },
    maxBuffer: 1024 * 1024 * 8
  });
}

function runPostWritePlanDiagramPublication(payload = {}, options = {}) {
  const env = options.env || process.env;
  if (env.SMOS_IN_PUBLISH_HOOK === '1') return { skipped: true, reason: 'reentrant' };
  if (env.NODE_ENV === 'test' && env.SMOS_PLAN_DIAGRAM_HOOKS_TEST !== '1') {
    return { skipped: true, reason: 'node-env-test' };
  }
  if (env.SMOS_PLAN_DIAGRAM_HOOKS_DISABLED === '1') {
    return { skipped: true, reason: 'disabled' };
  }

  const tool = toolName(payload);
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return { skipped: true, reason: 'non-write-tool', tool };

  const root = options.projectRoot || projectRoot();
  const input = toolInput(payload);
  const filePath = input.file_path || input.path || '';
  if (!filePath) return { skipped: true, reason: 'missing-file-path' };
  const relPath = normalizeRel(root, filePath);
  if (!isPlanJsonPath(relPath)) return { skipped: true, reason: 'not-plan-json', relPath };

  const absPath = path.resolve(root, relPath);
  if (!fs.existsSync(absPath)) return { skipped: true, reason: 'plan-file-missing', relPath };

  let plan;
  try {
    plan = readJson(absPath);
  } catch (error) {
    appendLog(root, { action: 'skip', reason: 'plan-json-unreadable', relPath, error: error.message });
    return { skipped: true, reason: 'plan-json-unreadable', relPath, error: error.message };
  }

  const taskId = safeTaskId(plan, relPath);
  const event = eventForPlan(plan, relPath);
  const publisher = options.publisher || require('../lib/plan-diagram-publication.cjs').writePlanDiagramPublication;
  const runCommand = options.runCommand;
  const results = {
    skipped: false,
    relPath,
    taskId,
    event,
    actions: []
  };

  try {
    const publication = publisher(root, {
      taskId: isTaskPlanPath(relPath) ? taskId : relPath,
      event,
      includeClient: relPath.startsWith('clients/'),
      force: false
    });
    results.actions.push({ action: 'publication-written', publication: publication.paths.publicationPath });
  } catch (error) {
    appendLog(root, { action: 'publication-failed', relPath, taskId, event, error: error.message });
    return { skipped: false, relPath, taskId, event, error: error.message, actions: results.actions };
  }

  // Additive (claude): also emit the readable plan document. Strictly fail-open
  // and non-blocking — its failure must never affect the publication above or
  // the plan write. No browser is opened here (hook context); the doc is just
  // written next to the diagram.
  try {
    const docPath = writeReadableDoc(root, taskId, { readableDocRenderer: options.readableDocRenderer });
    results.actions.push({ action: 'readable-doc-written', readable_doc: docPath });
  } catch (error) {
    appendLog(root, { action: 'readable-doc-skipped', relPath, taskId, event, error: error.message });
    results.actions.push({ action: 'readable-doc-skipped', reason: error.message });
  }

  // Additive (codex): emit the two-lens step plan artifacts after the readable
  // doc. Fail-open: the S3 framing lint can refuse to render a bad audience
  // voicing, but that refusal must not block the original plan write.
  try {
    const stepPlanPaths = writeStepPlanDoc(root, taskId, relPath, { stepPlanWriter: options.stepPlanWriter });
    results.actions.push({ action: 'step-plan-written', step_plan: stepPlanPaths });
  } catch (error) {
    appendLog(root, { action: 'step-plan-skipped', relPath, taskId, event, error: error.message });
    results.actions.push({ action: 'step-plan-skipped', reason: error.message });
  }

  // Additive (claude): emit the layman plandoc HTML when SMOS_PLANDOC_ENABLED=1.
  // Fail-open — plandoc errors must never block plan writes or existing hook behavior.
  const plandocLogEntry = {};
  const plandocPath = writePlandocDoc(root, taskId, plan, plandocLogEntry, {
    plandocRenderer: options.plandocRenderer,
    env: options.env || process.env
  });
  if (plandocPath) {
    results.actions.push({ action: 'plandoc-written', plandoc: plandocPath });
    appendLog(root, { action: 'plandoc-written', relPath, taskId, event, plandoc_path: plandocPath });
  } else if (plandocLogEntry.plandoc_error) {
    results.actions.push({ action: 'plandoc-skipped', reason: plandocLogEntry.plandoc_error });
    appendLog(root, { action: 'plandoc-skipped', relPath, taskId, event, plandoc_error: plandocLogEntry.plandoc_error });
  }
  // If plandocPath is null and no error, SMOS_PLANDOC_ENABLED was off — silent skip, no log.

  let currentPlan = plan;
  if (!currentPlan.dart_task_id && isTaskPlanPath(relPath)) {
    const createResult = runDartBridge(root, [
      absPath
    ], env, runCommand);
    results.actions.push({
      action: 'dart-link-attempted',
      status: createResult.status,
      stdout: createResult.stdout || '',
      stderr: createResult.stderr || ''
    });
    try {
      currentPlan = readJson(absPath);
    } catch {
      currentPlan = plan;
    }
    if (currentPlan.dart_task_id) {
      try {
        const publication = publisher(root, {
          taskId,
          event,
          includeClient: relPath.startsWith('clients/'),
          force: false
        });
        results.actions.push({ action: 'publication-refreshed-after-dart-link', publication: publication.paths.publicationPath });
      } catch (error) {
        appendLog(root, { action: 'publication-refresh-failed', relPath, taskId, event, error: error.message });
      }
    }
  }

  if (currentPlan.dart_task_id && isTaskPlanPath(relPath)) {
    const commentPath = path.join(root, '_dev', 'reports', 'analysis', 'visual-plans', `${taskId}.dart-comment.md`);
    if (fs.existsSync(commentPath)) {
      const commentText = fs.readFileSync(commentPath, 'utf8');
      const commentHash = hashText(`${currentPlan.dart_task_id}\n${commentText}`);
      const state = readState(root, taskId);
      if (state.last_comment_hash === commentHash) {
        results.actions.push({ action: 'dart-comment-skipped', reason: 'unchanged' });
      } else {
        const commentResult = runDartBridge(root, [
          absPath,
          '--comment-file',
          commentPath
        ], env, runCommand);
        results.actions.push({
          action: 'dart-comment-attempted',
          status: commentResult.status,
          stdout: commentResult.stdout || '',
          stderr: commentResult.stderr || ''
        });
        if (commentResult.status === 0) {
          writeState(root, taskId, {
            task_id: taskId,
            dart_task_id: currentPlan.dart_task_id,
            last_comment_hash: commentHash,
            last_comment_at: new Date().toISOString(),
            last_event: event,
            comment_path: normalizeRel(root, commentPath)
          });
        }
      }
    }
  }

  appendLog(root, { action: 'complete', relPath, taskId, event, actions: results.actions.map((item) => item.action) });
  return results;
}

function main(payload) {
  try {
    return runPostWritePlanDiagramPublication(payload || {});
  } catch (error) {
    appendLog(projectRoot(), { action: 'error', error: error.message });
    return { skipped: false, error: error.message };
  }
}

if (require.main === module) {
  const raw = fs.readFileSync(0, 'utf8');
  let payload = {};
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  main(payload);
}

module.exports = {
  eventForPlan,
  isPlanJsonPath,
  main,
  runPostWritePlanDiagramPublication,
  writeStepPlanDoc,
  writePlandocDoc
};
