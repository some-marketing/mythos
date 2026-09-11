'use strict';
const {canonicalize,sha256Hex} = require('../../ticktock/canonical.cjs');
const crypto=require('node:crypto');
const seedFor=(seed,label)=>crypto.createHash('sha256').update(`${seed}:${label}`).digest().readUInt32LE(0);
const ARMS=['random','frozen-neural','greedy-food'];
const hash=value=>sha256Hex(canonicalize(value));
const invalid=reason=>({valid:false,state:'invalid_experiment',reason,arms:[],seed_deltas:[],mean_delta:null,diagnostic_headroom:false});
function scoreBatch({experiment,arms}) {
  try {
    if (!experiment || !Array.isArray(arms)) return invalid('batch-shape');
    const {rounds,seeds,hive_ids:hives}=experiment;
    if (!Number.isInteger(rounds)||rounds<1||!Array.isArray(seeds)||!seeds.length||new Set(seeds).size!==seeds.length||!seeds.every(Number.isInteger)||!Array.isArray(hives)||!hives.length||new Set(hives).size!==hives.length) return invalid('experiment-shape');
    if(arms.length!==ARMS.length*seeds.length) return invalid('missing-or-extra-arm');
    const seen=new Set(), summaries=[]; let sources=null; const initializations={};
    for(const a of arms) {
      const key=`${a.arm}:${a.seed}`;
      if(!ARMS.includes(a.arm)||!seeds.includes(a.seed)||seen.has(key)) return invalid('duplicate-or-unknown-arm'); seen.add(key);
      if(!a.complete||a.reason||!a.metadata||a.metadata.rounds_completed!==rounds||a.metadata.rounds_requested!==rounds||!Array.isArray(a.rows)||a.rows.length!==rounds*hives.length||!Array.isArray(a.worldRows)||a.worldRows.length!==rounds) return invalid('incomplete-arm');
      if(a.metadata.initial_weights_hash!==a.metadata.final_weights_hash||!a.metadata.initial_weights_hash||a.metadata.config_hash!==hash(experiment.config)||a.metadata.stream_version!=='rg01-split-v1'||canonicalize(a.metadata.hive_ids)!==canonicalize(hives)) return invalid('identity-mismatch');
      if(!a.metadata.source_hashes||!Object.keys(a.metadata.source_hashes).length) return invalid('sources-missing');
      if(!experiment.source_identities||Object.entries(a.metadata.source_hashes).some(([p,h])=>experiment.source_identities[p]!==h))return invalid('source-manifest-mismatch');
      const expectedEngine=Object.keys(experiment.source_identities).filter(p=>p.startsWith('tools/ant-hive-world/')&&!p.includes('/research/')&&!p.includes('/__tests__/')&&/\.(?:c?js)$/.test(p));
      if(expectedEngine.some(p=>!Object.hasOwn(a.metadata.source_hashes,p)))return invalid('source-inventory-incomplete');
      const streams={policy:Object.fromEntries(hives.map(id=>[id,seedFor(a.seed,`policy:${id}`)])),environment:Object.fromEntries(hives.map(id=>[id,seedFor(a.seed,`environment:${id}`)])),world:seedFor(a.seed,'world')};
      if(hash(a.metadata.stream_seeds)!==hash(streams)||!a.metadata.initialization_hash||a.metadata.world_actions!==rounds||a.metadata.ecosystem_updates!==a.rows.length)return invalid('initialization-or-schedule-mismatch');
      if(initializations[a.seed]&&initializations[a.seed]!==a.metadata.initialization_hash)return invalid('initialization-drift');initializations[a.seed]=a.metadata.initialization_hash;
      const sourceHash=hash(a.metadata.source_hashes); if(sources!==null&&sources!==sourceHash)return invalid('source-drift'); sources=sourceHash;
      if(!a.cost||a.cost.updates!==0||a.cost.decisions!==a.rows.length||a.cost.ticks!==rounds||!Number.isFinite(a.cost.wall_ms)||!Number.isFinite(a.cost.peak_rss_bytes)) return invalid('cost-mismatch');
      for(let i=0;i<rounds;i++) if(a.worldRows[i].round!==i+1||a.worldRows[i].learning_updated!==false||!a.worldRows[i].world_state) return invalid('world-schedule-mismatch');
      const stats=Object.fromEntries(hives.map(h=>[h,{positive:0,applied:0,food_credits:0,exhausted:0,starvation_crossings:0}]));
      const previous={};
      for(let i=0;i<a.rows.length;i++) {
        const r=a.rows[i],round=Math.floor(i/hives.length)+1,hive=hives[i%hives.length];
        if(r.round!==round||r.hive!==hive||r.arm!==a.arm||r.seed!==a.seed||typeof r.applied!=='boolean')return invalid('row-identity-or-order');
        if(!r.pre_stockpile||!r.post_action_stockpile||!r.post_upkeep_stockpile||!Number.isFinite(r.upkeep_cost)||r.upkeep_cost<0||r.upkeep_cost!==experiment.config.upkeep_cost_food)return invalid('row-shape');
        const expected={...r.pre_stockpile},credit=r.action_credit,debit=r.action_debit;
        if(credit!==null&&credit!==undefined) {
          if(!r.applied||!r.action||r.action.verb!=='gather'||credit.resourceKey!==r.action.resourceKey||!Number.isFinite(credit.amount)||credit.amount<=0)return invalid('credit-invalid');
          expected[credit.resourceKey]=(expected[credit.resourceKey]||0)+credit.amount;
          if(credit.resourceKey==='food') stats[hive].food_credits+=credit.amount;
        }
        if(debit!==null&&debit!==undefined) {
          if(!r.applied||!r.action||r.action.verb!=='build')return invalid('debit-invalid');
          for(const [k,v] of Object.entries(debit)){if(!Number.isFinite(v)||v<0)return invalid('debit-invalid');expected[k]=(expected[k]||0)-v;}
        }
        const keys=new Set([...Object.keys(expected),...Object.keys(r.post_action_stockpile),...Object.keys(r.post_upkeep_stockpile),'food']);
        for(const k of keys) {
          const before=r.pre_stockpile[k]??0,post=r.post_action_stockpile[k]??0,after=r.post_upkeep_stockpile[k]??0;
          if(![before,post,after,expected[k]??0].every(Number.isFinite)||Math.min(before,post,after)<0)return invalid('nonfinite-or-negative-resource');
          if(Math.abs(post-(expected[k]??0))>1e-10||Math.abs(after-(k==='food'?Math.max(0,post-r.upkeep_cost):post))>1e-10)return invalid('accounting-mismatch');
          if(previous[hive]&&Math.abs(before-(previous[hive][k]??0))>1e-10)return invalid('state-continuity-mismatch');
        }
        if(round===1&&Object.values(r.pre_stockpile).some(v=>v!==0))return invalid('nonblank-initial-stockpile');
        previous[hive]=r.post_upkeep_stockpile;
        const food=r.post_upkeep_stockpile.food??0,exhausted=food===0,crossing=(r.post_action_stockpile.food??0)>0&&food===0;
        if(r.exhaustion_state!==exhausted||r.starvation_crossing!==crossing)return invalid('exhaustion-semantics');
        stats[hive].positive+=food>0?1:0;stats[hive].applied+=r.applied?1:0;stats[hive].exhausted+=exhausted?1:0;stats[hive].starvation_crossings+=crossing?1:0;
      }
      const hiveMetrics=Object.entries(stats).map(([hive,s])=>({hive,...s,utility:s.positive/rounds}));
      summaries.push({arm:a.arm,seed:a.seed,utility:hiveMetrics.reduce((n,s)=>n+s.utility,0)/hives.length,hives:hiveMetrics,cost:a.cost});
    }
    const deltas=seeds.map(seed=>({seed,delta:summaries.find(a=>a.seed===seed&&a.arm==='greedy-food').utility-summaries.find(a=>a.seed===seed&&a.arm==='random').utility}));
    const mean=deltas.reduce((n,d)=>n+d.delta,0)/deltas.length;
    return {valid:true,state:mean>0?'valid_benefit_demonstrated':'valid_benefit_not_demonstrated',reason:null,arms:summaries,seed_deltas:deltas,mean_delta:mean,diagnostic_headroom:mean>0,
      interpretation:'RG-01 diagnostic headroom only; no significance, learning or generalization claim',accounting_tolerance:1e-10};
  } catch(e) {return invalid(`invalid-data:${e.message}`);}
}
module.exports={scoreBatch};
