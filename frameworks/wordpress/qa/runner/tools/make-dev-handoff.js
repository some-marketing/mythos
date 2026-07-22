#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function die(msg){
  console.error(msg);
  process.exit(1);
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

function isoCompact(){
  // 2026-01-24T11:39:13.123Z -> 2026-01-24T113913Z
  return new Date().toISOString().replace(/\.\d+Z$/,"Z").replace(/:/g,"");
}

function safeCp(src, dest){
  if(!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (s) => {
      const base = path.basename(s);
      if(base === ".DS_Store") return false;
      if(base === "node_modules") return false;
      return true;
    }
  });
  return true;
}

function safeCpPayloadVariants(tcRoot, outDir){
  if(!fs.existsSync(tcRoot)) return [];
  const copied = [];
  const entries = fs.readdirSync(tcRoot, {withFileTypes:true})
    .filter(d => d.isFile())
    .map(d => d.name)
    .sort();
  for(const name of entries){
    const lowerName = name.toLowerCase();
    if(!lowerName.endsWith(".json") && !lowerName.endsWith(".md")) continue;
    if(!(lowerName.startsWith("expected_payload") || lowerName.startsWith("actual_payload") || lowerName.startsWith("sent_payload"))) continue;
    if(safeCp(path.join(tcRoot, name), path.join(outDir, tcRoot, name))){
      copied.push(`${tcRoot}/${name}`);
    }
  }
  return copied;
}

function readTextSafe(p){
  try{ return fs.readFileSync(p, "utf-8"); }catch{ return null; }
}

function printHelp(){
  console.log(`
Create a dev-handoff bundle folder (copies of reports + run artifacts + exports).

Usage:
  node runner/tools/make-dev-handoff.js --testcase <TESTCASE_ID> [--runset_id run_0006]
  node runner/tools/make-dev-handoff.js --testcase <TESTCASE_ID> --out dev_handoff/<NAME>

Options:
  --testcase <TESTCASE_ID>         Required.
  --runset_id <RUNSET_ID>          Optional. Used for naming + README (does not restrict copies unless you pass --only_runset).
  --only_runset true|false         Optional. If true, only copy playwright_phased_runner/testcases/<id>/runs/<runset_id>/ (default: false).
  --include_legacy_runs true|false Optional. Copy legacy ./runs/ into bundle (default: true).
  --out <PATH>                     Optional. Output directory path.
  -h, --help                       Show help.

Output:
  Prints DEV_HANDOFF_DIR=<path>
`.trim());
}

const args = parseArgs(process.argv);
if(args.help){ printHelp(); process.exit(0); }

const testcaseId = args.testcase || args.testcase_id || args["testcase-id"];
if(!testcaseId) die("Error: --testcase <TESTCASE_ID> is required. Use -h for help.");

const runsetId = args.runset_id || args.runset || args["runset-id"] || null;
const onlyRunset = String(args.only_runset || args["only-runset"] || "false") === "true";
const includeLegacyRuns = String(args.include_legacy_runs || args["include-legacy-runs"] || "true") !== "false";

const tcRoot = path.join("testcases", String(testcaseId));
if(!fs.existsSync(tcRoot)) die(`Error: testcase folder not found: ${tcRoot}`);

const stamp = isoCompact();
const defaultOut = path.join(
  "dev_handoff",
  `DEV_HANDOFF__${String(testcaseId)}__${runsetId ? String(runsetId) : "all"}__${stamp}`
);
const outDir = String(args.out || args.out_dir || args["out-dir"] || defaultOut);

if(fs.existsSync(outDir)) die(`Error: output directory already exists: ${outDir}`);
fs.mkdirSync(outDir, { recursive: true });

// Best-effort git metadata (repo root is parent of this package)
let gitHead = null;
try{
  gitHead = execSync("git rev-parse --short HEAD", { stdio: ["ignore","pipe","ignore"] }).toString("utf-8").trim();
}catch{}

const copied = [];

// Reports (neutral)
if(safeCp("reports", path.join(outDir, "reports"))){
  copied.push("reports/");
}

// Testcase config + runs
if(onlyRunset){
  if(!runsetId) die("Error: --only_runset=true requires --runset_id <RUNSET_ID>.");
  const runsetPath = path.join(tcRoot, "runs", String(runsetId));
  if(!fs.existsSync(runsetPath)) die(`Error: runset not found: ${runsetPath}`);
  safeCp(path.join(tcRoot, "EXPECTED_OUTCOMES.md"), path.join(outDir, tcRoot, "EXPECTED_OUTCOMES.md"));
  const payloadVariantCopies = safeCpPayloadVariants(tcRoot, outDir);
  safeCp(path.join(tcRoot, "PAYLOAD_REFERENCE.md"), path.join(outDir, tcRoot, "PAYLOAD_REFERENCE.md"));
  safeCp(path.join(tcRoot, "testcase.json"), path.join(outDir, tcRoot, "testcase.json"));
  safeCp(path.join(tcRoot, "locator_map.json"), path.join(outDir, tcRoot, "locator_map.json"));
  safeCp(path.join(tcRoot, "identity.json"), path.join(outDir, tcRoot, "identity.json"));
  safeCp(path.join(tcRoot, "fields_mapped_to_crm.csv"), path.join(outDir, tcRoot, "fields_mapped_to_crm.csv"));
  safeCp(path.join(tcRoot, "system_fields_mapped_to_crm.csv"), path.join(outDir, tcRoot, "system_fields_mapped_to_crm.csv"));
  safeCp(runsetPath, path.join(outDir, tcRoot, "runs", String(runsetId)));
  copied.push(`${tcRoot}/(config files)`);
  for(const c of payloadVariantCopies) copied.push(c);
  copied.push(`${tcRoot}/runs/${String(runsetId)}/`);
}else{
  safeCp(tcRoot, path.join(outDir, tcRoot));
  copied.push(`${tcRoot}/`);
}

// Legacy runs (older structure)
if(includeLegacyRuns && fs.existsSync("runs")){
  safeCp("runs", path.join(outDir, "legacy_runs"));
  copied.push("legacy_runs/");
}

// Top-level exports pulled manually (copy all CSVs)
{
  const exportsOut = path.join(outDir, "exports");
  fs.mkdirSync(exportsOut, { recursive: true });
  const csvs = fs.readdirSync(".", { withFileTypes: true })
    .filter(d=>d.isFile())
    .map(d=>d.name)
    .filter(n=>n.toLowerCase().endsWith(".csv"));
  for(const name of csvs){
    safeCp(name, path.join(exportsOut, name));
  }
  if(csvs.length) copied.push(`exports/ (${csvs.length} csv)`);
}

// Handoff README + manifest
{
  const lines = [];
  lines.push("# Dev Handoff Bundle");
  lines.push("");
  lines.push(`- generated_at_utc: ${new Date().toISOString()}`);
  if(gitHead) lines.push(`- git_head: ${gitHead}`);
  lines.push(`- testcase_id: ${String(testcaseId)}`);
  if(runsetId) lines.push(`- runset_id: ${String(runsetId)}`);
  lines.push("");
  lines.push("## What to read first");
  lines.push("- `reports/FINAL_TEST_REPORT__*.md`");
  lines.push("- `reports/MAPPING_COVERAGE_MASTER_LIST__*.md`");
  lines.push("- `reports/PHASED_RUN_REPORT__*.md` (per runset manager summaries)");
  lines.push("");
  lines.push("## Included (copies)");
  for(const item of copied) lines.push(`- ${item}`);
  lines.push("");
  fs.writeFileSync(path.join(outDir, "HANDOFF.md"), lines.join("\n"), "utf-8");

  const manifest = {
    generated_at: new Date().toISOString(),
    git_head: gitHead,
    testcase_id: String(testcaseId),
    runset_id: runsetId ? String(runsetId) : null,
    only_runset: onlyRunset,
    include_legacy_runs: includeLegacyRuns,
    copied
  };
  fs.writeFileSync(path.join(outDir, "HANDOFF_MANIFEST.json"), JSON.stringify(manifest, null, 2), "utf-8");
}

console.log(`DEV_HANDOFF_DIR=${outDir}`);
