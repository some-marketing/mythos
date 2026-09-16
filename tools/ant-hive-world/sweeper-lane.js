#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/sweeper-lane.js — the SWEEPER lane, plan
// ant-sim-nine-mind-harness-triad-architecture, S2. Modelled on Codewhale's
// role in the Mythos review relay: a genuinely wider vantage than either
// AUTHOR (single-tick state) or VERIFIER (single-tick ground truth) reads --
// a rolling window over the entity's OWN recent (verb, reward) history,
// catching patterns neither single-tick lane can see (declining success on a
// verb that is still instantaneously feasible and still locally attractive
// to the policy gradient -- the F-1 territory-over-commitment shape).
//
// Zero trainable parameters. State is a plain bounded ring buffer, not
// weights -- there is no gradient tape through this module, so nothing here
// can leak into AUTHOR's learned policy no matter what this lane is
// conditioned on (plan §2). Within-entity, within-run only: the buffer
// resets with the run, no cross-run or cross-seed state (fresh-minds
// compliant).

const DEFAULT_WINDOW = 20;

function createSweeperState(windowSize = DEFAULT_WINDOW) {
  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    throw new Error(`createSweeperState: windowSize must be a positive integer, got ${JSON.stringify(windowSize)}`);
  }
  return { windowSize, buffer: [] };
}

// Records one (verb, reward) outcome. Mutates and returns the same state
// object -- the ring buffer is bounded to `windowSize`, oldest entries drop
// first (FIFO), same discipline as a real sliding window.
function recordOutcome(state, verb, reward) {
  state.buffer.push({ verb, reward });
  if (state.buffer.length > state.windowSize) state.buffer.shift();
  return state;
}

// caution(a) in [0, 1] per candidate verb: the fraction of that verb's
// occurrences in the current window whose reward was WORSE than the
// window's own trailing mean for that verb -- a within-entity, unit-free
// comparison, not a fixed reward threshold (so it holds across reward-
// contract versions without retuning). caution=0 (no signal, not "safe")
// when a verb has zero occurrences in the window yet -- this is the cold-
// start case named in the plan's §1.4 and §7.3: SWEEPER cannot say anything
// about a verb it has not yet seen.
function computeCaution(state, candidateVerbs) {
  const out = {};
  for (const verb of candidateVerbs) {
    const occurrences = state.buffer.filter((entry) => entry.verb === verb);
    if (!occurrences.length) { out[verb] = 0; continue; }
    const mean = occurrences.reduce((sum, entry) => sum + entry.reward, 0) / occurrences.length;
    const worseCount = occurrences.filter((entry) => entry.reward < mean).length;
    out[verb] = worseCount / occurrences.length;
  }
  return out;
}

module.exports = { createSweeperState, recordOutcome, computeCaution, DEFAULT_WINDOW };
