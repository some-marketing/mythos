'use strict';

/**
 * run-plan.js — Codex-managed runner for /run-plan.
 */

const { resolveAuthority, formatDecision } = require('../../signals/lib/follow-signal');
const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');
const { resolveTaskPlanPaths, assessRepairPlanPairingWarning } = require('../../planning/lib/resolve-task-plan');
const {
  readStateMarker,
  resolveStateMarkerPath,
  isRunPlanBlockedByPendingRepair,
  isOperatorStampEnforcementEnabled,
  assessOperatorStamp,
  OPERATOR_STAMP_ENFORCEMENT_ENV,
  collectPlanRunGateDecision,
  planRunGateMode,
  appendPlanRunGateReceipt
} = require('../../planning/lib/plan-review-state');
const fs = require('fs');
const path = require('path');
const { readCanonicalCommandIds } = require('../../signals/lib/target-command-policy.cjs');
const { appendShadowReceipt, buildShadowReceipt, classifyNextStep, digest } = require('../../planning/lib/plan-execution-cursor.js');
const { sha256Bytes, stableJson } = require('../../verify/lib/run-evidence-index.cjs');

// S5 (plan-execution-autonomy-default-perimeter-gate-and-tracking) — the thin
// orchestration wiring over the committed S1–S4 + GREENLIGHT pieces. Used ONLY
// inside the already-flag-gated branches below, so the default (both flags OFF)
// path never calls into it and stays byte-identical.
const autonomousWiring = require('../../kernel/lib/autonomous-execution-wiring.js');

// A2 (plan-approval-surface): same operator-override token the
// userprompt-plan-review-gate hook honors. The operator is the gate owner and is
// never imprisoned by the stamp requirement.
const STAMP_OVERRIDE_FLAG = '--skip-distinct-review';

// S2 (plan-execution-autonomy-default-perimeter-gate-and-tracking) — INERT
// integration point ONLY. The autonomous auto-run-on-isolated-branch path
// (tools/kernel/lib/auto-run-isolation.js) is NOT wired into the live runner
// here. It is gated behind SMOS_AUTONOMOUS_EXECUTION (default OFF) AND is a no-op
// even when ON: live activation + GREENLIGHT enforcement wiring is S5
// (operator-gated). This keeps the default /run-plan flow byte-unchanged.
const AUTONOMOUS_EXECUTION_ENV = 'SMOS_AUTONOMOUS_EXECUTION';
const SHADOW_CURSOR_ENV = 'SMOS_SHADOW_CURSOR';

function isShadowCursorEnabled(env = process.env) {
  return String(env[SHADOW_CURSOR_ENV] || '') === '1';
}

function emitShadowCursorReceipt(projectRoot, taskId, gateDecision, traceEnv = {}, options = {}) {
  if (!isShadowCursorEnabled(options.env || process.env)) return { emitted: false, reason: 'feature_disabled' };
  if (!gateDecision || gateDecision.status !== 'ready') return { emitted: false, reason: 'gate_not_ready' };
  try {
    const resolved = resolveTaskPlanPaths(projectRoot, taskId);
    const jsonBytes = fs.readFileSync(resolved.jsonPath);
    const plan = JSON.parse(jsonBytes.toString('utf8'));
    const commands = readCanonicalCommandIds(projectRoot).sort();
    const projection = { sha256: sha256Bytes(stableJson(commands)), commands };
    const completedStepIds = ((plan.bounded_plan && plan.bounded_plan.steps) || []).filter((step) => step.status === 'completed').map((step) => step.step_id);
    const exactEvidence = {
      plan_sha256: sha256Bytes(jsonBytes),
      plan_content_sha256: digest(plan),
      plan_pair_sha256: gateDecision.plan_pair_sha256,
      gate_sha256: digest(gateDecision),
      evidence_sha256: sha256Bytes(stableJson({ completed_step_ids: completedStepIds.sort(), mechanical_tool_refs: [], projection_sha256: projection.sha256 })),
      projection_sha256: projection.sha256,
      completed_step_ids: completedStepIds,
      mechanical_tool_refs: []
    };
    const cursor = classifyNextStep({ task_id: taskId, plan, gate_decision: gateDecision, exact_evidence: exactEvidence, command_projection: projection });
    const receipt = buildShadowReceipt(cursor, {
      observed_at: options.observedAt || new Date().toISOString(),
      coordinator_result: 'plan_authorized',
      coordinator_step_id: null,
      trace_id: traceEnv.MYTHOS_TRACE_ID || null,
      span_id: traceEnv.MYTHOS_SPAN_ID || null
    });
    const target = appendShadowReceipt(projectRoot, receipt);
    return { emitted: true, target, receipt };
  } catch (error) {
    return { emitted: false, reason: `shadow_error:${error.message}` };
  }
}

/**
 * Default-OFF opt-in for the S2 autonomous execution path. Reads the explicit
 * env flag; anything other than a truthy 'true'/'1' string is OFF.
 * @returns {boolean}
 */
function isAutonomousExecutionEnabled() {
  const raw = String(process.env[AUTONOMOUS_EXECUTION_ENV] || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

function assessVerifiedOperatorStamp(projectRoot, taskId, options = {}) {
  if (!isOperatorStampEnforcementEnabled()) return { required: false, verification: 'not_required', detail: 'enforcement disabled', markerPath: null };
  let resolved = null;
  let markerPath = null;
  let marker = null;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, taskId);
    markerPath = resolveStateMarkerPath(projectRoot, taskId, { clientCode: resolved.clientCode || undefined });
    marker = readStateMarker(markerPath);
  } catch (_) { /* required perimeter below fails closed */ }
  const planJsonPath = resolved && resolved.jsonPath;
  if (planJsonPath && !autonomousWiring.planFileTripsPerimeter(planJsonPath)) {
    return { required: false, verification: 'not_required', detail: 'plan does not trip consequential perimeter', markerPath };
  }
  const stamp = assessOperatorStamp(marker);
  if (stamp.status !== 'present') return { required: true, verification: 'missing', detail: stamp.detail, markerPath };
  try {
    const verifyArgs = { planId: taskId, planJsonPath, stamp: marker && marker.operator_stamp };
    const result = typeof options.greenlightVerify === 'function'
      ? options.greenlightVerify(verifyArgs)
      : autonomousWiring.verifyPresentStampSync(verifyArgs);
    return result && result.verified === true
      ? { required: true, verification: 'verified', detail: result.reason || 'verified', markerPath }
      : { required: true, verification: 'unverified', detail: result && result.reason ? result.reason : 'operator stamp could not be verified', markerPath };
  } catch (err) {
    return { required: true, verification: 'unverified', detail: `GREENLIGHT verifier threw: ${err.message}`, markerPath };
  }
}

function requiresConvene(projectRoot, taskId) {
  try {
    const resolved = resolveTaskPlanPaths(projectRoot, taskId);
    const plan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
    const marker = readStateMarker(resolveStateMarkerPath(projectRoot, taskId, { clientCode: resolved.clientCode || undefined }));
    return Boolean(plan.routing_expectations && (plan.routing_expectations.risk_tier === 'high' || plan.routing_expectations.big === true)) || Boolean(marker && marker.big === true);
  } catch (_) {
    return true;
  }
}

function hasLegacyReviewArtifact(projectRoot, taskId) {
  try {
    return fs.readdirSync(path.join(projectRoot, '_dev', 'reports', 'analysis')).some((name) =>
      name.includes(taskId) && ['review-progress__', 'codex-last-message__', 'codex-cli-run__'].some((prefix) => name.startsWith(prefix))
    );
  } catch (_) {
    return false;
  }
}

function hasConveneEvidence(projectRoot, taskId) {
  try {
    const resolved = resolveTaskPlanPaths(projectRoot, taskId);
    const marker = readStateMarker(resolveStateMarkerPath(projectRoot, taskId, { clientCode: resolved.clientCode || undefined }));
    if (marker && marker.convene_review) return true;
    const dir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'convene-runs');
    return fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.includes(taskId));
  } catch (_) {
    return false;
  }
}

function collectSharedGate(projectRoot, taskId, argsText, options) {
  const stamp = assessVerifiedOperatorStamp(projectRoot, taskId, options);
  return collectPlanRunGateDecision(projectRoot, taskId, {
    legacyReviewPresent: hasLegacyReviewArtifact(projectRoot, taskId),
    requiresConvene: requiresConvene(projectRoot, taskId),
    convenePresent: hasConveneEvidence(projectRoot, taskId),
    operatorOverridePresent: String(argsText || '').split(/\s+/).includes(STAMP_OVERRIDE_FLAG),
    operatorStampRequired: stamp.required,
    operatorStampVerification: stamp.verification
  });
}

function appendRunnerComparison(projectRoot, mode, decision, legacyResult, traceEnv = {}) {
  if (!decision) return;
  appendPlanRunGateReceipt(projectRoot, {
    schema: 'PlanRunGateComparisonReceipt/1.0',
    decision_point_id: 'plan-run-authorization',
    at: new Date().toISOString(),
    adapter: 'run-plan',
    mode,
    task_id: decision.task_id,
    legacy_result: legacyResult,
    shared_result: decision.status,
    disagreement: ['ready', 'blocked'].includes(legacyResult) ? legacyResult !== decision.status : null,
    json_sha256: decision.json_sha256,
    markdown_sha256: decision.markdown_sha256,
    plan_pair_sha256: decision.plan_pair_sha256,
    marker_sha256: decision.marker_sha256,
    reason_codes: decision.reason_codes,
    trace_id: traceEnv.MYTHOS_TRACE_ID || process.env.MYTHOS_TRACE_ID || null,
    span_id: traceEnv.MYTHOS_SPAN_ID || process.env.MYTHOS_SPAN_ID || null
  });
}

/**
 * A2 (plan-approval-surface) — real run-time operator_stamp blocker on the
 * DISPATCHED /run-plan path (this runPlan() is what tools/commands/smos-command-runner.cjs
 * wires as the 'run-plan' handler). DEFAULT-OFF: only enforced once the deliberate
 * flag SMOS_ENFORCE_OPERATOR_STAMP is turned on (Stage B provides the stamp
 * production path; enforcing before that would jam every /run-plan).
 *
 * PERIMETER-SCOPED + VERIFIED: non-perimeter plans pass without a stamp. For a
 * perimeter plan under enforcement, a present operator_stamp is RE-VERIFIED here
 * at run time via synchronous HMAC (verifyPresentStampSync, bound to the current
 * plan digest) and BLOCKS unless verified===true. Fail-closed: unreadable/absent
 * marker, tampered/forged stamp, or post-stamp plan drift are all treated as a
 * missing/invalid stamp. (runPlan is a sync handler; the async Dart-authorship
 * GREENLIGHT proof is verified upstream — HMAC is the sync runner's live authority.)
 *
 * @returns {object|null} A blocked result, or null to proceed.
 */
function enforceOperatorStampGate(projectRoot, taskId, argsText, options) {
  if (!isOperatorStampEnforcementEnabled()) return null;
  const tokens = String(argsText || '').split(/\s+/).filter(Boolean);
  if (planRunGateMode() === 'off' && tokens.includes(STAMP_OVERRIDE_FLAG)) return null;
  const assessment = assessVerifiedOperatorStamp(projectRoot, taskId, options);
  if (!assessment.required || assessment.verification === 'verified') return null;
  const blocker = assessment.verification === 'unverified' ? 'operator-stamp-unverified' : 'operator-stamp-missing';

  return {
    exitCode: 2,
    stdout: [
      `Managed command blocked: /run-plan ${taskId}`,
      `Blocked reason [${blocker}]: ${assessment.detail}`,
      `Gate flag ${OPERATOR_STAMP_ENFORCEMENT_ENV} is ON and the plan trips the consequential perimeter: the version-bound operator-authored GREENLIGHT proof is RE-VERIFIED at run time. PRESENCE ALONE IS NOT AUTHORITY.`,
      `State marker: ${assessment.markerPath || '(unresolved)'}`,
      `${STAMP_OVERRIDE_FLAG} bypasses distinct-review/convene only and cannot bypass this operator-stamp invariant.`,
      `Exact next command: /stamp ${taskId}`
    ].join('\n'),
    stderr: '',
    outputs: []
  };
}

function runPlan(projectRoot, argsText, options = {}) {
  const taskId = (argsText || '').split(/\s+/)[0];
  if (!taskId) {
    return { exitCode: 1, stdout: '', stderr: 'Missing task-id/plan-id argument.' };
  }

  const gateMode = planRunGateMode();
  const sharedGate = gateMode === 'off' ? null : collectSharedGate(projectRoot, taskId, argsText, options);
  const finish = (result, legacyResult, traceEnv) => {
    appendRunnerComparison(projectRoot, gateMode, sharedGate, legacyResult, traceEnv);
    return result;
  };
  if (gateMode === 'enforce' && sharedGate.status === 'blocked') {
    return finish({
      exitCode: 2,
      stdout: [`Managed command blocked: /run-plan ${taskId}`, `Blocked reason [shared-plan-run-gate]: ${sharedGate.reason_codes.join(', ')}`, 'Exact next command: /review-task-plan ' + taskId].join('\n'),
      stderr: '',
      outputs: []
    }, 'not_evaluated_due_to_enforce');
  }

  // A2: operator_stamp run-time gate on the dispatched path (default-OFF, now
  // perimeter-scoped + run-time re-verified — see enforceOperatorStampGate).
  const stampBlock = enforceOperatorStampGate(projectRoot, taskId, argsText, options);
  if (stampBlock) return finish(stampBlock, 'blocked');

  // SH1 (close-the-loops): refuse to execute a plan while a LIVE repair-plan
  // pairing warning sidecar exists — converts the advisory .warning into a
  // run-time invariant. Deterministic + self-clearing on the named remedies.
  const pairing = assessRepairPlanPairingWarning(projectRoot, taskId);
  if (pairing.live) {
    return finish({
      exitCode: 2,
      stdout: [
        `Managed command blocked: /run-plan ${taskId}`,
        `Blocked reason [repair-plan-pairing-warning-live]: ${pairing.reason || 'a live task-plan pairing warning exists for this plan'}`,
        `Pairing warning sidecar: ${pairing.sidecarPath}`,
        `Desynced paired surface: ${pairing.sister || '(unknown)'}`,
        `Fix: run /repair-plan ${taskId} (atomic paired write), OR sync the sister file so the paired JSON+MD surfaces match, then the warning clears automatically.`
      ].join('\n'),
      stderr: '',
      outputs: []
    }, 'blocked');
  }

  // 1. Resolve Authority
  const decision = resolveAuthority(projectRoot, {
    taskPlan: taskId,
    execute: true
  });

  if (decision.status === 'blocked') {
    return finish({
      exitCode: 2,
      stdout: formatDecision(decision),
      stderr: ''
    }, 'blocked');
  }

  // 2. Stamp Trace Context
  const nextEnv = buildNextTraceEnv({
    scope: taskId,
    executionMode: 'managed'
  });

  // S5 autonomous execution (default-OFF). Reached ONLY when the operator has
  // flipped SMOS_AUTONOMOUS_EXECUTION AND a real executor is injected via
  // options.autonomous (a deliberate second control). The hasAutonomousDeps()
  // short-circuit keeps runPlan SYNCHRONOUS — and therefore byte-identical — on
  // both the default path and the flag-on-but-no-executor live path; only the
  // injected-executor path returns the async autonomous result. Safe-prefix only:
  // the run STOPS at the first gate step (which still needs GREENLIGHT).
  if (isAutonomousExecutionEnabled() && autonomousWiring.hasAutonomousDeps(options)) {
    appendRunnerComparison(projectRoot, gateMode, sharedGate, 'ready', nextEnv);
    return autonomousWiring.runAutonomousFromRunPlan({ projectRoot, taskId, options, traceEnv: nextEnv });
  }

  emitShadowCursorReceipt(projectRoot, taskId, sharedGate, nextEnv, options.shadowCursor || {});

  // 3. Return context for execution
  // In Codex, this means the agent now has the "authority" to proceed with the plan.
  return finish({
    exitCode: 0,
    stdout: [
      `[telemetry] trace_id=${nextEnv.MYTHOS_TRACE_ID} span_id=${nextEnv.MYTHOS_SPAN_ID}`,
      formatDecision(decision),
      '',
      'AUTHORITY GRANTED. You are now executing the approved task plan.',
      'Follow the bounded_plan steps in sequence.'
    ].join('\n'),
    stderr: ''
  }, 'ready', nextEnv);
}

function runRunPlan(projectRoot, opts = {}) {
  const args = Array.isArray(opts.args) ? opts.args : [];
  const ref = String(args[0] || '').trim();
  if (!ref) {
    return { exitCode: 2, stdout: 'Missing plan reference.', stderr: '', outputs: [] };
  }

  let resolved = null;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, ref);
  } catch {
    resolved = null;
  }

  if (resolved) {
    const taskId = ref.endsWith('__plan.json')
      ? ref.split('/').pop().replace(/__plan\.json$/, '')
      : ref;
    const markerPath = resolveStateMarkerPath(projectRoot, taskId, {
      clientCode: resolved.clientCode || undefined
    });
    const marker = readStateMarker(markerPath);
    const block = isRunPlanBlockedByPendingRepair(marker);
    if (block.blocked) {
      return {
        exitCode: 2,
        stdout: [
          `Managed command blocked: /run-plan ${taskId}`,
          `Blocked reason [${block.blocker}]: ${block.reason}`,
          `State marker: ${markerPath}`,
          `Exact next command: /review-task-plan ${taskId}`
        ].join('\n'),
        stderr: '',
        outputs: []
      };
    }
  }

  // A2 enforcement lives in runPlan() (the function the command-runner dispatches),
  // so the stamp gate fires whether /run-plan is reached via runPlan directly or
  // via this runRunPlan wrapper.
  return runPlan(projectRoot, args.join(' '), opts);
}

module.exports = {
  runPlan,
  runRunPlan,
  // S2 INERT exports (used by tests to prove the default path is unchanged).
  isAutonomousExecutionEnabled,
  AUTONOMOUS_EXECUTION_ENV,
  SHADOW_CURSOR_ENV,
  isShadowCursorEnabled,
  emitShadowCursorReceipt,
  assessVerifiedOperatorStamp,
  collectSharedGate
};
