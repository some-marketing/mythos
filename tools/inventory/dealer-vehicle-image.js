#!/usr/bin/env node

/**
 * dealer-vehicle-image.js
 *
 * Grabs ONE representative NEW-vehicle photo per model from a dealer website and
 * caches it locally, so a review/approval card can show a recognizable picture of
 * the vehicle a promo is about ("just use an image we grab from the site").
 *
 * READ-ONLY on the dealer site. Reuses the same dealer/model config shape as
 * dealer-inventory-priority.js (d2cmedia SRP): it renders
 *   dealer.base_url + dealer.inventory_search_path?<model_query_param>=<query>
 * and each result card carries a hidden
 *   <input name=vehicledata data-stock-number data-condition data-model data-year data-trim data-vin>.
 * The vehicle photo lives as an <img class="mainImage"> inside that card's
 * `.carBoxInner` ancestor; we take the first NEW in-stock card matching the
 * model, read its rendered currentSrc/src (imagescdn.d2cmedia.ca, absolute), and
 * download it SERVER-SIDE into the portal's same-origin review-images dir. The
 * page never hotlinks an external URL (strict CSP) — the file is cached locally.
 *
 * Config-driven + cwd-independent: dealer/model facts come from a JSON config
 * (default: ./config/example-dealer-offers.config.example.json, resolved next to this file). Point
 * --config at another dealer's file to reuse the same machinery.
 *
 * Usage:
 *   node tools/inventory/dealer-vehicle-image.js --out-dir <dir> --model "F-150"
 *   node tools/inventory/dealer-vehicle-image.js --out-dir <dir> --models "Bronco Sport,F-150,Transit,Maverick"
 *   node tools/inventory/dealer-vehicle-image.js --config <cfg> --out-dir <dir> --all-models
 *   node tools/inventory/dealer-vehicle-image.js ... --prefix acme --json-out <path>
 *
 * Caching: if the target file already exists and is non-empty, the download is
 * skipped (cached: true). Re-run every cycle; safe and idempotent.
 *
 * Requires: playwright (already used by dealer-inventory-priority.js).
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const CONFIG_PATH = path.resolve(getArg('--config', path.join(__dirname, 'config', 'example-dealer-offers.config.example.json')));
const OUT_DIR = getArg('--out-dir', null);
const PREFIX = getArg('--prefix', null); // filename prefix, e.g. "acme"; defaults to config.client lowercased
const MODEL_ONE = getArg('--model', null);
const MODELS_CSV = getArg('--models', null);
const ALL_MODELS = process.argv.includes('--all-models');
const JSON_OUT = getArg('--json-out', null);
const HYDRATE_MS = parseInt(getArg('--hydrate-ms', '3500'), 10);

function log(...a) { console.error(...a); } // progress -> stderr; JSON result -> stdout

if (!fs.existsSync(CONFIG_PATH)) { console.error(`Config not found: ${CONFIG_PATH}`); process.exit(1); }
if (!OUT_DIR) { console.error('Missing --out-dir (where to cache the images, e.g. app/public/review-images/acme/vehicles)'); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const dealer = cfg.dealer;
const prefix = (PREFIX || cfg.client || 'dealer').toString().toLowerCase();
const outDir = path.resolve(OUT_DIR);
const conditionWanted = (dealer.condition_wanted || 'NEW').toUpperCase();

function regexSafe(s) {
  return s.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function modelUrl(modelDef) {
  const u = new URL(dealer.base_url + dealer.inventory_search_path);
  u.searchParams.set(dealer.model_query_param, modelDef.query);
  return u.toString();
}

// Extract the first NEW in-stock unit for a model + its vehicle image URL.
async function grabModelImage(page, name, modelDef) {
  const url = modelUrl(modelDef);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(HYDRATE_MS);
  return await page.evaluate(({ match, conditionWanted }) => {
    const re = new RegExp(match, 'i');
    const inputs = [...document.querySelectorAll('input[name=vehicledata][data-stock-number]')];
    for (const inp of inputs) {
      const cond = (inp.getAttribute('data-condition') || '').toUpperCase();
      const model = (inp.getAttribute('data-model') || '').trim();
      if (cond !== conditionWanted) continue;
      if (!re.test(model)) continue;
      // Climb to the enclosing card and take its vehicle photo. Prefer the
      // rendered currentSrc; fall back through src/data-src/srcset. The image is
      // the first <img> in an ancestor (typically `.carBoxInner`, class mainImage).
      let node = inp;
      for (let i = 0; i < 8 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const img = node.querySelector('img.mainImage') || node.querySelector('img');
        if (img) {
          const srcset = img.getAttribute('srcset') || '';
          const firstFromSrcset = srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '';
          const raw = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src')
            || img.getAttribute('data-original') || firstFromSrcset || '';
          let abs = '';
          try { abs = raw ? new URL(raw, location.href).toString() : ''; } catch (e) { abs = raw; }
          if (abs) {
            return {
              image_url: abs,
              matched_unit: {
                year: inp.getAttribute('data-year') || '',
                model,
                trim: (inp.getAttribute('data-trim') || '').trim(),
                stock: inp.getAttribute('data-stock-number') || ''
              }
            };
          }
        }
      }
    }
    return null;
  }, { match: modelDef.match, conditionWanted });
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty body for ${url}`);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let names;
  if (MODEL_ONE) names = [MODEL_ONE];
  else if (MODELS_CSV) names = MODELS_CSV.split(',').map((s) => s.trim()).filter(Boolean);
  else if (ALL_MODELS) names = Object.keys(cfg.models || {});
  else { console.error('Specify --model, --models "a,b,c", or --all-models'); process.exit(1); }

  log(`Grabbing vehicle images from ${dealer.base_url} (config: ${path.basename(CONFIG_PATH)}) -> ${outDir}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const results = [];
  const fallbacks = [];
  for (const name of names) {
    const modelDef = (cfg.models || {})[name] || { query: name, match: `^${name}$` };
    const ext = '.jpg';
    const fname = `${prefix}-${regexSafe(name)}${ext}`;
    const dest = path.join(outDir, fname);

    // Cache: skip if present + non-empty.
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      log(`  ${name}: cached (${fname})`);
      results.push({ model: name, saved_to: fname, cached: true, image_url: null, matched_unit: null });
      continue;
    }

    log(`  ${name}: fetching SRP ...`);
    let hit = null;
    try { hit = await grabModelImage(page, name, modelDef); }
    catch (e) { fallbacks.push({ model: name, reason: `SRP error: ${e.message}` }); continue; }

    if (!hit || !hit.image_url) { fallbacks.push({ model: name, reason: 'no NEW in-stock unit / no image found' }); continue; }

    try {
      const bytes = await download(hit.image_url, dest);
      log(`    saved ${fname} (${bytes} bytes) <- ${hit.matched_unit.year} ${hit.matched_unit.model} ${hit.matched_unit.trim}`);
      results.push({ model: name, saved_to: fname, cached: false, image_url: hit.image_url, matched_unit: hit.matched_unit });
    } catch (e) {
      fallbacks.push({ model: name, reason: `download failed: ${e.message}`, image_url: hit.image_url });
    }
  }
  await browser.close();

  const out = {
    generated_at: new Date().toISOString(),
    client: cfg.client,
    source: dealer.base_url,
    out_dir: outDir,
    grabbed: results,
    fallbacks
  };
  if (JSON_OUT) { fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 2)); log(`  wrote JSON -> ${path.resolve(JSON_OUT)}`); }
  console.log(JSON.stringify(out, null, 2));
  return out;
}

main().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
