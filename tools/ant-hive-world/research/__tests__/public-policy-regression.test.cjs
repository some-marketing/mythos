const net=require('../../untrained-network.js');
const crypto=require('node:crypto');
function snapshot(){
 const rows=[];
 for(const seed of [1,7,99])for(const first of [0.01,0.21,0.41,0.61,0.81]){
  const network=net.createNetwork(seed),stream=net.mulberry32(seed);let draws=0;
  const rng=()=>draws++===0?first:stream();
  const action=net.decide(network,{hive_state:{stockpile:{food:3,wood:2}}},{food_sources:{'tile-1':3,'tile-2':4},pheromones:{food:{'tile-1':0.5}},resources:{food:7,wood:8,stone:2},territory:{}},rng,{forced_exploration_interval:1,trail_follow_prob:0.5},0);
  rows.push({seed,first,draws,action});
 }
 return {hash:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),draws:rows.map(r=>r.draws)};
}
// Snapshot computed from shipped origin/main 1d03c3f21 before pure helper extraction.
// All five intents across three seeds preserve full action values and RNG draw counts.
const test=require('node:test'),assert=require('node:assert/strict');
test('public neural translation and RNG draws remain exactly unchanged',()=>{
 assert.deepEqual(snapshot(),{hash:'6ef23d789a4f1c8c8c3ea51d69d60b7c3a10789d987b7b7d051bc4a00fd6a0d2',draws:[3,3,1,2,1,2,3,1,2,1,2,3,1,2,1]});
});
