#!/usr/bin/env node
/**
 * Memory-firewall validator for planet node BuildStateJson() output.
 * Ensures focal-mind HTTP requests contain only current-tick sensory
 * state and never include memory/history/context from prior ticks,
 * other planets, or Mythos memory surfaces.
 *
 * Usage: node tools/signals/validate-mind-memory-firewall.js [--fixture <path>]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_KEYS = new Set([
  'energy', 'energy_fraction',
  'self', 'x', 'y', 'z',
  'perception', 'type', 'dist',
  'legal_actions',
  'run_id', 'node_id', 'tick', 'elapsed_s',
]);

const FORBIDDEN_KEYS = new Set([
  'history', 'memory', 'memories', 'context',
  'previous_decisions', 'prior_ticks', 'prior',
  'parent_context', 'parent', 'ancestor',
  'sm_os_memory', 'Mythos', 'lessons', 'concepts',
  'other_planets', 'neighbor_states',
  'world_state_minds', 'world_state',
  'chat_history', 'conversation', 'transcript',
  'csv_rows', 'telemetry_cache',
  'vector_store', 'embeddings', 'rag',
  'chain_of_thought', 'cot', 'reasoning',
  'plan_cache', 'plan', 'task_plan',
]);

function collectKeys(obj, prefix = '') {
  const keys = [];
  if (obj === null || obj === undefined) return keys;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      keys.push(...collectKeys(obj[i], prefix + `[${i}]`));
    }
  } else if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      keys.push(full);
      keys.push(...collectKeys(v, full));
    }
  }
  return keys;
}

function validate(fixture) {
  const allKeys = collectKeys(fixture);
  const found = [];
  const forbidden = [];

  for (const k of allKeys) {
    // Extract leaf key name
    const leaf = k.split('.').pop().split('[')[0];
    if (FORBIDDEN_KEYS.has(leaf)) {
      forbidden.push({ key: k, leaf });
    } else if (!ALLOWED_KEYS.has(leaf) && leaf.match(/^[a-z]/)) {
      found.push({ key: k, leaf, note: 'unrecognized (not in allowlist, not forbidden)' });
    }
  }

  return { forbidden, unrecognized: found, totalKeys: allKeys.length };
}

function main() {
  const args = process.argv.slice(2);
  const fixturePath = args[args.indexOf('--fixture') + 1] || path.join(__dirname, '..', '_dev', 'planet-nodes', 'test', 'clean-fixture.json');

  if (!fs.existsSync(fixturePath)) {
    console.log(`Fixture not found: ${fixturePath} — running with built-in example.`);
    runBuiltIn();
    return;
  }

  const raw = fs.readFileSync(fixturePath, 'utf8');
  const fixture = JSON.parse(raw);
  runValidation(fixture);
}

function runBuiltIn() {
  // Valid fixture (should pass)
  const valid = {
    run_id: 'fresh-20260606T000000',
    node_id: 'catworld-01',
    tick: 120,
    elapsed_s: 60.0,
    energy: 85.3,
    energy_fraction: 0.71,
    self: { x: 245.6, y: -180.2 },
    perception: [
      { type: 'food', x: 280.0, y: -170.0, dist: 36.1 },
      { type: 'creature', x: 300.0, y: -200.0, dist: 58.2, energy_fraction: 0.55, is_focal: false }
    ],
    legal_actions: ['move_to', 'wait', 'eat']
  };

  // Contaminated fixture (should fail)
  const contaminated = {
    ...valid,
    history: [{ tick: 119, action: 'move_to', x: 240, y: -175 }],
    memory: 'previous run had 1200 births',
    sm_os_memory: { concepts: ['planet-nodes'] },
    chain_of_thought: 'I think I should eat because energy is dropping...',
    parent_context: 'The operator wants divergence studies'
  };

  console.log('=== VALID FIXTURE ===');
  const vResult = validate(valid);
  console.log(`Keys: ${vResult.totalKeys}  Forbidden: ${vResult.forbidden.length}  Unrecognized: ${vResult.unrecognized.length}`);
  if (vResult.forbidden.length > 0) {
    console.error('FAIL: forbidden keys found in valid fixture');
    vResult.forbidden.forEach(f => console.error(`  ${f.key}`));
    process.exit(1);
  }
  console.log('PASS');

  console.log('');
  console.log('=== CONTAMINATED FIXTURE ===');
  const cResult = validate(contaminated);
  console.log(`Keys: ${cResult.totalKeys}  Forbidden: ${cResult.forbidden.length}  Unrecognized: ${cResult.unrecognized.length}`);
  if (cResult.forbidden.length === 0) {
    console.error('FAIL: expected forbidden keys not detected');
    process.exit(1);
  }
  cResult.forbidden.forEach(f => console.log(`  FORBIDDEN: ${f.key}`));
  console.log('PASS — contamination caught');
}

function runValidation(fixture) {
  const result = validate(fixture);
  console.log(`Keys: ${result.totalKeys}  Forbidden: ${result.forbidden.length}  Unrecognized: ${result.unrecognized.length}`);
  
  if (result.forbidden.length) {
    console.error('FORBIDDEN KEYS:');
    result.forbidden.forEach(f => console.error(`  ${f.key}`));
  }
  if (result.unrecognized.length) {
    console.log('UNRECOGNIZED KEYS (not in allowlist):');
    result.unrecognized.forEach(f => console.log(`  ${f.key} — ${f.note}`));
  }

  const pass = result.forbidden.length === 0;
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main();
