#!/usr/bin/env node
'use strict';
// Post-write advisory hook for task-plan paired-artifact (JSON + MD) repair discipline.
// ADVISORY-ONLY, FAIL-SOFT. Emits a .warning sidecar; always exits 0.
// Primary paired-artifact enforcement lives in the managed /repair-plan runtime
// (tools/codex/commands/repair-plan.js), which performs atomic paired writes
// before any file mutation. This hook cannot block a mutation that already
// happened; it exists to surface direct-write bypasses on non-command paths.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const RECENT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const PLAN_PATTERNS = [
  /_dev\/reports\/analysis\/task-plans\/.*__plan\.(json|md)$/,
  /clients\/[^/]+\/plans\/.*__plan\.(json|md)$/,
];

function isTaskPlanPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const norm = filePath.replace(/\\/g, '/');
  return PLAN_PATTERNS.some((re) => re.test(norm));
}

function derivePairedPath(filePath) {
  if (filePath.endsWith('.json')) return filePath.replace(/\.json$/, '.md');
  if (filePath.endsWith('.md')) return filePath.replace(/\.md$/, '.json');
  return null;
}

function inferTaskIdFromPath(filePath) {
  const base = path.basename(filePath).replace(/\.(json|md)$/, '').replace(/__plan$/, '');
  return base || '<task-id>';
}

function readStdinSync() {
  try { return fs.readFileSync(0, 'utf8') || ''; } catch (_) { return ''; }
}

function loadPayload() {
  const stdinRaw = readStdinSync();
  if (stdinRaw) {
    try { return JSON.parse(stdinRaw); } catch (_) {}
  }
  const envRaw = process.env.CLAUDE_TOOL_INPUT;
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw);
      // env var may carry just the tool_input, not the full payload envelope
      if (parsed && parsed.tool_input) return parsed;
      return { tool_input: parsed };
    } catch (_) {}
  }
  return {};
}

function main(passedPayload) {
  const payload = passedPayload || loadPayload();
  const filePath = (payload && payload.tool_input && payload.tool_input.file_path) || '';
  if (!filePath) return;
  if (!isTaskPlanPath(filePath)) return;

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const pairedPath = derivePairedPath(absPath);
  if (!pairedPath) return;

  let pairExists = false;
  let pairRecent = false;
  try {
    const pairStat = fs.statSync(pairedPath);
    pairExists = true;
    const age = Date.now() - pairStat.mtimeMs;
    pairRecent = age <= RECENT_WINDOW_MS;
  } catch (_) {
    pairExists = false;
    pairRecent = false;
  }

  if (pairExists && pairRecent) return;

  const sidecar = {
    hook_id: 'post-write-repair-plan-pairing',
    severity: 'advisory',
    triggered_at: new Date().toISOString(),
    file_path: absPath,
    paired_path: pairedPath,
    pair_exists: pairExists,
    pair_recent: pairRecent,
    finding: 'single-sided task-plan write detected; if this was not a /repair-plan atomic paired write or /plan-task paired authoring, verify paired surface is in sync',
    note: 'ADVISORY-ONLY. Managed /repair-plan runtime is the blocking enforcement path; this hook does not block the write that already occurred.',
    exact_next_command: '/review-task-plan ' + inferTaskIdFromPath(absPath),
  };

  try {
    fs.writeFileSync(absPath + '.warning', JSON.stringify(sidecar, null, 2) + '\n');
    process.stderr.write('[post-write-repair-plan-pairing] advisory: single-sided write, see ' + absPath + '.warning\n');
  } catch (_) { /* fail-soft */ }
}

if (require.main === module) {
  try { main(); process.exit(0); }
  catch (e) {
    try { process.stderr.write('[post-write-repair-plan-pairing] fail-soft: ' + e.message + '\n'); } catch (_) {}
    process.exit(0);
  }
} else {
  module.exports = { main };
}
