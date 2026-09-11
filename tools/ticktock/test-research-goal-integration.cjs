'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const charterMod = require('./charter.cjs');
const bench = require('./run-benchmark.js');
const { commands } = require('./cycle-driver.cjs');
const io = require('../ant-hive-world/research/research-io.cjs');
const { hashObject } = require('./canonical.cjs');
const REPO_ROOT = path.resolve(__dirname, '../..');
const MINIMAL_TEMPLATE = path.join(__dirname, '__fixtures__/charter-template-test-minimal.json');
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value,null,2)+'\n'); return file; }
async function invoke(command, ...args) {
  // Run the actual exported consumer in a child, so node:test's own output is
  // never intercepted while an asynchronous research arm yields to the loop.
  const script = `const fs=require('node:fs');const {commands}=require(process.argv[1]);
    const [command,...args]=JSON.parse(fs.readFileSync(0,'utf8'));
    Promise.resolve().then(()=>commands[command](...args)).then(status=>{process.exitCode=status;})
      .catch(error=>{process.stderr.write(error.message);process.exitCode=3;});`;
  try {
    const stdout=execFileSync(process.execPath,['-e',script,path.join(__dirname,'cycle-driver.cjs')],
      {input:JSON.stringify([command,...args]),encoding:'utf8',stdio:['pipe','pipe','pipe']});
    return {status:0,data:JSON.parse(stdout)};
  } catch(error) {
    if(error.status===1 && error.stdout) return {status:1,data:JSON.parse(error.stdout)};
    throw new Error(String(error.stderr||error.message));
  }
}
function fixtureCharter(id, benchmarkOverrides) {
  return charterMod.createCharter({
    charter_id: id,
    created_at: '2026-08-11T06:00:00.000Z',
    target: { description: 'benchmark-halt-enum fixture', repo_root: REPO_ROOT, subject: 'unit test' },
    cycle_ceiling: 5,
    evaluator_versions: { journal: '1.0' },
    allowed_write_surfaces: ['tools/ticktock/**'],
    max_cumulative_diff: { lines_changed: 5, files_changed: 2 },
    max_external_actions: 1,
    resource_ceilings: { wall_clock_seconds_per_cycle: 60, wall_clock_seconds_total: 600, max_subagent_dispatches: 1 },
    reviewer_roster: {
      locked_at: '2026-08-11T06:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-11T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-11T06:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: { until_kind: 'cycle_ceiling', halt_conditions: ['LINEAGE-CHAIN-BROKEN', 'BENCHMARK-ERROR'] },
    benchmark: {
      colony_spec_path: 'tools/ticktock/benchmark-colony-v1.json',
      colony_spec_version: 'v1',
      fingerprint_path: '_dev/state/ticktock/benchmark-fingerprint-v1.json',
      fingerprint_hash: 'a'.repeat(64),
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 },
      ...benchmarkOverrides
    }
  }, { templatePath: MINIMAL_TEMPLATE });
}


test('actual cycle consumers preserve drift, bind selection, refuse swaps, and report fixture evidence honestly', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tt-research-integration-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sources=io.sourceIdentities();
  for(const relative of Object.keys(sources)) {
    const dest=path.join(root,relative); fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(path.join(REPO_ROOT,relative),dest);
  }
  const specPath=path.join(root,'colony.json');
  // A small, complete behavioral fixture, not a rebaseline of the live colony.
  const colony=JSON.parse(fs.readFileSync(bench.DEFAULT_SPEC_PATH,'utf8'));
  colony.engine.cli_args[colony.engine.cli_args.indexOf('--ticks')+1]='3';
  writeJson(specPath,colony);
  const fpPath=path.join(root,'fingerprint.json');
  const fp=bench.record({specPath}).fingerprint; writeJson(fpPath,fp);
  const charter=fixtureCharter('research-integration',{colony_spec_path:specPath,fingerprint_path:fpPath,fingerprint_hash:fp.fingerprint_hash});
  const charterPath=writeJson(path.join(root,'charter.json'),charter);
  const charterBytes=fs.readFileSync(charterPath,'utf8'), fingerprintBytes=fs.readFileSync(fpPath,'utf8');
  const options={repoRoot:root}; const signals=path.join(root,'signals');
  const out=path.join(root,'benchmark.json');
  let diagnosticId=0;
  const diagnosticRoot=cycle=>`_dev/sim-runs/research/_benchmark/${charter.charter_hash}/${cycle}`;
  const diagnostic=cycle=>diagnosticRoot(cycle)+`/check-${++diagnosticId}.json`;
  const selectedSignals=cycle=>diagnosticRoot(cycle)+'/signals';
  const orient=(cycle,spec,target=spec?diagnostic(cycle):out,signalDir=spec?selectedSignals(cycle):signals)=>invoke('benchmark',charterPath,target,String(cycle),signalDir,...(spec?['--research-spec',spec]:[]),options);
  const phase=(kind,cycle,spec,extra=[],target=spec?diagnostic(cycle):out,signalDir=spec?selectedSignals(cycle):signals)=>invoke('research-'+kind,charterPath,String(cycle),...(spec?['--research-spec',spec]:[]),'--benchmark-out',target,'--signals-dir',signalDir,...extra,options);
  const draft=(batchId,goalId='RG-01')=>io.prepare({repoRoot:root,batchId,goalId,charterHash:charter.charter_hash,seeds:[11],rounds:2,hiveIds:['hive-a']}).spec_path;

  await t.test('unassigned cycle zero retains ordinary mode with no research directory',async()=>{
    const result=await orient(0); assert.equal(result.status,0);assert.equal(result.data.result.result.identical,true);
    assert.equal(result.data.research_context.status,'unassigned');
    assert.equal(fs.existsSync(path.join(root,'_dev/sim-runs/research')),false);
    assert.equal((await phase('tick',0)).data.status,'unassigned');
  });
  const spec=draft('fixture-one');
  await t.test('missing capability evidence is not ready even when drift passes',async()=>{
    const result=await orient(1,spec);assert.equal(result.data.research_context.status,'not_ready');
    await assert.rejects(()=>phase('tick',1,spec,['--authorized']),/not ready/);
  });
  // Synthetic gate records are test inputs only, never scientific/review evidence.
  const sourceHash=hashObject(io.sourceIdentities(root));
  const evidencePath='fixture-verification.json', reviewPath='fixture-review.json';
  writeJson(path.join(root,evidencePath),{schema:'ResearchVerification/1.0',status:'pass',source_identities_sha256:sourceHash,checks:{adapter_equivalence:true,accounting:true,isolation:true,reproducibility:true},fixture_only:true});
  writeJson(path.join(root,reviewPath),{schema:'ResearchImplementationReview/1.0',status:'pass',source_identities_sha256:sourceHash,producer_family:'codex',reviewer_family:'claude',fixture_only:true});
  const digest=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  writeJson(path.join(root,'_dev/sim-runs/research/_capabilities/rg01.json'),{schema:'ResearchCapability/1.0',source_identities_sha256:sourceHash,evidence:{path:evidencePath,sha256:digest(evidencePath)},review:{path:reviewPath,sha256:digest(reviewPath)}});
  await t.test('both aliases resolve to owning command and actual benchmark consumer',async()=>{
    const alias=fs.readFileSync(path.join(REPO_ROOT,'.claude/commands/tt.md'),'utf8');
    const command=fs.readFileSync(path.join(REPO_ROOT,'.claude/commands/ticktock.md'),'utf8');
    const skill=fs.readFileSync(path.join(REPO_ROOT,'.claude/skills/ticktock/SKILL.md'),'utf8');
    assert.match(alias,/Follow `.claude\/commands\/ticktock.md`/);
    assert.match(command,/cycle-driver.cjs benchmark/);
    for(const name of ['research-tick','research-observe','research-debrief']) {assert.match(skill,new RegExp('cycle-driver.cjs '+name));assert.equal(typeof commands[name],'function');}
    for(const cycle of [1,2]) {const result=await orient(cycle,spec);assert.equal(result.status,0);assert.equal(result.data.research_context.goal_id,'RG-01');assert.equal(result.data.research_context.selection_bound,true);}
  });
  await t.test('unchanged inspection succeeds, omission and path/hash swaps refuse every consumer',async()=>{
    assert.equal((await orient(1,spec)).status,0);
    const swapped=draft('fixture-two');
    const sameBytes='_dev/sim-runs/research/_drafts/copied.json';
    fs.copyFileSync(path.join(root,spec),path.join(root,sameBytes));
    for(const candidate of [undefined,swapped,sameBytes]) {
      await assert.rejects(()=>orient(1,candidate),/selector omitted|selection changed/);
      for(const kind of ['tick','observe','debrief'])await assert.rejects(()=>phase(kind,1,candidate),/selector omitted|selection changed/);
    }
    const saved=fs.readFileSync(path.join(root,spec),'utf8');
    const changed=JSON.parse(saved);changed.question+=' changed';writeJson(path.join(root,spec),changed);
    for(const kind of ['orient','tick','observe','debrief'])await assert.rejects(()=>kind==='orient'?orient(1,spec):phase(kind,1,spec),/stale experiment hash/);
    fs.writeFileSync(path.join(root,spec),saved);
  });
  await t.test('invalid and stale selection cannot create selection/batch or become ordinary',async()=>{
    await assert.rejects(()=>orient(3,'missing.json'),/missing artifact/);
    const bad=draft('bad-identity');const file=path.join(root,bad);const original=fs.readFileSync(file,'utf8');
    for(const field of ['charter_hash','primary_goal']) {
      const changed=JSON.parse(original);changed[field]=field==='charter_hash'?'f'.repeat(64):'RG-99';
      changed.experiment_sha256=hashObject(changed,['experiment_sha256']);writeJson(file,changed);
      await assert.rejects(()=>orient(3,bad),/mismatched charter|invalid experiment/);
    }
    fs.writeFileSync(file,original);
    const source=Object.keys(sources)[0], sourceFile=path.join(root,source), bytes=fs.readFileSync(sourceFile);
    fs.appendFileSync(sourceFile,'\n// fixture drift\n');await assert.rejects(()=>orient(3,bad),/stale source/);fs.writeFileSync(sourceFile,bytes);
    assert.equal(fs.existsSync(path.join(root,'_dev/sim-runs/research/_selections',charter.charter_hash,'3.json')),false);
    assert.equal(fs.existsSync(path.join(root,'_dev/sim-runs/research/bad-identity')),false);
  });
  await t.test('unsupported goals remain visible but cannot dispatch',async()=>{
    const later=draft('later-goal','RG-02');const result=await orient(4,later);
    assert.equal(result.data.research_context.status,'not_ready');assert.equal(result.data.research_context.goal_id,'RG-02');
    await assert.rejects(()=>phase('tick',4,later,['--authorized']),/not ready/);
    assert.equal(fs.existsSync(path.join(root,'_dev/sim-runs/research/later-goal')),false);
  });
  await t.test('selected diagnostic admission protects inputs before benchmark signals can write',async()=>{
    const selection=path.join(root,`_dev/sim-runs/research/_selections/${charter.charter_hash}/1.json`);
    const developmental=writeJson(path.join(root,'_dev/state/developmental.json'),{untouched:true});
    const protectedFiles=[charterPath,path.join(root,spec),selection,developmental];
    // This lineage would make benchmarkCheck emit a rebaseline signal. Bad
    // destinations must refuse before even that earliest benchmark side effect.
    const altered=JSON.parse(fingerprintBytes);altered.lineage=[0,1,2].map(triggering_cycle=>({triggering_cycle}));writeJson(fpPath,altered);
    for(const file of protectedFiles) {
      const bytes=fs.readFileSync(file);
      await assert.rejects(()=>orient(2,spec,file),/RESEARCH-DIAGNOSTIC/);
      for(const kind of ['tick','observe','debrief']) await assert.rejects(()=>phase(kind,2,spec,[],file),/RESEARCH-DIAGNOSTIC/);
      assert.deepEqual(fs.readFileSync(file),bytes);
    }
    // Dropping the selector cannot route the supplied protected output through
    // the legacy writer, even though a complete binding already exists.
    await assert.rejects(()=>orient(1,undefined,charterPath),/selector omitted/);
    for(const kind of ['tick','observe','debrief'])await assert.rejects(()=>phase(kind,1,undefined,[],charterPath),/selector omitted/);
    assert.equal(fs.readFileSync(charterPath,'utf8'),charterBytes);
    const outside=path.join(root,'escaped-signals');
    await assert.rejects(()=>orient(2,spec,diagnostic(2),outside),/RESEARCH-SIGNALS-PATH/);
    for(const kind of ['tick','observe','debrief'])await assert.rejects(()=>phase(kind,2,spec,[],diagnostic(2),outside),/RESEARCH-SIGNALS-PATH/);
    assert.equal(fs.existsSync(outside),false);
    assert.equal(fs.existsSync(path.join(root,selectedSignals(2))),false);
    const legal=diagnostic(2);const emitted=await orient(2,spec,legal);
    assert.equal(emitted.data.halt_state,'REBASELINE-FREQUENCY');
    const signalPath=path.join(root,selectedSignals(2),`ticktock-rebaseline-frequency__${charter.charter_id}__2.json`);
    assert.equal(fs.existsSync(signalPath),true);
    const signalBytes=fs.readFileSync(signalPath);
    await orient(2,spec);assert.deepEqual(fs.readFileSync(signalPath),signalBytes);
    fs.writeFileSync(fpPath,fingerprintBytes);
  });
  await t.test('diagnostics reject traversal, symlinks and existing outputs; inspection uses fresh IDs',async()=>{
    const good=diagnostic(1);await orient(1,spec,good);const prior=fs.readFileSync(path.join(root,good));
    await assert.rejects(()=>orient(1,spec,good),/RESEARCH-DIAGNOSTIC-EXISTS/);
    assert.deepEqual(fs.readFileSync(path.join(root,good)),prior);
    await assert.rejects(()=>orient(1,spec,diagnosticRoot(1)+'/../1/traverse.json'),/unsafe path/);
    const linked=diagnosticRoot(1)+'/linked.json';fs.symlinkSync(charterPath,path.join(root,linked));
    await assert.rejects(()=>orient(1,spec,linked),/symlink/);assert.equal(fs.readFileSync(charterPath,'utf8'),charterBytes);
    const signalDir=path.join(root,selectedSignals(1));fs.symlinkSync(path.dirname(charterPath),signalDir);
    await assert.rejects(()=>orient(1,spec),/symlink/);fs.unlinkSync(signalDir);
    fs.mkdirSync(signalDir);const leaf=path.join(signalDir,`ticktock-rebaseline-frequency__${charter.charter_id}__1.json`);
    fs.symlinkSync(path.join(root,'does-not-exist'),leaf);await assert.rejects(()=>orient(1,spec),/symlink/);fs.unlinkSync(leaf);
    assert.equal((await orient(1,spec)).status,0);
  });
  await t.test('behavioral drift refuses before selection binding or arm dispatch',async()=>{
    const changed=structuredClone(colony);changed.engine.cli_args[changed.engine.cli_args.indexOf('--ticks')+1]='4';writeJson(specPath,changed);
    const result=await orient(5,spec);assert.equal(result.status,1);assert.equal(result.data.halt_state,'BENCHMARK-DIVERGENCE');
    const tick=await phase('tick',1,spec,['--authorized']);assert.equal(tick.status,1);assert.equal(tick.data.halt_state,'BENCHMARK-DIVERGENCE');
    assert.equal(fs.existsSync(path.join(root,'_dev/sim-runs/research/fixture-one')),false);
    assert.equal(fs.existsSync(path.join(root,'_dev/sim-runs/research/_selections',charter.charter_hash,'5.json')),false);
    writeJson(specPath,colony);
  });
  await t.test('real tiny fixture execution requires intent, records evidence, and never promotes',async()=>{
    await assert.rejects(()=>phase('tick',1,spec),/authorization/);
    const result=await phase('tick',1,spec,['--authorized']);assert.equal(result.status,0);assert.equal(result.data.complete,true);assert.equal(result.data.arms.length,3);
    const observed=await phase('observe',1,spec);assert.equal(observed.data.complete,true);assert.equal(observed.data.raw_evidence.length,3);
    const quick=await phase('debrief',1,spec,['--quick']);assert.equal(quick.data.state,'not_evaluated');assert.equal(quick.data.promotion,false);
    const full=await phase('debrief',1,spec);assert.equal(full.data.promotion,false);assert.equal(full.data.next_goal_proposal.requires_operator_decision,true);
    await assert.rejects(()=>phase('tick',1,spec,['--authorized']),/overwrite\/resume refused/);
    assert.equal(fs.readFileSync(charterPath,'utf8'),charterBytes);assert.equal(fs.readFileSync(fpPath,'utf8'),fingerprintBytes);
  });
  await t.test('CLI has no root redirect, rejects malformed/duplicate selector flags',async()=>{
    for(const args of [['--repo-root',root],['--research-spec'],['--research-spec',spec,'--research-spec',spec]]) {
      await assert.rejects(()=>invoke('benchmark',charterPath,out,'0',signals,...args,options),/RESEARCH-ARGUMENT/);
    }
    assert.throws(()=>execFileSync(process.execPath,[path.join(__dirname,'cycle-driver.cjs'),'research-tick',charterPath,'1','--repo-root',root],{encoding:'utf8',stdio:'pipe'}),/Command failed/);
  });
});
