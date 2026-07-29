#!/usr/bin/env node
'use strict';
// Post-write advisory hook for /amend-plan authority discipline.
// ADVISORY-ONLY, FAIL-SOFT. Fires when an __amendment__*.json is written and any
// divergence touches an executable authority field (steps, gates, risk tier,
// acceptance criteria). /amend-plan writes an OVERLAY and does not mutate the
// base plan; /run-plan executes the base bounded_plan — so an authority-changing
// amendment is not honored and must be folded in via /repair-plan.
//
// Complement to the guard /repair-plan already enforces via classifyPairedMutation.
// This hook cannot block the write that already happened; it surfaces the route.
// Always exits 0; folded into tools/kernel/hooks/dispatch-posttool.cjs (Option A).

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const AMENDMENT_PATTERNS = [
  /_dev\/reports\/analysis\/task-plans\/.*__amendment__.*\.json$/,
  /clients\/[^/]+\/plans\/.*__amendment__.*\.json$/,
];

function isAmendmentJsonPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const norm = filePath.replace(/\\/g, '/');
  return AMENDMENT_PATTERNS.some((re) => re.test(norm));
}

function toolInput(payload) {
  if (payload && payload.tool_input && typeof payload.tool_input === 'object') return payload.tool_input;
  const envRaw = process.env.CLAUDE_TOOL_INPUT;
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw);
      if (parsed && parsed.tool_input) return parsed.tool_input;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { /* ignore */ }
  }
  return {};
}

function loadStdinPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function main(payload) {
  const p = payload && typeof payload === 'object' ? payload : loadStdinPayload();
  const input = toolInput(p);
  const filePath = input.file_path || input.path || '';
  if (!filePath || !isAmendmentJsonPath(filePath)) return { skipped: true };

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(absPath)) return { skipped: true, reason: 'amendment-missing' };

  let amendment;
  try {
    amendment = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return { skipped: true, reason: 'amendment-unreadable' };
  }

  let result;
  try {
    const { classifyAmendmentDivergences } = require('../lib/repair-vs-amend-classifier');
    result = classifyAmendmentDivergences(amendment.divergences || []);
  } catch (_) {
    return { skipped: true, reason: 'classifier-unavailable' };
  }

  if (result.route_recommendation === 'amend') return { skipped: false, route: 'amend' };

  const planId = amendment.plan_id || amendment.task_id || '<task-id>';
  const nextCommand =
    result.route_recommendation === 'plan-task'
      ? '/plan-task <new-bounded-task>'
      : `/repair-plan ${planId}`;

  const sidecar = {
    hook_id: 'post-write-amend-authority-guard',
    severity: 'advisory',
    triggered_at: new Date().toISOString(),
    file_path: path.relative(PROJECT_ROOT, absPath),
    plan_id: planId,
    route_recommendation: result.route_recommendation,
    authority_touching: result.authority_touching,
    reasons: result.reasons,
    finding:
      'amendment changes executable authority; /run-plan executes the base bounded_plan, so this overlay is not honored',
    note: 'ADVISORY-ONLY. /amend-plan writes an overlay; fold authority changes into the base via the managed /repair-plan runtime.',
    exact_next_command: nextCommand,
  };

  try {
    fs.writeFileSync(absPath + '.advisory.json', JSON.stringify(sidecar, null, 2) + '\n');
    process.stderr.write(
      `[post-write-amend-authority-guard] advisory: ${planId} amendment touches executable authority -> ${nextCommand} (see ${path.relative(PROJECT_ROOT, absPath)}.advisory.json)\n`
    );
  } catch (_) { /* fail-soft */ }

  return { skipped: false, route: result.route_recommendation, sidecar: absPath + '.advisory.json' };
}

if (require.main === module) {
  try { main(); process.exit(0); }
  catch (e) {
    try { process.stderr.write('[post-write-amend-authority-guard] fail-soft: ' + e.message + '\n'); } catch (_) {}
    process.exit(0);
  }
}

module.exports = { main, isAmendmentJsonPath };
