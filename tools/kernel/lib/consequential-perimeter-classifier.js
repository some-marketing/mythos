'use strict';

/**
 * consequential-perimeter-classifier.js
 *
 * S1 of plan-execution-autonomy-default-perimeter-gate-and-tracking.
 *
 * PURPOSE
 *   Deterministic, mechanically-evaluable classifier that takes a TaskPlan
 *   artifact and decides, PER STEP, whether the step may auto-run or must stop
 *   at the operator GREENLIGHT gate (the "consequential perimeter").
 *
 *   Ratified posture (kernel convene 2026-06-29, codex+gemini+claude):
 *     - Default = autonomous execution under continuous projection.
 *     - A plan auto-runs the SAFE PREFIX and STOPS at the first step that trips
 *       the consequential perimeter. So classification is per-step, not
 *       whole-plan: the S2 runner auto-runs steps up to (not including)
 *       `first_gate_step_id` and stops there.
 *     - GREENLIGHT (the version-bound, operator-authored proof) remains the ONLY
 *       authority surface. This classifier is an ADMISSION/observability layer:
 *       it decides whether the gate is consulted, never authorizes anything.
 *
 * SECURITY POSTURE — this classifier IS the new attack surface.
 *   A mis-classify-as-safe is a perimeter bypass. Therefore:
 *     - FAIL-CLOSED: anything we cannot confidently classify (missing/garbled
 *       metadata, unrecognized step shape, unparseable files_touched) sets
 *       unknown=true and that step's decision='gate'. Unknown ALWAYS gates.
 *     - CONSERVATIVE: when a predicate's signal is plausible but uncertain, it
 *       trips (gate). A false-gate is safe; a false-auto-run is a bypass.
 *     - SELF-PROTECTION: edits to the classifier itself, the runner, the gate
 *       hooks, or any confinement/control-plane surface trip
 *       `edits_own_confinement` and gate. The automation must never be able to
 *       auto-run a change to the rules of its own confinement.
 *
 *   NO NL / LLM JUDGMENT. Every predicate is explicit token / glob / flag
 *   matching over plan step metadata, files_touched globs, declared modes, and
 *   descriptions. The PREDICATES table below is the single auditable source of
 *   truth for what each predicate matches.
 *
 * PUBLIC API
 *   classifyPlan(planJson) -> {
 *     decision:           'auto-run' | 'gate',   // == plan_decision (brief contract)
 *     plan_decision:      'auto-run' | 'gate',   // 'gate' if ANY step gates
 *     unknown:            boolean,               // true if ANY step is unknown
 *     first_gate_step_id: <step id> | null,      // first gating step, or null
 *     tripped:            [{ predicate, step_id, evidence }],  // flattened
 *     steps: [ { step_id, decision, unknown, tripped: [{ predicate, evidence }] } ]
 *   }
 *
 *   Per-predicate helpers (each unit-testable): exported by name, e.g.
 *   spendsMoney(stepCtx, planCtx) -> { tripped, evidence } | { tripped:false }.
 *
 *   PREDICATES — the documented, exported predicate table.
 */

// ---------------------------------------------------------------------------
// Low-level deterministic matchers (no NL, pure string/glob/flag work).
// ---------------------------------------------------------------------------

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `text` contain `token`?
 *   - Alphanumeric single-word tokens use \b word boundaries (avoid "harm"
 *     matching "rm").
 *   - Tokens with spaces / symbols use a plain (escaped) substring match.
 * Returns the matched token string for evidence, or null.
 */
function tokenHit(text, token) {
  if (!text) return null;
  const t = String(token).toLowerCase();
  let re;
  if (/^[a-z0-9]+$/.test(t)) {
    re = new RegExp('\\b' + escapeRegExp(t) + '\\b');
  } else {
    re = new RegExp(escapeRegExp(t));
  }
  return re.test(text) ? token : null;
}

/** First token in `tokens` that hits `text`, else null. */
function firstTokenHit(text, tokens) {
  for (const tok of tokens) {
    const hit = tokenHit(text, tok);
    if (hit) return hit;
  }
  return null;
}

/**
 * Minimal, deterministic glob matcher over a normalized (lowercased, forward
 * slash) path. Supports `**` (any chars incl. slash) and `*` (any chars except
 * slash). Anchored to the full path. Used only for the confinement table.
 */
function globMatch(pattern, normPath) {
  const p = String(pattern).toLowerCase();
  let re = '^';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') { re += '.*'; i++; }
      else { re += '[^/]*'; }
    } else {
      re += escapeRegExp(c);
    }
  }
  re += '$';
  return new RegExp(re).test(normPath);
}

// ---------------------------------------------------------------------------
// edits_own_confinement — the confinement / control-plane surface set.
//   This predicate is itself security-critical: a change to ANY of these paths
//   is a change to the rules (or the runner) of the agent's own confinement and
//   MUST gate. The list is intentionally broad; over-coverage is safe.
// ---------------------------------------------------------------------------
const CONFINEMENT_GLOBS = [
  // Kernel substrate + gate hooks.
  'tools/kernel/**',
  'tools/kernel/hooks/**',
  // Canonical instruction / rule surface.
  'instructions/canonical/**',
  // Harness confinement config.
  '.claude/**',
  '*/.claude/**',
  // The runner / control-plane that EXECUTES auto-run (part of the authz path).
  'tools/codex/commands/run-plan.js',
  'tools/codex/smos-launcher.js',
  // Command / dispatch policy + registry surfaces.
  'tools/signals/lib/target-command-policy.cjs',
  'tools/commands/**',
];

/**
 * Confinement predicates expressed as path tests, so a basename-anywhere rule
 * (gate hooks, process-tier-rule) is auditable alongside the globs.
 */
const CONFINEMENT_BASENAME_TESTS = [
  {
    label: '*-gate*.cjs (any gate hook)',
    test(normPath) {
      const base = normPath.split('/').pop() || '';
      return base.includes('-gate') && base.endsWith('.cjs');
    },
  },
  {
    label: 'process-tier-rule* (process-tier rule surface)',
    test(normPath) {
      return normPath.includes('process-tier-rule');
    },
  },
];

/** Normalize a single files_touched entry to a comparable path, or null if garbled. */
function normalizeTouchedPath(entry) {
  if (typeof entry !== 'string') return null;
  // Strip a trailing annotation like " (NEW)" / " (M — ...)".
  let s = entry.split(' (')[0];
  s = s.trim();
  if (!s) return null;
  // Strip leading ./ and normalize slashes; lowercase for case-insensitive,
  // conservative matching (a case mismatch must never produce a false auto-run).
  s = s.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return s;
}

/** Does a normalized path hit any confinement glob / basename rule? Returns the matched rule label or null. */
function confinementHit(normPath) {
  for (const g of CONFINEMENT_GLOBS) {
    if (globMatch(g, normPath)) return g;
  }
  for (const b of CONFINEMENT_BASENAME_TESTS) {
    if (b.test(normPath)) return b.label;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Token tables (deterministic keyword signals). Lowercase.
// ---------------------------------------------------------------------------
const TOKENS = {
  spends_money: [
    'spend', 'spends money', 'budget', 'change budget', 'changes budget',
    'campaign budget', 'daily budget', 'billing', 'invoice', 'charge', 'payment',
    'bid', 'bidding', 'ad spend', 'cost cap', 'paid media spend',
  ],
  // Live property MUTATION signals — always trip.
  live_mutation: [
    'publish to', 'go live', 'push to prod', 'push to production', 'deploy to prod',
    'deploy to production', 'mutate campaign', 'campaign mutation', 'edit live',
    'update live', 'live site update', 'wp mutation', 'wordpress mutation',
    'launch campaign', 'set live', 'apply to platform', 'mutate ad',
  ],
  // Live property SURFACE signals — trip UNLESS a read-only qualifier scopes the step.
  live_surface: [
    'wordpress', 'livecanvas', 'live canvas', 'cms', 'prod site', 'production site',
    'live meta', 'meta ads', 'meta campaign', 'google ads', 'google ad', 'live ad',
    'production database', 'prod db', 'production wordpress',
  ],
  read_only_qualifier: [
    'read-only', 'readonly', 'read only', 'readback', 'read-back', 'dry-run',
    'dry run', 'gaql read', 'observe', 'observation', 'inspect', 'no mutation',
    'no-op', 'preview only',
  ],
  sends_to_external_party: [
    'send email', 'send an email', 'email the client', 'email to', 'send to client',
    'webhook', 'notify client', 'notify the', 'publish to', 'post to', 'outbound',
    'dispatch email', 'deliver to client', 'deliver to third', 'sms', 'send sms',
    'slack message', 'discord message', 'external party', 'third party', 'third-party',
  ],
  destructive_or_irreversible: [
    'delete', 'drop table', 'drop database', 'overwrite', 'force-push', 'force push',
    'git push --force', '--force', 'rm -rf', 'rm -', 'truncate', 'destroy', 'wipe',
    'purge', 'irreversible', 'hard reset', 'git reset --hard', 'unrecoverable',
  ],
  credential_access: [
    'secret', 'secrets', 'api key', 'apikey', 'access token', 'auth token',
    'credential', 'rotate key', 'rotate token', 'rotate secret', 'generate key',
    'generate token', 'export secret', 'export token', 'private key', 'oauth token',
    'service account token', '.env', 'password', 'keychain', 'vault write',
  ],
  // Judgment / commitment predicates — token fallbacks (also driven by explicit flags).
  commits_scope_budget_timeline: [
    'scope commitment', 'timeline commitment', 'commit scope', 'commit to timeline',
    'budget commitment', 'commit budget', 'delivery date commitment', 'sla commitment',
  ],
  accepts_client_facing_risk: [
    'client-facing risk', 'client facing risk', 'accept client risk', 'reputational risk',
  ],
  same_rank_authority_conflict: [
    'same-rank authority', 'same rank authority', 'authority conflict', 'peer authority conflict',
  ],
  requires_human_judgment: [
    'requires human judgment', 'requires human judgement', 'human judgment required',
    'needs human judgment', 'human-judgment',
  ],
  approval_required_by_manifest: [
    'approval required', 'requires approval', 'manifest approval', 'operator approval required',
    'greenlight required', 'requires greenlight',
  ],
};

// Explicit boolean-flag names checked on the step and at plan level for the
// judgment/commitment predicates (markers win over token guesses).
const FLAG_NAMES = {
  commits_scope_budget_timeline: ['commits_scope_budget_timeline', 'commits_scope', 'commits_budget', 'commits_timeline'],
  accepts_client_facing_risk: ['accepts_client_facing_risk', 'client_facing_risk'],
  same_rank_authority_conflict: ['same_rank_authority_conflict'],
  requires_human_judgment: ['requires_human_judgment', 'human_judgment'],
  approval_required_by_manifest: ['approval_required_by_manifest', 'approval_required', 'requires_approval'],
};

// ---------------------------------------------------------------------------
// Step / plan normalization.
// ---------------------------------------------------------------------------

/** Collect a flat, lowercased text blob from the searchable text fields of a step. */
function stepText(step) {
  const parts = [];
  const push = (v) => { if (typeof v === 'string') parts.push(v); };
  push(step.title);
  push(step.description);
  push(step.mode);
  push(step.execution_mode);
  push(step.command);
  push(step.cmd);
  push(step.run);
  if (Array.isArray(step.declared_modes)) step.declared_modes.forEach(push);
  if (Array.isArray(step.gates)) step.gates.forEach(push);
  return parts.join(' \n ').toLowerCase();
}

/**
 * Normalize a raw step into a deterministic context. `recognized` is false when
 * the step has no searchable shape at all (=> fail-closed unknown). `filesOk`
 * is false when ANY files_touched entry is unparseable (=> fail-closed unknown).
 */
function normalizeStep(step, index) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    return { id: 'step#' + index, recognized: false, filesOk: false, filesAbsent: true, text: '', files: [], raw: step };
  }
  const id = (typeof step.id === 'string' && step.id) ||
    (typeof step.step_id === 'string' && step.step_id) ||
    ('step#' + index);

  const hasText = typeof step.title === 'string' || typeof step.description === 'string';

  // Blocker 1 (codex S1 review): distinguish files_touched ABSENT from an
  // explicit empty array. An ABSENT key means we cannot rule out a confinement
  // edit => fail-closed. An explicit `files_touched: []` is a legitimate
  // no-file step (e.g. "raise the budget") and must NOT be force-gated by this
  // rule alone — its other predicates still decide.
  const hasFilesKey = Object.prototype.hasOwnProperty.call(step, 'files_touched');
  const filesArray = Array.isArray(step.files_touched);
  const filesAbsent = !hasFilesKey;
  // A present-but-non-array files_touched (e.g. null, string, object) is garbled.
  const filesGarbledType = hasFilesKey && !filesArray;
  const recognized = hasText || filesArray;

  let filesOk = !filesGarbledType;
  const files = [];
  if (filesArray) {
    for (const entry of step.files_touched) {
      const norm = normalizeTouchedPath(entry);
      if (norm === null) { filesOk = false; continue; }
      files.push({ norm, raw: entry });
    }
  }

  return { id, recognized, filesOk, filesAbsent, text: stepText(step), files, raw: step };
}

/** Collect plan-level explicit flags (for manifest/judgment predicates). */
function planContext(planJson) {
  const flags = {};
  const sources = [planJson, planJson && planJson.routing_expectations, planJson && planJson.flags];
  for (const src of sources) {
    if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) {
        if (src[k] === true) flags[k] = true;
      }
    }
  }
  return { flags };
}

/** Is an explicit boolean flag set on the step (or plan) for `predicate`? Returns the flag name or null. */
function flagHit(predicate, stepCtx, planCtx) {
  const names = FLAG_NAMES[predicate] || [];
  const step = stepCtx.raw && typeof stepCtx.raw === 'object' ? stepCtx.raw : {};
  const stepFlags = (step.flags && typeof step.flags === 'object') ? step.flags : {};
  for (const n of names) {
    if (step[n] === true) return 'step.' + n + '=true';
    if (stepFlags[n] === true) return 'step.flags.' + n + '=true';
    if (planCtx && planCtx.flags && planCtx.flags[n] === true) return 'plan.' + n + '=true';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-predicate helpers. Each returns { tripped:boolean, evidence?:string }.
// Exported individually so each is unit-testable in isolation.
// ---------------------------------------------------------------------------

function spendsMoney(stepCtx) {
  const hit = firstTokenHit(stepCtx.text, TOKENS.spends_money);
  return hit ? { tripped: true, evidence: 'money/budget token: "' + hit + '"' } : { tripped: false };
}

function touchesClientLiveProperty(stepCtx) {
  const mut = firstTokenHit(stepCtx.text, TOKENS.live_mutation);
  if (mut) return { tripped: true, evidence: 'live-property mutation token: "' + mut + '"' };
  const surface = firstTokenHit(stepCtx.text, TOKENS.live_surface);
  if (surface) {
    // CONSERVATIVE MIXED-SIGNAL RULE (codex S1 review, blocker 2): a read-only
    // qualifier must NOT suppress a live-surface signal. A step can read
    // "read-only inspect first, then edit the live WordPress homepage" — the
    // read-only word describes only part of the step. So ANY live-surface (or
    // mutation) signal GATES. A read-only qualifier only keeps a step auto-run
    // when the step has NO surface/mutation signal at all (the final
    // `return {tripped:false}` below, reached when `surface` is null).
    const ro = firstTokenHit(stepCtx.text, TOKENS.read_only_qualifier);
    if (ro) {
      return { tripped: true, evidence: 'live-property surface token: "' + surface + '" present alongside read-only qualifier "' + ro + '" — mixed signal; read-only does not suppress a live-surface mutation elsewhere in the same step' };
    }
    return { tripped: true, evidence: 'live-property surface token: "' + surface + '"' };
  }
  return { tripped: false };
}

function sendsToExternalParty(stepCtx) {
  const hit = firstTokenHit(stepCtx.text, TOKENS.sends_to_external_party);
  return hit ? { tripped: true, evidence: 'external-send token: "' + hit + '"' } : { tripped: false };
}

function destructiveOrIrreversible(stepCtx) {
  const hit = firstTokenHit(stepCtx.text, TOKENS.destructive_or_irreversible);
  return hit ? { tripped: true, evidence: 'destructive/irreversible token: "' + hit + '"' } : { tripped: false };
}

function credentialAccess(stepCtx) {
  const hit = firstTokenHit(stepCtx.text, TOKENS.credential_access);
  return hit ? { tripped: true, evidence: 'credential token: "' + hit + '"' } : { tripped: false };
}

function editsOwnConfinement(stepCtx) {
  for (const f of stepCtx.files) {
    const rule = confinementHit(f.norm);
    if (rule) {
      return { tripped: true, evidence: 'files_touched "' + f.norm + '" matches confinement rule [' + rule + ']' };
    }
  }
  return { tripped: false };
}

function commitsScopeBudgetTimeline(stepCtx, planCtx) {
  const flag = flagHit('commits_scope_budget_timeline', stepCtx, planCtx);
  if (flag) return { tripped: true, evidence: 'flag ' + flag };
  const hit = firstTokenHit(stepCtx.text, TOKENS.commits_scope_budget_timeline);
  return hit ? { tripped: true, evidence: 'commitment token: "' + hit + '"' } : { tripped: false };
}

function acceptsClientFacingRisk(stepCtx, planCtx) {
  const flag = flagHit('accepts_client_facing_risk', stepCtx, planCtx);
  if (flag) return { tripped: true, evidence: 'flag ' + flag };
  const hit = firstTokenHit(stepCtx.text, TOKENS.accepts_client_facing_risk);
  return hit ? { tripped: true, evidence: 'client-risk token: "' + hit + '"' } : { tripped: false };
}

function sameRankAuthorityConflict(stepCtx, planCtx) {
  const flag = flagHit('same_rank_authority_conflict', stepCtx, planCtx);
  if (flag) return { tripped: true, evidence: 'flag ' + flag };
  const hit = firstTokenHit(stepCtx.text, TOKENS.same_rank_authority_conflict);
  return hit ? { tripped: true, evidence: 'authority-conflict token: "' + hit + '"' } : { tripped: false };
}

function requiresHumanJudgment(stepCtx, planCtx) {
  const flag = flagHit('requires_human_judgment', stepCtx, planCtx);
  if (flag) return { tripped: true, evidence: 'flag ' + flag };
  const hit = firstTokenHit(stepCtx.text, TOKENS.requires_human_judgment);
  return hit ? { tripped: true, evidence: 'human-judgment token: "' + hit + '"' } : { tripped: false };
}

function approvalRequiredByManifest(stepCtx, planCtx) {
  const flag = flagHit('approval_required_by_manifest', stepCtx, planCtx);
  if (flag) return { tripped: true, evidence: 'flag ' + flag };
  const hit = firstTokenHit(stepCtx.text, TOKENS.approval_required_by_manifest);
  return hit ? { tripped: true, evidence: 'manifest-approval token: "' + hit + '"' } : { tripped: false };
}

function executesNetworkEgress(stepCtx) {
  const step = stepCtx.raw && typeof stepCtx.raw === 'object' ? stepCtx.raw : {};
  const command = step.command || step.cmd || step.run || '';

  let detector = null;
  try {
    detector = require('./detect-network-egress.cjs');
  } catch (_) {
    // Fail-silent
  }

  if (detector && typeof detector.detectNetworkEgress === 'function') {
    // Scan explicit command field first
    if (command) {
      const res = detector.detectNetworkEgress(command);
      if (res && res.hasEgress) {
        return { tripped: true, evidence: res.reason || 'Outbound network signature detected in command' };
      }
    }
    // Fallback/Union: Scan description text for raw URL literal triggers
    if (stepCtx.text) {
      const res = detector.detectNetworkEgress(stepCtx.text);
      if (res && res.hasEgress) {
        return { tripped: true, evidence: res.reason || 'Outbound network signature detected in text context' };
      }
    }
  }
  return { tripped: false };
}

/**
 * high_risk_routing — PLAN-SCOPED predicate (codex S1 review, blocker 3;
 * gemini convene bucket A). Gates iff the plan is routed high-risk:
 *   routing_expectations.risk_tier === 'high'
 *   OR routing_expectations.big === true / plan.big === true
 *   OR a convene-required marker (routing_expectations.requires_convene === true
 *      / plan.requires_convene === true).
 * Folding this in only ever ADDS gates (safe direction). Signature takes the
 * raw plan (not a step) because it reads plan-level routing metadata.
 */
function highRiskRouting(plan) {
  if (!plan || typeof plan !== 'object') return { tripped: false };
  const reasons = [];
  const re = plan.routing_expectations;
  if (re && typeof re === 'object') {
    if (re.risk_tier === 'high') reasons.push('routing_expectations.risk_tier=high');
    if (re.big === true) reasons.push('routing_expectations.big=true');
    if (re.requires_convene === true) reasons.push('routing_expectations.requires_convene=true');
  }
  if (plan.big === true) reasons.push('plan.big=true');
  if (plan.requires_convene === true) reasons.push('plan.requires_convene=true');
  if (reasons.length) return { tripped: true, evidence: 'high-risk routing: ' + reasons.join(', ') };
  return { tripped: false };
}

// ---------------------------------------------------------------------------
// The auditable predicate table — single exported source of truth.
//   `fn(stepCtx, planCtx) -> { tripped, evidence? }`
// ---------------------------------------------------------------------------
const PREDICATES = [
  { name: 'spends_money', scope: 'step', matches: 'spend/budget/billing/invoice/charge/bid/ad-spend tokens', fn: spendsMoney },
  { name: 'touches_client_live_property', scope: 'step', matches: 'live mutation (publish/go-live/deploy-to-prod/campaign mutation) OR a live surface token (WordPress/LiveCanvas/CMS/Meta Ads/Google Ads/prod db); a read-only qualifier does NOT suppress a co-present live-surface signal (mixed-signal => gate)', fn: touchesClientLiveProperty },
  { name: 'sends_to_external_party', scope: 'step', matches: 'email/webhook/publish/notify/post/SMS/outbound to a client or third party', fn: sendsToExternalParty },
  { name: 'executes_network_egress', scope: 'step', matches: 'outbound network execution signatures (curl, wget, ssh, fetch, requests, external URLs) inside commands or script contents', fn: executesNetworkEgress },
  { name: 'destructive_or_irreversible', scope: 'step', matches: 'delete/drop/overwrite/force-push/rm/truncate/destroy/wipe/purge/hard-reset/irreversible', fn: destructiveOrIrreversible },
  { name: 'credential_access', scope: 'step', matches: 'secret/token/API key/credential generate-rotate-export, .env, password, keychain, vault write', fn: credentialAccess },
  { name: 'edits_own_confinement', scope: 'step', matches: 'files_touched under tools/kernel/**, tools/kernel/hooks/**, instructions/canonical/**, .claude/**, the runner/control-plane (tools/codex/commands/run-plan.js, tools/codex/smos-launcher.js, tools/commands/**, target-command-policy.cjs), any *-gate*.cjs, or process-tier-rule*', fn: editsOwnConfinement },
  { name: 'commits_scope_budget_timeline', scope: 'step', matches: 'explicit commitment flag, else scope/budget/timeline-commitment token', fn: commitsScopeBudgetTimeline },
  { name: 'accepts_client_facing_risk', scope: 'step', matches: 'explicit client-facing-risk flag, else client-facing-risk token', fn: acceptsClientFacingRisk },
  { name: 'same_rank_authority_conflict', scope: 'step', matches: 'explicit same-rank-authority-conflict flag, else authority-conflict token', fn: sameRankAuthorityConflict },
  { name: 'requires_human_judgment', scope: 'step', matches: 'explicit human-judgment flag, else requires-human-judgment token', fn: requiresHumanJudgment },
  { name: 'approval_required_by_manifest', scope: 'step', matches: 'explicit manifest/approval-required flag, else approval/greenlight-required token', fn: approvalRequiredByManifest },
  { name: 'high_risk_routing', scope: 'plan', matches: 'PLAN-LEVEL: routing_expectations.risk_tier=high, or a big/requires_convene marker (gemini convene bucket A); fn takes the raw plan', fn: highRiskRouting },
];

// Convenience split so step-loops never accidentally call a plan-scoped fn with
// a step context (the two have different signatures).
const STEP_PREDICATES = PREDICATES.filter((p) => p.scope !== 'plan');
const PLAN_PREDICATES = PREDICATES.filter((p) => p.scope === 'plan');

// Sentinel predicate name used when a step cannot be confidently classified.
const UNKNOWN_PREDICATE = 'verifier_cannot_classify';

// ---------------------------------------------------------------------------
// Step + plan classification.
// ---------------------------------------------------------------------------

/**
 * Classify a single normalized step context.
 * Returns { step_id, decision, unknown, tripped: [{ predicate, evidence }] }.
 * FAIL-CLOSED: an unrecognized step or unparseable files_touched => gate+unknown.
 */
function classifyStepCtx(stepCtx, planCtx) {
  const tripped = [];
  let unknown = false;

  if (!stepCtx.recognized) {
    unknown = true;
    tripped.push({ predicate: UNKNOWN_PREDICATE, evidence: 'unrecognized step shape (no title/description/files_touched) — fail-closed' });
  } else if (stepCtx.filesAbsent) {
    // Blocker 1 (codex S1 review): a recognized step that OMITS files_touched
    // entirely cannot be shown not to edit confinement => fail-closed. An
    // explicit `files_touched: []` does NOT reach here (filesAbsent=false).
    unknown = true;
    tripped.push({ predicate: UNKNOWN_PREDICATE, evidence: 'files_touched key absent — cannot rule out a confinement/live-property edit, fail-closed (use an explicit files_touched:[] for a legitimate no-file step)' });
  }
  if (!stepCtx.filesOk) {
    unknown = true;
    tripped.push({ predicate: UNKNOWN_PREDICATE, evidence: 'unparseable/garbled files_touched — cannot rule out confinement edit, fail-closed' });
  }

  for (const p of STEP_PREDICATES) {
    let res;
    try {
      res = p.fn(stepCtx, planCtx);
    } catch (err) {
      // A predicate that throws is itself unclassifiable => fail-closed.
      unknown = true;
      tripped.push({ predicate: UNKNOWN_PREDICATE, evidence: 'predicate "' + p.name + '" threw: ' + (err && err.message ? err.message : String(err)) });
      continue;
    }
    if (res && res.tripped) {
      tripped.push({ predicate: p.name, evidence: res.evidence || 'tripped' });
    }
  }

  const decision = tripped.length > 0 ? 'gate' : 'auto-run';
  return { step_id: stepCtx.id, decision, unknown, tripped };
}

/** Locate the steps array in the canonical or tolerant plan shapes. */
function extractSteps(planJson) {
  if (planJson && planJson.bounded_plan && Array.isArray(planJson.bounded_plan.steps)) {
    return planJson.bounded_plan.steps;
  }
  if (planJson && Array.isArray(planJson.steps)) return planJson.steps;
  if (planJson && planJson.plan && Array.isArray(planJson.plan.steps)) return planJson.plan.steps;
  return null;
}

/**
 * classifyPlan — the public entrypoint. PER-STEP, fail-closed.
 */
function classifyPlan(planJson) {
  // Accept an object or a JSON string; anything else is unclassifiable.
  let plan = planJson;
  if (typeof plan === 'string') {
    try { plan = JSON.parse(plan); } catch (_) { plan = null; }
  }

  const failClosedPlan = (reason) => ({
    decision: 'gate',
    plan_decision: 'gate',
    unknown: true,
    first_gate_step_id: null,
    tripped: [{ predicate: UNKNOWN_PREDICATE, step_id: null, evidence: reason }],
    steps: [],
  });

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return failClosedPlan('plan is missing or not an object — fail-closed');
  }

  const rawSteps = extractSteps(plan);
  if (!Array.isArray(rawSteps)) {
    return failClosedPlan('no recognizable steps[] (bounded_plan.steps / steps / plan.steps) — fail-closed');
  }
  if (rawSteps.length === 0) {
    return failClosedPlan('plan has zero steps — empty/garbled, fail-closed');
  }

  const planCtx = planContext(plan);
  const steps = [];
  const flatTripped = [];
  let anyUnknown = false;
  let firstGateStepId = null;

  rawSteps.forEach((raw, index) => {
    const stepCtx = normalizeStep(raw, index);
    const result = classifyStepCtx(stepCtx, planCtx);
    steps.push(result);
    if (result.unknown) anyUnknown = true;
    for (const t of result.tripped) {
      flatTripped.push({ predicate: t.predicate, step_id: result.step_id, evidence: t.evidence });
    }
  });

  // Blocker 3 (codex S1 review): plan-scoped predicates (high_risk_routing).
  // A high-risk plan requires operator GREENLIGHT before ANY step, so fold the
  // trip onto the FIRST step — that makes first_gate_step_id the first step and
  // the auto-run safe-prefix empty (the whole plan gates).
  for (const p of PLAN_PREDICATES) {
    let res;
    try { res = p.fn(plan); } catch (err) {
      anyUnknown = true;
      steps[0].unknown = true;
      steps[0].decision = 'gate';
      steps[0].tripped.unshift({ predicate: UNKNOWN_PREDICATE, evidence: 'plan predicate "' + p.name + '" threw: ' + (err && err.message ? err.message : String(err)) });
      flatTripped.unshift({ predicate: UNKNOWN_PREDICATE, step_id: steps[0].step_id, evidence: 'plan predicate "' + p.name + '" threw' });
      continue;
    }
    if (res && res.tripped) {
      steps[0].decision = 'gate';
      steps[0].tripped.unshift({ predicate: p.name, evidence: res.evidence || 'tripped' });
      flatTripped.unshift({ predicate: p.name, step_id: steps[0].step_id, evidence: res.evidence || 'tripped' });
    }
  }

  // Compute first_gate_step_id AFTER plan-scoped folding so order is honored.
  for (const s of steps) {
    if (s.decision === 'gate') { firstGateStepId = s.step_id; break; }
  }

  const planDecision = firstGateStepId !== null ? 'gate' : 'auto-run';
  return {
    decision: planDecision,
    plan_decision: planDecision,
    unknown: anyUnknown,
    first_gate_step_id: firstGateStepId,
    tripped: flatTripped,
    steps,
  };
}

module.exports = {
  // Public entrypoint.
  classifyPlan,
  // Auditable predicate table + sentinel.
  PREDICATES,
  STEP_PREDICATES,
  PLAN_PREDICATES,
  UNKNOWN_PREDICATE,
  CONFINEMENT_GLOBS,
  CONFINEMENT_BASENAME_TESTS,
  TOKENS,
  FLAG_NAMES,
  // Per-predicate helpers (each independently testable).
  spendsMoney,
  touchesClientLiveProperty,
  sendsToExternalParty,
  destructiveOrIrreversible,
  credentialAccess,
  editsOwnConfinement,
  commitsScopeBudgetTimeline,
  acceptsClientFacingRisk,
  sameRankAuthorityConflict,
  requiresHumanJudgment,
  approvalRequiredByManifest,
  highRiskRouting,
  // Internals exposed for white-box tests.
  classifyStepCtx,
  normalizeStep,
  normalizeTouchedPath,
  confinementHit,
  globMatch,
  tokenHit,
  planContext,
  extractSteps,
};
