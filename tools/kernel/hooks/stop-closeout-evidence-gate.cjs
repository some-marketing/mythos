#!/usr/bin/env node
'use strict';
// stop-closeout-evidence-gate.cjs — Stop-surface closeout-evidence gate.
//
// ENFORCEMENT_FAMILY: quality-process
//   (tier-s2a-safety-family-lint — tier-consuming quality/process gate, never
//   a safety gate.)
//
// tier-enforcement-implementation slice 2, step
// tier-s2d-closeout-and-delegation-consumers (convene 20260611T130035Z
// conditions 8, 11). Consumes the `closeout-evidence-gate` and
// `no-final-status-authority` adds resolved LIVE from ProcessTierRule/1.2 via
// readSessionAdds — never tier names.
//
// BEHAVIOR (MODE-DEPENDENT, resolved live from the registry add.mode:
// report-only logs the evidence deficit to the soak ledger and NEVER traps;
// blocking — live since 2026-06-15 — additionally returns status 2 to trap
// the Stop until the evidence set is present. The Stop message header renders
// the live mode truthfully. Both modes are edits-gated and fail-open):
//   * Applies only to sessions carrying the closeout-evidence-gate add
//     (associate + scaffold today) that actually AUTHORED this session
//     (delegation-altitude state edits > 0 — the existing mechanical
//     changed-files signal). Sessions that authored nothing owe no evidence.
//   * Closeout evidence = at least one durable closeout artifact written
//     since the session stamp (debrief / task-outcome / handoff surfaces).
//   * For sessions ALSO carrying no-final-status-authority (and not in the
//     reviewer role), acceptance-grade closeout additionally requires a
//     distinct-review artifact written since the session stamp
//     (task-plan-reviews / codex-last-message bridge returns).
//   * REVIEWER-ROLE EXEMPTION (convene condition 8): keyed on the session
//     ROLE (payload.session_role / MYTHOS_SESSION_ROLE), NEVER on model name —
//     gpt-5/opus distinct-reviewer lanes are untouched.
//   * Deficit events are deduped per session by deficit-set hash (Stop fires
//     every turn; the ledger records changes, not every turn).
//
// KILL SWITCH (bypass_policy, operator authority):
//   _dev/state/kill-switches/closeout-evidence-gate.off
//
// TEST RULE OVERRIDE: MYTHOS_TIER_GATE_RULE_PATH (logged in events, never
// silent) — same contract as pretool-mutation-plan-gate.cjs.
//
// Fail-open by construction: any internal error returns { status: 0 }.

const fs = require('fs');
const path = require('path');
const { emitDebriefCloseObservation } = require('../cascade-span/debrief-close-span-projection.cjs');
const {
  authorizeEnforcementClaim,
  issueEnforcementClaim,
  protocolView,
  recordStaleClaimDenial
} = require('../enforcement-home/enforcement-home-registry.cjs');
const {
  ROOT,
  readRuleSafe,
  readSessionAdds,
  readSessionStamp,
  safeSessionId
} = require('./lib/process-tier.cjs');

const ADD_ID = 'closeout-evidence-gate';
const REVIEW_ADD_ID = 'no-final-status-authority';
const SOAK_DIR_REL = '_dev/state/tier-gate-soak';

function notApplicable(skipReason, extra = {}) {
  return {
    status: 0,
    ...extra,
    debrief_decision: {
      protocol: 'debrief_before_closeout',
      outcome: 'not_applicable',
      skip_reason: skipReason,
      enforced: false
    }
  };
}

function observeDebriefDecision(root, payload, opts, decision) {
  return emitDebriefCloseObservation({
    root,
    home: 'claude-hook',
    runtimeSessionId: resolveSessionId(payload),
    scopeIdentity: payload.scope || payload.scope_identity || null,
    closeReason: payload.stop_reason || payload.reason || 'stop',
    outcome: decision.outcome,
    enforced: decision.enforced,
    startedAt: decision.decided_at,
    endedAt: decision.decided_at,
    emitSource: 'claude-stop:stop-closeout-evidence-gate',
    context: opts.debriefContext || payload.debrief_close_context,
    env: opts.env || process.env,
    spanLogPath: opts.spanLogPath,
    observationLogPath: opts.observationLogPath,
    failureLogPath: opts.failureLogPath
  });
}

// Durable closeout-evidence surfaces (repo-relative directories scanned for
// files modified since the session stamp).
const CLOSEOUT_EVIDENCE_DIRS = [
  '_dev/reports/debriefs',
  '_dev/reports/analysis/task-outcomes',
  '_dev/handoffs'
];

// Distinct-review evidence surfaces: a directory, or a directory + filename
// prefix filter.
const DISTINCT_REVIEW_PROBES = [
  { dir: '_dev/reports/analysis/task-plan-reviews' },
  { dir: '_dev/reports/analysis', prefix: 'codex-last-message__' }
];

// Plan-task-review-state directory (repo-relative): markers listing
// distinct_reviews with artifact paths and the covering plan_id.
const PLAN_REVIEW_STATE_DIR = '_dev/state/plan-task-review-state';

function projectRoot(opts = {}) {
  return opts.root || process.env.CLAUDE_PROJECT_DIR || ROOT;
}

function resolveRule(opts = {}) {
  if (opts.rule !== undefined) return { rule: opts.rule, overridePath: null };
  const override = String(process.env.MYTHOS_TIER_GATE_RULE_PATH || '').trim();
  if (override && fs.existsSync(override)) {
    return { rule: readRuleSafe(override), overridePath: override };
  }
  return { rule: readRuleSafe(), overridePath: null };
}

function resolveSessionId(payload) {
  return String(
    (payload && payload.session_id) ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CLAUDE_SESSION ||
    'unknown-session'
  );
}

function resolveRole(payload) {
  return String(
    (payload && payload.session_role) ||
    process.env.MYTHOS_SESSION_ROLE ||
    ''
  ).trim().toLowerCase();
}

function killSwitchPath(root, add, addId) {
  const rel = (add && add.bypass_policy && add.bypass_policy.kill_switch) ||
    `_dev/state/kill-switches/${addId}.off`;
  return path.isAbsolute(rel) ? rel : path.join(root, rel);
}

// The existing mechanical authoring signal: delegation-altitude per-session
// state counts authoring edits (Write/Edit/MultiEdit + authoring-shaped Bash).
function sessionAuthored(root, sessionId) {
  try {
    const stateFile = path.join(root, '_dev/state/delegation-altitude', `${sessionId}.json`);
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return Number.isFinite(parsed.edits) && parsed.edits > 0;
  } catch {
    return false;
  }
}

function anyFileNewerThan(root, dirRel, sinceMs, prefix) {
  try {
    const dir = path.join(root, dirRel);
    for (const name of fs.readdirSync(dir)) {
      if (prefix && !name.startsWith(prefix)) continue;
      try {
        const st = fs.statSync(path.join(dir, name));
        if (st.isFile() && st.mtimeMs >= sinceMs) return true;
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    // missing dir — no evidence there
  }
  return false;
}

// Codex W1 remediation (amendment tier-enforcement-implementation__amendment__20260611T145003Z)
// GENERALIZED by holistic-acceptance C2 (convene 20260616T112349Z / approach 20260616T130036Z):
// bind ALL evidence probes to the producing session, not just bridge-returns.
//
// loadBindingAnchors — collect the per-session binding anchors ONCE:
//   * coveringPlanIds / listedArtifacts — from plan-task-review-state markers.
//   * editLogPathsAbs — the absolute paths THIS session actually mutated, read
//     from its delegation-altitude edit log (paths[]). Strongest, ZERO-FRICTION
//     binding surface (gemini): a session that WROTE an artifact is provably its
//     producer, so its own debrief/handoff binds automatically — no UUID
//     convention to forget, no self-trap.
function loadBindingAnchors(root, sessionId) {
  const coveringPlanIds = new Set();
  const listedArtifacts = new Set();
  const editLogPathsAbs = new Set();

  const scanMarkerDir = (absDir) => {
    try {
      for (const name of fs.readdirSync(absDir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const marker = JSON.parse(fs.readFileSync(path.join(absDir, name), 'utf8'));
          if (!marker || typeof marker !== 'object') continue;
          const planId = marker.plan_id || marker.task_id;
          if (planId) {
            coveringPlanIds.add(String(planId));
            for (const dr of (Array.isArray(marker.distinct_reviews) ? marker.distinct_reviews : [])) {
              if (dr && dr.artifact) listedArtifacts.add(String(dr.artifact));
            }
          }
        } catch { /* unreadable marker - skip */ }
      }
    } catch { /* missing dir - skip */ }
  };

  // System-scope markers + client-scoped markers
  // (clients/<CODE>/state/plan-task-review-state/ — codex C2 MAJOR; mirrors the
  // candidate set in userprompt-plan-review-gate.cjs).
  scanMarkerDir(path.join(root, PLAN_REVIEW_STATE_DIR));
  try {
    const clientsDir = path.join(root, 'clients');
    for (const code of fs.readdirSync(clientsDir)) {
      scanMarkerDir(path.join(clientsDir, code, 'state', 'plan-task-review-state'));
    }
  } catch { /* no clients dir - system markers only */ }

  try {
    const editLog = path.join(root, '_dev/state/delegation-altitude', sessionId + '.json');
    const parsed = JSON.parse(fs.readFileSync(editLog, 'utf8'));
    for (const p of (Array.isArray(parsed.paths) ? parsed.paths : [])) {
      if (!p) continue;
      editLogPathsAbs.add(path.isAbsolute(p) ? p : path.join(root, p));
    }
  } catch { /* no edit log for this session - edit-log strategy simply won't match */ }

  return { coveringPlanIds, listedArtifacts, editLogPathsAbs };
}

// findBoundFreshArtifact — scan dirRel (optional filename prefix) for a file that
// is BOTH fresh (mtime >= sinceMs) AND bound to the producing session, by the
// binding ladder below (first hit wins). Generalizes the former bridge-only
// binder to EVERY evidence probe (C2).
//
// Returns { bound: true } | { bound: false, reason: 'binding_unresolved' }
// (fresh exists but unbound - never silently clears) | null (no fresh artifact).
// Internal errors degrade to null so the gate stays fail-open.
//
// Ladder (strongest first); opts gates the weaker rungs per surface (codex C2
// review): a PRODUCTION surface (closeout) must not bind on the accidentally/
// forgeably loose rungs.
//   1. Edit-log path: artifact abs path in THIS session's delegation-altitude paths[].
//   2. Review-state listed: artifact rel path in a marker's distinct_reviews[].artifact.
//   3. Filename-session: filename contains the session_id.
//   4. Filename-plan: filename contains a covering plan_id.   (opts.allowPlanId)
//   5. Content-session: content contains the session_id.       (opts.allowContent)
//   6. Content-plan: content contains a covering plan_id.      (opts.allowContent && allowPlanId)
//
// opts: { prefix, allowContent = true, allowPlanId = true }.
function findBoundFreshArtifact(root, dirRel, sinceMs, sessionId, anchors, opts = {}) {
  const { coveringPlanIds, listedArtifacts, editLogPathsAbs } = anchors;
  const prefix = opts.prefix;
  const allowContent = opts.allowContent !== false;
  const allowPlanId = opts.allowPlanId !== false;
  const haveSession = sessionId && sessionId !== 'unknown-session';
  let foundUnbound = false;
  try {
    const dir = path.join(root, dirRel);
    for (const name of fs.readdirSync(dir)) {
      if (prefix && !name.startsWith(prefix)) continue;
      const filePath = path.join(dir, name);
      let st;
      try { st = fs.statSync(filePath); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < sinceMs) continue;

      const relPath = path.posix.join(dirRel, name);
      const relPathAlt = path.join(dirRel, name);

      // 1 + 2 + 3: production/curatorial/self-named — always.
      if (editLogPathsAbs.has(filePath)) return { bound: true };
      if (listedArtifacts.has(relPath) || listedArtifacts.has(relPathAlt)) return { bound: true };
      if (haveSession && name.includes(sessionId)) return { bound: true };
      // 4: filename-plan — gated (global plan ids are loose; off for closeout).
      if (allowPlanId) { for (const planId of coveringPlanIds) { if (name.includes(planId)) return { bound: true }; } }
      // 5 + 6: content-based — gated (a prose mention is association, not
      // production; off for closeout so a sibling debrief that merely references
      // this session_id/plan cannot clear the gate — codex C2 CRITICAL).
      if (allowContent) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (haveSession && content.includes(sessionId)) return { bound: true };
          if (allowPlanId) { for (const planId of coveringPlanIds) { if (content.includes(planId)) return { bound: true }; } }
        } catch { /* unreadable content - cannot bind via content */ }
      }

      foundUnbound = true;
    }
  } catch {
    return null; // missing probe dir - no evidence there
  }
  if (foundUnbound) return { bound: false, reason: 'binding_unresolved' };
  return null;
}

// findBoundDistinctReview - preserved API (tests + back-compat). Delegates to
// findBoundFreshArtifact over the bridge-return probe, now WITH edit-log binding.
function findBoundDistinctReview(root, sinceMs, sessionId, opts = {}) {
  try {
    const bridgeProbe = DISTINCT_REVIEW_PROBES.find((p) => p.prefix === 'codex-last-message__');
    if (!bridgeProbe) return null;
    const anchors = (opts && opts.anchors) || loadBindingAnchors(root, sessionId);
    // Bridge-returns (codex CLI writes them out-of-band, not via this session's
    // Edit tool) keep the full ratified W1 ladder incl. filename/content/plan_id.
    return findBoundFreshArtifact(root, bridgeProbe.dir, sinceMs, sessionId, anchors, { prefix: bridgeProbe.prefix });
  } catch {
    return null; // fail-open
  }
}

function appendSoakEvent(root, event) {
  try {
    const dir = path.join(root, SOAK_DIR_REL);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${ADD_ID}.jsonl`), JSON.stringify(event) + '\n');
  } catch {
    // best-effort ledger
  }
}

// Dedup: one ledger entry per session per deficit-set (Stop fires every turn).
function shouldRecord(root, sessionId, deficitKey) {
  try {
    const dir = path.join(root, SOAK_DIR_REL);
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, `closeout-dedup-${safeSessionId(sessionId)}.json`);
    let last = null;
    try { last = JSON.parse(fs.readFileSync(marker, 'utf8')).deficit_key; } catch { /* first */ }
    if (last === deficitKey) return false;
    fs.writeFileSync(marker, JSON.stringify({ deficit_key: deficitKey, at: new Date().toISOString() }) + '\n');
    return true;
  } catch {
    return true;
  }
}

function deficitMessage(deficits, mode) {
  // Header reflects the LIVE mode so a blocking trap explains itself truthfully.
  // report-only wording is preserved byte-for-byte; blocking says it refused.
  const modeLabel = mode === 'blocking'
    ? 'blocking — closeout refused'
    : 'report-only — closeout evidence deficit';
  const lines = [
    `CLOSEOUT-EVIDENCE GATE (${modeLabel}):`
  ];
  for (const d of deficits) {
    if (d.deficit === 'missing-closeout-evidence-artifact') {
      lines.push(`- Missing artifact: a durable closeout record written this session under one of: ${CLOSEOUT_EVIDENCE_DIRS.join(', ')}. Remedy: /debrief-run (or record the task outcome / write the handoff) before closing.`);
    } else if (d.deficit === 'missing-distinct-review-artifact') {
      lines.push('- Missing artifact: a distinct-intelligence review of this session\'s acceptance-grade work (e.g. _dev/reports/analysis/task-plan-reviews/<task>__review.md or a codex-last-message__* bridge return). Remedy: dispatch a codex/distinct review (/dispatch-bridge) and route final status to a frontier coordinator — the carrying coordinator proposes, never stamps (no-final-status-authority).');
    }
  }
  lines.push('Operator bypass (kill switch): touch _dev/state/kill-switches/closeout-evidence-gate.off');
  return lines.join('\n');
}

// Returns { status, deficits?, deduped?, killed? }. status 2 ONLY when the
// live add mode is "blocking" (operator-flipped report-only -> blocking
// 2026-06-15; the Stop message header renders the live mode truthfully).
function main(payload = {}, opts = {}) {
  try {
    const root = projectRoot(opts);
    const sessionId = resolveSessionId(payload);
    const { rule, overridePath } = resolveRule(opts);
    const adds = readSessionAdds(sessionId, { rule, stateDir: opts.stateDir });
    const add = adds.find((a) => a && a.id === ADD_ID);
    if (!add) return notApplicable('add-not-carried');
    if (fs.existsSync(killSwitchPath(root, add, ADD_ID))) return notApplicable('operator-kill-switch', { killed: true });

    // Reviewer-role exemption — keys on ROLE, never model name (condition 8).
    if (resolveRole(payload) === 'reviewer') return notApplicable('reviewer-role', { exempt: 'reviewer-role' });

    const stamp = readSessionStamp(sessionId, { stateDir: opts.stateDir });
    if (!stamp || !stamp.stamped_at) return notApplicable('missing-session-stamp');
    const sinceMs = Date.parse(stamp.stamped_at);
    if (!Number.isFinite(sinceMs)) return notApplicable('invalid-session-stamp');

    if (!sessionAuthored(root, sessionId)) return notApplicable('no-authoring-this-session', { reason: 'no-authoring-this-session' });

    // C2: bind EVERY evidence probe to the producing session. Anchors once.
    const anchors = loadBindingAnchors(root, sessionId);
    const deficits = [];
    const bindingReasons = [];

    // Closeout evidence is a PRODUCTION surface: accept ONLY the strong rungs
    // (this session's edit-log path, an explicit plan-review marker listing, or a
    // filename self-named with the session_id). Content-mention and global
    // plan_id are off, so a sibling/automation debrief that merely references
    // this session cannot clear the blocking gate (codex C2 CRITICAL/MAJOR).
    // Fresh-but-unbound is counted as binding_unresolved, never silently passed.
    let closeoutBound = false;
    let closeoutUnbound = false;
    for (const d of CLOSEOUT_EVIDENCE_DIRS) {
      const r = findBoundFreshArtifact(root, d, sinceMs, sessionId, anchors, { allowContent: false, allowPlanId: false });
      if (r && r.bound) { closeoutBound = true; break; }
      if (r && r.bound === false) closeoutUnbound = true;
    }
    if (!closeoutBound) {
      deficits.push({
        deficit: 'missing-closeout-evidence-artifact',
        expected: CLOSEOUT_EVIDENCE_DIRS,
        ...(closeoutUnbound ? { binding_note: 'A fresh closeout artifact was found but is not bound to THIS session (must be in this session edit log, listed in a plan-review marker, or self-named with the session_id). A sibling session or automation cannot clear this gate.' } : {})
      });
      if (closeoutUnbound) bindingReasons.push('closeout_binding_unresolved');
    }

    const carriesReviewRouting = adds.some((a) => a && a.id === REVIEW_ADD_ID);
    if (carriesReviewRouting) {
      // Distinct-review: a BOUND fresh plan-review OR bridge-return. Reviews keep
      // the full ratified W1 ladder (filename/content/plan_id) because codex
      // writes bridge returns out-of-band, so edit-log binding often won't apply.
      const planProbe = DISTINCT_REVIEW_PROBES.find((p) => !p.prefix);
      const planResult = findBoundFreshArtifact(root, planProbe.dir, sinceMs, sessionId, anchors, { prefix: planProbe.prefix });
      const bridgeResult = findBoundDistinctReview(root, sinceMs, sessionId, { anchors });
      const reviewBound = (planResult && planResult.bound) || (bridgeResult && bridgeResult.bound);
      const reviewUnbound = (planResult && planResult.bound === false) || (bridgeResult && bridgeResult.bound === false);
      if (!reviewBound) {
        deficits.push({
          deficit: 'missing-distinct-review-artifact',
          expected: DISTINCT_REVIEW_PROBES.map((p) => (p.prefix ? p.dir + '/' + p.prefix + '*' : p.dir)),
          ...(reviewUnbound ? { binding_note: 'Fresh distinct-review artifact found but could not be bound to THIS session or its covering plan (amendment div-1 + holistic-acceptance C2).' } : {})
        });
        if (reviewUnbound) bindingReasons.push('binding_unresolved');
      }
    }
    const debriefDenied = deficits.some((deficit) => deficit.deficit === 'missing-closeout-evidence-artifact');
    const ownership = protocolView(root, { registryPath: opts.registryPath, now: opts.now });
    const enforcementClaim = issueEnforcementClaim(root, 'claude_hook', { registryPath: opts.registryPath, now: opts.now });
    const enforcementAuthorization = authorizeEnforcementClaim(root, enforcementClaim, { registryPath: opts.registryPath, now: opts.now });
    if (!enforcementAuthorization.ok && enforcementAuthorization.reason === 'stale-epoch') {
      recordStaleClaimDenial(root, enforcementClaim, enforcementAuthorization, { now: opts.now });
    }
    const claudeOwnsDebrief = enforcementAuthorization.ok;
    const debriefDecision = {
      protocol: 'debrief_before_closeout',
      outcome: debriefDenied ? 'deny' : 'allow',
      enforced: debriefDenied && add.mode === 'blocking' && claudeOwnsDebrief,
      enforcement_claim: enforcementClaim,
      reason: debriefDenied ? 'missing-or-unbound-closeout-evidence' : 'bound-closeout-evidence-present',
      decided_at: new Date().toISOString()
    };
    const debrief_observation = observeDebriefDecision(root, payload, opts, debriefDecision);
    const ownershipSummary = {
      blocking_owner: ownership.protocol.blocking_owner,
      registry_source: ownership.source,
      fail_safe_active: ownership.degraded
    };
    if (!deficits.length) return { status: 0, debrief_decision: debriefDecision, debrief_observation, debrief_ownership: ownershipSummary };
    const blockingDeficits = deficits.filter((deficit) =>
      deficit.deficit !== 'missing-closeout-evidence-artifact' || claudeOwnsDebrief
    );

    // SINGLE soak emission per stable (deficit-set + binding-reasons) condition,
    // deduped once per change — never re-logged every Stop (codex C2 MINOR).
    const deficitKey = deficits.map((d) => d.deficit).sort()
      .concat(bindingReasons.slice().sort()).join('|');
    // Computed before the dedup gate so a repeat-turn block still carries its
    // remedy text to stderr. The dedup only suppresses soak-ledger re-logging,
    // never the operator-facing reason (otherwise a blocked Stop shows the
    // harness's bare "No stderr output" fallback with no explanation).
    const message = deficitMessage(deficits, blockingDeficits.length > 0 ? add.mode : 'report-only');
    if (!shouldRecord(root, sessionId, deficitKey)) {
      return {
        status: add.mode === 'blocking' && blockingDeficits.length > 0 ? 2 : 0,
        deficits,
        deduped: true,
        message,
        debrief_decision: debriefDecision,
        debrief_observation,
        debrief_ownership: ownershipSummary
      };
    }
    appendSoakEvent(root, {
      schema: 'TierGateSoakEvent/1.0',
      add: ADD_ID,
      mode: add.mode,
      session_id: sessionId,
      surface: 'Stop',
      rule_path_override: overridePath,
      ts: new Date().toISOString(),
      decision: bindingReasons.length ? 'would-block' : 'would-refuse-closeout',
      // Preserve the ratified 'reason: binding_unresolved' for soak tooling/W1;
      // binding_reasons carries the per-surface detail additively.
      ...(bindingReasons.length ? { reason: 'binding_unresolved', binding_reasons: bindingReasons } : {}),
      deficits,
      message
    });
    if (add.mode === 'blocking' && blockingDeficits.length > 0) {
      return { status: 2, message, deficits, debrief_decision: debriefDecision, debrief_observation, debrief_ownership: ownershipSummary };
    }
    return { status: 0, deficits, message, debrief_decision: debriefDecision, debrief_observation, debrief_ownership: ownershipSummary };
  } catch {
    // Fail-open: a broken gate must never trap the session.
    return { status: 0 };
  }
}

module.exports = {
  ADD_ID,
  CLOSEOUT_EVIDENCE_DIRS,
  DISTINCT_REVIEW_PROBES,
  PLAN_REVIEW_STATE_DIR,
  REVIEW_ADD_ID,
  SOAK_DIR_REL,
  findBoundDistinctReview,
  findBoundFreshArtifact,
  loadBindingAnchors,
  main,
  sessionAuthored
};

if (require.main === module) {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = raw && raw.trim() ? JSON.parse(raw) : {};
    const result = main(payload);
    if (result && result.status === 2) {
      if (result.message) process.stderr.write(result.message + '\n');
      process.exit(2);
    }
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}
