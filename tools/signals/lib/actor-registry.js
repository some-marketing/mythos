'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');

const VALID_WORKLOADS = Object.freeze(['low', 'medium', 'high']);

const ACTOR_REGISTRY = Object.freeze({
  codex: Object.freeze({
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    runtime: 'cli',
    verification_only: false,
    experimental: false,
    cost_rank: 2,
    batching: 'good',
    preferred_for: Object.freeze(['patch', 'full-auto', 'code-edit']),
    model_defaults: Object.freeze({
      low: '',
      medium: '',
      high: ''
    }),
    supports: Object.freeze({
      read_only: true,
      patch_allowed: true,
      full_auto: true
    })
  }),
  claude: Object.freeze({
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    runtime: 'cli',
    verification_only: false,
    experimental: false,
    cost_rank: 1,
    batching: 'good',
    preferred_for: Object.freeze(['review', 'triage', 'planning', 'deep-review']),
    model_defaults: Object.freeze({
      low: 'haiku',
      medium: 'sonnet',
      high: 'opus'
    }),
    budget_defaults_usd: Object.freeze({
      low: 1,
      medium: 3,
      high: 8
    }),
    supports: Object.freeze({
      read_only: true,
      patch_allowed: true,
      full_auto: true
    })
  }),
  opencode: Object.freeze({
    id: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    runtime: 'cli',
    verification_only: false,
    experimental: true,
    cost_rank: 0,
    batching: 'good',
    preferred_for: Object.freeze(['review', 'triage']),
    model_defaults: Object.freeze({
      low: '',
      medium: '',
      high: ''
    }),
    supports: Object.freeze({
      read_only: true,
      patch_allowed: true,
      full_auto: false
    })
  }),
  'opencode-local': Object.freeze({
    id: 'opencode-local',
    label: 'OpenCode (local Ollama)',
    binary: 'opencode',
    runtime: 'cli',
    verification_only: false,
    experimental: true,
    cost_rank: 0,
    batching: 'good',
    local: true,
    preferred_for: Object.freeze(['credential-touching', 'memory-write', 'leaf-mechanical']),
    model_defaults: Object.freeze({
      low: 'ollama/qwen3:4b',
      medium: 'ollama/qwen2.5-coder:14b',
      high: 'ollama/qwen2.5-coder:14b'
    }),
    supports: Object.freeze({
      read_only: true,
      patch_allowed: true,
      full_auto: false
    })
  }),
  gemini: Object.freeze({
    id: 'gemini',
    label: 'Gemini',
    binary: 'gemini',
    runtime: 'cli',
    verification_only: false,
    experimental: false,
    cost_rank: 1,
    batching: 'good',
    preferred_for: Object.freeze(['breadth', 'lateral', 'second-mind-review']),
    // Pinned 2026-08-11 per tools/signals/lib/bridge-target-policy.js's gemini
    // local-cli policy and a distinct-family codex review of the tiering choice
    // (dispatch-bridge scope
    // codex-decide-the-correct-gemini-model_defaults-pin-for-tools-signals-lib-actor,
    // 20260811T170558Z): Flash for low/medium, Pro for high — mirroring the
    // bridge policy's own scope-tier selector (flash for narrow/low-risk work,
    // pro otherwise).
    //
    // EMPIRICAL CORRECTION (2026-08-11, live probes against the installed
    // gemini CLI v0.50.0, observed via ~/.gemini/tmp/mythos/chats/*.jsonl):
    // `--model gemini-3-flash-preview` ran exactly as requested (verified
    // match). `--model gemini-3-pro-preview` — the value bridge-target-policy.js
    // declares as default/current (checked_at 2026-04-22) — was SILENTLY
    // substituted by the CLI to `gemini-3.1-pro-preview`; no warning was
    // printed to stdout/stderr. Requesting `gemini-3.1-pro-preview` directly
    // ran as itself (verified match, repeated). The high tier is pinned to the
    // value that actually holds, not the value the (now-stale) bridge policy
    // names — bridge-target-policy.js's gemini current_models/default_model
    // need a fresh docs pass; reported to the operator, not fixed here (out of
    // this change's scope).
    model_defaults: Object.freeze({
      low: 'gemini-3-flash-preview',
      medium: 'gemini-3-flash-preview',
      high: 'gemini-3.1-pro-preview'
    }),
    supports: Object.freeze({
      read_only: true,
      patch_allowed: true,
      full_auto: true
    })
  }),
  codewhale: Object.freeze({
    id: 'codewhale',
    label: 'Codewhale',
    binary: 'codewhale',
    runtime: 'cli',
    verification_only: false,
    experimental: false,
    cost_rank: 1,
    batching: 'good',
    preferred_for: Object.freeze(['review', 'deep-review', 'distinct-family-review']),
    model_defaults: Object.freeze({
      low: 'deepseek-v4-flash',
      medium: 'deepseek-v4-flash',
      high: 'deepseek-v4-flash'
    }),
    family: 'deepseek',
    supports: Object.freeze({
      read_only: true,
      patch_allowed: true,
      full_auto: true
    })
  }),
  cursor: Object.freeze({
    id: 'cursor',
    label: 'Cursor',
    binary: 'cursor',
    runtime: 'verification-only',
    verification_only: true,
    experimental: false,
    cost_rank: 3,
    batching: 'n/a',
    preferred_for: Object.freeze([]),
    model_defaults: Object.freeze({
      low: '',
      medium: '',
      high: ''
    }),
    supports: Object.freeze({
      read_only: false,
      patch_allowed: false,
      full_auto: false
    })
  })
});

function cloneActor(actor) {
  return JSON.parse(JSON.stringify(actor));
}

function detectBinary(binary) {
  const result = spawnSync('which', [binary], { encoding: 'utf8' });
  if (result.status !== 0) {
    return '';
  }
  return String(result.stdout || '').trim();
}

function getActorRegistry() {
  return Object.fromEntries(
    Object.entries(ACTOR_REGISTRY).map(([id, actor]) => [id, cloneActor(actor)])
  );
}

function getActor(actorId) {
  const normalized = String(actorId || '').trim().toLowerCase();
  return normalized && ACTOR_REGISTRY[normalized]
    ? cloneActor(ACTOR_REGISTRY[normalized])
    : null;
}

function detectActorRuntime(actorId) {
  const actor = getActor(actorId);
  if (!actor) return null;

  const binaryPath = detectBinary(actor.binary);
  const installed = Boolean(binaryPath);
  const available = installed && actor.verification_only !== true;

  return {
    ...actor,
    installed,
    available,
    binary_path: binaryPath
  };
}

function detectInstalledActors(actorIds = Object.keys(ACTOR_REGISTRY)) {
  const results = {};
  for (const actorId of actorIds) {
    const actor = detectActorRuntime(actorId);
    if (actor) results[actorId] = actor;
  }
  return results;
}

function normalizeWorkload(workload = '') {
  const normalized = String(workload || '').trim().toLowerCase();
  return VALID_WORKLOADS.includes(normalized) ? normalized : '';
}

function chooseClaudeModel(workload = 'low') {
  const normalized = normalizeWorkload(workload) || 'low';
  if (normalized === 'high') return 'opus';
  if (normalized === 'medium') return 'sonnet';
  return 'haiku';
}

function chooseActorModel(actorId, workload = 'low', explicitModel = '') {
  let chosen;
  let wasDefaulted = false;
  if (String(explicitModel || '').trim()) {
    chosen = String(explicitModel).trim();
  } else {
    const actor = getActor(actorId);
    if (!actor) return '';
    chosen = actor.id === 'claude'
      ? chooseClaudeModel(workload)
      : actor.model_defaults[normalizeWorkload(workload) || 'low'] || '';
    wasDefaulted = true;
  }

  // PIN VISIBILITY (2026-08-05). A roster-pinned review lane was dispatched
  // without an explicit model and silently resolved to the 'low' default —
  // haiku — while the charter pinned claude-opus-5. Nothing reported the
  // divergence; it was visible only because the runner echoes its command line
  // into the run report. Had it not, that lane would have been recorded as a
  // clean frontier review, and a gate would have cleared on a claim about
  // scrutiny that never happened.
  //
  // This does NOT change the choice. Defaulting to a cheap tier is correct
  // policy for mechanical work — the defect was never that haiku ran, it was
  // that the record could not distinguish a deliberate cheap lane from an
  // accidental one. So the resolution is announced on stderr whenever it was
  // DEFAULTED rather than requested, which is exactly when a caller who
  // believed they had a pin does not have one.
  if (wasDefaulted && !process.env.MYTHOS_SUPPRESS_MODEL_NOTICE) {
    try {
      process.stderr.write(
        `[actor-registry] NOTICE: no explicit model for actor "${actorId}" — `
        + `defaulted to "${chosen}" via workload "${normalizeWorkload(workload) || 'low'}". `
        + `If a roster pins this lane, pass --model explicitly; a defaulted model is NOT a verified pin.\n`
      );
    } catch { /* a notice must never break dispatch */ }
  }

  // S3 adaptive-mind-router SHADOW MODE (R1): log the static model choice so
  // the S6 harness can join it with the dispatch-stage recommendation. Never
  // blocks; never alters the choice.
  try {
    require('./mind-router-shadow.cjs').recordShadowDecision({
      stage: 'choose-actor-model',
      target: actorId,
      workload,
      static_choice: chosen
    });
  } catch { /* shadow must never block model selection */ }

  return chosen;
}

function chooseClaudeBudgetUsd(workload = 'low') {
  const normalized = normalizeWorkload(workload) || 'low';
  if (normalized === 'high') return 8;
  if (normalized === 'medium') return 3;
  return 1;
}

function inferWorkload(signal = {}) {
  const explicitWorkload = normalizeWorkload(
    signal.execution && signal.execution.workload
      ? signal.execution.workload
      : signal.workload || ''
  );
  if (explicitWorkload) return explicitWorkload;

  const mode = String(signal.execution && signal.execution.mode || 'read-only').trim().toLowerCase();
  const type = String(signal.signal_type || '').trim().toLowerCase();
  const scope = String(signal.scope || signal.signal_scope || '').trim().toLowerCase();
  const blockers = Array.isArray(signal.blocked_by) ? signal.blocked_by.length : 0;
  const artifacts = Array.isArray(signal.artifacts) ? signal.artifacts.length : 0;
  const decisionArtifacts = Array.isArray(signal.decision_context_artifacts)
    ? signal.decision_context_artifacts.length
    : 0;

  if (mode === 'full-auto') return 'high';
  if (mode === 'patch-allowed') {
    return artifacts > 6 || decisionArtifacts > 2 ? 'high' : 'medium';
  }
  if (type === 'blocked' || blockers > 0) return 'medium';
  if (artifacts > 5 || decisionArtifacts > 2) return 'medium';
  if (scope.includes('maintenance') || scope.includes('lessons')) return 'low';
  if (scope.includes('verify') || scope.includes('validation')) return 'low';
  if (type === 'ready-for-review' && mode === 'read-only' && artifacts <= 3 && decisionArtifacts === 0) {
    return 'low';
  }
  return 'low';
}

/**
 * Resolve the granted capabilities for an actor.
 *
 * `capabilities` are what an actor claims it can do (from its registry entry).
 * `granted_capabilities` are what the promotion controller has verified and
 * approved. The router must use `granted_capabilities`, not just `capabilities`.
 *
 * Attempts to load the actor's scorecard/promotion-decision artifact. If a
 * scorecard exists with `granted_capabilities`, those are used. If no
 * scorecard exists, granted capabilities default to EMPTY (not claimed) --
 * per operator decision: missing evidence = not granted.
 *
 * @param {string} actorId - Actor identifier (e.g., 'claude', 'codex')
 * @param {string} [projectRoot] - Absolute path to Mythos repo root. Defaults to cwd-based resolution.
 * @returns {{ capabilities: string[], granted_capabilities: string[], current_tier: string, source: string } | null}
 */
function resolveGrantedCapabilities(actorId, projectRoot) {
  const actor = getActor(actorId);
  if (!actor) return null;

  // Combine preferred_for and supports into a unified capabilities list
  const capabilities = [
    ...(actor.preferred_for || []),
    ...Object.entries(actor.supports || {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
  ];

  // Attempt to load scorecard from durable evidence
  const root = projectRoot || resolveProjectRoot();
  const scorecardPath = path.join(
    root, '_dev', 'reports', 'analysis', 'actor-scorecards',
    actorId + '__scorecard.json'
  );

  try {
    if (fs.existsSync(scorecardPath)) {
      const scorecard = JSON.parse(fs.readFileSync(scorecardPath, 'utf8'));
      const currentTier = scorecard.current_tier || 'candidate';

      // Use scorecard's granted_capabilities if present
      if (Array.isArray(scorecard.granted_capabilities) && scorecard.granted_capabilities.length > 0) {
        return {
          capabilities,
          granted_capabilities: scorecard.granted_capabilities,
          current_tier: currentTier,
          source: 'scorecard'
        };
      }

      // Scorecard exists but no granted_capabilities field — treat as empty
      return {
        capabilities,
        granted_capabilities: [],
        current_tier: currentTier,
        source: 'scorecard_no_grants'
      };
    }
  } catch (_err) {
    // Fall through to missing-evidence path
  }

  // No scorecard exists — missing evidence = not granted (empty capabilities)
  return {
    capabilities,
    granted_capabilities: [],
    current_tier: 'candidate',
    source: 'no_scorecard'
  };
}

/**
 * Resolve the project root used to locate actor scorecards.
 *
 * Capability tier (harness-runtime-contract terms): ADVISORY. This resolver
 * prefers the canonical root and warns on a genuine mismatch; nothing stops a
 * caller from passing its own `projectRoot` and bypassing the check entirely.
 *
 * History: this was a bare `process.cwd()` walk looking for CLAUDE.md, with
 * `process.cwd()` itself as the silent fallback. Both failure modes answer
 * confidently with the wrong root — a cwd inside a git worktree finds that
 * worktree's CLAUDE.md, and a cwd outside any checkout falls through to the
 * cwd itself. Either way the caller then reads
 * `<root>/_dev/reports/analysis/actor-scorecards/...`, finds nothing, and
 * silently downgrades the actor to `no_scorecard` / zero granted
 * capabilities. A missing-evidence answer that is really a wrong-path answer
 * is the failure this check exists to make audible.
 *
 * canonical-root.cjs resolves `__dirname`-relative, so it is unaffected by
 * cwd and is the trusted answer whenever it passes anchor validation. The
 * cwd walk is kept only as the fallback for when it does not.
 *
 * @returns {string}
 */
function resolveProjectRoot() {
  const walked = walkForProjectRoot();

  let canonical;
  try {
    canonical = resolveCanonicalRoot({ mode: 'hard' });
  } catch (err) {
    // Anchor validation failed. hard mode throws ECANONROOT WITHOUT writing
    // any stderr of its own (only circuit-breaker mode does that) — so this
    // catch is the only place that failure becomes audible. Nothing
    // trustworthy to compare against, so use the cwd walk rather than
    // refusing outright — a missing scorecard is a soft downgrade, not a
    // write — but the fallback must not be silent.
    warnCanonicalRootFallback(err, walked);
    return walked;
  }

  if (walked !== canonical) {
    warnProjectRootMismatch(walked, canonical);
  }
  return canonical;
}

/** The legacy cwd walk, retained as the fallback path. */
function walkForProjectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'CLAUDE.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let mismatchWarned = false;

/** Warn once per process; a per-call warn would flood any batch resolver. */
function warnProjectRootMismatch(walked, canonical) {
  if (mismatchWarned) return;
  mismatchWarned = true;
  process.stderr.write(
    `[actor-registry] project-root mismatch: cwd-derived root ${walked} ` +
      `disagrees with the canonical root ${canonical} (cwd: ${process.cwd()}). ` +
      'Trusting the canonical root; scorecard lookups under the cwd-derived ' +
      'root would have read the wrong tree.\n'
  );
}

let canonicalRootFallbackWarned = false;

/** Warn once per process; a degraded root should not spam every call. */
function warnCanonicalRootFallback(err, walked) {
  if (canonicalRootFallbackWarned) return;
  canonicalRootFallbackWarned = true;
  process.stderr.write(
    `[actor-registry] canonical-root failed (${err.code || 'ERR'}: ${err.message}); `
    + `falling back to cwd-walk root ${walked}\n`
  );
}

/**
 * Check whether a specific capability is granted for an actor.
 *
 * @param {string} actorId - Actor identifier
 * @param {string} capability - Capability to check (e.g., 'patch', 'full_auto', 'review')
 * @param {string} [projectRoot] - Absolute path to Mythos repo root.
 * @returns {boolean}
 */
function hasGrantedCapability(actorId, capability, projectRoot) {
  const resolved = resolveGrantedCapabilities(actorId, projectRoot);
  if (!resolved) return false;
  return resolved.granted_capabilities.includes(capability);
}

function selectActorForMaintenance(conditions, opts = {}) {
  const runtimes = opts.runtimes || detectInstalledActors();
  const available = Object.values(runtimes).filter((actor) => actor.available);
  if (available.length === 0) return null;

  const normalizedConditions = Array.isArray(conditions) ? conditions : [];
  const needsWrite = normalizedConditions.some((condition) => condition.requires_write || condition.auto_fix_failed);
  const needsDeepReview = normalizedConditions.some((condition) =>
    condition.severity === 'critical'
      || condition.type === 'closeout_artifact_gap'
      || condition.type === 'registry_shadow_surface'
      || condition.type === 'lifecycle_test_failure'
      || condition.type === 'maintenance_action_failure'
  );

  const ordered = needsWrite
    ? ['codex', 'claude', 'opencode']
    : needsDeepReview
      ? ['claude', 'codex', 'opencode']
      : ['opencode', 'claude', 'codex'];

  for (const actorId of ordered) {
    const actor = runtimes[actorId];
    if (actor && actor.available) {
      return actor;
    }
  }

  return available.sort((a, b) => a.cost_rank - b.cost_rank)[0] || null;
}

module.exports = {
  ACTOR_REGISTRY,
  chooseActorModel,
  chooseClaudeBudgetUsd,
  detectActorRuntime,
  detectBinary,
  detectInstalledActors,
  getActor,
  getActorRegistry,
  inferWorkload,
  normalizeWorkload,
  resolveProjectRoot,
  resolveGrantedCapabilities,
  hasGrantedCapability,
  selectActorForMaintenance
};
