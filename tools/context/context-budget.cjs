'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTEXT_BUDGET_SCHEMA = 'ContextBudget/1.0';
const STATE_REL = path.join('_dev', 'state', 'context-budget');

const LIFECYCLE_STATES = Object.freeze([
  'context_ok',
  'context_warning',
  'prepare_handoff',
  'auto_cross_session',
  'blocked_manual'
]);

const ROLE_THRESHOLDS = Object.freeze({
  coordinator: { warning: 65, prepare: 78, auto: 88, emergency: 95 },
  orchestrator: { warning: 65, prepare: 78, auto: 88, emergency: 95 },
  worker: { warning: 75, prepare: 85, auto: 90, emergency: 95 },
  reviewer: { warning: 80, prepare: 90, auto: 94, emergency: 97 },
  bridge: { warning: 75, prepare: 85, auto: 90, emergency: 95 },
  actor: { warning: 70, prepare: 82, auto: 90, emergency: 95 }
});

// Focused-context line-count thresholds.
//
// Provenance: distilled (read-only, facts-only) from Addy Osmani's
// context-engineering skill, Anti-Patterns table:
//   "Context flooding | Agent loses focus when loaded with >5,000 lines of
//    non-task-specific context. ... Aim for <2,000 lines of focused context
//    per task."
// Source: https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/context-engineering/SKILL.md
// License: MIT (Copyright (c) 2025 Addy Osmani). Retrieved 2026-06-24.
// See _dev/research/external-skills/context-engineering/distilled_from.json
// and _dev/concepts/automatic-context-budget-cross-session.md.
//
// These are OBSERVE-ONLY advisory thresholds: they inform classification and
// warnings only. They add NO blocking behavior. They complement the
// percent-of-window ROLE_THRESHOLDS with an absolute focused-line-count view.
const FOCUSED_CONTEXT_LINE_THRESHOLDS = Object.freeze({
  // Keep focused context per task UNDER this many lines.
  focused_max_lines: 2000,
  // PAST this many lines of non-task-specific material, attention/quality
  // degrades ("context flooding").
  flooding_degradation_lines: 5000
});

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function slug(value) {
  return String(value || 'unknown-session')
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\//g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown-session';
}

function stateDir(projectRoot) {
  return path.join(projectRoot, STATE_REL);
}

function reportPath(projectRoot, sessionId) {
  return path.join(stateDir(projectRoot), `${slug(sessionId)}.json`);
}

function latestPath(projectRoot) {
  return path.join(stateDir(projectRoot), 'latest.json');
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  if (value.includes('coordinator')) return 'coordinator';
  if (value.includes('orchestrator')) return 'orchestrator';
  if (value.includes('review')) return 'reviewer';
  if (value.includes('worker')) return 'worker';
  if (value.includes('bridge') || value.includes('gemini') || value.includes('claude') || value.includes('codex')) return 'bridge';
  return 'actor';
}

function thresholdsForRole(role) {
  const normalized = normalizeRole(role);
  return {
    role: normalized,
    ...ROLE_THRESHOLDS[normalized]
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePercent(value) {
  const num = toNumber(value);
  if (num === null) return null;
  if (num >= 0 && num <= 1) return Math.round(num * 10000) / 100;
  return Math.max(0, Math.min(100, Math.round(num * 100) / 100));
}

function deriveMeasuredUsage(measured = {}) {
  const usedPercent = normalizePercent(
    measured.usedPercent ??
    measured.contextUsedPercent ??
    measured.context_usage_percent ??
    measured.used_percent
  );
  const remainingPercent = normalizePercent(
    measured.remainingPercent ??
    measured.contextRemainingPercent ??
    measured.context_remaining_percent ??
    measured.remaining_percent
  );
  const usedTokens = toNumber(measured.usedTokens ?? measured.used_tokens);
  const totalTokens = toNumber(measured.totalTokens ?? measured.total_tokens);
  const remainingTokens = toNumber(measured.remainingTokens ?? measured.remaining_tokens);

  let derivedUsedPercent = usedPercent;
  if (derivedUsedPercent === null && remainingPercent !== null) {
    derivedUsedPercent = Math.max(0, Math.min(100, Math.round((100 - remainingPercent) * 100) / 100));
  }
  if (derivedUsedPercent === null && usedTokens !== null && totalTokens && totalTokens > 0) {
    derivedUsedPercent = Math.round((usedTokens / totalTokens) * 10000) / 100;
  }
  if (derivedUsedPercent === null && remainingTokens !== null && totalTokens && totalTokens > 0) {
    derivedUsedPercent = Math.round(((totalTokens - remainingTokens) / totalTokens) * 10000) / 100;
  }

  return {
    available: derivedUsedPercent !== null,
    used_percent: derivedUsedPercent,
    remaining_percent: derivedUsedPercent === null ? remainingPercent : Math.round((100 - derivedUsedPercent) * 100) / 100,
    used_tokens: usedTokens,
    remaining_tokens: remainingTokens,
    total_tokens: totalTokens
  };
}

function measuredState(usedPercent, thresholds) {
  if (usedPercent >= thresholds.emergency) return 'blocked_manual';
  if (usedPercent >= thresholds.auto) return 'auto_cross_session';
  if (usedPercent >= thresholds.prepare) return 'prepare_handoff';
  if (usedPercent >= thresholds.warning) return 'context_warning';
  return 'context_ok';
}

function buildProxySignals(proxy = {}) {
  const sessionDurationHours = toNumber(proxy.sessionDurationHours ?? proxy.session_duration_hours);
  const dirtyFileCount = toNumber(proxy.dirtyFileCount ?? proxy.dirty_file_count);
  const meaningfulWorkstreamsTouched = toNumber(proxy.meaningfulWorkstreamsTouched ?? proxy.meaningful_workstreams_touched);
  const liveSignalsCreated = toNumber(proxy.liveSignalsCreated ?? proxy.live_signals_created);

  const signals = [
    {
      id: 'long_session',
      active: sessionDurationHours !== null && sessionDurationHours >= 3,
      value: sessionDurationHours,
      threshold: 3
    },
    {
      id: 'large_dirty_tree',
      active: dirtyFileCount !== null && dirtyFileCount > 50,
      value: dirtyFileCount,
      threshold: 50
    },
    {
      id: 'multiple_workstreams',
      active: meaningfulWorkstreamsTouched !== null && meaningfulWorkstreamsTouched > 1,
      value: meaningfulWorkstreamsTouched,
      threshold: 1
    },
    {
      id: 'multiple_live_signals',
      active: liveSignalsCreated !== null && liveSignalsCreated > 1,
      value: liveSignalsCreated,
      threshold: 1
    },
    {
      id: 'substantial_implementation_review_loop',
      active: Boolean(proxy.substantialImplementationAndReviewLoop || proxy.substantial_implementation_review_loop),
      value: Boolean(proxy.substantialImplementationAndReviewLoop || proxy.substantial_implementation_review_loop),
      threshold: true
    },
    {
      id: 'dirty_source_and_canonical_runtime',
      active: Boolean(proxy.dirtySourceAndCanonicalRuntime || proxy.dirty_source_and_canonical_runtime),
      value: Boolean(proxy.dirtySourceAndCanonicalRuntime || proxy.dirty_source_and_canonical_runtime),
      threshold: true
    }
  ];

  return {
    signals,
    active_count: signals.filter((signal) => signal.active).length,
    explicit_operator_cross_session_request: Boolean(proxy.explicitOperatorCrossSessionRequest || proxy.explicit_operator_cross_session_request),
    cannot_complete_shutdown: Boolean(proxy.cannotCompleteShutdown || proxy.cannot_complete_shutdown || proxy.contextExhausted || proxy.context_exhausted)
  };
}

function proxyState(proxySummary) {
  if (proxySummary.cannot_complete_shutdown) return 'blocked_manual';
  if (proxySummary.explicit_operator_cross_session_request) return 'auto_cross_session';
  if (proxySummary.active_count >= 2) return 'prepare_handoff';
  if (proxySummary.active_count >= 1) return 'context_warning';
  return 'context_ok';
}

function bridgeSummary(bridge = {}) {
  const timeout = Boolean(bridge.timeout || bridge.timed_out || bridge.bridgeTimeout || bridge.bridge_timeout);
  const malformedOutput = Boolean(bridge.malformedOutput || bridge.malformed_output || bridge.invalidResponse || bridge.invalid_response);
  const contextExhausted = Boolean(bridge.contextExhausted || bridge.context_exhausted);
  const blocked = timeout || malformedOutput || contextExhausted;
  return {
    timeout,
    malformed_output: malformedOutput,
    context_exhausted: contextExhausted,
    blocked,
    completed_review: blocked ? false : null,
    disposition: blocked
      ? 'keep_coordination_signal_live; bridge output is blocker evidence, not completed review'
      : 'no_bridge_blocker_reported'
  };
}

function maxLifecycleState(...states) {
  return states
    .filter(Boolean)
    .sort((a, b) => LIFECYCLE_STATES.indexOf(b) - LIFECYCLE_STATES.indexOf(a))[0] || 'context_ok';
}

// OBSERVE-ONLY: classify an absolute focused-context line count against the
// distilled Osmani thresholds. Returns advisory state only; never blocks.
// Returns null when no line count is provided (the field is optional).
function classifyFocusedLines(value) {
  const lines = toNumber(value);
  if (lines === null) return null;
  const { focused_max_lines, flooding_degradation_lines } = FOCUSED_CONTEXT_LINE_THRESHOLDS;
  let state = 'focused_ok';
  if (lines > flooding_degradation_lines) state = 'context_flooding';
  else if (lines >= focused_max_lines) state = 'over_focused_budget';
  return {
    focused_lines: lines,
    state,
    focused_max_lines,
    flooding_degradation_lines,
    observe_only: true,
    advisory: state === 'context_flooding'
      ? 'Past ~5,000 lines of non-task-specific context, attention/quality degrades; include only task-relevant material.'
      : state === 'over_focused_budget'
        ? 'Focused context per task should stay under ~2,000 lines; consider trimming non-task-specific material.'
        : 'Focused context within recommended budget.'
  };
}

function classifyContextBudget(input = {}) {
  const role = input.role || 'actor';
  const thresholds = thresholdsForRole(role);
  const measured = deriveMeasuredUsage(input.measured || input);
  const proxy = buildProxySignals(input.proxy || input);
  const bridge = bridgeSummary(input.bridge || input);

  const baseState = measured.available
    ? measuredState(measured.used_percent, thresholds)
    : proxyState(proxy);
  const state = maxLifecycleState(baseState, bridge.blocked ? 'blocked_manual' : null);

  // OBSERVE-ONLY focused-line view. Intentionally does NOT feed lifecycle_state
  // — it is advisory context that complements the percent-of-window state.
  const focusedLineSource = input.measured && input.measured.focusedLines !== undefined
    ? input.measured.focusedLines
    : (input.focusedLines ?? input.focused_lines ?? (input.measured && input.measured.focused_lines));
  const focused_context = classifyFocusedLines(focusedLineSource);

  return {
    lifecycle_state: state,
    role: thresholds.role,
    thresholds,
    focused_context_thresholds: FOCUSED_CONTEXT_LINE_THRESHOLDS,
    focused_context,
    measured,
    proxy,
    bridge,
    observe_only: true,
    automation_allowed: {
      write_context_budget_state: true,
      prepare_evidence: ['context_warning', 'prepare_handoff', 'auto_cross_session', 'blocked_manual'].includes(state),
      run_shutdown: false,
      write_boundary_marker: false,
      stage_or_commit: false,
      push_remotes: false
    },
    recommendation: recommendationForState(state, bridge)
  };
}

function recommendationForState(state, bridge) {
  if (bridge && bridge.blocked) return 'Bridge actor reported timeout, malformed output, or context exhaustion; keep the signal live and route manual or alternate review.';
  if (state === 'blocked_manual') return 'Write the smallest emergency handoff packet; do not commit, push, or mutate boundary markers automatically.';
  if (state === 'auto_cross_session') return 'Programmatic cross-session may be recommended, but observe-only mode must stop before shutdown, clean-house approval, commits, pushes, or boundary writes.';
  if (state === 'prepare_handoff') return 'Prepare closeout evidence and handoff inputs while continuing to preserve operator gates.';
  if (state === 'context_warning') return 'Warn the coordinator and finish the current bounded unit before starting broad new work.';
  return 'Continue normal loop.';
}

function gitDirtyCount(projectRoot) {
  const result = spawnSync('git', ['status', '--short'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || '').split('\n').filter(Boolean).length;
}

function buildChildScopeArtifacts({ parentScope = 'system', childScope = '', runId = '' } = {}) {
  const parent = String(parentScope || 'system').trim() || 'system';
  const childLabel = String(childScope || runId || 'child').trim() || 'child';
  const fullChildScope = childLabel.startsWith(`${parent}/`) ? childLabel : `${parent}/${childLabel}`;
  if (fullChildScope === parent) {
    throw new Error('child scope must not equal parent scope');
  }
  const safe = slug(fullChildScope);
  return {
    parent_scope: parent,
    child_scope: fullChildScope,
    handoff_path: `_dev/reports/analysis/actor-handoffs/${safe}__<timestamp>.md`,
    boundary_marker_path: `_dev/state/session-boundary/pending/${safe}.json`,
    parent_handoff_path: parent === 'system'
      ? '_dev/reports/analysis/next-session-handoff.md'
      : `clients/${slug(parent)}/next-session-handoff.md`,
    clobbers_parent: false
  };
}

function buildContextBudgetReport(projectRoot, opts = {}) {
  const sessionId = opts.sessionId || process.env.MYTHOS_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.env.CODEX_SESSION_ID || `session-${Date.now()}`;
  const proxy = { ...(opts.proxy || {}) };
  if (proxy.dirtyFileCount === undefined && proxy.dirty_file_count === undefined && opts.includeGitDirtyCount !== false) {
    const dirtyCount = gitDirtyCount(projectRoot);
    if (dirtyCount !== null) proxy.dirtyFileCount = dirtyCount;
  }
  const classification = classifyContextBudget({
    role: opts.role || 'actor',
    measured: opts.measured || {},
    proxy,
    bridge: opts.bridge || {},
    focusedLines: opts.focusedLines ?? opts.focused_lines
  });
  let child_scope_artifacts = null;
  if (opts.childScope || opts.runId) {
    child_scope_artifacts = buildChildScopeArtifacts({
      parentScope: opts.parentScope || 'system',
      childScope: opts.childScope,
      runId: opts.runId
    });
  }
  return {
    schema: CONTEXT_BUDGET_SCHEMA,
    session_id: sessionId,
    generated_at: opts.generatedAt || nowIso(),
    source: opts.source || 'observe-only',
    repo_root: projectRoot,
    role: classification.role,
    lifecycle_state: classification.lifecycle_state,
    observe_only: true,
    measured: classification.measured,
    proxy: classification.proxy,
    bridge: classification.bridge,
    thresholds: classification.thresholds,
    focused_context_thresholds: classification.focused_context_thresholds,
    focused_context: classification.focused_context,
    automation_allowed: classification.automation_allowed,
    recommendation: classification.recommendation,
    child_scope_artifacts,
    protected_boundaries: [
      'does not run /shutdown automatically',
      'does not write SessionBoundary markers automatically',
      'does not approve clean-house commit plans',
      'does not stage or commit files',
      'does not push remotes',
      'does not close or clear the operator session'
    ]
  };
}

function writeContextBudgetReport(projectRoot, report) {
  const dir = stateDir(projectRoot);
  ensureDir(dir);
  const target = reportPath(projectRoot, report.session_id);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(target, body, 'utf8');
  fs.writeFileSync(latestPath(projectRoot), body, 'utf8');
  return {
    report_path: rel(projectRoot, target),
    latest_path: rel(projectRoot, latestPath(projectRoot))
  };
}

function observeContextBudget(projectRoot, opts = {}) {
  const report = buildContextBudgetReport(projectRoot, opts);
  const paths = writeContextBudgetReport(projectRoot, report);
  return { report, paths };
}

function loadLatestContextBudget(projectRoot) {
  return safeReadJson(latestPath(projectRoot));
}

function summarizeLatestContextBudget(projectRoot) {
  const latest = loadLatestContextBudget(projectRoot);
  if (!latest) {
    return {
      available: false,
      latest_path: '_dev/state/context-budget/latest.json',
      lifecycle_state: 'unknown',
      observe_only: true
    };
  }
  return {
    available: true,
    latest_path: '_dev/state/context-budget/latest.json',
    generated_at: latest.generated_at || null,
    source: latest.source || '',
    role: latest.role || '',
    lifecycle_state: latest.lifecycle_state || 'unknown',
    observe_only: latest.observe_only !== false,
    measured_available: Boolean(latest.measured && latest.measured.available),
    proxy_active_count: latest.proxy && Number.isFinite(latest.proxy.active_count) ? latest.proxy.active_count : null,
    bridge_blocked: Boolean(latest.bridge && latest.bridge.blocked),
    recommendation: latest.recommendation || ''
  };
}

function formatContextBudgetSummary(result) {
  const report = result.report;
  return [
    `CONTEXT BUDGET: ${result.paths.report_path}`,
    `  state: ${report.lifecycle_state}`,
    `  role: ${report.role}`,
    `  observe-only: ${report.observe_only ? 'yes' : 'no'}`,
    `  recommendation: ${report.recommendation}`
  ].join('\n') + '\n';
}

module.exports = {
  CONTEXT_BUDGET_SCHEMA,
  LIFECYCLE_STATES,
  ROLE_THRESHOLDS,
  FOCUSED_CONTEXT_LINE_THRESHOLDS,
  buildChildScopeArtifacts,
  buildContextBudgetReport,
  classifyContextBudget,
  classifyFocusedLines,
  deriveMeasuredUsage,
  formatContextBudgetSummary,
  latestPath,
  loadLatestContextBudget,
  observeContextBudget,
  reportPath,
  summarizeLatestContextBudget,
  thresholdsForRole,
  writeContextBudgetReport
};
