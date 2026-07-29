#!/usr/bin/env node
/**
 * concept-md-to-task.js — Auto-create a Dart To-do for a flat concept doc.
 *
 * Usage:
 *   node tools/dart-integration/concept-md-to-task.js <concept-md-path>
 *
 * Behavior:
 *   - Reads the concept markdown
 *   - Derives slug from basename, title from first H1, open-questions snippet
 *     from the "## Open questions" section if present
 *   - Writes a sidecar JSON at _dev/reports/concepts/<slug>__concept-task.json
 *     with kind:"concept", status:"To-do" (capturing the threshold rule that
 *     concepts become Dart todos and graduate to active tasks via /plan-task
 *     once their open questions are resolved)
 *   - Idempotent: if the sidecar already exists with dart_task_id set, exit 0
 *     without re-firing (operator can manually re-create by deleting the
 *     dart_task_id line and re-running)
 *   - Then invokes tools/dart-integration/create-task-from-plan.js on the
 *     sidecar so the existing Dart-creation path handles everything else
 *
 * Designed to be called by the PostToolUse hook on _dev/concepts/*.md writes.
 * Always exits 0 — Dart-side failures must never block concept-init.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SIDECAR_DIR = path.join(REPO_ROOT, '_dev', 'reports', 'concepts');
const HELPER = path.join(__dirname, 'create-task-from-plan.js');

function exitOk(msg) {
  if (msg) console.log(JSON.stringify({ event: 'concept-md-to-task', skip: msg }));
  process.exit(0);
}

function main() {
  const conceptPath = process.argv[2];
  if (!conceptPath) exitOk('no-arg');

  const abs = path.isAbsolute(conceptPath) ? conceptPath : path.resolve(conceptPath);
  if (!fs.existsSync(abs)) exitOk('concept-not-found');

  const base = path.basename(abs);
  // Skip private/template/readme files
  if (base.startsWith('_')) exitOk('private-file');
  if (!base.endsWith('.md')) exitOk('not-md');

  const slug = base.replace(/\.md$/, '');
  const repoRel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');

  // Only handle flat concepts under _dev/concepts/ (not bundle subdirectories)
  if (!/^_dev\/concepts\/[^/]+\.md$/.test(repoRel)) exitOk('not-flat-concept');

  fs.mkdirSync(SIDECAR_DIR, { recursive: true });
  const sidecarPath = path.join(SIDECAR_DIR, `${slug}__concept-task.json`);

  // Idempotency: if sidecar exists with dart_task_id, skip
  if (fs.existsSync(sidecarPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
      if (existing.dart_task_id) exitOk('already-created');
    } catch (_) {
      // malformed sidecar — continue and overwrite
    }
  }

  const body = fs.readFileSync(abs, 'utf8');

  // Title: first H1 line; fall back to slug
  const h1Match = body.match(/^#\s+(.+?)\s*$/m);
  const title = h1Match ? h1Match[1].trim() : slug;

  // Open questions: capture the "## Open questions" section if present, trimmed
  let openQuestions = '';
  const oqMatch = body.match(/^##\s+Open questions[\s\S]*?(?=\n## |\n# |$)/m);
  if (oqMatch) {
    openQuestions = oqMatch[0].split('\n').slice(1).join('\n').trim();
    if (openQuestions.length > 1500) openQuestions = openQuestions.slice(0, 1500) + '\n\n…(truncated; see concept body)';
  }

  // Description: short pointer + open questions snippet so Dart todo is useful at-a-glance
  const description = [
    `Concept: \`${repoRel}\``,
    '',
    'Auto-created from concept-init as a Dart To-do. Graduates to an active task plan via `/plan-task` once the open questions below are resolved enough that planning can proceed.',
    openQuestions ? '\n## Open questions (from concept)\n\n' + openQuestions : '',
  ].filter(Boolean).join('\n');

  const sidecar = {
    kind: 'concept',
    slug,
    title: `Concept: ${title}`,
    concept_path: repoRel,
    status: 'To-do',
    priority: 'Medium',
    tags: ['concept', 'flat'],
    description,
  };

  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');

  // Invoke the existing helper synchronously so we can capture dart_task_id
  const result = spawnSync('node', [HELPER, sidecarPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // Always exit 0 — concept creation is the load-bearing artifact
  process.exit(0);
}

try { main(); } catch (e) {
  console.error('concept-md-to-task error:', e && e.message);
  process.exit(0);
}
