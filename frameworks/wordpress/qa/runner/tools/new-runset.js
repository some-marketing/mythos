#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

function die(msg){
  console.error(msg);
  process.exit(1);
}

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
Allocate a new runset folder for a testcase.

Purpose:
  Creates the next sequential run folder (run_0001, run_0002, ...) under
  playwright_phased_runner/testcases/<TESTCASE_ID>/runs/ and writes a runset.meta.json with a unique
  ID, timestamps, and reporting tags. This is concurrency-safe: if the folder
  already exists (race with another process), it retries the next number.

Usage:
  node runner/tools/new-runset.js --testcase <TESTCASE_ID> [--tags "csv,list"]
  npm run run:runset:new -- --testcase <TESTCASE_ID> [--tags "csv,list"]

Options:
  --testcase <TESTCASE_ID>   Required. The testcase folder name.
  --tags "csv,list"          Optional. Comma-separated reporting tags.
  -h, --help                 Show this help text.

Output (stdout, machine-parseable):
  RUNSET_ID=run_0001
  RUNSET_META=playwright_phased_runner/testcases/<TESTCASE_ID>/runs/run_0001/runset.meta.json

Examples:
  # Allocate a new runset for the baseline testcase
  npm run run:runset:new -- --testcase attribution_baseline_P1-P5

  # With tags
  npm run run:runset:new -- --testcase attribution_baseline_P1-P5 --tags "smoke,release-2026-01-24"

  # Then use the output in subagent commands:
  #   npm run run:phased -- --testcase attribution_baseline_P1-P5 \\
  #     --runset_id run_0001 --run_id A_run_0001 --env A
`.trim());
}

const args = parseArgs(process.argv);
if(args.help){ printHelp(); process.exit(0); }

const testcaseId = args.testcase || args.testcase_id || args["testcase-id"];
if(!testcaseId) die("Error: --testcase <TESTCASE_ID> is required. Use -h for help.");

const testcasePath = path.join("testcases", String(testcaseId));
const testcaseJsonPath = path.join(testcasePath, "testcase.json");

if(!fs.existsSync(testcasePath)){
  die(`Error: testcase folder not found: ${testcasePath}`);
}

const testcaseJson = readJson(testcaseJsonPath);
const site = testcaseJson?.site || null;
const era = testcaseJson?.era || null;

const tagsRaw = args.tags || "";
const tags = tagsRaw === true ? [] : String(tagsRaw).split(",").map(t => t.trim()).filter(Boolean);

const runsDir = path.join(testcasePath, "runs");
fs.mkdirSync(runsDir, { recursive: true });

function getNextId(runsDir){
  let entries = [];
  try{
    entries = fs.readdirSync(runsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }catch(e){
    // empty dir
  }
  let maxN = 0;
  for(const name of entries){
    const m = name.match(/^run_(\d+)$/);
    if(m){
      const n = parseInt(m[1], 10);
      if(n > maxN) maxN = n;
    }
  }
  return maxN + 1;
}

const MAX_RETRIES = 10;
let runsetId = null;
let runsetDir = null;

const startN = getNextId(runsDir);
for(let attempt = 0; attempt < MAX_RETRIES; attempt++){
  const candidateN = startN + attempt;
  const candidateId = `run_${String(candidateN).padStart(4, "0")}`;
  const candidateDir = path.join(runsDir, candidateId);
  try{
    fs.mkdirSync(candidateDir, { recursive: false });
    runsetId = candidateId;
    runsetDir = candidateDir;
    break;
  }catch(e){
    if(e.code === "EEXIST") continue;
    throw e;
  }
}

if(!runsetId){
  die("Error: failed to allocate runset folder after maximum retries.");
}

const now = new Date().toISOString();
const meta = {
  version: "1.0",
  runset_id: runsetId,
  runset_uid: randomUUID(),
  testcase_id: String(testcaseId),
  testcase_path: testcasePath,
  site,
  era,
  reporting: {
    tags
  },
  created_at: now,
  last_updated_at: now,
  env_runs_seen: []
};

const metaPath = path.join(runsetDir, "runset.meta.json");
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

// Create exports subdirectories for post-run backend data
const exportsDir = path.join(runsetDir, "exports");
fs.mkdirSync(path.join(exportsDir, "wpforms"), { recursive: true });
fs.mkdirSync(path.join(exportsDir, "crm"), { recursive: true });
fs.mkdirSync(path.join(exportsDir, "compare"), { recursive: true });

// Write exports README (template is at repo root /templates/)
const exportsReadmeTpl = path.resolve(process.cwd(), "..", "templates", "exports.README.md");
if(fs.existsSync(exportsReadmeTpl)){
  const readmeContent = fs.readFileSync(exportsReadmeTpl, "utf-8")
    .replace(/\{\{runset_id\}\}/g, runsetId);
  fs.writeFileSync(path.join(exportsDir, "README.md"), readmeContent, "utf-8");
}

// Machine-parseable output
console.log(`RUNSET_ID=${runsetId}`);
console.log(`RUNSET_META=${metaPath}`);
