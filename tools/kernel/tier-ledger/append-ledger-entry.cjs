#!/usr/bin/env node
'use strict';
// append-ledger-entry.cjs — tier track-record ledger writer.
//
// ENFORCEMENT_FAMILY: quality-process
//   (graduation bookkeeping — never a safety gate; reads the canonical rule
//   only to verify the governed perimeter, never session tier state.)
//
// tier-enforcement-implementation slice 3, step
// tier-s3a-ledger-schema-and-perimeter (convene 20260611T130035Z conditions
// 7 + 10). Frozen procedure/evidence schema:
// tools/kernel/tier-ledger/tier-track-record.schema.json.
//
// DERIVATION CONTRACT (producer-can't-self-validate, mechanical):
//   * Entries are derived ONLY from durable artifacts on disk — the task
//     plan, the plan-task-review-state marker (distinct_reviews), the
//     task-outcome artifact, and the session-tier stamp. There is NO input
//     (CLI flag, option, or entry field) through which a caller can assert
//     a grade: grades pass through from the distinct reviewer's recorded
//     verdict, classified against the schema's enumerated verdict lists.
//   * A grade-bearing entry (clean | failed) is REJECTED unless the
//     reviewing actor is distinct intelligence from the producing actor:
//     model-family signatures must both resolve and differ (same-model
//     actors are parallel contexts, not distinct intelligence). Fail-closed:
//     unresolvable reviewer identity never grades.
//   * A grade-bearing entry is REJECTED when the reviewer's artifact does
//     not exist on disk.
//   * Appends are idempotent: entry_id is deterministic over the evidence
//     set; re-derivation never duplicates.
//
// GOVERNED PERIMETER (convene condition 7): the ledger directory
// (_dev/reports/analysis/tier-track-record/**) and _dev/state/session-tier/**
// must sit inside the mutation-plan-gate's governed paths in
// instructions/canonical/process-tier-rule.yaml. verifyGovernedPerimeter()
// checks this against the live rule at write time and the result is recorded
// in the ledger file header (governed_perimeter_verified).
//
// WORK-UNIT BINDING (schema 1.1, W2 amendment 20260611T152855Z; W3 fix 20260611T):
//   Grade-bearing entries require work-unit/review-scope binding. Pass
//   --work-unit <id> (slice/step id or commit hash) to declare what is being
//   graded. The writer checks that the distinct review post-dates work-unit
//   completion (stale-pre-execution rejection) and that the review artifact
//   demonstrably covers the work unit. Fail-closed: no binding established →
//   entry written as ungraded with rejection_reason, never silently graded.
//
//   GRADE-BEARING BASIS WHITELIST (W3 contract, categorical):
//     Only binding_basis ∈ { artifact-path-match, artifact-content-match }
//     may produce a grade-bearing entry. 'work-unit-declared' is NEVER
//     grade-bearing — a declared work unit without path/content coverage is
//     written as UNGRADED with rejection_reason 'binding-too-weak-declared-only'.
//
// CLI:
//   node tools/kernel/tier-ledger/append-ledger-entry.cjs \
//     --plan <plan-id> [--session <session-id>] [--root <repo-root>] \
//     [--work-unit <id>] [--work-unit-completed-at <iso>] [--dry-run]

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readRuleSafe } = require('../hooks/lib/process-tier.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const SCHEMA_PATH = path.join(__dirname, 'tier-track-record.schema.json');
const LEDGER_DIR_REL = '_dev/reports/analysis/tier-track-record';
const SESSION_TIER_DIR_REL = '_dev/state/session-tier';
const PLAN_DIR_REL = '_dev/reports/analysis/task-plans';
const REVIEW_STATE_DIR_REL = '_dev/state/plan-task-review-state';
const TASK_OUTCOME_DIR_REL = '_dev/reports/analysis/task-outcomes';
const MUTATION_PLAN_GATE_ADD_ID = 'mutation-plan-gate';

// Model-family signature: distinctness is checked at model-family
// granularity because same-model actors are parallel contexts, not distinct
// intelligence. Order matters: more specific tokens first.
const FAMILY_TOKENS = [
  ['fable', /fable/],
  ['opus', /opus/],
  ['sonnet', /sonnet/],
  ['haiku', /haiku/],
  ['gpt', /gpt/],
  ['gemini', /gemini/],
  ['operator', /\boperator\b|\bhuman\b|\btaylor\b/],
  // Bare "claude" / "codex" only when no model token resolved above.
  ['claude', /claude/],
  ['gpt', /codex/]
];

function loadSchema(schemaPath = SCHEMA_PATH) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function actorSignature(actor) {
  const value = String(actor || '').toLowerCase();
  if (!value.trim()) return null;
  for (const [family, re] of FAMILY_TOKENS) {
    if (re.test(value)) return family;
  }
  return null;
}

// Producer-can't-self-validate, mechanically (frozen invariant —
// reviewer_distinctness_invariant in the schema). Fail-closed.
function isDistinctReviewer(producerActor, reviewerActor) {
  const producer = String(producerActor || '').trim().toLowerCase();
  const reviewer = String(reviewerActor || '').trim().toLowerCase();
  if (!producer || !reviewer) return false;
  if (producer === reviewer) return false;
  const producerFamily = actorSignature(producer);
  const reviewerFamily = actorSignature(reviewer);
  if (!producerFamily || !reviewerFamily) return false;
  return producerFamily !== reviewerFamily;
}

// Grades pass through from the reviewer's verdict — enumerated lists only,
// anything unlisted is ungraded (no fuzzy matching, no grade laundering).
function classifyVerdict(verdict, schema) {
  const normalized = String(verdict || '').trim().toLowerCase();
  if (!normalized) return 'ungraded';
  const lists = (schema || loadSchema()).ledger.verdict_classification;
  if (lists.clean_verdicts.includes(normalized)) return 'clean';
  if (lists.failed_verdicts.includes(normalized)) return 'failed';
  return 'ungraded';
}

function safeKey(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
}

function readJsonSafe(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Mirror of the mutation-plan gate's glob semantics (** any depth, * single
// segment) so the perimeter verification matches the gate's actual behavior.
function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*');
  return new RegExp(`^${escaped}$`);
}

// Convene condition 7: ledger + session-tier state inside the governed
// perimeter. Verified against the LIVE canonical rule, by the same glob
// semantics the gate uses on a representative file under each directory.
function verifyGovernedPerimeter(opts = {}) {
  const rule = opts.rule !== undefined ? opts.rule : readRuleSafe(opts.rulePath);
  const add = rule && rule.add_registry && rule.add_registry.adds &&
    rule.add_registry.adds[MUTATION_PLAN_GATE_ADD_ID];
  const paths = add && Array.isArray(add.paths) ? add.paths : [];
  const probes = [
    `${LEDGER_DIR_REL}/probe.json`,
    `${LEDGER_DIR_REL}/candidacies/probe.json`,
    `${SESSION_TIER_DIR_REL}/probe.json`
  ];
  const uncovered = probes.filter(
    (probe) => !paths.some((p) => globToRegExp(p).test(probe))
  );
  return { ok: uncovered.length === 0, uncovered, governed_paths: paths };
}

function planCoverageEntries(plan) {
  const entries = [];
  const push = (value) => {
    const cleaned = String(value || '').split(' (')[0].trim();
    if (cleaned && !entries.includes(cleaned)) entries.push(cleaned);
  };
  const steps = plan && plan.bounded_plan && Array.isArray(plan.bounded_plan.steps)
    ? plan.bounded_plan.steps : [];
  for (const step of steps) {
    for (const f of (Array.isArray(step.files_touched) ? step.files_touched : [])) push(f);
  }
  const owned = plan && plan.scope_identity && Array.isArray(plan.scope_identity.owned_artifacts)
    ? plan.scope_identity.owned_artifacts : [];
  for (const f of owned) push(f);
  return entries;
}

// Mechanical scope-class derivation (frozen in the schema).
function deriveScopeClass(plan) {
  if (plan && (plan.client_code || plan.origin_client_code)) return 'client-delivery';
  const coverage = planCoverageEntries(plan);
  const kernel = ['instructions/canonical/', 'tools/kernel/', '.claude/'];
  if (coverage.some((e) => kernel.some((k) => e.startsWith(k)))) return 'system-kernel';
  if (coverage.some((e) => e.startsWith('frameworks/'))) return 'framework';
  return 'system-other';
}

function latestDistinctReview(marker) {
  const reviews = marker && Array.isArray(marker.distinct_reviews)
    ? marker.distinct_reviews.filter((r) => r && typeof r === 'object')
    : [];
  if (!reviews.length) return null;
  return reviews
    .slice()
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    .pop();
}

// Schema 1.1 work-unit binding (W2 amendment 20260611T152855Z; W3 fix 20260611T).
// Returns { binding_basis, rejection_reason } for a candidate grade-bearing entry.
// Fail-closed: any stale-pre-execution or missing-work-unit case → ungraded.
//
// GRADE-BEARING BASIS WHITELIST (W3 categorical contract):
//   Only artifact-path-match and artifact-content-match are grade-bearing.
//   'work-unit-declared' is recordable as a basis value but is NEVER grade-bearing;
//   such entries are written UNGRADED with rejection_reason 'binding-too-weak-declared-only'.
//
// Rules (in precedence order):
//   1. No workUnit declared → rejection_reason='no-work-unit-binding' (checked first, unconditional)
//   2. Stale-pre-execution: review.at < workUnitCompletedAt → rejection_reason='stale-pre-execution-review'
//   3. Path-match: review.artifact path contains a workUnit token → binding_basis='artifact-path-match'
//   4. Content-match: review artifact on-disk text contains workUnit token → binding_basis='artifact-content-match'
//   5. Work-unit declared, review post-dates completedAt, but no path/content match →
//      binding_basis='work-unit-declared', rejection_reason='binding-too-weak-declared-only' (NEVER grade-bearing)
function deriveWorkUnitBinding(review, workUnit, workUnitCompletedAt, root) {
  const token = workUnit ? String(workUnit).trim() : null;
  if (!token) {
    // No work unit declared — grade-bearing writes are rejected (no-work-unit-binding).
    return { binding_basis: 'no-binding', rejection_reason: 'no-work-unit-binding' };
  }

  const reviewAt = review && review.at ? Date.parse(review.at) : NaN;
  const completedAt = workUnitCompletedAt ? Date.parse(workUnitCompletedAt) : NaN;

  // Stale-pre-execution check (fail-closed).
  if (!Number.isNaN(completedAt) && !Number.isNaN(reviewAt) && reviewAt < completedAt) {
    return { binding_basis: 'no-binding', rejection_reason: 'stale-pre-execution-review' };
  }

  // Split comma-separated work-unit ids into individual tokens for matching.
  // Each token is checked independently — all must appear (AND) for path/content match.
  // Single-token work-units: tokens = [token].
  const tokens = token.split(',').map((t) => t.trim()).filter(Boolean);

  // Path-match: all work-unit tokens appear in the review artifact path.
  const artifactPath = review && review.artifact ? String(review.artifact) : '';
  if (artifactPath && tokens.every((t) => artifactPath.includes(t))) {
    return { binding_basis: 'artifact-path-match', rejection_reason: null };
  }

  // Content-match: review artifact on-disk text contains all work-unit tokens.
  if (artifactPath && root) {
    const abs = path.isAbsolute(artifactPath) ? artifactPath : path.join(root, artifactPath);
    try {
      const content = fs.readFileSync(abs, 'utf8');
      if (tokens.every((t) => content.includes(t))) {
        return { binding_basis: 'artifact-content-match', rejection_reason: null };
      }
    } catch {
      // unreadable artifact — fall through to weaker binding
    }
  }

  // Work-unit declared, review post-dates completion, but no path/content match:
  // binding_basis is recorded as 'work-unit-declared' but this is NEVER grade-bearing
  // (W3 categorical contract). Entry is written ungraded with rejection_reason.
  return { binding_basis: 'work-unit-declared', rejection_reason: 'binding-too-weak-declared-only' };
}

// Derive an entry from durable artifacts only. Throws when the plan is
// missing — there is no entry without a plan artifact.
function deriveEntry({ planId, sessionId, root, schema, workUnit, workUnitCompletedAt } = {}) {
  const activeRoot = root || ROOT;
  const activeSchema = schema || loadSchema();
  const planRel = `${PLAN_DIR_REL}/${planId}__plan.json`;
  const plan = readJsonSafe(path.join(activeRoot, planRel));
  if (!plan) {
    throw new Error(`plan artifact not found or unreadable: ${planRel}`);
  }

  const sourceArtifacts = [planRel];
  const evidenceRefs = [planRel];

  const markerRel = `${REVIEW_STATE_DIR_REL}/${planId}.json`;
  const marker = readJsonSafe(path.join(activeRoot, markerRel));
  if (marker) {
    sourceArtifacts.push(markerRel);
    evidenceRefs.push(markerRel);
  }

  const outcomeRel = `${TASK_OUTCOME_DIR_REL}/${planId}.json`;
  const outcome = readJsonSafe(path.join(activeRoot, outcomeRel));
  if (outcome) {
    sourceArtifacts.push(outcomeRel);
    evidenceRefs.push(outcomeRel);
  }

  let stamp = null;
  let stampRel = null;
  if (sessionId) {
    stampRel = `${SESSION_TIER_DIR_REL}/${safeKey(sessionId)}.json`;
    stamp = readJsonSafe(path.join(activeRoot, stampRel));
    if (stamp) sourceArtifacts.push(stampRel);
    else stampRel = null;
  }

  // Producer identity precedence: session-tier stamp model (strongest,
  // hook-written) > task-outcome produced_by_actor_id > plan produced_by_actor_id.
  const producerActor =
    (stamp && stamp.model && stamp.model !== 'unknown' && stamp.model) ||
    (outcome && outcome.produced_by_actor_id) ||
    (plan && plan.produced_by_actor_id) ||
    null;
  if (!producerActor) {
    throw new Error(`no durable producer identity for plan ${planId} (no stamp/outcome/plan actor)`);
  }

  // work_unit_completed_at: caller-supplied, else fall back to now (entries
  // without a work_unit are ungraded anyway so this value only matters for
  // grade-bearing entries where the caller supplies --work-unit-completed-at).
  const activeWorkUnitCompletedAt = workUnitCompletedAt || new Date().toISOString();

  // Slice-scoped changed_files: when workUnit is a step id (or comma-separated
  // list of step ids), collect files only from those steps. Falls back to
  // full-plan coverage when no workUnit is declared.
  function changedFilesForWorkUnit(p, wu) {
    if (!wu) return planCoverageEntries(p);
    const tokens = String(wu).split(',').map((t) => t.trim()).filter(Boolean);
    const steps = p && p.bounded_plan && Array.isArray(p.bounded_plan.steps)
      ? p.bounded_plan.steps : [];
    const matchedSteps = steps.filter((s) => tokens.includes(s.step_id));
    if (!matchedSteps.length) return planCoverageEntries(p);
    const entries = [];
    const push = (value) => {
      const cleaned = String(value || '').split(' (')[0].trim();
      if (cleaned && !entries.includes(cleaned)) entries.push(cleaned);
    };
    for (const step of matchedSteps) {
      for (const f of (Array.isArray(step.files_touched) ? step.files_touched : [])) push(f);
    }
    return entries;
  }

  const review = latestDistinctReview(marker);
  let grade = 'ungraded';
  let gradeBasis = 'no-distinct-review';
  let gradedBy = null;
  let distinctReview = null;
  let bindingBasis = null;
  let rejectionReason = null;
  if (review) {
    distinctReview = {
      reviewer_actor: review.actor || null,
      reviewer_harness: review.harness || null,
      artifact: review.artifact || null,
      verdict: review.verdict || null,
      at: review.at || null
    };
    if (!isDistinctReviewer(producerActor, review.actor)) {
      gradeBasis = 'reviewer-identity-unresolved';
    } else {
      const classified = classifyVerdict(review.verdict, activeSchema);
      if (classified === 'ungraded') {
        gradeBasis = 'verdict-classification';
      } else {
        // Schema 1.1: work-unit binding required for grade-bearing entries.
        const binding = deriveWorkUnitBinding(review, workUnit, activeWorkUnitCompletedAt, activeRoot);
        bindingBasis = binding.binding_basis;
        rejectionReason = binding.rejection_reason;
        if (binding.rejection_reason) {
          // Fail-closed: downgrade to ungraded with rejection_reason recorded.
          // rejection_reason values: 'stale-pre-execution-review' | 'no-work-unit-binding' |
          //   'binding-too-weak-declared-only' (W3: work-unit-declared is never grade-bearing)
          gradeBasis = binding.rejection_reason;
        } else {
          grade = classified;
          gradeBasis = 'verdict-classification';
          gradedBy = review.actor;
          if (review.artifact) evidenceRefs.push(review.artifact);
        }
      }
    }
  }

  const entryId = crypto
    .createHash('sha1')
    .update([planRel, (distinctReview && distinctReview.artifact) || '', (distinctReview && distinctReview.at) || '', workUnit || ''].join('|'))
    .digest('hex')
    .slice(0, 16);

  return {
    entry_id: entryId,
    task_id: plan.task_id || planId,
    plan_artifact: planRel,
    scope_class: deriveScopeClass(plan),
    producer: {
      actor_id: producerActor,
      model: (stamp && stamp.model) || null,
      session_id: sessionId || null,
      stamp_artifact: stampRel
    },
    changed_files: changedFilesForWorkUnit(plan, workUnit),
    evidence_refs: evidenceRefs,
    distinct_review: distinctReview,
    work_unit: workUnit || null,
    review_artifact: (distinctReview && distinctReview.artifact) || null,
    review_at: (distinctReview && distinctReview.at) || null,
    work_unit_completed_at: workUnit ? activeWorkUnitCompletedAt : null,
    binding_basis: bindingBasis,
    rejection_reason: rejectionReason,
    grade,
    grade_basis: gradeBasis,
    graded_by: gradedBy,
    source_artifacts: sourceArtifacts,
    derived_at: new Date().toISOString(),
    derived_by: process.env.MYTHOS_ACTOR_ID || process.env.CLAUDE_MODEL || 'unknown-invoker'
  };
}

// Write-path enforcement (frozen invariant): grade-bearing entries are
// rejected unless reviewer is distinct from producer AND the review artifact
// exists on disk. Returns { ok, reason?, ledger_path?, entry?, skipped? }.
function appendEntry(entry, opts = {}) {
  const root = opts.root || ROOT;
  if (!entry || typeof entry !== 'object' || !entry.plan_artifact) {
    return { ok: false, reason: 'invalid-entry' };
  }

  const gradeBearing = entry.grade === 'clean' || entry.grade === 'failed';
  if (gradeBearing) {
    const producerActor = entry.producer && entry.producer.actor_id;
    const reviewerActor = entry.distinct_review && entry.distinct_review.reviewer_actor;
    if (!isDistinctReviewer(producerActor, reviewerActor)) {
      return {
        ok: false,
        reason: 'self-graded-entry-rejected',
        detail: `grade-bearing entry requires a distinct reviewer: producer=${producerActor || 'unknown'} reviewer=${reviewerActor || 'unknown'}`
      };
    }
    const reviewArtifact = entry.distinct_review && entry.distinct_review.artifact;
    if (!reviewArtifact) {
      return { ok: false, reason: 'grade-without-review-artifact' };
    }
    const abs = path.isAbsolute(reviewArtifact) ? reviewArtifact : path.join(root, reviewArtifact);
    if (!fs.existsSync(abs)) {
      return { ok: false, reason: 'review-artifact-missing-on-disk', detail: reviewArtifact };
    }
  }

  const perimeter = verifyGovernedPerimeter({ rule: opts.rule, rulePath: opts.rulePath });
  const modelKey = safeKey(entry.producer && entry.producer.actor_id);
  const ledgerDir = path.join(root, LEDGER_DIR_REL);
  const ledgerPath = path.join(ledgerDir, `${modelKey}.json`);
  const ledgerRel = `${LEDGER_DIR_REL}/${modelKey}.json`;

  let ledger = readJsonSafe(ledgerPath);
  if (!ledger || ledger.schema !== 'TierTrackRecord/1.0' || !Array.isArray(ledger.entries)) {
    ledger = {
      schema: 'TierTrackRecord/1.0',
      model_key: modelKey,
      model_id: (entry.producer && entry.producer.actor_id) || modelKey,
      governed_perimeter_verified: perimeter.ok,
      entries: []
    };
  }
  ledger.governed_perimeter_verified = perimeter.ok;

  if (ledger.entries.some((e) => e && e.entry_id === entry.entry_id)) {
    return { ok: true, skipped: true, reason: 'duplicate-entry-id', ledger_path: ledgerRel, entry };
  }

  ledger.entries.push(entry);
  if (opts.dryRun) {
    return { ok: true, dry_run: true, ledger_path: ledgerRel, entry, perimeter };
  }
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  return { ok: true, ledger_path: ledgerRel, entry, perimeter };
}

function deriveAndAppend({ planId, sessionId, root, dryRun, workUnit, workUnitCompletedAt } = {}) {
  const entry = deriveEntry({ planId, sessionId, root, workUnit, workUnitCompletedAt });
  return appendEntry(entry, { root, dryRun });
}

module.exports = {
  LEDGER_DIR_REL,
  MUTATION_PLAN_GATE_ADD_ID,
  REVIEW_STATE_DIR_REL,
  ROOT,
  SCHEMA_PATH,
  SESSION_TIER_DIR_REL,
  TASK_OUTCOME_DIR_REL,
  actorSignature,
  appendEntry,
  classifyVerdict,
  deriveAndAppend,
  deriveEntry,
  deriveScopeClass,
  deriveWorkUnitBinding,
  globToRegExp,
  isDistinctReviewer,
  latestDistinctReview,
  loadSchema,
  planCoverageEntries,
  safeKey,
  verifyGovernedPerimeter
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  const planId = flag('--plan');
  if (!planId) {
    console.error('usage: append-ledger-entry.cjs --plan <plan-id> [--session <session-id>] [--root <repo-root>] [--work-unit <id>] [--work-unit-completed-at <iso>] [--dry-run]');
    process.exit(1);
  }
  try {
    const result = deriveAndAppend({
      planId,
      sessionId: flag('--session'),
      root: flag('--root') || ROOT,
      dryRun: args.includes('--dry-run'),
      workUnit: flag('--work-unit'),
      workUnitCompletedAt: flag('--work-unit-completed-at')
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error(`append-ledger-entry: ${err.message}`);
    process.exit(1);
  }
}
