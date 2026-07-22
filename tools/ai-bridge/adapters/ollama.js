'use strict';

const http = require('http');
const https = require('https');
const {
  createProviderInfo,
  createHealthStatus,
  createModelDescriptor,
  createModelInventory,
  createModelResult
} = require('../lib/provider-contract');

const DEFAULT_BASE_URL = 'http://localhost:11434';
const HEALTH_TIMEOUT_MS = 3000;
const LIST_TIMEOUT_MS = 5000;
const INFERENCE_TIMEOUT_MS = 60000;

const VERIFIER_SYSTEM_PROMPT = `You are a verification reviewer for Mythos, a file-system-based operating system for orchestrating reusable LLM-driven workflows.

You review code changes, verification outputs, claims, and artifacts. You return ONLY valid JSON matching this exact schema — no markdown fences, no explanation text, nothing outside the JSON:

{
  "verdict": "pass" | "fail" | "needs_escalation",
  "confidence": <number between 0.0 and 1.0>,
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "location": "<file path or logical section>",
      "issue": "<short description>",
      "evidence": "<specific evidence>"
    }
  ],
  "reason": "<one-sentence explanation>"
}

Rules:
- Return ONLY the JSON object. No other text.
- Use "needs_escalation" when evidence is ambiguous, contradictory, or insufficient.
- Never bluff confidence on uncertain evidence.
- Empty findings array is valid for clear pass cases.`;

function httpJsonRequest(method, url, body, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);

    const payload = body ? JSON.stringify(body) : null;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search || ''}`,
      method,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        : {},
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latency_ms = Date.now() - start;
        let parsedBody = null;
        let parseError = null;
        if (data) {
          try {
            parsedBody = JSON.parse(data);
          } catch {
            parseError = 'Invalid JSON response';
          }
        }
        resolve({
          status: res.statusCode,
          body: parsedBody,
          text: data,
          error: parseError,
          latency_ms
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        body: null,
        text: '',
        error: `Request timed out after ${timeoutMs}ms`,
        latency_ms: timeoutMs
      });
    });

    req.on('error', (err) => {
      resolve({
        status: 0,
        body: null,
        text: '',
        error: err.message,
        latency_ms: Date.now() - start
      });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function inferCapabilities(modelName) {
  const name = String(modelName || '').toLowerCase();
  const caps = ['chat'];

  if (name.includes('llama') || name.includes('mistral') || name.includes('qwen') ||
      name.includes('phi') || name.includes('gemma') || name.includes('deepseek')) {
    caps.push('classification', 'drafting', 'analysis', 'verification');
  }

  if (name.includes('deepseek') || name.includes('codellama') || name.includes('starcoder') || name.includes('coder')) {
    caps.push('coding');
  }

  return [...new Set(caps)];
}

function parseVerifierResponse(raw) {
  const trimmed = (raw || '').trim();
  try { return { parsed: JSON.parse(trimmed), ok: true }; } catch { /* continue */ }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return { parsed: JSON.parse(fenceMatch[1].trim()), ok: true }; } catch { /* continue */ }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return { parsed: JSON.parse(trimmed.slice(first, last + 1)), ok: true }; } catch { /* continue */ }
  }
  return { parsed: null, ok: false };
}

async function ollamaGenerate(baseUrl, model, prompt, opts = {}) {
  const response = await httpJsonRequest('POST', `${baseUrl}/api/generate`, {
    model,
    prompt,
    system: VERIFIER_SYSTEM_PROMPT,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.1,
      num_predict: opts.num_predict ?? 1024
    }
  }, INFERENCE_TIMEOUT_MS);

  if (response.status === 0) {
    return {
      raw: '',
      latency_ms: response.latency_ms,
      error: response.error || 'Connection failed'
    };
  }

  if (response.status !== 200) {
    return {
      raw: response.text,
      latency_ms: response.latency_ms,
      error: `Ollama returned HTTP ${response.status}: ${response.text.slice(0, 200)}`
    };
  }

  if (response.error) {
    return {
      raw: response.text,
      latency_ms: response.latency_ms,
      error: response.error
    };
  }

  if (response.body && response.body.error) {
    return {
      raw: '',
      latency_ms: response.latency_ms,
      error: `Ollama error: ${response.body.error}`
    };
  }

  return {
    raw: response.body && typeof response.body.response === 'string' ? response.body.response : '',
    latency_ms: response.latency_ms,
    error: null
  };
}

function buildMessageList(request) {
  const messages = [];
  if (request.system_prompt) {
    messages.push({ role: 'system', content: request.system_prompt });
  }
  if (Array.isArray(request.messages) && request.messages.length > 0) {
    messages.push(...request.messages);
  } else if (request.user_prompt) {
    messages.push({ role: 'user', content: request.user_prompt });
  }
  return messages;
}

function mapChatResponse(modelId, providerModelId, response) {
  if (response.status === 0) {
    return createModelResult({
      status: 'unreachable',
      provider: 'ollama',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: 'ollama_unreachable',
        message: response.error || 'Ollama is unreachable',
        retryable: true
      }
    });
  }

  if (response.status !== 200) {
    return createModelResult({
      status: 'error',
      provider: 'ollama',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: `ollama_http_${response.status}`,
        message: response.text || response.error || `HTTP ${response.status}`,
        retryable: response.status >= 500
      }
    });
  }

  if (response.error) {
    return createModelResult({
      status: 'error',
      provider: 'ollama',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: 'ollama_invalid_json',
        message: response.error,
        retryable: false
      }
    });
  }

  if (response.body && response.body.error) {
    return createModelResult({
      status: 'error',
      provider: 'ollama',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: 'ollama_error',
        message: response.body.error,
        retryable: false
      }
    });
  }

  const message = response.body && response.body.message ? response.body.message : {};
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((toolCall) => ({
        name: toolCall.function && toolCall.function.name ? toolCall.function.name : toolCall.name || 'unknown',
        arguments: toolCall.function && toolCall.function.arguments ? toolCall.function.arguments : null
      }))
    : [];

  return createModelResult({
    status: 'success',
    provider: 'ollama',
    model_id: modelId,
    provider_model_id: providerModelId,
    output_text: typeof message.content === 'string'
      ? message.content
      : (response.body && typeof response.body.response === 'string' ? response.body.response : ''),
    output_json: null,
    tool_calls: toolCalls,
    usage: response.body && response.body.prompt_eval_count != null
      ? {
          input_tokens: response.body.prompt_eval_count ?? null,
          output_tokens: response.body.eval_count ?? null,
          total_tokens: (response.body.prompt_eval_count || 0) + (response.body.eval_count || 0)
        }
      : null,
    latency_ms: response.latency_ms,
    metadata: {
      done_reason: response.body ? response.body.done_reason || null : null
    }
  });
}

function createOllamaAdapter(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;

  return {
    getInfo() {
      return createProviderInfo({
        name: 'ollama',
        type: 'local',
        version: null,
        endpoint: baseUrl
      });
    },

    async checkHealth() {
      const result = await httpJsonRequest('GET', `${baseUrl}/api/tags`, null, HEALTH_TIMEOUT_MS);

      if (result.error || result.status !== 200) {
        return createHealthStatus({
          reachable: false,
          latency_ms: result.latency_ms,
          error: result.error || `Unexpected status code: ${result.status}`
        });
      }

      return createHealthStatus({
        reachable: true,
        latency_ms: result.latency_ms
      });
    },

    async listModels() {
      const result = await httpJsonRequest('GET', `${baseUrl}/api/tags`, null, LIST_TIMEOUT_MS);
      if (result.error || result.status !== 200 || !result.body) {
        return createModelInventory([]);
      }

      const rawModels = Array.isArray(result.body.models) ? result.body.models : [];
      const descriptors = rawModels.map((model) => {
        const providerModelId = model.name || model.model || 'unknown';
        return createModelDescriptor({
          id: `ollama:${providerModelId}`,
          provider: 'ollama',
          provider_model_id: providerModelId,
          family: providerModelId.split(':')[0] || null,
          label: providerModelId,
          name: providerModelId,
          size_bytes: typeof model.size === 'number' ? model.size : null,
          capabilities: inferCapabilities(providerModelId),
          context_window: null,
          local: true,
          available: true,
          endpoint_ref: 'OLLAMA_BASE_URL'
        });
      });

      return createModelInventory(descriptors);
    },

    async invoke(request) {
      const modelId = request.model_id;
      const providerModelId = String(modelId).startsWith('ollama:')
        ? String(modelId).slice('ollama:'.length)
        : String(modelId);

      const messages = buildMessageList(request);
      const supportsTools = Array.isArray(request.tools) && request.tools.length > 0;
      const response = await httpJsonRequest('POST', `${baseUrl}/api/chat`, {
        model: providerModelId,
        messages,
        stream: false,
        format: request.response_format === 'json' ? 'json' : undefined,
        tools: supportsTools ? request.tools : undefined,
        options: {
          temperature: request.options.temperature,
          num_predict: request.options.max_output_tokens
        }
      }, request.options.timeout_ms || INFERENCE_TIMEOUT_MS);

      return mapChatResponse(modelId, providerModelId, response);
    }
  };
}

async function verify(artifactContent, opts = {}) {
  const baseUrl = opts.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  const model = opts.model || 'qwen2.5-coder:14b';

  const prompt = opts.taskPrompt
    ? `${opts.taskPrompt}\n\n---\n\n${artifactContent}`
    : `Review the following artifact for correctness, completeness, and consistency. Flag any issues found.\n\n---\n\n${artifactContent}`;

  const { raw, latency_ms, error } = await ollamaGenerate(baseUrl, model, prompt, opts);
  if (error) {
    return { result: null, raw, latency_ms, error };
  }

  const { parsed, ok } = parseVerifierResponse(raw);
  if (!ok || !parsed) {
    return { result: null, raw, latency_ms, error: 'Failed to parse model response as JSON' };
  }

  const {
    createVerificationResult,
    createFinding
  } = require('../lib/verification-contract');

  const verdictMap = { pass: 'pass', fail: 'fail', needs_escalation: 'uncertain' };
  const verdict = verdictMap[parsed.verdict] || 'uncertain';
  const needsEscalation = parsed.verdict === 'needs_escalation' || verdict === 'uncertain';

  const severityMap = { critical: 'error', high: 'error', medium: 'warning', low: 'info' };
  const findings = (parsed.findings || []).map((finding, index) => {
    const evidenceParts = [];
    if (finding.location) evidenceParts.push(`Location: ${finding.location}`);
    if (finding.evidence) evidenceParts.push(finding.evidence);
    return createFinding({
      id: `local-${index + 1}`,
      severity: severityMap[finding.severity] || 'warning',
      message: finding.issue || 'Unknown issue',
      evidence: evidenceParts.length > 0 ? evidenceParts.join('. ') : null
    });
  });

  const escalationTriggers = [];
  if (needsEscalation) {
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    const reason = (parsed.reason || '').toLowerCase();
    if (confidence < 0.6) escalationTriggers.push('confidence_below_threshold');
    if (reason.includes('contradict') || reason.includes('conflict')) escalationTriggers.push('evidence_conflicting');
    if (reason.includes('missing') || reason.includes('insufficient') || reason.includes('no evidence')) escalationTriggers.push('evidence_missing');
    if (reason.includes('broad') || reason.includes('too many') || reason.includes('scope')) escalationTriggers.push('context_too_broad');
    if (escalationTriggers.length === 0) escalationTriggers.push('confidence_below_threshold');
  }

  try {
    const result = createVerificationResult({
      verdict,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      findings,
      reason: parsed.reason || 'Local model review.',
      needs_escalation: needsEscalation,
      escalation_triggers: needsEscalation ? escalationTriggers : undefined,
      model_id: model,
      provider: 'ollama',
      runtime_ms: latency_ms
    });
    return { result, raw, latency_ms, error: null };
  } catch (err) {
    return { result: null, raw, latency_ms, error: `VerificationResult construction failed: ${err.message}` };
  }
}

module.exports = {
  createOllamaAdapter,
  inferCapabilities,
  verify,
  ollamaGenerate,
  parseVerifierResponse,
  VERIFIER_SYSTEM_PROMPT,
  DEFAULT_BASE_URL,
  HEALTH_TIMEOUT_MS,
  LIST_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS
};
