#!/usr/bin/env node
import fs from "fs";
import path from "path";

function die(msg){
  console.error(msg);
  process.exit(1);
}

function mkdirp(p){ fs.mkdirSync(p,{recursive:true}); }

function readJson(p){
  try{
    return JSON.parse(fs.readFileSync(p,"utf-8"));
  }catch(e){
    return null;
  }
}

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
Compile a runset summary from per-env runs.

Usage:
  node runner/tools/compile-runset.js --runset_id run_1 [--runs_dir runs]
  node runner/tools/compile-runset.js --testcase <id> --runset_id run_1

Outputs:
  (default) runs/<runset_id>/derived/runset.summary.md
  (default) runs/<runset_id>/derived/runset.summary.json
  (with --testcase) playwright_phased_runner/testcases/<testcase_id>/runs/<runset_id>/derived/runset.summary.md
  (with --testcase) playwright_phased_runner/testcases/<testcase_id>/runs/<runset_id>/derived/runset.summary.json
`.trim());
}

function envSortKey(dirName){
  const m = String(dirName).match(/^([A-Z]+)-/);
  const env = m ? m[1] : "Z";
  const order = {A:0,B:1,C:2,D:3,E:4,F:5};
  return `${String(order[env] ?? 99).padStart(2,"0")}-${dirName}`;
}

function extractSection(md, heading){
  const text = String(md || "");
  const h = String(heading || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${h}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
  const m = text.match(re);
  if(!m) return null;
  const body = m[1].trim();
  return body ? body : null;
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

const args=parseArgs(process.argv);
if(args.help){ printHelp(); process.exit(0); }

const runsetId = args.runset_id || args["runset-id"];
if(!runsetId) die("--runset_id required");

const runsDir = args.runs_dir || args["runs-dir"] || "runs";
const testcaseId = args.testcase || args.testcase_id || args["testcase-id"] || null;
const runsetDir = testcaseId
  ? path.join("testcases", String(testcaseId), "runs", String(runsetId))
  : path.join(runsDir, String(runsetId));
if(!fs.existsSync(runsetDir)) die(`Missing runset folder: ${runsetDir}`);

const runsetMetaPath = path.join(runsetDir, "runset.meta.json");
const runsetMeta = fs.existsSync(runsetMetaPath) ? readJson(runsetMetaPath) : null;

const entries = fs.readdirSync(runsetDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .filter(name => name !== "derived")
  .sort((a,b)=>envSortKey(a).localeCompare(envSortKey(b)));

const envRuns = [];
let envTags = [];
for(const name of entries){
  const dir = path.join(runsetDir, name);
  const metaPath = path.join(dir, "run.meta.json");
  const summaryPath = path.join(dir, "derived", "run.summary.json");
  const notesPath = path.join(dir, "notes.md");
  const meta = readJson(metaPath);
  const summary = readJson(summaryPath);
  if(!meta || !summary) continue;
  const tags = meta?.reporting?.tags || summary?.reporting?.tags || [];
  envTags = envTags.concat(Array.isArray(tags) ? tags : []);
  const notesText = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : null;
  const deviations = notesText ? extractSection(notesText, "Deviations") : null;
  const finalNotes = notesText ? extractSection(notesText, "Final notes") : null;
  envRuns.push({
    dir: name,
    environment: meta.environment || summary.environment || null,
    login_state: meta.login_state || null,
    run_id: meta.run_id || summary.run_id || null,
    token: meta.runner?.token || summary.token || null,
    email: meta.test_identity?.email || null,
    tags: Array.isArray(tags) ? tags : [],
    submit_success: summary.submit?.success ?? null,
    url_after: summary.submit?.url_after ?? null,
    cookie_counts: summary.cookie_counts || null,
    datalayer_counts_by_event: summary.datalayer_counts_by_event || null,
    notes_path: fs.existsSync(notesPath) ? notesPath : null,
    deviations: deviations || null,
    final_notes: finalNotes || null,
    sources_used: [metaPath, summaryPath].concat(fs.existsSync(notesPath) ? [notesPath] : [])
  });
}

const outDir = path.join(runsetDir, "derived");
mkdirp(outDir);

const tagsUnion = uniqStrings([...(runsetMeta?.reporting?.tags || []), ...envTags]);

const outJson = {
  runset_id: String(runsetId),
  generated_at: new Date().toISOString(),
  reporting: { tags: tagsUnion },
  env_runs: envRuns,
  sources_used: envRuns.flatMap(r => r.sources_used).concat(runsetMeta ? [runsetMetaPath] : [])
};
fs.writeFileSync(path.join(outDir, "runset.summary.json"), JSON.stringify(outJson, null, 2), "utf-8");

const lines = [];
lines.push(`# Runset Summary — ${runsetId}`);
lines.push("");
lines.push(`- generated_at: ${outJson.generated_at}`);
lines.push(`- runs_found: ${envRuns.length}`);
if(tagsUnion.length) lines.push(`- tags: ${tagsUnion.join(", ")}`);
lines.push("");
for(const r of envRuns){
  lines.push(`## ${r.dir}`);
  lines.push(`- run_id: ${r.run_id || ""}`);
  lines.push(`- env: ${r.environment || ""}`);
  lines.push(`- login_state: ${r.login_state || ""}`);
  lines.push(`- token: ${r.token || ""}`);
  lines.push(`- email: ${r.email || ""}`);
  if(Array.isArray(r.tags) && r.tags.length) lines.push(`- tags: ${r.tags.join(", ")}`);
  lines.push(`- submit.success: ${r.submit_success === true ? "true" : (r.submit_success === false ? "false" : "unknown")}`);
  lines.push(`- final_url: ${r.url_after || ""}`);
  if(r.notes_path) lines.push(`- notes: ${r.notes_path}`);
  if(r.deviations) lines.push(`- deviations: ${r.deviations.split("\n").map(s=>s.trim()).filter(Boolean).join(" | ").slice(0,240)}`);
  if(r.final_notes) lines.push(`- final_notes: ${r.final_notes.split("\n").map(s=>s.trim()).filter(Boolean).join(" | ").slice(0,240)}`);
  lines.push("");
}
fs.writeFileSync(path.join(outDir, "runset.summary.md"), lines.join("\n"), "utf-8");

console.log(`Wrote ${path.join(outDir, "runset.summary.md")}`);
