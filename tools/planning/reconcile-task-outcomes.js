#!/usr/bin/env node
'use strict';

/**
 * reconcile-task-outcomes.js — Infer completion state for plans missing
 * canonical outcome artifacts and emit STAGED outcomes for operator review.
 *
 * Read-only against canonical task-outcomes/. Writes ONLY to staging.
 *
 * Usage:
 *   node tools/planning/reconcile-task-outcomes.js [--limit N] [--task-id <id>] [--json]
 *
 * For each plan in:
 *   _dev/reports/analysis/task-plans/*__plan.json
 *   clients/<CODE>/plans/*__plan.json
 * that has NO canonical outcome at task-outcomes/<task-id>.json, infer
 * completion state from:
 *   (a) git log --grep=<task-id> commit messages
 *   (b) presence of run-debrief__*<task-id>* artifacts
 *   (c) closed signals referencing the task-id
 *   (d) verify-local__*<task-id>* artifacts
 *
 * Emit a STAGED outcome JSON to _dev/reports/staging/task-outcomes/<task-id>.json
 * with classification confidence (high|medium|low) and an evidence trail array.
 *
 * Operator-gated. The canonical writer (capture-outcome-delta.js) is the only
 * tool that writes to canonical task-outcomes/.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { appendReceipt } = require('../maintenance/lib/hygiene-lane-health.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SYSTEM_PLANS = path.join(ROOT, '_dev/reports/analysis/task-plans');
const CLIENTS_DIR = path.join(ROOT, 'clients');
const CANONICAL_OUTCOMES = path.join(ROOT, '_dev/reports/analysis/task-outcomes');
const STAGING_OUTCOMES = path.join(ROOT, '_dev/reports/staging/task-outcomes');
const SIGNALS_CLOSED = path.join(ROOT, '_dev/reports/signals/closed');
const ANALYSIS_DIR = path.join(ROOT, '_dev/reports/analysis');

// Self-heal lane guards (grounding A2/A3), mirroring tools/fleet/homeostasis.py.
const STATE_DIR = path.join(ROOT, '_dev/state/reconcile-task-outcomes');
const KILL_SWITCH = path.join(STATE_DIR, 'disabled');
const DEFAULT_APPLY_WINDOW = 3; // A3: observation cycles before --apply activates

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    json: args.includes('--json'),
    apply: args.includes('--apply'),
    reportOnly: args.includes('--report-only'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) result.limit = parseInt(args[i + 1], 10);
    if (args[i] === '--task-id' && args[i + 1]) result.taskId = args[i + 1];
  }
  return result;
}

// ── A3 activation window (mirror of homeostasis.py apply-activation) ──────────
// --apply does NOT mark pre_acceptance_verified until a recorded number of
// observation cycles have seen at least one eligible case. Report-only and
// dry-run staging cycles that find eligible cases advance the window; only after
// the threshold is met does an explicit --apply run actually mark.

function applyWindow() {
  const raw = process.env.SMOS_HYGIENE_APPLY_WINDOW;
  if (raw == null) return DEFAULT_APPLY_WINDOW;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? DEFAULT_APPLY_WINDOW : Math.max(0, n);
}

function activationPath(base) {
  return path.join(base || ROOT, '_dev/state/reconcile-task-outcomes/apply-activation.json');
}

function loadActivation(base) {
  try {
    return JSON.parse(fs.readFileSync(activationPath(base), 'utf8'));
  } catch {
    return {
      schema: 'HygieneApplyActivation/1.0',
      apply_class: 'reconcile-task-outcomes-pre-acceptance',
      observed_cycles: 0,
      false_pass_instances: [],
    };
  }
}

function recordObservation(base) {
  const act = loadActivation(base);
  act.observed_cycles = Number(act.observed_cycles || 0) + 1;
  act.last_observed = new Date().toISOString();
  const p = activationPath(base);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(act, null, 2) + '\n');
  return act;
}

function isActivated(base, threshold = applyWindow()) {
  return Number(loadActivation(base).observed_cycles || 0) >= threshold;
}

function listPlans() {
  const plans = [];
  if (fs.existsSync(SYSTEM_PLANS)) {
    for (const f of fs.readdirSync(SYSTEM_PLANS)) {
      if (f.endsWith('__plan.json')) {
        const taskId = f.replace(/__plan\.json$/, '');
        plans.push({ taskId, scope: 'system', planPath: path.join(SYSTEM_PLANS, f) });
      }
    }
  }
  if (fs.existsSync(CLIENTS_DIR)) {
    for (const c of fs.readdirSync(CLIENTS_DIR)) {
      const clientPlans = path.join(CLIENTS_DIR, c, 'plans');
      if (!fs.existsSync(clientPlans)) continue;
      for (const f of fs.readdirSync(clientPlans)) {
        if (f.endsWith('__plan.json')) {
          const taskId = f.replace(/__plan\.json$/, '');
          plans.push({ taskId, scope: `client:${c}`, planPath: path.join(clientPlans, f) });
        }
      }
    }
  }
  return plans;
}

function hasCanonicalOutcome(taskId) {
  return fs.existsSync(path.join(CANONICAL_OUTCOMES, `${taskId}.json`));
}

function gitCommitsForTaskId(taskId) {
  try {
    const out = execSync(`git log --all --grep="${taskId}" --format="%H %s" -n 20`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return [];
    return out.split('\n').map((line) => {
      const [sha, ...rest] = line.split(' ');
      return { sha, subject: rest.join(' ') };
    });
  } catch {
    return [];
  }
}

function findArtifacts(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.includes(pattern));
}

function debriefArtifacts(taskId) {
  return findArtifacts(ANALYSIS_DIR, taskId).filter((f) => f.startsWith('run-debrief'));
}

function verifyLocalArtifacts(taskId) {
  return findArtifacts(ANALYSIS_DIR, taskId).filter((f) => f.startsWith('verify-local'));
}

function closedSignals(taskId) {
  return findArtifacts(SIGNALS_CLOSED, taskId);
}

function classify(taskId) {
  const commits = gitCommitsForTaskId(taskId);
  const debriefs = debriefArtifacts(taskId);
  const verifies = verifyLocalArtifacts(taskId);
  const signals = closedSignals(taskId);

  const evidence = {
    git_commits: commits,
    debrief_artifacts: debriefs,
    verify_local_artifacts: verifies,
    closed_signals: signals,
  };

  const completionMarkers = commits.filter((c) =>
    /^(feat|fix|chore|docs|refactor|complete|done|ship)/i.test(c.subject) ||
    /closeout|complete|done|ship/i.test(c.subject)
  );

  // Confidence rubric:
  // HIGH:    debrief OR verify-local exists AND >=1 ship-shaped commit
  // MEDIUM:  >=1 ship-shaped commit, no debrief/verify
  // MEDIUM:  closed signal exists, no commits
  // LOW:     no evidence, or only generic commit references
  let status = 'unknown';
  let confidence = 'low';
  let summary = '';

  if ((debriefs.length || verifies.length) && completionMarkers.length) {
    status = 'complete';
    confidence = 'high';
    summary = `Debrief/verify artifact + ${completionMarkers.length} ship-shaped commit(s).`;
  } else if (completionMarkers.length >= 2) {
    status = 'complete';
    confidence = 'medium';
    summary = `${completionMarkers.length} ship-shaped commit(s), no debrief/verify artifact.`;
  } else if (completionMarkers.length === 1) {
    status = 'partial';
    confidence = 'medium';
    summary = `Single ship-shaped commit, no corroborating debrief/verify.`;
  } else if (signals.length) {
    status = 'partial';
    confidence = 'low';
    summary = `${signals.length} closed signal(s) reference task-id, but no ship-shaped commits.`;
  } else if (commits.length) {
    status = 'unknown';
    confidence = 'low';
    summary = `${commits.length} commit(s) reference task-id, none are ship-shaped.`;
  } else {
    status = 'unknown';
    confidence = 'low';
    summary = 'No commits, debriefs, signals, or verify artifacts reference this task-id.';
  }

  return { status, confidence, summary, evidence };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * A1 (grounding): the confidence + distinct-evidence check that gates the
 * PRE-ACCEPTANCE state. Eligible iff the classifier is HIGH confidence, the
 * status is complete, AND there is an actual verification artifact (debrief or
 * verify-local) behind it — not a self-certified rubric alone.
 *
 * Eligibility NEVER implies completion truth. It only means a later
 * distinct-intelligence pass can ratify cheaply.
 * @param {object} classification
 * @returns {boolean}
 */
function preAcceptanceEligible(classification) {
  const ev = classification.evidence || {};
  const hasVerificationArtifact =
    (Array.isArray(ev.debrief_artifacts) && ev.debrief_artifacts.length > 0) ||
    (Array.isArray(ev.verify_local_artifacts) && ev.verify_local_artifacts.length > 0);
  return classification.confidence === 'high' &&
    classification.status === 'complete' &&
    hasVerificationArtifact;
}

/**
 * Build the staged-outcome object. Pure (no I/O).
 *
 * A1: with `apply`, eligible high-confidence+verified cases are marked with a
 * distinct PRE-ACCEPTANCE stage (`pre_acceptance_verified`). This is NOT
 * acceptance-grade truth: operator_acceptance stays false, `finalized` stays
 * false, and canonical outcome completion is NOT written here (that remains the
 * capture-outcome-delta lane). The marking only lets a distinct pass ratify.
 *
 * @param {string} taskId
 * @param {object} classification
 * @param {object} planMeta
 * @param {object} [opts] - { apply }
 * @returns {object}
 */
function buildStagedOutcome(taskId, classification, planMeta, opts = {}) {
  const eligible = preAcceptanceEligible(classification);
  const acceptanceStage = (opts.apply && eligible) ? 'pre_acceptance_verified' : 'staged';

  const out = {
    task_id: taskId,
    scope: planMeta.scope,
    plan_path: path.relative(ROOT, planMeta.planPath),
    inferred_at: new Date().toISOString(),
    inferred_status: classification.status,
    inferred_confidence: classification.confidence,
    inferred_summary: classification.summary,
    evidence_trail: classification.evidence,
    // A1: an explicit staging lane. Never 'accepted' / 'finalized' here.
    acceptance_stage: acceptanceStage,
    proposed_outcome_args: {
      completed: classification.status === 'complete',
      all_steps_done: classification.status === 'complete',
      verification_passed: classification.confidence === 'high' && classification.status === 'complete',
      no_open_blockers: classification.status !== 'unknown',
      // Completion truth is NEVER finalized by this tool.
      operator_acceptance: false,
      validation_artifact: classification.evidence.debrief_artifacts[0]
        ? `_dev/reports/analysis/${classification.evidence.debrief_artifacts[0]}`
        : (classification.evidence.verify_local_artifacts[0]
          ? `_dev/reports/analysis/${classification.evidence.verify_local_artifacts[0]}`
          : null),
      validation_method: classification.evidence.debrief_artifacts.length ? 'codex-bridge'
        : classification.evidence.verify_local_artifacts.length ? 'verify-local'
        : 'operator-gate',
    },
    operator_decision: 'pending',
  };

  if (acceptanceStage === 'pre_acceptance_verified') {
    out.pre_acceptance = {
      // The gap the grounding through-line (T14) insists on: "verification
      // passed" is recorded WITHOUT asserting "the outcome is true and final".
      finalized: false,
      operator_acceptance: false,
      ratification_required: true,
      ratifier: 'distinct-intelligence',
      basis: 'high-confidence classification backed by a verification artifact',
      note: 'PRE-ACCEPTANCE ONLY. Not acceptance-grade truth; canonical completion is written only by capture-outcome-delta after a distinct-intelligence pass.',
    };
  }

  return out;
}

function writeStaged(taskId, classification, planMeta, opts = {}) {
  ensureDir(STAGING_OUTCOMES);
  const out = buildStagedOutcome(taskId, classification, planMeta, opts);
  const stagedPath = path.join(STAGING_OUTCOMES, `${taskId}.json`);
  fs.writeFileSync(stagedPath, JSON.stringify(out, null, 2) + '\n');

  // A2: every apply-mode decision writes a durable lane-health receipt.
  if (opts.apply && out.acceptance_stage === 'pre_acceptance_verified') {
    appendReceipt({
      tool: 'reconcile-task-outcomes',
      decision: 'marked-pre-acceptance-verified',
      target: path.relative(ROOT, stagedPath),
      verification: {
        confidence: classification.confidence,
        status: classification.status,
        validation_method: out.proposed_outcome_args.validation_method,
        validation_artifact: out.proposed_outcome_args.validation_artifact,
        finalized: false,
        operator_acceptance: false,
      },
      outcome: 'staged-pre-acceptance',
    });
  }
  return stagedPath;
}

function main() {
  const args = parseArgs();

  // Kill-switch (A2/A3): reversible disable. Honored even under --apply.
  if (fs.existsSync(KILL_SWITCH)) {
    const msg = { kill_switch: true, disabled_by: path.relative(ROOT, KILL_SWITCH) };
    if (args.json) console.log(JSON.stringify(msg, null, 2));
    else console.log(`reconcile-task-outcomes: kill-switch present (${msg.disabled_by}). No classification or staging.`);
    return;
  }

  const allPlans = listPlans();
  let plans = allPlans.filter((p) => !hasCanonicalOutcome(p.taskId));

  if (args.taskId) plans = plans.filter((p) => p.taskId === args.taskId);
  if (args.limit) plans = plans.slice(0, args.limit);

  // A3: --apply only marks pre_acceptance_verified once the observation window is
  // met; before that it observes-and-stages. Report-only never writes staging.
  const threshold = applyWindow();
  const activated = isActivated(ROOT, threshold);
  const effectiveApply = Boolean(args.apply) && activated && !args.reportOnly;

  const results = { apply: !!args.apply, report_only: !!args.reportOnly, activated, observation_window: { threshold, observed_cycles: Number(loadActivation(ROOT).observed_cycles || 0) }, total_plans: allPlans.length, missing_outcomes: plans.length, processed: 0, eligible: 0, pre_acceptance_verified: 0, by_confidence: { high: 0, medium: 0, low: 0 }, by_status: { complete: 0, partial: 0, blocked: 0, unknown: 0 }, items: [] };

  let anyEligible = false;

  for (const p of plans) {
    const classification = classify(p.taskId);
    const eligible = preAcceptanceEligible(classification);
    if (eligible) { anyEligible = true; results.eligible++; }

    // Report-only computes and reports classifications but writes NO staging file.
    let stagedRel = null;
    if (!args.reportOnly) {
      const stagedPath = writeStaged(p.taskId, classification, p, { apply: effectiveApply });
      stagedRel = path.relative(ROOT, stagedPath);
    }

    results.processed++;
    results.by_confidence[classification.confidence]++;
    results.by_status[classification.status]++;
    const acceptanceStage = (effectiveApply && eligible)
      ? 'pre_acceptance_verified'
      : (args.reportOnly ? 'report-only' : 'staged');
    if (acceptanceStage === 'pre_acceptance_verified') results.pre_acceptance_verified++;
    results.items.push({
      task_id: p.taskId,
      scope: p.scope,
      status: classification.status,
      confidence: classification.confidence,
      eligible,
      acceptance_stage: acceptanceStage,
      summary: classification.summary,
      staged_path: stagedRel,
    });
  }

  // A3 observation advancement: a cycle that FOUND eligible cases but did not (or
  // could not yet) mark them advances the window. Covers report-only, dry-run
  // staging, and pre-activation --apply. Once activated and applying, we act
  // instead of observing.
  if (anyEligible && !effectiveApply) {
    const act = recordObservation(ROOT);
    results.observation_window.observed_cycles = act.observed_cycles;
    results.observed_cycle = true;
  }

  // A2 receipt: an --apply run held back by the activation window is an apply-mode
  // decision and gets a durable receipt (report-only/dry-run are not apply-mode).
  if (args.apply && !args.reportOnly && !activated) {
    appendReceipt({
      tool: 'reconcile-task-outcomes',
      decision: 'observed-pending-activation',
      target: 'pre-acceptance-marking',
      verification: {
        observed_cycles: results.observation_window.observed_cycles,
        window_threshold: threshold,
        eligible_count: results.eligible,
      },
      outcome: 'noop',
    });
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`Plans total:      ${results.total_plans}`);
    console.log(`Missing outcomes: ${results.missing_outcomes}`);
    console.log(`Processed:        ${results.processed}`);
    console.log(`By confidence:    high=${results.by_confidence.high}, medium=${results.by_confidence.medium}, low=${results.by_confidence.low}`);
    console.log(`By status:        complete=${results.by_status.complete}, partial=${results.by_status.partial}, blocked=${results.by_status.blocked}, unknown=${results.by_status.unknown}`);
    console.log(`Mode:             ${args.reportOnly ? 'REPORT-ONLY (no staging written)' : (results.apply ? 'APPLY' : 'DRY-RUN staging')}`);
    console.log(`Activation:       observed ${results.observation_window.observed_cycles}/${threshold}${activated ? ' (ACTIVATED)' : ' (pending)'}`);
    console.log(`Pre-acceptance:   ${results.pre_acceptance_verified} marked pre_acceptance_verified (NOT finalized; distinct ratification required)`);
    if (!args.reportOnly) console.log(`Staging dir:      ${path.relative(ROOT, STAGING_OUTCOMES)}`);
  }
}

if (require.main === module) main();

module.exports = { listPlans, hasCanonicalOutcome, classify, preAcceptanceEligible, buildStagedOutcome, applyWindow, loadActivation, recordObservation, isActivated, activationPath };
