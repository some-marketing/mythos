'use strict';

// Red-then-green coverage for extending checkpoint serialization to the
// triad's lanes (plan ant-sim-nine-mind-harness-triad-architecture, S2/S3
// correction, §3/§6). Before serializeLaneState/deserializeLaneState/
// shapeDomain()'s `lanes` field existed, a checkpoint restore of a
// SWEEPER-carrying hive would either throw (no such export) or silently
// drop the ring buffer, and shape_hash would not move when triad
// instrumentation shipped -- meaning old, pre-triad generations would
// appear restorable into a triad-shaped engine, which is exactly the
// silent-corruption class shape_hash exists to prevent.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shapeDomain, architectureDescriptor, canonicalJson, sha256Hex,
  serializeLaneState, deserializeLaneState
} = require('../checkpoint.js');
const { createSweeperState, recordOutcome } = require('../sweeper-lane.js');

test('shapeDomain() declares a lanes descriptor (VERIFIER source-versioned, SWEEPER window-sized)', () => {
  const shape = shapeDomain();
  assert.ok(shape.lanes, 'shapeDomain() must declare a lanes descriptor');
  assert.equal(typeof shape.lanes.verifier.source_version, 'string');
  assert.equal(typeof shape.lanes.sweeper.window_size, 'number');
});

test('architectureDescriptor() carries lanes through to shape_hash -- adding the lanes field moves the hash', () => {
  const shape = shapeDomain();
  const desc = architectureDescriptor();
  assert.deepEqual(desc.lanes, shape.lanes);

  // Hand-compute the PRE-triad shape hash (everything shapeDomain() would
  // have produced before `lanes` existed) and confirm it differs from the
  // live shape_hash -- this is the mechanism that forces the fresh lineage
  // root: an old committed generation's shape_hash was computed without
  // this key and can never match again.
  const preTriadShape = { ...shape };
  delete preTriadShape.lanes;
  const preTriadHash = sha256Hex(canonicalJson(preTriadShape));
  assert.notEqual(desc.shape_hash, preTriadHash, 'shape_hash must move once lanes is part of shapeDomain()');
});

test('serializeLaneState/deserializeLaneState round-trip SWEEPER\'s ring buffer exactly', () => {
  const sweeperState = createSweeperState(5);
  recordOutcome(sweeperState, 'gather-food', 1.5);
  recordOutcome(sweeperState, 'build', -0.5);
  recordOutcome(sweeperState, 'gather-food', 0.5);

  const payload = serializeLaneState({ sweeperState });
  // JSON round-trip -- checkpoint.js writes canonicalJson(mind) to disk and
  // reads it back with JSON.parse, so this is the honest fidelity check.
  const rehydrated = JSON.parse(JSON.stringify(payload));
  const restored = deserializeLaneState(rehydrated);

  assert.equal(restored.sweeperState.windowSize, 5);
  assert.deepEqual(restored.sweeperState.buffer, sweeperState.buffer);

  // computeCaution against the restored state must produce the SAME numbers
  // as against the original -- a restore that silently truncated or
  // reordered the buffer would show up here as a divergent caution value.
  const { computeCaution } = require('../sweeper-lane.js');
  const { VERB_ORDER } = require('../untrained-network.js');
  assert.deepEqual(computeCaution(restored.sweeperState, VERB_ORDER), computeCaution(sweeperState, VERB_ORDER));
});

test('serializeLaneState(null / no sweeperState) serializes to null -- VERIFIER has nothing to persist', () => {
  assert.equal(serializeLaneState(null), null);
  assert.equal(serializeLaneState({}), null);
  assert.equal(deserializeLaneState(null), null);
  assert.equal(deserializeLaneState(undefined), null);
});
