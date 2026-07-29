#!/usr/bin/env node

/**
 * stage-review-media.js
 *
 * Stages the per-ad creative MEDIA for the ads-approval-portal review cards:
 *   1. Copies every DELIVERED format/size variant (1:1, 4:5, 9:16, ...) for each
 *      ad from the delesign deliverables tree into the portal's same-origin
 *      review-images/<code>/formats/ directory (regex-safe filenames), and
 *   2. Emits a per-dealer media manifest (app/data/<CODE>-review-media.json)
 *      keyed by ad_id, listing each ad's format tiles (type/ratio/dims/label/file)
 *      and an optional grabbed vehicle image.
 *
 * The portal renderer (review-cards.php) reads that manifest by ad_id and renders
 * a "delivered formats" tile grid + optional vehicle hero. Manifest is keyed by
 * ad_id ONLY — it never renames ad_ids or review_ids, so existing approvals stay
 * bound to their cards.
 *
 * LOCAL-ONLY + cached: files already staged are skipped. Nothing here touches the
 * live host, the review-data JSON, or the capture log. Mechanical + re-runnable.
 *
 * Config-driven + cwd-independent (paths resolved from the config, which may use
 * absolute paths or paths relative to the config file's own directory).
 *
 * Ratio is derived from the WIDTHxHEIGHT token in the delivered filename (e.g.
 * "1080X1080" -> 1:1, "1080X1350" -> 4:5, "1080X1920" -> 9:16), so both the
 * top-level "[1_1 1080X1080]" naming and the nested "[1080X1920]" naming resolve
 * uniformly without a hard-coded ratio label.
 *
 * Usage:
 *   node tools/review-media/stage-review-media.js --config <path/to/media-config.json>
 *   node tools/review-media/stage-review-media.js --config <cfg> --vehicle-map <map.json>
 *   node tools/review-media/stage-review-media.js --config <cfg> --dry
 *
 * --vehicle-map <json>: merge a { "<ad_id>": {filename, model, source} , ... } map
 *   (produced by dealer-vehicle-image.js) into the manifest's per-ad "vehicle" field.
 */

const fs = require('fs');
const path = require('path');

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const CONFIG_PATH = path.resolve(getArg('--config', ''));
const VEHICLE_MAP = getArg('--vehicle-map', null);
const DRY = process.argv.includes('--dry');

if (!CONFIG_PATH || !fs.existsSync(CONFIG_PATH)) {
  console.error(`Config not found: ${CONFIG_PATH || '(none given; pass --config)'}`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const cfgDir = path.dirname(CONFIG_PATH);

// Resolve a config path (absolute wins; otherwise relative to the config file).
function rp(p) { return path.isAbsolute(p) ? p : path.resolve(cfgDir, p); }

const deliverablesDir = rp(cfg.deliverables_dir);
const reviewImagesDir = rp(cfg.review_images_dir);           // .../review-images/<code>
const formatsDir = path.join(reviewImagesDir, 'formats');
const manifestOut = rp(cfg.manifest_out);

// Recursively list every file under a directory (returns absolute paths).
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Nominal pixel dims for a ratio label, used when a filename carries only a
// ratio token (e.g. one example vendor delivery "[4.5]") and no explicit WIDTHxHEIGHT.
const NOMINAL = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };

// Derive {ratio,w,h} from either a WIDTHxHEIGHT token (one example vendor delivery "[1080X1350]") or a
// ratio-label token (one example vendor delivery "[4.5]" / "[9_16]" / "1_1"). null when neither present.
function ratioFromName(name) {
  const px = name.match(/(\d{3,4})\s*[xX]\s*(\d{3,4})/);
  if (px) {
    const w = parseInt(px[1], 10), h = parseInt(px[2], 10);
    const g = (a, b) => (b ? g(b, a % b) : a);
    const d = g(w, h) || 1;
    return { ratio: `${w / d}:${h / d}`, w, h };
  }
  // Ratio-label form: [4.5], [9_16], [1-1], "9.16", etc. — a small A?B pair.
  const rl = name.match(/\[?\s*(\d{1,2})\s*[._-]\s*(\d{1,2})\s*\]?/);
  if (rl) {
    const ratio = `${parseInt(rl[1], 10)}:${parseInt(rl[2], 10)}`;
    const dims = NOMINAL[ratio];
    if (dims) return { ratio, w: dims[0], h: dims[1] };
    return { ratio, w: 0, h: 0 };
  }
  return null;
}

// Human label from the delivered filename: pull VARIANT / DESIGN tokens if present.
function labelFromName(name) {
  const bits = [];
  const v = name.match(/VARIANT\s+([A-Za-z0-9]+)/i);
  if (v) bits.push('Variant ' + v[1].toUpperCase());
  const d = name.match(/DESIGN\s+(\d+)/i);
  if (d) bits.push('Design ' + d[1]);
  return bits.join(' · ') || path.basename(name, path.extname(name));
}

// Regex-safe staged filename.
function safeName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const allFiles = walk(deliverablesDir);

if (!DRY && !fs.existsSync(formatsDir)) fs.mkdirSync(formatsDir, { recursive: true });

let vehicleMap = {};
if (VEHICLE_MAP && fs.existsSync(rp(VEHICLE_MAP))) {
  vehicleMap = JSON.parse(fs.readFileSync(rp(VEHICLE_MAP), 'utf8'));
}

const manifest = {
  code: cfg.code,
  review_id: cfg.review_id,
  generated_at: new Date().toISOString(),
  source: { deliverables_dir: deliverablesDir },
  ads: {}
};

let staged = 0, skipped = 0;

for (const ad of cfg.ads) {
  const re = new RegExp(ad.match, 'i');
  // Match on the path RELATIVE to the deliverables dir so slot folders count too.
  const hits = allFiles.filter((f) => {
    const rel = path.relative(deliverablesDir, f);
    return /\.(png|jpe?g|webp)$/i.test(f) && re.test(rel);
  });

  const formats = [];
  const seenOut = new Set(); // dedupe identical derived tiles (e.g. a 4:5 delivered
                             // in both the top-level and a nested slot folder)
  for (const src of hits.sort()) {
    const base = path.basename(src);
    const rr = ratioFromName(base);
    if (!rr) continue; // no ratio/dims token -> can't classify; skip (don't guess)
    const ext = path.extname(src).toLowerCase();
    const label = labelFromName(base);
    const stem = safeName(`${ad.ad_id}-${label}-${rr.ratio.replace(':', 'x')}`);
    const outName = `${stem}${ext}`;
    if (seenOut.has(outName)) continue;
    seenOut.add(outName);
    const outPath = path.join(formatsDir, outName);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      skipped++;
    } else if (!DRY) {
      fs.copyFileSync(src, outPath);
      staged++;
    }
    formats.push({
      type: 'image',
      ratio: rr.ratio,
      w: rr.w,
      h: rr.h,
      label,
      filename: `formats/${outName}`
    });
  }

  // Sort tiles by ratio then label for a stable display order.
  const ratioOrder = { '1:1': 0, '4:5': 1, '9:16': 2 };
  formats.sort((a, b) => (ratioOrder[a.ratio] ?? 9) - (ratioOrder[b.ratio] ?? 9) || a.label.localeCompare(b.label));

  manifest.ads[ad.ad_id] = {
    slot: ad.slot ?? null,
    vehicle: vehicleMap[ad.ad_id] || null,
    formats
  };
}

if (!DRY) {
  fs.mkdirSync(path.dirname(manifestOut), { recursive: true });
  fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2));
}

// Report (stderr = progress, stdout = summary)
console.error(`deliverables: ${deliverablesDir}`);
console.error(`formats dir : ${formatsDir}`);
console.error(`manifest    : ${manifestOut}${DRY ? ' (DRY — not written)' : ''}`);
console.error(`staged ${staged} new tile(s), skipped ${skipped} cached.`);
for (const [adId, m] of Object.entries(manifest.ads)) {
  const byRatio = {};
  for (const f of m.formats) byRatio[f.ratio] = (byRatio[f.ratio] || 0) + 1;
  const veh = m.vehicle ? `vehicle=${m.vehicle.filename}` : 'vehicle=—(fallback)';
  console.log(`${adId}: ${m.formats.length} tiles [${Object.entries(byRatio).map(([r, n]) => `${r}×${n}`).join(', ') || 'none'}] ${veh}`);
}
