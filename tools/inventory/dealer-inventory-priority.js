#!/usr/bin/env node

/**
 * dealer-inventory-priority.js
 *
 * Pulls LIVE new-vehicle inventory counts per model from a dealer website and
 * emits a stock-depth-ranked run-list for a monthly Meta ad set: which vehicle
 * ad slots to run at full depth, which to trim to a single design (thin stock),
 * and which to HOLD (we shouldn't advertise a model we're out of).
 *
 * READ-ONLY. This tool only reads a public dealer site. It never touches ad
 * builds, Meta, or any client credential. Safe to re-run every month/cycle.
 *
 * Config-driven + cwd-independent: all dealer/model/slot facts live in a JSON
 * config (default: ./config/example-dealer-offers.config.example.json, resolved next to this file).
 * Point --config at another dealer's file to reuse the same machinery.
 *
 * Usage:
 *   node tools/inventory/dealer-inventory-priority.js
 *   node tools/inventory/dealer-inventory-priority.js --config <path/to/config.json>
 *   node tools/inventory/dealer-inventory-priority.js --json-out <path> --md-out <path>
 *   node tools/inventory/dealer-inventory-priority.js --quiet   # suppress the human report on stdout
 *
 * Requires: playwright (already used elsewhere in this repo).
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// ---- args ----
function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const CONFIG_PATH = path.resolve(getArg('--config', path.join(__dirname, 'config', 'example-dealer-offers.config.example.json')));
const JSON_OUT = getArg('--json-out', null);
const MD_OUT = getArg('--md-out', null);
const QUIET = process.argv.includes('--quiet');

function log(...a) { if (!QUIET) console.error(...a); } // progress -> stderr, report -> stdout

// ---- load config ----
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Config not found: ${CONFIG_PATH}`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const dealer = cfg.dealer;
const thresholds = cfg.thresholds || { hold_at_or_below: 0, thin_at_or_below: 2 };
const adSets = (cfg.ad_model && cfg.ad_model.ad_sets) || 1;

function modelUrl(modelDef) {
  const u = new URL(dealer.base_url + dealer.inventory_search_path);
  u.searchParams.set(dealer.model_query_param, modelDef.query);
  return u.toString();
}

// ---- live fetch: count NEW cards whose data-model matches, deduped by stock ----
async function countModel(page, name, modelDef) {
  const url = modelUrl(modelDef);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500); // let the SRP hydrate its result cards
  const conditionWanted = (dealer.condition_wanted || 'NEW').toUpperCase();
  const result = await page.evaluate(({ match, conditionWanted }) => {
    const re = new RegExp(match, 'i');
    const cards = [...document.querySelectorAll('input[name=vehicledata][data-stock-number]')];
    const seen = new Map();
    for (const c of cards) {
      const cond = (c.getAttribute('data-condition') || '').toUpperCase();
      const model = (c.getAttribute('data-model') || '').trim();
      if (cond !== conditionWanted) continue;
      if (!re.test(model)) continue;
      const stock = c.getAttribute('data-stock-number');
      if (!seen.has(stock)) {
        seen.set(stock, {
          stock,
          year: c.getAttribute('data-year') || '',
          model,
          trim: (c.getAttribute('data-trim') || '').trim(),
          vin: c.getAttribute('data-vin') || ''
        });
      }
    }
    return { count: seen.size, units: [...seen.values()] };
  }, { match: modelDef.match, conditionWanted });
  return { name, query: modelDef.query, url, count: result.count, units: result.units };
}

function tierFor(count) {
  if (count <= thresholds.hold_at_or_below) return 'HOLD';
  if (count <= thresholds.thin_at_or_below) return 'THIN';
  return 'RUN';
}

async function main() {
  log(`Reading LIVE inventory from ${dealer.base_url} (config: ${path.basename(CONFIG_PATH)})`);

  // Which model names do we actually need? Union of slot models + report_only.
  const needed = new Set(cfg.report_only_models || []);
  for (const s of cfg.slots) {
    if (s.model) needed.add(s.model);
    if (s.models) s.models.forEach((m) => needed.add(m));
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const inventory = {}; // name -> {count, url, units, tier}
  for (const name of needed) {
    const modelDef = cfg.models[name];
    if (!modelDef) { log(`  ! no model query defined for "${name}", skipping`); continue; }
    log(`  fetching ${name} ...`);
    const r = await countModel(page, name, modelDef);
    r.tier = tierFor(r.count);
    inventory[name] = r;
    log(`    ${name}: ${r.count} in stock [${r.tier}]`);
  }
  await browser.close();

  // ---- build the ranked run-list ----
  const vehicleSlots = [];
  const nonVehicleSlots = [];
  let fullAds = 0;
  let recommendedAds = 0;

  for (const s of cfg.slots) {
    const fullSlotAds = s.creative_units * adSets;
    fullAds += fullSlotAds;

    if (!s.model && !s.models) {
      // non-vehicle slot: always eligible, run full
      recommendedAds += fullSlotAds;
      nonVehicleSlots.push({
        slot: s.slot, slug: s.slug, decision: 'RUN', creative_units: s.creative_units,
        recommended_units: s.creative_units, ads: fullSlotAds, note: s.note || null
      });
      continue;
    }

    if (s.roundup && s.models) {
      const components = s.models.map((m) => ({ model: m, count: inventory[m] ? inventory[m].count : null }));
      const zero = components.filter((c) => c.count !== null && c.count <= thresholds.hold_at_or_below);
      const combined = components.reduce((a, c) => a + (c.count || 0), 0);
      let decision, recUnits, flag = null;
      if (zero.length > 0) {
        decision = 'HOLD_COPY_FIX';
        recUnits = 0;
        flag = `copy names ${zero.map((z) => z.model).join(', ')} but stock is 0 — hold until copy drops the out-of-stock truck, or run a ${components.filter((c) => c.count > 0).map((c) => c.model).join('+')}-only roundup`;
      } else {
        decision = 'RUN';
        recUnits = s.creative_units;
      }
      recommendedAds += recUnits * adSets;
      vehicleSlots.push({
        slot: s.slot, slug: s.slug, roundup: true, components, combined_count: combined,
        primary_count: combined, tier: zero.length ? 'HOLD' : 'RUN', decision,
        creative_units: s.creative_units, recommended_units: recUnits,
        ads: recUnits * adSets, flag, note: s.note || null
      });
      continue;
    }

    // single-model vehicle slot
    const inv = inventory[s.model];
    const count = inv ? inv.count : null;
    const tier = count === null ? 'UNKNOWN' : tierFor(count);
    let decision, recUnits, flag = null;
    if (tier === 'HOLD') { decision = 'HOLD'; recUnits = 0; flag = `0 in stock — do not advertise a model we don't have`; }
    else if (tier === 'THIN') { decision = 'TRIM_1_DESIGN'; recUnits = 1; flag = `thin stock (${count}) — limited; run 1 design or hold`; }
    else if (tier === 'RUN') { decision = 'RUN'; recUnits = s.creative_units; }
    else { decision = 'REVIEW'; recUnits = s.creative_units; flag = 'no live count — verify manually'; }
    recommendedAds += recUnits * adSets;
    vehicleSlots.push({
      slot: s.slot, slug: s.slug, model: s.model, primary_count: count, tier, decision,
      creative_units: s.creative_units, recommended_units: recUnits,
      ads: recUnits * adSets, flag, note: s.note || null
    });
  }

  // rank vehicle (non-roundup) slots by stock depth desc
  const ranked = [...vehicleSlots]
    .filter((v) => typeof v.primary_count === 'number')
    .sort((a, b) => b.primary_count - a.primary_count)
    .map((v, i) => ({ rank: i + 1, slot: v.slot, slug: v.slug, model: v.model || (v.roundup ? '(roundup)' : ''), count: v.primary_count, decision: v.decision }));

  const out = {
    generated_at: new Date().toISOString(),
    client: cfg.client,
    label: cfg.label,
    source: { base_url: dealer.base_url, inventory_search_path: dealer.inventory_search_path, method: 'playwright DOM count of vehicledata cards (deduped by stock#, matched by data-model, NEW only)' },
    thresholds,
    ad_sets: adSets,
    inventory: Object.fromEntries(Object.entries(inventory).map(([k, v]) => [k, { count: v.count, tier: v.tier, url: v.url, stock_numbers: v.units.map((u) => u.stock) }])),
    priority_ranking: ranked,
    vehicle_slots: vehicleSlots,
    non_vehicle_slots: nonVehicleSlots,
    ad_count: { full_plan: fullAds, recommended: recommendedAds, trimmed_by: fullAds - recommendedAds }
  };

  if (JSON_OUT) { fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(out, null, 2)); log(`  wrote JSON -> ${path.resolve(JSON_OUT)}`); }

  const md = renderMarkdown(out);
  if (MD_OUT) { fs.writeFileSync(path.resolve(MD_OUT), md); log(`  wrote Markdown -> ${path.resolve(MD_OUT)}`); }
  if (!QUIET) console.log(md);

  return out;
}

function renderMarkdown(o) {
  const L = [];
  L.push(`# ${o.label} — inventory-prioritized run-list`);
  L.push('');
  L.push(`Generated ${o.generated_at} · source: ${o.source.base_url} · READ-ONLY (no ad build or Meta touched)`);
  L.push('');
  L.push('## Live new-vehicle inventory');
  L.push('');
  L.push('| Model | In stock | Tier |');
  L.push('|---|---|---|');
  for (const [name, inv] of Object.entries(o.inventory)) {
    L.push(`| ${name} | ${inv.count} | ${inv.tier} |`);
  }
  L.push('');
  L.push('## Priority ranking (vehicle slots by stock depth)');
  L.push('');
  L.push('| Rank | Slot | Model | Count | Decision |');
  L.push('|---|---|---|---|---|');
  for (const r of o.priority_ranking) L.push(`| ${r.rank} | ${r.slot} ${r.slug} | ${r.model} | ${r.count} | ${r.decision} |`);
  L.push('');
  L.push('## Recommended run-list');
  L.push('');
  L.push('| Slot | Decision | Units (rec/full) | Ads | Flag |');
  L.push('|---|---|---|---|---|');
  for (const v of o.vehicle_slots) {
    const cnt = v.roundup ? `roundup ${v.combined_count}` : v.primary_count;
    L.push(`| ${v.slot} ${v.slug} (${cnt}) | ${v.decision} | ${v.recommended_units}/${v.creative_units} | ${v.ads} | ${v.flag || ''} |`);
  }
  for (const v of o.non_vehicle_slots) {
    L.push(`| ${v.slot} ${v.slug} | ${v.decision} | ${v.recommended_units}/${v.creative_units} | ${v.ads} | ${v.note || ''} |`);
  }
  L.push('');
  L.push(`**Ad count: ${o.ad_count.recommended} recommended vs ${o.ad_count.full_plan} full plan (trimmed ${o.ad_count.trimmed_by}).**`);
  L.push('');
  return L.join('\n');
}

main().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
