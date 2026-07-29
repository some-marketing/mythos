'use strict';

// tools/image-optimize/__tests__/preflight.test.cjs
//
// S2 unit tests (node --test). Gate: verify-local.
//
// Covers the shared deploy PREFLIGHT (preflight.cjs), verification-only:
//   (1) dir with an unoptimized .png + no manifest entry ->
//         warn mode prints code 10 and exits 0; enforce mode exits 10.
//   (2) dir with only optimized .webp within caps -> passes (exit 0) both modes.
//   (3) an oversized .webp -> code 11 (warn would-be 11 / enforce exit 11).
//   (4) allowlisted raw png -> NOT flagged (no violation, exit 0 both modes).
//
// Run: node --test tools/image-optimize/__tests__/preflight.test.cjs
//
// Fixtures are generated with sharp so the suite is self-contained and
// deterministic. The preflight never re-encodes; sharp is only used here to
// MAKE the fixtures.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sharp = require('sharp');
const pre = require('../preflight.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'imgopt-s2-'));
}

// A tiny config with small caps so fixtures stay small but still exercise the
// oversize path. hero cap deliberately tiny (2KB) for test (3) to force OVERSIZE.
function writeConfig(dir, heroBytes) {
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      schema: 'ImageOptimizeConfig/1.0',
      encoder_preference: ['sharp'],
      policy: {
        quality: 80,
        tiers: {
          hero: { max_width: 1920, max_bytes: heroBytes },
          content: { max_width: 1280, max_bytes: heroBytes },
          thumb: { max_width: 640, max_bytes: heroBytes },
        },
      },
    }) + '\n'
  );
  return cfgPath;
}

async function makePng(p, w = 64, h = 64) {
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toFile(p);
}

// A webp of a known small size (well under a generous cap).
async function makeSmallWebp(p, w = 64, h = 64) {
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 60, b: 90 } } })
    .webp({ quality: 80 })
    .toFile(p);
}

// A noisy webp large enough to bust a tiny cap.
async function makeNoisyWebp(p, w = 600, h = 600) {
  const channels = 3;
  const buf = Buffer.alloc(w * h * channels);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 1103515245 + 12345) & 0xff;
  await sharp(buf, { raw: { width: w, height: h, channels } }).webp({ quality: 90 }).toFile(p);
}

// An empty manifest at a path (no entries) — the preflight tolerates a missing
// manifest, but an explicit empty one keeps the test hermetic.
function writeEmptyManifest(dir) {
  const mp = path.join(dir, 'derivative-manifest.json');
  fs.writeFileSync(
    mp,
    JSON.stringify({ schema: 'DerivativeManifest/1.0', generated_at: null, entries: [] }) + '\n'
  );
  return mp;
}

// A manifest that records each derivative as a real image-optimize output, i.e.
// it carries the derivative evidence the preflight requires. derivative_path
// (abs) is what the preflight matches on. source_path points at a non-existent
// file so the staleness check is skipped (we are testing evidence-present, not
// staleness). Used by tests where a deployed .webp is a LEGITIMATE optimizer
// output and must NOT be flagged as unverified.
function writeManifestForDerivatives(dir, derivativeAbsPaths, tier = 'hero') {
  const mp = path.join(dir, 'derivative-manifest.json');
  fs.writeFileSync(
    mp,
    JSON.stringify({
      schema: 'DerivativeManifest/1.0',
      generated_at: null,
      entries: derivativeAbsPaths.map((dp) => ({
        source_path: dp + '.source-not-on-disk.png',
        source_sha256: 'a'.repeat(64),
        derivative_path: dp,
        derivative_sha256: 'b'.repeat(64),
        tier,
        width: 64,
        height: 64,
        bytes: 0,
        encoder: 'sharp',
        encoder_version: 'test',
        created_at: null,
      })),
    }) + '\n'
  );
  return mp;
}

test('(1) unoptimized .png with no manifest entry -> code 10; warn exits 0, enforce exits 10', async () => {
  const root = tmpDir();
  const deploy = path.join(root, 'public');
  fs.mkdirSync(deploy, { recursive: true });
  await makePng(path.join(deploy, 'hero.png'));
  const configPath = writeConfig(root, 1024 * 1024);
  const manifestPath = writeEmptyManifest(root);

  const warn = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'warn' });
  assert.equal(warn.exit_code, 0, 'warn mode always exits 0');
  assert.equal(warn.would_be_exit, pre.EXIT.UNOPTIMIZED_RASTER, 'would-be code is 10');
  const v = warn.findings.filter((f) => f.code !== pre.EXIT.OK);
  assert.equal(v.length, 1);
  assert.equal(v[0].code, 10);
  assert.equal(v[0].label, 'unoptimized-raster');

  const enforce = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'enforce' });
  assert.equal(enforce.exit_code, 10, 'enforce exits 10 on the unoptimized raster');
});

test('(2) only optimized .webp within caps -> passes (exit 0) in both modes', async () => {
  const root = tmpDir();
  const deploy = path.join(root, 'public');
  fs.mkdirSync(deploy, { recursive: true });
  await makeSmallWebp(path.join(deploy, 'logo.webp'));
  const configPath = writeConfig(root, 1024 * 1024); // generous cap
  // Legitimate optimizer output -> has manifest evidence, so not unverified.
  const manifestPath = writeManifestForDerivatives(root, [path.join(deploy, 'logo.webp')]);

  const warn = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'warn' });
  assert.equal(warn.ok, true, 'no violations');
  assert.equal(warn.exit_code, 0);

  const enforce = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'enforce' });
  assert.equal(enforce.exit_code, 0, 'enforce passes when within caps');
  assert.equal(enforce.findings.filter((f) => f.code !== pre.EXIT.OK).length, 0);
});

test('(3) oversized .webp -> code 11', async () => {
  const root = tmpDir();
  const deploy = path.join(root, 'public');
  fs.mkdirSync(deploy, { recursive: true });
  const wp = path.join(deploy, 'big.webp');
  await makeNoisyWebp(wp);
  const bytes = fs.statSync(wp).size;
  assert.ok(bytes > 2048, `fixture webp should exceed the tiny cap (got ${bytes}B)`);
  const configPath = writeConfig(root, 2048); // tiny hero cap forces oversize
  // Give it manifest evidence so the ONLY violation is oversize (code 11), not
  // also unverified (code 10) — isolates the oversized assertion.
  const manifestPath = writeManifestForDerivatives(root, [wp]);

  const warn = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'warn' });
  assert.equal(warn.exit_code, 0, 'warn always exits 0');
  assert.equal(warn.would_be_exit, pre.EXIT.OVERSIZED_DERIVATIVE, 'would-be code is 11');
  const v = warn.findings.filter((f) => f.code !== pre.EXIT.OK);
  assert.equal(v.length, 1);
  assert.equal(v[0].code, 11);
  assert.equal(v[0].label, 'oversized-derivative');

  const enforce = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'enforce' });
  assert.equal(enforce.exit_code, 11, 'enforce exits 11 on the oversized derivative');
});

test('(4) allowlisted raw png -> NOT flagged (exit 0 both modes)', async () => {
  const root = tmpDir();
  const deploy = path.join(root, 'public');
  fs.mkdirSync(deploy, { recursive: true });
  await makePng(path.join(deploy, 'keepme.png'));
  const configPath = writeConfig(root, 1024 * 1024);
  const manifestPath = writeEmptyManifest(root);

  const allowlistPath = path.join(root, 'allowlist.json');
  fs.writeFileSync(
    allowlistPath,
    JSON.stringify({ 'keepme.png': 'favicon source kept intentionally for test' }) + '\n'
  );

  const warn = pre.runPreflight({ dir: deploy, manifestPath, configPath, allowlistPath, mode: 'warn' });
  assert.equal(warn.ok, true, 'allowlisted raster is not a violation');
  assert.equal(warn.exit_code, 0);
  const allow = warn.findings.find((f) => f.allowlisted);
  assert.ok(allow, 'an allowlisted note is recorded');
  assert.equal(allow.allowlist_reason, 'favicon source kept intentionally for test');

  const enforce = pre.runPreflight({ dir: deploy, manifestPath, configPath, allowlistPath, mode: 'enforce' });
  assert.equal(enforce.exit_code, 0, 'enforce passes when the raster is allowlisted');
});

test('(5) .webp with NO manifest evidence -> unverified (code 10); warn exits 0, enforce exits 10; allowlist clears it', async () => {
  // Regression for codex S2 MAJOR#2: a derivative with no manifest entry is not
  // proven to be an image-optimize output, so enforce mode must not false-pass it.
  const root = tmpDir();
  const deploy = path.join(root, 'public');
  fs.mkdirSync(deploy, { recursive: true });
  await makeSmallWebp(path.join(deploy, 'mystery.webp')); // within caps, but no evidence
  const configPath = writeConfig(root, 1024 * 1024); // generous cap (so only the evidence gap bites)
  const manifestPath = writeEmptyManifest(root); // no entry for mystery.webp

  const warn = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'warn' });
  assert.equal(warn.exit_code, 0, 'warn always exits 0');
  const v = warn.findings.filter((f) => f.code !== pre.EXIT.OK);
  assert.equal(v.length, 1);
  assert.equal(v[0].code, pre.EXIT.UNOPTIMIZED_RASTER);
  assert.equal(v[0].label, 'unverified-derivative');

  const enforce = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'enforce' });
  assert.equal(enforce.exit_code, 10, 'enforce fails an unverified derivative (no false-pass)');

  // Allowlist-with-reason clears it.
  const allowlistPath = path.join(root, 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify({ 'mystery.webp': 'pre-optimized brand asset' }) + '\n');
  const allowed = pre.runPreflight({ dir: deploy, manifestPath, configPath, allowlistPath, mode: 'enforce' });
  assert.equal(allowed.exit_code, 0, 'allowlisted unverified derivative passes enforce');
});

test('(S4) framework-manifest caps override changes the effective cap', async () => {
  // A .webp that passes the config default cap but busts a TIGHTER per-framework
  // cap declared in a framework manifest's image_optimization.caps block. Proves
  // the preflight reads the override and that it changes the effective ceiling.
  const root = tmpDir();
  const deploy = path.join(root, 'public');
  fs.mkdirSync(deploy, { recursive: true });
  const wp = path.join(deploy, 'banner.webp');
  await makeNoisyWebp(wp);
  const bytes = fs.statSync(wp).size;
  assert.ok(bytes > 2048, `fixture webp should exceed the tight override cap (got ${bytes}B)`);

  // Generous config default cap (well above the fixture) so config ALONE passes it.
  const configPath = writeConfig(root, 1024 * 1024);
  // Manifest evidence so the only possible violation is the override cap, not
  // an unverified-derivative finding.
  const manifestPath = writeManifestForDerivatives(root, [wp], 'hero');

  // Sanity: with NO framework manifest, the generous config cap -> no violation.
  const baseline = pre.runPreflight({ dir: deploy, manifestPath, configPath, mode: 'enforce' });
  assert.equal(baseline.exit_code, 0, 'generous config default cap passes the fixture');

  // Now a framework manifest with a TIGHT hero cap (2KB) -> the same fixture is OVERSIZED.
  const fwManifestPath = path.join(root, 'framework-manifest.json');
  fs.writeFileSync(
    fwManifestPath,
    JSON.stringify({
      service_category: 'wordpress',
      framework_name: 'test-fw',
      image_optimization: {
        status: 'recommended',
        caps: { hero: 2048, content: 2048, thumb: 2048 },
        caps_provenance: 'test-artifact',
        effective_from: '2026-06-17',
      },
    }) + '\n'
  );

  // capsFromFrameworkManifest returns a tiers override.
  const override = pre.capsFromFrameworkManifest(fwManifestPath);
  assert.deepEqual(override, {
    hero: { max_bytes: 2048 },
    content: { max_bytes: 2048 },
    thumb: { max_bytes: 2048 },
  });

  const enforced = pre.runPreflight({
    dir: deploy,
    manifestPath,
    configPath,
    frameworkManifestPath: fwManifestPath,
    mode: 'enforce',
  });
  assert.equal(enforced.exit_code, 11, 'tighter framework cap makes the derivative OVERSIZED (code 11)');
  const v = enforced.findings.filter((f) => f.code !== pre.EXIT.OK);
  assert.equal(v.length, 1);
  assert.equal(v[0].code, 11);
  assert.equal(v[0].cap_bytes, 2048, 'effective cap is the framework override, not the config default');

  // A manifest with no image_optimization block -> no override (null).
  const bareManifest = path.join(root, 'bare.json');
  fs.writeFileSync(bareManifest, JSON.stringify({ framework_name: 'bare' }) + '\n');
  assert.equal(pre.capsFromFrameworkManifest(bareManifest), null);
  // Missing/invalid manifest path -> null (degrade to config defaults, no throw).
  assert.equal(pre.capsFromFrameworkManifest('/nonexistent/manifest.json'), null);
});

test('enforce precedence: missing-encoder (12) outranks oversize/unoptimized', () => {
  // A non-existent dir triggers the code-12 path; enforce must surface 12.
  const report = pre.runPreflight({ dir: '/nonexistent/deploy/dir/xyz', mode: 'enforce' });
  assert.equal(report.exit_code, 12);
  assert.equal(report.findings[0].code, 12);
});
