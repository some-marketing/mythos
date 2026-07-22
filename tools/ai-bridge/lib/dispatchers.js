'use strict';

/**
 * dispatchers.js
 *
 * Dispatcher registry for the cross-AI dispatch system.
 *
 * Provides a single entry point to look up the correct dispatcher
 * for a given provider name. Each dispatcher must implement:
 *
 *   dispatch(request) -> DispatchResult
 *
 * where request is a DispatchRequest and the return value is a DispatchResult,
 * both defined in dispatch-contract.js.
 *
 * Currently registered:
 *   - 'ollama': Generic model-runtime dispatcher
 *   - 'openai-compatible': Generic model-runtime dispatcher
 *   - 'openrouter': Generic model-runtime dispatcher
 *
 * Not implemented in this export slice (will produce a `not_implemented`
 * DispatchResult rather than error):
 *   - 'gemini-browser': A Playwright-driven Gemini dispatcher exists in the
 *     private original but is out of scope for this port — see
 *     adapters/gemini-api.js for the API-key-based Gemini path instead.
 *   - 'perplexity': Planned for research workflows
 *   - 'chatgpt-api': Planned for QA/review workflows
 *   - 'claude-api': Planned for Agent SDK delegation
 *   - 'codex': Planned dispatch surface for a harness-CLI actor
 */

const { VALID_PROVIDERS, createNotImplementedResult } = require('./dispatch-contract');
const { createDispatchResult } = require('./dispatch-contract');
const { getGenericProviderAdapters } = require('./model-runtime');
const { resolveModelSelection } = require('./model-registry');

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Lazy-loaded dispatcher map.
 * Dispatchers are loaded on first access to avoid requiring Playwright
 * or other heavy dependencies when they are not needed.
 */
const dispatcherCache = {};

/**
 * Map of provider names to their module paths.
 * '__generic__' providers are wired through the shared model-runtime adapter
 * layer (lib/model-runtime.js). `null` means registered but not implemented
 * in this export slice — dispatching to it returns a `not_implemented`
 * DispatchResult rather than throwing.
 */
const DISPATCHER_MODULES = {
  'gemini-browser': null,
  'openai-compatible': '__generic__',
  'perplexity': null,
  'chatgpt-api': null,
  'claude-api': null,
  'ollama': '__generic__',
  'openrouter': '__generic__',
  'codex': null
};

function createGenericDispatcher(provider) {
  return {
    provider,
    implemented: true,
    dispatch: async (request) => {
      const adapters = getGenericProviderAdapters();
      const adapter = adapters[provider];
      if (!adapter) {
        return createDispatchResult({
          provider,
          workflow_type: request.workflow_type,
          status: 'error',
          response: null,
          validation: null,
          artifacts: [],
          metadata: {
            message: `Generic adapter "${provider}" is not available in this runtime.`,
            timestamp: new Date().toISOString()
          }
        });
      }

      const selectionBundle = await resolveModelSelection(request.workflow_type, {
        model: request.model_id || request.requested_model || '',
        adapters: { [provider]: adapter }
      });

      if (!selectionBundle || !selectionBundle.selection || !selectionBundle.descriptor) {
        return createDispatchResult({
          provider,
          workflow_type: request.workflow_type,
          status: 'error',
          response: null,
          validation: null,
          artifacts: [],
          metadata: {
            selection: selectionBundle ? selectionBundle.selection : null,
            message: selectionBundle && selectionBundle.selection
              ? selectionBundle.selection.reason
              : `No model could be resolved for provider "${provider}".`,
            timestamp: new Date().toISOString()
          }
        });
      }

      const result = await adapter.invoke({
        model_id: selectionBundle.descriptor.id,
        workflow_type: request.workflow_type,
        system_prompt: request.options && request.options.system_prompt ? request.options.system_prompt : null,
        user_prompt: request.prompt,
        response_format: request.options && request.options.response_format ? request.options.response_format : 'text',
        tools: request.options && Array.isArray(request.options.tools) ? request.options.tools : [],
        messages: request.options && Array.isArray(request.options.messages) ? request.options.messages : [],
        options: request.options || {}
      });

      return createDispatchResult({
        provider,
        workflow_type: request.workflow_type,
        status: result.status === 'success' ? 'success' : 'error',
        response: {
          output_text: result.output_text,
          output_json: result.output_json,
          tool_calls: result.tool_calls || []
        },
        validation: null,
        artifacts: [],
        metadata: {
          selection: selectionBundle.selection,
          usage: result.usage || null,
          latency_ms: result.latency_ms,
          provider_model_id: result.provider_model_id,
          error: result.error || null,
          timestamp: new Date().toISOString()
        }
      });
    }
  };
}

/**
 * Get the dispatcher for a given provider.
 *
 * @param {string} provider - Provider name (must be in VALID_PROVIDERS)
 * @returns {object} A dispatcher object with a dispatch(request) method
 * @throws {Error} If the provider is unknown (not in VALID_PROVIDERS)
 * @throws {Error} If the provider is registered but not implemented
 */
function getDispatcher(provider) {
  if (!provider) {
    throw new Error('getDispatcher requires a provider name');
  }

  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unknown provider: "${provider}". ` +
      `Registered providers: ${VALID_PROVIDERS.join(', ')}. ` +
      `To add a new provider, register it in dispatch-contract.js and create a dispatcher.`
    );
  }

  const modulePath = DISPATCHER_MODULES[provider];

  if (modulePath === '__generic__') {
    return createGenericDispatcher(provider);
  }

  if (!modulePath) {
    // Provider is registered but not implemented.
    // Return a stub dispatcher that produces a not_implemented result.
    return {
      provider,
      implemented: false,
      dispatch: async (request) => {
        return createNotImplementedResult(provider, request.workflow_type);
      }
    };
  }

  // Lazy-load the dispatcher module
  if (!dispatcherCache[provider]) {
    try {
      const mod = require(modulePath);
      dispatcherCache[provider] = mod;
    } catch (err) {
      throw new Error(
        `Failed to load dispatcher for "${provider}" from ${modulePath}: ${err.message}`
      );
    }
  }

  return dispatcherCache[provider];
}

/**
 * List all registered providers and their implementation status.
 *
 * @returns {Array<{provider: string, implemented: boolean, module: string|null}>}
 */
function listProviders() {
  return VALID_PROVIDERS.map(provider => ({
    provider,
    implemented: DISPATCHER_MODULES[provider] !== null,
    module: DISPATCHER_MODULES[provider] || null
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getDispatcher,
  listProviders
};
