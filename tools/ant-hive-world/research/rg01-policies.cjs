'use strict';
const net = require('../untrained-network.js');
const ARMS = Object.freeze(['random', 'frozen-neural', 'greedy-food']);
function createPolicy({arm, seed, config}) {
  if (!ARMS.includes(arm) || !Number.isInteger(seed)) throw new Error('INVALID-POLICY');
  const network = arm === 'frozen-neural' ? net.createNetwork(seed) : null;
  return {
    snapshot: () => network ? JSON.parse(JSON.stringify(network)) : null,
    decide({hiveState, worldState, round, rng}) {
      if (typeof rng !== 'function') throw new Error('SEEDED-RNG-REQUIRED');
      if (network) return net.decide(network, hiveState, worldState, rng, config, round - 1);
      const intent = arm === 'greedy-food' ? 'gather-food' : net.VERB_ORDER[Math.min(net.VERB_ORDER.length - 1, Math.floor(rng() * net.VERB_ORDER.length))];
      if (intent === 'gather-food' || intent === 'gather-wood') {
        const resourceKey = intent === 'gather-food' ? 'food' : 'wood';
        return {verb: 'gather', resourceKey, amount: resourceKey === 'food' ? net.resolveGatherYieldFood(config) : 1,
          tileId: net.chooseForageTile(worldState, resourceKey, rng, config.trail_follow_prob)};
      }
      if (intent === 'build') return {verb: 'build', entry: {kind: 'chamber', coords: null}};
      if (intent === 'claim-territory') return {verb: intent, tileId: net.pickClaimTerritoryTile(rng)};
      return {verb: 'idle'};
    }
  };
}
module.exports = {ARMS, createPolicy};
