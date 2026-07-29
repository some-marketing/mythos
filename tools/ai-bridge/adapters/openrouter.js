'use strict';

/**
 * openrouter.js — S5 of adaptive-mind-router: OpenRouter as a FIRST-CLASS
 * provider (previously reachable only through the convene bridge).
 *
 * OpenRouter speaks the openai-compatible wire protocol, so this adapter is
 * a thin preset over createOpenAICompatibleAdapter with OpenRouter's base
 * URL and the auth-resolution chain the convene bridge established:
 *   1. 1Password CLI (`op item get` — item titled "OpenRouter"/"Open Router")
 *   2. OPENROUTER_API_KEY env var
 *   3. legacy ~/.pi/agent/auth.json → auth.openrouter.key
 * Secrets stay local (constitutional rule): the key is resolved at invoke
 * time inside this process and never appears in logs, matrix data, or
 * dispatch artifacts.
 *
 * Minds-as-plugins: any `openrouter:<model-id>` mind (anthropic/claude-*,
 * openai/gpt-*, google/gemini-*, meta-llama/*, …) becomes routable through
 * the standard dispatch contract — anyone with any API key can plug in.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { createOpenAICompatibleAdapter } = require('./openai-compatible');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function resolveApiKey() {
  // 1) 1Password CLI — same item titles the convene bridge uses.
  for (const title of ['OpenRouter', 'Open Router']) {
    try {
      const res = spawnSync('op', ['item', 'get', title, '--fields', 'credential', '--reveal'],
        { encoding: 'utf8', timeout: 8000 });
      const key = (res.stdout || '').trim();
      if (res.status === 0 && key) return key;
    } catch { /* op unavailable — fall through */ }
  }
  // 2) environment variable
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  // 3) legacy pi auth file
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pi', 'agent', 'auth.json'), 'utf8'));
    const key = auth && auth.openrouter && auth.openrouter.key;
    if (key) return String(key).trim();
  } catch { /* no legacy file */ }
  return '';
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
