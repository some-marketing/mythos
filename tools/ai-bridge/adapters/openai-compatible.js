'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const {
  createProviderInfo,
  createHealthStatus,
  createModelDescriptor,
  createModelInventory,
  createModelResult
} = require('../lib/provider-contract');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const HEALTH_TIMEOUT_MS = 5000;
const LIST_TIMEOUT_MS = 5000;
const INFERENCE_TIMEOUT_MS = 60000;

function parseBaseUrl(baseUrl) {
  const normalized = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return new URL(normalized);
}

function requestJson(baseUrl, method, routePath, apiKey, body, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const parsedBase = parseBaseUrl(baseUrl);
    const mod = parsedBase.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = mod.request({
      hostname: parsedBase.hostname,
      port: parsedBase.port,
      path: `${parsedBase.pathname}${routePath}`.replace(/\/{2,}/g, '/'),
      method,
      headers: {
        Accept: 'application/json',
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latency_ms = Date.now() - start;
        let json = null;
        let error = null;
        if (data) {
          try {
            json = JSON.parse(data);
          } catch {
            error = 'Invalid JSON response';
          }
        }
        resolve({
          status: res.statusCode,
          body: json,
          text: data,
          error,
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

function inferCapabilities(modelId) {
  const name = String(modelId || '').toLowerCase();
  const caps = ['chat', 'streaming'];

  if (name.includes('gpt-4') || name.includes('gpt-5') || name.includes('o3') || name.includes('o4')) {
    caps.push('analysis', 'classification', 'drafting', 'verification', 'tool_calling', 'structured_output');
  } else {
    caps.push('analysis', 'classification', 'drafting');
  }

  if (name.includes('vision') || name.includes('gpt-4.1') || name.includes('gpt-4o')) {
    caps.push('vision');
  }

  if (name.includes('128k') || name.includes('200k') || name.includes('1m') || name.includes('gpt-5')) {
    caps.push('long_context');
  }

  return [...new Set(caps)];
}

function normalizeMessages(request) {
  if (Array.isArray(request.messages) && request.messages.length > 0) {
    return request.messages.map((message) => ({
      role: message.role,
      content: message.content
    }));
  }

  const messages = [];
  if (request.system_prompt) messages.push({ role: 'system', content: request.system_prompt });
  if (request.user_prompt) messages.push({ role: 'user', content: request.user_prompt });
  return messages;
}

function normalizeToolCalls(response) {
  const message = response && response.choices && response.choices[0] && response.choices[0].message
    ? response.choices[0].message
    : {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return toolCalls.map((toolCall) => {
    let parsedArgs = null;
    const rawArgs = toolCall.function && toolCall.function.arguments ? toolCall.function.arguments : null;
    if (typeof rawArgs === 'string' && rawArgs.trim()) {
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        parsedArgs = { raw: rawArgs };
      }
    }
    return {
      name: toolCall.function && toolCall.function.name ? toolCall.function.name : toolCall.name || 'unknown',
      arguments: parsedArgs
    };
  });
}

function mapResponseToResult(modelId, providerModelId, response) {
  if (response.status === 0) {
    return createModelResult({
      status: 'unreachable',
      provider: 'openai-compatible',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: 'openai_compat_unreachable',
        message: response.error || 'Endpoint unreachable',
        retryable: true
      }
    });
  }

  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return createModelResult({
      status: 'unsupported',
      provider: 'openai-compatible',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: `openai_compat_http_${response.status}`,
        message: response.body && response.body.error && response.body.error.message
          ? response.body.error.message
          : response.text || `HTTP ${response.status}`,
        retryable: false
      }
    });
  }

  if (response.status !== 200) {
    return createModelResult({
      status: 'error',
      provider: 'openai-compatible',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: `openai_compat_http_${response.status}`,
        message: response.body && response.body.error && response.body.error.message
          ? response.body.error.message
          : response.error || response.text || `HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429
      }
    });
  }

  if (response.error) {
    return createModelResult({
      status: 'error',
      provider: 'openai-compatible',
      model_id: modelId,
      provider_model_id: providerModelId,
      latency_ms: response.latency_ms,
      error: {
        code: 'openai_compat_invalid_json',
        message: response.error,
        retryable: false
      }
    });
  }

  const choice = response.body && Array.isArray(response.body.choices) ? response.body.choices[0] : null;
  const message = choice && choice.message ? choice.message : {};

  let outputText = '';
  if (typeof message.content === 'string') {
    outputText = message.content;
  } else if (Array.isArray(message.content)) {
    outputText = message.content
      .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  let outputJson = null;
  if (outputText) {
    try {
      outputJson = JSON.parse(outputText);
    } catch {
      outputJson = null;
    }
  }

  return createModelResult({
    status: 'success',
    provider: 'openai-compatible',
    model_id: modelId,
    provider_model_id: providerModelId,
    output_text: outputText,
    output_json: outputJson,
    tool_calls: normalizeToolCalls(response.body),
    usage: response.body && response.body.usage
      ? {
          input_tokens: response.body.usage.prompt_tokens ?? null,
          output_tokens: response.body.usage.completion_tokens ?? null,
          total_tokens: response.body.usage.total_tokens ?? null
        }
      : null,
    latency_ms: response.latency_ms,
    metadata: {
      finish_reason: choice ? choice.finish_reason || null : null
    }
  });
}

/**
 * Resolve the OpenAI (or OpenAI-compatible-gateway) API key through the
 * shared BYO-credential resolver (tools/lib/resolve-credential.cjs), honoring
 * OPENAI_COMPAT_API_KEY as a caller override before the tool's own
 * creds.config.json declaration for OPENAI_API_KEY. Never throws — a missing
 * key degrades to an unauthenticated adapter (checkHealth/listModels/invoke
 * will simply fail against providers that require auth; local/no-auth
 * OpenAI-compatible gateways still work with an empty key).
 */
function resolveApiKey() {
  if (process.env.OPENAI_COMPAT_API_KEY) return process.env.OPENAI_COMPAT_API_KEY.trim();
  try {
    const creds = resolveCredentialsFromFile(
      path.join(__dirname, '..', 'creds.config.json'),
      { optional: ['OPENAI_API_KEY'] }
    );
    return creds.OPENAI_API_KEY || '';
  } catch {
    return '';
  }
}

function createOpenAICompatibleAdapter(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.OPENAI_COMPAT_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = opts.apiKey || resolveApiKey();
  const endpointRef = opts.endpointRef || 'OPENAI_COMPAT_BASE_URL';

  return {
    getInfo() {
      return createProviderInfo({
        name: 'openai-compatible',
        type: 'cloud',
        version: null,
        endpoint: baseUrl
      });
    },

    async checkHealth() {
      const response = await requestJson(baseUrl, 'GET', '/models', apiKey, null, HEALTH_TIMEOUT_MS);
      if (response.error || response.status !== 200) {
        return createHealthStatus({
          reachable: false,
          latency_ms: response.latency_ms,
          error: response.error || `Unexpected status code: ${response.status}`
        });
      }
      return createHealthStatus({
        reachable: true,
        latency_ms: response.latency_ms
      });
    },

    async listModels() {
      const response = await requestJson(baseUrl, 'GET', '/models', apiKey, null, LIST_TIMEOUT_MS);
      if (response.error || response.status !== 200 || !response.body) {
        return createModelInventory([]);
      }

      const models = Array.isArray(response.body.data) ? response.body.data : [];
      return createModelInventory(models.map((model) => {
        const providerModelId = model.id || 'unknown';
        return createModelDescriptor({
          id: `openai-compatible:${providerModelId}`,
          provider: 'openai-compatible',
          provider_model_id: providerModelId,
          family: providerModelId.split('-')[0] || null,
          label: providerModelId,
          name: providerModelId,
          capabilities: inferCapabilities(providerModelId),
          context_window: null,
          local: false,
          available: true,
          endpoint_ref: endpointRef
        });
      }));
    },

    async invoke(request) {
      const modelId = request.model_id;
      const providerModelId = String(modelId).startsWith('openai-compatible:')
        ? String(modelId).slice('openai-compatible:'.length)
        : String(modelId);

      const body = {
        model: providerModelId,
        messages: normalizeMessages(request),
        temperature: request.options.temperature,
        max_tokens: request.options.max_output_tokens
      };

      if (request.response_format === 'json') {
        body.response_format = { type: 'json_object' };
      }
      if (Array.isArray(request.tools) && request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.input_schema || { type: 'object', properties: {} }
          }
        }));
      }

      const response = await requestJson(
        baseUrl,
        'POST',
        '/chat/completions',
        apiKey,
        body,
        request.options.timeout_ms || INFERENCE_TIMEOUT_MS
      );

      return mapResponseToResult(modelId, providerModelId, response);
    }
  };
}

module.exports = {
  createOpenAICompatibleAdapter,
  resolveApiKey,
  inferCapabilities,
  DEFAULT_BASE_URL,
  HEALTH_TIMEOUT_MS,
  LIST_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS
};
