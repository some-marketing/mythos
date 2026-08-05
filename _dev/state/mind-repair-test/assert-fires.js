#!/usr/bin/env node
'use strict';

// _dev/state/mind-repair-test/assert-fires.js
//
// Falsifier for the S0 construction-time assertion. "I added an assertion" is
// not evidence that the assertion works -- an assertion that can never fire is
// indistinguishable from a comment. This reconstructs the exact defect the
// repair removed (a world-mind network built at the HIVE network's input width)
// and requires that the engine refuses it, plus three other shape violations,
// plus a CONTROL that the correct shape is accepted (an assertion that throws
// on everything is as useless as one that throws on nothing).
//
// MECHANISM, and the subtlety that makes it work: world-mind.js destructures
// createNetwork at require time, so patching untrained-network's exports after
// world-mind is loaded would change nothing. Each case therefore patches the
// export FIRST, then drops world-mind.js from the module cache and re-requires
// it. Note this means the refusal is expected at REQUIRE time, not at the
// createWorldMind() call: world-mind.js probes its own shape at module load
// (ACTUAL_WORLD_MIND_SHAPE), so a mis-shaped constructor cannot even finish
// loading the module. That is a stronger guarantee than a call-time throw.
//
// Nothing here modifies any file under tools/.

const fs = require('fs');
const path = require('path');
const ENGINE = path.join(__dirname, '..', '..', '..', 'tools', 'ant-hive-world');

const untrainedPath = require.resolve(path.join(ENGINE, 'untrained-network.js'));
const worldMindPath = require.resolve(path.join(ENGINE, 'world-mind.js'));

const untrained = require(untrainedPath);
const realCreateNetwork = untrained.createNetwork;
const { INPUT_SIZE } = untrained;

const source = fs.readFileSync(worldMindPath, 'utf8');
const assertionPresent = /function assertWorldMindShape\(/.test(source);
const calledFromConstructor = /assertWorldMindShape\(createNetwork\(/.test(source);
const derivedFromEncoder = /const WORLD_INPUT_SIZE = encodeWorldState\(\{\}\)\.length;/.test(source);

const results = [];

function probe(name, dimsOverride) {
  // Force every dims request to the override, ignoring what createWorldMind asks
  // for -- this simulates a constructor that silently builds the wrong shape,
  // which is exactly the class of failure the assertion has to catch.
  untrained.createNetwork = (seed) => realCreateNetwork(seed, dimsOverride);
  delete require.cache[worldMindPath];
  let threw = false;
  let message = null;
  let stage = null;
  try {
    const mod = require(worldMindPath);
    mod.createWorldMind(123);
  } catch (e) {
    threw = true;
    message = e.message;
    stage = /construction/.test(e.message) ? 'construction-assertion' : 'other';
  } finally {
    untrained.createNetwork = realCreateNetwork;
    delete require.cache[worldMindPath];
  }
  results.push({ case: name, dims: dimsOverride, threw, stage, message });
}

// 1. THE ORIGINAL BUG, reconstructed exactly.
probe(`original defect: input width = hive INPUT_SIZE (${INPUT_SIZE}), encoder emits 8`,
  { inputSize: INPUT_SIZE, hiddenSize: 8, outputSize: 5 });
// 2. Off-by-one the other direction.
probe('input width 7 (encoder emits 8)', { inputSize: 7, hiddenSize: 8, outputSize: 5 });
// 3. Wrong hidden width -- the second cross-bound dimension found in the S0 audit.
probe('hidden width 6 (WORLD_HIDDEN_SIZE is 8)', { inputSize: 8, hiddenSize: 6, outputSize: 5 });
// 4. Wrong verb count -- W2 rows no longer match WORLD_VERB_ORDER's 5 verbs.
probe('output width 4 (5 world verbs)', { inputSize: 8, hiddenSize: 8, outputSize: 4 });
// 5. CONTROL: the correct shape must be accepted.
probe('CONTROL correct dims 8/8/5 (must NOT throw)', { inputSize: 8, hiddenSize: 8, outputSize: 5 });

const violations = results.slice(0, 4);
const control = results[4];
const allViolationsCaught = violations.every((r) => r.threw && r.stage === 'construction-assertion');

// Leave the module cache holding the REAL module, so nothing downstream in this
// process inherits a patched engine.
delete require.cache[worldMindPath];
const clean = require(worldMindPath);
const cleanShape = clean.ACTUAL_WORLD_MIND_SHAPE;

const report = {
  schema: 'MindRepairAssertionProbe/1.0',
  measured_at: new Date().toISOString(),
  source_checks: {
    assertion_present_in_source: assertionPresent,
    assertion_called_from_constructor: calledFromConstructor,
    input_size_derived_from_encoder: derivedFromEncoder
  },
  cases: results,
  post_probe_clean_load: { shape: cleanShape, loads_cleanly: true },
  verdict: allViolationsCaught && !control.threw
    ? 'assertion fires on every shape violation tested (including the original defect) and stays silent on the correct shape'
    : 'ASSERTION DID NOT BEHAVE AS CLAIMED -- see cases'
};

fs.writeFileSync(path.join(__dirname, 'assert-fires.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
