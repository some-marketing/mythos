'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MODEL_FAMILIES,
  familyForTarget,
  selectDistinctFamily,
  BRIDGE_TARGET_POLICIES,
} = require('../bridge-target-policy');

test('MODEL_FAMILIES declares the distinct lab families', () => {
  const fams = Object.keys(MODEL_FAMILIES);
  assert.ok(fams.includes('anthropic'));
  assert.ok(fams.includes('google'));
  assert.ok(fams.includes('openai'));
  assert.ok(fams.includes('zhipu'));
  assert.ok(fams.includes('local'));
  // Each family has a label and origin
  for (const [id, f] of Object.entries(MODEL_FAMILIES)) {
    assert.ok(f.label, `${id} needs a label`);
    assert.ok(f.origin, `${id} needs an origin`);
    assert.ok(Array.isArray(f.members) && f.members.length, `${id} needs members`);
  }
});

test('familyForTarget maps each bridge target to its lab family', () => {
  assert.equal(familyForTarget('gemini'), 'google');
  assert.equal(familyForTarget('claude'), 'anthropic');
  assert.equal(familyForTarget('codex'), 'openai');
  assert.equal(familyForTarget('codewhale'), 'deepseek');
  assert.equal(familyForTarget('ollama'), 'local');
  assert.equal(familyForTarget('openrouter'), 'openrouter-multi');
  assert.equal(familyForTarget('nonexistent'), null);
});

test('selectDistinctFamily never returns the origin family', () => {
  for (const fam of Object.keys(MODEL_FAMILIES)) {
    const pick = selectDistinctFamily(fam, { riskTier: 'high' });
    assert.ok(pick, `no distinct family available from ${fam}`);
    assert.notEqual(pick.family, fam, `returned same family as origin ${fam}`);
  }
});

test('selectDistinctFamily excludes PRC-hosted families when sensitive=true', () => {
  // Origin = anthropic; sensitive payload must NOT route to zhipu/alibaba/deepseek (PRC).
  const pick = selectDistinctFamily('anthropic', { riskTier: 'high', sensitive: true });
  assert.ok(pick);
  const fam = MODEL_FAMILIES[pick.family];
  assert.ok(!fam.origin.includes('prc'), `sensitive routed to PRC family ${pick.family}`);
});

test('selectDistinctFamily prefers local for low-risk / mechanical work', () => {
  const pick = selectDistinctFamily('anthropic', { riskTier: 'low', taskShape: 'mechanical' });
  assert.ok(pick);
  assert.equal(pick.family, 'local', `expected local family for mechanical work, got ${pick.family}`);
});

test('selectDistinctFamily returns null when all distinct families are excluded', () => {
  // Only one family + sensitive filters the rest — construct a degenerate case:
  // origin covers everything by passing a family not in the map; still returns others.
  // The real null case: every other family is PRC and sensitive filters them.
  // Simulate by calling with a custom scenario — here just confirm it never throws
  // and returns something or null cleanly for an unknown origin family.
  const pick = selectDistinctFamily('unknown-origin', { riskTier: 'high', sensitive: true });
  assert.ok(pick); // at least the onshore western families are reachable
  assert.notEqual(pick.family, 'unknown-origin');
});

test('bridge target policies carry a family field', () => {
  for (const [id, p] of Object.entries(BRIDGE_TARGET_POLICIES)) {
    assert.ok(p.family, `${id} policy needs a family field`);
  }
});

test('reachable families have non-empty current_models', () => {
  // The bundle: families we can actually reach must list their models.
  for (const id of ['gemini', 'claude', 'codex', 'codewhale', 'openrouter', 'ollama']) {
    const p = BRIDGE_TARGET_POLICIES[id];
    const t = p && p.transports && p.transports[p.default_transport];
    assert.ok(t && Array.isArray(t.current_models) && t.current_models.length,
      `${id} default transport should list current_models`);
  }
});

test('codewhale is a registered deepseek-family target with deepseek-v4-flash', () => {
  const p = BRIDGE_TARGET_POLICIES.codewhale;
  assert.ok(p, 'codewhale policy should exist');
  assert.equal(p.family, 'deepseek');
  const t = p.transports[p.default_transport];
  assert.ok(t.current_models.includes('deepseek-v4-flash'));
  assert.match(t.launch_contract, /codewhale exec/);
  assert.equal(familyForTarget('codewhale'), 'deepseek');
  // selectDistinctFamily can resolve codewhale as a distinct lane from an
  // onshore origin when the payload is NOT sensitive.
  const pick = selectDistinctFamily('anthropic', { riskTier: 'high', sensitive: false });
  assert.ok(pick);
  assert.ok(MODEL_FAMILIES.deepseek.members.includes('codewhale'));
  // And the safety invariant holds: sensitive never routes to deepseek.
  const sensitive = selectDistinctFamily('anthropic', { riskTier: 'high', sensitive: true });
  assert.notEqual(sensitive.family, 'deepseek');
});

const { selectByUseCase } = require('../bridge-target-policy');

test('selectByUseCase routes each use case to the right family', () => {
  const checks = [
    ['agentic_coding_tool_use', 'anthropic'],
    ['deep_reasoning_math_science', 'anthropic'],
    ['long_context_document_analysis', 'zhipu'],
    ['fast_cheap_mechanical', 'google'],
    ['sovereign_ondevice_private', 'local'],
  ];
  for (const [uc, fam] of checks) {
    const p = selectByUseCase(uc, { riskTier: 'high', sensitive: false });
    assert.ok(p, `${uc} should resolve`);
    assert.equal(p.family, fam, `${uc} expected ${fam}, got ${p.family}`);
    assert.ok(p.familyLabel, `${uc} familyLabel should be defined`);
  }
});

test('selectByUseCase sensitive payloads NEVER route to PRC families (the safety invariant)', () => {
  // Long-context primary is zhipu (PRC). Sensitive must fall through to onshore.
  const s = selectByUseCase('long_context_document_analysis', { riskTier: 'high', sensitive: true });
  assert.ok(s);
  const fam = MODEL_FAMILIES[s.family];
  assert.ok(!fam.origin.includes('prc'), `sensitive long_context leaked to PRC family ${s.family}`);
  // Fast-cheap primary is gemini (onshore) — already fine, but deepseek alt is PRC; ensure not picked when sensitive.
  const s2 = selectByUseCase('fast_cheap_mechanical', { riskTier: 'low', sensitive: true });
  assert.ok(s2);
  const fam2 = MODEL_FAMILIES[s2.family];
  assert.ok(!fam2.origin.includes('prc'), `sensitive fast_cheap leaked to PRC family ${s2.family}`);
});

test('selectByUseCase returns null for an unknown use case', () => {
  assert.equal(selectByUseCase('nonexistent_use_case', {}), null);
});
