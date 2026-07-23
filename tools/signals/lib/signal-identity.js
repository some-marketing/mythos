'use strict';

const VALID_WORKFLOW_KINDS = Object.freeze([
  'pipeline',
  'workstream',
  'bridge',
  'verification',
  'internal'
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWorkflowKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_WORKFLOW_KINDS.includes(normalized) ? normalized : '';
}

function getSignalIdentity(signal) {
  const workflowScope = normalizeText(signal && (signal.workflow_scope || signal.signal_scope));
  const workflowKind = normalizeWorkflowKind(
    signal && (signal.workflow_kind || (workflowScope ? 'workstream' : ''))
  );

  return {
    signalId: normalizeText(signal && signal.signal_id),
    workflowScope,
    workflowKind,
    sessionId: normalizeText(signal && signal.session_id),
    executionId: normalizeText(signal && (signal.execution_id || signal.run_id)),
    legacyScope: normalizeText(signal && signal.scope)
  };
}

function getSignalAuthorityKey(signal) {
  const identity = getSignalIdentity(signal);
  if (identity.workflowScope) return { kind: 'workflow_scope', value: identity.workflowScope };
  if (identity.legacyScope) return { kind: 'scope', value: identity.legacyScope };
  return { kind: '', value: '' };
}

function matchesRequestedSignalScope(signal, requestedScope) {
  const requested = normalizeText(requestedScope);
  if (!requested) return false;

  const identity = getSignalIdentity(signal);
  if (identity.workflowScope) return identity.workflowScope === requested;
  return identity.legacyScope === requested;
}

function isMainPipelineSignal(signal) {
  const identity = getSignalIdentity(signal);
  if (identity.workflowKind) return identity.workflowKind === 'pipeline';
  return !identity.workflowScope;
}

module.exports = {
  VALID_WORKFLOW_KINDS,
  getSignalAuthorityKey,
  getSignalIdentity,
  isMainPipelineSignal,
  matchesRequestedSignalScope,
  normalizeText,
  normalizeWorkflowKind
};
