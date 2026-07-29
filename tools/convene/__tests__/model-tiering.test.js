'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { MODEL_PINS_PATH, resolveConveneModel } = require('../lib/model-tiering');

describe('convene model tiering (adapted, config-driven)', () => {
  it('returns no pin when convene-model-pins.json is absent', () => {
    assert.equal(fs.existsSync(MODEL_PINS_PATH), false, 'test assumes no populated pins file is committed');
    assert.equal(resolveConveneModel({ actor: 'gemini', riskTier: 'high' }), '');
  });

  it('reads a user-populated pin for the matching risk tier', () => {
    const hadExisting = fs.existsSync(MODEL_PINS_PATH);
    const backupPath = `${MODEL_PINS_PATH}.bak-test`;
    if (hadExisting) fs.renameSync(MODEL_PINS_PATH, backupPath);
    try {
      fs.writeFileSync(MODEL_PINS_PATH, JSON.stringify({
        gemini: { high: 'gemini-pro-example', low: 'gemini-flash-example' }
      }));
      assert.equal(resolveConveneModel({ actor: 'gemini', riskTier: 'high' }), 'gemini-pro-example');
      assert.equal(resolveConveneModel({ actor: 'gemini', risk_tier: 'low' }), 'gemini-flash-example');
      assert.equal(resolveConveneModel({ actor: 'codex', riskTier: 'high' }), '');
    } finally {
      fs.rmSync(MODEL_PINS_PATH, { force: true });
      if (hadExisting) fs.renameSync(backupPath, MODEL_PINS_PATH);
    }
  });
});
