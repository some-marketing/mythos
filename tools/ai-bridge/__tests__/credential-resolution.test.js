'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { resolveCredentialsFromFile } = require('../../lib/resolve-credential.cjs');
const { resolveApiKey: resolveOpenRouterKey } = require('../adapters/openrouter');
const { resolveApiKey: resolveOpenAIKey, createOpenAICompatibleAdapter } = require('../adapters/openai-compatible');
const { loadApiKey: loadGeminiKey } = require('../adapters/gemini-api');

const CREDS_CONFIG_PATH = path.join(__dirname, '..', 'creds.config.json');

describe('ai-bridge credential resolution', () => {
  const savedEnv = {};
  const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENAI_COMPAT_API_KEY', 'GEMINI_API_KEY'];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (Object.prototype.hasOwnProperty.call(savedEnv, key)) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
        delete savedEnv[key];
      }
    }
  });

  function setEnv(key, value) {
    if (!Object.prototype.hasOwnProperty.call(savedEnv, key)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  function clearEnv(key) {
    if (!Object.prototype.hasOwnProperty.call(savedEnv, key)) savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  it('creds.config.json declares all three provider fields as optional', () => {
    // eslint-disable-next-line global-require
    const config = require(CREDS_CONFIG_PATH);
    assert.ok(config.fields.OPENROUTER_API_KEY);
    assert.ok(config.fields.OPENAI_API_KEY);
    assert.ok(config.fields.GEMINI_API_KEY);
    assert.equal(config.fields.OPENROUTER_API_KEY.required, false);
    assert.equal(config.fields.OPENAI_API_KEY.required, false);
    assert.equal(config.fields.GEMINI_API_KEY.required, false);
  });

  it('resolveCredentialsFromFile degrades to an empty object when every source misses, without throwing', () => {
    const runSecurity = () => { throw new Error('no keychain item'); };
    const runCommand = () => { throw new Error('op unavailable'); };
    const result = resolveCredentialsFromFile(CREDS_CONFIG_PATH, {
      env: {},
      runSecurity,
      runCommand,
      optional: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']
    });
    assert.deepEqual(result, {});
  });

  it('adapters/openrouter.js resolveApiKey() prefers OPENROUTER_API_KEY from the environment', () => {
    setEnv('OPENROUTER_API_KEY', 'test-openrouter-key');
    assert.equal(resolveOpenRouterKey(), 'test-openrouter-key');
  });

  it('adapters/openrouter.js resolveApiKey() never throws when no key is configured anywhere reachable', () => {
    clearEnv('OPENROUTER_API_KEY');
    assert.doesNotThrow(() => resolveOpenRouterKey());
  });

  it('adapters/openai-compatible.js resolveApiKey() honors OPENAI_COMPAT_API_KEY as a caller override before OPENAI_API_KEY', () => {
    setEnv('OPENAI_COMPAT_API_KEY', 'override-key');
    setEnv('OPENAI_API_KEY', 'base-key');
    assert.equal(resolveOpenAIKey(), 'override-key');
  });

  it('adapters/openai-compatible.js resolveApiKey() falls back to OPENAI_API_KEY when no override is set', () => {
    clearEnv('OPENAI_COMPAT_API_KEY');
    setEnv('OPENAI_API_KEY', 'base-key-only');
    assert.equal(resolveOpenAIKey(), 'base-key-only');
  });

  it('createOpenAICompatibleAdapter() accepts an explicit apiKey override and never leaks it in getInfo()', () => {
    const adapter = createOpenAICompatibleAdapter({ apiKey: 'explicit-key', baseUrl: 'http://example.invalid/v1' });
    const info = adapter.getInfo();
    assert.equal(info.name, 'openai-compatible');
    assert.ok(!JSON.stringify(info).includes('explicit-key'));
  });

  it('adapters/gemini-api.js loadApiKey() prefers GEMINI_API_KEY from the environment', () => {
    setEnv('GEMINI_API_KEY', 'test-gemini-key');
    assert.equal(loadGeminiKey(), 'test-gemini-key');
  });

  it('adapters/gemini-api.js loadApiKey() returns null (not throw) when unresolved', () => {
    clearEnv('GEMINI_API_KEY');
    assert.doesNotThrow(() => loadGeminiKey());
  });
});
