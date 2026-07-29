'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  CURRENT_GEMINI_BRIDGE_MODELS,
  DEFAULT_GEMINI_BRIDGE_MODEL,
  GEMINI_BRIDGE_MODEL_SOURCE,
  isCurrentGeminiBridgeModel,
  isStaleGeminiBridgeModel,
  resolveGeminiBridgeModel,
  validateGeminiBridgeModel
} = require('../gemini-model-policy');
const {
  DEFAULT_MODEL
} = require('../../run-gemini-bridge');

describe('Gemini bridge model policy', () => {
  it('uses a current Gemini 3 local CLI target as the bridge default', () => {
    assert.equal(DEFAULT_GEMINI_BRIDGE_MODEL, 'gemini-3-pro-preview');
    assert.equal(DEFAULT_MODEL, DEFAULT_GEMINI_BRIDGE_MODEL);
    assert.ok(CURRENT_GEMINI_BRIDGE_MODELS.includes(DEFAULT_MODEL));
    assert.equal(isCurrentGeminiBridgeModel(DEFAULT_MODEL), true);
  });

  it('rejects stale Gemini bridge defaults that require a docs check before reuse', () => {
    const validation = validateGeminiBridgeModel('gemini-2.5-pro');

    assert.equal(isStaleGeminiBridgeModel('gemini-2.5-pro'), true);
    assert.equal(validation.valid, false);
    assert.match(validation.reason, /stale/i);
    assert.throws(
      () => resolveGeminiBridgeModel('gemini-2.5-pro'),
      /stale/i
    );
  });

  it('requires unknown model names to be added through the documented policy', () => {
    const validation = validateGeminiBridgeModel('gemini-made-up-model');

    assert.equal(validation.valid, false);
    assert.match(validation.reason, /not in the current allowlist for gemini\/local-cli/i);
    assert.match(validation.reason, /ai\.google\.dev\/gemini-api\/docs\/models/);
    assert.match(validation.reason, /developers\.google\.com\/gemini-code-assist\/docs\/gemini-3/);
  });

  it('records the documentation sources used for the current allowlist', () => {
    assert.equal(GEMINI_BRIDGE_MODEL_SOURCE.checked_at, '2026-04-22');
    assert.match(GEMINI_BRIDGE_MODEL_SOURCE.model_docs, /ai\.google\.dev\/gemini-api\/docs\/models/);
    assert.match(GEMINI_BRIDGE_MODEL_SOURCE.cli_docs, /developers\.google\.com\/gemini-code-assist\/docs\/gemini-3/);
  });
});
