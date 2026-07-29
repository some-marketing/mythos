'use strict';

// tools/image-optimize/lib/engine.cjs
//
// Core engine for the Mythos image-optimization standard (slice S0).
//
// Responsibilities (S0 only):
//   - Resolve the operator-configured encoder preference order (config + env).
//   - Select the first AVAILABLE, WebP-capable adapter (vendor-agnostic).
//   - FAIL CLOSED if none is available (the caller exits non-zero).
//   - Maintain a derivative manifest keyed by source sha256 for idempotency:
//       re-running on unchanged inputs whose derivative still exists is a no-op.
//   - Emit manifest entries conforming to derivative-manifest.schema.json.
//
// Out of S0 scope (do NOT add here): sizing tiers, transparency policy, hard
// caps, AVIF/pngquant routing, deploy preflight, framework gates, storage
// guardrails. Those are S1–S5.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ALL_ADAPTERS, adapterById, detectCapabilities } = require('./adapters.cjs');

const MANIFEST_SCHEMA = 'DerivativeManifest/1.0';
const DEFAULT_QUALITY = 80; // S0 default; full quality policy is S1.

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Resolve the effective encoder preference order.
//   1. IMAGE_OPTIMIZE_ENCODER_ORDER env (comma-separated ids) wins if set.
//   2. else config.encoder_preference.
//   3. else the registry declaration order.
function resolveEncoderOrder({ config, env = process.env } = {}) {
  const raw = (env.IMAGE_OPTIMIZE_ENCODER_ORDER || '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (config && Array.isArray(config.encoder_preference) && config.encoder_preference.length) {
    return config.encoder_preference.slice();
  }
  return ALL_ADAPTERS.map((a) => a.id);
}

// Pick the first adapter in preference order that is available AND can produce
// WebP. `adapters` is injectable for tests (e.g. an all-unavailable set).
function selectEncoder({ order, adapters = ALL_ADAPTERS }) {
  const byId = new Map(adapters.map((a) => [a.id, a]));
  for (const id of order) {
    const a = byId.get(id);
    if (!a) continue;
    if (a.supports_webp === false) continue;
    if (a.is_available()) return a;
  }
  return null;
}

function loadConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function loadManifest(manifestPath) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m && m.schema === MANIFEST_SCHEMA && Array.isArray(m.entries)) return m;
  } catch {
    /* fall through */
  }
  return { schema: MANIFEST_SCHEMA, generated_at: null, entries: [] };
}

function writeManifest(manifestPath, manifest, now) {
  const out = {
    schema: MANIFEST_SCHEMA,
    generated_at: now,
    entries: manifest.entries,
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(out, null, 2) + '\n');
  return out;
}

// Mechanical source-file enumeration. S0 handles PNG/JPEG sources -> WebP.
const SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg']);

// Recursively collect every PNG/JPEG under `dir` (skipping VCS/deps dirs),
// mirroring preflight.cjs walkFiles. Returns absolute paths.
function walkSources(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // Skip VCS / deps dirs — consistent with the deploy preflight.
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      out.push(...walkSources(full));
    } else if (ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

// Enumerate source files as { abs, rel } pairs. `rel` is the path of the source
// RELATIVE to the src root, so callers can mirror the nested subdir structure in
// the output (preventing collisions between same-named files in different
// subdirs). When srcPath is a single file, rel is just its basename and the
// recursion is skipped (current S0 single-file behavior preserved).
function enumerateSources(srcPath) {
  const stat = fs.statSync(srcPath);
  if (stat.isFile()) {
    return SOURCE_EXTS.has(path.extname(srcPath).toLowerCase())
      ? [{ abs: srcPath, rel: path.basename(srcPath) }]
      : [];
  }
  const root = srcPath;
  return walkSources(root)
    .map((abs) => ({ abs, rel: path.relative(root, abs) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

// Derive the output path, preserving the source's relative subdir structure
// under outDir. `rel` is the source path relative to the src root; only its
// extension is swapped for .webp, so <root>/brand/x.png -> <out>/brand/x.webp.
function deriveOutputPath(rel, outDir) {
  const dir = path.dirname(rel);
  const base = path.basename(rel, path.extname(rel));
  return path.join(outDir, dir, `${base}.webp`);
}

function findManifestEntry(manifest, sourcePath, sourceSha) {
  return manifest.entries.find(
    (e) => e.source_path === sourcePath && e.source_sha256 === sourceSha
  );
}

// Run the optimize pass.
//   opts: { srcPath, outDir, manifestPath, quality, now(), adapters?, order? }
// Returns a result summary including counts so callers/tests can assert that a
// second run performed zero encodes.
async function optimize(opts) {
  const {
    srcPath,
    outDir,
    manifestPath,
    quality = DEFAULT_QUALITY,
    now,
    adapters = ALL_ADAPTERS,
    order,
    config,
  } = opts;

  if (typeof now !== 'function') {
    throw new Error('optimize() requires a now() function for deterministic timestamps');
  }

  const effectiveOrder =
    order || resolveEncoderOrder({ config: config || null, env: opts.env || process.env });

  const encoder = selectEncoder({ order: effectiveOrder, adapters });

  // FAIL CLOSED — no usable encoder. (async fn -> this surfaces as a rejected
  // promise, consistent with every other failure path.)
  if (!encoder) {
    const caps = detectCapabilities(adapters);
    const err = new Error(
      'image-optimize: FAIL CLOSED — no usable WebP encoder is available on this surface. ' +
        'Install at least one of: cwebp (brew install webp), or the sharp node module (npm i sharp), ' +
        'or imagemagick (brew install imagemagick). ' +
        'Detected: ' +
        caps.map((c) => `${c.id}=${c.available ? 'available' : 'absent'}`).join(', ') +
        '.'
    );
    err.code = 'NO_ENCODER';
    throw err;
  }

  const sources = enumerateSources(srcPath);
  const manifest = loadManifest(manifestPath);

  const result = {
    encoder: encoder.id,
    encoder_version: encoder.version(),
    total: sources.length,
    encoded: 0,
    skipped: 0,
    items: [],
  };

  let promiseChain = Promise.resolve();

  for (const { abs: sourcePath, rel } of sources) {
    const sourceSha = sha256File(sourcePath);
    const outPath = deriveOutputPath(rel, outDir);
    const existing = findManifestEntry(manifest, sourcePath, sourceSha);

    // Idempotent skip: source hash unchanged AND derivative present on disk.
    if (existing && fs.existsSync(existing.derivative_path)) {
      result.skipped += 1;
      result.items.push({ source: sourcePath, action: 'skip', derivative: existing.derivative_path });
      continue;
    }

    promiseChain = promiseChain.then(async () => {
      // Create the (possibly nested) output dir for this derivative.
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const dims = await encoder.encode_webp({ inputPath: sourcePath, outputPath: outPath, quality });
      const derivSha = sha256File(outPath);
      const bytes = fs.statSync(outPath).size;
      const entry = {
        source_path: sourcePath,
        source_sha256: sourceSha,
        derivative_path: outPath,
        derivative_sha256: derivSha,
        width: dims.width,
        height: dims.height,
        bytes,
        encoder: encoder.id,
        encoder_version: result.encoder_version,
        created_at: now(),
      };
      // Replace any stale entry for this source_path, then append.
      manifest.entries = manifest.entries.filter((e) => e.source_path !== sourcePath);
      manifest.entries.push(entry);
      result.encoded += 1;
      result.items.push({ source: sourcePath, action: 'encode', derivative: outPath, bytes });
    });
  }

  return promiseChain.then(() => {
    // Only rewrite the manifest if anything changed (keep re-runs a true no-op
    // on disk too — generated_at does not churn on a pure skip pass).
    if (result.encoded > 0) {
      result.manifest = writeManifest(manifestPath, manifest, now());
    } else {
      result.manifest = manifest;
    }
    return result;
  });
}

module.exports = {
  MANIFEST_SCHEMA,
  DEFAULT_QUALITY,
  sha256File,
  resolveEncoderOrder,
  selectEncoder,
  loadConfig,
  loadManifest,
  writeManifest,
  enumerateSources,
  deriveOutputPath,
  optimize,
};
