'use strict';

/**
 * provider-adapter.js — the Tool Broker's Provider Adapter (sovereign-core-harness
 * concept §"The Tool Broker", layer 1; plan P2 step 2).
 *
 * TRANSPORT ONLY. ZERO SYSTEM AUTHORITY. This module talks to the model runtime
 * (OpenRouter / config-ready Ollama, both fronted by the LiteLLM gateway),
 * packages the prompt + tool schema, invokes the model, and PARSES the model's
 * tool-use payload into structured *proposed actions*. It can propose an action;
 * it can never perform one. It performs no filesystem writes, spawns no
 * processes, and mutates no repo state — by construction (this module imports no
 * `fs`, no `child_process`, no repo-mutating primitive). Everything it returns is
 * a proposal handed UP to the Tool Broker, which is the only component that may
 * rule on and (for read-only actions) execute anything.
 *
 * It reuses the existing provider/transport surface rather than forking one:
 *   - createModelRequest / MODEL result shapes from ../../ai-bridge/lib/provider-contract
 *   - createOpenAICompatibleAdapter from ../../ai-bridge/adapters/openai-compatible
 * pointed at the LiteLLM gateway. The gateway's virtual key is attached as the
 * bearer credential; the active cascade correlation id is injected as LiteLLM
 * metadata (via the adapter's built-in litellm-trace-metadata wiring), so the
 * model call joins the shared span tree and cost attributes per request.
 */

const crypto = require('crypto');
const { createModelRequest } = require('../../ai-bridge/lib/provider-contract');
const { createOpenAICompatibleAdapter } = require('../../ai-bridge/adapters/openai-compatible');

const DEFAULT_GATEWAY_BASE = process.env.MYTHOS_LITELLM_BASE || 'http://127.0.0.1:4010';

/**
 * Parse a model result's tool_calls (and an optional text body) into structured
 * ProposedAction records. A ProposedAction is a NON-AUTHORITATIVE description of
 * something the model would like done — never an execution.
 *
 * @param {object} modelResult - a ModelResult from the openai-compatible adapter
 * @returns {{ proposals: Array, analysis_text: (string|null) }}
 */
function parseProposals(modelResult) {
  const proposals = [];
  const toolCalls = Array.isArray(modelResult.tool_calls) ? modelResult.tool_calls : [];
  for (const call of toolCalls) {
    const tool = call && call.name ? String(call.name) : 'unknown';
    const args = call && call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
    proposals.push({
      tool,
      arguments: args,
      summary: typeof args.summary === 'string'
        ? args.summary
        : `model proposes tool "${tool}"`
    });
  }
  const analysisText = typeof modelResult.output_text === 'string' && modelResult.output_text.trim()
    ? modelResult.output_text
    : null;
  // A pure-analysis response (no tool_calls) is itself a read-only proposal: the
  // model proposes emitting its analysis as a durable artifact. The broker still
  // rules on it (phase-1 allows analysis emission).
  if (proposals.length === 0 && analysisText) {
    proposals.push({
      tool: 'analysis.emit',
      arguments: { text: analysisText },
      summary: 'model proposes emitting a read-only analysis artifact'
    });
  }
  return { proposals, analysis_text: analysisText };
}

/**
 * createProviderAdapter — build a transport-only adapter bound to the LiteLLM
 * gateway.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]      LiteLLM gateway base (default MYTHOS_LITELLM_BASE or 127.0.0.1:4010)
 * @param {string} [opts.virtualKey]   the gateway virtual key (default LITELLM_MASTER_KEY)
 * @param {string} [opts.modelFamily]  mind family label recorded on proposals (e.g. 'gpt', 'gemini', 'local-qwen')
 * @param {object} [opts.transport]    injectable openai-compatible adapter (tests supply a mock)
 */
function createProviderAdapter(opts = {}) {
  const baseUrl = opts.baseUrl || DEFAULT_GATEWAY_BASE;
  const virtualKey = opts.virtualKey || process.env.LITELLM_MASTER_KEY || '';
  const modelFamily = opts.modelFamily || null;

  // The transport is the shared openai-compatible adapter, pointed at LiteLLM.
  // opts.litellm:true forces the correlation-id -> LiteLLM metadata injection on
  // (the adapter otherwise gates it to litellm-looking hostnames; a 127.0.0.1
  // gateway would not match). Tests inject a mock via opts.transport.
  const transport = opts.transport || createOpenAICompatibleAdapter({
    baseUrl,
    apiKey: virtualKey,
    endpointRef: 'MYTHOS_LITELLM_BASE',
    litellm: true
  });

  return {
    baseUrl,
    hasVirtualKey() { return Boolean(virtualKey); },

    /**
     * propose — run ONE model call and return the model's proposed actions.
     * Returns transport failures as { status: 'error'|'unreachable', ... } WITHOUT
     * throwing, so the broker can record a truthful failure span.
     *
     * @param {object} params
     * @param {string} params.model            gateway model_name (e.g. 'analysis-small')
     * @param {string} [params.system_prompt]
     * @param {string} params.user_prompt
     * @param {Array}  [params.tools]          tool schemas offered to the model
     * @param {string} [params.request_id]     caller-supplied id for cost attribution (generated if absent)
     * @param {object} [params.options]        transport options (temperature, timeout_ms, ...)
     */
    async propose(params = {}) {
      const requestId = params.request_id || crypto.randomUUID();
      const request = createModelRequest({
        model_id: params.model,
        workflow_type: 'analysis',
        system_prompt: params.system_prompt || null,
        user_prompt: params.user_prompt,
        tools: Array.isArray(params.tools) ? params.tools : [],
        options: {
          temperature: 0.2,
          max_output_tokens: 2000,
          timeout_ms: 120000,
          ...(params.options || {})
        }
      });

      const result = await transport.invoke(request);
      const { proposals, analysis_text } = parseProposals(result);

      return {
        status: result.status,               // 'success' | 'error' | 'unsupported' | 'unreachable'
        request_id: requestId,
        model: params.model,
        model_family: modelFamily,
        proposals,
        analysis_text,
        usage: result.usage || null,
        error: result.error || null,
        // The LiteLLM-side request id, when the gateway echoed one in the body.
        gateway_request_id: (result.metadata && result.metadata.response_id) || null
      };
    }
  };
}

module.exports = {
  createProviderAdapter,
  parseProposals,
  DEFAULT_GATEWAY_BASE
};
