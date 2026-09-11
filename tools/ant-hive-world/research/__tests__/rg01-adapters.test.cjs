'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {runArm,defaultConfig,sourceIdentity}=require('../rg01-driver.cjs');
const {ARMS,createPolicy}=require('../rg01-policies.cjs');
const {scoreBatch}=require('../rg01-score.cjs');
const {stripVolatile}=require('../../../ticktock/run-benchmark.js');
const root=path.resolve(__dirname,'../../../..');
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'rg01-adapter-test-'));
const limits={max_ticks:10,max_decisions:20,max_wall_ms:30000};
async function arm(armName,seed=7,rounds=3,extra={}){const d=fixture();try{return await runArm({arm:armName,seed,rounds,hiveIds:['hive-a','hive-b'],limits,config:defaultConfig(),outputDir:d,...extra});}finally{fs.rmSync(d,{recursive:true,force:true});}}
test('random selects all five existing intents; food policy uses identical translation',()=>{
 const config=defaultConfig(),w={food_sources:{'tile-1':3},pheromones:{}};
 const random=createPolicy({arm:'random',seed:7,config});
 const choices=[0.01,0.21,0.41,0.61,0.81].map(first=>{let i=0;return random.decide({hiveState:{},worldState:w,round:1,rng:()=>i++===0?first:0.7});});
 assert.deepEqual(choices.map(a=>a.verb),['gather','gather','build','claim-territory','idle']);
 const greedy=createPolicy({arm:'greedy-food',seed:7,config}).decide({hiveState:{},worldState:w,round:1,rng:()=>0.7});
 assert.deepEqual(greedy,choices[0]);
});
test('split-stream behavior is deterministic with frozen weights, retained world actions and seeded policy randomness',async()=>{
 for(const name of ARMS){const a=await arm(name),b=await arm(name);assert.equal(a.complete,true);assert.deepEqual(a.rows,b.rows);assert.deepEqual(stripVolatile(a.worldRows),stripVolatile(b.worldRows));assert.equal(a.worldRows.length,3);assert.equal(a.metadata.initial_weights_hash,a.metadata.final_weights_hash);assert.equal(a.cost.updates,0);}
 const original=Math.random;Math.random=()=>{throw new Error('global policy RNG');};
 try {for(const name of ARMS){createPolicy({arm:name,seed:1,config:defaultConfig()}).decide({hiveState:{hive_state:{}},worldState:{food_sources:{}},round:1,rng:()=>0.3});}} finally {Math.random=original;}
});
test('finite limits, interrupt and adaptive config refuse or return incomplete',async()=>{
 const r=await arm('random',7,3,{limits:{...limits,max_decisions:2}});assert.equal(r.complete,false);assert.equal(r.reason,'count-limit');assert.equal(r.rows.length,2);
 const stopped=await arm('random',7,3,{shouldStop:()=>true});assert.equal(stopped.reason,'interrupted');assert.equal(stopped.rows.length,0);
 await assert.rejects(()=>arm('random',7,3,{limits:{...limits,max_wall_ms:Infinity}}),/FINITE-LIMITS/);
 await assert.rejects(()=>arm('random',7,3,{config:{...defaultConfig(),dream_lane_enabled:true}}),/ADAPTIVE/);
});
test('independent scorer validates accounting and rejects corrupted or incomplete evidence',async()=>{
 const arms=await Promise.all(ARMS.map(a=>arm(a))); const experiment={rounds:3,seeds:[7],hive_ids:['hive-a','hive-b'],config:defaultConfig(),source_identities:sourceIdentity()};
 const result=scoreBatch({experiment,arms});assert.equal(result.valid,true,result.reason);assert.match(result.interpretation,/no significance/);assert.equal(result.arms.length,3);
 const corrupt=JSON.parse(JSON.stringify(arms));corrupt[0].rows[0].post_upkeep_stockpile.food+=1;assert.equal(scoreBatch({experiment,arms:corrupt}).state,'invalid_experiment');
 assert.equal(scoreBatch({experiment,arms:arms.slice(1)}).valid,false);
 const duplicate=JSON.parse(JSON.stringify(arms));duplicate[0].rows[1]=duplicate[0].rows[0];assert.equal(scoreBatch({experiment,arms:duplicate}).valid,false);
 const forged=JSON.parse(JSON.stringify(arms));for(const a of forged)a.metadata.source_hashes[Object.keys(a.metadata.source_hashes)[0]]='forged';assert.equal(scoreBatch({experiment,arms:forged}).valid,false);
 const changed=JSON.parse(JSON.stringify(arms));changed[0].metadata.config_hash='wrong';assert.equal(scoreBatch({experiment,arms:changed}).valid,false);
});
test('frozen neural adapter matches isolated trainTick reference under identical shared RNG callback',()=>{
 const script=String.raw`
 const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
 const {stripVolatile}=require('./tools/ticktock/run-benchmark.js');
 const engine=path.join(process.cwd(),'tools/ant-hive-world');
 const {createPolicy}=require(path.join(engine,'research/rg01-policies.cjs'));
 const {defaultConfig}=require(path.join(engine,'research/rg01-driver.cjs'));
 const {setupHives,tick}=require(path.join(engine,'harness.js'));
 const {generateBlankHiveSeed}=require(path.join(engine,'generate-blank-hive-seed.js'));
 const {createNetwork,mulberry32,applyUpkeep}=require(path.join(engine,'untrained-network.js'));
 const {trainTick}=require(path.join(engine,'train-tick.js'));
 const world=require(path.join(engine,'world-state.js'));
 const cfg=defaultConfig(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'rg01-frozen-reference-'));
 try{
 const paths=['reference','adapter'].map(n=>path.join(dir,n,'world-state.json'));
 const context={run_id:'reference',episode_id:'reference',arm_id:'frozen-neural'};
 const seeds=[generateBlankHiveSeed('hive-a','fixture','fixed')];
 const h=paths.map((p,i)=>setupHives(path.dirname(p),seeds,p,{food:40,wood:4,stone:15},context)['hive-a']);
 const network=createNetwork(123),initial=JSON.stringify(network),policy=createPolicy({arm:'frozen-neural',seed:123,config:cfg});
 const r1=mulberry32(99),r2=mulberry32(99);
 for(let t=0;t<8;t++){
 const ref=trainTick(h[0],paths[0],network,r1,cfg,t,undefined,{freeze:true},undefined);
 const state=JSON.parse(fs.readFileSync(h[1].hiveStatePath));
 const action=policy.decide({hiveState:state,worldState:world.readWorldState(paths[1]),round:t+1,rng:r2});
 const raw=tick(h[1],paths[1],()=>action,cfg,r2,t+1),after=applyUpkeep(raw.hiveState,cfg.upkeep_cost_food);
 fs.writeFileSync(h[1].hiveStatePath,JSON.stringify(after.hiveState));
 assert.deepEqual(after.hiveState,ref.hiveState);assert.deepEqual(stripVolatile(world.readWorldState(paths[1])),stripVolatile(world.readWorldState(paths[0])));
 }
 assert.equal(JSON.stringify(network),initial);assert.deepEqual(policy.snapshot(),network);
 process.stdout.write('frozen-reference-equal:8\n');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}`;
 const output=execFileSync(process.execPath,['-e',script],{cwd:root,encoding:'utf8'});assert.match(output,/frozen-reference-equal:8/);
});

// Synthetic offline evidence exercises the null-verdict contract, not a claim
// that the production driver was run with an unsupported zero-source option.
test('complete synthetic zero-food evidence yields valid null; nonfinite evidence is invalid',async()=>{
 const runs=await Promise.all(ARMS.map(a=>arm(a,11,2)));
 const experiment={rounds:2,seeds:[11],hive_ids:['hive-a','hive-b'],config:defaultConfig(),source_identities:sourceIdentity()};
 const zeroFood=JSON.parse(JSON.stringify(runs));
 for(const run of zeroFood){
   for(const row of run.rows){
     row.action={verb:'idle'};row.applied=true;
     row.pre_stockpile=row.round===1?{}:{food:0};
     row.action_credit=null;row.action_debit=null;
     row.post_action_stockpile={food:0};row.post_upkeep_stockpile={food:0};
     row.exhaustion_state=true;row.starvation_crossing=false;
   }
   for(const row of run.worldRows){
     row.world_state.food_sources={};row.world_state.resources.food=0;
     row.decision={verb:'idle'};row.applied={applied:false,note:'synthetic zero-source fixture'};
   }
 }
 const result=scoreBatch({experiment,arms:zeroFood});
 assert.equal(result.valid,true,result.reason);
 assert.equal(result.state,'valid_benefit_not_demonstrated');
 assert.equal(result.diagnostic_headroom,false);assert.equal(result.mean_delta,0);
 assert.ok(result.arms.every(a=>a.utility===0&&a.hives.every(h=>h.food_credits===0&&h.exhausted===2)));
 zeroFood[0].rows[0].post_upkeep_stockpile.food=NaN;
 assert.equal(scoreBatch({experiment,arms:zeroFood}).state,'invalid_experiment');
});
