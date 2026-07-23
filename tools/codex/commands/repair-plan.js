'use strict';

/**
 * /repair-plan — managed runtime handler
 *
 * Canonical source: instructions/canonical/commands/repair-plan.yaml
 *
 * Responsibility:
 *   Repair defective plan artifacts with full provenance via an atomic
 *   paired JSON+MD authority-field mutation plus a sibling PlanRepair/1.0
 *   manifest. Distinct from /amend-plan (overlay-only).
 *
 * Authority boundary: only mutates immutable authority fields as enumerated
 * in tools/planning/lib/repair-vs-amend-classifier.js AUTHORITY_FIELDS.
 * Overlay-only changes are refused and routed to /amend-plan.
 *
 * Idempotency: the review-before-run state marker at
 * `_dev/state/plan-task-review-state/<task-id>.json` carries
 * post_repair.review_status. A second invocation against an
 * already-pending-review plan is refused unless a new, distinct
 * review_reference is supplied.
 *
 * Error taxonomy (all returned as exitCode=2 with a tagged stdout line):
 *   - plan-resolution-failure
 *   - authority-boundary-violation
 *   - paired-artifact-violation
 *   - paired-content-propagation-violation
 *   - governing-amendment-coverage-violation
 *   - missing-review-reference
 *   - invalid-review-reference
 *   - blocking-operator-gate
 *   - already-pending-review
 *
 * Dependency surface (repo modules): crypto (stdlib), fs/path (stdlib),
 *   tools/planning/lib/resolve-task-plan (resolveTaskPlanPaths,
 *   listAmendments, resolveOperatorGates),
 *   tools/planning/lib/repair-vs-amend-classifier (classifyMutation),
 *   and the local _shared helpers (readJsonSafe, writeText, rel,
 *   parseFlagArgs, ensureDir, formatIsoForFile).
 */

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  listAmendments,
  resolveOperatorGates,
  resolveTaskPlanPaths
} = require('../../planning/lib/resolve-task-plan');

const { classifyMutation } = require('../../planning/lib/repair-vs-amend-classifier');

const { resolveStateMarkerPath } = require('../../planning/lib/plan-review-state');

const {
  ensureDir,
  formatIsoForFile,
  parseFlagArgs,
  readJsonSafe,
  rel,
  writeText
} = require('./_shared');

/**
 * SHA-256 hex digest of the bytes of a file on disk.
 * @param {string} filePath
 * @returns {string} hex digest
 */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Canonical ISO 8601 timestamp with tz suffix.
 * We use the UTC "Z" form rendered as "+0000" for consistency with sibling
 * manifest conventions in Mythos.
 * @param {Date} [date]
 */
function canonicalTimestamp(date = new Date()) {
  return date.toISOString().replace('Z', '+0000');
}

/**
 * Review-before-run state marker path for a given task-id.
 *
 * Thin wrapper over shared resolveStateMarkerPath() from plan-review-state.
 * When `clientCode` is provided (client-scoped plans), the marker lands under
 * `clients/<CODE>/state/plan-task-review-state/<task-id>.json`; otherwise the
 * system-scope path under `_dev/state/plan-task-review-state/` is used. This
 * keeps the handler's scope resolution aligned with /run-plan and
 * /review-task-plan consumers, closing the client-scope bypass MAJOR.
 *
 * @param {string} projectRoot
 * @param {string} taskId
 * @param {{ clientCode?: string|null }} [opts]
 * @returns {string} absolute path
 */
function stateMarkerPath(projectRoot, taskId, opts) {
  const clientCode = opts && opts.clientCode ? opts.clientCode : undefined;
  return resolveStateMarkerPath(projectRoot, taskId, { clientCode });
}

/**
 * Tag and return a standard error result.
 * @param {string} code - taxonomy code
 * @param {string} message
 * @param {Array<string>} [outputs]
 */
function fail(code, message, outputs = []) {
  return {
    exitCode: 2,
    stdout: `[${code}] ${message}`,
    stderr: '',
    outputs
  };
}

/**
 * Emit the paired manifest MD for a PlanRepair/1.0 record.
 * @param {object} manifest
 * @returns {string}
 */
function renderManifestMarkdown(manifest) {
  const fieldsJson = Array.isArray(manifest.fields_touched_json)
    ? manifest.fields_touched_json
    : [];
  const fieldsMd = Array.isArray(manifest.fields_touched_md)
    ? manifest.fields_touched_md
    : [];

  const lines = [];
  lines.push(`# Plan Repair Manifest — ${manifest.repair_id}`);
  lines.push('');
  lines.push('## Repair metadata');
  lines.push(`- schema: ${manifest.schema}`);
  lines.push(`- schema_version: ${manifest.schema_version}`);
  lines.push(`- repair_id: ${manifest.repair_id}`);
  lines.push(`- plan_id: ${manifest.plan_id}`);
  lines.push(`- timestamp: ${manifest.timestamp}`);
  lines.push(`- plan_paths.json: ${manifest.plan_paths.json}`);
  lines.push(`- plan_paths.md: ${manifest.plan_paths.md}`);
  lines.push(`- produced_by_harness_id: ${manifest.produced_by_harness_id}`);
  lines.push('');
  lines.push('## Fields touched (JSON)');
  if (fieldsJson.length === 0) {
    lines.push('- (none)');
  } else {
    for (const f of fieldsJson) lines.push(`- ${f}`);
  }
  lines.push('');
  lines.push('## Fields touched (MD)');
  if (fieldsMd.length === 0) {
    lines.push('- (none)');
  } else {
    for (const f of fieldsMd) lines.push(`- ${f}`);
  }
  lines.push('');
  lines.push('## Hash pairs');
  lines.push(`- pre_repair.json:  ${manifest.pre_repair_hashes.json}`);
  lines.push(`- pre_repair.md:    ${manifest.pre_repair_hashes.md}`);
  lines.push(`- post_repair.json: ${manifest.post_repair_hashes.json}`);
  lines.push(`- post_repair.md:   ${manifest.post_repair_hashes.md}`);
  lines.push('');
  lines.push('## Reason');
  lines.push(manifest.reason || '(no reason supplied)');
  lines.push('');
  lines.push('## Review reference');
  lines.push(manifest.review_reference);
  lines.push('');
  lines.push('## Author actor');
  lines.push(`- actor_id: ${manifest.author_actor.actor_id}`);
  lines.push(`- actor_type: ${manifest.author_actor.actor_type}`);
  lines.push('');
  if (manifest.validator_status) {
    const vs = manifest.validator_status;
    lines.push('## Validator status');
    lines.push(`- ok: ${vs.ok}`);
    if (typeof vs.exit_code !== 'undefined') {
      lines.push(`- exit_code: ${vs.exit_code}`);
    }
    if (vs.ran_at) {
      lines.push(`- ran_at: ${vs.ran_at}`);
    }
    if (vs.error) {
      lines.push(`- error: ${vs.error}`);
    }
    if (vs.output_summary) {
      lines.push('');
      lines.push('```');
      lines.push(vs.output_summary);
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Count numbered list items ("1.", "2.", ...) directly under a heading in MD.
 *
 * Returns -1 if the section heading is not found. Otherwise returns the count
 * of contiguous numbered items in the section body.
 *
 * @param {string} mdText
 * @param {string} heading - exact heading text (no leading '## ')
 * @returns {number}
 */
function countNumberedItemsInSection(mdText, heading) {
  if (typeof mdText !== 'string' || mdText.length === 0) return -1;
  const lines = mdText.split(/\r?\n/);
  const headingRe = new RegExp('^##\\s+' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart < 0) return -1;
  let count = 0;
  for (let i = sectionStart; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    if (/^\s*\d+\.\s+\S/.test(line)) count += 1;
  }
  return count;
}

/**
 * Extract ordered numbered-list items under a `## <heading>` section.
 *
 * Each returned string is the text of one numbered item, starting from the
 * first character AFTER the `N. ` or `N) ` prefix. Continuation lines (lines
 * that are neither a new numbered item nor a new `## ` heading) are appended
 * to the current item's text separated by a single newline. Surrounding
 * whitespace is trimmed on the returned items.
 *
 * Returns `null` if the section heading is not present in `mdText`.
 *
 * @param {string} mdText
 * @param {string} sectionHeading - exact heading text (no leading '## ')
 * @returns {string[] | null}
 */
function extractOrderedItemsFromSection(mdText, sectionHeading) {
  if (typeof mdText !== 'string' || mdText.length === 0) return null;
  const lines = mdText.split(/\r?\n/);
  const headingRe = new RegExp(
    '^##\\s+' + sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$',
    'i'
  );
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart < 0) return null;

  const items = [];
  let current = null;
  const numberedRe = /^\s*\d+[.)]\s+(.*)$/;
  for (let i = sectionStart; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    const m = line.match(numberedRe);
    if (m) {
      if (current !== null) items.push(current.trim());
      current = m[1];
    } else if (current !== null) {
      // Continuation line for the current numbered item.
      if (line.trim().length > 0) {
        current += '\n' + line;
      }
    }
    // Blank lines before the first numbered item (or between the heading and
    // the list) are ignored.
  }
  if (current !== null) items.push(current.trim());
  return items;
}

/**
 * Validate that the proposed change set carries paired JSON and MD mutations.
 *
 * The command's atomicity contract is paired-artifact: both surfaces mutate
 * together or neither. A single-sided change is refused.
 *
 * Expected proposedChanges shape:
 *   {
 *     json_mutations: { mutations: [...] },     // classifier input (file_type: 'json')
 *     md_mutations:   { mutations: [...] },     // classifier input (file_type: 'md')
 *     staged: { json: <new plan json>, md: <new plan md string> },
 *     fields_touched_json: [...],
 *     fields_touched_md: [...],
 *     reason: string,
 *     author_actor: { actor_id, actor_type },
 *     produced_by_harness_id: string
 *   }
 *
 * @param {object} proposedChanges
 * @returns {{ ok: boolean, error?: string }}
 */
function validatePairedShape(proposedChanges) {
  if (!proposedChanges || typeof proposedChanges !== 'object') {
    return { ok: false, error: 'proposedChanges payload missing' };
  }
  const staged = proposedChanges.staged || {};
  const hasStagedJson = Object.prototype.hasOwnProperty.call(staged, 'json');
  const hasStagedMd = Object.prototype.hasOwnProperty.call(staged, 'md');
  if (hasStagedJson !== hasStagedMd) {
    return {
      ok: false,
      error:
        'paired-artifact discipline: both JSON and MD must mutate together or neither.'
    };
  }
  if (!hasStagedJson && !hasStagedMd) {
    return { ok: false, error: 'no staged mutations supplied' };
  }
  const jsonMut = (proposedChanges.json_mutations || {}).mutations || [];
  const mdMut = (proposedChanges.md_mutations || {}).mutations || [];
  if ((jsonMut.length > 0) !== (mdMut.length > 0)) {
    // Enforce paired-change discipline: if one side declares field-level
    // mutations, the other must too. Both zero is allowed only if both
    // sides are no-ops, which short-circuits earlier.
    if (jsonMut.length === 0 || mdMut.length === 0) {
      return {
        ok: false,
        error:
          'paired-artifact discipline: both JSON and MD must mutate together or neither.'
      };
    }
  }
  return { ok: true };
}

/**
 * Merge the two per-surface classifier results into a single route.
 *   - if either side is 'repair' and the other is not 'amend', route=repair
 *   - if either side is 'amend' → route=amend (authority-boundary-violation)
 *   - if both sides are 'none' → route=none
 * @param {object} proposedChanges
 */
function classifyPairedMutation(proposedChanges) {
  const jsonInput = proposedChanges.json_mutations || { mutations: [] };
  const mdInput = proposedChanges.md_mutations || { mutations: [] };
  const jsonResult = classifyMutation(jsonInput);
  const mdResult = classifyMutation(mdInput);

  const routes = [jsonResult.route, mdResult.route];
  const hasRepair = routes.includes('repair');
  const hasAmend = routes.includes('amend');

  if (hasRepair && !hasAmend) {
    return {
      route: 'repair',
      matchedAuthorityFields: [
        ...jsonResult.matchedAuthorityFields,
        ...mdResult.matchedAuthorityFields
      ],
      json: jsonResult,
      md: mdResult
    };
  }
  if (hasRepair && hasAmend) {
    // Mixed: the spec forbids mixing overlay + authority in one invocation.
    return {
      route: 'mixed',
      matchedAuthorityFields: [
        ...jsonResult.matchedAuthorityFields,
        ...mdResult.matchedAuthorityFields
      ],
      json: jsonResult,
      md: mdResult
    };
  }
  if (hasAmend) {
    return {
      route: 'amend',
      matchedAuthorityFields: [],
      json: jsonResult,
      md: mdResult
    };
  }
  return {
    route: 'none',
    matchedAuthorityFields: [],
    json: jsonResult,
    md: mdResult
  };
}

/**
 * Core entry point.
 *
 * Contract matches sibling managed commands: returns
 *   { exitCode: number, stdout: string, stderr: string, outputs: string[] }
 *
 * `opts.args`      — positional/flag args from the CLI dispatcher
 * `opts.context`   — optional object carrying `proposedChanges` (see shape
 *                    above). Present when the caller has already staged the
 *                    mutation in memory; absent when the operator invoked
 *                    /repair-plan from the CLI without a staged payload
 *                    (in which case we emit an instructional refusal).
 *
 * @param {string} projectRoot
 * @param {{ args?: string[], context?: object }} [opts]
 */
function runRepairPlanCommand(projectRoot, opts = {}) {
  const args = Array.isArray(opts.args) ? opts.args : [];
  const { flags, positionals } = parseFlagArgs(args);
  const ref = String(positionals[0] || '').trim();

  if (!ref) {
    return fail(
      'plan-resolution-failure',
      'Missing task-plan reference. Provide --exact "/repair-plan <task-id|path>".'
    );
  }

  // Step 1 — resolve plan paths.
  let resolved;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, ref);
  } catch (error) {
    return fail(
      'plan-resolution-failure',
      `Unable to resolve task plan "${ref}".\n${error.message}`
    );
  }
  if (!resolved) {
    return fail('plan-resolution-failure', `Task plan not found: ${ref}`);
  }

  const plan = readJsonSafe(resolved.jsonPath);
  if (!plan) {
    return fail(
      'plan-resolution-failure',
      `Task plan JSON is missing or unreadable: ${rel(projectRoot, resolved.jsonPath)}`
    );
  }

  const taskId = String(plan.task_id || ref).trim();

  // Staged payload must come from the caller. Without one, we cannot
  // actually mutate — surface the contract rather than invent edits.
  const context = opts.context || {};
  const proposedChanges = context.proposedChanges;
  if (!proposedChanges) {
    return fail(
      'plan-resolution-failure',
      [
        `/repair-plan ${taskId}: no staged proposed-changes payload was supplied.`,
        'Managed runtime requires opts.context.proposedChanges with:',
        '  { json_mutations, md_mutations, staged: { json, md },',
        '    fields_touched_json, fields_touched_md, reason, author_actor,',
        '    produced_by_harness_id } plus --review-reference <path>.',
        'Use the /repair-plan skill (Claude-native) or the Codex bridge surface to stage edits before dispatch.'
      ].join('\n')
    );
  }

  // Step 3 — classify via the authority-field classifier.
  const routeResult = classifyPairedMutation(proposedChanges);
  if (routeResult.route === 'amend') {
    return fail(
      'authority-boundary-violation',
      `Proposed changes touch only overlay fields. Route to /amend-plan ${taskId}.`
    );
  }
  if (routeResult.route === 'none') {
    return fail(
      'authority-boundary-violation',
      'Proposed changes are empty — nothing to repair.'
    );
  }
  if (routeResult.route === 'mixed') {
    return fail(
      'authority-boundary-violation',
      `Mixed overlay + authority mutations are forbidden in a single /repair-plan invocation. Split into /amend-plan ${taskId} (overlay) and /repair-plan ${taskId} (authority).`
    );
  }

  // Paired-artifact discipline.
  const pairedCheck = validatePairedShape(proposedChanges);
  if (!pairedCheck.ok) {
    return fail('paired-artifact-violation', pairedCheck.error);
  }

  // review_reference is required at manifest-write time.
  const reviewReference = String(
    flags.review_reference || proposedChanges.review_reference || ''
  ).trim();
  if (!reviewReference) {
    return fail(
      'missing-review-reference',
      'A --review-reference <path> pointing at the /review-task-plan artifact that surfaced the defect is required.'
    );
  }

  // Step 2b — validate review_reference path existence and best-effort
  // task_id content check (scenario-f / Decision B1).
  const resolvedReviewRef = path.isAbsolute(reviewReference)
    ? reviewReference
    : path.resolve(projectRoot, reviewReference);
  let reviewStats;
  try {
    reviewStats = fs.statSync(resolvedReviewRef);
  } catch (_) {
    reviewStats = null;
  }
  if (!reviewStats || !reviewStats.isFile()) {
    return fail(
      'invalid-review-reference',
      `review_reference path does not exist: ${resolvedReviewRef}`
    );
  }
  // Best-effort content check: read first 64KB and look for task_id literal.
  // On read error (permissions/encoding), skip the content check — path
  // existence alone is sufficient to clear the MAJOR.
  try {
    const raw = fs.readFileSync(resolvedReviewRef, 'utf8');
    const slice = raw.length > 65536 ? raw.slice(0, 65536) : raw;
    if (!slice.includes(taskId)) {
      return fail(
        'invalid-review-reference',
        `review_reference does not mention task_id '${taskId}': ${resolvedReviewRef}`
      );
    }
  } catch (_) {
    // Proceed with path-existence-only validation; do not throw on read error.
  }

  // Step 4 — operator-gate fail-fast (parity with /run-plan).
  const active = listAmendments(resolved.storageRoot, taskId);
  const chain = active
    .slice()
    .reverse()
    .map((a) => readJsonSafe(a.jsonPath))
    .filter(Boolean);
  const gateView = resolveOperatorGates(chain);
  if (Array.isArray(gateView.blocking_gates) && gateView.blocking_gates.length > 0) {
    const ids = gateView.blocking_gates.map((g) => g.id || '(unnamed)').join(', ');
    return fail(
      'blocking-operator-gate',
      `Unresolved operator gates block /repair-plan: ${ids}. Resolve via /amend-plan ${taskId} before repairing.`
    );
  }

  // Step 11 — idempotency check (performed here so a pending marker short-
  // circuits before we touch plan files).
  const markerPath = stateMarkerPath(projectRoot, taskId, {
    clientCode: resolved.clientCode || undefined
  });
  const existingMarker = readJsonSafe(markerPath);
  if (
    existingMarker &&
    existingMarker.post_repair &&
    existingMarker.post_repair.review_status === 'pending'
  ) {
    const priorRef = String(existingMarker.post_repair.review_reference || '').trim();
    if (!priorRef || priorRef === reviewReference) {
      return fail(
        'already-pending-review',
        `${taskId}: a prior repair (${existingMarker.post_repair.repair_id}) is pending review. Supply a new --review-reference distinct from "${priorRef}" or run /review-task-plan ${taskId} first.`
      );
    }
  }

  // Governing-amendment authority coverage check (D2).
  // When the caller passes proposedChanges.governing_amendment_coverage, we
  // require every entry in uncovered_authority_paths[] to be matched by a
  // declared_omissions[] record carrying an operator_gate_ref. If absent,
  // soft-warn and proceed (backward compatible until migration).
  const preWriteWarnings = [];
  const govCoverage = proposedChanges.governing_amendment_coverage;
  if (!govCoverage || typeof govCoverage !== 'object') {
    preWriteWarnings.push(
      '[warn] governing-amendment-coverage not declared; future enforcement pending migration'
    );
  } else {
    const uncovered = Array.isArray(govCoverage.uncovered_authority_paths)
      ? govCoverage.uncovered_authority_paths
      : [];
    const declaredOmissions = Array.isArray(govCoverage.declared_omissions)
      ? govCoverage.declared_omissions
      : [];
    const amendmentIds = Array.isArray(govCoverage.amendment_ids)
      ? govCoverage.amendment_ids
      : [];
    const unresolved = [];
    for (const pathStr of uncovered) {
      const match = declaredOmissions.find(
        (o) =>
          o &&
          typeof o === 'object' &&
          o.field === pathStr &&
          typeof o.operator_gate_ref === 'string' &&
          o.operator_gate_ref.length > 0
      );
      if (!match) unresolved.push(pathStr);
    }
    if (unresolved.length > 0) {
      const idsLabel = amendmentIds.length > 0 ? amendmentIds.join(', ') : '(unspecified)';
      return fail(
        'governing-amendment-coverage-violation',
        [
          `Uncovered authority-field paths required by governing amendment(s) ${idsLabel}:`,
          ...unresolved.map((p) => `  - ${p}`),
          'Either include a paired JSON+MD rewrite for each uncovered path in fields_touched_json/fields_touched_md,',
          'or add a matching declared_omissions[] entry of shape',
          '  { field: <path>, reason: <string>, operator_gate_ref: <ratified-gate-id-or-path> }',
          'to proposedChanges.governing_amendment_coverage.'
        ].join('\n')
      );
    }
  }

  // Step 2 — pre-repair hashes.
  const preJson = sha256File(resolved.jsonPath);
  const preMd = sha256File(resolved.markdownPath);

  // Step 5 — atomic paired write.
  // Serialize staged payload first so any serialization failure aborts
  // before either file is touched.
  const staged = proposedChanges.staged;
  let stagedJsonText;
  let stagedMdText;
  try {
    stagedJsonText =
      typeof staged.json === 'string'
        ? staged.json
        : JSON.stringify(staged.json, null, 2) + '\n';
    stagedMdText = String(staged.md);
  } catch (error) {
    return fail(
      'paired-artifact-violation',
      `Failed to serialize staged mutation before write: ${error.message}`
    );
  }

  // Retain original JSON + MD bytes in outer scope so BOTH the atomic-write
  // rollback (immediate) AND the D3 paired-content-propagation check below
  // can restore the pre-image on failure. Prior to this hoist, the D3 check
  // had no access to these bytes and could not roll back.
  let originalJsonBytes;
  let originalMdBytes;
  try {
    originalJsonBytes = fs.readFileSync(resolved.jsonPath);
    originalMdBytes = fs.readFileSync(resolved.markdownPath);
  } catch (readError) {
    return fail(
      'plan-resolution-failure',
      `Failed to read base plan bytes before write: ${readError.message}`
    );
  }

  try {
    fs.writeFileSync(resolved.jsonPath, stagedJsonText, 'utf8');
    fs.writeFileSync(resolved.markdownPath, stagedMdText, 'utf8');
  } catch (writeError) {
    // Roll back whichever side may have been written.
    try {
      fs.writeFileSync(resolved.jsonPath, originalJsonBytes);
    } catch (_) {
      /* best-effort rollback */
    }
    try {
      fs.writeFileSync(resolved.markdownPath, originalMdBytes);
    } catch (_) {
      /* best-effort rollback */
    }
    return fail(
      'paired-artifact-violation',
      `Atomic write failed, rolled back both surfaces: ${writeError.message}`
    );
  }

  // Step 6 — post-repair hashes.
  const postJson = sha256File(resolved.jsonPath);
  const postMd = sha256File(resolved.markdownPath);

  // Step 6b — paired-content propagation check (D3).
  // When JSON fields_touched includes bounded_plan.required_gates or
  // bounded_plan.expected_outcomes, the paired MD section's numbered items
  // must match the JSON array element-for-element (ordinal content parity,
  // not just length). Stale MD with a matching count is a known failure mode
  // that length-only checks miss. On any mismatch, roll back both surfaces
  // to the pre-write bytes and fail with paired-content-propagation-violation.
  const fieldsTouchedJsonList = Array.isArray(proposedChanges.fields_touched_json)
    ? proposedChanges.fields_touched_json
    : [];
  const contentPairingChecks = [
    { jsonField: 'bounded_plan.required_gates', mdHeading: 'Required gates' },
    { jsonField: 'bounded_plan.expected_outcomes', mdHeading: 'Expected outcomes' }
  ];

  /**
   * Best-effort paired rollback to the pre-write image; each write is wrapped
   * independently so one failure does not mask the original violation message.
   */
  function rollbackPairedPreImage() {
    try {
      fs.writeFileSync(resolved.jsonPath, originalJsonBytes);
    } catch (_) {
      /* best-effort rollback */
    }
    try {
      fs.writeFileSync(resolved.markdownPath, originalMdBytes);
    } catch (_) {
      /* best-effort rollback */
    }
  }

  for (const check of contentPairingChecks) {
    if (!fieldsTouchedJsonList.includes(check.jsonField)) continue;
    let postPlan;
    try {
      postPlan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
    } catch (parseErr) {
      rollbackPairedPreImage();
      return fail(
        'paired-content-propagation-violation',
        `Post-write JSON is unparseable during content-pairing check: ${parseErr.message}`
      );
    }
    const jsonArray =
      check.jsonField === 'bounded_plan.required_gates'
        ? postPlan && postPlan.bounded_plan && postPlan.bounded_plan.required_gates
        : postPlan && postPlan.bounded_plan && postPlan.bounded_plan.expected_outcomes;
    const jsonItems = Array.isArray(jsonArray) ? jsonArray : [];
    const mdText = fs.readFileSync(resolved.markdownPath, 'utf8');
    const mdItems = extractOrderedItemsFromSection(mdText, check.mdHeading);

    // Section missing → fail.
    if (mdItems === null) {
      rollbackPairedPreImage();
      return fail(
        'paired-content-propagation-violation',
        [
          `Paired-content propagation failed for ${check.jsonField}:`,
          `  JSON array length = ${jsonItems.length}`,
          `  MD '## ${check.mdHeading}' numbered-item count = (section missing)`,
          'The staged MD must include a plural-form "## ' + check.mdHeading + '" section with a numbered list whose items match the JSON array element-for-element.',
          'Rollback: both surfaces were restored to pre-repair bytes; re-stage a corrected paired mutation.'
        ].join('\n')
      );
    }

    // Count mismatch → fail.
    if (mdItems.length !== jsonItems.length) {
      rollbackPairedPreImage();
      return fail(
        'paired-content-propagation-violation',
        [
          `Paired-content propagation failed for ${check.jsonField}:`,
          `  JSON array length = ${jsonItems.length}`,
          `  MD '## ${check.mdHeading}' numbered-item count = ${mdItems.length}`,
          'The staged MD must include a plural-form "## ' + check.mdHeading + '" section with a numbered list whose items match the JSON array element-for-element.',
          'Rollback: both surfaces were restored to pre-repair bytes; re-stage a corrected paired mutation.'
        ].join('\n')
      );
    }

    // Ordinal content parity: compare each item's text to JSON[i] exactly
    // (both sides trimmed). Any mismatch names the first offending index and
    // surfaces both values so the caller can see what drifted.
    for (let i = 0; i < jsonItems.length; i++) {
      const jsonStr = String(jsonItems[i] == null ? '' : jsonItems[i]).trim();
      const mdStr = String(mdItems[i] == null ? '' : mdItems[i]).trim();
      if (jsonStr !== mdStr) {
        rollbackPairedPreImage();
        return fail(
          'paired-content-propagation-violation',
          [
            `Paired-content propagation failed for ${check.jsonField}:`,
            `  First mismatched index = ${i}`,
            `  JSON[${i}] = ${JSON.stringify(jsonStr)}`,
            `  MD  [${i}] = ${JSON.stringify(mdStr)}`,
            'Each numbered item under "## ' + check.mdHeading + '" must equal the corresponding JSON array element (ordinal content parity). Stale MD with a matching item count still fails.',
            'Rollback: both surfaces were restored to pre-repair bytes; re-stage a corrected paired mutation.'
          ].join('\n')
        );
      }
    }
  }

  // Step 6c — validator hook + .warning sidecar regeneration (D4).
  const validatorScript = path.resolve(
    projectRoot,
    'tools/planning/validate-task-plan.js'
  );
  const warningSidecarPath = resolved.jsonPath + '.warning';
  let validatorStatus;
  const validatorRanAt = canonicalTimestamp();
  try {
    if (!fs.existsSync(validatorScript)) {
      validatorStatus = {
        ok: null,
        error: `validator script not found at ${rel(projectRoot, validatorScript)}`,
        ran_at: validatorRanAt
      };
    } else {
      let stdoutBuf = '';
      let stderrBuf = '';
      let exitCode = 0;
      try {
        stdoutBuf = execFileSync(
          process.execPath,
          [validatorScript, resolved.jsonPath],
          { timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
      } catch (execErr) {
        exitCode = typeof execErr.status === 'number' ? execErr.status : 1;
        stdoutBuf = execErr.stdout ? String(execErr.stdout) : '';
        stderrBuf = execErr.stderr ? String(execErr.stderr) : '';
      }
      if (exitCode === 0) {
        // Passing: remove any stale .warning sidecar.
        try {
          fs.unlinkSync(warningSidecarPath);
        } catch (e) {
          if (e && e.code !== 'ENOENT') {
            // Non-fatal; record as warning in validator_status.
          }
        }
        validatorStatus = { ok: true, exit_code: 0, ran_at: validatorRanAt };
      } else {
        const combined = (stdoutBuf + (stderrBuf ? '\n' + stderrBuf : '')).trim();
        try {
          writeText(warningSidecarPath, combined + '\n');
        } catch (_) { /* best effort */ }
        validatorStatus = {
          ok: false,
          exit_code: exitCode,
          ran_at: validatorRanAt,
          output_summary: combined.slice(0, 2048)
        };
      }
    }
  } catch (error) {
    validatorStatus = { ok: null, error: String(error && error.message || error), ran_at: validatorRanAt };
  }

  // Step 7 — manifest write.
  const timestamp = canonicalTimestamp();
  const manifestStamp = formatIsoForFile();
  const repairId = `${taskId}__repair__${manifestStamp}`;
  const manifestJsonPath = path.join(
    resolved.storageRoot,
    `${repairId}.json`
  );
  const manifestMdPath = path.join(
    resolved.storageRoot,
    `${repairId}.md`
  );

  const authorActor =
    proposedChanges.author_actor && typeof proposedChanges.author_actor === 'object'
      ? proposedChanges.author_actor
      : { actor_id: 'unknown', actor_type: 'intelligence' };

  const manifest = {
    schema: 'PlanRepair/1.0',
    repair_id: repairId,
    plan_id: taskId,
    plan_paths: {
      json: rel(projectRoot, resolved.jsonPath),
      md: rel(projectRoot, resolved.markdownPath)
    },
    timestamp,
    review_reference: reviewReference,
    fields_touched_json: Array.isArray(proposedChanges.fields_touched_json)
      ? proposedChanges.fields_touched_json
      : routeResult.json.matchedAuthorityFields,
    fields_touched_md: Array.isArray(proposedChanges.fields_touched_md)
      ? proposedChanges.fields_touched_md
      : routeResult.md.matchedAuthorityFields,
    pre_repair_hashes: { json: preJson, md: preMd },
    post_repair_hashes: { json: postJson, md: postMd },
    reason: String(proposedChanges.reason || flags.reason || '').trim(),
    author_actor: {
      actor_id: String(authorActor.actor_id || 'unknown'),
      actor_type: String(authorActor.actor_type || 'intelligence')
    },
    produced_by_harness_id: String(
      proposedChanges.produced_by_harness_id || 'codex:smos'
    ),
    schema_version: 'PlanRepair/1.0',
    validator_status: validatorStatus
  };

  writeText(manifestJsonPath, JSON.stringify(manifest, null, 2) + '\n');
  writeText(manifestMdPath, renderManifestMarkdown(manifest));

  // Step 9 — review-before-run state marker.
  const marker = {
    plan_id: taskId,
    last_event: 'post_repair',
    post_repair: {
      repair_id: repairId,
      timestamp,
      review_status: 'pending',
      review_reference: reviewReference
    }
  };
  ensureDir(path.dirname(markerPath));
  writeText(markerPath, JSON.stringify(marker, null, 2) + '\n');

  // Step 10 — truthful exact_next_command.
  const lines = [];
  if (preWriteWarnings.length > 0) {
    for (const w of preWriteWarnings) lines.push(w);
    lines.push('');
  }
  lines.push(
    `Managed command executed: /repair-plan ${taskId}`,
    '',
    `Plan JSON:     ${rel(projectRoot, resolved.jsonPath)}`,
    `Plan Markdown: ${rel(projectRoot, resolved.markdownPath)}`,
    `Repair manifest (JSON): ${rel(projectRoot, manifestJsonPath)}`,
    `Repair manifest (MD):   ${rel(projectRoot, manifestMdPath)}`,
    `State marker:  ${rel(projectRoot, markerPath)}`,
    '',
    'Hash transitions:',
    `- JSON: ${preJson} -> ${postJson}`,
    `- MD:   ${preMd} -> ${postMd}`,
    '',
    `Authority fields touched (JSON): ${manifest.fields_touched_json.join(', ') || '(none recorded)'}`,
    `Authority fields touched (MD):   ${manifest.fields_touched_md.join(', ') || '(none recorded)'}`,
    '',
    `exact_next_command: /review-task-plan ${taskId}`
  );

  return {
    exitCode: 0,
    stdout: lines.join('\n'),
    stderr: '',
    outputs: [
      rel(projectRoot, resolved.jsonPath),
      rel(projectRoot, resolved.markdownPath),
      rel(projectRoot, manifestJsonPath),
      rel(projectRoot, manifestMdPath),
      rel(projectRoot, markerPath)
    ]
  };
}

module.exports = {
  runRepairPlanCommand
};
