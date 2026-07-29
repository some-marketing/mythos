/**
 * signal.cjs — VerificationSignal builder and lifecycle manager for Mythos.
 *
 * Usage:
 *   const { createSignal, addCheck, finalize, writeSignal } = require('./lib/signal.cjs');
 *   const signal = createSignal('verify-framework', 'framework:wordpress/qa');
 *   addCheck(signal, { id: 'foo', category: 'bar', severity: 'critical', status: 'PASS', message: '...' });
 *   finalize(signal);
 *   writeSignal(signal, 'tools/verify/.scratch/signal.json');
 */

const fs = require('fs');
const path = require('path');
// Layer 2 (S1): the ONE canonical bubble-up gate taxonomy. attention-request
// signals must name a real gate from this module — never a divergent copy.
const { isBubbleUpGate, GATE_IDS } = require('../../kernel/lib/bubble-up-gates.cjs');

const SCHEMA_VERSION_1_0 = 'VerificationSignal/1.0';
const SCHEMA_VERSION_1_1 = 'VerificationSignal/1.1';
const COORDINATION_SCHEMA_VERSION = 'HandoffSignal/1.0';
const COORDINATION_SCHEMA_VERSION_2_0 = 'HandoffSignal/2.0';
// Default export for backward compat — existing callers read this constant.
const SCHEMA_VERSION = SCHEMA_VERSION_1_0;

const VALID_SIGNAL_TYPES = ['cycle-complete', 'ready-for-review', 'blocked', 'ready-for-clear', 'coordination-request', 'attention-request'];
const VALID_LIFECYCLE_STATES = ['live', 'closed'];
const VALID_LIFECYCLE_STATES_V2 = ['live', 'complete', 'closed'];
const VALID_ACK_ACTIONS = ['noted', 'responded', 'passing-through'];
const VALID_TARGET_MODES = ['snapshot', 'dynamic', 'broadcast', 'deadline-only', 'at-least'];
const VALID_THRESHOLD_MODES = ['all', 'at-least', 'named-list', 'deadline-only'];
const VALID_TIMEOUT_MODES = ['operator-review', 'auto-close', 'fallback-signal'];
const DEFAULT_ALLOWLISTED_ON_COMPLETE_COMMANDS = ['archive_to_closed', 'post_followup_signal', 'trigger_normalize_signals'];

// Grounding modes for HandoffSignal/1.0. Interpretive-posture substrate
// (at _dev/research/{OPERATOR_NAME}-philosophy/) is opt-in per signal. The bridge
// reads this field at runtime and defaults to 'none' on missing/invalid
// input, so adding it is backward-compatible with every existing signal.
const VALID_GROUNDING_MODES = ['none', 'kernel', 'kernel_deep'];
const VALID_ACTOR_RUN_OUTCOMES = [
  'success',
  'cli_failure',
  'missing_binary',
  'timeout',
  'interrupted',
  'narrative_incomplete'
];

/**
 * normalizeGroundingMode — Coerce any raw grounding_mode value into a valid
 * enum value. Unknown/missing/invalid values map to 'none'. Case-insensitive.
 *
 * Mirrors the normalization in tools/signals/lib/codex-bridge.js so that
 * the signal factory and the bridge agree on the default.
 *
 * @param {unknown} raw
 * @returns {string} one of VALID_GROUNDING_MODES
 */
function normalizeGroundingMode(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (VALID_GROUNDING_MODES.includes(value)) return value;
  return 'none';
}

// ---------------------------------------------------------------------------
// Validation-evidence gate (EMISSION side).
// Lessons synthesis 2026-06-03→2026-06-10 dominant root (validated-with-
// corrections, codex-review__lessons-synthesis-validation__20260610.md):
// HandoffSignal/1.0 lets adjacent prose claim what its fields do not
// carry. Symmetric to the shipped L8 closure-evidence gate. Tools-lane only:
// no new HandoffSignal schema FIELDS are introduced here (new fields are
// convene-gated contract work); this is validator/generator-local behavior.
// ---------------------------------------------------------------------------

// Summaries that assert success without carrying any command/result evidence.
const VALIDATION_BOILERPLATE_SUMMARIES = Object.freeze([
  'ok', 'okay', 'done', 'success', 'successful', 'complete', 'completed',
  'pass', 'passed', 'passing', 'validated', 'validation ran',
  'validation passed', 'tests pass', 'tests passed', 'all good', 'works',
  'working', 'verified', 'looks good', 'lgtm', 'n/a', 'none', 'yes', 'true'
]);

// Concrete-evidence heuristic, two-key (Codex review 2026-06-10, MEDIUM: the
// single-marker version let "review completed 2026-06-10" pass on the digits
// alone). A real validation summary must name BOTH:
//   command evidence — what was run / where the evidence lives: a backticked
//   token, a /slash-command, a path-like token, or a known runner word; AND
//   result evidence — what came back: counts with a noun, pass/fail/outcome
//   tokens, an exit code, or a due/trigger state.
const VALIDATION_COMMAND_EVIDENCE_RE =
  /(`[^`]+`|(?:^|[\s:])\/[a-z][\w-]+|\b[\w.-]+\/[\w./-]+\b|\b(?:node|npm|npx|python3?|bash|pytest|jest|codex|exec)\b)/i;
const VALIDATION_RESULT_EVIDENCE_RE =
  /(\b\d+\s*(?:\/\s*\d+\s*)?(?:tests?|checks?|notes?|files?|findings?|signals?|artifacts?|pass(?:ed|ing)?|fail(?:ed|ures?)?)\b|\b(?:pass|fail)(?:ed|ing|ures?)?\b|\bexit(?:\s*code)?\s*[:=]?\s*\d+\b|\boutcome\s*[:=]?\s*[a-z_]+\b|\bdue\s*\(|\bblocked\b)/i;

/**
 * hasConcreteValidationEvidence — true when a validation.summary carries
 * concrete command AND result evidence rather than bare boilerplate assertion
 * (or a date/count with no named source).
 *
 * @param {unknown} summary
 * @returns {boolean}
 */
function hasConcreteValidationEvidence(summary) {
  const text = String(summary || '').trim();
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/[.!]+$/, '').trim();
  if (VALIDATION_BOILERPLATE_SUMMARIES.includes(normalized)) return false;
  return VALIDATION_COMMAND_EVIDENCE_RE.test(text) && VALIDATION_RESULT_EVIDENCE_RE.test(text);
}

/**
 * validateValidationEvidence — emission-side gate over a signal's validation
 * block:
 *   - ran === true  → summary must carry concrete command/result evidence.
 *   - ran === false → an explicit reason is required (in validation.reason
 *     when an emitter sets one locally, otherwise in validation.summary) so
 *     surrounding prose cannot imply completed validation.
 *
 * @param {unknown} validation - the signal's validation block
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateValidationEvidence(validation) {
  const errors = [];
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    return { valid: false, errors: ['validation must be an object with { ran, summary }.'] };
  }
  const summary = String(validation.summary || '').trim();
  if (validation.ran === true) {
    if (!summary) {
      errors.push('validation.ran=true requires a non-empty validation.summary carrying the exact command/result evidence.');
    } else if (!hasConcreteValidationEvidence(summary)) {
      errors.push(`validation.ran=true requires concrete command/result evidence in validation.summary; got boilerplate: "${summary}".`);
    }
  } else {
    const reason = String(validation.reason || '').trim() || summary;
    if (!reason) {
      errors.push('validation.ran=false requires an explicit reason (validation.reason or validation.summary) stating why validation did not run.');
    }
  }
  return { valid: errors.length === 0, errors };
}

function createSignal(source, scope, tier = 'mechanical', opts = {}) {
  const isProfileAware = Boolean(opts.profileId);
  const signal = {
    schema: isProfileAware ? SCHEMA_VERSION_1_1 : SCHEMA_VERSION_1_0,
    timestamp: new Date().toISOString(),
    source,
    scope,
    tier,
    verdict: null,
    summary: { total: 0, passed: 0, failed: 0, warned: 0, skipped: 0 },
    checks: [],
    failures: [],
    gate_decision: { proceed: null, reason: '', blocked_by: [] }
  };
  // v1.1 fields — present only when a profile is active.
  // Populates the minimum fields required by the v1.1 schema.
  if (isProfileAware) {
    signal.profile_id = opts.profileId;
    if (opts.attempt != null) signal.attempt = opts.attempt;
    signal.next_actions = [];
    signal.remediation = {
      auto_fix_safe_actions: false,
      max_attempts: 0,
      remaining_attempts: 0
    };
  }
  return signal;
}

function addNextAction(signal, action) {
  if (!Array.isArray(signal.next_actions)) return;
  signal.next_actions.push(action);
}

function addCheck(signal, opts) {
  const { id, category, severity = 'critical', message, evidence, detail, fix_hint } = opts;
  let status = opts.status;

  if (typeof opts.test === 'function') {
    try {
      const result = opts.test();
      status = result ? 'PASS' : (severity === 'warning' ? 'WARN' : 'FAIL');
    } catch (e) {
      status = 'FAIL';
    }
  }

  const check = { id, category, severity, status, message };
  if (evidence) check.evidence = evidence;
  if (detail) check.detail = detail;

  signal.checks.push(check);
  signal.summary.total++;

  switch (status) {
    case 'PASS': signal.summary.passed++; break;
    case 'FAIL':
      signal.summary.failed++;
      signal.failures.push({
        id, category, message,
        ...(fix_hint ? { fix_hint } : {})
      });
      if (severity === 'critical') {
        signal.gate_decision.blocked_by.push(id);
      }
      break;
    case 'WARN': signal.summary.warned++; break;
    case 'SKIP': signal.summary.skipped++; break;
  }

  return check;
}

function finalize(signal) {
  const criticalFails = signal.checks.filter(c => c.status === 'FAIL' && c.severity === 'critical');

  if (criticalFails.length > 0) {
    signal.verdict = 'FAIL';
    signal.gate_decision.proceed = false;
    signal.gate_decision.reason = `${criticalFails.length} critical check(s) failed.`;
  } else if (signal.summary.warned > 0) {
    signal.verdict = 'WARN';
    signal.gate_decision.proceed = true;
    signal.gate_decision.reason = `All critical checks pass. ${signal.summary.warned} warning(s) (non-blocking).`;
    signal.gate_decision.blocked_by = [];
  } else {
    signal.verdict = 'PASS';
    signal.gate_decision.proceed = true;
    signal.gate_decision.reason = `All ${signal.summary.total} checks pass.`;
    signal.gate_decision.blocked_by = [];
  }

  return signal;
}

function writeSignal(signal, outputPath) {
  if (signal.verdict === null) finalize(signal);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(signal, null, 2));
  return outputPath;
}

function readSignal(signalPath) {
  return JSON.parse(fs.readFileSync(signalPath, 'utf8'));
}

function readAndClean(signalPath) {
  if (!fs.existsSync(signalPath)) {
    throw new Error(`Signal file not found: ${signalPath}`);
  }
  const signal = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
  fs.unlinkSync(signalPath);
  return signal;
}

function printSummary(signal) {
  const label = signal.verdict === 'PASS' ? 'PASS' : signal.verdict === 'WARN' ? 'WARN' : 'FAIL';
  console.log(`\n${label}: ${signal.source} — ${signal.scope}`);
  console.log(`  ${signal.summary.passed}/${signal.summary.total} checks passed`);

  if (signal.failures.length > 0) {
    console.log(`\n  Failures (${signal.failures.length}):`);
    for (const f of signal.failures) {
      console.log(`    - [${f.category}] ${f.message}${f.fix_hint ? ` -> ${f.fix_hint}` : ''}`);
    }
  }

  if (signal.summary.warned > 0) {
    const warns = signal.checks.filter(c => c.status === 'WARN');
    console.log(`\n  Warnings (${warns.length}):`);
    for (const w of warns) {
      console.log(`    - [${w.category}] ${w.message}`);
    }
  }

  // Informational notices: non-warning, non-failing items that should stay
  // visible (e.g. intentionally-parked skeleton frameworks). Scoped to
  // info-severity PASS checks so SKIP/other statuses are not swept in.
  const notices = signal.checks.filter(c => c.severity === 'info' && c.status === 'PASS');
  if (notices.length > 0) {
    console.log(`\n  Notices (${notices.length}):`);
    for (const n of notices) {
      console.log(`    - [${n.category}] ${n.message}`);
    }
  }

  console.log(`\n  Gate: proceed=${signal.gate_decision.proceed} — ${signal.gate_decision.reason}`);
}

/**
 * createHandoffSignal — Create a coordination signal for cross-agent handoff.
 *
 * @param {string} source - The actor/tool that produced the signal (e.g. "claude", "codex")
 * @param {string} scope - The scope of the work (e.g. "track-i", "pipeline:stage-5")
 * @param {string} signalType - One of: cycle-complete, ready-for-review, blocked, ready-for-clear
 * @param {object} [opts] - Optional fields
 * @param {string[]} [opts.artifacts] - Array of durable artifact paths referenced by this signal
 * @param {string[]} [opts.decision_context_artifacts] - Optional extra context artifacts needed for final review or progression decisions
 * @param {{ ran: boolean, summary: string }} [opts.validation] - Validation state
 * @param {string} [opts.recommended_next_actor] - e.g. "codex", "claude", "operator"
 * @param {string} [opts.recommended_next_command] - e.g. "clear", "review-progress"
 * @param {string} [opts.next_prompt_stub] - Optional bounded prompt stub the next actor can use directly
 * @param {string[]} [opts.next_step_detail] - Flat step list with explicit bounded instructions for the next actor
 * @param {string[]} [opts.blocked_by] - Array of blocker descriptions
 * @param {boolean} [opts.ready_for_clear] - Whether the cycle is safe to clear
 * @param {string} [opts.run_id] - Optional run identifier
 * @param {string} [opts.signal_scope] - Optional workstream scope for filtering (e.g. 'simpleminions-routing-integration')
 * @param {string} [opts.grounding_mode] - Optional grounding-substrate mode for codex-bridge review prompts.
 *   One of: 'none' (default), 'kernel', 'kernel_deep'. When set to 'kernel' or 'kernel_deep' the bridge
 *   prepends the interpretive-posture substrate (KERNEL.md + LINEAGE.md + grounding-patterns.md, plus
 *   meetings/{OPERATOR_NAME}-{OPERATOR_NAME}.md and the continuation file for kernel_deep) ahead of the review prompt.
 *   The substrate lives at _dev/research/{OPERATOR_NAME}-philosophy/ and is gitignored; if the files are not
 *   present on the local machine the bridge silently falls back to 'none'. Unknown values normalize to
 *   'none', making the field fully backward-compatible with every existing signal.
 * @returns {object} A HandoffSignal/1.0 object
 */
function createHandoffSignal(source, scope, signalType, opts = {}) {
  if (!VALID_SIGNAL_TYPES.includes(signalType)) {
    throw new Error(`Invalid signal_type "${signalType}". Must be one of: ${VALID_SIGNAL_TYPES.join(', ')}`);
  }

  const groundingMode = normalizeGroundingMode(opts.grounding_mode);
  const isAttentionRequest = signalType === 'attention-request';

  const signal = {
    schema: COORDINATION_SCHEMA_VERSION,
    signal_type: signalType,
    lifecycle_state: 'live',
    source,
    scope,
    timestamp: new Date().toISOString(),
    artifacts: Array.isArray(opts.artifacts) ? opts.artifacts : [],
    decision_context_artifacts: Array.isArray(opts.decision_context_artifacts) ? opts.decision_context_artifacts : [],
    validation: opts.validation || { ran: false, summary: '' },
    // attention-request bubbles to the human operator by default (Layer 2 S1).
    recommended_next_actor: opts.recommended_next_actor || (isAttentionRequest ? 'operator' : ''),
    recommended_next_command: opts.recommended_next_command || '',
    next_prompt_stub: typeof opts.next_prompt_stub === 'string' ? opts.next_prompt_stub : '',
    next_step_detail: Array.isArray(opts.next_step_detail) ? opts.next_step_detail : [],
    blocked_by: Array.isArray(opts.blocked_by) ? opts.blocked_by : [],
    ready_for_clear: Boolean(opts.ready_for_clear),
    grounding_mode: groundingMode,
    ...(opts.run_id ? { run_id: opts.run_id } : {}),
    ...(opts.signal_scope ? { signal_scope: opts.signal_scope } : {}),
    ...(opts.supersedes_signal ? { supersedes_signal: opts.supersedes_signal } : {}),
    ...(opts.superseded_at ? { superseded_at: opts.superseded_at } : {})
  };

  // Layer 2 (S1): attention-request carries the bubble-up payload — the fields
  // that let a lower layer raise a question UP to the operator with everything
  // needed to decide. These are validated by validateHandoffSignal.
  if (isAttentionRequest) {
    signal.raising_scope = typeof opts.raising_scope === 'string' && opts.raising_scope.trim() ? opts.raising_scope : scope;
    signal.gate_type = opts.gate_type || '';
    signal.question = typeof opts.question === 'string' ? opts.question : '';
    signal.attempted_resolution = typeof opts.attempted_resolution === 'string' ? opts.attempted_resolution : '';
    signal.recommended_default = typeof opts.recommended_default === 'string' ? opts.recommended_default : '';
  }

  return signal;
}

/**
 * createAttentionRequest — ergonomic wrapper for the Layer 2 bubble-up rail.
 * A lower layer that cannot resolve a question locally raises it to the operator
 * with the gate that justifies the bubble-up plus enough context to decide.
 *
 * @param {string} source - raising actor
 * @param {string} scope - signal scope
 * @param {object} opts - { gate_type (one of the 7 gates), question, attempted_resolution, recommended_default, raising_scope?, artifacts?, signal_scope? }
 */
function createAttentionRequest(source, scope, opts = {}) {
  return createHandoffSignal(source, scope, 'attention-request', opts);
}

function readHandoffSignal(signalPath) {
  try {
    const signal = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
    if (signal.schema !== COORDINATION_SCHEMA_VERSION) return null;
    return signal;
  } catch {
    return null;
  }
}

function listLiveHandoffSignals(signalDir) {
  if (!fs.existsSync(signalDir)) return [];

  const entries = fs.readdirSync(signalDir, { withFileTypes: true });
  const liveSignals = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;

    const filePath = path.join(signalDir, entry.name);
    const signal = readHandoffSignal(filePath);
    if (!signal) continue;
    if (signal.lifecycle_state !== 'live') continue;

    liveSignals.push({
      name: entry.name,
      filePath,
      signal
    });
  }

  liveSignals.sort((a, b) => {
    const aTs = Date.parse(a.signal.timestamp || '') || 0;
    const bTs = Date.parse(b.signal.timestamp || '') || 0;
    return bTs - aTs;
  });

  return liveSignals;
}

function findLiveSignalsBySignalScope(signalDir, signalScope) {
  const normalizedScope = String(signalScope || '').trim();
  if (!normalizedScope) return [];
  return listLiveHandoffSignals(signalDir).filter((info) => String(info.signal.signal_scope || '').trim() === normalizedScope);
}

function findConflictingLiveSignals(signalDir) {
  const groups = new Map();

  for (const info of listLiveHandoffSignals(signalDir)) {
    const key = String(info.signal.signal_scope || '').trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(info);
  }

  return Array.from(groups.entries())
    .filter(([, infos]) => infos.length > 1)
    .map(([signal_scope, infos]) => ({ signal_scope, signals: infos }));
}

function isExactSlashCommand(command) {
  return String(command || '').trim().startsWith('/');
}

function isRecursiveFollowSignalCommand(command) {
  return /^\/follow-signal(?:\s+--execute)?$/.test(String(command || '').trim());
}

const RESOLVER_COMMAND_NAMES = Object.freeze([
  '/follow-signal',
  '/run-plan',
  '/execute-plan',
  '/advance-pipeline'
]);

function isResolverCommand(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed.startsWith('/')) return false;
  const match = trimmed.match(/^(\/[A-Za-z0-9_-]+)(?:\s|$)/);
  if (!match) return false;
  return RESOLVER_COMMAND_NAMES.includes(match[1]);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isIsoTimestamp(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function validateStringArray(value, fieldName, errors, { required = true, nonEmpty = false } = {}) {
  if (value == null && !required) return;
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array.`);
    return;
  }
  if (nonEmpty && value.length === 0) {
    errors.push(`${fieldName} must include at least one entry.`);
  }
  for (const [index, entry] of value.entries()) {
    if (!isNonEmptyString(entry)) {
      errors.push(`${fieldName}[${index}] must be a non-empty string.`);
    }
  }
}

function validateHandoffSignalV2(signal, opts = {}) {
  const errors = [];

  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
    return { valid: false, errors: ['Signal must be an object.'] };
  }

  if (signal.schema !== COORDINATION_SCHEMA_VERSION_2_0) {
    errors.push(`schema must be ${COORDINATION_SCHEMA_VERSION_2_0}.`);
  }

  if (signal.signal_type !== 'coordination-request') {
    errors.push('signal_type must be coordination-request.');
  }

  if (!VALID_LIFECYCLE_STATES_V2.includes(signal.lifecycle_state)) {
    errors.push(`lifecycle_state must be one of: ${VALID_LIFECYCLE_STATES_V2.join(', ')}.`);
  }

  if (!isPlainObject(signal.target_addressees)) {
    errors.push('target_addressees must be an object.');
  } else {
    const target = signal.target_addressees;
    if (!VALID_TARGET_MODES.includes(target.mode)) {
      errors.push(`target_addressees.mode must be one of: ${VALID_TARGET_MODES.join(', ')}.`);
    }

    if (target.mode === 'snapshot') {
      validateStringArray(target.sessions, 'target_addressees.sessions', errors, { nonEmpty: true });
      if (!isIsoTimestamp(target.resolved_at)) {
        errors.push('target_addressees.resolved_at must be an ISO timestamp.');
      }
      if (!isNonEmptyString(target.source)) {
        errors.push('target_addressees.source must be a non-empty string.');
      }
    }

    if (target.mode === 'dynamic' && !isIsoTimestamp(target.deadline)) {
      errors.push('target_addressees.deadline must be an ISO timestamp for dynamic target_addressees.');
    }
  }

  if (!isPlainObject(signal.acknowledgement_threshold)) {
    errors.push('acknowledgement_threshold must be an object.');
  } else {
    const threshold = signal.acknowledgement_threshold;
    if (!VALID_THRESHOLD_MODES.includes(threshold.mode)) {
      errors.push(`acknowledgement_threshold.mode must be one of: ${VALID_THRESHOLD_MODES.join(', ')}.`);
    }

    if (threshold.mode === 'at-least' && typeof threshold.count !== 'number') {
      errors.push('acknowledgement_threshold.count must be a number for at-least thresholds.');
    }

    if (threshold.mode === 'named-list') {
      validateStringArray(threshold.actor_ids, 'acknowledgement_threshold.actor_ids', errors, { nonEmpty: true });
    }
  }

  if (!Array.isArray(signal.acknowledgements)) {
    errors.push('acknowledgements must be an array.');
  } else {
    for (const [index, acknowledgement] of signal.acknowledgements.entries()) {
      const field = `acknowledgements[${index}]`;
      if (!isPlainObject(acknowledgement)) {
        errors.push(`${field} must be an object.`);
        continue;
      }
      if (!isNonEmptyString(acknowledgement.actor_id)) {
        errors.push(`${field}.actor_id must be a non-empty string.`);
      }
      if (!isNonEmptyString(acknowledgement.session_id)) {
        errors.push(`${field}.session_id must be a non-empty string.`);
      }
      if (!isIsoTimestamp(acknowledgement.ts)) {
        errors.push(`${field}.ts must be an ISO timestamp.`);
      }
      if (!VALID_ACK_ACTIONS.includes(acknowledgement.action_taken)) {
        errors.push(`${field}.action_taken must be one of: ${VALID_ACK_ACTIONS.join(', ')}.`);
      }
    }
  }

  if (!Array.isArray(signal.responses)) {
    errors.push('responses must be an array.');
  }

  if (signal.on_complete != null) {
    if (!isPlainObject(signal.on_complete)) {
      errors.push('on_complete must be an object when provided.');
    } else if (signal.on_complete.trigger_command != null) {
      const allowlistedCommands = Array.isArray(opts.allowlistedCommands)
        ? opts.allowlistedCommands
        : DEFAULT_ALLOWLISTED_ON_COMPLETE_COMMANDS;
      if (!allowlistedCommands.includes(signal.on_complete.trigger_command)) {
        errors.push(`on_complete.trigger_command must be allowlisted. Allowed commands: ${allowlistedCommands.join(', ')}.`);
      }
    }
  }

  if (signal.on_timeout != null) {
    if (!isPlainObject(signal.on_timeout)) {
      errors.push('on_timeout must be an object when provided.');
    } else if (!VALID_TIMEOUT_MODES.includes(signal.on_timeout.mode)) {
      errors.push(`on_timeout.mode must be one of: ${VALID_TIMEOUT_MODES.join(', ')}.`);
    }
  }

  if (signal.deadline != null && !isIsoTimestamp(signal.deadline)) {
    errors.push('deadline must be an ISO timestamp when provided.');
  }

  return { valid: errors.length === 0, errors };
}

function validateHandoffSignal(signal, opts = {}) {
  const projectRoot = opts.projectRoot || '';
  const errors = [];

  if (!signal || typeof signal !== 'object') {
    return { valid: false, errors: ['Signal must be an object.'] };
  }

  if (signal.schema === COORDINATION_SCHEMA_VERSION_2_0) {
    return validateHandoffSignalV2(signal, opts);
  }

  if (signal.schema !== COORDINATION_SCHEMA_VERSION) {
    errors.push(`Signal schema must be ${COORDINATION_SCHEMA_VERSION}.`);
  }

  if (!VALID_SIGNAL_TYPES.includes(signal.signal_type)) {
    errors.push(`signal_type must be one of: ${VALID_SIGNAL_TYPES.join(', ')}.`);
  }

  if (!VALID_LIFECYCLE_STATES.includes(signal.lifecycle_state)) {
    errors.push(`lifecycle_state must be one of: ${VALID_LIFECYCLE_STATES.join(', ')}.`);
  }

  if (!Array.isArray(signal.artifacts)) {
    errors.push('artifacts must be an array.');
  }

  if (!Array.isArray(signal.decision_context_artifacts)) {
    errors.push('decision_context_artifacts must be an array.');
  }

  if (!Array.isArray(signal.blocked_by)) {
    errors.push('blocked_by must be an array.');
  }

  if (!Array.isArray(signal.next_step_detail)) {
    errors.push('next_step_detail must be an array.');
  }

  if (signal.next_prompt_stub != null && typeof signal.next_prompt_stub !== 'string') {
    errors.push('next_prompt_stub must be a string when provided.');
  }

  // Emission-side validation-evidence gate (opt-in so existing readers and
  // historical signals keep validating; signal GENERATORS pass this flag).
  if (opts.requireValidationEvidence === true) {
    const evidence = validateValidationEvidence(signal.validation);
    errors.push(...evidence.errors);
  }

  // Layer 2 (S1): attention-request carries its own required payload (validated
  // below) and its "next step" is operator judgment, not a slash-command — so it
  // is exempt from the generic next-step/slash-command requirement.
  if (signal.signal_type === 'attention-request') {
    if (!isBubbleUpGate(signal.gate_type)) {
      errors.push(`attention-request gate_type must be one of the bubble-up gates: ${GATE_IDS.join(', ')}.`);
    }
    if (!String(signal.raising_scope || '').trim()) {
      errors.push('attention-request requires a non-empty raising_scope.');
    }
    if (!String(signal.question || '').trim()) {
      errors.push('attention-request requires a non-empty question (the decision the operator must make).');
    }
    if (!String(signal.attempted_resolution || '').trim()) {
      errors.push('attention-request requires a non-empty attempted_resolution (what the lower layer tried before bubbling up).');
    }
    if (!String(signal.recommended_default || '').trim()) {
      errors.push('attention-request requires a non-empty recommended_default (the recommended decision if the operator does not weigh in).');
    }
  }

  const requireNextStep = opts.requireNextStep !== false
    && signal.lifecycle_state === 'live'
    && signal.signal_type !== 'ready-for-clear'
    && signal.signal_type !== 'attention-request';
  if (requireNextStep) {
    if (!String(signal.recommended_next_actor || '').trim()) {
      errors.push('recommended_next_actor is required for live actionable signals.');
    }
    if (!String(signal.recommended_next_command || '').trim()) {
      errors.push('recommended_next_command is required for live actionable signals.');
    }
    if (!Array.isArray(signal.next_step_detail) || signal.next_step_detail.length === 0) {
      errors.push('next_step_detail is required for live actionable signals.');
    } else if (signal.next_step_detail.some((step) => !String(step || '').trim())) {
      errors.push('next_step_detail entries must be non-empty strings.');
    }
  }

  if (projectRoot && Array.isArray(signal.artifacts)) {
    for (const artifact of signal.artifacts) {
      const resolved = path.resolve(projectRoot, artifact);
      if (!fs.existsSync(resolved)) {
        errors.push(`artifact does not exist: ${artifact}`);
      }
    }
  }

  if (projectRoot && Array.isArray(signal.decision_context_artifacts)) {
    for (const artifact of signal.decision_context_artifacts) {
      const resolved = path.resolve(projectRoot, artifact);
      if (!fs.existsSync(resolved)) {
        errors.push(`decision context artifact does not exist: ${artifact}`);
      }
    }
  }

  // Monotonic supersession check: if this signal claims to supersede another
  // signal AND carries a superseded_at timestamp, verify that the superseded
  // timestamp is strictly earlier than this signal's own timestamp.
  if (signal.supersedes_signal && signal.superseded_at) {
    const thisTs = Date.parse(signal.timestamp);
    const supersededTs = Date.parse(signal.superseded_at);
    if (!isNaN(thisTs) && !isNaN(supersededTs) && supersededTs >= thisTs) {
      errors.push('Supersession timestamp is not monotonic: superseded signal has later timestamp than this signal');
    }
  }

  return { valid: errors.length === 0, errors };
}

const ACTOR_RUN_ARTIFACT_RULES = Object.freeze({
  codex: Object.freeze({
    report: /codex-cli-run__.+\.md$/,
    last_message: /codex-last-message__.+\.md$/
  }),
  claude: Object.freeze({
    report: /claude-cli-run__.+\.md$/,
    last_message: /claude-last-message__.+\.md$/
  }),
  opencode: Object.freeze({
    report: /opencode-cli-run__.+\.md$/,
    last_message: /opencode-last-message__.+\.md$/
  }),
  gemini: Object.freeze({
    report: /gemini-cli-run__.+\.md$/,
    last_message: /gemini-last-message__.+\.md$/
  })
});

function validateActorRunFeedbackSignal(signal, opts = {}) {
  const expectedActor = String(opts.expectedActor || signal && signal.source || '').trim().toLowerCase();
  const base = validateHandoffSignal(signal, opts);
  const errors = [...base.errors];

  if (!signal || typeof signal !== 'object') {
    return { valid: false, errors };
  }

  if (!expectedActor) {
    errors.push('Actor run feedback signal must declare an expected actor.');
    return { valid: false, errors };
  }

  const rules = ACTOR_RUN_ARTIFACT_RULES[expectedActor];
  if (!rules) {
    errors.push(`Unsupported actor run feedback source "${expectedActor}".`);
    return { valid: false, errors };
  }

  if (String(signal.source || '').trim().toLowerCase() !== expectedActor) {
    errors.push(`Actor run feedback signal must have source "${expectedActor}".`);
  }

  if (!signal.run_outcome || typeof signal.run_outcome !== 'object') {
    errors.push('Actor run feedback signal must include run_outcome.');
  } else {
    const outcome = String(signal.run_outcome.outcome || '');
    if (!VALID_ACTOR_RUN_OUTCOMES.includes(outcome)) {
      errors.push(`Actor run feedback run_outcome.outcome must be one of: ${VALID_ACTOR_RUN_OUTCOMES.join(', ')}.`);
    }
    if (outcome === 'success' && signal.run_outcome.success !== true) {
      errors.push('Actor run feedback success outcome must set run_outcome.success=true.');
    }
    if (outcome !== 'success' && signal.run_outcome.success !== false) {
      errors.push('Actor run feedback non-success outcome must set run_outcome.success=false.');
    }
    if (outcome === 'narrative_incomplete') {
      const completion = signal.run_outcome.narrative_completion;
      if (!completion || completion.required !== true || completion.complete !== false || !Array.isArray(completion.reasons) || completion.reasons.length === 0) {
        errors.push('narrative_incomplete run feedback must include narrative_completion with required=true, complete=false, and non-empty reasons.');
      }
    }
  }

  const command = String(signal.recommended_next_command || '').trim();
  const nextActor = String(signal.recommended_next_actor || '').trim().toLowerCase();
  // Freeform-prompt-targets (gemini, openrouter) are policy-allowed to carry a
  // non-slash next-command per tools/signals/lib/target-command-policy.cjs:42
  // (FREEFORM_PROMPT_TARGETS). Don't require a slash-command for them.
  const FREEFORM_PROMPT_TARGETS = ['gemini', 'openrouter'];
  const nextActorIsFreeform = FREEFORM_PROMPT_TARGETS.includes(nextActor);
  if (signal.lifecycle_state === 'live' && signal.signal_type !== 'ready-for-clear' && nextActor !== 'codex' && !nextActorIsFreeform && !command.startsWith('/')) {
    errors.push('Actor run feedback recommended_next_command must be an exact slash-command.');
  }

  const validationSummary = String(signal.validation && signal.validation.summary || '').trim();
  if (!signal.validation || signal.validation.ran !== true) {
    errors.push('Actor run feedback signal must set validation.ran=true.');
  }
  if (!validationSummary) {
    errors.push('Actor run feedback signal must include a non-empty validation.summary.');
  } else if (!hasConcreteValidationEvidence(validationSummary)) {
    errors.push(`Actor run feedback validation.summary must carry concrete command/result evidence, not boilerplate: "${validationSummary}".`);
  }

  if (!Array.isArray(signal.artifacts) || signal.artifacts.length === 0) {
    errors.push('Actor run feedback signal must include non-empty artifacts.');
  } else {
    const hasCompletionReport = signal.artifacts.some((artifact) => rules.report.test(String(artifact)));
    const hasLastMessage = signal.artifacts.some((artifact) => rules.last_message.test(String(artifact)));
    if (!hasCompletionReport) {
      errors.push(`Actor run feedback artifacts must include a ${expectedActor}-cli-run__*.md completion report.`);
    }
    if (!hasLastMessage) {
      errors.push(`Actor run feedback artifacts must include a ${expectedActor}-last-message__*.md artifact.`);
    }
  }

  if (signal.signal_type === 'blocked') {
    const blockers = Array.isArray(signal.blocked_by)
      ? signal.blocked_by.filter((blocker) => String(blocker || '').trim())
      : [];
    if (blockers.length === 0) {
      errors.push('Blocked actor run feedback signals must include blocked_by details.');
    }
  }

  if (typeof signal.next_prompt_stub === 'string' && signal.next_prompt_stub.trim() !== '') {
    if (!/^codex-bridge-prompt__[a-zA-Z0-9._-]+\.md$/.test(signal.next_prompt_stub)) {
      errors.push('next_prompt_stub does not match canonical naming pattern: codex-bridge-prompt__<scope>.md');
    } else if (signal.scope) {
      // Inline sanitizeScope to avoid circular dependency with codex-bridge.js
      const safeScope = String(signal.scope || 'general')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'general';
      const expectedBasename = `codex-bridge-prompt__${safeScope}.md`;
      if (signal.next_prompt_stub !== expectedBasename) {
        errors.push('next_prompt_stub does not match expected canonical name for this scope');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateCodexRunFeedbackSignal(signal, opts = {}) {
  return validateActorRunFeedbackSignal(signal, {
    ...opts,
    expectedActor: 'codex'
  });
}

/**
 * closeSignal — Transition a coordination signal to closed.
 *
 * Accepts both HandoffSignal/1.0 (live → closed) and 2.0 (live or
 * complete → closed). Optional closeout metadata is recorded for audit
 * trails and scoped bulk closeouts.
 *
 * @param {object} signal - A HandoffSignal/1.0 or /2.0 object
 * @param {object} [opts] - Optional closeout metadata
 * @param {string} [opts.reason] - Closeout reason, such as consumed, ignored, stale, or duplicate
 * @param {string} [opts.closedBy] - Actor/tool closing the signal
 * @param {string} [opts.scopeMatch] - Scope pattern used for bulk closeout
 * @returns {object} The same signal with lifecycle_state set to 'closed' and closeout metadata added
 */
function closeSignal(signal, opts = {}) {
  const isV1 = signal.schema === COORDINATION_SCHEMA_VERSION;
  const isV2 = signal.schema === COORDINATION_SCHEMA_VERSION_2_0;
  if (!isV1 && !isV2) {
    throw new Error(`closeSignal only applies to ${COORDINATION_SCHEMA_VERSION} or ${COORDINATION_SCHEMA_VERSION_2_0} signals, got "${signal.schema}"`);
  }
  if (signal.lifecycle_state === 'closed') {
    throw new Error('Signal is already closed');
  }
  signal.lifecycle_state = 'closed';
  signal.closed_at = new Date().toISOString();
  if (opts.reason) signal.closed_reason = String(opts.reason);
  if (opts.closedBy) signal.closed_by = String(opts.closedBy);
  if (opts.scopeMatch) signal.closed_scope_match = String(opts.scopeMatch);
  return signal;
}

/**
 * hasJsonFlag — Check if --json is present in process.argv.
 */
function hasJsonFlag() {
  return process.argv.includes('--json');
}

/**
 * toStandardJson — Convert a VerificationSignal to the standard --json output shape.
 *
 * Returns an object with: verifier, scope, timestamp, verdict, summary, findings.
 */
function toStandardJson(signal) {
  if (signal.verdict === null) finalize(signal);

  return {
    verifier: signal.source,
    scope: signal.scope,
    timestamp: signal.timestamp,
    verdict: signal.verdict,
    summary: {
      total: signal.summary.total,
      passed: signal.summary.passed,
      failed: signal.summary.failed,
      warned: signal.summary.warned
    },
    findings: signal.checks.map(check => ({
      id: check.id,
      severity: check.severity === 'critical' ? 'error' : check.severity === 'warning' ? 'warning' : 'info',
      status: check.status,
      message: check.message,
      ...(check.detail ? { detail: check.detail } : {})
    }))
  };
}

/**
 * printJsonOutput — If --json flag is present, print standard JSON to stdout and return true.
 * If --json is not present, return false (caller should use normal output).
 */
function printJsonOutput(signal) {
  if (!hasJsonFlag()) return false;
  if (signal.verdict === null) finalize(signal);
  console.log(JSON.stringify(toStandardJson(signal), null, 2));
  return true;
}

module.exports = {
  SCHEMA_VERSION,
  SCHEMA_VERSION_1_0,
  SCHEMA_VERSION_1_1,
  COORDINATION_SCHEMA_VERSION,
  COORDINATION_SCHEMA_VERSION_2_0,
  VALID_SIGNAL_TYPES,
  VALID_LIFECYCLE_STATES,
  VALID_LIFECYCLE_STATES_V2,
  VALID_ACK_ACTIONS,
  VALID_TARGET_MODES,
  VALID_THRESHOLD_MODES,
  VALID_GROUNDING_MODES,
  VALID_ACTOR_RUN_OUTCOMES,
  VALIDATION_BOILERPLATE_SUMMARIES,
  normalizeGroundingMode,
  hasConcreteValidationEvidence,
  validateValidationEvidence,
  createSignal,
  createHandoffSignal,
  createAttentionRequest,
  closeSignal,
  listLiveHandoffSignals,
  findLiveSignalsBySignalScope,
  findConflictingLiveSignals,
  validateHandoffSignal,
  validateHandoffSignalV2,
  validateActorRunFeedbackSignal,
  validateCodexRunFeedbackSignal,
  isExactSlashCommand,
  isRecursiveFollowSignalCommand,
  isResolverCommand,
  addCheck,
  addNextAction,
  finalize,
  writeSignal,
  readSignal,
  readAndClean,
  printSummary,
  hasJsonFlag,
  toStandardJson,
  printJsonOutput
};
