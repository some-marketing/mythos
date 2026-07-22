'use strict';

/**
 * plan-dart-projection.js
 *
 * S3 of plan-execution-autonomy-default-perimeter-gate-and-tracking.
 *
 * OBSERVABILITY ONLY. Writes plan and step execution state to Dart so the
 * operator can see which steps auto-run and which require a greenlight pause.
 *
 * DENSITY MODEL (2026-07-14 revision, per convene
 * 20260714T153018Z-dart-control-surface-density): a plan projects as EXACTLY
 * ONE parent Dart card, never per-step subtask cards. Steps and their gate
 * classification (`mythos-gate` vs `mythos-auto-run`) render as a structured
 * markdown checklist inside the parent card's description. `syncStepStatus`
 * posts a timestamped `[System] ...` comment on the parent instead of writing
 * a subtask's status. A plan tagged/flagged `deferred` (see `isPlanDeferred`)
 * projects the SAME single parent card, tagged `mythos-deferred`, with a
 * compact step inventory — still zero child cards. The plan artifact on disk
 * remains the durable full audit trail; Dart projection was never it.
 *
 * CRITICAL INVARIANT: Projection is observability; authority is the GREENLIGHT
 * proof (operator-approval-verify.js). A Dart status move NEVER authorizes
 * execution. This module exports NO function that reads a Dart status and
 * returns an authorization or execution decision. Any attempt to add such a
 * function here is a security boundary violation.
 *
 * PUBLIC API
 *   projectPlanToDart(planJson, {dart, dartboard})
 *     -> Promise<{parentId: string, subtaskIds: string[]}>
 *     `subtaskIds` is retained in the return shape for caller compatibility
 *     (older callers may still destructure it) but is ALWAYS an empty array —
 *     no child cards are ever created. Callers needing to check for a HALT
 *     interrupt should read `parentId` (see auto-run-kill-switch.js).
 *
 *   syncStepStatus({dart, parentId, step, decision, status, now?})
 *     status: 'queued' | 'running' | 'done' | 'blocked'
 *     Posts a timestamped `[System] <ts> Step <id> (<decision>) -> <DartStatus>`
 *     comment on the parent card. -> Promise<Object|null>
 *
 * All dart-api methods are injected via the `dart` argument so tests can
 * mock them without live Dart calls.
 */

// Fail-closed stub — see lib/perimeter-classifier-stub.js for why: the
// private source's full per-step classifier lives in a kernel/ scaffold not
// included in this port. Every step gates until you port your own classifier.
const { classifyPlan } = require('./perimeter-classifier-stub');

// ---------------------------------------------------------------------------
// Lifecycle → Dart status mapping (write direction only: runner → Dart).
// This table drives observability writes. It NEVER flows in reverse
// (Dart status → execution authorization).
// ---------------------------------------------------------------------------
const LIFECYCLE_TO_DART_STATUS = Object.freeze({
  queued:  'To-do',
  running: 'Doing',
  done:    'Done',
  blocked: 'Blocked',
});

// ---------------------------------------------------------------------------
// Plan shape helpers — shared with the classifier (tolerant of the three
// canonical plan shapes).
// ---------------------------------------------------------------------------

function extractSteps(planJson) {
  if (planJson && planJson.bounded_plan && Array.isArray(planJson.bounded_plan.steps)) {
    return planJson.bounded_plan.steps;
  }
  if (planJson && Array.isArray(planJson.steps)) return planJson.steps;
  if (planJson && planJson.plan && Array.isArray(planJson.plan.steps)) return planJson.plan.steps;
  return [];
}

/**
 * The stable plan identity used by the parent Mythos-Plan-Ref. Never a
 * timestamp/UUID — must be reproducible so a re-projection of the same plan
 * matches its existing parent task.
 */
function planRefId(planJson) {
  return (planJson.task_id) || (planJson.id) || (planJson.title) || 'unknown-plan';
}

/**
 * Build a stable Mythos-Plan-Ref string for this plan artifact. Used as a
 * machine-readable idempotency marker embedded in the parent task description.
 * Stable across re-projections of the same plan — never use timestamps or UUIDs.
 */
function buildPlanRef(planJson) {
  return 'Mythos-Plan-Ref: ' + planRefId(planJson);
}

/**
 * Tolerant, multi-shape "is this plan deferred?" check. There is no single
 * canonical plan-schema field for this across all plan artifacts observed in
 * the repo, so this checks every shape in use: a top-level `status` /
 * `execution_status` / `lifecycle_status` string equal to 'deferred'
 * (case-insensitive), `routing_metadata.status === 'deferred'`, or a
 * `tags` array containing 'deferred'. Returns false (never fail-closed to
 * deferred) on anything unrecognized — deferred-suppression is a presentation
 * choice, not a safety boundary, so an ambiguous plan defaults to the normal
 * active-plan projection.
 *
 * @param {Object} planJson
 * @returns {boolean}
 */
function isPlanDeferred(planJson) {
  if (!planJson || typeof planJson !== 'object') return false;
  const isDeferredString = (v) => typeof v === 'string' && v.toLowerCase() === 'deferred';

  if (isDeferredString(planJson.status)) return true;
  if (isDeferredString(planJson.execution_status)) return true;
  if (isDeferredString(planJson.lifecycle_status)) return true;
  if (planJson.routing_metadata && isDeferredString(planJson.routing_metadata.status)) return true;
  if (Array.isArray(planJson.tags) && planJson.tags.some((t) => isDeferredString(t))) return true;

  return false;
}

/**
 * Build a checklist-item title for one step. Gate-classified steps get a
 * visible 🔒 prefix so the operator can scan the parent card and know which
 * steps will stop for greenlight.
 */
function buildStepTitle(step, stepClassification) {
  const base = (typeof step.title === 'string' && step.title) ||
               (typeof step.id === 'string' && step.id) ||
               (typeof step.step_id === 'string' && step.step_id) ||
               'Step';
  if (stepClassification.decision === 'gate') {
    return '🔒 ' + base + ' — needs greenlight';
  }
  return base;
}

/**
 * Build one markdown checklist line for a step, including its gate
 * classification tag so the operator can see at a glance which steps auto-run
 * vs require a GREENLIGHT proof, without opening a separate card.
 */
function buildStepChecklistLine(step, stepClassification) {
  const title = buildStepTitle(step, stepClassification);
  const tag = stepClassification.decision === 'gate' ? 'mythos-gate' : 'mythos-auto-run';
  return `- [ ] ${title} \`${tag}\``;
}

/**
 * Build the full step checklist block (density-collapse model): every step
 * classified + rendered as a markdown checklist line, in place of what used
 * to be N sibling subtask cards.
 *
 * @param {Array} rawSteps
 * @param {Object} classification - classifyPlan() result
 * @returns {string[]} lines (including the '## Steps' heading)
 */
function buildStepChecklistLines(rawSteps, classification) {
  const classifiedSteps = (classification && classification.steps) || [];
  const lines = ['## Steps'];
  if (!rawSteps.length) {
    lines.push('_(no steps)_');
    return lines;
  }
  for (let i = 0; i < rawSteps.length; i++) {
    const step = rawSteps[i];
    const stepClassification = classifiedSteps[i] || { decision: 'gate', unknown: true, tripped: [] };
    lines.push(buildStepChecklistLine(step, stepClassification));
  }
  return lines;
}

/**
 * Build the owner-readable parent task description for an ACTIVE plan.
 * Follows the owner-first content shape: plain-language summary first, then
 * classification stats, then the full step checklist, then the machine marker.
 */
function buildParentDescription(planJson, classification, rawSteps) {
  const ownerSummary =
    (planJson.audiences && typeof planJson.audiences.owner === 'string' && planJson.audiences.owner) ||
    (typeof planJson.description === 'string' && planJson.description) ||
    (typeof planJson.task_summary === 'string' && planJson.task_summary) ||
    `Plan "${planJson.title || 'Untitled'}" — projection ready.`;

  const steps = classification.steps || [];
  const gateCount = steps.filter((s) => s.decision === 'gate').length;
  const autoCount = steps.filter((s) => s.decision === 'auto-run').length;
  const unknownCount = steps.filter((s) => s.unknown).length;

  const planRef = buildPlanRef(planJson);
  const stepList = Array.isArray(rawSteps) ? rawSteps : extractSteps(planJson);

  return [
    '## Summary',
    ownerSummary,
    '',
    '## Step Classification',
    `${autoCount} step(s) will auto-run · ${gateCount} step(s) require operator greenlight (🔒)` +
      (unknownCount ? ` · ${unknownCount} step(s) unclassified (fail-closed → gate)` : ''),
    '',
    ...buildStepChecklistLines(stepList, classification),
    '',
    '## Desired State',
    'All steps complete. Gated steps have a GREENLIGHT proof recorded before execution.',
    '',
    '> Projection only. Dart status on this card is observability.',
    '> Execution authority comes from the GREENLIGHT proof (operator-approval-verify.js).',
    '',
    planRef,
  ].join('\n');
}

/**
 * Build the parent task description for a DEFERRED plan: a compact step
 * inventory only (no checklist detail, no per-step gate breakdown noise) —
 * zero child cards are ever created for a deferred plan. The plan file on
 * disk remains the full durable record.
 */
function buildDeferredParentDescription(planJson, classification, rawSteps) {
  const ownerSummary =
    (planJson.audiences && typeof planJson.audiences.owner === 'string' && planJson.audiences.owner) ||
    (typeof planJson.description === 'string' && planJson.description) ||
    (typeof planJson.task_summary === 'string' && planJson.task_summary) ||
    `Plan "${planJson.title || 'Untitled'}" — deferred.`;

  const planRef = buildPlanRef(planJson);
  const stepList = Array.isArray(rawSteps) ? rawSteps : extractSteps(planJson);

  const inventoryLines = stepList.length
    ? stepList.map((step, i) => {
        const label = (typeof step.title === 'string' && step.title) ||
                      (typeof step.id === 'string' && step.id) ||
                      (typeof step.step_id === 'string' && step.step_id) ||
                      ('Step ' + (i + 1));
        return `- ${label}`;
      })
    : ['_(no steps)_'];

  return [
    '## Summary',
    ownerSummary,
    '',
    '## Status',
    'DEFERRED — no active execution. This card intentionally has no child cards; ' +
      'the compact step inventory below is for reference only.',
    '',
    `## Step Inventory (${stepList.length})`,
    ...inventoryLines,
    '',
    planRef,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

// Page size per listTasks call and a hard safety cap on how many pages this
// function will scan per is_completed bucket. The cap exists only to bound
// worst-case cost against a runaway/misbehaving board — it is NOT meant to be
// hit in ordinary operation, unlike the old fixed single-page (100) window
// this replaces.
const FIND_EXISTING_PARENT_PAGE_SIZE = 100;
const FIND_EXISTING_PARENT_MAX_PAGES = 20; // up to 2000 tasks scanned per bucket

/**
 * Extract the exact value of a `Mythos-Plan-Ref: <value>` marker line from a
 * block of text (a task description, or the standalone marker string this
 * module builds via buildPlanRef). Returns the trimmed value, or null if no
 * such line is present.
 *
 * This exists because `String#includes` substring matching on the RAW marker
 * text is unsound: `Mythos-Plan-Ref: plan-1` is a substring of
 * `Mythos-Plan-Ref: plan-10`, so a naive `.includes(planRef)` check on plan-1's
 * marker would incorrectly match plan-10's card. Parsing the marker LINE and
 * comparing the extracted VALUE for exact equality removes that prefix-
 * collision risk entirely.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractPlanRefValue(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/^Mythos-Plan-Ref:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Look for an existing parent task. Matches on the machine-readable
 * Mythos-Plan-Ref marker embedded in a task's description FIRST (stable across
 * title edits/renames), comparing the EXACT extracted marker value (never a
 * substring/`includes` check — see extractPlanRefValue) so `plan-1` can never
 * match `plan-10`. Falls back to a deterministic title match only when no
 * marker match is found.
 *
 * Checks both active and completed tasks, and within each bucket PAGINATES
 * through every page of results (up to a bounded safety cap) rather than
 * inspecting only a fixed first-page window — an existing parent sitting
 * beyond the first 100 results is no longer silently missed (which previously
 * caused a duplicate parent to be created, defeating the idempotency goal).
 *
 * CAP EXHAUSTION (round-2 repair, MAJOR 2; tightened round-3 repair, MAJOR 1):
 * if a bucket's scan is stopped by `FIND_EXISTING_PARENT_MAX_PAGES` WITHOUT
 * the bucket ever returning a short page (i.e. there may be MORE tasks beyond
 * the cap we never inspected) and NO marker match was found anywhere
 * scanned, the scan is genuinely INCONCLUSIVE — a true marker-matched parent
 * may be sitting past the cap. Silently returning a title candidate (or null)
 * in that case would let the caller trust an unauthoritative fallback or fall
 * through to `createTask`, either of which risks acting against the WRONG
 * task, the exact defect shape this function exists to prevent. This
 * function instead returns a structured `{indeterminate: true, reason}`
 * result (see `isIndeterminateExistingParent`) so the caller can refuse
 * rather than guess.
 *
 * A title candidate is honored as a fallback ONLY when BOTH buckets are
 * proven exhausted (every page in both buckets returned short, i.e. neither
 * bucket hit the cap) without a marker match — that is the only condition
 * under which the marker-first search has actually completed. Merely having
 * SEEN a title candidate along the way does NOT make an incomplete scan
 * determinate: marker-match is supposed to be checked before title-match is
 * ever trusted, and a capped bucket means that check never finished.
 *
 * READ FAILURE: a failed page read makes the lookup inconclusive. The caller
 * must refuse to create or update a card because it cannot prove whether the
 * governing parent already exists. Projection is observability-only, so a
 * caller may continue its underlying run, but it must not manufacture a
 * duplicate Dart control-surface card while the read surface is unavailable.
 *
 * @param {Object} dart - injected dart-api (listTasks method required)
 * @param {string} dartboard
 * @param {{title?: string, planRef?: string}} match
 * @returns {Promise<{id:string, title:string}|{indeterminate:true, reason:string}|null>}
 */
async function findExistingParent(dart, dartboard, { title, planRef } = {}) {
  if (!title && !planRef) return null;

  const targetPlanRefValue = planRef ? extractPlanRefValue(planRef) : null;

  let markerCandidate = null;
  let titleCandidate = null;
  let anyBucketCapExhausted = false;

  for (const isCompleted of [false, true]) {
    let offset = 0;
    let bucketConfirmedExhausted = false;
    for (let page = 0; page < FIND_EXISTING_PARENT_MAX_PAGES; page++) {
      let res;
      try {
        res = await dart.listTasks(dartboard, {
          is_completed: isCompleted,
          limit: FIND_EXISTING_PARENT_PAGE_SIZE,
          offset,
        });
      } catch (_) {
        return {
          indeterminate: true,
          reason: 'find-existing-parent-read-failed',
        };
      }
      const tasks = (res && res.results) ? res.results : (Array.isArray(res) ? res : []);

      if (!markerCandidate && targetPlanRefValue) {
        const m = tasks.find((t) => {
          if (!t || typeof t.description !== 'string') return false;
          const candidateValue = extractPlanRefValue(t.description);
          return candidateValue !== null && candidateValue === targetPlanRefValue;
        });
        if (m && m.id) markerCandidate = m;
      }
      if (!titleCandidate && title) {
        const t = tasks.find((x) => x && x.title === title);
        if (t && t.id) titleCandidate = t;
      }

      // Marker match found — it takes precedence over title, no need to keep scanning.
      if (markerCandidate) break;

      // A short page (fewer results than requested) means this bucket is
      // exhausted; stop paginating it. This is the ONLY way a bucket proves
      // it has no more pages — reaching the page-count cap while the last
      // page was still full-size does NOT prove exhaustion.
      if (tasks.length < FIND_EXISTING_PARENT_PAGE_SIZE) {
        bucketConfirmedExhausted = true;
        break;
      }

      offset += FIND_EXISTING_PARENT_PAGE_SIZE;
    }

    if (markerCandidate) break;
    if (!bucketConfirmedExhausted) anyBucketCapExhausted = true;
  }

  if (markerCandidate) return markerCandidate;

  // Round-3 repair (MAJOR 1): refuse whenever either bucket hit the page cap
  // before proving itself exhausted and no marker match was found — even if
  // a title candidate WAS seen along the way. A capped bucket means the
  // marker-first search never completed, so a true marker-matched parent
  // could still exist beyond the scanned window; trusting a title candidate
  // in that state would risk updating the wrong Dart task. Title fallback is
  // only safe once BOTH buckets are confirmed exhausted (not capped).
  if (anyBucketCapExhausted) {
    return {
      indeterminate: true,
      reason: 'find-existing-parent-cap-exhausted-before-exhaustive-scan',
    };
  }

  return titleCandidate || null;
}

/**
 * True iff a `findExistingParent()` result is the structured INDETERMINATE
 * shape (round-2 repair, MAJOR 2) rather than a resolved candidate or a
 * fail-open `null`. Callers MUST treat this as fail-CLOSED: do not proceed to
 * `createTask` (which would risk creating a duplicate parent for a plan whose
 * existing parent may be sitting past the pagination safety cap).
 * @param {*} result
 * @returns {boolean}
 */
function isIndeterminateExistingParent(result) {
  return !!(result && typeof result === 'object' && result.indeterminate === true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * projectPlanToDart — project a plan artifact into Dart as ONE PARENT task
 * (owner-readable plan summary + step checklist). NEVER creates per-step
 * subtask cards (density-collapse model, 2026-07-14).
 *
 * Idempotent on the PARENT: matched first by the machine-readable
 * Mythos-Plan-Ref marker (stable across title edits), falling back to a
 * deterministic title match. Re-projecting the same plan therefore UPDATES
 * the existing parent rather than duplicating it — important because the
 * runner re-projects on every status change.
 *
 * DEFERRED PLANS (see isPlanDeferred): project the SAME single parent card,
 * tagged `mythos-deferred`, with a compact step inventory instead of the full
 * checklist. Zero child cards either way.
 *
 * All dart-api methods (createTask, updateTask, listTasks) are injected via
 * the `dart` argument so callers can mock without live Dart network access.
 *
 * @param {Object} planJson - the Mythos plan artifact
 * @param {{dart: Object, dartboard: string}} opts
 * @returns {Promise<{parentId: string, subtaskIds: string[]}>} subtaskIds is
 *   always [] — retained for caller-shape compatibility only.
 */
async function projectPlanToDart(planJson, { dart, dartboard }) {
  // Classify every step via S1 classifier (fail-closed).
  const classification = classifyPlan(planJson);
  const rawSteps = extractSteps(planJson);

  const parentTitle = planJson.title || planJson.task_id || 'Mythos Plan';
  const planRef = buildPlanRef(planJson);
  const deferred = isPlanDeferred(planJson);

  const parentDescription = deferred
    ? buildDeferredParentDescription(planJson, classification, rawSteps)
    : buildParentDescription(planJson, classification, rawSteps);

  const parentTags = deferred
    ? ['mythos-plan', 'mythos-projection', 'mythos-deferred']
    : ['mythos-plan', 'mythos-projection'];

  // ── Idempotent parent: marker-first, then title, else create ─────────────
  let parentId = null;
  const existing = await findExistingParent(dart, dartboard, { title: parentTitle, planRef });

  // FAIL CLOSED (round-2 repair, MAJOR 2): the existing-parent scan hit its
  // pagination safety cap without ever proving the marker/title truly do not
  // exist beyond the cap. Creating here would risk a duplicate parent for a
  // plan whose real parent is sitting past the scanned window — refuse
  // instead of guessing. No Dart write happens on this path at all.
  if (isIndeterminateExistingParent(existing)) {
    throw new Error(
      'projectPlanToDart: existing-parent lookup was inconclusive for plan "' + parentTitle + '" ' +
      '(reason=' + existing.reason + ') — an exhaustive scan did not confirm whether an existing parent is present. ' +
      'Refusing to create or update a possibly-duplicate parent task. Investigate Dart read availability or, for ' +
      'cap exhaustion, the dartboard task volume and FIND_EXISTING_PARENT_MAX_PAGES.'
    );
  }

  if (existing) {
    parentId = existing.id;
    await dart.updateTask(parentId, {
      id: parentId,
      title: parentTitle,
      description: parentDescription,
      tags: parentTags,
    });
  } else {
    const created = await dart.createTask({
      title: parentTitle,
      dartboard,
      status: 'To-do',
      description: parentDescription,
      tags: parentTags,
    });
    parentId = created && created.item && created.item.id;
  }

  // Density collapse: no per-step subtask cards are ever created, for active
  // OR deferred plans. subtaskIds is always empty; kept in the return shape
  // only so existing callers that destructure it do not throw.
  return { parentId, subtaskIds: [] };
}

/**
 * Build the `[System] <ts> Step <id> (<decision>) -> <DartStatus>` comment
 * label for one step. `decision` ('gate' | 'auto-run') is optional — when
 * omitted the classification suffix is dropped.
 */
function buildStepCommentLabel(step, decision) {
  const id = (step && typeof step === 'object' && (step.step_id || step.id)) || 'unknown';
  const base = 'Step ' + id;
  return decision ? base + ' (' + decision + ')' : base;
}

/**
 * syncStepStatus — map a runner lifecycle event to a timestamped Dart COMMENT
 * on the plan's single parent card (density-collapse model, 2026-07-14).
 * Replaces the old per-subtask status write: there is no subtask anymore, so
 * this posts `[System] <ts> Step <id> (<decision>) -> <DartStatus>` on the
 * parent instead.
 *
 * This is WRITE-ONLY observability. The return value is the raw Dart
 * addComment response. Callers MUST NOT use it to make an execution
 * authorization decision.
 *
 * Lifecycle statuses:
 *   queued  → 'To-do'
 *   running → 'Doing'
 *   done    → 'Done'
 *   blocked → 'Blocked'
 *
 * @param {{dart: Object, parentId: string, step?: Object, decision?: string,
 *          status: string, now?: () => string}} opts
 *   `now` is injectable for deterministic tests; defaults to
 *   `() => new Date().toISOString()`.
 * @returns {Promise<Object|null>}
 */
async function syncStepStatus({ dart, parentId, step, decision, status, now }) {
  const dartStatus = LIFECYCLE_TO_DART_STATUS[status];
  if (!dartStatus) {
    throw new Error(
      'syncStepStatus: unknown lifecycle status "' + status + '". ' +
      'Expected one of: ' + Object.keys(LIFECYCLE_TO_DART_STATUS).join(', ') + '.'
    );
  }
  if (!parentId) {
    throw new Error('syncStepStatus: parentId is required (comments post to the single parent card).');
  }
  const timestamp = typeof now === 'function' ? now() : new Date().toISOString();
  const label = buildStepCommentLabel(step, decision);
  const text = `[System] ${timestamp} ${label} -> ${dartStatus}`;
  return dart.addComment(parentId, text);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Primary API
  projectPlanToDart,
  syncStepStatus,
  // Exported constants
  LIFECYCLE_TO_DART_STATUS,
  // Internal helpers exported for white-box unit tests
  planRefId,
  buildPlanRef,
  isPlanDeferred,
  buildParentDescription,
  buildDeferredParentDescription,
  buildStepTitle,
  buildStepChecklistLine,
  buildStepChecklistLines,
  buildStepCommentLabel,
  extractSteps,
  findExistingParent,
  isIndeterminateExistingParent,
  extractPlanRefValue,
  FIND_EXISTING_PARENT_MAX_PAGES,
  FIND_EXISTING_PARENT_PAGE_SIZE,
};
