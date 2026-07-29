'use strict';

/**
 * repair-vs-amend-classifier
 *
 * Pure-logic authority-boundary classifier. Given a set of proposed mutations
 * against a base task plan (JSON or MD), routes the mutation to either:
 *   - /repair-plan  (authority mutation — touches immutable fields)
 *   - /amend-plan   (overlay amendment — touches only overlay fields)
 *
 * Authority field set is derived from the parent repair-plan-command-surface
 * amendment (D1) and the repair-plan-implementation contract-propagation
 * amendment (D1-classifier-field-set-alignment).
 *
 * This module is pure: no filesystem I/O, no network, no mutation of inputs.
 */

/**
 * Immutable authority fields. Any proposed mutation to one of these fields
 * on a base plan routes to /repair-plan instead of /amend-plan.
 *
 * Dotted paths use the convention:
 *   - `a.b.c`            — nested object property
 *   - `a.b[].c`          — every element of an array at a.b, property c
 *   - `md:<section>`     — section header in the paired MD handoff file
 *
 * @type {Set<string>}
 */
const AUTHORITY_FIELDS = new Set([
  // Top-level authority fields
  'task_summary',
  'scope_type',
  'non_goals',
  'authority_separation',
  'governance_decision',
  'exact_next_command',
  'validation_confidence',

  // Scope/custody authority fields
  'scope_identity.workstream_scope',
  'scope_identity.session_or_run_id',
  'scope_identity.working_surface',
  'scope_identity.custody_hierarchy',
  'scope_identity.custody_hierarchy.system_id',
  'scope_identity.custody_hierarchy.client_code',
  'scope_identity.custody_hierarchy.project_id',
  'scope_identity.custody_hierarchy.task_id',
  'scope_identity.custody_hierarchy.parent_scope',
  'scope_identity.custody_hierarchy.child_scopes',
  'scope_identity.owned_artifacts',
  'scope_identity.forbidden_artifacts',

  // Bounded-plan authority fields
  'steps[].label',
  'steps[].description',
  'gates',
  'acceptance_criteria',
  'bounded_plan.steps[].description',
  'bounded_plan.required_gates',
  'bounded_plan.expected_outcomes',
  'bounded_plan.risk_notes',

  // Routing-expectations authority fields
  'routing_expectations.risk_tier',
  'routing_expectations.review_lane',
  'routing_expectations.review_lane_rationale',
  'routing_expectations.escalation_triggers',

  // MD-only handoff sections mirroring JSON authority
  'md:Next command',
  'md:Summary',
  'md:Non-goals',
  'md:Authority separation',
  'md:Governance decision',
  'md:Required gates',
  'md:Expected outcomes',
  'md:Risk tier',
  'md:Review lane',
  'md:Escalation triggers',
  'md:Risk notes',
  'md:Validation confidence'
]);

/**
 * Normalize a dotted path with concrete array indices into the generic
 * `[]` form used in AUTHORITY_FIELDS. E.g.:
 *   bounded_plan.steps.0.description  -> bounded_plan.steps[].description
 *   bounded_plan.steps[2].description -> bounded_plan.steps[].description
 *
 * @param {string} dottedPath
 * @returns {string}
 */
function normalizeArrayIndices(dottedPath) {
  if (typeof dottedPath !== 'string' || dottedPath.length === 0) return '';
  // Replace `.N.` or trailing `.N` (digits between dots) with `[].`
  let normalized = dottedPath.replace(/\.\d+(?=\.|$)/g, '[]');
  // Replace explicit `[N]` (bracketed index) with `[]`
  normalized = normalized.replace(/\[\d+\]/g, '[]');
  // Fix up cases like `a[].b` vs `a.[].b` — after step 1 we may have produced
  // `a[].b` already (good) or from explicit brackets `a[].b` (also good).
  // Normalize any `.[]` to `[]`
  normalized = normalized.replace(/\.\[\]/g, '[]');
  return normalized;
}

/**
 * Is the given dotted path an authority field?
 *
 * Rules:
 *   - JSON paths: normalize array indices, then direct Set membership.
 *   - MD paths (`md:<section>`): case-insensitive section match.
 *
 * @param {string} dottedPath
 * @returns {boolean}
 */
function isAuthorityField(dottedPath) {
  if (typeof dottedPath !== 'string' || dottedPath.length === 0) return false;

  if (dottedPath.startsWith('md:')) {
    const section = dottedPath.slice(3).trim().toLowerCase();
    for (const field of AUTHORITY_FIELDS) {
      if (!field.startsWith('md:')) continue;
      const candidate = field.slice(3).trim().toLowerCase();
      if (candidate === section) return true;
    }
    return false;
  }

  const normalized = normalizeArrayIndices(dottedPath);
  return AUTHORITY_FIELDS.has(normalized);
}

/**
 * Classify a proposed-mutation set as /repair-plan (authority) or
 * /amend-plan (overlay).
 *
 * Input shape:
 *   {
 *     file_type:        'json' | 'md',
 *     target_plan_path: string,
 *     mutations: [
 *       { dotted_path: string, operation: 'add' | 'update' | 'remove' }
 *     ]
 *   }
 *
 * Output shape:
 *   {
 *     route:                  'repair' | 'amend' | 'none',
 *     matchedAuthorityFields: Array<string>,
 *     reason:                 string
 *   }
 *
 * Rules:
 *   - empty mutations array -> 'none'
 *   - any mutation touching an authority field -> 'repair'
 *   - otherwise -> 'amend'
 *
 * @param {{ file_type?: string, target_plan_path?: string, mutations?: Array<{dotted_path: string, operation: string}> }} proposedChanges
 * @returns {{ route: 'repair'|'amend'|'none', matchedAuthorityFields: Array<string>, reason: string }}
 */
function classifyMutation(proposedChanges) {
  const mutations =
    proposedChanges && Array.isArray(proposedChanges.mutations)
      ? proposedChanges.mutations
      : [];

  if (mutations.length === 0) {
    return {
      route: 'none',
      matchedAuthorityFields: [],
      reason: 'no mutations proposed'
    };
  }

  const matched = [];
  for (const mutation of mutations) {
    if (!mutation || typeof mutation !== 'object') continue;
    const dottedPath = mutation.dotted_path;
    if (typeof dottedPath !== 'string' || dottedPath.length === 0) continue;
    if (isAuthorityField(dottedPath)) {
      matched.push(dottedPath);
    }
  }

  if (matched.length > 0) {
    return {
      route: 'repair',
      matchedAuthorityFields: matched,
      reason: 'proposed mutation touches immutable authority field(s)'
    };
  }

  return {
    route: 'amend',
    matchedAuthorityFields: [],
    reason: 'no authority fields affected \u2014 overlay amendment'
  };
}

/**
 * Map each PlanAmendment/1.0 divergence `type` to whether it touches an
 * executable authority field. /amend-plan writes an OVERLAY companion and does
 * NOT mutate the base plan; /run-plan executes the base `bounded_plan`. So a
 * divergence that changes executable authority (steps, gates, risk tier,
 * acceptance criteria) is NOT honored by an overlay and needs /repair-plan.
 *
 * `scope_exceeded` is special: amend-plan.yaml says it is too large to amend at
 * all and must become a new bounded plan via /plan-task.
 *
 * Overlay-ok types (`step_blocked`, `assumption_changed`) record changed truth
 * without rewriting the executable contract; they are kept advisory-silent to
 * avoid over-firing. If such a divergence is paired with an actual authority
 * change, that change carries its own authority-touching divergence entry.
 *
 * @type {Record<string, { authority: boolean, field: string|null, route?: 'plan-task' }>}
 */
const DIVERGENCE_TYPE_AUTHORITY_MAP = {
  gate_changed: { authority: true, field: 'bounded_plan.required_gates' },
  risk_changed: { authority: true, field: 'routing_expectations.risk_tier/review_lane' },
  step_split: { authority: true, field: 'bounded_plan.steps' },
  step_reordered: { authority: true, field: 'bounded_plan.steps' },
  output_changed: { authority: true, field: 'acceptance_criteria' },
  scope_exceeded: { authority: true, field: null, route: 'plan-task' },
  step_blocked: { authority: false, field: null },
  assumption_changed: { authority: false, field: null }
};

/**
 * Classify a PlanAmendment/1.0 divergence set as to whether the amendment can
 * stand as an overlay or whether its changes must be folded into base authority
 * via /repair-plan (or escalated to /plan-task when scope is exceeded).
 *
 * Pure: no filesystem or network I/O, no mutation of inputs.
 *
 * @param {Array<{ id?: string, type?: string, step_id?: string }>} divergences
 * @returns {{
 *   authority_touching: Array<{ id: string, type: string, field: string|null, route?: 'plan-task' }>,
 *   overlay_only: Array<{ id: string, type: string }>,
 *   route_recommendation: 'amend' | 'repair' | 'plan-task',
 *   reasons: Array<string>
 * }}
 */
function classifyAmendmentDivergences(divergences) {
  const list = Array.isArray(divergences) ? divergences : [];
  const authority_touching = [];
  const overlay_only = [];
  const reasons = [];
  let sawScopeExceeded = false;

  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const type = typeof d.type === 'string' ? d.type : '';
    const id = String(d.id || d.step_id || type || '(unknown)');
    const entry = DIVERGENCE_TYPE_AUTHORITY_MAP[type];

    if (entry && entry.route === 'plan-task') {
      sawScopeExceeded = true;
      authority_touching.push({ id, type, field: entry.field, route: 'plan-task' });
      reasons.push(
        `${id} (${type}) exceeds amendment scope \u2014 author a new bounded plan via /plan-task`
      );
      continue;
    }
    if (entry && entry.authority) {
      authority_touching.push({ id, type, field: entry.field });
      reasons.push(
        `${id} (${type}) changes ${entry.field} \u2014 /run-plan executes the base bounded_plan, so an overlay amendment is not honored; fold it in via /repair-plan`
      );
      continue;
    }
    // Unknown types are treated as overlay-ok (advisory-silent) to avoid
    // over-firing; the guard is non-blocking by contract.
    overlay_only.push({ id, type: type || '(unknown)' });
  }

  let route_recommendation = 'amend';
  if (sawScopeExceeded) route_recommendation = 'plan-task';
  else if (authority_touching.length > 0) route_recommendation = 'repair';

  return { authority_touching, overlay_only, route_recommendation, reasons };
}

module.exports = {
  AUTHORITY_FIELDS,
  DIVERGENCE_TYPE_AUTHORITY_MAP,
  classifyMutation,
  classifyAmendmentDivergences,
  isAuthorityField
};
