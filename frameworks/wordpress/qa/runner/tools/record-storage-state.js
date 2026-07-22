#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";

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
Record a logged-in Playwright storageState file for env B.

Usage:
  node runner/tools/record-storage-state.js --out <path> --login_url <url> [--browser_channel chrome]
  node runner/tools/record-storage-state.js --testcase <TESTCASE_ID> [--env B] [--browser_channel chrome]
  node runner/tools/record-storage-state.js --testcase_path <path> [--env B] [--browser_channel chrome]
  node runner/tools/record-storage-state.js --site <host> [--env B] [--browser_channel chrome]

Steps:
  1) A headed Chromium window opens.
  2) You log in manually.
  3) Press Enter in this terminal to save storageState.
`.trim());
}

function mkdirp(p){ fs.mkdirSync(p,{recursive:true}); }

function readJsonSafe(p){
  try{
    if(!p) return null;
    if(!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }catch{
    return null;
  }
}

function resolvePathFrom(baseDir, p){
  const s = String(p || "");
  if(!s) return null;
  if(path.isAbsolute(s)) return s;
  return path.normalize(path.join(String(baseDir || process.cwd()), s));
}

function computeHostPlatformOverride() {
  if (process.platform !== "darwin") return null;
  if (process.arch !== "arm64") return null;
  try {
    if (os.cpus().some((cpu) => String(cpu?.model || "").includes("Apple"))) return null;
  } catch {}
  const major = parseInt(String(os.release()).split(".")[0] || "", 10);
  if (!Number.isFinite(major)) return null;
  if (major < 20) return null;
  const lastStableMacMajor = 15;
  const macMajor = Math.min(major - 9, lastStableMacMajor);
  return `mac${macMajor}-arm64`;
}

function applyPlaywrightEnvFixups() {
  const tmpDir = process.env.PW_TMPDIR || path.join(process.cwd(), ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.TMPDIR = tmpDir;

  if (!process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE) {
    const override = computeHostPlatformOverride();
    if (override) process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = override;
  }
}

async function waitForEnter(){
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question("After logging in, press Enter to save storageState... ", () => resolve()));
  rl.close();
}

const args=parseArgs(process.argv);
if(args.help){ printHelp(); process.exit(0); }

const env = String(args.env || "B").toUpperCase();

const testcaseId = args.testcase || args.testcase_id || args["testcase-id"] || null;
const testcasePathArg = args.testcase_path || args["testcase-path"] || null;

let testcaseRoot = null;
let testcaseJson = null;
if(testcasePathArg){
  testcaseRoot = resolvePathFrom(process.cwd(), testcasePathArg);
  testcaseJson = readJsonSafe(path.join(testcaseRoot, "testcase.json"));
}else if(testcaseId){
  testcaseRoot = path.join(process.cwd(), "testcases", String(testcaseId));
  testcaseJson = readJsonSafe(path.join(testcaseRoot, "testcase.json"));
}

const site = args.site || testcaseJson?.site || null;

let out = args.out || args["storage_state_out"] || args["storage-state-out"] || null;
let loginUrl = args.login_url || args["login-url"] || null;
const channel = args.browser_channel || args["browser-channel"] || null;

if(env !== "B"){
  throw new Error("This tool currently supports env=B only (logged_in).");
}

if(!out){
  if(testcaseRoot && testcaseJson?.auth_states?.B?.storage_state_in){
    out = resolvePathFrom(testcaseRoot, testcaseJson.auth_states.B.storage_state_in);
  }
  if(!out){
    if(!site) throw new Error("--out <path> required (or provide --site <host> or --testcase <id> to use the shared auth_states path)");
    out = path.join("auth_states", String(site), "B-logged_in.storage.json");
  }
}else{
  out = resolvePathFrom(process.cwd(), out);
}
if(!loginUrl){
  if(testcaseJson?.auth_states?.B?.login_url){
    loginUrl = String(testcaseJson.auth_states.B.login_url);
  }else if(site){
    loginUrl = `https://${String(site)}/login`;
  }else{
    throw new Error("--login_url <url> required (or provide --site <host> / --testcase <id> to default to https://<site>/login)");
  }
}

mkdirp(path.dirname(String(out)));

console.log(`Recording storageState for env ${env}`);
if(testcaseId) console.log(`- testcase: ${testcaseId}`);
if(site) console.log(`- site: ${site}`);
console.log(`- login_url: ${loginUrl}`);
console.log(`- out: ${out}`);

applyPlaywrightEnvFixups();

const { chromium } = await import("playwright");

const launchOptions = { headless: false };
if(channel) launchOptions.channel = String(channel);

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
await page.goto(String(loginUrl), { waitUntil: "networkidle" });

await waitForEnter();

await context.storageState({ path: String(out) });
console.log(`Wrote storageState: ${out}`);

await context.close();
await browser.close();
