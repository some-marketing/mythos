'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Ajv = require('ajv');
const { hashObject } = require('../../ticktock/canonical.cjs');
const schema = require('./experiment-schema.json');
const goals = require('./objectives.json').goals;
const ajv = new Ajv({allErrors:true,strict:false});
const validate = ajv.compile(schema);
const validateResult = ajv.compile(require('./result-schema.json'));
const validateSelection = ajv.compile(schema.definitions.selection);
const ROOT = path.resolve(__dirname,'../../..');
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function check(condition,message) { if (!condition) throw new Error(message); }
function safePath(repoRoot,relative,{exists=false}={}) {
  check(typeof relative==='string' && !path.isAbsolute(relative) && !relative.split(/[\\/]/).some(x=>x==='..'||x==='.'||x===''), 'unsafe relative path');
  const root=fs.realpathSync(repoRoot); let current=root;
  for(const part of relative.split('/')) { current=path.join(current,part); { try {const s=fs.lstatSync(current);check(!s.isSymbolicLink(),'symlink refused');} catch(e){if(e.code!=='ENOENT')throw e;} } }
  if(exists)check(fs.existsSync(current),'missing artifact: '+relative);
  return current;
}
function writeExclusive(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function sourceIdentities(repoRoot=ROOT) {
  const {sourceFiles}=require('./rg01-driver.cjs');
  const ticktockFiles=[];
  function collect(dir){for(const entry of fs.readdirSync(path.join(ROOT,dir),{withFileTypes:true})){if(entry.name==='__tests__'||entry.name==='node_modules'||entry.name.startsWith('test-'))continue;const relative=dir+'/'+entry.name;if(entry.isDirectory())collect(relative);else if(entry.isFile()&&/\.(?:c?js|json)$/.test(entry.name))ticktockFiles.push(relative);}}
  collect('tools/ticktock');
  const names=new Set([...sourceFiles,...ticktockFiles,'package.json','package-lock.json', ...['experiment-schema.json','result-schema.json','objectives.json','research-io.cjs','rg01-driver.cjs','rg01-policies.cjs','rg01-score.cjs'].map(n=>'tools/ant-hive-world/research/'+n)]);
  return Object.fromEntries([...names].sort().map(n=>[n,digest(fs.readFileSync(safePath(repoRoot,n,{exists:true})))]));
}
function prepare({repoRoot=ROOT,batchId,goalId='RG-01',charterHash,seeds=[1701,2701,3701],rounds=300,hiveIds=['hive-a','hive-b'],maxWallMs=300000,supersedes=null}={}) {
  check(Number.isInteger(maxWallMs)&&maxWallMs>=1&&maxWallMs<=3600000,'invalid experiment: max wall milliseconds outside 1..3600000');
  check(ID.test(batchId||''),'invalid batch ID');check(HASH.test(charterHash||''),'invalid charter hash');check(goals.some(g=>g.id===goalId),'unknown goal');
  const driver=require('./rg01-driver.cjs');const config=driver.defaultConfig();
  const experiment={schema:'ResearchExperiment/1.0',batch_id:batchId,primary_goal:goalId,question:'Does a food-seeking control establish diagnostic headroom over random behavior?',falsifier:'Nonpositive heuristic minus random utility or invalid accounting prevents a headroom claim.',charter_hash:charterHash,arms:['random','frozen-neural','greedy-food'],seeds,seed_role:'development',rounds,hive_ids:hiveIds,limits:{max_decisions:rounds*hiveIds.length,max_ticks:rounds,max_wall_ms:maxWallMs},stream_version:'rg01-split-v1',config,config_sha256:hashObject(config),source_identities:sourceIdentities(repoRoot),component_inventory:driver.componentInventory,utility:'equal-hive mean post-upkeep food_stockpile > 0',contrast:'greedy-food minus random; development diagnostic only',supersedes,experiment_sha256:''};
  experiment.experiment_sha256=hashObject(experiment,['experiment_sha256']);check(validate(experiment),'invalid experiment: '+ajv.errorsText(validate.errors));
  const relative='_dev/sim-runs/research/_drafts/'+batchId+'.json';const file=safePath(repoRoot,relative);check(!fs.existsSync(file),'draft already exists');writeExclusive(file,experiment);return {spec_path:relative,experiment};
}
function loadExperiment({repoRoot=ROOT,specPath,charterHash}) {
  check(typeof specPath==='string','research spec required');check(!specPath.split(/[\\/]/).includes('..'),'spec traversal refused'); const relative=path.isAbsolute(specPath)?path.relative(fs.realpathSync(repoRoot),specPath):specPath;
  const file=safePath(repoRoot,relative,{exists:true});const bytes=fs.readFileSync(file);const experiment=JSON.parse(bytes);
  check(validate(experiment),'invalid experiment: '+ajv.errorsText(validate.errors));check(experiment.experiment_sha256===hashObject(experiment,['experiment_sha256']),'stale experiment hash');
  check(experiment.config_sha256===hashObject(experiment.config),'stale config hash');check(experiment.charter_hash===charterHash,'mismatched charter hash');
  check(hashObject(experiment.source_identities)===hashObject(sourceIdentities(repoRoot)),'stale source/scorer identity');
  const driver=require('./rg01-driver.cjs');check(hashObject(experiment.config)===hashObject(driver.defaultConfig()),'unsupported research config');
  check(hashObject(experiment.component_inventory)===hashObject(driver.componentInventory),'unsupported component inventory');
  check(experiment.limits.max_decisions>=experiment.rounds*experiment.hive_ids.length&&experiment.limits.max_ticks>=experiment.rounds,'insufficient decision/tick ceiling');
  return {experiment,relative,bytesHash:digest(bytes)};
}
function readiness(options) {
  const {experiment}=loadExperiment(options);const goal=goals.find(g=>g.id===experiment.primary_goal);const gaps=[];
  if(!goal.execution_supported)gaps.push('execution unsupported for '+goal.id);
  try {
    const file=safePath(options.repoRoot||ROOT,'_dev/sim-runs/research/_capabilities/rg01.json',{exists:true});const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
    check(receipt.schema==='ResearchCapability/1.0','capability schema mismatch');
    check(receipt.source_identities_sha256===hashObject(experiment.source_identities),'stale capability source identity');
    const readEvidence=ref=>{const file=safePath(options.repoRoot||ROOT,ref.path,{exists:true});const bytes=fs.readFileSync(file);check(digest(bytes)===ref.sha256,'capability evidence changed');return JSON.parse(bytes);};
    const evidence=readEvidence(receipt.evidence);const review=readEvidence(receipt.review);
    check(evidence.schema==='ResearchVerification/1.0'&&evidence.status==='pass'&&evidence.source_identities_sha256===receipt.source_identities_sha256,'verification evidence does not pass for current sources');
    check(['adapter_equivalence','accounting','isolation','reproducibility'].every(k=>evidence.checks?.[k]===true),'capability checks missing');
    check(review.schema==='ResearchImplementationReview/1.0'&&review.status==='pass'&&review.source_identities_sha256===receipt.source_identities_sha256,'review evidence does not pass for current sources');
    check(typeof review.producer_family==='string'&&typeof review.reviewer_family==='string'&&review.producer_family!==review.reviewer_family,'distinct family review required');
  }catch(error){gaps.push('capability evidence: '+error.message);}
  return {status:gaps.length?'not_ready':'ready',benchmark_kind:'comparative',goal_id:goal.id,batch_id:experiment.batch_id,experiment_sha256:experiment.experiment_sha256,prerequisites:goal.prerequisites,gaps};
}
function selectionReadiness({repoRoot=ROOT,charterHash,cycleIndex,specPath,bind=false}={}) {
  check(HASH.test(charterHash||''),'invalid charter hash');check(Number.isInteger(Number(cycleIndex))&&Number(cycleIndex)>=0,'invalid cycle index');cycleIndex=Number(cycleIndex);
  const file=safePath(repoRoot,`_dev/sim-runs/research/_selections/${charterHash}/${cycleIndex}.json`);
  const existing=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  if(!specPath){check(!existing,'bound research selector omitted');return {status:'unassigned',benchmark_kind:'drift',goal_id:null,gaps:[],prerequisites:[]};}
  const loaded=loadExperiment({repoRoot,specPath,charterHash});const e=loaded.experiment;
  const receipt={schema:'ResearchSelection/1.0',charter_hash:charterHash,cycle_index:cycleIndex,batch_id:e.batch_id,spec_path:loaded.relative,spec_bytes_sha256:loaded.bytesHash,experiment_sha256:e.experiment_sha256,source_identities:e.source_identities,config_sha256:e.config_sha256};
  check(validateSelection(receipt),'invalid selection receipt');
  if(existing)check(validateSelection(existing)&&hashObject(existing)===hashObject(receipt),'research selection changed');
  if(bind&&!existing)writeExclusive(file,receipt);
  return {...readiness({repoRoot,specPath,charterHash}),selection_bound:Boolean(existing||bind)};
}
function selected(options){const context=selectionReadiness(options);check(context.selection_bound,'no immutable research selection');check(context.status==='ready','research objective not ready');return loadExperiment(options).experiment;}
function batchPath(repoRoot,e){return safePath(repoRoot,'_dev/sim-runs/research/'+e.batch_id);}
async function runResearch(options={}) {
  const repoRoot=options.repoRoot||ROOT;const e=selected(options);check(options.authorized===true,'explicit research authorization required');check(options.driftPassed===true,'successful fingerprint check required');
  const root=batchPath(repoRoot,e);check(!fs.existsSync(root),'research batch already exists; overwrite/resume refused');fs.mkdirSync(path.dirname(root),{recursive:true});fs.mkdirSync(root);
  const abort=new AbortController();const stop=()=>abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);const arms=[];const started=Date.now();let failure=null;
  try {for(const arm of e.arms)for(const seed of e.seeds){if(abort.signal.aborted||Date.now()-started>=e.limits.max_wall_ms){abort.abort();break;}const outputDir=safePath(repoRoot,`_dev/sim-runs/research/${e.batch_id}/${arm}/${seed}`);fs.mkdirSync(outputDir,{recursive:true});const result=await require('./rg01-driver.cjs').runArm({arm,seed,rounds:e.rounds,hiveIds:e.hive_ids,limits:{...e.limits,max_wall_ms:Math.max(1,e.limits.max_wall_ms-(Date.now()-started))},config:e.config,outputDir,signal:abort.signal,shouldStop:()=>abort.signal.aborted});arms.push(result);writeExclusive(path.join(outputDir,'evidence.json'),result);if(!result.complete)abort.abort();}
  }catch(error){failure=error.message;abort.abort();}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
    const record={schema:'ResearchBatch/1.0',failure,experiment_sha256:e.experiment_sha256,complete:arms.length===e.arms.length*e.seeds.length&&arms.every(a=>a.complete),arms};writeExclusive(path.join(root,'batch.json'),record);return record;
}

function observeResearch(options={}) {
  const e=selected(options);const root=batchPath(options.repoRoot||ROOT,e);const file=safePath(options.repoRoot||ROOT,`_dev/sim-runs/research/${e.batch_id}/batch.json`,{exists:true});const batch=JSON.parse(fs.readFileSync(file,'utf8'));check(batch.experiment_sha256===e.experiment_sha256,'batch identity mismatch');
  const analysis=require('./rg01-score.cjs').scoreBatch({experiment:e,arms:batch.arms});return {experiment:e,batch,analysis,complete:batch.complete&&analysis.valid,raw_evidence:batch.arms};
}
function debriefResearch(options={}) {
  const observed=observeResearch(options);const e=observed.experiment;const quick=options.quick===true;
  const analysis=quick?null:observed.analysis;const state=quick?'not_evaluated':observed.batch.complete?analysis.state:'invalid_experiment';
  const result={schema:'ResearchResult/1.0',batch_id:e.batch_id,experiment_sha256:e.experiment_sha256,state,invariants:quick?'not_evaluated':analysis.valid&&observed.batch.complete?'pass':'fail',research_complete:!quick&&analysis.valid&&observed.batch.complete,promotion:false,analysis,next_goal_proposal:quick?null:{goal_id:state==='valid_benefit_demonstrated'?'RG-02':'RG-01',requires_operator_decision:true,reason:state==='valid_benefit_demonstrated'?'Test repeat/restart continuity next.':'Resolve benchmark bottleneck before advancement.'}};
  check(validateResult(result),'invalid result: '+ajv.errorsText(validateResult.errors));
  const file=safePath(options.repoRoot||ROOT,`_dev/sim-runs/research/${e.batch_id}/${quick?'not-evaluated':'result'}.json`);
  if(fs.existsSync(file))check(hashObject(JSON.parse(fs.readFileSync(file,'utf8')))===hashObject(result),'existing result changed');else writeExclusive(file,result);return result;
}
module.exports={ROOT,safePath,sourceIdentities,prepare,readiness,loadExperiment,selectionReadiness,runResearch,observeResearch,debriefResearch,validateExperiment:validate,validateResult};
