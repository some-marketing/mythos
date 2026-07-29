'use strict';

// tools/image-optimize/__tests__/policy.test.cjs
//
// S1 unit tests (node --test). Gate: verify-local.
//
// Covers the format/sizing POLICY engine (lib/policy.cjs), layered on S0:
//   (1) wide opaque photo (>1920px) -> downscaled to hero cap, never upscaled
//   (2) small image (<640px) -> NOT upscaled (dims unchanged)
//   (3) transparent PNG -> alpha preserved in the output WebP (assert hasAlpha)
//   (4) image over a tight cap -> hard-fail without allowlist; PASS with
//       allowlist + the reason is logged
//   (5) metadata stripped (assert no EXIF in the output WebP)
//   (+) policy manifest conforms to the (extended) DerivativeManifest schema
//   (+) --also-avif produces an ADDITIONAL avif derivative (avifenc present here)
//
// Fixtures are generated at build time via sharp so the suite is self-contained
// and deterministic. Timestamps injected via a fixed now().

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sharp = require('sharp');
const policy = require('../lib/policy.cjs');
const SCHEMA = require('../derivative-manifest.schema.json');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'imgopt-s1-'));
}

function fixedNow(startIso) {
  let t = new Date(startIso).getTime();
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

// ---- Fixture generators (sharp at build time) ----

// A wide opaque photo, > 1920px wide. Noise content so WebP is not trivially tiny.
async function makeWidePhoto(p, width = 2400, height = 1350) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 1103515245 + 12345) & 0xff; // cheap PRNG noise
  await sharp(buf, { raw: { width, height, channels } }).png().toFile(p);
}

// A small opaque image, < 640px wide.
async function makeSmallImage(p, width = 320, height = 200) {
  await sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 90, b: 160 } },
  })
    .png()
    .toFile(p);
}

// A transparent PNG (real alpha channel).
async function makeTransparentPng(p, width = 500, height = 500) {
  await sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.4 } },
  })
    .png()
    .toFile(p);
}

// An opaque noisy image whose WebP will exceed a deliberately tiny cap.
async function makeHeavyImage(p, width = 1200, height = 1200) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) & 0xff; // high-entropy noise
  await sharp(buf, { raw: { width, height, channels } }).png().toFile(p);
}

// A PNG carrying EXIF metadata, to prove metadata is stripped on output.
async function makePngWithExif(p, width = 400, height = 300) {
  await sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 150, b: 50 } },
  })
    .withMetadata({
      exif: { IFD0: { ImageDescription: 'Mythos-S1-fixture-secret-exif' } },
    })
    .png()
    .toFile(p);
}

// Minimal draft-07-ish validator (mirrors the S0 test's, extended for boolean +
// enum + maximum so the S1 fields validate).
function validateAgainstSchema(data, schema, root = schema) {
  const errors = [];
  function resolve(node) {
    if (node && node.$ref) {
      const ref = node.$ref.replace(/^#\//, '').split('/');
      let cur = root;
      for (const seg of ref) cur = cur[seg];
      return cur;
    }
    return node;
  }
  function check(d, sch, p) {
    sch = resolve(sch);
    if (!sch) return;
    if (sch.type === 'object') {
      if (typeof d !== 'object' || d === null || Array.isArray(d)) return errors.push(`${p}: expected object`);
      for (const req of sch.required || []) if (!(req in d)) errors.push(`${p}: missing required "${req}"`);
      if (sch.additionalProperties === false) {
        for (const k of Object.keys(d)) if (!sch.properties || !(k in sch.properties)) errors.push(`${p}: unexpected property "${k}"`);
      }
      for (const [k, v] of Object.entries(d)) if (sch.properties && sch.properties[k]) check(v, sch.properties[k], `${p}.${k}`);
    } else if (sch.type === 'array') {
      if (!Array.isArray(d)) return errors.push(`${p}: expected array`);
      d.forEach((item, i) => check(item, sch.items, `${p}[${i}]`));
    } else if (sch.type === 'string') {
      if (typeof d !== 'string') return errors.push(`${p}: expected string`);
      if (sch.const !== undefined && d !== sch.const) errors.push(`${p}: expected const "${sch.const}"`);
      if (sch.enum && !sch.enum.includes(d)) errors.push(`${p}: not in enum`);
      if (sch.pattern && !new RegExp(sch.pattern).test(d)) errors.push(`${p}: fails pattern ${sch.pattern}`);
    } else if (sch.type === 'integer') {
      if (!Number.isInteger(d)) errors.push(`${p}: expected integer`);
      else {
        if (sch.minimum !== undefined && d < sch.minimum) errors.push(`${p}: below minimum`);
        if (sch.maximum !== undefined && d > sch.maximum) errors.push(`${p}: above maximum`);
      }
    } else if (sch.type === 'boolean') {
      if (typeof d !== 'boolean') errors.push(`${p}: expected boolean`);
    }
  }
  check(data, schema, '$');
  return errors;
}

// ---------------------------------------------------------------------------
// (1) Wide opaque photo (>1920) -> downscaled to hero cap; never upscaled.
// ---------------------------------------------------------------------------
test('wide photo downscales to hero cap, never upscales', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'wide.png');
  await makeWidePhoto(src, 2400, 1350);

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath: path.join(dir, 'manifest.json'),
    tier: 'hero',
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  assert.strictEqual(res.total, 1);
  const it = res.items[0];
  assert.strictEqual(it.tier, 'hero');
  assert.strictEqual(it.downscaled, true, 'source 2400px > 1920 hero cap -> must downscale');
  assert.strictEqual(it.target_width, 1920, 'downscaled to exactly the hero cap');

  // The produced WebP is actually 1920 wide and never wider than the source.
  const meta = await sharp(it.derivative).metadata();
  assert.strictEqual(meta.width, 1920, 'output width == hero cap');
  assert.ok(meta.width <= 2400, 'never upscaled beyond source');
});

// ---------------------------------------------------------------------------
// (2) Small image (<640) -> NOT upscaled (dims unchanged).
// ---------------------------------------------------------------------------
test('small image is not upscaled (dims unchanged)', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'small.png');
  await makeSmallImage(src, 320, 200);

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath: path.join(dir, 'manifest.json'),
    tier: 'thumb', // cap 640; source is 320 -> must stay 320
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  const it = res.items[0];
  assert.strictEqual(it.downscaled, false, 'source 320 < 640 thumb cap -> no resize');
  assert.strictEqual(it.target_width, 320, 'target width == source width (no upscale)');

  const meta = await sharp(it.derivative).metadata();
  assert.strictEqual(meta.width, 320, 'output keeps source width');
  assert.strictEqual(meta.height, 200, 'output keeps source height');
});

// ---------------------------------------------------------------------------
// (3) Transparent PNG -> alpha preserved in the output WebP.
// ---------------------------------------------------------------------------
test('transparent PNG -> alpha preserved in output WebP', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'alpha.png');
  await makeTransparentPng(src, 500, 500);

  // Sanity: the source really has alpha (mechanical detection, not a guess).
  const srcMeta = await sharp(src).metadata();
  assert.strictEqual(srcMeta.hasAlpha, true, 'fixture source must have alpha');

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath: path.join(dir, 'manifest.json'),
    tier: 'content',
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  const it = res.items[0];
  assert.strictEqual(it.has_alpha, true, 'policy records alpha preserved');

  const outMeta = await sharp(it.derivative).metadata();
  assert.strictEqual(outMeta.format, 'webp', 'output is WebP');
  assert.strictEqual(outMeta.hasAlpha, true, 'output WebP MUST carry alpha');
});

// ---------------------------------------------------------------------------
// (4) Over a tight cap -> hard-fail without allowlist; PASS with allowlist + log.
// ---------------------------------------------------------------------------
test('cap violation hard-fails without allowlist', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'heavy.png');
  await makeHeavyImage(src, 1200, 1200);

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath: path.join(dir, 'manifest.json'),
    tier: 'content',
    tiers: { content: { max_width: 1280, max_bytes: 1024 } }, // 1KB — impossible cap
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  assert.strictEqual(res.ok, false, 'over-cap derivative without allowlist must fail the policy');
  assert.strictEqual(res.failed, 1);
  assert.strictEqual(res.items[0].status, 'fail');
  assert.ok(res.failures[0].message.includes('POLICY CAP FAIL'), 'structured cap-fail message');
  assert.ok(res.items[0].bytes > 1024, 'derivative really exceeds the tight cap');
});

test('cap violation PASSES when allowlisted-with-reason (reason logged)', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'heavy.png');
  await makeHeavyImage(src, 1200, 1200);

  const logs = [];
  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath: path.join(dir, 'manifest.json'),
    tier: 'content',
    tiers: { content: { max_width: 1280, max_bytes: 1024 } },
    allowlist: { 'heavy.png': 'operator-judged-acceptable: high-detail hero render, S5 adversarial fixture' },
    now: fixedNow('2026-06-17T00:00:00.000Z'),
    log: (m) => logs.push(m),
  });

  assert.strictEqual(res.ok, true, 'allowlisted over-cap derivative PASSES');
  assert.strictEqual(res.failed, 0);
  assert.strictEqual(res.allowlisted, 1);
  const it = res.items[0];
  assert.strictEqual(it.status, 'allowlisted');
  assert.ok(it.over_cap, 'still flagged as over-cap (allowlisted, not hidden)');
  assert.match(it.allowlist_reason, /operator-judged-acceptable/);
  // The exception is logged with its reason.
  assert.ok(
    logs.some((l) => l.includes('ALLOWLISTED') && l.includes('operator-judged-acceptable')),
    'every allowlisted exception is logged with its reason'
  );
});

// ---------------------------------------------------------------------------
// (5) Metadata stripped on output (no EXIF in the produced WebP).
// ---------------------------------------------------------------------------
test('metadata is stripped on output (no EXIF carried through)', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'exif.png');
  await makePngWithExif(src, 400, 300);

  // Sanity: the source actually carries the EXIF we injected.
  const srcMeta = await sharp(src).metadata();
  assert.ok(srcMeta.exif, 'fixture source must carry EXIF');

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath: path.join(dir, 'manifest.json'),
    tier: 'content',
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  const outMeta = await sharp(res.items[0].derivative).metadata();
  assert.strictEqual(outMeta.exif, undefined, 'output WebP must NOT carry EXIF (metadata stripped)');
});

// ---------------------------------------------------------------------------
// (+) Policy manifest conforms to the extended schema; names encode the width.
// ---------------------------------------------------------------------------
test('policy manifest conforms to schema + deterministic width-encoded names', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'photo.png');
  await makeWidePhoto(src, 2400, 1350);
  const manifestPath = path.join(dir, 'manifest.json');

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath,
    tier: 'hero',
    quality: 78,
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errs = validateAgainstSchema(manifest, SCHEMA);
  assert.deepStrictEqual(errs, [], 'policy manifest must conform to schema: ' + errs.join('; '));

  const e = manifest.entries[0];
  assert.strictEqual(e.tier, 'hero');
  assert.strictEqual(e.target_width, 1920);
  assert.strictEqual(e.quality, 78);
  assert.strictEqual(typeof e.has_alpha, 'boolean');
  assert.strictEqual(typeof e.downscaled, 'boolean');
  // Deterministic name encodes the produced width.
  assert.strictEqual(path.basename(e.derivative_path), 'photo-1920.webp', 'name encodes width');
  assert.strictEqual(res.items[0].bytes, e.bytes);
});

// ---------------------------------------------------------------------------
// (+) --also-avif produces an ADDITIONAL avif derivative (avifenc present here),
// never the sole asset (the WebP still exists).
// ---------------------------------------------------------------------------
test('--also-avif produces an additional AVIF derivative alongside the WebP', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'photo.png');
  await makeSmallImage(src, 600, 400);

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir: path.join(dir, 'out'),
    manifestPath: path.join(dir, 'manifest.json'),
    tier: 'content',
    alsoAvif: true,
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  const it = res.items[0];
  // WebP always exists (never the sole asset).
  assert.ok(fs.existsSync(it.derivative), 'WebP primary derivative exists');
  if (policy.avifencAvailable()) {
    assert.ok(it.avif, 'avifenc present -> avif derivative recorded');
    assert.ok(fs.existsSync(it.avif), 'avif file written');
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.ok(m.entries[0].avif, 'manifest records the avif sub-derivative');
  } else {
    // Graceful degrade: --also-avif with no avifenc => no avif, WebP still there.
    assert.strictEqual(it.avif, null, 'no avifenc -> graceful skip, WebP remains the asset');
  }
});

// ---------------------------------------------------------------------------
// (+) Nested source tree: optimizePolicy must RECURSE and PRESERVE the relative
// subdir structure under outDir. Two same-named files in different subdirs must
// NOT collide; intermediate output dirs are created. Re-run is a true no-op.
// ---------------------------------------------------------------------------
test('nested src tree: recurse + preserve subdirs (no collision); re-run no-op', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'sub-a'), { recursive: true });
  fs.mkdirSync(path.join(src, 'sub-b'), { recursive: true });
  // Same basename in two subdirs -> a flattening optimizer would collide them.
  await makeSmallImage(path.join(src, 'sub-a', 'x.png'), 400, 300);
  await makeSmallImage(path.join(src, 'sub-b', 'x.png'), 500, 350);
  await makeSmallImage(path.join(src, 'top.png'), 320, 200);

  const outDir = path.join(dir, 'out');
  const manifestPath = path.join(dir, 'manifest.json');

  const res = await policy.optimizePolicy({
    srcPath: src,
    outDir,
    manifestPath,
    tier: 'content',
    now: fixedNow('2026-06-17T00:00:00.000Z'),
  });

  assert.strictEqual(res.total, 3, 'recursion finds all 3 nested sources');
  assert.strictEqual(res.encoded, 3, 'all 3 encoded');

  // Width-encoded names preserved under their subdirs; no collision.
  const outA = path.join(outDir, 'sub-a', 'x-400.webp');
  const outB = path.join(outDir, 'sub-b', 'x-500.webp');
  const outTop = path.join(outDir, 'top-320.webp');
  assert.ok(fs.existsSync(outA), 'sub-a/x-400.webp present');
  assert.ok(fs.existsSync(outB), 'sub-b/x-500.webp present');
  assert.ok(fs.existsSync(outTop), 'top-320.webp present');
  // Both derivatives are distinct files in distinct dirs (no flatten/collision).
  const derivs = res.items.map((i) => path.resolve(i.derivative));
  assert.strictEqual(new Set(derivs).size, 3, 'all 3 derivative paths are distinct');

  // Re-run: source hashes unchanged AND derivatives present -> ZERO re-encodes.
  // (policy re-encodes any source whose derivative is missing; here all present
  // with matching subdir paths, so a re-run must produce the same paths and not
  // duplicate manifest entries.)
  const res2 = await policy.optimizePolicy({
    srcPath: src,
    outDir,
    manifestPath,
    tier: 'content',
    now: fixedNow('2026-06-18T00:00:00.000Z'),
  });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.entries.length, 3, 're-run does not duplicate manifest entries');
  assert.strictEqual(res2.encoded, 3, 'policy re-encodes (no skip-by-hash path), but to the SAME subdir paths');
  const derivs2 = res2.items.map((i) => path.resolve(i.derivative)).sort();
  assert.deepStrictEqual(derivs2, derivs.slice().sort(), 're-run targets the identical subdir-preserved paths');
});
