#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { chromium, firefox, webkit } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv){
  const a={};
  for(let i=2;i<argv.length;i++){
    const k=argv[i];
    if(k==="-h" || k==="--help"){a.help=true;continue;}
    if(k==="--headed"){a.headed=true;continue;}
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
const args=parseArgs(process.argv);

function mkdirp(p){ fs.mkdirSync(p,{recursive:true}); }
function writeText(p,s){ mkdirp(path.dirname(p)); fs.writeFileSync(p,s,"utf-8"); }
function writeJSON(p,o){ mkdirp(path.dirname(p)); fs.writeFileSync(p,JSON.stringify(o,null,2),"utf-8"); }
function appendJSONL(p,o){ mkdirp(path.dirname(p)); fs.appendFileSync(p,JSON.stringify(o)+"\n","utf-8"); }
function nowISO(){ return new Date().toISOString(); }
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function screenshot(page,out){ mkdirp(path.dirname(out)); await page.screenshot({path:out, fullPage:true}); }
async function saveCookies(context,out){ writeJSON(out, await context.cookies()); }

function readJsonSafe(p){
  try{
    if(!p) return null;
    if(!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p,"utf-8"));
  }catch{
    return null;
  }
}

function loadDefaultsConfig(args){
  const cfgPath = String((args.config || args["config-file"] || args["config_path"] || args["config-path"]) || "runner/config/defaults.json");
  const cfg = readJsonSafe(cfgPath);
  return {cfgPath, cfg: (cfg && typeof cfg==="object") ? cfg : null};
}

function loadTestcaseConfig(args){
  const testcaseId = args.testcase || args.testcase_id || args["testcase-id"] || args["testcase_id"] || null;
  const testcasePathArg = args.testcase_path || args["testcase-path"] || null;

  if(testcasePathArg){
    const root = String(testcasePathArg);
    const cfgPath = path.join(root, "testcase.json");
    const cfg = readJsonSafe(cfgPath);
    return {testcase_id: cfg?.testcase_id || null, root, cfgPath, cfg: (cfg && typeof cfg==="object") ? cfg : null};
  }
  if(testcaseId){
    const root = path.join("testcases", String(testcaseId));
    const cfgPath = path.join(root, "testcase.json");
    const cfg = readJsonSafe(cfgPath);
    return {testcase_id: String(testcaseId), root, cfgPath, cfg: (cfg && typeof cfg==="object") ? cfg : null};
  }
  return {testcase_id: null, root: null, cfgPath: null, cfg: null};
}

function resolvePathFrom(baseDir, p){
  const s = String(p || "");
  if(!s) return null;
  if(path.isAbsolute(s)) return s;
  if(baseDir){
    const baseNorm = path.normalize(String(baseDir));
    const sNorm = path.normalize(s);
    if(sNorm === baseNorm || sNorm.startsWith(baseNorm + path.sep)) return sNorm;
    return path.normalize(path.join(baseNorm, s));
  }
  return path.normalize(s);
}

function pickArg(args, ...keys){
  for(const k of keys){
    const v = args[k];
    if(v !== undefined && v !== null) return v;
  }
  return undefined;
}

function errorToJson(err){
  const e = err && typeof err === "object" ? err : { message: String(err) };
  return {
    name: String(e.name || "Error"),
    message: String(e.message || String(err)),
    stack: e.stack ? String(e.stack) : null
  };
}

function printHelp(){
  const help = `
Playwright phased runner (P1–P5)

Usage:
  npm run run:phased -- --run_id <id> [--runset_id <runset>] [--config <path>] [options]

Required:
  --run_id <id>                 Run id (used for tokens + metadata)
  --runset_id <runset>          Optional per-run grouping folder (recommended for A/B/C comparability)
  --config <path>               Optional defaults config JSON (default: runner/config/defaults.json if present)
  --testcase <id>               Optional testcase folder under playwright_phased_runner/testcases/<id>/ (writes outputs under that testcase)

One of:
  --site <host>                 Sets direct/apply URLs to https://<host>/ and https://<host>/apply
  --direct_url <url>            Direct (non-decorated) URL
  --apply_url <url>             Apply URL
  --testcase_path <path>         Alternative to --testcase. Points to a testcase folder containing testcase.json

Options:
  --env <A|B|C|CT>              Default: A
  --era <string>                Default: unknown
  --locator_map <path>          Default: runner/locator_maps/wpforms_apply.default.json
  --identity <path>             Default: runner/testdata/attribution_baseline.identity.json
  --decorated_url <url>         UTM/decorated landing URL (will be validated)
  --decorated_url_base <url>    Base landing URL; runner appends required params automatically
  --next_wait_ms <ms>           Default: 3000
  --auto_navigate_max_retries <n>  Max auto-nav attempts on stuck intermediate pages (default: 3)
  --tags <csv>                  Optional reporting tags (comma-separated)
  --storage_state_in <path>     Load Playwright storageState JSON (env B recommended/required)
  --storage_state_out <path>    Save Playwright storageState JSON at end of run
  --strict_identity              Fail if a required field is missing or unmapped
  --headed                       Launch headed (use npm run run:phased:headed for wrapper defaults)
  --browser <chromium|firefox|webkit>      Default: chromium
  --browser_channel <string>     Chromium-only. Example: chrome
  --browser_executable <path>    Optional explicit browser binary (Playwright executablePath)
  --skip_param_validation         Skip enforcing decorated URL param conventions (TOKEN)
  -h, --help                     Show this help

Example:
  npm run run:phased -- \\
    --run_id A_run2 \\
    --env A \\
    --site example.com \\
    --era era01 \\
    --decorated_url_base "https://example.com/"
`.trim();
  console.log(help);
}

async function ensureVisible(page, css, timeoutMs){
  const timeout = timeoutMs || 30000;
  await page.waitForSelector(css,{state:"visible",timeout:timeout});
  const el=await page.$(css);
  if(el) await page.evaluate(e=>e.scrollIntoView({block:"center",inline:"center"}), el);
}
async function tryEnsureVisible(page, css, timeoutMs){
  // Returns {visible: boolean, error: string|null} - does not throw
  const timeout = timeoutMs || 10000;
  try{
    await page.waitForSelector(css,{state:"visible",timeout:timeout});
    const el=await page.$(css);
    if(el) await page.evaluate(e=>e.scrollIntoView({block:"center",inline:"center"}), el);
    return {visible:true, error:null};
  }catch(e){
    return {visible:false, error:String(e?.message || e).slice(0,200)};
  }
}
async function jsClick(page, css){
  await ensureVisible(page, css);
  try{
    await page.click(css);
    return;
  }catch(e){
    const msg = String(e?.message || e);
    const likelyIntercept =
      msg.includes("intercepts pointer events") ||
      msg.includes("Element is not stable") ||
      msg.includes("element is not stable") ||
      msg.includes("Target closed");

    if(likelyIntercept){
      console.warn(`[jsClick] Click failed (likely overlay/intercept). Attempting popup dismissal and retry: ${css}`);
      try{ await tryDismissAnyPopup(page, {timeoutMs: 4000}); }catch{}
      try{
        await page.click(css, {timeout: 8000});
        return;
      }catch(e2){
        const msg2 = String(e2?.message || e2);
        console.warn(`[jsClick] Retry click failed; falling back to force click: ${msg2.slice(0,160)}`);
        await page.click(css, {timeout: 8000, force: true});
        return;
      }
    }
    throw e;
  }
}

async function isVisibleSafe(page, css){
  try{
    return await page.locator(String(css)).isVisible();
  }catch{
    return false;
  }
}

async function waitForAnyNextStepVisibleIndex(page, steps, startIndex, timeoutMs){
  const timeout = Number.isFinite(timeoutMs) ? timeoutMs : 30000;
  const start = Date.now();
  while((Date.now() - start) < timeout){
    for(let i=startIndex;i<steps.length;i++){
      const css = steps[i]?.visible_when_css ? String(steps[i].visible_when_css) : null;
      if(!css) continue;
      if(await isVisibleSafe(page, css)) return i;
    }
    await sleep(250);
  }
  return null;
}

async function tryAutoNavigateStuckPage(page, steps, expectedNextIndex, opts){
  const options = opts || {};
  const rootCss = options.rootCss || null;
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 3;
  const nextWaitMs = Number.isFinite(options.nextWaitMs) ? options.nextWaitMs : 3000;
  const evidenceDir = options.evidenceDir || null;
  const navJsonl = options.navJsonl || null;
  const submitResult = options.submitResult || null;

  for(let attempt = 1; attempt <= maxRetries; attempt++){
    // Find a visible generic .wpforms-page-next button
    let nextBtn = null;
    const scopedSel = rootCss ? `${rootCss} .wpforms-page-next` : null;
    const unscopedSel = ".wpforms-page-next";

    for(const sel of [scopedSel, unscopedSel].filter(Boolean)){
      try{
        const handles = await page.$$(sel);
        for(const h of handles){
          try{
            if(await h.isVisible()){
              nextBtn = {handle: h, selector: sel};
              break;
            }
          }catch{}
        }
        if(nextBtn) break;
      }catch{}
    }

    if(!nextBtn){
      console.log(`[P5] Auto-navigate: no visible .wpforms-page-next button found (attempt ${attempt}/${maxRetries})`);
      return {success: false, attempts: attempt};
    }

    const expectedCss = steps[expectedNextIndex]?.visible_when_css || `step_${expectedNextIndex}`;
    console.log(`[P5] Auto-navigating stuck page: expected ${expectedCss}, not visible. Clicking generic Next button (attempt ${attempt}/${maxRetries}).`);

    // Screenshot before clicking
    if(evidenceDir){
      try{
        await screenshot(page, path.join(evidenceDir, `P5.auto_navigate.attempt_${attempt}.png`));
      }catch{}
    }

    // Log to navigation timeline
    if(navJsonl){
      try{
        appendJSONL(navJsonl, {
          ts: nowISO(),
          kind: "auto_navigate_stuck_page",
          attempt,
          max_retries: maxRetries,
          expected_next_index: expectedNextIndex,
          expected_css: expectedCss,
          selector_used: nextBtn.selector
        });
      }catch{}
    }

    // Click the visible Next button
    try{
      await nextBtn.handle.click({timeout: 5000});
    }catch(clickErr){
      console.warn(`[P5] Auto-navigate click failed (attempt ${attempt}): ${String(clickErr?.message || clickErr).slice(0,150)}`);
      continue;
    }

    await sleep(nextWaitMs);

    // Check if we've arrived at an expected page
    const arrivedIndex = await waitForAnyNextStepVisibleIndex(page, steps, expectedNextIndex, 10000);
    if(arrivedIndex != null){
      if(submitResult){
        submitResult.checks.push({
          ok: true,
          kind: "auto_navigated_stuck_page",
          attempt,
          expected_next_index: expectedNextIndex,
          arrived_index: arrivedIndex,
          arrived_step: steps[arrivedIndex]?.name || `step_${arrivedIndex}`
        });
      }
      return {success: true, visibleIndex: arrivedIndex, attempts: attempt};
    }
  }

  return {success: false, attempts: maxRetries};
}

function _normText(s){
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function clickBestVisibleMatch(page, selector, opts){
  const options = opts || {};
  const timeoutMs = Number(options.timeoutMs ?? 3000);
  const prefer = Array.isArray(options.preferTextContains) ? options.preferTextContains : [];
  const preferNorm = prefer.map(_normText).filter(Boolean);

  // Ensure at least one element exists/attaches, otherwise short-circuit.
  await page.waitForSelector(selector, {state:"attached", timeout:timeoutMs});

  const handles = await page.$$(selector);
  const candidates = [];
  for(const h of handles){
    try{
      const visible = await h.isVisible();
      if(!visible) continue;
      const enabled = await h.isEnabled().catch(()=> true);
      if(!enabled) continue;
      const text = _normText(await h.textContent().catch(()=> ""));
      candidates.push({h, text});
    }catch{}
  }

  if(candidates.length === 0){
    // Fall back to Playwright's own click semantics (may still succeed).
    await page.click(selector, {timeout:timeoutMs});
    return {ok:true, kind:"clicked_fallback_first_match", selector};
  }

  // Prefer a "positive" action button when multiple are present.
  let best = candidates[0];
  if(preferNorm.length){
    for(const c of candidates){
      if(preferNorm.some(p => c.text.includes(p))){
        best = c;
        break;
      }
    }
  }

  await best.h.click({timeout:timeoutMs});
  return {ok:true, kind:"clicked_best_visible_match", selector, matched_text: best.text || null};
}

async function tryDismissAnyPopup(page, opts){
  const options = opts || {};
  const timeoutMs = Number(options.timeoutMs ?? 3000);
  const preferTextContains = [
    "yes",
    "continue",
    "ok",
    "confirm",
    "proceed",
    "i agree",
    "accept",
    "that's correct"
  ];

  const containers = [
    // Breakdance popup wrapper/content
    ".breakdance-popup-content",
    // Breakdance "bde-popup-*" containers used elsewhere in the runner configs
    "[class*='bde-popup-']"
  ];

  for(const containerCss of containers){
    let visible = false;
    try{ visible = await page.locator(containerCss).first().isVisible({timeout:500}); }catch{}
    if(!visible) continue;

    // Try clicking a likely "continue" action inside.
    try{
      await clickBestVisibleMatch(
        page,
        `${containerCss} a, ${containerCss} button`,
        {timeoutMs, preferTextContains}
      );
    }catch{}

    // Escape is a harmless extra nudge for some overlays.
    try{ await page.keyboard.press("Escape"); }catch{}

    // Best-effort wait for popup to hide.
    try{
      await page.waitForSelector(containerCss, {state:"hidden", timeout:timeoutMs});
    }catch{}
  }

  // Cookie banners / misc overlays: close buttons if present.
  try{
    await clickBestVisibleMatch(
      page,
      "button[aria-label='Close'], button:has-text('Close'), .close, [data-action='close']",
      {timeoutMs: 1000, preferTextContains: ["close"]}
    );
  }catch{}
}

async function ensureFirstStepVisible(page, locatorMap, opts){
  const options = opts || {};
  const checks = options.checks || null;
  const strict = !!options.strict;
  const timeoutMsFast = Number.isFinite(options.timeoutMsFast) ? options.timeoutMsFast : 15000;
  const timeoutMsFull = Number.isFinite(options.timeoutMsFull) ? options.timeoutMsFull : 30000;
  const rootCss = locatorMap?.form?.root_css ? String(locatorMap.form.root_css) : null;

  const steps = locatorMap?.pages || [];
  const first = Array.isArray(steps) && steps.length ? steps[0] : null;
  const firstCss = first?.visible_when_css ? String(first.visible_when_css) : null;
  if(!firstCss) return;

  // Fast path: it is already visible or becomes visible quickly (covers auto-advance cases).
  try{
    await page.waitForSelector(firstCss, {state:"visible", timeout:timeoutMsFast});
    return;
  }catch(eFast){
    if(checks) checks.push({ok:false, kind:"first_step_not_visible_fast", css:firstCss, error:String(eFast?.message || eFast).slice(0,200)});
  }

  // Fallback: attempt to explicitly advance from Page 1, then wait again.
  const nextCandidates = [];
  if(rootCss){
    nextCandidates.push(`${rootCss} .wpforms-page-1 .wpforms-page-next`);
    nextCandidates.push(`${rootCss} .wpforms-page-next[data-page="1"]`);
  }
  nextCandidates.push(".wpforms-page-1 .wpforms-page-next");
  nextCandidates.push(".wpforms-page-next[data-page=\"1\"]");

  let clicked = false;
  for(const css of nextCandidates){
    try{
      const el = await page.$(css);
      if(!el) continue;
      await page.click(css, {timeout:5000});
      clicked = true;
      if(checks) checks.push({ok:true, kind:"first_step_fallback_click", css});
      break;
    }catch(e){
      if(checks) checks.push({ok:false, kind:"first_step_fallback_click_failed", css, error:String(e?.message || e).slice(0,200)});
    }
  }

  try{
    await page.waitForSelector(firstCss, {state:"visible", timeout:timeoutMsFull});
    if(checks && clicked) checks.push({ok:true, kind:"first_step_visible_after_fallback", css:firstCss});
    return;
  }catch(eFull){
    if(checks) checks.push({ok:false, kind:"first_step_not_visible", css:firstCss, error:String(eFull?.message || eFull).slice(0,200)});
    if(strict) throw eFull;
  }
}

function summarizeConsoleErrors(eventsPath, outPath){
  if(!fs.existsSync(eventsPath)) return;
  const lines=fs.readFileSync(eventsPath,"utf-8").trim().split("\n").filter(Boolean);
  const bucket={};
  for(const ln of lines){
    try{
      const e=JSON.parse(ln);
      if(e.level==="error"){
        const key=e.text||"(no text)";
        bucket[key]=bucket[key]||{count:0, first_phase:e.phase, samples:[]};
        bucket[key].count++;
        if(bucket[key].samples.length<3) bucket[key].samples.push({ts:e.ts, location:e.location});
      }
    }catch{}
  }
  const out=["# Console Errors Summary",""];
  const keys=Object.keys(bucket);
  if(!keys.length){ out.push("- No console errors captured."); writeText(outPath,out.join("\n")); return; }
  for(const k of keys.sort((a,b)=>bucket[b].count-bucket[a].count)){
    out.push(`## ${k}`);
    out.push(`- count: ${bucket[k].count}`);
    out.push(`- first_phase: ${bucket[k].first_phase}`);
    out.push(`- samples:`);
    for(const s of bucket[k].samples) out.push(`  - ${s.ts} ${JSON.stringify(s.location)}`);
    out.push("");
  }
  writeText(outPath,out.join("\n"));
}

function truthy(v){
  if(v===true) return true;
  const s=String(v||"").trim().toLowerCase();
  return ["1","true","yes","y","on"].includes(s);
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

function parseTags(args, fallbackTags){
  const out = [];
  function add(t){
    const s = String(t || "").trim();
    if(!s) return;
    if(out.includes(s)) return;
    out.push(s);
  }

  const tagsArg = pickArg(args, "tags", "tag", "reporting_tags", "reporting-tags");
  if(tagsArg && tagsArg !== true){
    const raw = String(tagsArg);
    if(raw.includes(",")) raw.split(",").forEach(add);
    else add(raw);
  }

  for(const t of (Array.isArray(fallbackTags) ? fallbackTags : [])) add(t);
  return out;
}

function writeJSONAtomic(p,o){
  mkdirp(path.dirname(p));
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(o,null,2), "utf-8");
  fs.renameSync(tmp, p);
}

function upsertRunsetMeta(runsetDir, meta, envDirName){
  try{
    if(!runsetDir || !meta?.runset_id) return null;
    const p = path.join(runsetDir, "runset.meta.json");
    const existing = readJsonSafe(p) || {};
    const envSeen = uniqStrings([...(existing.env_runs_seen || []), ...(envDirName ? [String(envDirName)] : [])]);
    const tags = uniqStrings([...(existing.reporting?.tags || []), ...(meta.reporting?.tags || [])]);
    const createdAt = existing.created_at || nowISO();
    const out = {
      ...existing,
      version: existing.version || "1.0",
      runset_id: String(meta.runset_id),
      runset_uid: existing.runset_uid || null,
      testcase_id: meta.testcase_id ?? existing.testcase_id ?? null,
      testcase_path: meta.testcase_path ?? existing.testcase_path ?? null,
      site: meta.site ?? existing.site ?? null,
      era: meta.config_era ?? existing.era ?? null,
      reporting: { ...(existing.reporting || {}), tags },
      created_at: createdAt,
      last_updated_at: nowISO(),
      env_runs_seen: envSeen
    };
    writeJSONAtomic(p, out);
    return p;
  }catch{
    return null;
  }
}

async function maybeHandlePopupOnPageLoad(page, step){
  const cfg = step?.popup_on_page_load || null;
  if(!cfg) return {ok:true, kind:"popup_on_page_load", handled:false, reason:"no_config"};

  console.log(`[popup_on_page_load] Checking for popup on "${step.name}"`);
  const containerCss = cfg.container_css ? String(cfg.container_css) : "";
  const continueBtnCss = cfg.continue_button_css ? String(cfg.continue_button_css) : "";
  if(!containerCss || !continueBtnCss){
    return {ok:false, kind:"popup_on_page_load", handled:false, reason:"missing_container_or_continue_selector"};
  }

  const timeoutMs = Number(cfg.timeout_ms ?? 3000);
  const zIndexGt = cfg.active_when?.z_index_gt != null ? Number(cfg.active_when.z_index_gt) : null;
  const preferTextContains = uniqStrings([
    ...(Array.isArray(cfg.prefer_text_contains) ? cfg.prefer_text_contains : []),
    "yes",
    "continue",
    "ok",
    "confirm",
    "proceed",
    "i agree",
    "accept",
    "that's correct"
  ]);

  try{
    console.log(`[popup_on_page_load] Waiting for container: ${containerCss}`);
    await page.waitForSelector(containerCss, {state:"attached", timeout:timeoutMs});
    console.log(`[popup_on_page_load] Container found`);
  }catch{
    console.log(`[popup_on_page_load] Container not attached, popup didn't appear`);
    return {ok:true, kind:"popup_on_page_load", handled:false, reason:"container_not_attached"};
  }

  // Wait for popup animation/display (popup might be in DOM but animating in)
  console.log(`[popup_on_page_load] Waiting for popup to become interactable`);
  await sleep(2000); // Give popup time to animate/display

  try{
    if(zIndexGt != null && Number.isFinite(zIndexGt)){
      await page.waitForFunction(
        ({css, zIndexGt}) => {
          const el = document.querySelector(css);
          if(!el) return false;
          const zi = window.getComputedStyle(el).zIndex;
          const n = Number(zi);
          return Number.isFinite(n) && n > zIndexGt;
        },
        {css:containerCss, zIndexGt},
        {timeout:timeoutMs}
      );
    } else {
      // Try waitForFunction to check actual visibility (not Playwright's internal check)
      console.log(`[popup_on_page_load] Checking if popup is displayed (custom check)`);
      const isDisplayed = await page.evaluate((css) => {
        const el = document.querySelector(css);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }, containerCss);
      console.log(`[popup_on_page_load] Popup displayed check: ${isDisplayed}`);
      if(!isDisplayed){
        console.log(`[popup_on_page_load] Popup not displayed, skipping`);
        return {ok:true, kind:"popup_on_page_load", handled:false, reason:"not_displayed"};
      }
    }
  }catch{
    console.log(`[popup_on_page_load] Visibility check failed`);
    return {ok:true, kind:"popup_on_page_load", handled:false, reason:"not_active"};
  }

  try{
    console.log(`[popup_on_page_load] Clicking continue button: ${continueBtnCss}`);
    const clickRes = await clickBestVisibleMatch(page, continueBtnCss, {timeoutMs, preferTextContains});
    await sleep(300);
    // Best-effort: wait for popup to go away so it doesn't intercept subsequent clicks.
    try{ await page.waitForSelector(containerCss, {state:"hidden", timeout:timeoutMs}); }catch{}
    console.log(`[popup_on_page_load] Popup dismissed successfully`);
    return {ok:true, kind:"popup_on_page_load", handled:true, container_css:containerCss, continue_button_css:continueBtnCss, click:clickRes};
  }catch(e){
    console.log(`[popup_on_page_load] Failed to click continue button: ${e.message}`);
    return {ok:false, kind:"popup_on_page_load", handled:false, reason:"continue_click_failed", error:String(e?.message || e).slice(0,200)};
  }
}

async function maybeHandlePopupAfterNext(page, step){
  const cfg = step?.popup_after_next || null;
  if(!cfg) return {ok:true, kind:"popup_after_next", handled:false, reason:"no_config"};

  const containerCss = cfg.container_css ? String(cfg.container_css) : "";
  const continueBtnCss = cfg.continue_button_css ? String(cfg.continue_button_css) : "";
  if(!containerCss || !continueBtnCss){
    return {ok:false, kind:"popup_after_next", handled:false, reason:"missing_container_or_continue_selector"};
  }

  const timeoutMs = Number(cfg.timeout_ms ?? 5000);
  const zIndexGt = cfg.active_when?.z_index_gt != null ? Number(cfg.active_when.z_index_gt) : null;
  const preferTextContains = uniqStrings([
    ...(Array.isArray(cfg.prefer_text_contains) ? cfg.prefer_text_contains : []),
    "yes",
    "continue",
    "ok",
    "confirm",
    "proceed",
    "i agree",
    "accept",
    "that's correct"
  ]);

  try{
    await page.waitForSelector(containerCss, {state:"attached", timeout:timeoutMs});
  }catch{
    return {ok:true, kind:"popup_after_next", handled:false, reason:"container_not_attached"};
  }

  try{
    if(zIndexGt != null && Number.isFinite(zIndexGt)){
      await page.waitForFunction(
        ({css, zIndexGt}) => {
          const el = document.querySelector(css);
          if(!el) return false;
          const zi = window.getComputedStyle(el).zIndex;
          const n = Number(zi);
          return Number.isFinite(n) && n > zIndexGt;
        },
        {css:containerCss, zIndexGt},
        {timeout:timeoutMs}
      );
    } else {
      await page.waitForSelector(containerCss, {state:"visible", timeout:timeoutMs});
    }
  }catch{
    return {ok:true, kind:"popup_after_next", handled:false, reason:"not_active"};
  }

  try{
    const clickRes = await clickBestVisibleMatch(page, continueBtnCss, {timeoutMs, preferTextContains});
    await sleep(300);
    try{ await page.waitForSelector(containerCss, {state:"hidden", timeout:timeoutMs}); }catch{}
    return {ok:true, kind:"popup_after_next", handled:true, container_css:containerCss, continue_button_css:continueBtnCss, click:clickRes};
  }catch(e){
    return {ok:false, kind:"popup_after_next", handled:false, reason:"continue_click_failed", error:String(e?.message || e).slice(0,200)};
  }
}

/**
 * Execute pre-form journey steps (Phase P0.5)
 * @param {object} journey - Journey configuration from testcase.json
 * @param {object} page - Playwright page object
 * @param {string} navJsonl - Path to nav JSONL file
 * @returns {object} - { vsn: string|null, final_url: string }
 */
async function executeJourneySteps(journey, page, navJsonl) {
  if (!journey || !journey.enabled) {
    return { vsn: null, final_url: null };
  }

  console.log(`[P0.5] Starting pre-form journey from: ${journey.start_url}`);
  appendJSONL(navJsonl, {
    ts: nowISO(),
    phase: "P0.5",
    kind: "journey_start",
    url: journey.start_url
  });

  // Navigate to start URL
  await page.goto(journey.start_url, { waitUntil: "networkidle" });
  await sleep(3000);

  let vsn = null;
  let stepNum = 0;

  for (const step of journey.steps) {
    stepNum++;
    console.log(`[P0.5] Step ${stepNum}: ${step.action}`);

    if (step.action === "click") {
      // Click element by selector or ref
      const selector = step.selector || `[data-ref="${step.ref}"]`;
      await page.click(selector);
      await sleep(step.wait_after || 2000);

      appendJSONL(navJsonl, {
        ts: nowISO(),
        phase: "P0.5",
        kind: "click",
        selector: selector,
        step: stepNum
      });

    } else if (step.action === "extract_vsn") {
      // Extract VSN from URL or page content
      const currentUrl = page.url();

      if (step.from === "url") {
        const pattern = new RegExp(step.pattern);
        const match = currentUrl.match(pattern);
        if (match && match[1]) {
          vsn = match[1];
          console.log(`[P0.5] VSN captured: ${vsn}`);
        }
      }

      appendJSONL(navJsonl, {
        ts: nowISO(),
        phase: "P0.5",
        kind: "extract_vsn",
        vsn: vsn,
        url: currentUrl
      });

    } else if (step.action === "wait") {
      await sleep(step.duration || 1000);
    }
  }

  const final_url = page.url();
  console.log(`[P0.5] Journey complete. Final URL: ${final_url}`);

  appendJSONL(navJsonl, {
    ts: nowISO(),
    phase: "P0.5",
    kind: "journey_end",
    vsn: vsn,
    final_url: final_url
  });

  return { vsn, final_url };
}

/**
 * Execute pre_form_navigation steps (testcase.json pre_form_navigation config).
 * Runs after P3 (direct_url) but overrides the normal P4 apply_url navigation.
 * Supports actions: navigate, click, extract_vsn, inject_vsn, wait_for_popup, verify_vsn.
 * @param {object} config - pre_form_navigation object from testcase.json
 * @param {object} page - Playwright page object
 * @param {string} navJsonl - Path to navigation JSONL file
 * @param {object} opts - { defaultVehicleLinkSelector }
 * @returns {object} - { vsn: string|null, final_url: string, apply_url_override: string|null }
 */
async function executePreFormNavigation(config, page, navJsonl, opts) {
  if (!config || !config.enabled) {
    return { vsn: null, final_url: null, apply_url_override: null };
  }

  const steps = config.steps;
  if (!Array.isArray(steps) || !steps.length) {
    return { vsn: null, final_url: null, apply_url_override: null };
  }

  console.log(`[pre_form_navigation] Starting pre-form navigation (${steps.length} steps)`);
  appendJSONL(navJsonl, {
    ts: nowISO(),
    phase: "P4",
    kind: "pre_form_navigation",
    event: "start",
    step_count: steps.length
  });

  let vsn = null;
  let apply_url_override = null;
  const locMap = opts?.locatorMap || null;
  const defaultVehicleSelector = opts?.defaultVehicleLinkSelector
    || locMap?.pre_form_selectors?.vehicle_link_first
    || ".vehicle-card a, .inventory-item a, a[href*='/inventory/']";

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const action = String(step.action || "").trim();
    const desc = step.description || `step ${i + 1}`;
    console.log(`[pre_form_navigation] Step ${i + 1}/${steps.length}: ${action} - ${desc}`);

    if (action === "navigate") {
      const url = String(step.url || "");
      if (!url) { console.warn(`[pre_form_navigation] Step ${i + 1}: missing url`); continue; }
      await page.goto(url, { waitUntil: "networkidle" });
      await sleep(3000);
      appendJSONL(navJsonl, {
        ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
        event: "navigate", url, step: i + 1
      });

    } else if (action === "click") {
      let selector = String(step.selector || "");
      // Resolve {{VEHICLE_LINK_SELECTOR}} from locator map or fallback default
      if (selector === "{{VEHICLE_LINK_SELECTOR}}" || !selector) {
        selector = defaultVehicleSelector;
        console.log(`[pre_form_navigation] Resolved vehicle link selector: ${selector}`);
      }
      // Find all matches then pick the first visible, interactable element
      let clicked = false;
      let matchCount = 0;
      let chosenInfo = null;
      try {
        const allMatches = page.locator(selector);
        matchCount = await allMatches.count();
        console.log(`[pre_form_navigation] Selector "${selector}" matched ${matchCount} element(s)`);
        for (let m = 0; m < matchCount; m++) {
          const el = allMatches.nth(m);
          const visible = await el.isVisible().catch(() => false);
          if (!visible) continue;
          const info = await el.evaluate(node => ({
            href: node.href || null,
            text: (node.textContent || "").trim().slice(0, 120),
            tagName: node.tagName
          })).catch(() => ({ href: null, text: null, tagName: null }));
          console.log(`[pre_form_navigation] Clicking visible match [${m}]: href=${info.href}, text="${info.text}"`);
          chosenInfo = { index: m, ...info, visible: true };
          await el.click({ timeout: 15000 });
          clicked = true;
          break;
        }
      } catch (e) {
        console.warn(`[pre_form_navigation] Locator click strategy error: ${e.message}`);
      }
      if (!clicked) {
        // Fallback: try direct page.click
        try {
          await page.click(selector, { timeout: 10000 });
          clicked = true;
          chosenInfo = { index: 0, fallback: true };
        } catch (e2) {
          console.error(`[pre_form_navigation] click failed for "${selector}": ${e2.message}`);
          appendJSONL(navJsonl, {
            ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
            event: "click_failed", selector, match_count: matchCount,
            error: String(e2.message).slice(0, 200), step: i + 1
          });
          continue;
        }
      }
      await sleep(step.wait_after || 3000);
      appendJSONL(navJsonl, {
        ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
        event: "click", selector, url: page.url(), step: i + 1,
        match_count: matchCount, chosen: chosenInfo
      });

    } else if (action === "extract_vsn") {
      const currentUrl = page.url();
      // Strategy 1: URL params (vsn or VSN)
      try {
        const urlObj = new URL(currentUrl);
        vsn = urlObj.searchParams.get("vsn") || urlObj.searchParams.get("VSN") || null;
      } catch {}

      // Strategy 2: DOM selector + regex (from config)
      if (!vsn && step.selector) {
        try {
          const el = await page.locator(step.selector).first();
          const text = await el.textContent({ timeout: 5000 });
          if (text) {
            const pattern = step.pattern ? new RegExp(step.pattern) : /\b(\w[\w-]+\w)\b/;
            const match = String(text).trim().match(pattern);
            vsn = match ? (match[1] || match[0]) : String(text).trim();
          }
        } catch (e) {
          console.warn(`[pre_form_navigation] extract_vsn selector failed: ${e.message}`);
        }
      }

      // Strategy 3: digits fallback from URL path
      if (!vsn) {
        const pathMatch = currentUrl.match(/\/(\d{4,})\/?/);
        if (pathMatch) vsn = pathMatch[1];
      }

      if (step.store_as) {
        console.log(`[pre_form_navigation] VSN captured as "${step.store_as}": ${vsn}`);
      }
      appendJSONL(navJsonl, {
        ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
        event: "extract_vsn", vsn, url: currentUrl, step: i + 1
      });

    } else if (action === "inject_vsn") {
      const targetField = step.target_field || "";
      const value = vsn || "";
      if (!targetField) { console.warn(`[pre_form_navigation] inject_vsn: missing target_field`); continue; }
      if (!value) { console.warn(`[pre_form_navigation] inject_vsn: no VSN value to inject`); continue; }

      const inputSelector = `input[name="${targetField}"]`;
      try {
        // Hidden inputs are commonly "attached" but not "visible".
        await page.waitForSelector(inputSelector, { state: "attached", timeout: 15000 });
        await page.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`Element not found: ${sel}`);
          el.value = val;
          try{ el.setAttribute("value", val); }catch{}
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { sel: inputSelector, val: value });
        // Verify the value stuck.
        const verify = await page.$eval(inputSelector, el => String(el?.value || ""));
        if(String(verify) !== String(value)){
          throw new Error(`Injected value did not persist (expected="${value}", observed="${verify}")`);
        }
        console.log(`[pre_form_navigation] Injected VSN "${value}" into ${inputSelector} (verified)`);
      } catch (e) {
        console.error(`[pre_form_navigation] inject_vsn failed: ${e.message}`);
        appendJSONL(navJsonl, {
          ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
          event: "inject_vsn_failed", target_field: targetField, vsn: value, step: i + 1,
          error: String(e?.message || e).slice(0, 200)
        });
        continue;
      }
      appendJSONL(navJsonl, {
        ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
        event: "inject_vsn", target_field: targetField, vsn: value, step: i + 1
      });

    } else if (action === "wait_for_popup") {
      const container = step.popup_container || "";
      const timeout = step.timeout_ms || 5000;
      if (!container) { console.warn(`[pre_form_navigation] wait_for_popup: missing popup_container`); continue; }
      try {
        await page.waitForSelector(container, { state: "visible", timeout });
        console.log(`[pre_form_navigation] Popup visible: ${container}`);
        await sleep(500);
      } catch (e) {
        console.error(`[pre_form_navigation] wait_for_popup failed for "${container}": ${e.message}`);
        appendJSONL(navJsonl, {
          ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
          event: "wait_for_popup_failed", popup_container: container, step: i + 1,
          error: String(e?.message || e).slice(0, 200)
        });
        continue;
      }
      appendJSONL(navJsonl, {
        ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
        event: "wait_for_popup", popup_container: container, step: i + 1
      });

    } else if (action === "verify_vsn") {
      const fieldSelector = step.field_selector || "";
      const expectedSource = step.expected_source || "";
      if (!fieldSelector) { console.warn(`[pre_form_navigation] verify_vsn: missing field_selector`); continue; }
      const expectedValue = (expectedSource === "captured_vsn") ? vsn : String(expectedSource);
      try {
        await page.waitForSelector(fieldSelector, { state: "attached", timeout: 5000 });
        const actualValue = await page.$eval(fieldSelector, el => String(el?.value || ""));
        if (actualValue === expectedValue) {
          console.log(`[pre_form_navigation] VSN verified: field="${fieldSelector}" value="${actualValue}"`);
        } else {
          console.warn(`[pre_form_navigation] VSN mismatch: expected="${expectedValue}", actual="${actualValue}"`);
        }
        appendJSONL(navJsonl, {
          ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
          event: "verify_vsn", field_selector: fieldSelector, expected: expectedValue,
          actual: actualValue, match: actualValue === expectedValue, step: i + 1
        });
      } catch (e) {
        console.error(`[pre_form_navigation] verify_vsn failed for "${fieldSelector}": ${e.message}`);
        appendJSONL(navJsonl, {
          ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
          event: "verify_vsn_failed", field_selector: fieldSelector, step: i + 1,
          error: String(e?.message || e).slice(0, 200)
        });
      }

    } else {
      console.warn(`[pre_form_navigation] Unknown action: ${action}`);
    }
  }

  const final_url = page.url();
  // If navigation ended on an apply page, use that as the apply URL override
  if (final_url.includes("/apply")) {
    apply_url_override = final_url;
  }

  console.log(`[pre_form_navigation] Complete. VSN=${vsn}, final_url=${final_url}`);
  appendJSONL(navJsonl, {
    ts: nowISO(), phase: "P4", kind: "pre_form_navigation",
    event: "complete", vsn, final_url, apply_url_override
  });

  return { vsn, final_url, apply_url_override };
}

async function resolveFieldSelector(page, field){
  const fieldType = String(field.type || "text").toLowerCase();
  const needsInput = ["text","number","email","tel","url","date","password","search"].includes(fieldType);

  // Try field.css first, but verify it matches something (and, for input-like types, that it matches an actual input/textarea/select).
  if(field.css){
    const css = String(field.css);
    try{
      const el = await page.$(css);
      if(el){
        if(!needsInput) return css;
        const tag = await el.evaluate(e => e.tagName.toLowerCase());
        if(tag === "input" || tag === "textarea" || tag === "select") return css;
        // Matched a container — fall through to candidates
        console.warn(`[resolveFieldSelector] "${field.key}": css="${css}" matched <${tag}>, not an input. Trying candidates.`);
      } else {
        console.warn(`[resolveFieldSelector] "${field.key}": css="${css}" matched nothing. Trying candidates.`);
      }
    }catch{
      // If selector is invalid or throws, try candidates.
      console.warn(`[resolveFieldSelector] "${field.key}": css="${css}" threw. Trying candidates.`);
    }
  }

  // Try css_candidates
  const candidates = field.css_candidates || field.selector_candidates || null;
  if(Array.isArray(candidates) && candidates.length){
    for(const css of candidates){
      try{
        const el = await page.$(String(css));
        if(el){
          if(!needsInput) return String(css);
          const tag = await el.evaluate(e => e.tagName.toLowerCase());
          if(tag === "input" || tag === "textarea" || tag === "select") return String(css);
        }
      }catch{}
    }
  }

  // Last resort: append " input" to first part of field.css to find descendant input
  if(field.css && needsInput){
    const base = String(field.css).split(",")[0].trim();
    const descendant = base + " input";
    try{
      const el = await page.$(descendant);
      if(el) return descendant;
    }catch{}
  }

  // Backward compat: return field.css as-is if it exists
  if(field.css) return String(field.css);
  return null;
}

async function fillField(page, field, value){
  const css = await resolveFieldSelector(page, field);
  if(!css) return {ok:false, kind:"missing_selector", field:field.key};

  const t = String(field.type || "text").toLowerCase();
  const key = field.key || "(missing key)";
  const v = value ?? "";
  const isConditional = !!(field.conditional);
  const isRequired = !!field.required;
  const visibilityCss = (() => {
    if(field.visibility_css) return String(field.visibility_css);
    if(t === "choices_js" && field.container_css) return String(field.container_css);
    if(t === "radio" && field.id_attr) return `label[for="${String(field.id_attr)}"]`;
    return css;
  })();

  // Skip empty optional values.
  if((v==="" || v==null) && !isRequired){
    return {ok:true, kind:"skipped_empty_optional", field:key, css};
  }

  // For non-required fields or fields with conditional metadata, check visibility with appropriate timeout
  // Skip gracefully if not visible (likely conditional logic didn't trigger for this path)
  if(!isRequired && !isConditional){
    // Non-required, non-conditional: short timeout (8s)
    const visibilityCheck = await tryEnsureVisible(page, visibilityCss, 8000);
    if(!visibilityCheck.visible){
      console.log(`[P5] Field "${key}" not visible after 8s (optional) - skipping`);
      return {ok:true, kind:"skipped_not_visible_optional", field:key, css, reason:visibilityCheck.error};
    }
  } else if(isConditional && !isRequired){
    // Conditional but not required: moderate timeout (12s), skip if not visible
    const visibilityCheck = await tryEnsureVisible(page, visibilityCss, 12000);
    if(!visibilityCheck.visible){
      console.log(`[P5] Field "${key}" not visible after 12s (conditional/optional) - skipping`);
      return {ok:true, kind:"skipped_not_visible_conditional", field:key, css, reason:visibilityCheck.error};
    }
  } else if(isConditional && isRequired){
    // Conditional AND required: longer timeout (15s) but still try to skip gracefully
    // since the conditional logic might not have triggered for this test path
    const visibilityCheck = await tryEnsureVisible(page, visibilityCss, 15000);
    if(!visibilityCheck.visible){
      console.log(`[P5] Field "${key}" not visible after 15s (conditional/required) - skipping, may cause form error`);
      return {ok:false, kind:"skipped_not_visible_conditional_required", field:key, css, reason:visibilityCheck.error};
    }
  }

  // Choices.js custom select: click container, then click matching option.
  if(t==="choices_js"){
    const containerCss = field.container_css || css;
    await ensureVisible(page, containerCss);
    await page.click(containerCss);
    await sleep(300);

    // Try scoped selector first, then fallback to global
    let optionCss = `${containerCss} .choices__list--dropdown .choices__item[data-value="${String(v)}"]`;
    let clicked = false;

    try {
      await page.waitForSelector(optionCss, {state:"visible", timeout:3000});
      await page.click(optionCss);
      clicked = true;
    } catch(err1) {
      // Fallback: try global selector (dropdown may be appended outside container)
      try {
        optionCss = `.choices__list--dropdown .choices__item[data-value="${String(v)}"]`;
        await page.waitForSelector(optionCss, {state:"visible", timeout:2000});
        await page.click(optionCss);
        clicked = true;
      } catch(err2) {
        // Final fallback: click by visible text
        try {
          const textMatch = `.choices__list--dropdown .choices__item:has-text("${String(v)}")`;
          await page.click(textMatch, {timeout:2000});
          clicked = true;
        } catch(err3) {
          // Last resort: JS injection if selection still fails
          await page.evaluate(({selectCss, value}) => {
            const select = document.querySelector(selectCss);
            if (select) {
              let option = Array.from(select.options).find(opt => opt.value === value || opt.text === value);
              if (!option) {
                option = document.createElement('option');
                option.value = value;
                option.text = value;
                option.selected = true;
                select.appendChild(option);
              } else {
                option.selected = true;
              }
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, {selectCss: css, value: String(v)});
          clicked = true;
        }
      }
    }

    await sleep(200);
    // Dismiss dropdown by pressing Escape and clicking outside to ensure overlay is closed
    await page.keyboard.press("Escape");
    await sleep(100);
    // Click on the form body to dismiss any lingering overlays
    try{
      await page.click("body", {position:{x:10,y:10}, force:true});
    }catch{}
    await sleep(200);
    return {ok:true, kind:"selected_choices_js", field:key, css:containerCss, value:String(v)};
  }

  if(t==="select"){
    await ensureVisible(page, css);
    if(typeof v==="object" && v){
      if(v.value!=null) await page.selectOption(css, { value: String(v.value) });
      else if(v.label!=null) await page.selectOption(css, { label: String(v.label) });
      else await page.selectOption(css, String(v));
    } else {
      await page.selectOption(css, String(v));
    }
    return {ok:true, kind:"selected", field:key, css};
  }

  if(t==="checkbox"){
    await ensureVisible(page, css);
    if(truthy(v)) await page.check(css);
    else await page.uncheck(css);
    return {ok:true, kind:"checked", field:key, css, value: truthy(v)};
  }

  if(t==="radio"){
    // Claude MCP walkthrough findings for WPForms indicate text/label clicks can select the wrong option.
    // Use a JS input click + change event to deterministically select the exact radio input.
    let method = "js_input_click";
    let actualCss = css;

    // If the exact selector isn't found, try finding by name only and filter by value/text
    try{
      await page.waitForSelector(css, {state:"attached", timeout:3000});
    }catch(e){
      // Exact selector not found - extract name and try to find by name only
      const nameMatch = css.match(/\[name=['"]([^'"]+)['"]\]/);
      if(nameMatch && nameMatch[1]){
        const fieldName = nameMatch[1];
        const baseCss = `input[name='${fieldName}']`;
        console.log(`[P5] radio "${key}" exact selector not found, trying base: ${baseCss}`);

        // Try to match by value attribute first
        let valueMatch = css.match(/\[value=['"]([^'"]+)['"]\]/);
        if(valueMatch && valueMatch[1]){
          const targetValue = valueMatch[1]; // e.g. "2 Years - 4 Years"

          // Find the radio with matching value or matching display text
          const foundCss = await page.evaluate(({baseName, targetVal}) => {
            const radios = document.querySelectorAll(`input[name='${baseName}']`);
            for(const radio of radios){
              // Try exact value match
              if(radio.value === targetVal) return `input[name='${baseName}'][value='${radio.value}']`;

              // Try text match (find associated label)
              const label = radio.closest('label') || document.querySelector(`label[for='${radio.id}']`);
              if(label && label.textContent.trim() === targetVal){
                return `input[name='${baseName}'][value='${radio.value}']`;
              }

              // Try partial text match (for cases like "2 Years - 4 Years" matching "2-4 Years")
              if(label && label.textContent.includes(targetVal.split(' ')[0])){
                const labelText = label.textContent.trim();
                // Check if numbers match (e.g. "2" and "4" in "2 Years - 4 Years")
                const targetNums = targetVal.match(/\d+/g);
                const labelNums = labelText.match(/\d+/g);
                if(targetNums && labelNums && JSON.stringify(targetNums) === JSON.stringify(labelNums)){
                  return `input[name='${baseName}'][value='${radio.value}']`;
                }
              }
            }
            return null;
          }, {baseName: fieldName, targetVal: valueMatch[1]});

          if(foundCss){
            actualCss = foundCss;
            console.log(`[P5] radio "${key}" found by matching: ${actualCss}`);
          }
        }
      }
    }

    try{
      await page.waitForSelector(actualCss, {state:"attached", timeout:15000});
      await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if(!input) return false;
        try{ input.scrollIntoView({block:"center", inline:"center"}); }catch{}
        input.click();
        input.dispatchEvent(new Event("input", {bubbles:true}));
        input.dispatchEvent(new Event("change", {bubbles:true}));
        return !!input.checked;
      }, actualCss);
      await sleep(200); // Allow UI to update
    }catch(e){
      console.log(`[P5] radio "${key}" initial click failed: ${String(e?.message || e).slice(0,100)}`);
      return {ok:false, kind:"radio_click_failed", field:key, css: actualCss, error:String(e?.message || e).slice(0,200)};
    }

    let checked = false;
    try{
      checked = await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        return !!input && !!input.checked;
      }, actualCss);
    }catch{}

    if(checked){
      console.log(`[P5] radio "${key}" selected via ${method}`);
    }

    // Enhanced fallback strategy for WPForms custom-styled radio buttons
    if(!checked){
      console.log(`[P5] radio "${key}" not checked after initial attempt, trying fallbacks...`);

      // Try 1: Click associated label by id_attr
      if(field.id_attr){
        method = "label_click_by_id";
        try{
          await page.click(`label[for="${String(field.id_attr)}"]`, {timeout:3000});
          await sleep(200);
          checked = await page.evaluate((selector) => {
            const input = document.querySelector(selector);
            return !!input && !!input.checked;
          }, css);
          if(checked) console.log(`[P5] radio "${key}" selected via ${method}`);
        }catch(e){
          console.log(`[P5] radio "${key}" ${method} failed: ${String(e?.message).slice(0,80)}`);
        }
      }

      // Try 2: Click the parent label element that wraps the input
      if(!checked){
        method = "parent_label_click";
        try{
          checked = await page.evaluate((selector) => {
            const input = document.querySelector(selector);
            if(!input) return false;
            const label = input.closest('label') || input.parentElement?.closest('label');
            if(label){
              label.scrollIntoView({block:"center", inline:"center"});
              label.click();
              input.dispatchEvent(new Event("change", {bubbles:true}));
              return input.checked;
            }
            return false;
          }, css);
          await sleep(200);
          if(checked) console.log(`[P5] radio "${key}" selected via ${method}`);
        }catch(e){
          console.log(`[P5] radio "${key}" ${method} failed: ${String(e?.message).slice(0,80)}`);
        }
      }

      // Try 3: Click the input's parent element (might be a custom wrapper)
      if(!checked){
        method = "parent_wrapper_click";
        try{
          checked = await page.evaluate((selector) => {
            const input = document.querySelector(selector);
            if(!input) return false;
            const parent = input.parentElement;
            if(parent){
              parent.scrollIntoView({block:"center", inline:"center"});
              parent.click();
              input.dispatchEvent(new Event("change", {bubbles:true}));
              return input.checked;
            }
            return false;
          }, css);
          await sleep(200);
          if(checked) console.log(`[P5] radio "${key}" selected via ${method}`);
        }catch(e){
          console.log(`[P5] radio "${key}" ${method} failed: ${String(e?.message).slice(0,80)}`);
        }
      }

      // Try 4: Find and click by visible text (extract value from selector)
      if(!checked){
        method = "click_by_text";
        try{
          // Extract the value from selector like input[name='...'][value='Rent']
          const valueMatch = css.match(/\[value=['"]([^'"]+)['"]\]/);
          if(valueMatch && valueMatch[1]){
            const textValue = valueMatch[1];
            // Try clicking an element containing this exact text near this field
            checked = await page.evaluate(({selector, text}) => {
              const input = document.querySelector(selector);
              if(!input) return false;

              // Find parent field container
              const fieldContainer = input.closest('.wpforms-field') || input.closest('[class*="field"]');
              if(!fieldContainer) return false;

              // Find all labels/spans/divs with matching text in this container
              const allElements = fieldContainer.querySelectorAll('label, span, div, li');
              for(const el of allElements){
                if(el.textContent.trim() === text){
                  el.scrollIntoView({block:"center", inline:"center"});
                  el.click();
                  input.dispatchEvent(new Event("change", {bubbles:true}));
                  if(input.checked) return true;
                }
              }
              return false;
            }, {selector: css, text: textValue});
            await sleep(200);
            if(checked) console.log(`[P5] radio "${key}" selected via ${method}`);
          }
        }catch(e){
          console.log(`[P5] radio "${key}" ${method} failed: ${String(e?.message).slice(0,80)}`);
        }
      }

      // Try 5: Use native Playwright click on the visible li/button element
      if(!checked){
        method = "playwright_native_click";
        try{
          const valueMatch = css.match(/\[value=['"]([^'"]+)['"]\]/);
          if(valueMatch && valueMatch[1]){
            const textValue = valueMatch[1];
            // Try to find a visible element with this text in the field's parent container
            const nameMatch = css.match(/\[name=['"]([^'"]+)['"]\]/);
            if(nameMatch && nameMatch[1]){
              const fieldName = nameMatch[1];
              // Build selector for li or button containing the text value
              const visibleSelector = `ul.wpforms-field-${fieldName.replace(/[^a-z0-9]/gi, '_')} li:has-text("${textValue}"), button:has-text("${textValue}")`;
              try{
                await page.click(visibleSelector, {timeout:2000});
                await sleep(300);
                checked = await page.evaluate((selector) => {
                  const input = document.querySelector(selector);
                  return !!input && !!input.checked;
                }, css);
                if(checked) console.log(`[P5] radio "${key}" selected via ${method}`);
              }catch{}
            }
          }
        }catch(e){
          console.log(`[P5] radio "${key}" ${method} failed: ${String(e?.message).slice(0,80)}`);
        }
      }

      if(!checked){
        console.log(`[P5] radio "${key}" ALL FALLBACKS FAILED - field not checked`);
        return {ok:false, kind:"radio_click_failed_all_fallbacks", field:key, css, method, error:"All click strategies failed to check radio button"};
      }
    }

    if(!checked){
      return {ok:false, kind:"radio_not_checked", field:key, css, method};
    }

    await sleep(500);
    return {ok:true, kind:"checked", field:key, css, method, value:String(v)};
  }

  // Number inputs often drive computed fields/popups; use more "user-like" typing to trigger listeners.
  if(t==="number"){
    const desired = String(v);
    const desiredNorm = desired.replace(/[^0-9.]/g, "");
    const nameAttr = field.name_attr ? String(field.name_attr) : null;

    function normNum(s){
      return String(s || "").replace(/[^0-9.]/g, "");
    }

    // Prefer targeting the actual input element.
    // Use the resolved selector (from resolveFieldSelector) first.
    // Only use name_attr as a fallback, since name_attr can drift across form revisions.
    let targetCss = css;

    // Use a Locator so we can read back value reliably.
    let input = page.locator(targetCss).first();
    try{
      await input.waitFor({state:"visible", timeout:30000});
      const tag = await input.evaluate(el => String(el?.tagName || "")).catch(()=> "");
      if(tag && tag !== "INPUT" && tag !== "TEXTAREA"){
        const descendant = page.locator(targetCss).locator("input,textarea").first();
        await descendant.waitFor({state:"visible", timeout:5000});
        input = descendant;
      }
    }catch(e){
      // Fallback: try name_attr if available.
      if(nameAttr){
        try{
          targetCss = `input[name='${nameAttr.replaceAll("'", "\\'")}']`;
          input = page.locator(targetCss).first();
          await input.waitFor({state:"visible", timeout:8000});
        }catch(e2){
          return {ok:false, kind:"number_target_not_visible", field:key, css, target_css: targetCss, error:String(e2?.message || e2).slice(0,200)};
        }
      } else {
        return {ok:false, kind:"number_target_not_visible", field:key, css, target_css: targetCss, error:String(e?.message || e).slice(0,200)};
      }
    }

    async function dispatchInputChange(locator){
      try{
        await locator.evaluate((el) => {
          try{ el.dispatchEvent(new Event("input", {bubbles:true})); }catch{}
          try{ el.dispatchEvent(new Event("change", {bubbles:true})); }catch{}
        });
      }catch{}
    }

    async function verify(locator){
      try{
        const observed = await locator.inputValue();
        const observedNorm = normNum(observed);
        const ok = desiredNorm ? (observedNorm === desiredNorm) : (observedNorm === "");
        return {ok, observed, observedNorm};
      }catch(e){
        return {ok:false, observed:"", observedNorm:"", error:String(e?.message || e).slice(0,200)};
      }
    }

    // Attempt 1: fill() + events + blur
    try{
      await input.click({timeout:15000});
      await input.fill("");
      await input.fill(desired);
      await dispatchInputChange(input);
      await page.keyboard.press("Tab").catch(()=>{});
      await sleep(200);
    }catch{}

    const v1 = await verify(input);
    if(v1.ok){
      return {ok:true, kind:"filled_number", field:key, css: targetCss, value:desired, observed:v1.observed};
    }

    // Attempt 2: select-all + type (user-like)
    try{
      await input.click({timeout:15000});
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.type(desired, {delay:20});
      await dispatchInputChange(input);
      await page.keyboard.press("Tab").catch(()=>{});
      await sleep(200);
    }catch{}

    const v2 = await verify(input);
    if(v2.ok){
      return {ok:true, kind:"filled_number_typed", field:key, css: targetCss, value:desired, observed:v2.observed};
    }

    // Attempt 3: JS set value + events (last resort)
    try{
      await input.evaluate((el, val) => {
        el.value = val;
        try{ el.dispatchEvent(new Event("input", {bubbles:true})); }catch{}
        try{ el.dispatchEvent(new Event("change", {bubbles:true})); }catch{}
        try{ el.blur(); }catch{}
      }, desired);
      await sleep(200);
    }catch{}

    const v3 = await verify(input);
    if(v3.ok){
      return {ok:true, kind:"filled_number_js_set", field:key, css: targetCss, value:desired, observed:v3.observed};
    }

    return {
      ok:false,
      kind:"filled_number_failed_verification",
      field:key,
      css: targetCss,
      expected: desired,
      expected_norm: desiredNorm,
      observed: v3.observed || v2.observed || v1.observed || "",
      observed_norm: v3.observedNorm || v2.observedNorm || v1.observedNorm || ""
    };
  }

  if(t==="file"){
    if(!v) return {ok:true, kind:"skipped_empty_optional", field:key, css};
    await page.setInputFiles(css, String(v));
    return {ok:true, kind:"file_set", field:key, css};
  }

  // text/email/tel/textarea/number/date/url/etc.
  await ensureVisible(page, css);

  // If field is marked preserve_if_filled, check existing DOM value before overwriting.
  if(field.preserve_if_filled){
    try{
      const existing = await page.$eval(css, el => String(el?.value || "").trim());
      if(existing){
        console.log(`[P5] Field "${key}" already has value "${existing}" — preserving (preserve_if_filled)`);
        return {ok:true, kind:"preserved_existing", field:key, css, existing_value:existing};
      }
    }catch{}
  }

  await page.fill(css, String(v));
  return {ok:true, kind:"filled", field:key, css};
}

async function datalayerHook(){
  return `(() => {
    window.__datalayer_events = [];
    window.dataLayer = window.dataLayer || [];
    const orig = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function() {
      try {
        const payload = arguments.length === 1 ? arguments[0] : Array.from(arguments);
        window.__datalayer_events.push({ ts: Date.now(), payload });
      } catch (e) {}
      return orig.apply(window.dataLayer, arguments);
    };
  })();`;
}
async function flushDataLayer(page, outJsonl, phase){
  // Context-alive guard (Amendment 4 D15 / wpqa-runner-truth-gate S6):
  // page.evaluate throws "Target page, context or browser has been closed"
  // when the browser context is lost mid-flush. That used to crash the runner
  // and produce no submit.result.json. Now we swallow the closed-context error
  // and return 0 — caller continues, submit.result.json still gets written.
  let events = [];
  try {
    events = await page.evaluate(() => {
      const ev = window.__datalayer_events || [];
      window.__datalayer_events = [];
      return ev;
    });
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/Target page, context or browser has been closed|Execution context was destroyed|Target closed/i.test(msg)) {
      appendJSONL(outJsonl, {ts:nowISO(), phase, payload:{__flush_error:"context_closed", message:msg.slice(0,200)}});
      return 0;
    }
    throw err;
  }
  for(const e of events){
    appendJSONL(outJsonl, {ts:new Date(e.ts).toISOString(), phase, payload:e.payload});
  }
  return events.length;
}
function datalayerSummary(jsonlPath, outPath){
  if(!fs.existsSync(jsonlPath)) return;
  const lines=fs.readFileSync(jsonlPath,"utf-8").trim().split("\n").filter(Boolean);
  const counts={}, samples={};
  for(const ln of lines){
    try{
      const e=JSON.parse(ln);
      const p=e.payload;
      let name="unknown";
      if(p && typeof p==="object"){
        name = p.event || (Array.isArray(p) ? (p[0]?.event||name) : name);
      }
      counts[name]=(counts[name]||0)+1;
      samples[name]=samples[name]||[];
      if(samples[name].length<3) samples[name].push(p);
    }catch{}
  }
  writeJSON(outPath, {total:lines.length, counts_by_event:counts, sample_payloads:samples});
}

function parseRunIteration(run_id){
  const s=String(run_id||"");
  const m=s.match(/(?:^|[^a-z0-9])run[_-]?(\d+)(?:$|[^a-z0-9])/i) || s.match(/run[_-]?(\d+)$/i);
  if(m && m[1]) return String(parseInt(m[1],10));
  const tail=s.match(/(\d+)$/);
  if(tail && tail[1]) return String(parseInt(tail[1],10));
  return null;
}

function buildEnvToken(env, runIteration){
  return `TEST_${String(env).toUpperCase()}_RUN_${String(runIteration)}`;
}

function buildDecoratedUrl(baseUrl, token){
  const u = new URL(String(baseUrl));
  const keys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","msclkid","fbclid"];
  for (const k of keys) u.searchParams.set(k, token);
  return u.toString();
}

function validateDecoratedUrl(decoratedUrl, token){
  const u = new URL(String(decoratedUrl));
  const keys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","msclkid","fbclid"];
  const missing = [];
  const mismatched = [];
  for (const k of keys){
    const v = u.searchParams.get(k);
    if(v==null) missing.push(k);
    else if(v !== token) mismatched.push({key:k, value:v});
  }
  if(missing.length || mismatched.length){
    const parts = [];
    if(missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if(mismatched.length) parts.push(`mismatched: ${mismatched.map(m=>`${m.key}=${m.value}`).join(", ")}`);
    const err = new Error(`decorated_url does not match required token ${token} (${parts.join("; ")})`);
    err.details = {token, missing, mismatched};
    throw err;
  }
}

function fileExists(p){
  try{ return fs.existsSync(p); }catch{ return false; }
}

function renderTemplateString(tpl, vars){
  return String(tpl).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v==null ? "" : String(v);
  });
}

function findNotesTemplatePath(){
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "templates", "notes.template.md"),
    path.join(cwd, "..", "templates", "notes.template.md"),
    path.join(cwd, "..", "..", "templates", "notes.template.md")
  ];
  for(const p of candidates){
    if(fileExists(p)) return p;
  }
  return null;
}

function ensureNotesFromTemplate(notesPath, meta){
  if(fileExists(notesPath)) return;
  const tplPath = findNotesTemplatePath();
  if(!tplPath) return;
  const tpl = fs.readFileSync(tplPath, "utf-8");
  const vars = {
    run_id: meta?.run_id || "",
    runset_id: meta?.runset_id || "",
    testcase_id: meta?.testcase_id || "",
    environment: meta?.environment || "",
    login_state: meta?.login_state || "",
    tags: Array.isArray(meta?.reporting?.tags) ? meta.reporting.tags.join(", ") : "",
    config_era: meta?.config_era || "",
    timezone: meta?.timezone || "",
    run_start_time_local: meta?.run_start_time_local || "",
    token: meta?.runner?.token || "",
    decorated_landing_url: meta?.test_links?.decorated_landing || "",
    direct_url: meta?.test_links?.direct || "",
    apply_url: meta?.test_links?.apply || "",
    first_name: meta?.test_identity?.first_name || "",
    last_name: meta?.test_identity?.last_name || "",
    email: meta?.test_identity?.email || "",
    phone: meta?.test_identity?.phone || "",
    occupation: meta?.test_identity?.occupation || meta?.test_identity?.job_title || "",
    company_name: meta?.test_identity?.company_name || meta?.test_identity?.employer || "",
    refreshed: "",
    extensions_disabled: ""
  };
  writeText(notesPath, renderTemplateString(tpl, vars));
}

function appendSectionIfMissing(p, heading, bodyLines){
  const text = fileExists(p) ? fs.readFileSync(p, "utf-8") : "";
  const h = `## ${String(heading).trim()}`;
  if(text.includes(h)) return;
  const content = [ "", "", h, "", ...bodyLines, "" ].join("\n");
  fs.appendFileSync(p, content, "utf-8");
}

function updateNotesStatus(p, status){
  try{
    const s = `status: ${String(status)}`;
    if(!fileExists(p)){
      writeText(p, s + "\n");
      return;
    }
    const text = fs.readFileSync(p, "utf-8");
    if(/^status:\s*\S+/m.test(text)){
      fs.writeFileSync(p, text.replace(/^status:\s*\S+/m, s), "utf-8");
    } else {
      fs.writeFileSync(p, s + "\n" + text, "utf-8");
    }
  }catch(e){
    console.error(`[notes] updateNotesStatus error: ${e.message}`);
  }
}

function formatCookieCounts(runDir){
  const cookieCounts = {};
  for(const phase of ["P0","P1","P2","P3","P4","P5"]){
    const p = path.join(runDir,"cookies",`${phase}.cookies.json`);
    const c = countCookiesFile(p);
    if(c!=null) cookieCounts[phase]=c;
  }
  const parts = [];
  for(const phase of ["P0","P1","P2","P3","P4","P5"]){
    if(cookieCounts[phase]!=null) parts.push(`${phase}=${cookieCounts[phase]}`);
  }
  return parts.join(", ");
}

function formatEventCounts(dlSummaryPath){
  const dl = readJsonSafe(dlSummaryPath);
  const counts = dl?.counts_by_event && typeof dl.counts_by_event === "object" ? dl.counts_by_event : null;
  if(!counts) return "";
  const keys = Object.keys(counts);
  if(!keys.length) return "";
  return keys
    .sort((a,b)=>(counts[b]||0)-(counts[a]||0))
    .slice(0,8)
    .map(k=>`${k}=${counts[k]}`)
    .join(", ");
}

function summarizeConsoleErrorsShort(consoleSummaryPath){
  try{
    if(!fileExists(consoleSummaryPath)) return [];
    const lines = fs.readFileSync(consoleSummaryPath, "utf-8").split("\n");
    const heads = lines.filter(l=>l.startsWith("## ")).map(l=>l.slice(3).trim()).filter(Boolean);
    return heads.slice(0,5);
  }catch{
    return [];
  }
}

function appendAutoRunSummaryNotes(notesPath, runDir, meta, submitResultPath, consoleSummaryPath, dlSummaryPath){
  const submit = readJsonSafe(submitResultPath);
  const cookieCountsStr = formatCookieCounts(runDir);
  const dlCountsStr = formatEventCounts(dlSummaryPath);
  const consoleHeads = summarizeConsoleErrorsShort(consoleSummaryPath);

  const runSummaryMd = path.join(runDir, "derived", "run.summary.md");
  const runSummaryJson = path.join(runDir, "derived", "run.summary.json");
  const runMeta = path.join(runDir, "run.meta.json");

  const lines = [];
  lines.push(`- finished_at: ${nowISO()}`);
  lines.push(`- submit.success: ${submit?.success === true ? "true" : (submit?.success === false ? "false" : "unknown")}`);
  if(submit?.url_after) lines.push(`- final_url: ${submit.url_after}`);
  if(typeof submit?.checks?.length === "number") lines.push(`- checks_count: ${submit.checks.length}`);
  if(cookieCountsStr) lines.push(`- cookie_counts: ${cookieCountsStr}`);
  if(dlCountsStr) lines.push(`- datalayer_top_events: ${dlCountsStr}`);
  if(consoleHeads.length){
    lines.push(`- console_errors: ${consoleHeads.join(" | ")}`);
  }else{
    lines.push(`- console_errors: none (or not captured)`);
  }
  if(meta?.environment === "B"){
    if(meta?.runner?.storage_state_in) lines.push(`- storage_state_in: ${meta.runner.storage_state_in}`);
    if(meta?.runner?.storage_state_out) lines.push(`- storage_state_out: ${meta.runner.storage_state_out}`);
  }
  lines.push("");
  lines.push("### Pointers");
  lines.push(`- run.meta.json: ${runMeta}`);
  lines.push(`- derived/run.summary.md: ${runSummaryMd}`);
  lines.push(`- derived/run.summary.json: ${runSummaryJson}`);
  lines.push(`- evidence/console.errors.summary.md: ${consoleSummaryPath}`);
  lines.push(`- evidence/datalayer.summary.json: ${dlSummaryPath}`);
  lines.push(`- evidence/submit.result.json: ${submitResultPath}`);
  appendSectionIfMissing(notesPath, "Auto: Run summary (generated)", lines);
}

function appendAutoFailureNotes(notesPath, runDir, phase, err, failureScreenshotPath){
  const runErrorPath = path.join(runDir, "evidence", "run.error.json");
  const summaryPath = path.join(runDir, "derived", "run.summary.json");
  const lines = [];
  lines.push(`- finished_at: ${nowISO()}`);
  lines.push(`- status: failed`);
  lines.push(`- failed_phase: ${phase || "UNKNOWN"}`);
  lines.push(`- error.message: ${String(err?.message || err)}`);
  if(failureScreenshotPath) lines.push(`- failure_screenshot: ${failureScreenshotPath}`);
  lines.push("");
  lines.push("### Pointers");
  lines.push(`- derived/run.summary.json: ${summaryPath}`);
  if(fileExists(runErrorPath)) lines.push(`- evidence/run.error.json: ${runErrorPath}`);
  appendSectionIfMissing(notesPath, "Auto: Failure summary (generated)", lines);
}

function countCookiesFile(p){
  const v = readJsonSafe(p);
  if(!Array.isArray(v)) return null;
  return v.length;
}

// wpqa-runner-truth-gate F1 (2026-04-29): independent post-submit REST query
// that confirms a WPForms entry actually landed server-side. Third truth-gate
// dimension alongside submit.success (network listener) and tracking.success
// (dataLayer assertion). Additive — does NOT flip submit.success even on fail.
//
// Gated by env var SDAS_QA_ENTRY_VERIFY=1. WP application-password creds via
// SDAS_WP_APP_USER + SDAS_WP_APP_PASS (resolved one level up by the wrapper —
// this runner is non-interactive and will not invoke `op` directly).
//
// Privacy: extracts only entry_id + queried_at + status. Does NOT persist the
// raw response body (which contains the full submitted PII payload).
async function verifyEntryViaRest({ siteBaseUrl, formId, email, runStartTs }){
  const verifyEnabled = String(process.env.SDAS_QA_ENTRY_VERIFY || "").trim() === "1";
  if (!verifyEnabled) {
    return { status: "skipped", reason: "SDAS_QA_ENTRY_VERIFY not set", queried_at: nowISO() };
  }
  const wpUser = process.env.SDAS_WP_APP_USER;
  const wpPass = process.env.SDAS_WP_APP_PASS;
  if (!wpUser || !wpPass) {
    return { status: "skipped", reason: "no credentials (SDAS_WP_APP_USER/SDAS_WP_APP_PASS unset)", queried_at: nowISO() };
  }
  if (!siteBaseUrl) {
    return { status: "skipped", reason: "no siteBaseUrl available", queried_at: nowISO() };
  }
  if (!formId) {
    return { status: "skipped", reason: "no form_id in locator_map", queried_at: nowISO() };
  }
  if (!email) {
    return { status: "skipped", reason: "no identity email available", queried_at: nowISO() };
  }
  if (typeof fetch !== "function") {
    return { status: "skipped", reason: "global fetch unavailable (Node <18)", queried_at: nowISO() };
  }

  const base = String(siteBaseUrl).replace(/\/+$/, "");
  const queryUrl = `${base}/wp-json/wpforms/v1/entries?form_id=${encodeURIComponent(String(formId))}&search=${encodeURIComponent(String(email))}`;
  const auth = "Basic " + Buffer.from(`${wpUser}:${wpPass}`).toString("base64");

  let resp, status, body;
  try {
    resp = await fetch(queryUrl, {
      method: "GET",
      headers: { Authorization: auth, Accept: "application/json" },
      // 15s ceiling — REST query should be fast; long timeouts mask real failures
      signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined
    });
    status = resp.status;
    body = await resp.json().catch(() => null);
  } catch (err) {
    return {
      status: "fail",
      entry_id: null,
      queried_at: nowISO(),
      query_url: queryUrl,
      query_status: status || null,
      reason: `fetch error: ${String(err && err.message || err).slice(0,200)}`
    };
  }

  if (!resp.ok) {
    return {
      status: "fail",
      entry_id: null,
      queried_at: nowISO(),
      query_url: queryUrl,
      query_status: status,
      reason: `non-2xx response (${status})`
    };
  }

  // WPForms REST returns either an array of entries or {entries: [...]} —
  // accept both shapes. Match by email field on the entry payload (entries
  // include a `fields` map keyed by field id; rather than coupling to field
  // ids, we filter by entry email — already what the REST `search` param is
  // doing — and pick newest entry whose date >= runStartTs when available.
  let entries = [];
  if (Array.isArray(body)) entries = body;
  else if (body && Array.isArray(body.entries)) entries = body.entries;
  else if (body && Array.isArray(body.data)) entries = body.data;

  if (entries.length === 0) {
    return {
      status: "fail",
      entry_id: null,
      queried_at: nowISO(),
      query_url: queryUrl,
      query_status: status,
      reason: "no entries matched email search"
    };
  }

  // Prefer entries created during/after the run window; fall back to first.
  const runStartMs = runStartTs ? Date.parse(runStartTs) : NaN;
  let pick = null;
  for (const e of entries) {
    const eDate = e?.date || e?.date_gmt || e?.created_at || null;
    const eMs = eDate ? Date.parse(eDate) : NaN;
    if (Number.isFinite(runStartMs) && Number.isFinite(eMs) && eMs >= runStartMs - 60000) {
      // pick the most recent qualifying entry
      if (!pick || (Date.parse(pick?.date || pick?.date_gmt || pick?.created_at || 0) < eMs)) pick = e;
    }
  }
  if (!pick) pick = entries[0];

  const entryId = pick?.entry_id || pick?.id || pick?.ID || null;
  return {
    status: entryId ? "pass" : "fail",
    entry_id: entryId,
    queried_at: nowISO(),
    query_url: queryUrl,
    query_status: status,
    matched_count: entries.length,
    reason: entryId ? null : "matching entries returned but none carried entry_id"
  };
}

function writeRunSummary(runDir, meta, submitResultPath, consoleSummaryPath, dlSummaryPath){
  const submit = readJsonSafe(submitResultPath);
  const dl = readJsonSafe(dlSummaryPath);

  const cookieCounts = {};
  for(const phase of ["P0","P1","P2","P3","P4","P5"]){
    const p = path.join(runDir,"cookies",`${phase}.cookies.json`);
    const c = countCookiesFile(p);
    if(c!=null) cookieCounts[phase]=c;
  }

  const filledCount = Array.isArray(submit?.checks) ? submit.checks.filter(c=>c?.kind==="filled" || c?.kind==="selected" || c?.kind==="checked" || c?.kind==="file_set").length : null;
  const missingIdentity = Array.isArray(submit?.checks) ? submit.checks.filter(c=>c?.kind==="missing_identity_value").map(c=>c.field).filter(Boolean) : [];
  const missingSelectors = Array.isArray(submit?.checks) ? submit.checks.filter(c=>c?.kind==="missing_selector").map(c=>c.field).filter(Boolean) : [];
  const expectedConsoleChecks = Array.isArray(submit?.checks)
    ? submit.checks.filter(c=>c?.kind==="expected_console_log_contains")
    : [];
  const expectedConsoleOk = expectedConsoleChecks.every(c=>c?.matched === true);
  const overallOk = submit?.success === true && expectedConsoleOk;

  const lines = [];
  lines.push(`# Run Summary — ${meta?.run_id || path.basename(runDir)}`);
  lines.push("");
  lines.push(`- run_id: ${meta?.run_id || ""}`);
  lines.push(`- testcase_id: ${meta?.testcase_id || ""}`);
  lines.push(`- env: ${meta?.environment || ""}`);
  lines.push(`- era: ${meta?.config_era || ""}`);
  lines.push(`- browser: ${meta?.runner?.browser || ""}${meta?.runner?.browser_channel ? ` (${meta.runner.browser_channel})` : ""}`);
  lines.push(`- token: ${meta?.runner?.token || ""}`);
  if(Array.isArray(meta?.reporting?.tags) && meta.reporting.tags.length){
    lines.push(`- tags: ${meta.reporting.tags.join(", ")}`);
  }
  lines.push("");
  lines.push("## Links");
  lines.push(`- decorated: ${meta?.test_links?.decorated_landing || ""}`);
  lines.push(`- direct: ${meta?.test_links?.direct || ""}`);
  lines.push(`- apply: ${meta?.test_links?.apply || ""}`);
  lines.push("");
  lines.push("## Result");
  lines.push(`- status: ${overallOk ? "passed" : "failed"}`);
  lines.push(`- submit.success: ${submit?.success === true ? "true" : (submit?.success === false ? "false" : "unknown")}`);
  lines.push(`- url_before: ${submit?.url_before || ""}`);
  lines.push(`- url_after: ${submit?.url_after || ""}`);
  if(filledCount!=null) lines.push(`- fields_filled: ${filledCount}`);
  if(missingIdentity.length) lines.push(`- missing_identity_value: ${missingIdentity.join(", ")}`);
  if(missingSelectors.length) lines.push(`- missing_selector: ${missingSelectors.join(", ")}`);
  if(Array.isArray(submit?.errors_found) && submit.errors_found.length) lines.push(`- errors_found: ${submit.errors_found.length}`);
  if(expectedConsoleChecks.length){
    lines.push(`- expected_console_log_contains: ${expectedConsoleOk ? "ok" : "missing"} (${expectedConsoleChecks.length})`);
    for(const c of expectedConsoleChecks){
      lines.push(`  - matched=${c.matched === true ? "true" : "false"} contains="${String(c.contains || "").slice(0,120)}"`);
    }
  }
  if(submit?.network_tracking){
    lines.push(`- network_tracking: ${submit.network_tracking.success === true ? "ok" : "failed"} (${submit.network_tracking.observed_tracking_count || 0} tracking request rows)`);
  }
  if(submit?.entry_verified){
    const ev = submit.entry_verified;
    lines.push(`- entry_verified: ${ev.status}${ev.entry_id ? ` (entry_id=${ev.entry_id})` : ""}${ev.reason ? ` — ${ev.reason}` : ""}`);
  }
  lines.push("");
  lines.push("## Cookie Counts");
  for(const phase of ["P0","P1","P2","P3","P4","P5"]){
    if(cookieCounts[phase]!=null) lines.push(`- ${phase}: ${cookieCounts[phase]}`);
  }
  lines.push("");
  lines.push("## Tracking (dataLayer)");
  if(dl?.counts_by_event && typeof dl.counts_by_event==="object"){
    const keys = Object.keys(dl.counts_by_event);
    if(!keys.length) lines.push("- (no events recorded)");
    else{
      for(const k of keys.sort((a,b)=>(dl.counts_by_event[b]||0)-(dl.counts_by_event[a]||0))){
        lines.push(`- ${k}: ${dl.counts_by_event[k]}`);
      }
    }
  }else{
    lines.push("- (no summary available)");
  }
  lines.push("");
  lines.push("## Evidence Pointers");
  lines.push(`- meta: ${path.join(runDir,"run.meta.json")}`);
  lines.push(`- notes: ${path.join(runDir,"notes.md")}`);
  lines.push(`- submit: ${submitResultPath}`);
  lines.push(`- console errors: ${consoleSummaryPath}`);
  lines.push(`- datalayer summary: ${dlSummaryPath}`);

  writeText(path.join(runDir,"derived","run.summary.md"), lines.join("\n")+"\n");
  writeJSON(path.join(runDir,"derived","run.summary.json"), {
    run_id: meta?.run_id || path.basename(runDir),
    testcase_id: meta?.testcase_id || null,
    environment: meta?.environment || null,
    era: meta?.config_era || null,
    token: meta?.runner?.token || null,
    browser: meta?.runner?.browser || null,
    browser_channel: meta?.runner?.browser_channel || null,
    reporting: meta?.reporting || null,
    links: meta?.test_links || null,
    status: overallOk ? "passed" : "failed",
    submit: submit ? {
      success: submit.success,
      url_before: submit.url_before || null,
      url_after: submit.url_after || null,
      filled_count: filledCount,
      missing_identity_value: missingIdentity,
      missing_selector: missingSelectors,
      errors_found_count: Array.isArray(submit.errors_found) ? submit.errors_found.length : 0,
      expected_console_log_contains: expectedConsoleChecks.map(c=>({
        contains: c.contains || "",
        matched: c.matched === true,
        match_count: Number.isFinite(c.match_count) ? c.match_count : null
      })),
      network_tracking: submit.network_tracking || null,
      entry_verified: submit.entry_verified || null,
      tracking: submit.tracking || null
    } : null,
    cookie_counts: cookieCounts,
    datalayer_counts_by_event: dl?.counts_by_event || null,
    sources_used: [
      path.join(runDir,"run.meta.json"),
      submitResultPath,
      consoleSummaryPath,
      dlSummaryPath
    ]
  });
}

function readJsonlEvents(p){
  if(!p || !fileExists(p)) return [];
  const lines = fs.readFileSync(p, "utf-8").split("\n").filter(Boolean);
  const out = [];
  for(const line of lines){
    try{
      out.push(JSON.parse(line));
    }catch{}
  }
  return out;
}

function normalizeExpectedConsoleList(v){
  if(!v) return [];
  if(typeof v === "string"){
    const s = v.trim();
    return s ? [s] : [];
  }
  if(Array.isArray(v)){
    return v.map(x=>String(x || "").trim()).filter(Boolean);
  }
  return [];
}

function verifyExpectedConsoleLogs(consoleJsonlPath, expectedList, outEvidencePath){
  const expected = normalizeExpectedConsoleList(expectedList);
  if(!expected.length) return null;

  const events = readJsonlEvents(consoleJsonlPath);
  const results = [];
  for(const needle of expected){
    const matches = events
      .filter(e => String(e?.text || "").includes(needle))
      .slice(0, 5)
      .map(e => ({ts: e.ts || null, phase: e.phase || null, level: e.level || null, text: e.text || null}));
    results.push({
      contains: needle,
      matched: matches.length > 0,
      match_count: matches.length ? matches.length : 0,
      samples: matches
    });
  }

  const payload = {
    ts: nowISO(),
    ok: results.every(r=>r.matched),
    requirements: results
  };
  if(outEvidencePath){
    writeJSON(outEvidencePath, payload);
  }
  return payload;
}

function parseUrlSafe(rawUrl){
  try{ return new URL(String(rawUrl)); }catch{ return null; }
}

function isTrackingNetworkUrl(rawUrl){
  const u = parseUrlSafe(rawUrl);
  if(!u) return false;
  const host = u.hostname.toLowerCase();
  const pathName = u.pathname.toLowerCase();
  return (
    (host.endsWith("facebook.com") && pathName === "/tr") ||
    (host.endsWith("facebook.com") && pathName.includes("/events")) ||
    (host.endsWith("instagram.com") && pathName.includes("/events")) ||
    (host.endsWith("googleadservices.com") && pathName.includes("/pagead/conversion")) ||
    (host.endsWith("googlesyndication.com") && pathName.includes("/pagead/1p-conversion")) ||
    (host.endsWith("google.com") && pathName.includes("/pagead/1p-conversion")) ||
    (host.endsWith("google-analytics.com") && pathName.includes("/g/collect"))
  );
}

function trackingRequestDetails(rawUrl, postData){
  const u = parseUrlSafe(rawUrl);
  if(!u) return null;
  const host = u.hostname.toLowerCase();
  const params = {};
  for(const [k, v] of u.searchParams.entries()){
    if(["id", "ev", "en", "label", "tid", "cid", "dl", "dt", "value", "currency_code"].includes(k)){
      params[k] = v;
    }
  }
  const post = String(postData || "");
  let provider = "unknown";
  if(host.includes("facebook.com") || host.includes("instagram.com")) provider = "meta";
  else if(host.includes("google")) provider = "google";

  const eventName =
    u.searchParams.get("ev") ||
    u.searchParams.get("en") ||
    (post.match(/(?:^|[&?])ev=([^&]+)/)?.[1] ? decodeURIComponent(post.match(/(?:^|[&?])ev=([^&]+)/)[1]) : null) ||
    (post.match(/(?:^|[&?])en=([^&]+)/)?.[1] ? decodeURIComponent(post.match(/(?:^|[&?])en=([^&]+)/)[1]) : null);

  return {
    tracking_provider: provider,
    tracking_event_name: eventName,
    tracking_pixel_id: u.searchParams.get("id") || u.searchParams.get("tid") || null,
    tracking_conversion_label: u.searchParams.get("label") || null,
    tracking_query: params
  };
}

function normalizeExpectedNetworkSpecs(v){
  if(!Array.isArray(v)) return [];
  return v.map(spec => {
    if(typeof spec === "string") return {event: spec, min_count: 1};
    return {
      provider: spec?.provider ? String(spec.provider) : null,
      event: spec?.event ? String(spec.event) : null,
      label: spec?.label ? String(spec.label) : null,
      pixel_id: spec?.pixel_id ? String(spec.pixel_id) : null,
      url_contains: Array.isArray(spec?.url_contains) ? spec.url_contains.map(String).filter(Boolean) : [],
      min_count: Number.isInteger(spec?.min_count) ? spec.min_count : 1
    };
  }).filter(spec => spec.event || spec.label || spec.pixel_id || spec.url_contains.length);
}

function networkRowMatchesSpec(row, spec){
  const details = row?.tracking_provider ? row : (trackingRequestDetails(row?.url || "", null) || {});
  const url = String(row?.url || "");
  if(spec.provider && String(details?.tracking_provider || "") !== spec.provider) return false;
  if(spec.event && String(details?.tracking_event_name || "") !== spec.event) return false;
  if(spec.label && String(details?.tracking_conversion_label || "") !== spec.label) return false;
  if(spec.pixel_id && String(details?.tracking_pixel_id || "") !== spec.pixel_id) return false;
  for(const needle of spec.url_contains || []){
    if(!url.includes(needle)) return false;
  }
  return true;
}

function summarizeTrackingRow(row){
  const details = row?.tracking_provider ? row : (trackingRequestDetails(row?.url || "", null) || {});
  return {
    ts: row?.ts || null,
    provider: details.tracking_provider || null,
    event: details.tracking_event_name || null,
    pixel_id: details.tracking_pixel_id || null,
    label: details.tracking_conversion_label || null,
    status: row?.status || null,
    resourceType: row?.resourceType || null,
    url: row?.url || null
  };
}

function assertExpectedNetworkTracking(networkJsonlPath, locatorMap, outEvidencePath){
  const expected = normalizeExpectedNetworkSpecs(locatorMap?.submit?.success?.expected_network_events);
  const forbidden = normalizeExpectedNetworkSpecs(locatorMap?.submit?.success?.not_expected_network_events);
  if(!expected.length && !forbidden.length) return null;

  const rows = readJsonlEvents(networkJsonlPath);
  const trackingRows = rows.filter(r => r?.tracking_provider || isTrackingNetworkUrl(r?.url));
  const expectedResults = expected.map(spec => {
    const matches = trackingRows.filter(row => networkRowMatchesSpec(row, spec));
    return {
      spec,
      matched: matches.length >= spec.min_count,
      match_count: matches.length,
      samples: matches.slice(0, 5).map(summarizeTrackingRow)
    };
  });
  const forbiddenResults = forbidden.map(spec => {
    const matches = trackingRows.filter(row => networkRowMatchesSpec(row, spec));
    return {
      spec,
      matched: matches.length > 0,
      match_count: matches.length,
      samples: matches.slice(0, 5).map(summarizeTrackingRow)
    };
  });

  const payload = {
    ts: nowISO(),
    ok: expectedResults.every(r => r.matched) && forbiddenResults.every(r => !r.matched),
    expected: expectedResults,
    not_expected: forbiddenResults,
    observed_tracking_count: trackingRows.length,
    observed_tracking_summary: trackingRows.map(summarizeTrackingRow)
  };
  if(outEvidencePath) writeJSON(outEvidencePath, payload);
  return payload;
}

function writeFailureSummary(runDir, meta, phase, err, paths){
  const ts_end = nowISO();
  const error = { ts_end, phase: phase || "UNKNOWN", ...errorToJson(err) };
  if(paths?.url) error.url = String(paths.url);
  if(paths?.failureScreenshotPath) error.failure_screenshot = String(paths.failureScreenshotPath);

  const derivedDir = paths?.derivedDir || path.join(runDir, "derived");
  const evidenceDir = paths?.evidenceDir || path.join(runDir, "evidence");
  mkdirp(derivedDir);
  mkdirp(evidenceDir);

  const errorPath = path.join(evidenceDir, "run.error.json");
  writeJSON(errorPath, error);

  const cookieCounts = {};
  for(const p of ["P0","P1","P2","P3","P4","P5"]){
    const c = countCookiesFile(path.join(runDir,"cookies",`${p}.cookies.json`));
    if(c!=null) cookieCounts[p]=c;
  }

  const summaryJson = {
    run_id: meta?.run_id || path.basename(runDir),
    testcase_id: meta?.testcase_id || null,
    environment: meta?.environment || null,
    era: meta?.config_era || null,
    token: meta?.runner?.token || null,
    browser: meta?.runner?.browser || null,
    browser_channel: meta?.runner?.browser_channel || null,
    reporting: meta?.reporting || null,
    status: "failed",
    error,
    submit: {
      success: false,
      url_before: paths?.url ? String(paths.url) : null,
      url_after: null
    },
    cookie_counts: cookieCounts,
    sources_used: [
      path.join(runDir,"run.meta.json"),
      errorPath
    ]
  };
  writeJSON(path.join(derivedDir, "run.summary.json"), summaryJson);

  const lines = [];
  lines.push(`# Run Summary — ${summaryJson.run_id}`);
  lines.push("");
  lines.push(`- run_id: ${summaryJson.run_id || ""}`);
  lines.push(`- testcase_id: ${summaryJson.testcase_id || ""}`);
  lines.push(`- env: ${summaryJson.environment || ""}`);
  lines.push(`- era: ${summaryJson.era || ""}`);
  lines.push(`- browser: ${summaryJson.browser || ""}${summaryJson.browser_channel ? ` (${summaryJson.browser_channel})` : ""}`);
  lines.push(`- token: ${summaryJson.token || ""}`);
  if(Array.isArray(summaryJson?.reporting?.tags) && summaryJson.reporting.tags.length){
    lines.push(`- tags: ${summaryJson.reporting.tags.join(", ")}`);
  }
  lines.push("");
  lines.push("## Result");
  lines.push(`- submit.success: false`);
  lines.push("");
  lines.push("## Failure");
  lines.push(`- phase: ${error.phase || ""}`);
  lines.push(`- error.name: ${error.name}`);
  lines.push(`- error.message: ${error.message}`);
  lines.push(`- error.json: ${errorPath}`);
  lines.push("");
  lines.push("## Cookie Counts");
  for(const p of ["P0","P1","P2","P3","P4","P5"]){
    if(cookieCounts[p]!=null) lines.push(`- ${p}: ${cookieCounts[p]}`);
  }
  lines.push("");
  lines.push("## Evidence Pointers");
  lines.push(`- meta: ${path.join(runDir,"run.meta.json")}`);
  const notesPath = path.join(runDir, "notes.md");
  if(fileExists(notesPath)) lines.push(`- notes: ${notesPath}`);
  if(paths?.consoleSummaryPath && fileExists(paths.consoleSummaryPath)) lines.push(`- console errors: ${paths.consoleSummaryPath}`);
  if(paths?.dlSummaryPath && fileExists(paths.dlSummaryPath)) lines.push(`- datalayer summary: ${paths.dlSummaryPath}`);
  lines.push(`- error: ${errorPath}`);
  writeText(path.join(derivedDir, "run.summary.md"), lines.join("\n")+"\n");
}

function renderIdentityTemplates(identity, vars){
  function renderStr(s){
    return String(s)
      .replaceAll("{ENV}", vars.ENV)
      .replaceAll("{RUN_ID}", vars.RUN_ID)
      .replaceAll("{RUN_ITERATION}", vars.RUN_ITERATION)
      .replaceAll("{BROWSER}", vars.BROWSER)
      .replaceAll("{SYSTEM}", vars.SYSTEM);
  }
  function walk(v){
    if(v==null) return v;
    if(typeof v==="string") return renderStr(v);
    if(Array.isArray(v)) return v.map(walk);
    if(typeof v==="object"){
      const out={};
      for(const [k,val] of Object.entries(v)) out[k]=walk(val);
      return out;
    }
    return v;
  }
  return walk(identity);
}

async function main(){
  if(args.help){ printHelp(); return; }

  let runDir = null;
  let cookiesDir = null;
  let evidenceDir = null;
  let exportsDir = null;
  let networkDir = null;
  let derivedDir = null;
  let consoleJsonl = null;
  let consoleSummary = null;
  let navJsonl = null;
  let dlJsonl = null;
  let dlSummary = null;
  let submitResultPath = null;
  let submitResult = null;
  let networkJsonl = null;
  let browser = null;
  let context = null;
  let page = null;
  let phase = "INIT";
  let meta = null;
  let testcase = null;
  let reportingTags = [];

  try{
    const {cfgPath, cfg} = loadDefaultsConfig(args);
    testcase = loadTestcaseConfig(args);
    const runset_id = pickArg(args, "runset_id", "runset-id") || null;

    const env = String((pickArg(args, "env") ?? testcase?.cfg?.env ?? cfg?.env ?? "A")).toUpperCase();
    const isConfigTestEnv = env === "CT";

    const run_id = pickArg(args, "run_id", "run-id");
    if(!run_id) throw new Error("--run_id required");

    const siteRaw = String(pickArg(args, "site") ?? testcase?.cfg?.site ?? cfg?.site ?? "unknown");
    // Normalize site: if it's a full URL, extract hostname; derive a base URL for fallback.
    let site = siteRaw;
    let siteBaseUrl = null; // e.g. "https://example.test/"
    if(siteRaw.startsWith("http://") || siteRaw.startsWith("https://")){
      try{
        const u = new URL(siteRaw);
        site = u.hostname;
        siteBaseUrl = `${u.protocol}//${u.hostname}/`;
      }catch{ /* keep siteRaw as-is */ }
    }
    const era = String(pickArg(args, "era") ?? testcase?.cfg?.era ?? cfg?.era ?? "unknown");
    const runIteration=parseRunIteration(run_id) || "unknown";
    const envToken = buildEnvToken(env, runIteration);
    const testcaseTags = Array.isArray(testcase?.cfg?.reporting?.tags) ? testcase.cfg.reporting.tags : [];
    reportingTags = parseTags(args, testcaseTags);

    const decoratedUrlBase =
      pickArg(args, "decorated_url_base", "decorated-url-base", "decorated_base_url", "decorated-base-url") ??
      testcase?.cfg?.urls?.decorated_url_base ??
      cfg?.decorated_url_base ??
      siteBaseUrl ??
      null;
    const decorated_url =
      pickArg(args, "decorated_url", "decorated-url") ??
      (decoratedUrlBase ? buildDecoratedUrl(decoratedUrlBase, envToken) : null);
    const direct_url =
      pickArg(args, "direct_url", "direct-url") ??
      testcase?.cfg?.urls?.direct_url ??
      cfg?.direct_url ??
      siteBaseUrl ??
      (site!=="unknown" ? `https://${site}/` : null);
    const apply_url =
      pickArg(args, "apply_url", "apply-url") ??
      testcase?.cfg?.urls?.apply_url ??
      cfg?.apply_url ??
      (siteBaseUrl ? `${siteBaseUrl}apply` : null) ??
      (site!=="unknown" ? `https://${site}/apply` : null);
    if(!decorated_url || !direct_url || !apply_url){
      throw new Error("Need decorated/direct/apply URLs (provide flags, or set them in the defaults config). Decorated can be via --decorated_url or --decorated_url_base.");
    }

    const locatorMapPath = resolvePathFrom(
      testcase.root,
      pickArg(args, "locator_map", "locator-map") ??
        testcase?.cfg?.assets?.locator_map ??
        cfg?.locator_map ??
        "runner/locator_maps/wpforms_apply.default.json"
    );
    const identityPath = resolvePathFrom(
      testcase.root,
      pickArg(args, "identity", "identity-file") ??
        testcase?.cfg?.assets?.identity ??
        cfg?.identity ??
        "runner/testdata/attribution_baseline.identity.json"
    );
    const nextWaitMs=parseInt(String(pickArg(args, "next_wait_ms", "next-wait-ms") ?? cfg?.next_wait_ms ?? "3000"),10);
    const autoNavigateMaxRetries = parseInt(String(
      pickArg(args, "auto_navigate_max_retries", "auto-navigate-max-retries") ??
      cfg?.auto_navigate_max_retries ?? "3"
    ), 10);
    const strictIdentity = !!(pickArg(args, "strict_identity", "strict-identity") ?? cfg?.strict_identity);
    const runsetStateDir = runset_id ? path.join("runs", String(runset_id), ".state") : null;

    let storageStateIn = pickArg(args, "storage_state_in", "storage-state-in", "storage_state", "storage-state") || null;
    let storageStateOut = pickArg(args, "storage_state_out", "storage-state-out") || null;

    const browserName=String(args.browser || args["browser-type"] || args.browser_type || "chromium");
    if(browserName==="true") throw new Error("--browser requires a value (chromium|firefox|webkit)");
    const browserChannel=args.browser_channel || args["browser-channel"] || null;
    const browserExecutable=args.browser_executable || args["browser-executable"] || args.executable_path || args["executable-path"] || null;
    if(browserChannel===true) throw new Error("--browser_channel requires a value");
    if(browserExecutable===true) throw new Error("--browser_executable requires a value");

    const login_state = env==="B" ? "logged_in" : (env==="C" ? "incognito" : (isConfigTestEnv ? "config_test" : "logged_out"));
    const stem = runset_id ? `${env}-${login_state}` : null;
    function pickRunDir(){
      if(testcase.root){
        const runsBase = path.join(testcase.root, "runs");
        const runGroup = runset_id || (runIteration !== "unknown" ? `run_${runIteration}` : null);
        if(!runGroup) throw new Error("When using --testcase, provide --runset_id (or use a run_id that contains a numeric iteration).");
        const base = path.join(runsBase, String(runGroup));
        const initial = path.join(base, String(stem || `${env}-${login_state}`));
        if(!fileExists(initial)) return initial;
        try{
          const entries = fs.readdirSync(initial);
          if(entries.length===0) return initial;
        }catch{}
        for(let i=1;i<100;i++){
          const suffix = String(i).padStart(2,"0");
          const candidate = path.join(base, `${env}-${login_state}.retry${suffix}`);
          if(!fileExists(candidate)) return candidate;
          try{
            const entries = fs.readdirSync(candidate);
            if(entries.length===0) return candidate;
          }catch{}
        }
        throw new Error(`Unable to find free run directory under ${base}/${env}-${login_state} (too many retries)`);
      }

      if(!runset_id) return path.join("runs", run_id);
      const base = path.join("runs", String(runset_id));
      const initial = path.join(base, String(stem));
      if(!fileExists(initial)) return initial;
      try{
        const entries = fs.readdirSync(initial);
        if(entries.length===0) return initial;
      }catch{}
      for(let i=1;i<100;i++){
        const suffix = String(i).padStart(2,"0");
        const candidate = path.join(base, `${stem}.retry${suffix}`);
        if(!fileExists(candidate)) return candidate;
        try{
          const entries = fs.readdirSync(candidate);
          if(entries.length===0) return candidate;
        }catch{}
      }
      throw new Error(`Unable to find free run directory under runs/${runset_id}/${stem} (too many retries)`);
    }

    runDir = pickRunDir();
    cookiesDir=path.join(runDir,"cookies");
    evidenceDir=path.join(runDir,"evidence");
    exportsDir=path.join(runDir,"exports");
    networkDir=path.join(runDir,"network");
    derivedDir=path.join(runDir,"derived");
    for(const d of [cookiesDir,evidenceDir,exportsDir,networkDir,derivedDir]) mkdirp(d);

    consoleJsonl=path.join(evidenceDir,"console.events.jsonl");
    consoleSummary=path.join(evidenceDir,"console.errors.summary.md");
    navJsonl=path.join(evidenceDir,"navigation.timeline.jsonl");
    dlJsonl=path.join(evidenceDir,"datalayer.events.jsonl");
    dlSummary=path.join(evidenceDir,"datalayer.summary.json");
    submitResultPath=path.join(evidenceDir,"submit.result.json");
    networkJsonl=path.join(networkDir,"network.summary.jsonl");

    meta={
      run_id,
      runset_id: runset_id || null,
      testcase_id: testcase?.cfg?.testcase_id || testcase?.testcase_id || "attribution_baseline_P1-P5",
      testcase_path: testcase.root || null,
      environment:env,
      login_state,
      site,
      timezone:"unknown",
      run_start_time_local:new Date().toString(),
      config_era:era,
      reporting: { tags: reportingTags },
      runner:{
        type:"playwright",
        headed:!!args.headed || isConfigTestEnv,
        next_wait_ms: nextWaitMs,
        auto_navigate_max_retries: autoNavigateMaxRetries,
        browser: browserName,
        browser_channel: browserChannel || null,
        browser_executable: browserExecutable || null,
        token: envToken,
        storage_state_in: storageStateIn || null,
        storage_state_out: storageStateOut || null,
        config_path: fileExists(cfgPath) ? cfgPath : null,
        testcase_config_path: testcase.cfgPath && fileExists(testcase.cfgPath) ? testcase.cfgPath : null
      },
      test_identity: null,
      test_links:{decorated_landing:decorated_url, direct:direct_url, apply:apply_url},
      locator_map_path: locatorMapPath,
      identity_path: identityPath
    };
    writeJSON(path.join(runDir,"run.meta.json"), meta);
    if(runset_id){
      const runsetDir = path.dirname(runDir);
      const runsetMetaPath = path.join(runsetDir, "runset.meta.json");
      const existing = readJsonSafe(runsetMetaPath);
      if(existing?.reporting?.tags?.length){
        meta.reporting.tags = uniqStrings([...(existing.reporting.tags || []), ...(meta.reporting.tags || [])]);
        writeJSON(path.join(runDir,"run.meta.json"), meta);
      }
      upsertRunsetMeta(runsetDir, meta, path.basename(runDir));
    }
    const notesPath = path.join(runDir,"notes.md");

    for(const p of [consoleJsonl,navJsonl,dlJsonl,networkJsonl]) if(fs.existsSync(p)) fs.unlinkSync(p);

    if(env === "C" && (storageStateIn || storageStateOut)){
      throw new Error("env=C (incognito) cannot be used with --storage_state_in/--storage_state_out.");
    }
    if(env === "B"){
      if(!storageStateIn && testcase?.cfg?.auth_states?.B?.storage_state_in){
        storageStateIn = resolvePathFrom(testcase.root, testcase.cfg.auth_states.B.storage_state_in);
      }
      if(!storageStateIn){
        const shared = path.join("auth_states", String(site), "B-logged_in.storage.json");
        if(fileExists(shared)) storageStateIn = shared;
      }
      if(!storageStateOut && testcase?.cfg?.auth_states?.B?.storage_state_out){
        storageStateOut = resolvePathFrom(testcase.root, testcase.cfg.auth_states.B.storage_state_out);
      }
      if(!storageStateOut){
        storageStateOut = storageStateIn || null;
      }
      meta.runner.storage_state_in = storageStateIn || null;
      meta.runner.storage_state_out = storageStateOut || null;
      writeJSON(path.join(runDir,"run.meta.json"), meta);
      if(!storageStateIn){
        const loginUrl = testcase?.cfg?.auth_states?.B?.login_url || `https://${site}/login`;
        const tcHint = meta?.testcase_id ? `\n  npm run auth:record -- --testcase ${meta.testcase_id} --env B` : "";
        throw new Error(
          `env=B (logged_in) requires a Playwright storageState JSON.\n\nCreate one with one of:\n${tcHint}\n  npm run auth:record -- --site ${site} --env B\n  npm run auth:record -- --out auth_states/${site}/B-logged_in.storage.json --login_url "${loginUrl}"\n\nOr pass --storage_state_in <path>.`
        );
      }
      if(!fileExists(storageStateIn)){
        throw new Error(`--storage_state_in not found: ${storageStateIn}`);
      }
    }

    const skipParamValidation = args.skip_param_validation || args["skip-param-validation"] || false;
    if(!skipParamValidation){
      validateDecoratedUrl(decorated_url, envToken);
    }

    const locatorMap=JSON.parse(fs.readFileSync(locatorMapPath,"utf-8"));
    const identityRaw=JSON.parse(fs.readFileSync(identityPath,"utf-8"));
    const browserId = String(browserChannel ? `${browserName}_${browserChannel}` : browserName);
    const systemId = `${process.platform}-${process.arch}-${String(os.release()).split(".")[0] || "unknown"}`;
    const identity=renderIdentityTemplates(identityRaw, {
      ENV:String(env),
      RUN_ID:String(run_id),
      RUN_ITERATION:String(runIteration),
      BROWSER:browserId,
      SYSTEM:systemId
    });
    meta.test_identity = identity;
    writeJSON(path.join(runDir,"run.meta.json"), meta);
    ensureNotesFromTemplate(notesPath, meta);
    if(!fileExists(notesPath)){
      writeText(notesPath, `status: pending\n# notes.md — ${run_id}\n\nAuto-run (Playwright)\n- started: ${nowISO()}\n- env: ${env}\n- era: ${era}\n`);
    }
    if(runset_id){
      const runsetDir = path.dirname(runDir);
      upsertRunsetMeta(runsetDir, meta, path.basename(runDir));
    }

    let browserType=chromium;
    if(browserName==="firefox") browserType=firefox;
    else if(browserName==="webkit") browserType=webkit;
    else if(browserName!=="chromium") throw new Error(`Unsupported --browser: ${browserName}`);

    const launchOptions={headless: !(!!args.headed || isConfigTestEnv)};
    if(browserChannel){
      if(browserName!=="chromium") throw new Error("--browser_channel is only supported with --browser chromium");
      launchOptions.channel=String(browserChannel);
    }
    if(browserExecutable) launchOptions.executablePath=String(browserExecutable);

    browser=await browserType.launch(launchOptions);
    // wpqa-runner-truth-gate reCAPTCHA bypass: matching wpcodebox snippet must validate the same secret.
    const qaBypassSecret = process.env.SDAS_QA_BYPASS_SECRET || null;
    const extraHTTPHeaders = qaBypassSecret ? { 'X-{CLIENT_CODE}-QA-Bypass': qaBypassSecret } : undefined;
    const contextOptions={ignoreHTTPSErrors:true, viewport:{width:1280,height:720}};
    if(storageStateIn) contextOptions.storageState = String(storageStateIn);
    if(extraHTTPHeaders) contextOptions.extraHTTPHeaders = extraHTTPHeaders;
    context=await browser.newContext(contextOptions);
    context.on("requestfinished", async (req) => {
      try{
        const resp=await req.response(); if(!resp) return;
        const url = req.url();
        const row = {ts:nowISO(), url, method:req.method(), resourceType:req.resourceType(), status:resp.status()};
        if(isTrackingNetworkUrl(url)){
          let postData = null;
          try{ postData = req.postData(); }catch{}
          Object.assign(row, trackingRequestDetails(url, postData) || {});
        }
        appendJSONL(networkJsonl, row);
      }catch{}
    });
    context.on("requestfailed", async (req) => {
      try{
        const url = req.url();
        if(!isTrackingNetworkUrl(url)) return;
        let postData = null;
        try{ postData = req.postData(); }catch{}
        appendJSONL(networkJsonl, {
          ts: nowISO(),
          url,
          method: req.method(),
          resourceType: req.resourceType(),
          status: null,
          failed: true,
          failure: req.failure ? req.failure() : null,
          ...(trackingRequestDetails(url, postData) || {})
        });
      }catch{}
    });

    page=await context.newPage();
    await page.addInitScript(await datalayerHook());

    page.on("console", (msg)=>{
      const loc = msg.location ? msg.location() : null;
      appendJSONL(consoleJsonl, {ts:nowISO(), phase, level:msg.type(), text:msg.text(), location:loc});
    });
    page.on("pageerror", (err)=>{
      appendJSONL(consoleJsonl, {ts:nowISO(), phase, level:"error", text:String(err), location:null});
    });
    page.on("framenavigated", (frame)=>{
      if(frame===page.mainFrame()){
        appendJSONL(navJsonl, {ts:nowISO(), phase, kind:"framenavigated", url:frame.url()});
      }
    });

    async function phaseSnapshot(p, doShot, shotName){
      phase=p;
      await flushDataLayer(page, dlJsonl, phase);
      await saveCookies(context, path.join(cookiesDir, `${phase}.cookies.json`));
      if(doShot) await screenshot(page, path.join(evidenceDir, shotName || `${phase}.page.png`));
    }

    const testcaseData = testcase?.cfg || {};

  // P0 (logged-in baseline) — capture cookie state before campaign click.
  if(env === "B"){
    await phaseSnapshot("P0", false);
  }

  // P0.5 (Journey) - Optional "journey" runner (if configured + enabled)
  let journey_result = { vsn: null, final_url: null };
  if (testcaseData.journey && testcaseData.journey.enabled) {
    phase = "P0.5";
    journey_result = await executeJourneySteps(testcaseData.journey, page, navJsonl);

    // Store VSN in run metadata
    if (journey_result.vsn) {
      meta.vsn_captured = journey_result.vsn;
      meta.vsn_source = "journey";
      writeJSON(path.join(runDir,"run.meta.json"), meta);
    }

    await phaseSnapshot("P0.5", true, "P0.5.journey.png");
  }

  // P1
  phase="P1";
  appendJSONL(navJsonl, {ts:nowISO(), phase:"P1", kind:"goto", url:decorated_url});
  await page.goto(decorated_url, {waitUntil:"domcontentloaded", timeout:60000});
  await sleep(5000);
  await phaseSnapshot("P1", true, "P1.page.png");

  // P2
  phase="P2";
  appendJSONL(navJsonl, {ts:nowISO(), phase:"P2", kind:"idle", url:page.url()});
  await sleep(60000);
  await phaseSnapshot("P2", false);

  // P3
  phase="P3";
  appendJSONL(navJsonl, {ts:nowISO(), phase:"P3", kind:"goto", url:direct_url});
  await page.goto(direct_url, {waitUntil:"domcontentloaded", timeout:60000});
  await sleep(5000);
  await phaseSnapshot("P3", true, "P3.page.png");

  // P4
  phase="P4";
  // pre_form_navigation: if testcase defines it, run the multi-step navigation
  // (inventory -> VDP -> extract VSN -> apply -> inject VSN) instead of a plain goto.
  if (testcaseData.pre_form_navigation && testcaseData.pre_form_navigation.enabled) {
    const pfnResult = await executePreFormNavigation(testcaseData.pre_form_navigation, page, navJsonl, { locatorMap });
    if (pfnResult.vsn) {
      meta.vsn_captured = pfnResult.vsn;
      meta.vsn_source = "pre_form_navigation";
      writeJSON(path.join(runDir, "run.meta.json"), meta);
    }
    if (pfnResult.apply_url_override) {
      meta.test_links.apply = pfnResult.apply_url_override;
      writeJSON(path.join(runDir, "run.meta.json"), meta);
    }
  } else {
    appendJSONL(navJsonl, {ts:nowISO(), phase:"P4", kind:"goto", url:apply_url});
    await page.goto(apply_url, {waitUntil:"domcontentloaded", timeout:60000});
  }
  await sleep(5000);
  await phaseSnapshot("P4", true, "P4.page.png");

    // Resolve {{captured_vsn}} in identity values now that pre_form_navigation has run.
    if (meta.vsn_captured) {
      for (const [k, v] of Object.entries(identity)) {
        if (typeof v === "string" && v.includes("{{captured_vsn}}")) {
          identity[k] = v.replaceAll("{{captured_vsn}}", String(meta.vsn_captured));
        }
      }
    }

    // P5 submit
    phase="P5";
    submitResult={ts_start:nowISO(), phase:"P5", success:false, url_before:page.url(), url_after:null, checks:[], errors_found:[]};

    const root=locatorMap.form?.root_css;
    if(root){
      try{
        await ensureVisible(page, root);
      }catch(e){
        const url = page.url();
        throw new Error(
          `Expected form root not visible: ${String(root)}\n` +
          `Current URL: ${url}\n` +
          `This usually means the run landed on the wrong form/page (e.g. pre_form_navigation did not execute, or the testcase config/locator map is mismatched).`
        );
      }
    }
    await ensureFirstStepVisible(page, locatorMap, {checks: submitResult.checks, strict: strictIdentity});

    const steps=locatorMap.pages||[];
    for(let i=0;i<steps.length;i++){
      const step=steps[i];
    if(step.visible_when_css) await ensureVisible(page, step.visible_when_css);

    // Give page content a moment to render after visibility check
    await sleep(500);

    // Handle popup that appears when page loads (before filling fields)
    try{
      const popupRes = await maybeHandlePopupOnPageLoad(page, step);
      submitResult.checks.push(popupRes);
      if(strictIdentity && popupRes.ok === false) throw new Error(`Popup handler failed on page load "${step.name}": ${popupRes.reason || "unknown"}`);
    }catch(e){
      submitResult.checks.push({ok:false, kind:"popup_on_page_load_error", step:step.name, error:String(e?.message || e).slice(0,200)});
      if(strictIdentity) throw e;
    }

    for(const f of (step.fields||[])){
      const val = identity[f.key] ?? "";
      if(!val && f.required){
        submitResult.checks.push({kind:"missing_identity_value", field:f.key});
        if(strictIdentity) throw new Error(`Missing required identity value for field: ${f.key}`);
        continue;
      }
      try{
        const res = await fillField(page, f, val);
        submitResult.checks.push(res);
        // wpqa-runner-truth-gate S5: required-but-hidden fields surface as
        // errors_found, not just as a failed check. Previously the runner
        // logged "fillField error" to stderr and pushed a check with ok:false
        // but errors_found stayed empty, so the failure was invisible in the
        // structured artifact and submit.success stayed true.
        if (res && res.ok === false && f.required && res.kind === "skipped_not_visible_conditional_required") {
          submitResult.errors_found.push({
            kind: "required_field_hidden",
            field: f.key,
            css: res.css,
            observed: String(res.reason || "required conditional field stayed hidden after retries").slice(0, 300)
          });
        }
        if(strictIdentity && !res.ok){
          throw new Error(`Unable to fill required field: ${f.key} (${res.kind})`);
        }
      }catch(fillErr){
        console.error(`[P5] fillField error for "${f.key}": ${fillErr.message}`);
        submitResult.checks.push({ok:false, kind:"fill_error", field:f.key, error:String(fillErr.message).slice(0,300)});
        // S5: required-field fill_error must also surface to errors_found.
        // Codex bridge code-review finding #6 (2026-04-29): de-dupe — if the
        // strict-mode throw above already surfaced this same field via
        // required_field_hidden, do NOT push a second entry for the same root
        // cause. Check errors_found for an existing entry on this field.
        if (f.required) {
          const alreadySurfaced = submitResult.errors_found.some(e => e && e.field === f.key);
          if (!alreadySurfaced) {
            submitResult.errors_found.push({
              kind: "required_field_fill_error",
              field: f.key,
              observed: String(fillErr.message || fillErr).slice(0, 300)
            });
          }
        }
        if(strictIdentity) throw fillErr;
      }
      await flushDataLayer(page, dlJsonl, "P5");
    }

	    if(i < steps.length-1){
	      if(!step.next_button_css) throw new Error(`Missing next_button_css for step ${step.name}`);
	      await jsClick(page, step.next_button_css);
	      try{
	        const popupRes = await maybeHandlePopupAfterNext(page, step);
	        submitResult.checks.push(popupRes);
	        if(strictIdentity && popupRes.ok === false) throw new Error(`Popup handler failed after "${step.name}": ${popupRes.reason || "unknown"}`);
	      }catch(e){
	        submitResult.checks.push({ok:false, kind:"popup_after_next_error", step:step.name, error:String(e?.message || e).slice(0,200)});
	        if(strictIdentity) throw e;
	      }
	      await sleep(nextWaitMs);

	      // Detect WPForms validation errors before waiting for next page
	      if(step.visible_when_css && await isVisibleSafe(page, step.visible_when_css)){
	        // Still on current page after clicking Next — likely validation error
	        const errorSels = locatorMap.submit?.error_selectors || [];
	        const foundErrors = [];
	        for(const errSel of errorSels){
	          try{
	            const errEls = await page.$$(errSel.css);
	            for(const errEl of errEls){
	              const vis = await errEl.isVisible();
	              if(!vis) continue;
	              const txt = (await errEl.textContent()) || "";
	              if(!errSel.text_contains || txt.includes(errSel.text_contains)){
	                foundErrors.push({css:errSel.css, text:txt.trim().slice(0,200)});
	              }
	            }
	          }catch{}
	        }
	        if(foundErrors.length > 0){
	          const msg = `Validation errors on "${step.name}": ${foundErrors.map(e=>e.text).join("; ")}`;
	          console.error(`[P5] ${msg}`);
	          submitResult.checks.push({ok:false, kind:"form_validation_error_on_next", step:step.name, errors:foundErrors});
	          if(strictIdentity) throw new Error(msg);
	        }
	      }

	      const expectedNextIndex = i + 1;
	      const nextVisibleIndex = await waitForAnyNextStepVisibleIndex(page, steps, expectedNextIndex, 30000);
	      if(nextVisibleIndex == null){
	        const next = steps[expectedNextIndex];
	        if(next?.visible_when_css){
	          try{
	            await page.waitForSelector(next.visible_when_css, {state:"visible", timeout:30000});
	          }catch(waitErr){
	            // Fallback: if expected page isn't visible, check if we're stuck on current page
	            // If current page is still visible and has a next button, click it to force progression
	            const stuckOnCurrentPage = step.visible_when_css && await isVisibleSafe(page, step.visible_when_css);
	            if(stuckOnCurrentPage && step.next_button_css && await isVisibleSafe(page, step.next_button_css)){
	              console.log(`[P5] Still on ${step.name}, next page ${next.visible_when_css} not visible - clicking next again`);
	              await jsClick(page, step.next_button_css);
	              await sleep(nextWaitMs);
	              // Now wait for the page to appear
	              await page.waitForSelector(next.visible_when_css, {state:"visible", timeout:30000});
	            }else{
	              // Attempt auto-navigate on stuck intermediate page
	              const autoNavResult = await tryAutoNavigateStuckPage(page, steps, expectedNextIndex, {
	                rootCss: root,
	                maxRetries: autoNavigateMaxRetries,
	                nextWaitMs,
	                evidenceDir,
	                navJsonl,
	                submitResult
	              });

	              if(autoNavResult.success){
	                const arrivedIndex = autoNavResult.visibleIndex;
	                if(arrivedIndex !== expectedNextIndex){
	                  // Landed on a later page — record auto-skips
	                  for(let k = expectedNextIndex; k < arrivedIndex; k++){
	                    submitResult.checks.push({
	                      ok: true,
	                      kind: "auto_skipped_step",
	                      step: steps[k]?.name || `step_${k}`,
	                      visible_when_css: steps[k]?.visible_when_css ? String(steps[k].visible_when_css) : null,
	                      reason: "auto_navigated_past"
	                    });
	                  }
	                  i = arrivedIndex - 1;
	                }
	              }else{
	                // Record failure and throw original error
	                submitResult.checks.push({
	                  ok: false,
	                  kind: "auto_navigate_failed",
	                  step_from: step.name,
	                  step_expected: steps[expectedNextIndex]?.name || `step_${expectedNextIndex}`,
	                  attempts: autoNavResult.attempts,
	                  max_retries: autoNavigateMaxRetries
	                });
	                throw waitErr;
	              }
	            }
	          }
	        }
	      } else if(nextVisibleIndex !== expectedNextIndex){
	        for(let k=expectedNextIndex;k<nextVisibleIndex;k++){
	          submitResult.checks.push({
	            ok: true,
	            kind: "auto_skipped_step",
	            step: steps[k]?.name || `step_${k}`,
	            visible_when_css: steps[k]?.visible_when_css ? String(steps[k].visible_when_css) : null
	          });
	        }
	        i = nextVisibleIndex - 1;
	      }
	      await flushDataLayer(page, dlJsonl, "P5");
	    }
	  }

  const submitBtn=locatorMap.submit?.button_css;
  if(!submitBtn) throw new Error("Missing submit.button_css");

  // wpqa-runner-truth-gate S2: capture WPForms AJAX submit response.
  // Submit-scoped state (Codex bridge review #2: anti-leak boundaries).
  // Listener attaches IMMEDIATELY before submit click, filters POST + WPForms
  // endpoints + matching form_id, captures to local array, detaches after the
  // confirmation-div check completes. NO module/global accumulator.
  // Codex bridge code-review finding #3 (2026-04-29): some locator_maps store
  // form_id at metadata.form_id rather than form.id. Fall back so 88652 and
  // 88839 (which only have metadata.form_id) get real correlation, not the
  // accept-any-WPForms-endpoint default.
  const formIdHint = locatorMap?.form?.id
    ? String(locatorMap.form.id)
    : (locatorMap?.metadata?.form_id ? String(locatorMap.metadata.form_id) : null);
  const wpformsResponses = [];
  // Codex bridge code-review finding #4 (2026-04-29): track each listener
  // invocation as a Promise so detach can wait for in-flight async parsing
  // to settle before merging — eliminates the race where a response event
  // fired just before detach is still parsing when we pick canonical.
  const pendingListenerPromises = [];
  const wpformsEndpointPattern = /admin-ajax\.php(\?|$)|\/wp-json\/wpforms(?:-pro|-lead-forms)?\/v?[0-9]*\//i;
  const wpformsResponseListener = (response) => {
    const p = (async () => {
      try {
      const req = response.request();
      if (req.method() !== "POST") return;
      const url = response.url();
      // Wider fallback: match any POST whose body contains a wpforms_submit action fingerprint, regardless of URL.
      let isWpformsAction = false;
      try { const pb = req.postData() || ""; isWpformsAction = pb.includes("action=wpforms_submit") || pb.includes("action=wpforms_lead_forms_submit"); } catch {}
      if (!wpformsEndpointPattern.test(url) && !isWpformsAction) return;
      const status = response.status();
      let bodyText = null;
      let bodyParsed = null;
      try { bodyText = await response.text(); } catch {}
      if (bodyText) {
        try { bodyParsed = JSON.parse(bodyText); } catch {}
      }
      // form_id correlation: only retain responses whose request body or parsed body
      // mentions the form being tested. Best-effort — admin-ajax payloads are
      // form-encoded, REST payloads are JSON.
      let formIdMatch = false;
      if (formIdHint) {
        try {
          const reqBody = req.postData() || "";
          if (reqBody.includes(`form_id=${formIdHint}`) || reqBody.includes(`"form_id":${formIdHint}`) || reqBody.includes(`"form_id":"${formIdHint}"`) || reqBody.includes(`wpforms[id]=${formIdHint}`)) {
            formIdMatch = true;
          }
        } catch {}
        if (bodyParsed && (String(bodyParsed.form_id) === formIdHint || String(bodyParsed?.data?.form_id) === formIdHint)) {
          formIdMatch = true;
        }
      } else {
        formIdMatch = true; // no form_id hint, accept any WPForms endpoint match
      }
      if (!formIdMatch) return;
      const captured = {
        ts: nowISO(),
        url,
        method: req.method(),
        status,
        ok: status >= 200 && status < 400,
        body_parsed: bodyParsed,
        body_raw: bodyText ? String(bodyText).slice(0, 4000) : null
      };
      wpformsResponses.push(captured);
      appendJSONL(networkJsonl, captured);
      } catch (err) {
        try { appendJSONL(networkJsonl, {ts:nowISO(), kind:"listener_error", error:String(err && err.message || err).slice(0,200)}); } catch {}
      }
    })();
    pendingListenerPromises.push(p);
  };
  page.on("response", wpformsResponseListener);

  await jsClick(page, submitBtn);

  const successCssOriginal=locatorMap.submit?.success?.css;
  let successCss=successCssOriginal;
  if(
    typeof successCssOriginal==="string" &&
    successCssOriginal.includes("wpforms-confirmation") &&
    !successCssOriginal.includes("wpforms-confirmation-container-full")
  ){
    successCss = `.wpforms-confirmation-container-full, ${successCssOriginal}`;
    submitResult.checks.push({kind:"success_selector_augmented", original:successCssOriginal, augmented:successCss});
  }
  const expectedText=locatorMap.submit?.success?.expected_text_contains || null;
  const expectedUrl=locatorMap.submit?.success?.expected_url_contains || null;

  let successHit=false;
  try{
    if(successCss){
      await page.waitForSelector(successCss,{state:"visible",timeout:30000});
      successHit=true;
      if(expectedText){
        const txt=await page.textContent(successCss);
        submitResult.checks.push({kind:"success_text", contains:expectedText, observed:(txt||"").slice(0,200)});
      }
    }
  }catch(e){
    submitResult.checks.push({kind:"success_selector_not_found", css:successCss, error:String(e)});
  }

  await sleep(1000);
  const urlAfter=page.url();
  submitResult.url_after=urlAfter;
  if(expectedUrl && urlAfter.includes(expectedUrl)){
    submitResult.checks.push({kind:"success_url", contains:expectedUrl, observed:urlAfter});
    successHit=true;
  }

  for(const er of (locatorMap.submit?.error_selectors||[])){
    try{
      const el=await page.$(er.css);
      if(el){
        const t=(await el.textContent())||"";
        if(!er.text_contains || t.includes(er.text_contains)){
          submitResult.errors_found.push({css:er.css, observed:t.slice(0,200)});
        }
      }
    }catch{}
  }

  // wpqa-runner-truth-gate S2 (cont.): merge captured WPForms response into
  // submitResult.network and detach the listener now that the submit window
  // has closed. Pick the latest matching response as the canonical submit
  // result; surface the first error response if any failed.
  try { page.off("response", wpformsResponseListener); } catch {}
  // Codex bridge code-review finding #4 (2026-04-29): await any in-flight
  // listener invocations before reading wpformsResponses, so a response
  // captured just before detach but still parsing doesn't get missed.
  if (pendingListenerPromises.length > 0) {
    try { await Promise.allSettled(pendingListenerPromises); } catch {}
  }
  let canonicalSubmitResponse = null;
  let firstErrorResponse = null;
  for (const r of wpformsResponses) {
    if (!r.ok && !firstErrorResponse) firstErrorResponse = r;
    if (r.ok) canonicalSubmitResponse = r;
  }
  const networkPick = canonicalSubmitResponse || firstErrorResponse || null;
  let entryId = null;
  let networkSuccess = null;
  if (networkPick && networkPick.body_parsed) {
    const bp = networkPick.body_parsed;
    entryId = bp.entry_id || bp?.data?.entry_id || bp?.data?.fields?.entry_id || null;
    if (typeof bp.success === "boolean") networkSuccess = bp.success;
    else if (typeof bp?.data?.success === "boolean") networkSuccess = bp.data.success;
  }
  submitResult.network = {
    response_count: wpformsResponses.length,
    canonical_status: networkPick ? networkPick.status : null,
    canonical_url: networkPick ? networkPick.url : null,
    success: networkSuccess,
    entry_id: entryId,
    body_parsed: networkPick ? networkPick.body_parsed : null
  };
  submitResult.checks.push({
    kind: "network_capture",
    response_count: wpformsResponses.length,
    canonical_status: networkPick ? networkPick.status : null,
    success: networkSuccess,
    entry_id: entryId,
    ok: networkSuccess === true
  });
  if (wpformsResponses.length === 0) {
    submitResult.errors_found.push({
      kind: "no_wpforms_response_captured",
      observed: "No POST to admin-ajax.php?action=wpforms_submit or /wp-json/wpforms/ matched the form_id during the submit window."
    });
  } else if (networkSuccess === false) {
    submitResult.errors_found.push({
      kind: "wpforms_response_not_success",
      observed: `Captured ${wpformsResponses.length} WPForms response(s); body.success=false; canonical_status=${networkPick ? networkPick.status : "null"}.`
    });
  }

  // wpqa-runner-truth-gate truth-gate composition (split gate, 2026-04-29):
  // submit.success means the FORM SUBMITTED server-side. Tracking validation is
  // a separate downstream gate (submit.tracking.*) populated by S3b. A run can
  // submit successfully but have broken tracking — those are independent
  // failure modes that the operator routes differently.
  //
  // Submission gate signals (any-of, ranked by trust):
  //   1. WPForms admin-ajax response with success === true (most authoritative
  //      when listener captures it)
  //   2. Confirmation selector visible (successHit) — proves at least client-
  //      side acceptance; can be a fake-success on bot-rejected runs (reCAPTCHA)
  //      so it's only a positive signal when paired with no captured failure
  //   3. dataLayer post-submit business events fired — fires only after
  //      server-side processing in normal WPForms flow, so their presence is
  //      strong corroborating evidence even when the network listener missed
  //      the POST (apply-subdomain coverage gap)
  //
  // The S3b dataLayer assertion result is folded into submit.success below
  // when the network half didn't capture anything — gives form 61 a path to
  // pass when the listener can't see the apply-subdomain submission.
  const networkOk = networkSuccess === true;
  const networkObserved = wpformsResponses.length > 0;
  // Provisional submit.success — S3b may upgrade this when network missed
  // capture but dataLayer corroborates server-side submission.
  submitResult.success = successHit && (networkOk || !networkObserved);
  submitResult.ts_end = nowISO();

  await sleep(10000);
  await screenshot(page, path.join(evidenceDir,"P5.submit.page.png"));
  await phaseSnapshot("P5", false);

  await flushDataLayer(page, dlJsonl, "FINAL");
  datalayerSummary(dlJsonl, dlSummary);
  summarizeConsoleErrors(consoleJsonl, consoleSummary);

  // Optional post-submit assertion: require specific console.log line(s) for tracking validation.
  // If configured in locator_map.json, missing logs should mark the run as failed (even if the form submitted).
  const expectedConsole = locatorMap.submit?.success?.expected_console_log_contains || null;
  const expectedConsoleEvidencePath = path.join(evidenceDir, "expected_console_logs.json");
  const expectedConsoleRes = verifyExpectedConsoleLogs(consoleJsonl, expectedConsole, expectedConsoleEvidencePath);
  if(expectedConsoleRes){
    for(const req of expectedConsoleRes.requirements || []){
      submitResult.checks.push({
        kind: "expected_console_log_contains",
        contains: req.contains,
        matched: req.matched === true,
        match_count: Number.isFinite(req.match_count) ? req.match_count : null
      });
    }
  }

  // Optional network-level tracking assertion. This is separate from
  // dataLayer assertions: dataLayer proves GTM eligibility, network proves an
  // outbound pixel/collect request was actually attempted.
  const expectedNetworkEvidencePath = path.join(derivedDir, "network_tracking_assertions.json");
  const expectedNetworkRes = assertExpectedNetworkTracking(networkJsonl, locatorMap, expectedNetworkEvidencePath);
  if(expectedNetworkRes){
    submitResult.checks.push({
      kind: "network_tracking_check",
      status: expectedNetworkRes.ok ? "pass" : "fail",
      observed_tracking_count: expectedNetworkRes.observed_tracking_count,
      expected: expectedNetworkRes.expected.map(r => ({
        spec: r.spec,
        matched: r.matched,
        match_count: r.match_count
      })),
      not_expected: expectedNetworkRes.not_expected.map(r => ({
        spec: r.spec,
        matched: r.matched,
        match_count: r.match_count
      })),
      evidence: expectedNetworkEvidencePath,
      ok: expectedNetworkRes.ok === true
    });
    submitResult.network_tracking = {
      success: expectedNetworkRes.ok === true,
      evidence: expectedNetworkEvidencePath,
      observed_tracking_count: expectedNetworkRes.observed_tracking_count,
      expected: expectedNetworkRes.expected.map(r => ({
        spec: r.spec,
        matched: r.matched,
        match_count: r.match_count
      })),
      not_expected: expectedNetworkRes.not_expected.map(r => ({
        spec: r.spec,
        matched: r.matched,
        match_count: r.match_count
      }))
    };
    if(expectedNetworkRes.ok !== true){
      submitResult.errors_found.push({
        kind: "network_tracking_assertion_failed",
        observed: `Network tracking assertion failed; see ${expectedNetworkEvidencePath}`
      });
    }
  }

  // wpqa-runner-truth-gate S3b: mandatory shell-out to assert-tracking-events.js
  // for dataLayer business-event presence validation. Tool reads
  // locator_map.submit.success.expected_datalayer_events as single source of
  // truth (Codex bridge review #1: reuse mandatory). Failure flips submit.success.
  const expectedDlEvents = locatorMap?.submit?.success?.expected_datalayer_events;
  if (Array.isArray(expectedDlEvents) && expectedDlEvents.length > 0) {
    try {
      // __dirname is frameworks/wordpress/qa/runner/, so 4 levels up = repo root
      const repoRoot = path.resolve(__dirname, "../../../..");
      const assertScript = path.join(repoRoot, "clients/{CLIENT_CODE}/tools/tracking/assert-tracking-events.js");
      // run-phased writes evidence under {runDir}/{envSubdir}/evidence/. The
      // tool's --run-dir is the parent of {envSubdir}.
      const envSubdir = path.basename(path.dirname(evidenceDir));
      const toolRunDir = path.dirname(path.dirname(evidenceDir));
      const testcasePath = testcase?.root || null;
      const args = ["--locator-map", String(testcasePath ? path.join(testcasePath, "locator_map.json") : ""), "--run-dir", toolRunDir, "--env", envSubdir];
      // Prefer --testcase-path when available (cleaner)
      if (testcasePath) {
        args.splice(0, 2, "--testcase-path", testcasePath);
      }
      if (fs.existsSync(assertScript)) {
        const res = spawnSync(process.execPath, [assertScript, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
        const stdout = String(res.stdout || "").trim();
        const stderr = String(res.stderr || "").trim();
        const exitCode = res.status;
        // Read the JSON the tool wrote
        const assertJsonPath = path.join(toolRunDir, envSubdir, "derived", "tracking_event_assertions.json");
        let assertResult = null;
        try { assertResult = JSON.parse(fs.readFileSync(assertJsonPath, "utf-8")); } catch {}
        const dlStatus = assertResult ? assertResult.status : (exitCode === 0 ? "pass" : "fail");
        submitResult.checks.push({
          kind: "datalayer_event_check",
          status: dlStatus,
          expected_events: assertResult ? assertResult.expected_events : null,
          missing_events: assertResult ? assertResult.missing_events : null,
          extra_events: assertResult ? assertResult.extra_events : null,
          field_failures: assertResult ? assertResult.field_failures : null,
          contract_source: assertResult ? assertResult.contract_source : null,
          tool_exit_code: exitCode,
          ok: dlStatus === "pass"
        });
        // wpqa-runner-truth-gate split-gate: tracking is a separate dimension.
        // submit.success now reflects ONLY server-side submission. Tracking
        // status is reported as submit.tracking.{success, status, missing_events,
        // ...} — a failed tracking assertion does NOT flip submit.success
        // because a form can submit successfully with broken GTM tags
        // (real production case for {CLIENT_CODE} 88839 finance_vsn/view_vehicle).
        submitResult.tracking = {
          success: dlStatus === "pass",
          status: dlStatus,
          expected_events: assertResult ? assertResult.expected_events : null,
          missing_events: assertResult ? assertResult.missing_events : null,
          extra_events: assertResult ? assertResult.extra_events : null,
          field_failures: assertResult ? assertResult.field_failures : null,
          contract_source: assertResult ? assertResult.contract_source : null,
          tool_exit_code: exitCode
        };
        if (dlStatus !== "pass") {
          submitResult.errors_found.push({
            kind: "datalayer_event_assertion_failed",
            observed: stdout || stderr || `assert-tracking-events.js exit=${exitCode}`
          });
          // NOTE: do NOT flip submit.success here. Tracking and submission
          // are independent gates per split-gate design 2026-04-29.
        } else if (!networkObserved && assertResult && (assertResult.observed_counts?.finance_vsn || assertResult.observed_counts?.finance_nvsn || assertResult.observed_counts?.lead_submit_T2)) {
          // Network listener missed capture but post-submit business events
          // fired — strong corroboration that the form DID submit server-side.
          // Upgrade submit.success when confirmation rendered AND
          // post-submit business events fired AND no network capture exists.
          if (successHit) {
            submitResult.success = true;
            submitResult.checks.push({
              kind: "submit_success_via_datalayer_corroboration",
              ok: true,
              note: "network listener captured no response; dataLayer post-submit business events confirm server-side submission"
            });
          }
        }
      } else {
        submitResult.checks.push({kind:"datalayer_event_check_skipped", reason:"assert-tracking-events.js not found", path:assertScript});
      }
    } catch (err) {
      submitResult.checks.push({kind:"datalayer_event_check_error", error:String(err && err.message || err).slice(0,300)});
    }
  }

  // wpqa-runner-truth-gate F1 (2026-04-29): independent third-dimension REST
  // verification that an entry actually landed. Additive: does NOT flip
  // submit.success even on fail. Gated by SDAS_QA_ENTRY_VERIFY=1 + WP creds.
  try {
    const verifyFormId = (locatorMap?.form?.id != null && String(locatorMap.form.id) !== "")
      ? String(locatorMap.form.id)
      : (locatorMap?.metadata?.form_id ? String(locatorMap.metadata.form_id) : null);
    const verifyEmail = identity?.email || meta?.test_identity?.email || null;
    // Prefer siteBaseUrl derived from --site; fall back to direct URL origin.
    let verifyBaseUrl = siteBaseUrl;
    if (!verifyBaseUrl && meta?.test_links?.direct) {
      try { const u = new URL(meta.test_links.direct); verifyBaseUrl = `${u.protocol}//${u.hostname}/`; } catch {}
    }
    const entryVerified = await verifyEntryViaRest({
      siteBaseUrl: verifyBaseUrl,
      formId: verifyFormId,
      email: verifyEmail,
      runStartTs: submitResult.ts_start
    });
    submitResult.entry_verified = entryVerified;
    submitResult.checks.push({
      kind: "entry_verified_rest",
      status: entryVerified.status,
      entry_id: entryVerified.entry_id || null,
      ok: entryVerified.status === "pass"
    });
    if (entryVerified.status === "fail") {
      submitResult.errors_found.push({
        kind: "entry_verified_rest_failed",
        observed: `entry_verified=${entryVerified.status}; reason=${entryVerified.reason || ""}`
      });
    }
  } catch (verifyErr) {
    submitResult.entry_verified = {
      status: "skipped",
      reason: `verify error: ${String(verifyErr && verifyErr.message || verifyErr).slice(0,200)}`,
      queried_at: nowISO()
    };
    submitResult.checks.push({ kind: "entry_verified_rest_error", error: String(verifyErr && verifyErr.message || verifyErr).slice(0,200) });
  }

  writeJSON(submitResultPath, submitResult);
  writeRunSummary(runDir, meta, submitResultPath, consoleSummary, dlSummary);

  try{
    appendAutoRunSummaryNotes(notesPath, runDir, meta, submitResultPath, consoleSummary, dlSummary);
  }catch(e){
    console.error(`[notes] appendAutoRunSummaryNotes error: ${e.message}`);
  }
  const postSubmitOk = submitResult.success === true && (!expectedConsoleRes || expectedConsoleRes.ok === true);
  updateNotesStatus(notesPath, postSubmitOk ? "PASS" : "FAIL");
  if(!postSubmitOk){
    process.exitCode = 1;
  }

  if(storageStateOut){
    try{
      mkdirp(path.dirname(String(storageStateOut)));
      await context.storageState({ path: String(storageStateOut) });
      fs.appendFileSync(path.join(runDir,"notes.md"), `\n- storage_state_out: ${String(storageStateOut)}\n`, "utf-8");
    }catch(e){
      fs.appendFileSync(path.join(runDir,"notes.md"), `\n- storage_state_out_error: ${String(e)}\n`, "utf-8");
    }
  }

  console.log(`${postSubmitOk ? "Done" : "Done (with assertion failures)"} . Artifacts: ${runDir}`);
  }catch(e){
    let failureScreenshotPath = null;
    let urlAtFailure = null;
    try{
      if(page){
        try{ urlAtFailure = page.url(); }catch{}
      }
      if(page && evidenceDir){
        failureScreenshotPath = path.join(evidenceDir, `FAILURE.${phase}.page.png`);
        await screenshot(page, failureScreenshotPath);
      }
    }catch{}

    try{
      if(consoleJsonl && consoleSummary) summarizeConsoleErrors(consoleJsonl, consoleSummary);
    }catch{}
    try{
      if(dlJsonl && dlSummary) datalayerSummary(dlJsonl, dlSummary);
    }catch{}

    // Best-effort persist partial submit checks (if we got into P5).
    try{
      if(submitResult && submitResultPath){
        if(!submitResult.ts_end) submitResult.ts_end = nowISO();
        writeJSON(submitResultPath, submitResult);
      }
    }catch{}

    try{
      if(runDir && meta){
        writeFailureSummary(runDir, meta, phase, e, {
          derivedDir,
          evidenceDir,
          consoleSummaryPath: consoleSummary,
          dlSummaryPath: dlSummary,
          url: urlAtFailure,
          failureScreenshotPath
        });
        try{
          appendAutoFailureNotes(path.join(runDir,"notes.md"), runDir, phase, e, failureScreenshotPath);
        }catch(noteErr){
          console.error(`[notes] appendAutoFailureNotes error: ${noteErr.message}`);
        }
        const failStatus = phase === "INIT" ? "PREFLIGHT_FAIL" : "FAIL";
        updateNotesStatus(path.join(runDir,"notes.md"), failStatus);
        try{
          if(meta.runset_id){
            upsertRunsetMeta(path.dirname(runDir), meta, path.basename(runDir));
          }
        }catch{}
      }
    }catch{}

    throw e;
  }finally{
    try{ if(context) await context.close(); }catch{}
    try{ if(browser) await browser.close(); }catch{}
  }
}

main().catch(e=>{ console.error("Run failed:", e); process.exit(1); });
