'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {createPolicy, ARMS} = require('./rg01-policies.cjs');
const {DEFAULT_CONFIG} = require('../live-config.js');
const {setupHives, tick} = require('../harness.js');
const {generateBlankHiveSeed} = require('../generate-blank-hive-seed.js');
const {mulberry32, applyUpkeep} = require('../untrained-network.js');
const {createEventContext} = require('../event-schema.js');
const world = require('../world-state.js');
const mind = require('../world-mind.js');
const {canonicalize} = require('../../ticktock/canonical.cjs');
const digest = value => crypto.createHash('sha256').update(canonicalize(value)).digest('hex');
const seedFor = (seed, label) => crypto.createHash('sha256').update(`${seed}:${label}`).digest().readUInt32LE(0);
const componentInventory = Object.freeze({verifier:'absent in public engine', sweeper:'absent in public engine', planner:'absent in public engine',
  dream:'absent in public engine', entropy_controller:'disabled: absent controller state', hive_learning:'frozen', world_learning:'absent; untrained world actions retained',
  dopamine:'absent in public engine', serotonin:'absent in public engine', gaba:'absent in public engine', external_world_push:'disabled'});
function defaultConfig() { return {...DEFAULT_CONFIG, dream_lane_enabled:false, entropy_controller_enabled:false, dopamine_enabled:false, serotonin_enabled:false}; }
const engineRoot = path.resolve(__dirname, '..');
function collectSources(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => {
    if (['research','__tests__','node_modules'].includes(e.name)) return [];
    const p = path.join(dir,e.name);
    return e.isDirectory() ? collectSources(p) : e.isFile() && /\.(?:c?js)$/.test(e.name) ? [path.relative(path.resolve(engineRoot,'../..'),p).split(path.sep).join('/')] : [];
  });
}
const sourceFiles = Object.freeze(collectSources(engineRoot).sort());
function sourceIdentity() {
  const root=path.resolve(engineRoot,'../..');
  return Object.fromEntries(sourceFiles.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
}
function weightsHash(policies, worldMind) {
  const {prev_features, ...weights} = worldMind;
  return digest({hives:Object.fromEntries(Object.entries(policies).map(([k,p])=>[k,p.snapshot()])), world:weights});
}
async function runArm({arm,seed,rounds,hiveIds=['hive-a','hive-b'],limits,config=defaultConfig(),outputDir,shouldStop=()=>false,signal}) {
  if (!ARMS.includes(arm) || !Number.isInteger(seed) || !Number.isInteger(rounds) || rounds<1 || !Array.isArray(hiveIds) || !hiveIds.length || new Set(hiveIds).size!==hiveIds.length || hiveIds.some(id=>!/^[a-z][a-z0-9-]*$/.test(id))) throw new Error('INVALID-ARM-SPEC');
  if (!limits || ['max_decisions','max_ticks','max_wall_ms'].some(k=>!Number.isFinite(limits[k]) || limits[k]<=0)) throw new Error('FINITE-LIMITS-REQUIRED');
  if (!outputDir || !fs.existsSync(outputDir) || fs.lstatSync(outputDir).isSymbolicLink() || fs.readdirSync(outputDir).length) throw new Error('FRESH-OUTPUT-DIRECTORY-REQUIRED');
  if (['dream_lane_enabled','entropy_controller_enabled','dopamine_enabled','serotonin_enabled'].some(k=>config[k]!==false)) throw new Error('ADAPTIVE-COMPONENT-NOT-DISABLED');
  config=JSON.parse(JSON.stringify(config));
  const started=performance.now(); const rows=[],worldRows=[]; let completed=0,reason=null;
  const file=path.join(outputDir,'world-state.json');
  const context=createEventContext({armId:arm,runId:`research-${seed}`,episodeId:`research-${seed}`});
  const seeds=hiveIds.map(id=>generateBlankHiveSeed(id,'research-fixture','experiment-initialization'));
  const hives=setupHives(outputDir,seeds,file,{food:40,wood:4,stone:15},context);
  const policies=Object.fromEntries(hiveIds.map(id=>[id,createPolicy({arm,seed:seedFor(seed,`weights:${id}`),config})]));
  const policyRng=Object.fromEntries(hiveIds.map(id=>[id,mulberry32(seedFor(seed,`policy:${id}`))]));
  const envRng=Object.fromEntries(hiveIds.map(id=>[id,mulberry32(seedFor(seed,`environment:${id}`))]));
  const wm=mind.createWorldMind(seedFor(seed,'weights:world')), worldRng=mulberry32(seedFor(seed,'world'));
  const initialHash=weightsHash(policies,wm);
  const initialWorld=world.readWorldState(file);delete initialWorld.written_at;
  const initializationHash=digest({world:initialWorld,hives:seeds});
  const streamSeeds={policy:Object.fromEntries(hiveIds.map(id=>[id,seedFor(seed,`policy:${id}`)])),environment:Object.fromEntries(hiveIds.map(id=>[id,seedFor(seed,`environment:${id}`)])),world:seedFor(seed,'world')};
  const stop=()=>signal?.aborted || shouldStop() ? 'interrupted' : performance.now()-started>=limits.max_wall_ms ? 'wall-limit' : null;
  outer: for (let round=1;round<=rounds;round++) {
    reason=stop(); if(reason) break;
    if (round>limits.max_ticks || rows.length+hiveIds.length>limits.max_decisions) {reason='count-limit'; break;}
    const roundStates={};
    for (const id of hiveIds) {
      reason=stop(); if(reason) break outer;
      const hive=hives[id], before=JSON.parse(fs.readFileSync(hive.hiveStatePath,'utf8'));
      const action=policies[id].decide({hiveState:before,worldState:world.readWorldState(file),round,rng:policyRng[id]});
      const result=tick(hive,file,()=>action,config,envRng[id],round);
      const audit=fs.readFileSync(hive.auditLogPath,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.event==='tick').at(-1);
      if (!audit || audit.tick!==round) throw new Error('ACTION-AUDIT-MISSING');
      const after=applyUpkeep(result.hiveState,config.upkeep_cost_food);
      fs.writeFileSync(hive.hiveStatePath,JSON.stringify(after.hiveState)); roundStates[id]=after.hiveState;
      rows.push({arm,seed,round,hive:id,action,applied:result.applied,pre_stockpile:before.hive_state.stockpile||{},action_credit:audit.stockpile_credit,action_debit:audit.stockpile_debit,
        post_action_stockpile:result.hiveState.hive_state.stockpile,upkeep_cost:config.upkeep_cost_food,post_upkeep_stockpile:after.hiveState.hive_state.stockpile,
        exhaustion_state:after.foodExhausted,starvation_crossing:after.starved});
    }
    // Match the shipped live loop: the public world mind has no training path.
    const state=world.readWorldState(file);
    const decision=mind.decideWorld(wm,state,worldRng,round-1), applied=mind.applyWorldVerb(state,decision,worldRng);
    world.writeWorldState(file,state);
    worldRows.push({round,decision,applied,learning_updated:false,world_state:JSON.parse(JSON.stringify(state))});
    completed=round;
    await new Promise(resolve=>setImmediate(resolve));
  }
  const finalHash=weightsHash(policies,wm);
  if(finalHash!==initialHash) throw new Error('FROZEN-WEIGHTS-CHANGED');
  const complete=completed===rounds && !reason;
  return {arm,seed,rows,worldRows,complete,reason,metadata:{schedule:'hives-in-order:harness+upkeep;untrained-world-decide+apply',hive_ids:hiveIds,
    rounds_requested:rounds,rounds_completed:completed,initial_weights_hash:initialHash,final_weights_hash:finalHash,stream_version:'rg01-split-v1',config_hash:digest(config),source_hashes:sourceIdentity(),component_inventory:componentInventory,initialization_hash:initializationHash,stream_seeds:streamSeeds,world_actions:completed,ecosystem_updates:rows.length},
    cost:{wall_ms:performance.now()-started,peak_rss_bytes:process.resourceUsage().maxRSS*1024,updates:0,decisions:rows.length,world_decisions:completed,world_updates:rows.length+completed,ticks:completed}};
}
module.exports={runArm,defaultConfig,sourceFiles,sourceIdentity,componentInventory,seedFor,digest};
