#!/usr/bin/env node
/**
 * Create or update a Dart task from a Mythos plan / amendment / repair artifact.
 *
 * Usage:
 *   node tools/dart-integration/create-task-from-plan.js <plan-json-path> [--dartboard <name>] [--dry-run] [--comment-file <path>] [--no-projection]
 *
 * Behavior:
 *   - Reads the JSON plan/amendment/repair artifact
 *   - Derives title, status, priority, description, tags from the artifact
 *   - DEFAULT (S3, density-collapse model, 2026-07-14): a plan-kind artifact projects
 *     through projectPlanToDart as EXACTLY ONE PARENT Dart card — never per-step
 *     subtask cards. Steps and their gate classification (`mythos-gate` vs
 *     `mythos-auto-run`) render as a markdown checklist inside the parent card's
 *     description; step-status changes post as timestamped comments on that same
 *     parent (see plan-dart-projection.js). This is the main path. Pass
 *     `--no-projection` (alias `--flat`) to force the legacy single flat-task
 *     behavior; pass `--project-tree` / `--subtasks` to force projection on for
 *     any kind.
 *   - For amendments / repairs: appends a comment to the GOVERNING plan's existing Dart
 *     task — resolved by validating `plan_path` / `baseline_plan` independently as
 *     non-empty strings and authenticating that governing reference FIRST (repo-root
 *     path-containment + two-sided declared-identity match); an artifact-level
 *     `dart_task_id` is only trusted as-is when no governing reference exists at all,
 *     and is reconciled against the authenticated governing id when both are present.
 *     A fresh standalone task is allowed only when no governing reference was declared
 *     at all. A missing/unreadable parent, path or identity failure, malformed/ambiguous
 *     reference, Dart-ID mismatch, or governing-comment failure fails CLOSED: no fallback
 *     Dart write happens.
 *   - For concepts: creates a flat Brief WITHOUT step subtasks
 *
 * OBSERVABILITY-ONLY INVARIANT: the projection path only WRITES to Dart; it never
 * reads a Dart status to authorize execution. Authority is the GREENLIGHT proof.
 *
 * Designed to be called explicitly by skill prompts AND by a PostToolUse hook on plan-file writes.
 */

const fs = require('fs');
const path = require('path');
const dart = require('./lib/dart-api.js');
const { projectPlanToDart } = require('./lib/plan-dart-projection.js');

/**
 * A Dart-token resolution failure (env/Keychain/op/env-file all missed) is an
 * environment condition, not a plan defect. In a non-interactive hook context we
 * log ONE clear, actionable line (with the Keychain seed command) instead of a raw
 * `op` error, so a missing token degrades gracefully rather than spamming errors.
 * @param {Error} e
 * @returns {boolean} true if handled as a soft token-resolution miss
 */
function handleTokenResolutionFailure(e) {
  const code = e && e.code;
  const isTokenMiss = e && e.name === 'DartCredentialError'
    && (code === 'DART_TOKEN_MISSING' || code === 'DART_TOKEN_UNRESOLVED' || code === 'DART_TOKEN_UNREADABLE');
  if (!isTokenMiss) return false;
  console.log(JSON.stringify({
    action: 'dart-token-unresolvable',
    code,
    hint: e.message,
  }));
  return true;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dartboard') args.dartboard = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--comment-file') args.commentFile = argv[++i];
    // DEFAULT-ON (S3, density-collapse model 2026-07-14): plan-kind artifacts
    // project as ONE parent task with steps (gate-classified steps marked)
    // rendered as a checklist in the parent's description, via
    // projectPlanToDart. No per-step subtask cards are created. These flags
    // FORCE this single-parent-card projection on for any kind (back-compat
    // opt-in; harmless for plans, which already default to it).
    else if (a === '--project-tree' || a === '--subtasks') args.projectTree = true;
    // ESCAPE HATCH: opt OUT of the default single-parent-card projection and
    // fall back to the legacy single flat-task behavior. `--flat` is an alias.
    else if (a === '--no-projection' || a === '--flat') args.noProjection = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

// Client-code → dartboard routing is deployment-specific. This map ships empty
// by default; populate it (or load it from a config file/env var) with your
// own workspace's client codes and dartboard names before relying on
// client-code-based routing. Both `plan.client_code` and the `/clients/<code>/`
// path segment are matched against the same map.
const CLIENT_DARTBOARD_MAP = Object.freeze({
  // EXAMPLE: 'client-code'  Example Agency/Client Name'
});

function defaultDartboard(plan, planPath) {
  if (plan.client_code && CLIENT_DARTBOARD_MAP[plan.client_code]) {
    return CLIENT_DARTBOARD_MAP[plan.client_code];
  }
  if (planPath.includes('/clients/')) {
    const m = planPath.match(/\/clients\/([^/]+)\//);
    if (m && CLIENT_DARTBOARD_MAP[m[1]]) return CLIENT_DARTBOARD_MAP[m[1]];
  }
  return 'Mythos/System';
}

function classify(plan, planPath) {
  const base = path.basename(planPath);
  if (/__amendment__/.test(base)) return 'amendment';
  if (/__repair__/.test(base) || plan.schema === 'PlanRepair/1.0') return 'repair';
  if (plan.kind === 'concept' || /__concept-task\.json$/.test(base)) return 'concept';
  if (/__plan\./.test(base) || plan.task_id) return 'plan';
  return 'other';
}

function buildTaskItem(plan, planPath, dartboard) {
  const kind = classify(plan, planPath);
  const repoRel = path.relative(path.resolve(__dirname, '../..'), planPath).replace(/\\/g, '/');
  const planMd = repoRel.replace(/\.json$/, '.md');
  const summary = plan.task_summary || plan.description || '';
  const kernel = [
    '## Current State',
    kind === 'concept'
      ? 'A stable concept artifact is ready to become visible collaboration work in Dart.'
      : `A ${kind} artifact exists in the repo and needs a linked Dart collaboration surface.`,
    '',
    '## Question / Work',
    kind === 'plan'
      ? 'What is the one executable workstream this plan should track through Dart?'
      : kind === 'concept'
        ? 'Should this concept become a visible parent Brief for future scoped work?'
        : `What follow-up does this ${kind} artifact require on the linked workstream?`,
    '',
    '## Desired State',
    kind === 'plan'
      ? 'The Dart task points to the plan artifact, carries the plan risk/review context, and can receive evidence and handoff comments.'
      : kind === 'concept'
        ? 'The concept is represented as a Dart Brief without premature implementation subtasks.'
        : 'The artifact is linked to a Dart task or comment without duplicating the parent workstream.',
    '',
    // Stable idempotency marker — lets a re-run recognize an already-created task
    // even if the dart_task_id write-back never landed (e.g. crash after create).
    `Mythos-Plan-Ref: ${repoRel}`,
  ].join('\n');

  if (kind === 'concept') {
    return {
      title: plan.title || `Concept: ${plan.slug || path.basename(planPath, '.json')}`,
      dartboard,
      status: plan.status || 'To-do',
      priority: plan.priority || 'Medium',
      description: [
        kernel,
        plan.description ? `\n## Source Summary\n${plan.description}` : '',
        '',
        plan.concept_path ? `Concept: \`${plan.concept_path}\`` : '',
        `Task artifact: \`${repoRel}\``,
      ].filter(Boolean).join('\n'),
      tags: Array.isArray(plan.tags) && plan.tags.length ? plan.tags : ['concept'],
    };
  }

  if (kind === 'plan') {
    return {
      title: plan.title || plan.task_id || path.basename(planPath, '.json'),
      dartboard,
      status: 'To-do',
      priority: (plan.routing_expectations && plan.routing_expectations.risk_tier === 'high') ? 'High' :
                (plan.routing_expectations && plan.routing_expectations.risk_tier === 'medium') ? 'Medium' : 'Low',
      description: [
        kernel,
        summary ? `\n## Source Summary\n${summary}` : '',
        '',
        `Plan: \`${repoRel}\``,
        `MD: \`${planMd}\``,
        plan.routing_expectations ? `Risk: ${plan.routing_expectations.risk_tier} · Review lane: ${plan.routing_expectations.review_lane}` : '',
        plan.scope_type ? `Scope: ${plan.scope_type}` : '',
      ].filter(Boolean).join('\n'),
      tags: ['mythos-plan', kind, plan.scope_type || ''].filter(Boolean),
    };
  }

  // amendment / repair: still create a task if standalone, but mark as such
  return {
    title: `${kind}: ${plan.amendment_id || plan.repair_id || path.basename(planPath, '.json')}`,
    dartboard,
    status: 'To-do',
    priority: 'Medium',
    description: [
      kernel,
      (plan.trigger || summary) ? `\n## Source Summary\n${plan.trigger || summary}` : '',
      '',
      `${kind} of plan: \`${plan.plan_id || plan.task_id || 'unknown'}\``,
      `Artifact: \`${repoRel}\``,
      `MD: \`${planMd}\``,
    ].filter(Boolean).join('\n'),
    tags: ['mythos-plan', kind].filter(Boolean),
  };
}

function maybeWriteBackTaskId(planPath, plan, taskId) {
  if (plan.dart_task_id === taskId) return false;
  plan.dart_task_id = taskId;
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  return true;
}

/**
 * A GOVERNANCE_SECURITY_FAILURE is the legacy name for a structured,
 * fail-CLOSED custody result from resolveGoverningDartTaskId. It covers both
 * security-boundary failures and declared-parent state that cannot be proven.
 * Unlike the `null` result (no governing reference was declared), callers
 * MUST treat this as a hard stop: do NOT write to Dart at all, including a
 * standalone fallback task, and surface the error instead.
 * @typedef {{error: string, message: string}} GovernanceSecurityFailure
 */

/**
 * Resolve the GOVERNING Dart task id for an amendment/repair artifact.
 *
 * An amendment/repair file is a NEW artifact — it commonly has no
 * `dart_task_id` of its own even though the PLAN it amends already has a
 * live Dart parent card. Falling back to a standalone task in that case
 * (the pre-fix behavior at the `dart_task_id` check below) produced
 * top-level amendment cards disconnected from their governing plan. This
 * resolves the governing task id by:
 *   1. For `kind === 'amendment' | 'repair'`, first check whether a governing
 *      reference (`plan_path` or `baseline_plan`, both observed field names
 *      across amendment schemas) is validly present as a non-empty string.
 *      ROUND-5 REPAIR (MAJOR): the two fields are validated INDEPENDENTLY —
 *      a reference that is present but not a usable string (e.g. an object)
 *      is MALFORMED, not absent, and fails CLOSED rather than being silently
 *      treated as "no reference" (which would restore the direct-ID bypass
 *      below). Two different valid string references is AMBIGUOUS and also
 *      fails CLOSED rather than silently preferring one. If exactly one
 *      valid string reference exists, load the governing plan file it points
 *      to and read ITS `dart_task_id` — but ONLY after two security checks
 *      both pass:
 *        a. PATH CONTAINMENT — the resolved governing path must stay within
 *           the allowed repo root (never an absolute path or a `../`
 *           traversal that escapes it). A referenced path outside the repo
 *           root fails CLOSED (returns a GovernanceSecurityFailure), never
 *           silently falls back to a standalone task.
 *        b. IDENTITY CONTINUITY — the amendment/repair's own declared
 *           governing identity (`plan_id`, falling back to `task_id`) must
 *           equal the loaded governing artifact's own declared identity
 *           (`task_id`, falling back to `plan_id`). BOTH sides are mandatory
 *           (round-3 repair, MAJOR 2): canonical path containment only proves
 *           WHERE a file lives, not that it IS the governing plan the
 *           amendment claims — only comparing declared identities on both
 *           sides proves that. A governing file that declares neither
 *           `task_id` nor `plan_id` cannot be authenticated as the claimed
 *           governing artifact and fails CLOSED exactly like the
 *           amendment-side-missing case. A stale/incorrect reference whose
 *           identity does not match also fails CLOSED rather than posting to
 *           an unrelated Dart parent.
 *
 * Standalone fallback (returns null) is allowed only when `plan_path` AND
 * `baseline_plan` are BOTH entirely absent (`undefined`, not merely falsy).
 * Once an amendment/repair declares a governing reference, resolution is a
 * custody boundary: a missing/unparseable governing file or a governing file
 * without `dart_task_id` fails closed so uncertainty cannot create a new
 * disconnected top-level card.
 *
 * Fail-closed (returns a GovernanceSecurityFailure, caller MUST NOT write to
 * Dart at all): `plan_path` or `baseline_plan` is PRESENT but not a usable
 * non-empty string (round-5 repair, MAJOR — `governing-plan-reference-malformed`;
 * a malformed reference must never be silently treated as absent, which
 * would let it shadow a valid alternate reference or the direct id), both
 * `plan_path` and `baseline_plan` are present as valid but DIFFERENT strings
 * (round-5 repair, MAJOR — `governing-plan-reference-ambiguous`; never
 * silently prefer one), the referenced path escapes the repo root (checked
 * both lexically and, round-2 repair, canonically via realpath so an
 * in-repo symlink cannot resolve outside it), the referenced path cannot be
 * canonically resolved at all, the amendment/repair declares NO checkable
 * governing identity (plan_id/task_id) at all (round-2 repair — mandatory),
 * the GOVERNING FILE ITSELF declares no checkable identity (plan_id/task_id)
 * at all (round-3 repair, MAJOR 2 — mandatory on both sides now), or the two
 * artifacts' declared identities are both present and DISAGREE.
 *
 * @param {Object} plan
 * @param {string} planPath
 * @param {string} kind - classify() output
 * @param {Object} [fsImpl] - injectable fs (tests)
 * @param {string} [repoRootOverride] - injectable repo root (tests only; the
 *   real caller always uses the actual repo root two levels above this file)
 * @returns {string|null|GovernanceSecurityFailure}
 */
function resolveGoverningDartTaskId(plan, planPath, kind, fsImpl = fs, repoRootOverride) {
  const directDartTaskId =
    (typeof plan.dart_task_id === 'string' && plan.dart_task_id) || null;

  // ── ROUND-4 REPAIR (MAJOR): a direct `dart_task_id` on the artifact itself
  // must NOT bypass an available governing reference. Rounds 2/3 hardened
  // resolution VIA `plan_path`/`baseline_plan`, but a direct `dart_task_id`
  // present on the artifact used to short-circuit ALL of that — before kind,
  // containment, or identity were even checked. That let an amendment/repair
  // declare a `dart_task_id` that disagrees with its own governing plan's
  // `dart_task_id` and have the disagreeing direct value win outright.
  //
  // A direct `dart_task_id` may ONLY be trusted as-is when there is genuinely
  // NO governing reference at all (`plan_path`/`baseline_plan` both absent).
  // Whenever a governing reference IS present (and this artifact is a kind
  // that can carry one), the governing artifact must be resolved FIRST,
  // through the existing containment + two-sided identity checks below. If
  // that resolution succeeds, the two ids must AGREE — a genuine mismatch
  // fails CLOSED rather than silently trusting the direct value.
  //
  // ── ROUND-5 REPAIR (MAJOR): the prior form of this check was
  // `const governingRel = plan.plan_path || plan.baseline_plan;` followed by
  // `typeof governingRel === 'string'`. That selects the first TRUTHY value
  // across the two fields WITHOUT checking its type first — a malformed
  // (e.g. object) `plan_path` would win the `||` selection, then fail the
  // later `typeof === 'string'` check, making `hasGoverningReference` false
  // and silently falling through to the direct-id path below EVEN THOUGH a
  // perfectly valid string `baseline_plan` was also present. "Reference
  // present but malformed" was being coerced into "no reference at all",
  // reopening the round-4 bypass. `plan_path` and `baseline_plan` are now
  // validated INDEPENDENTLY as typed fields before either is selected:
  //   - "present" means `!== undefined` (round-5: distinguishes truly absent
  //     from present-but-unusable; an empty string is present, not absent).
  //   - "valid" means present AND a non-empty string.
  //   - "malformed" means present AND NOT valid (covers non-string truthy
  //     values like `{malformed: true}`, and also a present empty string).
  // A malformed reference on EITHER field fails CLOSED immediately — it is
  // never silently ignored in favor of the other field or the direct id.
  // Two DIFFERENT valid string references is ambiguous and also fails
  // CLOSED rather than silently preferring one. Only when BOTH fields are
  // entirely absent does resolution fall through to the direct id.
  const planPathPresent = plan.plan_path !== undefined;
  const baselinePlanPresent = plan.baseline_plan !== undefined;
  const planPathValid = typeof plan.plan_path === 'string' && plan.plan_path.length > 0;
  const baselinePlanValid = typeof plan.baseline_plan === 'string' && plan.baseline_plan.length > 0;
  const planPathMalformed = planPathPresent && !planPathValid;
  const baselinePlanMalformed = baselinePlanPresent && !baselinePlanValid;

  const isAmendmentOrRepair = (kind === 'amendment' || kind === 'repair');

  if (isAmendmentOrRepair && (planPathMalformed || baselinePlanMalformed)) {
    return {
      error: 'governing-plan-reference-malformed',
      message:
        `Amendment/repair declares a malformed governing plan reference — a present ` +
        `plan_path/baseline_plan field must be a non-empty string. Got plan_path: ` +
        `${JSON.stringify(plan.plan_path)}, baseline_plan: ${JSON.stringify(plan.baseline_plan)}. ` +
        `Refusing to treat a malformed-but-present reference as absent, which would otherwise ` +
        `allow it to shadow a valid alternate reference or an unchecked direct dart_task_id.`,
    };
  }

  if (isAmendmentOrRepair && planPathValid && baselinePlanValid && plan.plan_path !== plan.baseline_plan) {
    return {
      error: 'governing-plan-reference-ambiguous',
      message:
        `Amendment/repair declares two different valid governing plan references — plan_path: ` +
        `"${plan.plan_path}", baseline_plan: "${plan.baseline_plan}". Refusing to silently select one.`,
    };
  }

  const governingRel = (planPathValid && plan.plan_path) || (baselinePlanValid && plan.baseline_plan) || null;

  const hasGoverningReference = isAmendmentOrRepair && !!governingRel;

  if (!hasGoverningReference) return directDartTaskId;

  const repoRoot = path.resolve(repoRootOverride || path.resolve(__dirname, '..', '..'));
  const governingAbs = path.resolve(
    path.isAbsolute(governingRel) ? governingRel : path.join(repoRoot, governingRel)
  );

  // ── (a1) LEXICAL PATH CONTAINMENT ───────────────────────────────────────
  // The governing path must resolve (as a plain string) to a location WITHIN
  // the repo root — never an absolute path pointing elsewhere, and never a
  // `../` traversal that escapes it. Fail CLOSED (not open) on containment
  // failure: this is a security boundary, not an ordinary "reference not
  // found" case. Checked BEFORE touching the filesystem so it also catches
  // traversal against paths that do not exist.
  const rootWithSep = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  if (governingAbs !== repoRoot && !governingAbs.startsWith(rootWithSep)) {
    return {
      error: 'governing-plan-path-outside-repo-root',
      message:
        `Governing plan reference resolves outside the allowed repo root and was refused: ` +
        `"${governingRel}" -> "${governingAbs}" (root: "${repoRoot}").`,
    };
  }

  const realpathSync = typeof fsImpl.realpathSync === 'function' ? fsImpl.realpathSync : fs.realpathSync;

  try {
    if (!fsImpl.existsSync(governingAbs)) {
      return {
        error: 'governing-plan-not-found',
        message:
          `Referenced governing plan does not exist at "${governingRel}". Refusing to create a ` +
          `standalone amendment/repair card while its declared parent cannot be resolved.`,
      };
    }

    // ── (a2) CANONICAL (realpath) PATH CONTAINMENT ────────────────────────
    // The lexical check above only inspects the STRING path. A path that is
    // lexically inside the repo root can still be a symlink whose TARGET
    // resolves outside it (round-2 repair, MAJOR 3) — the lexical check
    // cannot see through that. Resolve symlinks on BOTH the candidate and
    // the repo root, then re-check containment against those canonical,
    // filesystem-verified locations. Fail CLOSED (not open) on a resolution
    // failure (e.g. a broken symlink existsSync still reports as present) —
    // we cannot prove containment, so refuse rather than trust it.
    let realGoverningAbs;
    let realRepoRoot;
    try {
      realGoverningAbs = path.resolve(realpathSync(governingAbs));
      realRepoRoot = path.resolve(realpathSync(repoRoot));
    } catch (_realpathError) {
      return {
        error: 'governing-plan-path-unresolvable',
        message:
          `Governing plan reference could not be canonically resolved (realpath failed) and was ` +
          `refused: "${governingRel}" -> "${governingAbs}".`,
      };
    }
    const realRootWithSep = realRepoRoot.endsWith(path.sep) ? realRepoRoot : realRepoRoot + path.sep;
    if (realGoverningAbs !== realRepoRoot && !realGoverningAbs.startsWith(realRootWithSep)) {
      return {
        error: 'governing-plan-path-outside-repo-root',
        message:
          `Governing plan reference resolves outside the allowed repo root once symlinks are ` +
          `followed and was refused: "${governingRel}" -> "${governingAbs}" ` +
          `(real: "${realGoverningAbs}", root: "${realRepoRoot}").`,
      };
    }

    const governingPlan = JSON.parse(fsImpl.readFileSync(governingAbs, 'utf8'));

    const governingDartTaskId =
      (typeof governingPlan.dart_task_id === 'string' && governingPlan.dart_task_id) || null;
    if (!governingDartTaskId) {
      return {
        error: 'governing-plan-dart-task-id-not-declared',
        message:
          `Referenced governing plan at "${governingRel}" has no dart_task_id. Refusing to create ` +
          `a standalone amendment/repair card instead of attaching it to its declared parent.`,
      };
    }

    // ── (b) MANDATORY IDENTITY CONTINUITY ─────────────────────────────────
    // A file existing at the referenced path and containing a dart_task_id is
    // NOT sufficient proof that it actually governs THIS amendment/repair.
    // Require the amendment/repair to declare a checkable governing identity
    // (plan_id, falling back to task_id) at all — an amendment/repair that
    // declares NEITHER cannot have its reference trusted (round-2 repair,
    // MAJOR 3: "compare identities when both exist" is weaker than identity
    // continuity — a referenced file selecting an outward write target must
    // have an authenticated identity to check against, not an absent one
    // that trivially "matches" nothing). Fail CLOSED when no identity is
    // declared at all, and fail CLOSED on a genuine mismatch when the
    // governing file also declares its own identity.
    //
    // ROUND-3 REPAIR (MAJOR 2): the identity check above is one-sided if it
    // stops here. Canonical path containment (realpath, above) only proves
    // WHERE a file lives, not that it IS the governing plan the amendment
    // claims it is — only comparing declared identities on BOTH sides proves
    // that. So the governing file's OWN declared identity (task_id/plan_id)
    // is now mandatory too, not merely compared "if present". A governing
    // file that declares neither task_id nor plan_id cannot be authenticated
    // as the claimed governing artifact regardless of amendment-side rigor,
    // and must fail closed exactly like the amendment-side-missing case
    // below (see `governing-plan-identity-not-declared`).
    const declaredGoverningId =
      (typeof plan.plan_id === 'string' && plan.plan_id) ||
      (typeof plan.task_id === 'string' && plan.task_id) || null;

    if (!declaredGoverningId) {
      return {
        error: 'governing-plan-identity-not-declared',
        message:
          `Amendment/repair declares no checkable governing identity (plan_id/task_id) — refusing ` +
          `to trust the dart_task_id of the referenced file at "${governingRel}" without identity ` +
          `continuity.`,
      };
    }

    const governingOwnId =
      (typeof governingPlan.task_id === 'string' && governingPlan.task_id) ||
      (typeof governingPlan.plan_id === 'string' && governingPlan.plan_id) || null;

    if (!governingOwnId) {
      return {
        error: 'governing-plan-own-identity-not-declared',
        message:
          `Referenced governing file at "${governingRel}" declares no checkable identity ` +
          `(task_id/plan_id) of its own — canonical path containment only proves where the file ` +
          `lives, not that it is the governing plan this amendment/repair claims. Refusing to ` +
          `trust its dart_task_id without two-sided identity continuity.`,
      };
    }

    if (declaredGoverningId !== governingOwnId) {
      return {
        error: 'governing-plan-identity-mismatch',
        message:
          `Amendment/repair declares governing identity "${declaredGoverningId}" but the ` +
          `referenced file at "${governingRel}" declares identity "${governingOwnId}". Refusing ` +
          `to write to its dart_task_id.`,
      };
    }

    // ── ROUND-4 REPAIR: reconcile the authenticated governing id against a
    // direct `dart_task_id` also declared on this artifact, if any. Agreement
    // is fine (no ambiguity); a genuine disagreement must fail CLOSED — this
    // is exactly the case amendment #3 exposed (a direct id different from
    // the governing plan's authenticated id).
    if (directDartTaskId && directDartTaskId !== governingDartTaskId) {
      return {
        error: 'governing-plan-dart-task-id-mismatch',
        message:
          `Artifact declares direct dart_task_id "${directDartTaskId}" but the authenticated ` +
          `governing plan at "${governingRel}" declares dart_task_id "${governingDartTaskId}". ` +
          `Refusing to write to either target until this is reconciled.`,
      };
    }

    return governingDartTaskId;
  } catch (_e) {
    return {
      error: 'governing-plan-unreadable',
      message:
        `Referenced governing plan at "${governingRel}" could not be read and parsed. Refusing to ` +
        `create a standalone amendment/repair card while its declared parent is unreadable.`,
    };
  }
}

async function appendGoverningComment(client, taskId, text) {
  if (!client || typeof client.addComment !== 'function') {
    throw new TypeError('appendGoverningComment: client.addComment is required');
  }
  if (!taskId) {
    throw new TypeError('appendGoverningComment: taskId is required');
  }
  return client.addComment(taskId, text);
}

/**
 * True iff a resolveGoverningDartTaskId() result is a GovernanceSecurityFailure
 * (fail-closed) rather than a resolved task id or a fail-open null.
 * @param {string|null|GovernanceSecurityFailure} resolved
 * @returns {boolean}
 */
function isGovernanceSecurityFailure(resolved) {
  return !!(resolved && typeof resolved === 'object' && typeof resolved.error === 'string');
}

/**
 * Idempotency guard: before creating a task, look for one that already represents
 * this plan on the same dartboard. Matches on the deterministic task title (which
 * is available in list views). Fail-open: any read error or no match returns null,
 * so behavior degrades to the pre-existing "create" path rather than blocking.
 *
 * This closes the duplicate-task window where createTask() succeeds but the
 * dart_task_id write-back never lands (crash / interrupted run).
 *
 * @param {string} dartboard
 * @param {string} title - deterministic task title (item.title)
 * @param {object} [client] - injectable dart client (defaults to the real API; overridable in tests)
 * @returns {Promise<{id:string}|null>}
 */
async function findExistingTaskForPlan(dartboard, title, client = dart) {
  if (!title) return null;
  for (const isCompleted of [false, true]) {
    let res;
    try {
      res = await client.listTasks(dartboard, { is_completed: isCompleted, limit: 100 });
    } catch (e) {
      // Fail open — never block creation on a read failure.
      return null;
    }
    const tasks = (res && res.results) ? res.results : (Array.isArray(res) ? res : []);
    const match = tasks.find((t) => t && t.title === title);
    if (match && match.id) return match;
  }
  return null;
}

/**
 * Dry-run Dart shim for tree mode. Wraps NO real client — it suppresses every
 * write and skips the dedup read so `--dry-run --project-tree` performs ZERO
 * network calls, mirroring the legacy flat dry-run path (which also makes no
 * Dart calls). Returns deterministic placeholder ids so the projection can
 * finish and report what WOULD be created.
 */
function makeDryRunDart() {
  let n = 0;
  return {
    listTasks: async () => ({ results: [] }),
    createTask: async (item) => {
      console.log('[DRY-RUN] would createTask:', item.title);
      return { item: { id: 'dry-' + (++n) } };
    },
    updateTask: async (id) => {
      console.log('[DRY-RUN] would updateTask:', id);
      return { item: { id } };
    },
  };
}

/**
 * DEFAULT-ON single-parent-card projection (density-collapse model): route the
 * plan through projectPlanToDart to create/update EXACTLY ONE parent Dart card
 * carrying a step checklist (gate-classified steps marked) — never per-step
 * subtask cards. The plan's own idempotency (parent matched by the
 * Mythos-Plan-Ref marker, falling back to title, in projectPlanToDart) and
 * --dry-run are both honored. dart-api + the projection fn are injectable for
 * tests.
 *
 * NOTE: this path is WRITE-only observability — projectPlanToDart / syncStepStatus
 * never read a Dart status to authorize execution.
 *
 * @param {object} plan
 * @param {string|null} planPath - artifact path for dart_task_id write-back (null to skip)
 * @param {{dartboard:string, dryRun?:boolean, client?:object, project?:Function}} opts
 * @returns {Promise<{mode:'tree', dryRun:boolean, parentId:string|null, subtaskIds:string[]}>}
 */
async function projectPlanTree(plan, planPath, opts = {}) {
  const { dartboard, dryRun = false } = opts;
  const client = opts.client || dart;
  const project = opts.project || projectPlanToDart;
  const activeDart = dryRun ? makeDryRunDart() : client;
  const result = await project(plan, { dart: activeDart, dartboard });
  if (!dryRun && result && result.parentId && planPath) {
    maybeWriteBackTaskId(planPath, plan, result.parentId);
  }
  return { mode: 'tree', dryRun, parentId: (result && result.parentId) || null, subtaskIds: (result && result.subtaskIds) || [] };
}

/**
 * Resolve whether to route through the S3 tree projection (projectPlanToDart)
 * or the legacy flat single-task path. Pure + side-effect-free so the default-on
 * routing can be unit-tested without touching Dart.
 *
 * Precedence:
 *   1. --project-tree / --subtasks  → FORCE projection (any kind).
 *   2. --no-projection / --flat     → FORCE legacy flat path.
 *   3. default                      → project plan-kind artifacts (NOT amendments,
 *                                      repairs, or concepts; NOT --comment-file).
 *
 * @param {object} args - parsed args (projectTree, noProjection, commentFile)
 * @param {string} kind - classify() output ('plan' | 'amendment' | 'repair' | 'concept' | 'other')
 * @returns {boolean} true → use projectPlanTree
 */
function resolveUseProjection(args, kind) {
  if (args.projectTree === true) return true;          // explicit force-on
  if (args.noProjection === true) return false;        // explicit escape
  return kind === 'plan' && !args.commentFile;         // default-on for plans
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    console.error('Usage: node tools/dart-integration/create-task-from-plan.js <plan-json-path> [--dartboard <name>] [--dry-run] [--comment-file <path>] [--no-projection|--flat] [--project-tree]');
    process.exit(args.help ? 0 : 1);
  }
  const planPath = path.resolve(args._[0]);
  if (!fs.existsSync(planPath)) {
    console.error('ERROR: plan file not found:', planPath);
    process.exit(1);
  }
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (e) {
    console.error('ERROR: failed to parse plan JSON:', e.message);
    process.exit(1);
  }

  const dartboard = args.dartboard || defaultDartboard(plan, planPath);
  const kind = classify(plan, planPath);

  // S3 tracking is DEFAULT-ON: a plan-kind artifact projects through
  // projectPlanToDart as EXACTLY ONE parent Dart card (step checklist inside
  // its description, gate steps marked) — never per-step subtask cards
  // (density-collapse model, 2026-07-14) — unless the operator opts out.
  // This is the wiring F1 flagged — projection is now the main path, not an
  // opt-in flag.
  //
  // Routing precedence:
  //   1. --project-tree / --subtasks  → FORCE projection on (any kind).
  //   2. --no-projection / --flat     → FORCE the legacy flat single-task path.
  //   3. default                      → project plan-kind artifacts.
  //
  // Scoped to kind === 'plan' so the distinct legacy semantics survive:
  // amendments/repairs append a comment to the parent's task, and concepts
  // become a flat Brief WITHOUT premature step subtasks — neither is a step-tree.
  // `--comment-file` is an explicit "append this comment" op, so it also stays on
  // the legacy path (force it with --project-tree if a tree is wanted instead).
  //
  // Observability-only invariant preserved: projectPlanTree only ever WRITES to
  // Dart (create/update tasks); it never reads a Dart status to authorize work.
  const useProjection = resolveUseProjection(args, kind);

  if (useProjection) {
    // --dry-run routes through makeDryRunDart inside projectPlanTree: ZERO network
    // calls and NO credential resolution (the real dart-api client is never hit).
    const result = await projectPlanTree(plan, planPath, { dartboard, dryRun: args.dryRun });
    console.log(JSON.stringify({ action: args.dryRun ? 'tree-dry-run' : 'tree-projected', kind, ...result }, null, 2));
    return;
  }

  const item = buildTaskItem(plan, planPath, dartboard);

  // Resolve the governing Dart task id: for amendments/repairs, a validly
  // present governing reference (plan_path/baseline_plan) is checked and
  // reconciled FIRST (round-4/5 repairs) — the artifact's own dart_task_id
  // is trusted directly only when NO governing reference exists at all.
  // A malformed or ambiguous reference fails closed rather than falling
  // back to the direct id or to standalone-task creation below.
  const governingResolution = resolveGoverningDartTaskId(plan, planPath, kind);

  // FAIL CLOSED: a declared governing parent that cannot be authenticated or
  // read must NOT produce any Dart write, including a standalone fallback.
  if (isGovernanceSecurityFailure(governingResolution)) {
    console.error(JSON.stringify({
      action: 'governing-plan-resolution-refused',
      error: governingResolution.error,
      message: governingResolution.message,
    }, null, 2));
    process.exit(1);
  }

  const governingDartTaskId = governingResolution;

  if (governingDartTaskId) {
    // Already linked (directly, or via the governing plan this amends) —
    // append a comment to the GOVERNING parent instead of creating a
    // duplicate / disconnected top-level card.
    let commentText = null;
    if (args.commentFile) {
      const commentPath = path.resolve(args.commentFile);
      if (!fs.existsSync(commentPath)) {
        console.error('ERROR: comment file not found:', commentPath);
        process.exit(1);
      }
      commentText = fs.readFileSync(commentPath, 'utf8');
    }
    if (args.dryRun) {
      console.log('[DRY-RUN] would addComment to', governingDartTaskId, 'for', args.commentFile ? 'comment-file' : kind);
      return;
    }
    try {
      const comment = await appendGoverningComment(dart, governingDartTaskId, commentText || [
        `New artifact recorded for this plan:`,
        `- ${kind}: \`${path.relative(path.resolve(__dirname, '../..'), planPath).replace(/\\/g, '/')}\``,
        item.description ? `\n${item.description.split('\n').slice(0, 6).join('\n')}` : '',
      ].filter(Boolean).join('\n'));
      console.log(JSON.stringify({ action: 'comment-added', task_id: governingDartTaskId, comment_id: comment && comment.item && comment.item.id }, null, 2));
      return;
    } catch (e) {
      console.error('ERROR: addComment failed for governing task; no standalone fallback was created:', e.message);
      process.exit(1);
      return;
    }
  }

  // Idempotency guard: if a same-title task already exists on this board, re-link
  // to it instead of creating a duplicate. Covers the case where a prior run created
  // the task but never wrote dart_task_id back into the artifact.
  if (!args.dryRun) {
    const existing = await findExistingTaskForPlan(dartboard, item.title);
    if (existing) {
      const repoRel = path.relative(path.resolve(__dirname, '../..'), planPath).replace(/\\/g, '/');
      const wrote = maybeWriteBackTaskId(planPath, plan, existing.id);
      try {
        await dart.addComment(existing.id, `Re-linked plan artifact (idempotency guard): \`${repoRel}\``);
      } catch (e) {
        console.error('WARN: re-link comment failed:', e.message);
      }
      console.log(JSON.stringify({ action: 'task-relinked', task_id: existing.id, wrote_back: wrote }, null, 2));
      return;
    }
  }

  if (args.dryRun) {
    console.log('[DRY-RUN] would createTask:', JSON.stringify(item, null, 2));
    return;
  }

  try {
    const created = await dart.createTask(item);
    const taskId = created && created.item && created.item.id;
    if (taskId) {
      const wrote = maybeWriteBackTaskId(planPath, plan, taskId);
      console.log(JSON.stringify({ action: 'task-created', task_id: taskId, html_url: created.item.htmlUrl, wrote_back: wrote }, null, 2));
    } else {
      console.log(JSON.stringify(created, null, 2));
    }
  } catch (e) {
    // Token not resolvable in this (likely non-interactive) context: fail soft.
    if (handleTokenResolutionFailure(e)) return;
    console.error('ERROR creating task:', e.message);
    if (e.statusCode) console.error('statusCode:', e.statusCode);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    // A token-resolution miss can surface from any awaited Dart call (e.g. the
    // identity probe before a write). Degrade gracefully with exit 0.
    if (handleTokenResolutionFailure(e)) return;
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}

module.exports = { buildTaskItem, classify, defaultDartboard, findExistingTaskForPlan, resolveGoverningDartTaskId, isGovernanceSecurityFailure, appendGoverningComment, parseArgs, projectPlanTree, makeDryRunDart, resolveUseProjection, handleTokenResolutionFailure };
