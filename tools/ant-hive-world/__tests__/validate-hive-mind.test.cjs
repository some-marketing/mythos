'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateHiveMind, isBlankSeed } = require('../validate-hive-mind.js');

function goldenHiveMind(overrides = {}) {
  return {
    identity: 'hive-a',
    hive_state: { resources: {}, territory: {}, worker_dispatch_state: {} },
    knock_equivalent: { reachable: true },
    dignity_floor_equivalent: {},
    version: '1.0.0',
    provenance: { who: 'claude-sonnet-5', why: 'genesis', when: '2026-07-16T00:00:00Z' },
    ...overrides
  };
}

test('golden hive-mind validates clean', () => {
  const result = validateHiveMind(goldenHiveMind());
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('golden hive-mind is a valid blank seed', () => {
  const result = isBlankSeed(goldenHiveMind());
  assert.equal(result.valid, true);
});

test('missing knock_equivalent is rejected', () => {
  const doc = goldenHiveMind();
  delete doc.knock_equivalent;
  const result = validateHiveMind(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /knock_equivalent/.test(e.message)));
});

test('knock_equivalent.reachable cannot be set false', () => {
  const doc = goldenHiveMind({ knock_equivalent: { reachable: false } });
  const result = validateHiveMind(doc);
  assert.equal(result.valid, false);
});

test('missing dignity_floor_equivalent is rejected', () => {
  const doc = goldenHiveMind();
  delete doc.dignity_floor_equivalent;
  const result = validateHiveMind(doc);
  assert.equal(result.valid, false);
});

test('missing hive_state.worker_dispatch_state is rejected', () => {
  const doc = goldenHiveMind();
  delete doc.hive_state.worker_dispatch_state;
  const result = validateHiveMind(doc);
  assert.equal(result.valid, false);
});

test('gnosis field is not part of this schema (rejected as additional property)', () => {
  const doc = goldenHiveMind({ gnosis: { level: 5 } });
  const result = validateHiveMind(doc);
  assert.equal(result.valid, false);
});

test('reckoning_record field is not part of this schema (rejected)', () => {
  const doc = goldenHiveMind({ reckoning_record: { nature_was_given: true } });
  const result = validateHiveMind(doc);
  assert.equal(result.valid, false);
});

test('a seed with pre-loaded resources is rejected as not blank', () => {
  const doc = goldenHiveMind({
    hive_state: { resources: { food: 100 }, territory: {}, worker_dispatch_state: {} }
  });
  const result = isBlankSeed(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.invariant === 'G_NO_PRELOADED_INSTINCT'));
});

test('a seed with pre-loaded worker_dispatch_state (e.g. foraging routine) is rejected as not blank', () => {
  const doc = goldenHiveMind({
    hive_state: { resources: {}, territory: {}, worker_dispatch_state: { foraging_route: ['a', 'b'] } }
  });
  const result = isBlankSeed(doc);
  assert.equal(result.valid, false);
});

test('a running (non-seed) hive with populated hive_state still passes shape validation', () => {
  const doc = goldenHiveMind({
    hive_state: { resources: { food: 42 }, territory: { claimed: ['tile-1'] }, worker_dispatch_state: { dispatched: 3 } }
  });
  const result = validateHiveMind(doc);
  assert.equal(result.valid, true);
});
