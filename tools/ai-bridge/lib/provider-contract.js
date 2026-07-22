'use strict';

/**
 * provider-contract.js — Provider capability and execution contract for Mythos.
 *
 * This module defines the normalized runtime shapes used by generic model
 * providers such as Ollama and OpenAI-compatible APIs. Browser-driven or other
 * specialized providers can still exist outside this contract, but generic text
 * execution should normalize into these shapes.
 */

const MODEL_CAPABILITIES = Object.freeze([
  'chat',
  'verification',
  'classification',
  'drafting',
  'analysis',
  'tool_calling',
  'streaming',
  'structured_output',
  'vision',
  'long_context'
]);

const MODEL_RESULT_STATUSES = Object.freeze([
  'success',
  'error',
  'unsupported',
  'unreachable'
]);

const MESSAGE_ROLES = Object.freeze(['system', 'user', 'assistant', 'tool']);
const RESPONSE_FORMATS = Object.freeze(['text', 'json']);

function dedupeStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()))];
}

function normalizeCapabilities(values) {
  const capabilities = dedupeStrings(values);
  for (const capability of capabilities) {
    if (!MODEL_CAPABILITIES.includes(capability)) {
      throw new Error(
        `Unknown model capability: "${capability}". Valid capabilities: ${MODEL_CAPABILITIES.join(', ')}`
      );
    }
  }
  return capabilities;
}

function createProviderInfo(fields) {
  const { name, type, version, endpoint } = fields || {};
  if (!name) throw new Error('ProviderInfo requires a name');
  if (!type || !['local', 'cloud'].includes(type)) {
    throw new Error('ProviderInfo requires type "local" or "cloud"');
  }
  return {
    name,
    type,
    version: version || null,
    endpoint: endpoint || null
  };
}

function createHealthStatus(fields) {
  const { reachable, latency_ms, error } = fields || {};
  return {
    reachable: Boolean(reachable),
    latency_ms: typeof latency_ms === 'number' ? latency_ms : null,
    error: error || null,
    checked_at: new Date().toISOString()
  };
}

function createModelDescriptor(fields) {
  const {
    id,
    provider,
    provider_model_id,
    family,
    label,
    name,
    capabilities,
    size_bytes,
    context_window,
    context_length,
    tool_calling,
    streaming,
    structured_output,
    vision,
    local,
    available,
    endpoint_ref,
    default_params
  } = fields || {};

  if (!id) throw new Error('ModelDescriptor requires an id');
  if (!provider) throw new Error('ModelDescriptor requires a provider');

  const normalizedCapabilities = normalizeCapabilities(capabilities);
  const normalizedContext = typeof context_window === 'number'
    ? context_window
    : (typeof context_length === 'number' ? context_length : null);

  return {
    id,
    provider,
    provider_model_id: provider_model_id || id,
    family: family || null,
    label: label || name || provider_model_id || id,
    name: name || label || provider_model_id || id,
    capabilities: normalizedCapabilities,
    size_bytes: typeof size_bytes === 'number' ? size_bytes : null,
    context_window: normalizedContext,
    context_length: normalizedContext,
    tool_calling: typeof tool_calling === 'boolean'
      ? tool_calling
      : normalizedCapabilities.includes('tool_calling'),
    streaming: typeof streaming === 'boolean'
      ? streaming
      : normalizedCapabilities.includes('streaming'),
    structured_output: typeof structured_output === 'boolean'
      ? structured_output
      : normalizedCapabilities.includes('structured_output'),
    vision: typeof vision === 'boolean'
      ? vision
      : normalizedCapabilities.includes('vision'),
    local: typeof local === 'boolean' ? local : provider === 'ollama',
    available: typeof available === 'boolean' ? available : true,
    endpoint_ref: endpoint_ref || null,
    default_params: default_params && typeof default_params === 'object' ? { ...default_params } : {}
  };
}

function createModelEntry(fields) {
  return createModelDescriptor(fields);
}

function createModelInventory(models) {
  const entries = Array.isArray(models) ? models : [];
  return {
    models: entries,
    total: entries.length,
    checked_at: new Date().toISOString()
  };
}

function createModelRequest(fields) {
  const {
    model_id,
    workflow_type,
    system_prompt,
    user_prompt,
    messages,
    response_format,
    tools,
    images,
    options
  } = fields || {};

  if (!model_id) throw new Error('ModelRequest requires a model_id');
  if (!workflow_type) throw new Error('ModelRequest requires a workflow_type');
  if (!user_prompt && !Array.isArray(messages)) {
    throw new Error('ModelRequest requires user_prompt or messages');
  }

  const normalizedMessages = Array.isArray(messages)
    ? messages.map((message, index) => {
        if (!message || typeof message !== 'object') {
          throw new Error(`ModelRequest.messages[${index}] must be an object`);
        }
        if (!MESSAGE_ROLES.includes(message.role)) {
          throw new Error(
            `ModelRequest.messages[${index}].role must be one of: ${MESSAGE_ROLES.join(', ')}`
          );
        }
        if (typeof message.content !== 'string') {
          throw new Error(`ModelRequest.messages[${index}].content must be a string`);
        }
        return {
          role: message.role,
          content: message.content
        };
      })
    : [];

  const format = response_format || 'text';
  if (!RESPONSE_FORMATS.includes(format)) {
    throw new Error(`ModelRequest.response_format must be one of: ${RESPONSE_FORMATS.join(', ')}`);
  }

  return {
    model_id,
    workflow_type,
    system_prompt: typeof system_prompt === 'string' ? system_prompt : null,
    user_prompt: typeof user_prompt === 'string' ? user_prompt : null,
    messages: normalizedMessages,
    response_format: format,
    tools: Array.isArray(tools) ? tools.map((tool) => ({ ...tool })) : [],
    images: Array.isArray(images) ? images.map((image) => ({ ...image })) : [],
    options: options && typeof options === 'object' ? { ...options } : {}
  };
}

function createModelResult(fields) {
  const {
    status,
    provider,
    model_id,
    provider_model_id,
    output_text,
    output_json,
    tool_calls,
    usage,
    latency_ms,
    error,
    metadata
  } = fields || {};

  if (!provider) throw new Error('ModelResult requires a provider');
  if (!model_id) throw new Error('ModelResult requires a model_id');
  if (!provider_model_id) throw new Error('ModelResult requires a provider_model_id');
  if (!status || !MODEL_RESULT_STATUSES.includes(status)) {
    throw new Error(
      `ModelResult requires status: ${MODEL_RESULT_STATUSES.join(', ')}. Got: "${status}"`
    );
  }

  return {
    status,
    provider,
    model_id,
    provider_model_id,
    output_text: typeof output_text === 'string' ? output_text : null,
    output_json: output_json && typeof output_json === 'object' ? output_json : null,
    tool_calls: Array.isArray(tool_calls) ? tool_calls.map((tool) => ({ ...tool })) : [],
    usage: usage && typeof usage === 'object' ? { ...usage } : null,
    latency_ms: typeof latency_ms === 'number' ? latency_ms : null,
    error: error && typeof error === 'object'
      ? {
          code: error.code || 'unknown_error',
          message: error.message || 'Unknown provider error',
          retryable: Boolean(error.retryable)
        }
      : null,
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {}
  };
}

function createModelSelection(fields) {
  const {
    requested_model,
    resolved_model_id,
    resolved_provider,
    workflow_type,
    selection_source,
    fallback_chain,
    required_capabilities,
    reason
  } = fields || {};

  if (!workflow_type) throw new Error('ModelSelection requires a workflow_type');
  if (!selection_source) throw new Error('ModelSelection requires a selection_source');
  if (!reason) throw new Error('ModelSelection requires a reason');

  return {
    requested_model: requested_model || null,
    resolved_model_id: resolved_model_id || null,
    resolved_provider: resolved_provider || null,
    workflow_type,
    selection_source,
    fallback_chain: Array.isArray(fallback_chain) ? [...fallback_chain] : [],
    required_capabilities: normalizeCapabilities(required_capabilities),
    reason
  };
}

const providerRegistry = {};

function registerProvider(name, adapter) {
  if (!name) throw new Error('registerProvider requires a name');
  if (!adapter) throw new Error('registerProvider requires an adapter');

  const required = ['getInfo', 'checkHealth', 'listModels', 'invoke'];
  for (const method of required) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`Provider adapter "${name}" must implement ${method}()`);
    }
  }

  providerRegistry[name] = adapter;
}

function getProvider(name) {
  return providerRegistry[name] || null;
}

function listRegisteredProviders() {
  return Object.keys(providerRegistry);
}

async function checkProviderHealth(name) {
  const adapter = getProvider(name);
  if (!adapter) {
    return createHealthStatus({
      reachable: false,
      error: `Provider "${name}" is not registered`
    });
  }

  try {
    return await adapter.checkHealth();
  } catch (err) {
    return createHealthStatus({
      reachable: false,
      error: `Health check failed: ${err.message}`
    });
  }
}

async function checkAllProviderHealth() {
  const results = {};
  for (const name of listRegisteredProviders()) {
    results[name] = await checkProviderHealth(name);
  }
  return results;
}

async function invokeProvider(name, request) {
  const adapter = getProvider(name);
  if (!adapter) {
    return createModelResult({
      status: 'unreachable',
      provider: name,
      model_id: request && request.model_id ? request.model_id : `${name}:unknown`,
      provider_model_id: request && request.model_id ? request.model_id : 'unknown',
      error: {
        code: 'provider_not_registered',
        message: `Provider "${name}" is not registered`,
        retryable: false
      }
    });
  }

  try {
    return await adapter.invoke(createModelRequest(request));
  } catch (err) {
    return createModelResult({
      status: 'error',
      provider: name,
      model_id: request && request.model_id ? request.model_id : `${name}:unknown`,
      provider_model_id: request && request.model_id ? request.model_id : 'unknown',
      error: {
        code: 'provider_invoke_failed',
        message: err.message,
        retryable: false
      }
    });
  }
}

module.exports = {
  MODEL_CAPABILITIES,
  MODEL_RESULT_STATUSES,
  MESSAGE_ROLES,
  RESPONSE_FORMATS,
  createProviderInfo,
  createHealthStatus,
  createModelDescriptor,
  createModelEntry,
  createModelInventory,
  createModelRequest,
  createModelResult,
  createModelSelection,
  registerProvider,
  getProvider,
  listRegisteredProviders,
  checkProviderHealth,
  checkAllProviderHealth,
  invokeProvider
};
