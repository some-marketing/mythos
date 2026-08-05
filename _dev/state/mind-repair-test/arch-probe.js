#!/usr/bin/env node
'use strict';
// Reports the live architecture hash + the world-mind's ACTUAL built shape.
// Read-only probe: constructs a throwaway network in memory, writes nothing.
const path = require('path');
const ENGINE = path.join(__dirname, '..', '..', '..', 'tools', 'ant-hive-world');
const cp = require(path.join(ENGINE, 'checkpoint.js'));
const wm = require(path.join(ENGINE, 'world-mind.js'));

const desc = cp.architectureDescriptor();
const probe = wm.createWorldMind(1);
const features = wm.encodeWorldState({});
console.log(JSON.stringify({
  arch_hash: desc.hash,
  world_mind_declared_input_size: wm.WORLD_INPUT_SIZE,
  encoder_feature_count: features.length,
  actual_shape: wm.ACTUAL_WORLD_MIND_SHAPE,
  built_w1: [probe.W1.length, probe.W1[0].length],
  built_w2: [probe.W2.length, probe.W2[0].length],
  architecture_world_mind_block: desc.world_mind
}, null, 2));
