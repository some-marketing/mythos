'use strict';

/**
 * openrouter.js — OpenRouter as a first-class provider.
 *
 * OpenRouter speaks the openai-compatible wire protocol, so this adapter is a
 * thin preset over createOpenAICompatibleAdapter with OpenRouter's base URL.
 * Credential resolution delegates to the shared BYO-credential resolver
 * (tools/lib/resolve-credential.cjs) via this tool's own creds.config.json —
 * the same 4-source chain (env -> macOS Keychain -> 1Password -> env-file)
 * every other tool in this tree uses. Secrets stay local: the key is
 * resolved at invoke time inside this process and never appears in logs,
 * matrix data, or dispatch artifacts.
 *
 * Minds-as-plugins: any `openrouter:<model-id>` mind (anthropic/claude-*,
 * openai/gpt-*, google/gemini-*, meta-llama/*, …) becomes routable through
 * the standard dispatch contract — anyone with any API key can plug in.
 */

const path = require('path');
const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');

const { createOpenAICompatibleAdapter } = require('./openai-compatible');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Resolve the OpenRouter API key through the shared BYO-credential resolver.
 * Never throws — a missing key degrades to `hasCredentials() === false`
 * rather than blocking module load or adapter construction.
 */
function resolveApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try {
    const creds = resolveCredentialsFromFile(
      path.join(__dirname, '..', 'creds.config.json'),
      { optional: ['OPENROUTER_API_KEY'] }
    );
    return creds.OPENROUTER_API_KEY || '';
  } catch {
    return '';
  }
}

function createOpenRouterAdapter(opts = {}) {
  const apiKey = opts.apiKey || resolveApiKey();
  const base = createOpenAICompatibleAdapter({
    baseUrl: opts.baseUrl || OPENROUTER_BASE_URL,
    apiKey,
    endpointRef: 'OPENROUTER_API_KEY'
  });
  if (!base) return null;
  const info = base.getInfo;
  return {
    ...base,
    getInfo() {
      const i = info.call(base);
      return { ...i, name: 'openrouter' };
    },
    hasCredentials() {
      return Boolean(apiKey);
    }
  };
}

module.exports = { createOpenRouterAdapter, resolveApiKey, OPENROUTER_BASE_URL };
