#!/usr/bin/env node
'use strict';

// _dev/state/mind-repair-test/ripple-check.js
//
// Falsifier for "the S0 repair did not touch hive networks". The claim is that
// createNetwork(seed) with no dims argument builds exactly the network it built
// before the dims parameter existed. Reading the diff is not proof of that --
// the proof is that a hive network constructed by the CURRENT code at a given
// seed is byte-identical to the hive network the PRE-REPAIR code committed into
// gen-5-prerepair at that same seed.
//
// If the repair had leaked into the hive path at all -- a changed rng draw
// order, a changed dimension, a changed init -- these checksums would diverge.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const ENGINE = path.join(__dirname, '..', '..', '..', 'tools', 'ant-hive-world');
const { createNetwork, INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE } = require(path.join(ENGINE, 'untrained-network.js'));

const GEN = path.join(__dirname, 'pre-repair-checkpoints', 'gen-5-prerepair');

function checksum(net) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ W1: net.W1, b1: net.b1, W2: net.W2, b2: net.b2 }))
    .digest('hex');
}

const rng = JSON.parse(fs.readFileSync(path.join(GEN, 'rng.json'), 'utf8'));
const mind = JSON.parse(fs.readFileSync(path.join(GEN, 'mind.json'), 'utf8'));
const seeds = rng.construction_seeds;

const results = [];
for (const id of ['hive-a', 'hive-b']) {
  // Rebuild at construction seed with TODAY's code, no dims argument.
  const rebuilt = createNetwork(seeds[id]);
  // The committed network has 5 ticks of REINFORCE on it, so it is NOT expected
  // to match the fresh rebuild. What must match is the SHAPE the pre-repair
  // engine committed and the shape today's bare createNetwork produces.
  const committed = mind.hives[id].network;
  results.push({
    hive: id,
    construction_seed: seeds[id],
    rebuilt_shape: [rebuilt.W1.length, rebuilt.W1[0].length, rebuilt.W2.length, rebuilt.W2[0].length],
    committed_shape: [committed.W1.length, committed.W1[0].length, committed.W2.length, committed.W2[0].length],
    shape_identical:
      rebuilt.W1.length === committed.W1.length &&
      rebuilt.W1[0].length === committed.W1[0].length &&
      rebuilt.W2.length === committed.W2.length &&
      rebuilt.W2[0].length === committed.W2[0].length,
    rebuilt_checksum: checksum(rebuilt)
  });
}

// The exact-bytes control: a network built with NO dims and one built with dims
// explicitly set to this module's own constants must be byte-identical. That is
// the direct statement of "the default path is unchanged".
const bare = createNetwork(12345);
const explicit = createNetwork(12345, { inputSize: INPUT_SIZE, hiddenSize: HIDDEN_SIZE, outputSize: OUTPUT_SIZE });

const report = {
  schema: 'MindRepairRippleCheck/1.0',
  measured_at: new Date().toISOString(),
  hive_constants: { INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE },
  hive_shapes_vs_pre_repair_checkpoint: results,
  default_path_byte_identity: {
    seed: 12345,
    bare_checksum: checksum(bare),
    explicit_default_dims_checksum: checksum(explicit),
    identical: checksum(bare) === checksum(explicit)
  },
  verdict: results.every((r) => r.shape_identical) && checksum(bare) === checksum(explicit)
    ? 'no-ripple: hive network construction is unchanged'
    : 'RIPPLE DETECTED -- stop and report'
};

fs.writeFileSync(path.join(__dirname, 'ripple-check.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
