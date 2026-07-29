'use strict';

/**
 * dispatch-contract.js
 *
 * Shared dispatch contract for the cross-AI dispatch system.
 *
 * Defines the shapes that all dispatchers must accept (DispatchRequest)
 * and return (DispatchResult). These are the stable interfaces that
 * prevent provider-specific duplication.
 *
 * Specialized browser providers and generic text-model providers both use this
 * contract. Generic providers can additionally receive a resolved model target
 * through `model_id` or `requested_model`.
 *
 * Adding a new provider:
 *   1. Add the provider name to VALID_PROVIDERS
 *   2. Create a dispatcher in dispatchers/{provider}.js
 *   3. Register it in lib/dispatchers.js
 *   4. The dispatcher must accept a DispatchRequest and return a DispatchResult
 */

// ---------------------------------------------------------------------------
// Valid enums
// ---------------------------------------------------------------------------

/**
 * Workflow types supported by the dispatch system.
 * Extensible — add new types as workflows are proven.
 */
const VALID_WORKFLOW_TYPES = [
  'design',          // Visual/CSS refinement (Gemini's current workflow)
  'research',        // Deep factual research with citations (future: Perplexity)
  'analysis',        // Structural review, QA, prompt refinement (future: ChatGPT)
  'classification',  // Extraction, categorization, labeling (local-model candidate)
  'drafting',        // Low-risk first-draft writing, summarization (local-model candidate)
  'verification'     // Bounded first-pass review: artifact-in, structured verdict-out (local-model verifier lane)
];

/**
 * Provider identifiers.
 * 'gemini-browser' is the only implemented provider.
 * Others are registered for forward compatibility but will error if dispatched.
 */
const VALID_PROVIDERS = [
  'gemini-browser',  // Implemented — Playwright-driven Gemini interaction
  'openai-compatible', // Implemented — generic chat-completions compatible runtime
  'perplexity',      // Not implemented — planned for research workflows
  'chatgpt-api',     // Not implemented — planned for QA/review workflows
  'claude-api',      // Not implemented — planned for Agent SDK delegation
  'ollama',          // Implemented — generic local-model provider
  'openrouter',      // Implemented — OpenRouter (openai-compatible wire) as first-class provider (mind-router S5)
  'codex'            // Not implemented — planned for review/classification dispatch
];

/**
 * Dispatch statuses.
 */
const DISPATCH_STATUSES = [
  'success',         // Dispatch completed and response is available
  'validation_fail', // Dispatch completed but response failed validation
  'error',           // Dispatch failed (session, timeout, transport issue)
  'not_implemented'  // Provider is registered but has no dispatcher yet
];

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a DispatchRequest.
 *
 * @param {object} fields
 * @param {string} fields.provider      - Provider identifier (must be in VALID_PROVIDERS)
 * @param {string} fields.workflow_type - Workflow type (must be in VALID_WORKFLOW_TYPES)
 * @param {object} fields.context       - Workflow context (evidence dir, URLs, project info, etc.)
 * @param {string} fields.prompt        - The prompt text or path to prompt file
 * @param {string} [fields.model_id]    - Resolved normalized model id for generic providers
 * @param {string} [fields.requested_model] - Requested model override before resolution
 * @param {object} [fields.options]     - Provider-specific options (images, timeout, storage path, etc.)
 * @returns {object} A validated DispatchRequest
 */
function createDispatchRequest(fields) {
  const { provider, workflow_type, context, prompt, model_id, requested_model, options, actor_id } = fields || {};

  if (!provider) {
    throw new Error('DispatchRequest requires a provider');
  }
  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unknown provider: "${provider}". Valid providers: ${VALID_PROVIDERS.join(', ')}`
    );
  }
  if (!workflow_type) {
    throw new Error('DispatchRequest requires a workflow_type');
  }
  if (!VALID_WORKFLOW_TYPES.includes(workflow_type)) {
    throw new Error(
      `Unknown workflow_type: "${workflow_type}". Valid types: ${VALID_WORKFLOW_TYPES.join(', ')}`
    );
  }
  if (!prompt && prompt !== '') {
    throw new Error('DispatchRequest requires a prompt (string or file path)');
  }

  return {
    provider,
    workflow_type,
    context: context || {},
    prompt,
    model_id: model_id || null,
    requested_model: requested_model || null,
    options: options || {},
    actor_id: actor_id || null
  };
}

/**
 * Create a DispatchResult.
 *
 * @param {object} fields
 * @param {string} fields.provider        - Provider that handled the dispatch
 * @param {string} fields.workflow_type   - Workflow type that was executed
 * @param {string} fields.status          - Outcome status (must be in DISPATCH_STATUSES)
 * @param {object} [fields.response]      - Provider response data (raw text, parsed, etc.)
 * @param {object} [fields.validation]    - Validation results (checks, pass/fail, etc.)
 * @param {Array}  [fields.artifacts]     - Artifact paths produced (files written, etc.)
 * @param {object} [fields.metadata]      - Timing, conversation URL, iteration count, etc.
 * @returns {object} A validated DispatchResult
 */
function createDispatchResult(fields) {
  const { provider, workflow_type, status, response, validation, artifacts, metadata, actor_id } = fields || {};

  if (!provider) {
    throw new Error('DispatchResult requires a provider');
  }
  if (!workflow_type) {
    throw new Error('DispatchResult requires a workflow_type');
  }
  if (!status) {
    throw new Error('DispatchResult requires a status');
  }
  if (!DISPATCH_STATUSES.includes(status)) {
    throw new Error(
      `Unknown status: "${status}". Valid statuses: ${DISPATCH_STATUSES.join(', ')}`
    );
  }

  return {
    provider,
    workflow_type,
    status,
    response: response || null,
    validation: validation || null,
    artifacts: artifacts || [],
    metadata: metadata || {},
    actor_id: actor_id || null
  };
}

/**
 * Create a not-implemented DispatchResult for providers that are registered
 * but do not yet have a working dispatcher.
 *
 * @param {string} provider - The provider name
 * @param {string} workflow_type - The requested workflow type
 * @returns {object} A DispatchResult with status 'not_implemented'
 */
function createNotImplementedResult(provider, workflow_type) {
  return createDispatchResult({
    provider,
    workflow_type,
    status: 'not_implemented',
    response: null,
    validation: null,
    artifacts: [],
    metadata: {
      message: `Provider "${provider}" is registered but does not have an implemented dispatcher yet.`,
      timestamp: new Date().toISOString()
    }
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  VALID_WORKFLOW_TYPES,
  VALID_PROVIDERS,
  DISPATCH_STATUSES,
  createDispatchRequest,
  createDispatchResult,
  createNotImplementedResult
};
