#!/usr/bin/env node
'use strict';

/**
 * userprompt-plan-review-gate.cjs — mechanical gate on the plan lifecycle:
 *   plan -> codex (distinct-mind) review -> operator stamp -> (if BIG) /convene -> /run-plan
 *
 * PURPOSE
 *   2026-06-10 failure case: sdag-ads-approval-portal-mvp reached operator
 *   approval with ZERO distinct-mind review. Operator rule: the gate must be a
 *   mechanical hook, not memory/instructions. This hook fires on every
 *   UserPromptSubmit, short-circuits instantly on non-/run-plan prompts, and on
 *   /run-plan checks durable artifacts for (a) a distinct-mind (codex) review
 *   and (b) for BIG plans, a convene artifact.
 *
 * BLOCKING SEMANTICS (verified from this repo, not assumption)
 *   In-repo evidence verifies exit-2 blocking ONLY for PreToolUse
 *   (tools/kernel/hooks/pretool-delegation-altitude.cjs). Both existing
 *   UserPromptSubmit hooks (userprompt-owl-altitude.cjs,
 *   userpromptsubmit-ambient-router.cjs) use stdout-injection + exit 0; no
 *   local doc/test verifies UserPromptSubmit exit-2 or JSON-decision blocking.
 *   => This hook ships the LOUD-INJECTION variant: it emits an unmissable
 *   BLOCKING-STYLE directive into model context and always exits 0. The model
 *   (coordinator) is instructed not to proceed; the operator override below is
 *   always available.
 *
 * AUTHORITATIVE ARTIFACT CONVENTION (chosen + documented here)
 *   The plan-task-review-state marker
 *     _dev/state/plan-task-review-state/<plan-id>.json   (system scope)
 *     clients/<CODE>/state/plan-task-review-state/<plan-id>.json (client scope)
 *   is extended with:
 *     "distinct_reviews": [ { "actor": "codex gpt-5.5", "artifact": "<path>",
 *                             "at": "<ISO>", "verdict": "approve|reject|..." } ]
 *     "distinct_reviews_pending": [ { "actor", "artifact", "dispatched_at", "note" } ]
 *     "convene_review": { "artifact": "<path>", "at": "<ISO>" }   // BIG plans
 *     "big": true            // optional explicit BIG flag (client-facing /
 *                            // always-on-infra / multi-actor criteria)
 *   distinct_reviews is the AUTHORITY. A satisfying entry has a verdict
 *   matching /approve|pass|accept|lgtm|ok/i. "pending"/"in flight" entries and
 *   distinct_reviews_pending do NOT satisfy the gate (honest in-flight state).
 *   LEGACY FALLBACK for plans predating the schema: a file in
 *   _dev/reports/analysis/ named review-progress__*, codex-last-message__*, or
 *   codex-cli-run__* whose filename contains the plan id counts as a distinct
 *   review of last resort (the hook says so when it relies on it).
 *
 * BIG DETECTION (mechanical)
 *   BIG = plan JSON routing_expectations.risk_tier === "high"
 *         OR marker.big === true
 *         OR plan JSON routing_expectations.big === true
 *   (Client-facing surface / new always-on infrastructure / multi-actor are
 *   judgment calls: the reviewer/coordinator records them as marker.big=true
 *   at review time; risk_tier high is auto-detected.)
 *   BIG additionally requires a convene artifact:
 *   marker.convene_review OR _dev/reports/analysis/convene-runs/*<plan-id>*.
 *
 * OPERATOR OVERRIDE (the operator is the gate owner; never imprisoned)
 *   Include `--skip-distinct-review` in the /run-plan prompt. The hook injects
 *   an acknowledgment, appends a record to
 *   _dev/state/plan-review-gate/overrides.jsonl, and lets the run pass.
 *
 * KILL SWITCH: touch _dev/state/plan-review-gate/disabled  => silent no-op.
 * PERFORMANCE: regex short-circuit BEFORE any fs/require work on the plan
 *   surfaces; non-matching prompts exit silently in well under 200ms.
 * CONTRACT: never throws, never blocks the turn; always exit 0.
 *
 * Stdin: UserPromptSubmit JSON payload ({ prompt, session_id, cwd, ... }).
 * Stdout: nothing (no match) | pass note | WARN | loud blocking-style directive.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Prompt matchers: a /run-plan invocation at start of prompt (with or without
// the leading slash) or an explicit /run-plan anywhere in the prompt.
const RUN_PLAN_LEAD = /^\s*\/?run-plan\b(?:\s+([a-z0-9][a-z0-9_-]*))?/i;
const RUN_PLAN_ANYWHERE = /(?<![`'"\w])\/run-plan\b(?:\s+([a-z0-9][a-z0-9_-]*))?/i;
const OVERRIDE_FLAG = '--skip-distinct-review';

const SATISFYING_VERDICT = /approve|pass|accept|lgtm|\bok\b/i;
const LEGACY_ARTIFACT_PREFIXES = ['review-progress__', 'codex-last-message__', 'codex-cli-run__'];

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

/** Extract { matched, planRef, override } from the prompt. Pure string work. */
function parsePrompt(prompt) {
  const p = String(prompt || '');
  if (!p.trim()) return { matched: false };

  // Strip override flags before matching so the plan ref is the first real token.
  const pClean = p.split(OVERRIDE_FLAG).join(' ');
  let m = RUN_PLAN_LEAD.exec(pClean);
  if (!m) m = RUN_PLAN_ANYWHERE.exec(pClean);
  if (!m) return { matched: false };

  const override = p.includes(OVERRIDE_FLAG);
  // First non-flag token after run-plan is the plan ref (may be absent).
  let planRef = null;
  const rest = (m[1] || '').trim();
  if (rest) {
    const tokens = rest.split(/\s+/);
    for (const t of tokens) {
      if (t.startsWith('--')) continue;
      planRef = t;
      break;
    }
  }
  return { matched: true, planRef, override };
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return null; }
}

/** Locate the review-state marker (system scope first, then any client scope). */
function findMarker(projectRoot, planId, clientCode) {
  const candidates = [
    path.join(projectRoot, '_dev', 'state', 'plan-task-review-state', planId + '.json')
  ];
  if (clientCode) {
    candidates.push(path.join(projectRoot, 'clients', clientCode, 'state', 'plan-task-review-state', planId + '.json'));
  }
  for (const c of candidates) {
    const parsed = readJsonSafe(c);
    if (parsed) return { path: c, marker: parsed };
  }
  return { path: candidates[0], marker: null };
}

/** Legacy fallback: artifact in _dev/reports/analysis/ with codex provenance + plan id in filename. */
function findLegacyReviewArtifact(projectRoot, planId) {
  try {
    const dir = path.join(projectRoot, '_dev', 'reports', 'analysis');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (!f.includes(planId)) continue;
      for (const prefix of LEGACY_ARTIFACT_PREFIXES) {
        if (f.startsWith(prefix)) return path.join('_dev', 'reports', 'analysis', f);
      }
    }
  } catch (_) { /* best-effort */ }
  return null;
}

/** Convene evidence: marker.convene_review OR convene-runs dir containing plan id. */
function findConveneEvidence(projectRoot, planId, marker) {
  if (marker && marker.convene_review &&
      (typeof marker.convene_review === 'object' || typeof marker.convene_review === 'string')) {
    return { source: 'marker.convene_review', ref: JSON.stringify(marker.convene_review) };
  }
  try {
    const dir = path.join(projectRoot, '_dev', 'reports', 'analysis', 'convene-runs');
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      for (const e of entries) {
        if (e.includes(planId)) return { source: 'convene-runs', ref: path.join('_dev/reports/analysis/convene-runs', e) };
      }
    }
  } catch (_) { /* best-effort */ }
  return null;
}

/**
 * Resolve the convene-run DIRECTORY referenced by a marker.convene_review field,
 * for synthesis validation. Returns an absolute dir path or null when the field
 * is opaque (not a filesystem path) — opaque records are left unassessed so we do
 * not false-block a deliberately operator-authored note. A path-like ref that
 * points at a file (e.g. .../synthesis.md) resolves to its containing dir; a
 * path-like ref to a missing location resolves to that (missing) dir so the
 * validator fail-closes it (a marker pointing at a vanished convene is hollow).
 */
function resolveConveneReviewDir(projectRoot, conveneReview) {
  let raw = null;
  if (typeof conveneReview === 'string') {
    raw = conveneReview;
  } else if (conveneReview && typeof conveneReview === 'object') {
    raw = conveneReview.dir || conveneReview.artifact || conveneReview.path || conveneReview.ref || null;
  }
  if (!raw || typeof raw !== 'string') return null;
  // Only treat as a convene-run dir if the ref is path-like (a slash) or clearly
  // names a convene run; otherwise it is an opaque operator note → leave unassessed.
  if (!raw.includes('/') && !/convene/i.test(raw)) return null;
  const abs = path.isAbsolute(raw) ? raw : path.join(projectRoot, raw);
  try {
    const st = fs.statSync(abs);
    if (st.isDirectory()) return abs;
    if (st.isFile()) return path.dirname(abs);
  } catch (_) {
    // Does not exist. If it looks like a file ref, validate the parent dir; else
    // validate the (missing) path itself so the validator fail-closes it.
    return /\.[a-z0-9]+$/i.test(abs) ? path.dirname(abs) : abs;
  }
  return null;
}

/** Classify the distinct-review state from the marker (+ legacy fallback). */
function assessDistinctReview(projectRoot, planId, marker) {
  const reviews = (marker && Array.isArray(marker.distinct_reviews)) ? marker.distinct_reviews : [];
  const satisfied = reviews.filter(function (r) {
    return r && typeof r.verdict === 'string' && SATISFYING_VERDICT.test(r.verdict) && !/pending|in.flight/i.test(r.verdict);
  });
  if (satisfied.length > 0) {
    const r = satisfied[0];
    return { status: 'satisfied', source: 'marker.distinct_reviews', detail: (r.actor || 'unknown actor') + ' verdict "' + r.verdict + '" (' + (r.artifact || 'no artifact ref') + ')' };
  }
  const rejected = reviews.filter(function (r) {
    return r && typeof r.verdict === 'string' && /reject|fail|block/i.test(r.verdict);
  });
  if (rejected.length > 0) {
    const r = rejected[0];
    return { status: 'rejected', source: 'marker.distinct_reviews', detail: (r.actor || 'unknown actor') + ' verdict "' + r.verdict + '" (' + (r.artifact || 'no artifact ref') + ')' };
  }
  const pendingInline = reviews.filter(function (r) {
    return r && (!r.verdict || /pending|in.flight/i.test(String(r.verdict)));
  });
  const pendingList = (marker && Array.isArray(marker.distinct_reviews_pending)) ? marker.distinct_reviews_pending : [];
  if (pendingInline.length > 0 || pendingList.length > 0) {
    const p = pendingInline[0] || pendingList[0];
    return { status: 'pending', source: 'marker', detail: (p.actor || 'unknown actor') + ' review in flight (' + (p.artifact || p.note || 'no ref') + ')' };
  }
  // Legacy artifact-glob fallback for plans predating the marker schema.
  const legacy = findLegacyReviewArtifact(projectRoot, planId);
  if (legacy) {
    return { status: 'satisfied-legacy', source: 'artifact-glob', detail: legacy + ' (legacy fallback; record it in marker.distinct_reviews to make this authoritative)' };
  }
  return { status: 'missing', source: null, detail: null };
}

/**
 * A1 operator_stamp enforcement assessment. Lazily requires the planning lib
 * (single source of truth for the flag + presence contract) inside a try/catch
 * so a missing/broken lib NEVER breaks the turn — it degrades to enforcement-OFF
 * (the bootstrap-safe default). Returns { enforced, status, detail }.
 */
function assessOperatorStampEnforcement(marker) {
  try {
    const prs = require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js'));
    if (prs && typeof prs.isOperatorStampEnforcementEnabled === 'function' &&
        prs.isOperatorStampEnforcementEnabled()) {
      const a = prs.assessOperatorStamp(marker);
      return { enforced: true, status: a.status, detail: a.detail };
    }
  } catch (_) {
    // Lib unavailable/broken — default OFF (bootstrap-safe; never break the turn).
  }
  return { enforced: false, status: 'not-enforced', detail: 'enforcement disabled' };
}

/**
 * S5 (plan-execution-autonomy-default-perimeter-gate-and-tracking) perimeter
 * scoping. Does the plan trip the consequential perimeter (=> require the
 * operator GREENLIGHT/stamp)? Lazily requires the S1-backed wiring lib inside a
 * try/catch so a missing/broken lib NEVER breaks the turn. FAIL-CLOSED: any
 * uncertainty (lib unavailable, classifier throw) => TRUE (treat as perimeter =>
 * keep requiring the stamp). Consulted ONLY inside the already-enforced branch,
 * so the default (flag-OFF) path is byte-unchanged.
 */
function planTripsConsequentialPerimeter(planJson) {
  try {
    const wiring = require(path.join(PROJECT_ROOT, 'tools', 'kernel', 'lib', 'autonomous-execution-wiring.js'));
    return wiring.planTripsPerimeter(planJson);
  } catch (_) {
    return true; // fail-closed: cannot classify => treat as perimeter => require stamp
  }
}

function isBig(planJson, marker) {
  const reasons = [];
  const re = planJson && planJson.routing_expectations;
  if (re && re.risk_tier === 'high') reasons.push('routing_expectations.risk_tier=high');
  if (re && re.big === true) reasons.push('routing_expectations.big=true');
  if (marker && marker.big === true) reasons.push('marker.big=true (client-facing / always-on infra / multi-actor)');
  return { big: reasons.length > 0, reasons };
}

function logOverride(projectRoot, record) {
  try {
    const dir = path.join(projectRoot, '_dev', 'state', 'plan-review-gate');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'overrides.jsonl'), JSON.stringify(record) + '\n', 'utf8');
    return true;
  } catch (_) { return false; }
}

function sharedGateMode() {
  try {
    return require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js')).planRunGateMode();
  } catch (_) {
    return 'observe';
  }
}

function collectSharedHookGate(projectRoot, planId, parsed, planJson, marker, review, bigness, resolved, convene) {
  const prs = require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js'));
  const stampEnforced = prs.isOperatorStampEnforcementEnabled();
  const tripsPerimeter = stampEnforced ? planTripsConsequentialPerimeter(planJson) : false;
  let stampVerification = tripsPerimeter ? 'missing' : 'not_required';
  if (tripsPerimeter && prs.assessOperatorStamp(marker).status === 'present') {
    try {
      const wiring = require(path.join(PROJECT_ROOT, 'tools', 'kernel', 'lib', 'autonomous-execution-wiring.js'));
      const result = wiring.verifyPresentStampSync({ planId, planJsonPath: resolved.jsonPath, stamp: marker.operator_stamp });
      stampVerification = result && result.verified === true ? 'verified' : 'unverified';
    } catch (_) {
      stampVerification = 'unverified';
    }
  }
  return prs.collectPlanRunGateDecision(projectRoot, planId, {
    legacyReviewPresent: review.status === 'satisfied-legacy',
    requiresConvene: bigness.big,
    convenePresent: Boolean(convene),
    operatorOverridePresent: parsed.override,
    operatorStampRequired: tripsPerimeter,
    operatorStampVerification: stampVerification
  });
}

function appendHookComparison(projectRoot, mode, decision, legacyResult) {
  if (!decision) return;
  try {
    require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'plan-review-state.js')).appendPlanRunGateReceipt(projectRoot, {
      schema: 'PlanRunGateComparisonReceipt/1.0',
      decision_point_id: 'plan-run-authorization',
      at: new Date().toISOString(),
      adapter: 'userprompt-plan-review-gate',
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
      trace_id: process.env.MYTHOS_TRACE_ID || null,
      span_id: process.env.MYTHOS_SPAN_ID || null
    });
  } catch (_) { /* receipts never break or pollute the hook */ }
}

/**
 * Core evaluation. Returns { action: 'silent' | 'inject', text? }.
 * projectRoot is injectable for tests; sessionId only feeds the override log.
 */
function evaluateGate(prompt, projectRoot, sessionId) {
  const parsed = parsePrompt(prompt);
  if (!parsed.matched) return { action: 'silent' };
  const gateMode = sharedGateMode();

  // Kill switch — checked only after the cheap regex match.
  try {
    if (fs.existsSync(path.join(projectRoot, '_dev', 'state', 'plan-review-gate', 'disabled'))) {
      return { action: 'silent' };
    }
  } catch (_) { /* fall through */ }

  // Operator override — gate owner is never imprisoned.
  if (parsed.override) {
    const logged = logOverride(projectRoot, {
      at: new Date().toISOString(),
      plan_ref: parsed.planRef || null,
      session_id: sessionId || null,
      flag: OVERRIDE_FLAG,
      prompt_head: String(prompt).slice(0, 200)
    });
    if (gateMode === 'off') {
      return {
        action: 'inject',
        text: [
          '[plan-review-gate] OPERATOR OVERRIDE acknowledged (' + OVERRIDE_FLAG + ').',
          'The distinct-review/convene gate for ' + (parsed.planRef || '(unspecified plan)') + ' was skipped by the gate owner.',
          logged ? 'Override logged to _dev/state/plan-review-gate/overrides.jsonl.' : 'WARNING: override log write failed (gate still passes).',
          'Proceed with /run-plan.'
        ].join('\n')
      };
    }
    parsed.override_logged = logged;
  }

  if (!parsed.planRef) {
    return {
      action: 'inject',
      text: [
        '[plan-review-gate] WARN: /run-plan invoked without a plan reference; the mechanical distinct-review gate cannot check artifacts.',
        'Pipeline rule (operator, 2026-06-10): plan -> codex distinct review -> operator stamp -> (if BIG) /convene -> /run-plan.',
        'Before executing, VERIFY the resolved plan has a satisfying entry in its plan-task-review-state marker distinct_reviews[] (and convene_review for BIG plans).'
      ].join('\n')
    };
  }

  // Resolve the plan (best-effort; never crash the turn).
  let resolved = null;
  let resolveError = null;
  try {
    const resolver = require(path.join(PROJECT_ROOT, 'tools', 'planning', 'lib', 'resolve-task-plan.js'));
    resolved = resolver.resolveTaskPlanPaths(projectRoot, parsed.planRef);
  } catch (err) {
    resolveError = err && err.message ? err.message : String(err);
  }

  if (!resolved) {
    return {
      action: 'inject',
      text: [
        '[plan-review-gate] WARN: could not resolve plan "' + parsed.planRef + '"' + (resolveError ? ' (' + resolveError.split('\n')[0] + ')' : ' (no matching task-plan found)') + '.',
        'The mechanical distinct-review gate could not run. Pipeline rule still applies:',
        'plan -> codex distinct review -> operator stamp -> (if BIG) /convene -> /run-plan.',
        'If /run-plan resolves this plan another way, verify its plan-task-review-state marker distinct_reviews[] before executing.'
      ].join('\n')
    };
  }

  // Derive plan id from the resolved JSON filename.
  const base = path.basename(resolved.jsonPath);
  const planId = base.endsWith('__plan.json') ? base.slice(0, -'__plan.json'.length) : parsed.planRef;
  const planJson = readJsonSafe(resolved.jsonPath);
  const found = findMarker(projectRoot, planId, resolved.clientCode);
  const marker = found.marker;

  const review = assessDistinctReview(projectRoot, planId, marker);
  const bigness = isBig(planJson, marker);
  const convene = bigness.big ? findConveneEvidence(projectRoot, planId, marker) : null;

  // REJECT_HOLLOW_COMPLETION (kernel convene 20260629T214856Z): a convene-run
  // DIRECTORY only counts as evidence if it carries a real synthesis.md (not just
  // the mechanically-written synthesis-skeleton.md, and not a keyword-padded fake).
  // Gated behind the DEFAULT-OFF flag SMOS_REQUIRE_CONVENE_SYNTHESIS so the default
  // path is byte-unchanged: the env is read ONLY here, and conveneHollowReason
  // stays null unless the flag is on AND a resolvable convene-run dir fails
  // validation. Covers BOTH evidence sources — the auto-discovered convene-runs dir
  // AND a marker.convene_review that points at a convene-run dir (a marker pointing
  // at a hollow convene must not satisfy the gate either). An opaque
  // marker.convene_review with no resolvable dir path is left as-is (not assessable
  // => preserve the operator-authored record).
  let conveneHollowReason = null;
  if (bigness.big && convene && process.env.SMOS_REQUIRE_CONVENE_SYNTHESIS) {
    let dirToValidate = null;
    if (convene.source === 'convene-runs') {
      dirToValidate = path.join(projectRoot, convene.ref);
    } else if (convene.source === 'marker.convene_review') {
      dirToValidate = resolveConveneReviewDir(projectRoot, marker && marker.convene_review);
    }
    if (dirToValidate) {
      let validation;
      try {
        const { validateConveneSynthesis } = require(path.join(PROJECT_ROOT, 'tools', 'kernel', 'lib', 'validate-convene-synthesis.cjs'));
        validation = validateConveneSynthesis(dirToValidate);
      } catch (_) {
        validation = { valid: false, reason: 'synthesis validator unavailable (fail-closed)' };
      }
      if (!validation.valid) conveneHollowReason = validation.reason;
    }
  }

  let sharedGate = null;
  if (gateMode !== 'off') {
    try {
      sharedGate = collectSharedHookGate(projectRoot, planId, parsed, planJson, marker, review, bigness, resolved, convene);
    } catch (_) {
      sharedGate = { task_id: planId, status: 'blocked', reason_codes: ['shared_gate_collection_failed'] };
    }
    if (gateMode === 'enforce' && sharedGate.status === 'blocked') {
      appendHookComparison(projectRoot, gateMode, sharedGate, 'not_evaluated_due_to_enforce');
      return {
        action: 'inject',
        text: [
          '████ [plan-review-gate] DO NOT EXECUTE /run-plan ' + planId + ' — SHARED GATE FAILED ████',
          'Blocked reasons: ' + sharedGate.reason_codes.join(', ') + '.',
          'Exact next command: /review-task-plan ' + planId
        ].join('\n')
      };
    }
  }

  const missing = [];
  if (!parsed.override && review.status === 'missing') {
    missing.push({
      what: 'DISTINCT-MIND (codex) REVIEW — no distinct_reviews entry in ' + found.path + ' and no legacy codex artifact in _dev/reports/analysis/ names this plan.',
      fix: 'Produce it: /dispatch-bridge — dispatch a codex review of ' + planId + ' (target: codex; prompt: review the plan at ' + path.relative(projectRoot, resolved.jsonPath) + '), then record {actor, artifact, at, verdict} in marker.distinct_reviews.'
    });
  } else if (!parsed.override && review.status === 'pending') {
    missing.push({
      what: 'DISTINCT-MIND REVIEW IS STILL IN FLIGHT — ' + review.detail + '. A pending review does not satisfy the gate.',
      fix: 'Wait for the codex verdict, record it in marker.distinct_reviews with a real verdict, then re-run /run-plan ' + planId + '.'
    });
  } else if (!parsed.override && review.status === 'rejected') {
    missing.push({
      what: 'DISTINCT-MIND REVIEW REJECTED THIS PLAN — ' + review.detail + '.',
      fix: 'Repair the plan (/repair-plan or /amend-plan), obtain a fresh approving distinct review, then re-run.'
    });
  }
  if (!parsed.override && bigness.big && !convene) {
    missing.push({
      what: 'BIG PLAN WITHOUT CONVENE — ' + bigness.reasons.join(', ') + ', but no convene artifact (_dev/reports/analysis/convene-runs/*' + planId + '*) and no convene_review in the marker.',
      fix: 'Produce it: /convene on ' + planId + ' (triadic review), then record convene_review {artifact, at} in the marker.'
    });
  } else if (!parsed.override && bigness.big && conveneHollowReason) {
    // REJECT_HOLLOW_COMPLETION: a convene-run dir exists (auto-discovered OR pointed
    // at by marker.convene_review) but its synthesis is missing/skeleton/padded.
    // Only reachable when SMOS_REQUIRE_CONVENE_SYNTHESIS is ON.
    missing.push({
      what: 'REJECT_HOLLOW_COMPLETION — BIG plan convene evidence (' + convene.source + ': ' + convene.ref + ') is HOLLOW: ' + conveneHollowReason + '. A skeleton-only or keyword-padded convene (synthesis skipped/faked) is NOT convene evidence.',
      fix: 'Complete the synthesis: the ORIGIN actor writes a real synthesis.md (NOT synthesis-skeleton.md) — referencing the convened slots with cross-verification catches and net findings — then re-run /run-plan ' + planId + '.'
    });
  }

  // A1 (plan-approval-surface): operator_stamp is a THIRD mechanical requirement,
  // separate from distinct-review and convene (Stamp != convene). It was named in
  // this hook's pipeline text but never CHECKED, so a marker with
  // operator_stamp:null passed. Now enforced — but only when the default-OFF
  // feature flag SMOS_ENFORCE_OPERATOR_STAMP is deliberately turned on (bootstrap
  // safety: Stage B, not built yet, is what produces a verifiable stamp; enforcing
  // before that exists would jam every /run-plan). PRESENCE-only here; run-time
  // authenticity re-verification is Stage B/D, not built here.
  // S5 perimeter scoping (amendment: "enforce only at the perimeter"): a missing
  // stamp is a BLOCKING requirement ONLY when the plan trips the consequential
  // perimeter (S1 classifier => 'gate'). Non-perimeter (auto-run) plans pass the
  // stamp requirement even under enforcement. The perimeter consult runs ONLY
  // inside the enforcement-ON branch, so the default flag-OFF path is unchanged.
  const stamp = assessOperatorStampEnforcement(marker);
  if (stamp.enforced && stamp.status !== 'present' && planTripsConsequentialPerimeter(planJson)) {
    missing.push({
      what: 'OPERATOR STAMP — ' + stamp.detail + ' (gate flag SMOS_ENFORCE_OPERATOR_STAMP is ON; plan trips the consequential perimeter). Stamp != convene; this is a separate requirement.',
      fix: 'Obtain the operator approval stamp for ' + planId + ' (out-of-band proof: an operator-authored Dart approval comment, or the /stamp HMAC fallback per the plan-approval-surface concept), then re-run /run-plan ' + planId + '. NOTE: presence is necessary but run-time authenticity re-verification is Stage B/D.'
    });
  }

  if (missing.length > 0) {
    const lines = [
      '████ [plan-review-gate] DO NOT EXECUTE /run-plan ' + planId + ' — MECHANICAL GATE FAILED ████',
      'Operator pipeline rule (2026-06-10): plan -> codex distinct review -> operator stamp -> (if BIG) /convene -> /run-plan.',
      'A producer cannot validate its own acceptance-grade outcome. The following requirements are UNMET:'
    ];
    missing.forEach(function (m, i) {
      lines.push((i + 1) + '. MISSING: ' + m.what);
      lines.push('   PRODUCE IT: ' + m.fix);
    });
    lines.push('Coordinator: treat this as a BLOCK. Do not route to plan execution. Surface this gate result to the operator verbatim.');
    lines.push('Operator review override `' + OVERRIDE_FLAG + '` bypasses distinct-review/convene only. It cannot clear plan drift, repair, perimeter, or operator-stamp invariants.');
    appendHookComparison(projectRoot, gateMode, sharedGate, 'blocked');
    return { action: 'inject', text: lines.join('\n') };
  }

  // All requirements satisfied — short pass note.
  const passLines = parsed.override
    ? ['[plan-review-gate] OPERATOR OVERRIDE acknowledged (' + OVERRIDE_FLAG + '): distinct-review/convene checks bypassed; hard invariants remain active.', parsed.override_logged ? 'Override logged to _dev/state/plan-review-gate/overrides.jsonl.' : 'WARNING: override log write failed.']
    : ['[plan-review-gate] PASS for ' + planId + ': distinct-mind review verified via ' + review.source + ' — ' + review.detail + '.'];
  if (!parsed.override && bigness.big) {
    passLines.push('[plan-review-gate] BIG plan (' + bigness.reasons.join(', ') + '): convene evidence verified — ' + convene.ref + '.');
  }
  if (stamp.enforced && stamp.status === 'present') {
    passLines.push('[plan-review-gate] operator_stamp PRESENT (presence-only; run-time authenticity re-verification is Stage B/D, not this hook).');
  }
  appendHookComparison(projectRoot, gateMode, sharedGate, 'ready');
  return { action: 'inject', text: passLines.join('\n') };
}

function main() {
  let payload = {};
  try { payload = JSON.parse(readStdin() || '{}'); } catch (_) { payload = {}; }
  const prompt = String(payload.prompt || '');

  // FAST PATH: pure-regex short-circuit before any fs/require work.
  if (!parsePrompt(prompt).matched) {
    process.exit(0);
  }

  const result = evaluateGate(prompt, PROJECT_ROOT, payload.session_id || null);
  if (result.action === 'inject' && result.text) {
    process.stdout.write(result.text + '\n');
  }
  process.exit(0);
}

// Exposed for unit testing.
module.exports = { parsePrompt, evaluateGate, assessDistinctReview, isBig, findConveneEvidence, assessOperatorStampEnforcement, planTripsConsequentialPerimeter, collectSharedHookGate, appendHookComparison, sharedGateMode };

if (require.main === module) {
  try {
    main();
  } catch (_) {
    // Never break the turn.
    process.exit(0);
  }
}
