'use strict';

const {
  createFinding,
  createVerificationResult
} = require('./verification-contract');
const {
  createModelRequest
} = require('./provider-contract');
const {
  createDefaultRegistryConfig,
  resolveModelSelection
} = require('./model-registry');
const { selectLane, validateLaneAssignment } = require('../../autonomy/lib/lane-selector.cjs');
const { PROVIDER_CAPABILITIES } = require('./routing-policy');

function createOllamaAdapterLazy(opts = {}) {
  const { createOllamaAdapter } = require('../adapters/ollama');
  return createOllamaAdapter(opts);
}

function createOpenAICompatibleAdapterLazy() {
  try {
    const { createOpenAICompatibleAdapter } = require('../adapters/openai-compatible');
    return createOpenAICompatibleAdapter();
  } catch {
    return null;
  }
}

function createOpenRouterAdapterLazy() {
  try {
    const { createOpenRouterAdapter } = require('../adapters/openrouter');
    return createOpenRouterAdapter();
  } catch {
    return null;
  }
}

function getGenericProviderAdapters(overrides = {}) {
  const adapters = {
    ollama: overrides.ollama || createOllamaAdapterLazy(overrides.ollama_options || {}),
    'openai-compatible': overrides['openai-compatible'] || createOpenAICompatibleAdapterLazy(),
    openrouter: overrides.openrouter || createOpenRouterAdapterLazy()
  };

  return Object.fromEntries(
    Object.entries(adapters).filter(([, adapter]) => adapter && typeof adapter.invoke === 'function')
  );
}

async function invokeGenericModel(workflowType, payload, opts = {}) {
  let adapters = getGenericProviderAdapters(opts.adapters || {});

  // Lane enforcement — filter adapters BEFORE model selection so the registry
  // only considers providers that match the lane's required location.
  let laneAssignment = null;
  if (opts.lane_context) {
    laneAssignment = selectLane(opts.lane_context);
    if (laneAssignment.governance_check && !laneAssignment.governance_check.valid) {
      return {
        selection: null,
        request: null,
        result: null,
        error: `Lane governance violation: ${laneAssignment.governance_check.violations.join(', ')}`,
        lane: laneAssignment
      };
    }
    // Filter adapters to match lane location
    var requiredLocation = laneAssignment.location;
    var filteredAdapters = {};
    for (var adapterName of Object.keys(adapters)) {
      var cap = PROVIDER_CAPABILITIES[adapterName];
      if (cap && cap.type === requiredLocation) {
        filteredAdapters[adapterName] = adapters[adapterName];
      }
    }
    if (Object.keys(filteredAdapters).length === 0) {
      return {
        selection: null,
        request: null,
        result: null,
        error: 'No ' + requiredLocation + ' provider available for lane "' + laneAssignment.lane + '". Available adapters: [' + Object.keys(adapters).join(', ') + ']. Required location: ' + requiredLocation + '.',
        lane: laneAssignment
      };
    }
    adapters = filteredAdapters;
  }

  const selectionBundle = await resolveModelSelection(workflowType, {
    ...opts,
    config: opts.config || createDefaultRegistryConfig({
      anchorPath: opts.anchorPath || opts.filePath || process.cwd(),
      projectPath: opts.projectPath,
      clientPath: opts.clientPath
    }),
    adapters
  });

  if (!selectionBundle || !selectionBundle.selection || !selectionBundle.descriptor) {
    return {
      selection: selectionBundle ? selectionBundle.selection : null,
      request: null,
      result: null,
      error: selectionBundle && selectionBundle.selection
        ? selectionBundle.selection.reason
        : `No model selection available for workflow "${workflowType}".`,
      lane: laneAssignment
    };
  }

  const descriptor = selectionBundle.descriptor;
  const adapter = adapters[descriptor.provider];
  if (!adapter) {
    return {
      selection: selectionBundle.selection,
      request: null,
      result: null,
      error: `No adapter available for resolved provider "${descriptor.provider}".`,
      lane: laneAssignment
    };
  }

  const request = createModelRequest({
    model_id: descriptor.id,
    workflow_type: workflowType,
    ...payload
  });

  const result = await adapter.invoke(request);
  if (!result || result.status !== 'success') {
    return {
      selection: selectionBundle.selection,
      request,
      result,
      error: result && result.error ? result.error.message : `Provider "${descriptor.provider}" returned no result`,
      lane: laneAssignment
    };
  }

  return {
    selection: selectionBundle.selection,
    request,
    result,
    error: null,
    lane: laneAssignment
  };
}

function parseModelJsonPayload(result) {
  if (result && result.output_json && typeof result.output_json === 'object') {
    return { parsed: result.output_json, ok: true };
  }

  const text = result && typeof result.output_text === 'string'
    ? result.output_text.trim()
    : '';

  if (!text) {
    return { parsed: null, ok: false };
  }

  try {
    return { parsed: JSON.parse(text), ok: true };
  } catch {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return { parsed: JSON.parse(fenceMatch[1].trim()), ok: true };
      } catch { /* continue */ }
    }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return { parsed: JSON.parse(text.slice(first, last + 1)), ok: true };
      } catch { /* continue */ }
    }
  }

  return { parsed: null, ok: false };
}

function buildVerificationPrompt(artifactContent, taskPrompt) {
  return taskPrompt
    ? `${taskPrompt}\n\n---\n\n${artifactContent}`
    : `Review the following artifact for correctness, completeness, and consistency. Flag any issues found.\n\n---\n\n${artifactContent}`;
}

function mapVerificationPayload(parsed, runtime) {
  const verdictMap = { pass: 'pass', fail: 'fail', needs_escalation: 'uncertain', uncertain: 'uncertain' };
  const severityMap = { critical: 'error', high: 'error', medium: 'warning', low: 'info', error: 'error', warning: 'warning', info: 'info' };

  const verdict = verdictMap[parsed.verdict] || 'uncertain';
  const needsEscalation = parsed.verdict === 'needs_escalation' || verdict === 'uncertain';

  const findings = (parsed.findings || []).map((finding, index) => {
    const evidenceParts = [];
    if (finding.location) evidenceParts.push(`Location: ${finding.location}`);
    if (finding.evidence) evidenceParts.push(finding.evidence);
    return createFinding({
      id: `model-${index + 1}`,
      severity: severityMap[finding.severity] || 'warning',
      message: finding.issue || finding.message || 'Unknown issue',
      evidence: evidenceParts.length > 0 ? evidenceParts.join('. ') : null
    });
  });

  const escalationTriggers = [];
  if (needsEscalation) {
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    const reason = String(parsed.reason || '').toLowerCase();
    if (confidence < 0.6) escalationTriggers.push('confidence_below_threshold');
    if (reason.includes('contradict') || reason.includes('conflict')) escalationTriggers.push('evidence_conflicting');
    if (reason.includes('missing') || reason.includes('insufficient') || reason.includes('no evidence')) escalationTriggers.push('evidence_missing');
    if (reason.includes('broad') || reason.includes('too many') || reason.includes('scope')) escalationTriggers.push('context_too_broad');
    if (escalationTriggers.length === 0) escalationTriggers.push('confidence_below_threshold');
  }

  return createVerificationResult({
    verdict,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    findings,
    reason: parsed.reason || 'Model review completed.',
    needs_escalation: needsEscalation,
    escalation_triggers: needsEscalation ? escalationTriggers : undefined,
    model_id: runtime.selection.resolved_model_id,
    provider: runtime.selection.resolved_provider,
    runtime_ms: runtime.result.latency_ms
  });
}

async function verifyArtifact(artifactContent, opts = {}) {
  // Auto-generate lane context for acceptance-grade verification
  const effectiveOpts = { ...opts };
  if (opts.acceptance_grade && !opts.lane_context) {
    effectiveOpts.lane_context = {
      workflow_type: 'verification',
      acceptance_grade: true,
      risk_tier: opts.risk_tier || 'high'
    };
  }

  const prompt = buildVerificationPrompt(artifactContent, effectiveOpts.taskPrompt);
  const runtime = await invokeGenericModel('verification', {
    system_prompt: effectiveOpts.systemPrompt || null,
    user_prompt: prompt,
    response_format: 'json',
    options: {
      temperature: effectiveOpts.temperature ?? 0.1,
      max_output_tokens: effectiveOpts.max_output_tokens ?? 1024,
      timeout_ms: effectiveOpts.timeout_ms
    }
  }, effectiveOpts);

  if (runtime.error || !runtime.result) {
    return {
      result: null,
      raw: runtime.result && runtime.result.output_text ? runtime.result.output_text : '',
      latency_ms: runtime.result ? runtime.result.latency_ms : null,
      error: runtime.error,
      selection: runtime.selection || null,
      lane: runtime.lane || null
    };
  }

  const parsed = parseModelJsonPayload(runtime.result);
  if (!parsed.ok || !parsed.parsed) {
    return {
      result: null,
      raw: runtime.result.output_text || '',
      latency_ms: runtime.result.latency_ms,
      error: 'Failed to parse model response as JSON',
      selection: runtime.selection,
      lane: runtime.lane || null
    };
  }

  try {
    const verificationResult = mapVerificationPayload(parsed.parsed, runtime);
    return {
      result: verificationResult,
      raw: runtime.result.output_text || '',
      latency_ms: runtime.result.latency_ms,
      error: null,
      selection: runtime.selection,
      lane: runtime.lane || null
    };
  } catch (err) {
    return {
      result: null,
      raw: runtime.result.output_text || '',
      latency_ms: runtime.result.latency_ms,
      error: `VerificationResult construction failed: ${err.message}`,
      selection: runtime.selection,
      lane: runtime.lane || null
    };
  }
}

module.exports = {
  getGenericProviderAdapters,
  invokeGenericModel,
  parseModelJsonPayload,
  verifyArtifact,
  selectLane
};
