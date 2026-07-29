#!/usr/bin/env node
import fs from "fs";
import path from "path";

function die(msg){
  console.error(msg);
  process.exit(1);
}

function mkdirp(p){ fs.mkdirSync(p,{recursive:true}); }

function parseArgs(argv){
  const a={};
  for(let i=2;i<argv.length;i++){
    const k=argv[i];
    if(k==="-h" || k==="--help"){a.help=true;continue;}
    if(k.startsWith("--")){
      const eq=k.indexOf("=");
      if(eq!==-1){
        const key=k.slice(2,eq);
        const val=k.slice(eq+1);
        a[key]=val===""?true:val;
        continue;
      }
      const key=k.slice(2);
      const val=(argv[i+1] && !argv[i+1].startsWith("--"))?argv[++i]:true;
      a[key]=val;
    }
  }
  return a;
}

function printHelp(){
  console.log(`
Index testcase runsets and tags for reporting.

Usage:
  node runner/tools/index-runsets.js
  node runner/tools/index-runsets.js --tag smoke
  node runner/tools/index-runsets.js --testcases_dir testcases --out_dir derived
  node runner/tools/index-runsets.js --expected_envs A,B,C

Outputs:
  <out_dir>/runsets.index.json
  <out_dir>/runsets.index.md
`.trim());
}

function readJsonSafe(p){
  try{
    if(!p) return null;
    if(!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p,"utf-8"));
  }catch{
    return null;
  }
}

function uniqStrings(arr){
  const out = [];
  for(const v of (Array.isArray(arr) ? arr : [])){
    const s = String(v || "").trim();
    if(!s) continue;
    if(out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function summaryToStatus(summary){
  if(!summary) return "NO_RUN";
  if(summary.status === "failed") return "FAIL";
  const ok = summary.submit?.success;
  if(ok === true) return "PASS";
  if(ok === false) return "FAIL";
  return "UNKNOWN";
}

function overallStatus(perEnv){
  const vals = Object.values(perEnv || {});
  if(!vals.length) return "NO_RUN";
  if(vals.includes("FAIL")) return "SOME_FAILED";
  const hasNoRun = vals.includes("NO_RUN");
  const hasUnknown = vals.includes("UNKNOWN");
  if(!hasNoRun && !hasUnknown && vals.every(v=>v==="PASS")) return "ALL_PASS";
  return "PARTIAL";
}

const args=parseArgs(process.argv);
if(args.help){ printHelp(); process.exit(0); }

const testcasesDir = String(args.testcases_dir || args["testcases-dir"] || "testcases");
const outDir = String(args.out_dir || args["out-dir"] || "derived");
const tagFilter = args.tag || args.tags || null;
const expectedEnvs = uniqStrings(String(args.expected_envs || args["expected-envs"] || "A,B,C").split(",").map(s=>s.toUpperCase()));
const filterTags = tagFilter && tagFilter !== true
  ? uniqStrings(String(tagFilter).split(","))
  : null;

if(!fs.existsSync(testcasesDir)) die(`Missing testcases dir: ${testcasesDir}`);

const runsets = [];
for(const tc of fs.readdirSync(testcasesDir, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort()){
  const tcRoot = path.join(testcasesDir, tc);
  const runsRoot = path.join(tcRoot, "runs");
  if(!fs.existsSync(runsRoot)) continue;
  for(const runsetId of fs.readdirSync(runsRoot, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort()){
    const runsetDir = path.join(runsRoot, runsetId);
    const runsetMetaPath = path.join(runsetDir, "runset.meta.json");
    const runsetMeta = readJsonSafe(runsetMetaPath);

    const perEnv = {};
    const envDirs = fs.readdirSync(runsetDir, {withFileTypes:true})
      .filter(d=>d.isDirectory())
      .map(d=>d.name)
      .filter(n=>n !== "derived");
    let envTags = [];
    for(const envDirName of envDirs){
      const m = readJsonSafe(path.join(runsetDir, envDirName, "run.meta.json"));
      if(m?.reporting?.tags?.length) envTags = envTags.concat(m.reporting.tags);
      const s = readJsonSafe(path.join(runsetDir, envDirName, "derived", "run.summary.json"));
      const env = String(m?.environment || s?.environment || envDirName.split("-")[0] || "").toUpperCase();
      if(env) perEnv[env] = summaryToStatus(s);
    }
    for(const env of expectedEnvs){
      if(!perEnv[env]) perEnv[env] = "NO_RUN";
    }

    const tags = uniqStrings([...(runsetMeta?.reporting?.tags || []), ...envTags]);
    if(filterTags && !filterTags.every(t=>tags.includes(t))) continue;

    runsets.push({
      testcase_id: tc,
      runset_id: runsetId,
      runset_dir: runsetDir,
      site: runsetMeta?.site || null,
      era: runsetMeta?.era || null,
      reporting: { tags },
      env_status: perEnv,
      overall_status: overallStatus(perEnv),
      created_at: runsetMeta?.created_at || null,
      last_updated_at: runsetMeta?.last_updated_at || null,
      sources_used: uniqStrings([
        fs.existsSync(runsetMetaPath) ? runsetMetaPath : null,
        ...envDirs.map(d=>path.join(runsetDir,d,"run.meta.json")),
        ...envDirs.map(d=>path.join(runsetDir,d,"derived","run.summary.json"))
      ])
    });
  }
}

mkdirp(outDir);
const outJson = {
  generated_at: new Date().toISOString(),
  filter_tags: filterTags,
  runsets
};
fs.writeFileSync(path.join(outDir, "runsets.index.json"), JSON.stringify(outJson, null, 2), "utf-8");

const lines = [];
lines.push(`# Runsets Index`);
lines.push("");
lines.push(`- generated_at: ${outJson.generated_at}`);
if(filterTags && filterTags.length) lines.push(`- filter_tags: ${filterTags.join(", ")}`);
lines.push(`- runsets_found: ${runsets.length}`);
lines.push("");
for(const r of runsets){
  lines.push(`## ${r.testcase_id} / ${r.runset_id}`);
  lines.push(`- overall_status: ${r.overall_status}`);
  lines.push(`- tags: ${r.reporting.tags.join(", ")}`);
  lines.push(`- runset_dir: ${r.runset_dir}`);
  const envKeys = Object.keys(r.env_status || {}).sort();
  if(envKeys.length){
    lines.push(`- env_status: ${envKeys.map(k=>`${k}=${r.env_status[k]}`).join(" ")}`);
  }
  lines.push("");
}
fs.writeFileSync(path.join(outDir, "runsets.index.md"), lines.join("\n"), "utf-8");

console.log(`Wrote ${path.join(outDir, "runsets.index.md")}`);
