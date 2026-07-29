'use strict';

// tools/image-optimize/lib/policy.cjs
//
// Mythos image-optimization standard — format/sizing POLICY engine (slice S1).
//
// Layered ON TOP of S0 (engine.cjs / adapters.cjs); does NOT rewrite the S0
// adapter layer or its minimal optimize() path. S0 still owns: encoder
// preference resolution, capability detection, fail-CLOSED-on-no-encoder, and
// the DerivativeManifest schema/shape. S1 reuses those (resolveEncoderOrder,
// loadConfig, sha256File, MANIFEST_SCHEMA, loadManifest, writeManifest) and adds
// the policy on top:
//
//   1. Sizing tiers with max-width caps: hero<=1920, content<=1280, thumb<=640.
//      NEVER upscale — only downscale when source width exceeds the tier cap.
//   2. WebP-primary lossy, quality default ~80 (configurable). Deterministic
//      derivative names encode the produced width: name-<width>.webp.
//   3. Mechanical transparency detection via the source's ACTUAL alpha (sharp
//      metadata hasAlpha). Alpha source -> alpha-capable WebP by default;
//      pngquant PNG-retain fallback path provided (detect-and-skip if absent).
//   4. Strip metadata on output.
//   5. Tiered hard-fail byte caps (hero 250KB / content 100KB / thumb 50KB,
//      configurable) UNLESS allowlisted-with-reason. Distinct from S0's
//      fail-closed-on-no-encoder — this is a POLICY gate on the produced bytes.
//   6. AVIF optional behind --also-avif (additional derivative, never sole
//      asset; default off; graceful if avifenc absent).
//   7. Extends the manifest entry with tier, target_width, quality, policy, and
//      (if produced) an avif derivative sub-record.
//
// sharp is the resize-capable adapter the standard uses for resize+encode; the
// S0 cwebp/imagemagick adapters can -resize too but sharp is cleaner for the
// combined resize+encode+strip+alpha path. If sharp is absent, the policy run
// fails CLOSED (reusing the same fail-closed posture as S0).

const fs = require('fs');
const path = require('path');

const {
  MANIFEST_SCHEMA,
  sha256File,
  loadManifest,
  writeManifest,
  enumerateSources,
} = require('./engine.cjs');
const { whichBinary, moduleResolvable } = require('./adapters.cjs');

// ---------------------------------------------------------------------------
// Tier policy defaults. Max-width caps + byte hard-fail caps per tier.
// All overridable via config.policy or per-call opts.
// ---------------------------------------------------------------------------
const DEFAULT_TIERS = {
  hero: { max_width: 1920, max_bytes: 250 * 1024 },
  content: { max_width: 1280, max_bytes: 100 * 1024 },
  thumb: { max_width: 640, max_bytes: 50 * 1024 },
};
const DEFAULT_TIER = 'content';
const DEFAULT_QUALITY = 80;

// Resolve the effective tier table, applying any config/opts overrides over the
// defaults. config.policy.tiers / opts.tiers may override max_width / max_bytes
// per tier; unspecified fields fall back to the default for that tier.
function resolveTiers({ config, tiers } = {}) {
  const fromConfig = (config && config.policy && config.policy.tiers) || {};
  const override = tiers || {};
  const out = {};
  for (const name of Object.keys(DEFAULT_TIERS)) {
    out[name] = {
      max_width: pickNum(
        override[name] && override[name].max_width,
        fromConfig[name] && fromConfig[name].max_width,
        DEFAULT_TIERS[name].max_width
      ),
      max_bytes: pickNum(
        override[name] && override[name].max_bytes,
        fromConfig[name] && fromConfig[name].max_bytes,
        DEFAULT_TIERS[name].max_bytes
      ),
    };
  }
  return out;
}

function pickNum(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function resolveQuality({ config, quality } = {}) {
  return pickNum(
    quality,
    config && config.policy && config.policy.quality,
    DEFAULT_QUALITY
  );
}

// ---------------------------------------------------------------------------
// Allowlist. Maps a source basename (or path) -> reason string. A source that
// busts its tier byte cap PASSES only if it is allowlisted-with-reason; the
// reason is logged on every allowlisted exception.
//
// Allowlist sources, in precedence order:
//   1. opts.allowlist  (object: { "<source-key>": "reason" })
//   2. allowlistPath JSON file: { "<source-key>": "reason" } or
//      { "entries": { "<source-key>": "reason" } }
// Source-key match is tried against the absolute path AND the basename.
// ---------------------------------------------------------------------------
function loadAllowlist({ allowlist, allowlistPath } = {}) {
  let table = {};
  if (allowlistPath) {
    try {
      const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
      table = raw && raw.entries && typeof raw.entries === 'object' ? raw.entries : raw;
    } catch {
      /* missing/invalid allowlist file -> empty (no allowlisting) */
      table = {};
    }
  }
  if (allowlist && typeof allowlist === 'object') {
    table = Object.assign({}, table, allowlist);
  }
  return table || {};
}

function allowlistReason(table, sourcePath) {
  if (!table) return null;
  const base = path.basename(sourcePath);
  if (Object.prototype.hasOwnProperty.call(table, sourcePath)) return table[sourcePath];
  if (Object.prototype.hasOwnProperty.call(table, base)) return table[base];
  return null;
}

// ---------------------------------------------------------------------------
// Mechanical transparency detection. Reads the source's ACTUAL alpha via sharp
// metadata (hasAlpha). Not a guess. Returns { hasAlpha, width, height, format }.
// ---------------------------------------------------------------------------
async function probeSource(sharp, inputPath) {
  const meta = await sharp(inputPath).metadata();
  return {
    hasAlpha: !!meta.hasAlpha,
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || null,
  };
}

// Compute the target width for a tier: never upscale. If source width exceeds
// the tier cap, downscale to the cap; otherwise keep the source width.
function targetWidthForTier(sourceWidth, tierCap) {
  if (!sourceWidth || sourceWidth <= 0) return tierCap;
  return sourceWidth > tierCap ? tierCap : sourceWidth;
}

function deriveName(sourcePath, width, ext) {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return `${base}-${width}.${ext}`;
}

// ---------------------------------------------------------------------------
// avifenc availability (graceful). --also-avif degrades to a logged skip when
// avifenc is absent.
// ---------------------------------------------------------------------------
function avifencAvailable() {
  return whichBinary('avifenc') !== null;
}

function pngquantAvailable() {
  return whichBinary('pngquant') !== null;
}

// Encode one source under the policy. Pure-ish: writes the derivative(s) to
// outDir and returns a structured record (NOT yet manifest-committed; the caller
// commits + enforces caps). sharp is injected so tests/callers share one path.
async function encodePolicy({ sharp, sourcePath, rel, outDir, tierName, tier, quality, alsoAvif, log }) {
  const probe = await probeSource(sharp, sourcePath);
  const targetWidth = targetWidthForTier(probe.width, tier.max_width);
  const downscaled = probe.width > tier.max_width;

  // Preserve the source's relative subdir structure under outDir (prevents
  // same-named files in different subdirs from colliding, and matches the deploy
  // layout). `rel` defaults to the basename for the single-file path.
  const relDir = rel ? path.dirname(rel) : '.';
  const destDir = path.join(outDir, relDir);
  fs.mkdirSync(destDir, { recursive: true });

  // ---- WebP primary (lossy, alpha-aware, metadata stripped) ----
  const webpName = deriveName(sourcePath, targetWidth, 'webp');
  const webpPath = path.join(destDir, webpName);

  // sharp pipeline: resize ONLY when downscaling (never upscale -> withoutEnlargement
  // is belt-and-suspenders; we already clamp width to <= source). No .withMetadata()
  // call => sharp strips EXIF/ICC/etc by default. WebP keeps alpha automatically
  // when the source has it.
  let pipeline = sharp(sourcePath);
  if (downscaled) {
    pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true });
  }
  const webpInfo = await pipeline.webp({ quality, alphaQuality: 100 }).toFile(webpPath);

  const record = {
    source_path: sourcePath,
    source_width: probe.width,
    source_height: probe.height,
    source_format: probe.format,
    source_has_alpha: probe.hasAlpha,
    tier: tierName,
    target_width: targetWidth,
    downscaled,
    quality,
    derivative_path: webpPath,
    width: webpInfo.width,
    height: webpInfo.height,
    bytes: fs.statSync(webpPath).size,
    has_alpha: !!webpInfo.hasAlpha || probe.hasAlpha,
    encoder: 'sharp',
    encoder_version: require('sharp/package.json').version,
  };

  // ---- pngquant PNG-retain fallback (alpha sources only; optional) ----
  // The alpha-WebP path above is the DEFAULT and works without pngquant. The
  // pngquant path only produces an *additional* quantized PNG for the case a PNG
  // must be retained. If pngquant is absent we detect-and-skip gracefully.
  record.png_fallback = null;
  if (probe.hasAlpha) {
    if (pngquantAvailable()) {
      try {
        const { execFileSync } = require('child_process');
        // First produce a (possibly downscaled) PNG via sharp, then quantize it.
        const pngName = deriveName(sourcePath, targetWidth, 'png');
        const pngPath = path.join(destDir, pngName);
        let pp = sharp(sourcePath);
        if (downscaled) pp = pp.resize({ width: targetWidth, withoutEnlargement: true });
        await pp.png().toFile(pngPath);
        // pngquant in place (overwrite) with stripped metadata.
        execFileSync('pngquant', ['--force', '--strip', '--output', pngPath, '--', pngPath], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        record.png_fallback = {
          derivative_path: pngPath,
          bytes: fs.statSync(pngPath).size,
          encoder: 'pngquant',
        };
      } catch (err) {
        if (log) log(`  [png-fallback] pngquant failed for ${sourcePath}: ${err.message} (skipped)`);
        record.png_fallback = null;
      }
    } else if (log) {
      log(`  [png-fallback] pngquant absent — skipping PNG retain path (alpha-WebP is the default and is present)`);
    }
  }

  // ---- AVIF optional (additional derivative, never sole asset) ----
  record.avif = null;
  if (alsoAvif) {
    if (avifencAvailable()) {
      try {
        const { execFileSync } = require('child_process');
        // Produce a (possibly downscaled) intermediate PNG, then avifenc -> AVIF.
        // avifenc strips metadata by default; we pass --ignore-exif/--ignore-xmp
        // defensively where supported (older builds ignore unknown flags via the
        // try/catch graceful degrade).
        const tmpPng = path.join(destDir, deriveName(sourcePath, targetWidth, 'avif.src.png'));
        let ap = sharp(sourcePath);
        if (downscaled) ap = ap.resize({ width: targetWidth, withoutEnlargement: true });
        await ap.png().toFile(tmpPng);
        const avifName = deriveName(sourcePath, targetWidth, 'avif');
        const avifPath = path.join(destDir, avifName);
        execFileSync('avifenc', ['-q', String(quality), tmpPng, avifPath], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        try { fs.unlinkSync(tmpPng); } catch { /* best effort */ }
        record.avif = {
          derivative_path: avifPath,
          bytes: fs.statSync(avifPath).size,
          encoder: 'avifenc',
        };
      } catch (err) {
        if (log) log(`  [also-avif] avifenc failed for ${sourcePath}: ${err.message} (skipped)`);
        record.avif = null;
      }
    } else if (log) {
      log(`  [also-avif] avifenc absent — --also-avif degrades to a logged skip (WebP remains the asset)`);
    }
  }

  return record;
}

// ---------------------------------------------------------------------------
// Top-level policy run. Enumerates sources, encodes each under the resolved
// tier, enforces the tiered byte hard-fail cap (with allowlist), and emits a
// policy-extended DerivativeManifest. Returns a structured result; throws only
// on a true fail-closed (sharp absent). Cap violations are reported as failures
// in the result (and the caller/CLI maps them to a non-zero exit).
//
// opts: {
//   srcPath, outDir, manifestPath, now(),
//   tier (default 'content'), tiers (override table), quality,
//   alsoAvif (bool), allowlist (obj), allowlistPath (str),
//   tierBySource ({ "<key>": "hero" }), config, sharp?, log?
// }
// ---------------------------------------------------------------------------
async function optimizePolicy(opts) {
  const {
    srcPath,
    outDir,
    manifestPath,
    now,
    tier: defaultTierName = DEFAULT_TIER,
    tierBySource = {},
    alsoAvif = false,
    config = null,
    log = () => {},
  } = opts;

  if (typeof now !== 'function') {
    throw new Error('optimizePolicy() requires a now() function for deterministic timestamps');
  }

  // sharp is the resize-capable adapter. FAIL CLOSED if absent (same posture as
  // S0's no-encoder fail-closed).
  const sharp = opts.sharp || (moduleResolvable('sharp') ? require('sharp') : null);
  if (!sharp) {
    const err = new Error(
      'image-optimize: FAIL CLOSED — the policy engine (S1) requires the sharp node module for ' +
        'resize+encode. Install it (npm i sharp). The S0 minimal path can still run with cwebp.'
    );
    err.code = 'NO_RESIZE_ENCODER';
    throw err;
  }

  const tiers = resolveTiers({ config, tiers: opts.tiers });
  const quality = resolveQuality({ config, quality: opts.quality });
  const allowlist = loadAllowlist({ allowlist: opts.allowlist, allowlistPath: opts.allowlistPath });

  const sources = enumerateSources(srcPath);
  const manifest = loadManifest(manifestPath);

  const result = {
    policy: 'ImageOptimizePolicy/1.0',
    tiers,
    quality,
    also_avif: !!alsoAvif,
    total: sources.length,
    encoded: 0,
    failed: 0,
    allowlisted: 0,
    items: [],
    failures: [],
  };

  for (const { abs: sourcePath, rel } of sources) {
    const tierName =
      tierBySource[sourcePath] ||
      tierBySource[path.basename(sourcePath)] ||
      defaultTierName;
    const tier = tiers[tierName];
    if (!tier) {
      throw new Error(`unknown tier "${tierName}" for ${sourcePath} (valid: ${Object.keys(tiers).join(', ')})`);
    }

    const rec = await encodePolicy({
      sharp,
      sourcePath,
      rel,
      outDir,
      tierName,
      tier,
      quality,
      alsoAvif,
      log,
    });

    // ---- Tiered hard-fail cap enforcement (policy gate) ----
    const overCap = rec.bytes > tier.max_bytes;
    const reason = overCap ? allowlistReason(allowlist, sourcePath) : null;

    const sourceSha = sha256File(sourcePath);
    const derivSha = sha256File(rec.derivative_path);

    // Policy-extended manifest entry (superset of the S0 entry shape + S1 fields).
    const entry = {
      source_path: sourcePath,
      source_sha256: sourceSha,
      derivative_path: rec.derivative_path,
      derivative_sha256: derivSha,
      width: rec.width,
      height: rec.height,
      bytes: rec.bytes,
      encoder: rec.encoder,
      encoder_version: rec.encoder_version,
      created_at: now(),
      // --- S1 policy fields ---
      tier: rec.tier,
      target_width: rec.target_width,
      quality: rec.quality,
      has_alpha: rec.has_alpha,
      downscaled: rec.downscaled,
    };
    if (rec.avif) {
      entry.avif = {
        derivative_path: rec.avif.derivative_path,
        derivative_sha256: sha256File(rec.avif.derivative_path),
        bytes: rec.avif.bytes,
        encoder: rec.avif.encoder,
      };
    }
    if (rec.png_fallback) {
      entry.png_fallback = {
        derivative_path: rec.png_fallback.derivative_path,
        derivative_sha256: sha256File(rec.png_fallback.derivative_path),
        bytes: rec.png_fallback.bytes,
        encoder: rec.png_fallback.encoder,
      };
    }

    manifest.entries = manifest.entries.filter((e) => e.source_path !== sourcePath);
    manifest.entries.push(entry);

    const item = {
      source: sourcePath,
      tier: rec.tier,
      source_dims: `${rec.source_width}x${rec.source_height}`,
      target_width: rec.target_width,
      downscaled: rec.downscaled,
      out_dims: `${rec.width}x${rec.height}`,
      bytes: rec.bytes,
      cap_bytes: tier.max_bytes,
      has_alpha: rec.has_alpha,
      derivative: rec.derivative_path,
      avif: rec.avif ? rec.avif.derivative_path : null,
      png_fallback: rec.png_fallback ? rec.png_fallback.derivative_path : null,
      over_cap: overCap,
      allowlisted: false,
      allowlist_reason: null,
      status: 'ok',
    };

    if (overCap) {
      if (reason) {
        item.allowlisted = true;
        item.allowlist_reason = reason;
        item.status = 'allowlisted';
        result.allowlisted += 1;
        log(
          `  [cap] ALLOWLISTED ${sourcePath} (${rec.bytes}B > ${tier.max_bytes}B cap, tier=${rec.tier}) ` +
            `reason: ${reason}`
        );
      } else {
        item.status = 'fail';
        result.failed += 1;
        const f = {
          source: sourcePath,
          tier: rec.tier,
          bytes: rec.bytes,
          cap_bytes: tier.max_bytes,
          message:
            `image-optimize: POLICY CAP FAIL — ${sourcePath} derivative is ${rec.bytes}B, over the ` +
            `${tier.max_bytes}B ${rec.tier} cap. Re-tier, lower quality, or allowlist-with-reason.`,
        };
        result.failures.push(f);
        log('  [cap] FAIL ' + f.message);
      }
    }

    result.encoded += 1;
    result.items.push(item);
  }

  if (result.encoded > 0) {
    result.manifest = writeManifest(manifestPath, manifest, now());
  } else {
    result.manifest = manifest;
  }
  result.manifest_schema = MANIFEST_SCHEMA;
  result.ok = result.failed === 0;
  return result;
}

module.exports = {
  DEFAULT_TIERS,
  DEFAULT_TIER,
  DEFAULT_QUALITY,
  resolveTiers,
  resolveQuality,
  loadAllowlist,
  allowlistReason,
  probeSource,
  targetWidthForTier,
  deriveName,
  avifencAvailable,
  pngquantAvailable,
  encodePolicy,
  optimizePolicy,
};
