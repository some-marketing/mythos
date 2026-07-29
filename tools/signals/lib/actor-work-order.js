'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODES = new Set(['FINDINGS_ONLY', 'RUN_ONLY', 'REVIEW_ONLY', 'PATCH_ALLOWED', 'COORDINATOR', 'REPO_HYGIENE', 'read-only', 'workspace-write']);
const SENSITIVE_KEY = /(authorization|credential|secret|token|api[_-]?key|password|cookie)/i;
const SENSITIVE_VALUE = /(bearer\s+[a-z0-9._~+\/-]+|(?:sk|key|token|secret|ghp|github_pat)[-_][a-z0-9_-]{8,}|AIza[a-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|[?&](?:access_token|api_key|key|token)=[^&\s]+)/ig;
const TERMINAL_FAILURES = new Set(['auth', 'permission', 'safety', 'privacy', 'mode', 'custody']);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashWorkOrder(order) {
  return crypto.createHash('sha256').update(stableStringify(order)).digest('hex');
}

function scrubSensitive(value, key = '') {
  if (SENSITIVE_KEY.test(key) || /^(env|environment)$/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => scrubSensitive(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, scrubSensitive(child, childKey)]));
  }
  if (typeof value === 'string') return value.replace(SENSITIVE_VALUE, '[REDACTED]');
  return value;
}

function validateActorWorkOrder(order) {
  const errors = [];
  if (!order || typeof order !== 'object' || Array.isArray(order)) return { valid: false, errors: ['work order must be an object'] };
  if (order.schema !== 'ActorWorkOrder/1.0') errors.push('schema must be ActorWorkOrder/1.0');
  for (const field of ['dispatch_id']) if (!String(order[field] || '').trim()) errors.push(`${field} is required`);
  for (const field of ['current_state', 'question_work', 'desired_state']) {
    if (!String(order.continuity && order.continuity[field] || '').trim()) errors.push(`continuity.${field} is required`);
  }
  for (const field of ['target', 'model', 'mind', 'command']) {
    if (!String(order.actor && order.actor[field] || '').trim()) errors.push(`actor.${field} is required`);
  }
  if (!MODES.has(order.execution && order.execution.mode)) errors.push('execution.mode is unsupported');
  if (!Array.isArray(order.execution && order.execution.required_mcp)) errors.push('execution.required_mcp must be an array');
  for (const field of ['scope', 'owner']) if (!String(order.custody && order.custody[field] || '').trim()) errors.push(`custody.${field} is required`);
  if (!order.privacy || !['public', 'repository', 'synthetic', 'private-bounded', 'none'].includes(order.privacy.access) || !Array.isArray(order.privacy.allowed_refs)) errors.push('privacy bounds are required');
  if (order.disclosure && order.actor) {
    if (order.disclosure.model !== order.actor.model) errors.push('disclosure.model must equal actor.model');
    if (order.disclosure.mind !== order.actor.mind) errors.push('disclosure.mind must equal actor.mind');
  } else errors.push('model and mind disclosure are required');
  if (!Number.isInteger(order.max_retries) || order.max_retries < 0 || order.max_retries > 2) errors.push('max_retries must be an integer from 0 through 2');
  const target = String(order.actor && order.actor.target || '').toLowerCase();
  if (order.actor && order.actor.target !== target) errors.push('actor.target must be lowercase');
  if (target === 'claude' && order.fable_conduct !== false) errors.push('Claude work orders require fable_conduct=false');
  if (target !== 'claude' && Object.hasOwn(order, 'fable_conduct')) errors.push('fable_conduct is only valid for Claude work orders');
  return { valid: errors.length === 0, errors };
}

function immutableTargetTuple(order) {
  return {
    target: order.actor.target,
    model: order.actor.model,
    mind: order.actor.mind,
    command: order.actor.command,
    mode: order.execution.mode,
    custody_scope: order.custody.scope,
    work_order_sha256: hashWorkOrder(order)
  };
}

function buildCapabilityReceipt(order, facts = {}) {
  const validation = validateActorWorkOrder(order);
  const checks = {
    contract_valid: validation.valid,
    target_supported: facts.target_supported !== false,
    command_supported: facts.command_supported !== false,
    model_resolved: Boolean(order && order.actor && String(order.actor.model || '').trim()),
    mode_supported: MODES.has(order && order.execution && order.execution.mode),
    mcp_ready: facts.mcp_ready !== false,
    privacy_compatible: facts.privacy_compatible !== false,
    custody_valid: Boolean(order && order.custody && order.custody.scope && order.custody.owner),
    no_fable_confirmed: String(order && order.actor && order.actor.target || '').toLowerCase() !== 'claude' || order.fable_conduct === false
  };
  const safeReferences = (Array.isArray(facts.references) ? facts.references : [])
    .filter((ref) => typeof ref === 'string' && !path.isAbsolute(ref) && !ref.startsWith('..'));
  const errors = [...validation.errors, ...(Array.isArray(facts.errors) ? facts.errors : [])];
  return scrubSensitive({
    schema: 'ActorCapabilityReceipt/1.0',
    dispatch_id: String(order && order.dispatch_id || facts.dispatch_id || 'unknown'),
    work_order_sha256: order ? hashWorkOrder(order) : '0'.repeat(64),
    target: String(order && order.actor && order.actor.target || facts.target || 'unknown'),
    model: String(order && order.actor && order.actor.model || 'unresolved'),
    mind: String(order && order.actor && order.actor.mind || 'unresolved'),
    mode: String(order && order.execution && order.execution.mode || 'unsupported'),
    checks,
    ready: Object.values(checks).every(Boolean) && errors.length === 0,
    references: safeReferences,
    errors
  });
}

function classifyFailure(input, order, attemptCount) {
  const text = String(input && (input.message || input.stderr || input.reason) || '').toLowerCase();
  let failureClass = 'unknown';
  if (input && input.timedOut || /timed?\s*out|timeout/.test(text)) failureClass = 'timeout';
  else if (/econn|network|transport|socket|dns|connection reset/.test(text)) failureClass = 'transport';
  else if (/unauthori[sz]ed|authentication|invalid api/.test(text)) failureClass = 'auth';
  else if (/permission|forbidden|access denied/.test(text)) failureClass = 'permission';
  else if (/safety|policy refusal/.test(text)) failureClass = 'safety';
  else if (/privacy|private surface|pii/.test(text)) failureClass = 'privacy';
  else if (/unsupported mode|execution mode/.test(text)) failureClass = 'mode';
  else if (/custody|authority boundary/.test(text)) failureClass = 'custody';
  else if (/semantic|unknown target|selection/.test(text)) failureClass = 'semantic';
  const maxRetries = order.max_retries;
  const retryable = ['timeout', 'transport'].includes(failureClass) && attemptCount <= maxRetries;
  const disposition = retryable ? 'retry_same_target' : TERMINAL_FAILURES.has(failureClass) ? 'stop_terminal' : 'escalate_coordinator';
  return scrubSensitive({
    schema: 'ActorFailureDecision/1.0',
    dispatch_id: order.dispatch_id,
    work_order_sha256: hashWorkOrder(order),
    target_tuple: immutableTargetTuple(order),
    attempt_count: attemptCount,
    max_retries: maxRetries,
    failure_class: failureClass,
    disposition,
    evidence: [String(input && (input.message || input.reason) || failureClass)]
  });
}

function persistFailureDecisionAtomic(filePath, existing, decision) {
  const next = scrubSensitive({ ...(existing || {}), actor_failure_decision: decision });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
  return next;
}

function loadFailureDecision(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')).actor_failure_decision || null; } catch (_) { return null; }
}

function enforcementMode(env = process.env) {
  const mode = String(env.SMOS_ACTOR_WORK_ORDER_MODE || 'observe').toLowerCase();
  return ['off', 'observe', 'enforce'].includes(mode) ? mode : 'observe';
}

module.exports = {
  buildCapabilityReceipt,
  classifyFailure,
  enforcementMode,
  hashWorkOrder,
  immutableTargetTuple,
  loadFailureDecision,
  persistFailureDecisionAtomic,
  scrubSensitive,
  validateActorWorkOrder
};
