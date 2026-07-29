'use strict';

// tools/image-optimize/__tests__/image-optimize.test.cjs
//
// S0 unit tests (node --test). Gate: verify-local.
//
// Covers:
//   (a) adapter capability detection returns the real local truth
//   (b) FAIL CLOSED when no adapter is available (forced-unavailable set)
//   (c) idempotency — second run on unchanged input performs zero encodes
//   (d) manifest conforms to the schema and has the correct source_sha256
//
// Timestamps are injected via a deterministic now() so fixtures stay stable.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const adapters = require('../lib/adapters.cjs');
const engine = require('../lib/engine.cjs');

const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'sample.png');
const SCHEMA = require('../derivative-manifest.schema.json');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'imgopt-test-'));
}

function fixedNowFactory(startIso) {
  // Returns a now() that increments by 1s each call — deterministic, distinct.
  let t = new Date(startIso).getTime();
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

// Minimal draft-07-ish validator covering the constraints this schema uses
// (type, required, additionalProperties:false, const, pattern, integer/min).
// Avoids adding an ajv dependency for an S0 foundation test.
function validateAgainstSchema(data, schema, root = schema, errPath = '$') {
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
      if (typeof d !== 'object' || d === null || Array.isArray(d)) {
        errors.push(`${p}: expected object`);
        return;
      }
      for (const req of sch.required || []) {
        if (!(req in d)) errors.push(`${p}: missing required "${req}"`);
      }
      if (sch.additionalProperties === false) {
        for (const k of Object.keys(d)) {
          if (!sch.properties || !(k in sch.properties)) errors.push(`${p}: unexpected property "${k}"`);
        }
      }
      for (const [k, v] of Object.entries(d)) {
        if (sch.properties && sch.properties[k]) check(v, sch.properties[k], `${p}.${k}`);
      }
    } else if (sch.type === 'array') {
      if (!Array.isArray(d)) {
        errors.push(`${p}: expected array`);
        return;
      }
      d.forEach((item, i) => check(item, sch.items, `${p}[${i}]`));
    } else if (sch.type === 'string') {
      if (typeof d !== 'string') errors.push(`${p}: expected string`);
      else {
        if (sch.const !== undefined && d !== sch.const) errors.push(`${p}: expected const "${sch.const}"`);
        if (sch.pattern && !new RegExp(sch.pattern).test(d)) errors.push(`${p}: fails pattern ${sch.pattern}`);
      }
    } else if (sch.type === 'integer') {
      if (!Number.isInteger(d)) errors.push(`${p}: expected integer`);
      else if (sch.minimum !== undefined && d < sch.minimum) errors.push(`${p}: below minimum ${sch.minimum}`);
    }
  }
  check(data, schema, errPath);
  return errors;
}

// ---------------------------------------------------------------------------
// (a) Capability detection returns the real local truth.
// ---------------------------------------------------------------------------
test('capability detection reports real local truth', () => {
  const caps = adapters.detectCapabilities();
  const byId = Object.fromEntries(caps.map((c) => [c.id, c]));

  // sharp is a repo node module -> must be available and resolvable.
  assert.strictEqual(byId.sharp.available, true, 'sharp should be available (node module present)');

  // The reported truth must match an independent mechanical probe per adapter.
  for (const c of caps) {
    const adapter = adapters.adapterById(c.id);
    assert.strictEqual(c.available, !!adapter.is_available(), `${c.id} availability must match is_available()`);
  }

  // Available adapters must report a non-null version; absent ones null.
  for (const c of caps) {
    if (c.available) assert.ok(typeof c.version === 'string' && c.version.length > 0, `${c.id} version`);
    else assert.strictEqual(c.version, null, `${c.id} absent -> null version`);
  }
});

// ---------------------------------------------------------------------------
// (b) FAIL CLOSED when no adapter is available.
// ---------------------------------------------------------------------------
test('fails closed when no encoder is available', async () => {
  const dead = [
    { id: 'cwebp', binary: 'cwebp', is_available: () => false, version: () => 'x', encode_webp: () => { throw new Error('nope'); } },
    { id: 'sharp', binary: null, is_available: () => false, version: () => 'x', encode_webp: () => { throw new Error('nope'); } },
  ];
  const dir = tmpDir();
  await assert.rejects(
    () =>
      engine.optimize({
        srcPath: FIXTURE_PNG,
        outDir: path.join(dir, 'out'),
        manifestPath: path.join(dir, 'manifest.json'),
        adapters: dead,
        order: ['cwebp', 'sharp'],
        now: fixedNowFactory('2026-06-17T00:00:00.000Z'),
      }),
    (err) => {
      assert.strictEqual(err.code, 'NO_ENCODER');
      assert.match(err.message, /FAIL CLOSED/);
      return true;
    }
  );
  // Never silently produced bytes.
  assert.strictEqual(fs.existsSync(path.join(dir, 'out')), false, 'no output dir should be created on fail-closed');
});

// ---------------------------------------------------------------------------
// (c) Idempotency — second run on unchanged input performs zero encodes.
// (d) Manifest conforms to schema + has correct source_sha256.
// ---------------------------------------------------------------------------
test('idempotent skip-by-source-hash + schema-conforming manifest', async () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'out');
  const manifestPath = path.join(dir, 'manifest.json');

  // Run 1: fresh -> exactly one encode.
  const r1 = await engine.optimize({
    srcPath: FIXTURE_PNG,
    outDir,
    manifestPath,
    now: fixedNowFactory('2026-06-17T10:00:00.000Z'),
  });
  assert.strictEqual(r1.total, 1, 'one source file');
  assert.strictEqual(r1.encoded, 1, 'first run encodes');
  assert.strictEqual(r1.skipped, 0, 'first run skips nothing');

  // Manifest exists and conforms to schema.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errs = validateAgainstSchema(manifest, SCHEMA);
  assert.deepStrictEqual(errs, [], 'manifest must conform to schema: ' + errs.join('; '));
  assert.strictEqual(manifest.schema, 'DerivativeManifest/1.0');
  assert.strictEqual(manifest.entries.length, 1);

  // source_sha256 must equal an independent sha256 of the fixture bytes.
  const expectedSha = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_PNG)).digest('hex');
  assert.strictEqual(manifest.entries[0].source_sha256, expectedSha, 'manifest source_sha256 correct');

  // Derivative actually exists and is smaller than the source.
  const entry = manifest.entries[0];
  assert.ok(fs.existsSync(entry.derivative_path), 'derivative exists');
  const srcBytes = fs.statSync(FIXTURE_PNG).size;
  assert.ok(entry.bytes < srcBytes, `webp (${entry.bytes}) should be < png (${srcBytes})`);
  assert.ok(entry.width > 0 && entry.height > 0, 'dimensions recorded');

  // Run 2: unchanged input -> zero encodes, all skipped, manifest untouched.
  const manifestBefore = fs.readFileSync(manifestPath, 'utf8');
  const r2 = await engine.optimize({
    srcPath: FIXTURE_PNG,
    outDir,
    manifestPath,
    now: fixedNowFactory('2026-06-17T20:00:00.000Z'),
  });
  assert.strictEqual(r2.encoded, 0, 'second run performs ZERO encodes');
  assert.strictEqual(r2.skipped, 1, 'second run skips the unchanged source');
  const manifestAfter = fs.readFileSync(manifestPath, 'utf8');
  assert.strictEqual(manifestAfter, manifestBefore, 'no-op run must not rewrite the manifest (incl. generated_at)');
});

// ---------------------------------------------------------------------------
// Bonus: changed source bytes force a re-encode (idempotency key is the hash).
// ---------------------------------------------------------------------------
test('changed source content triggers re-encode', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'in.png');
  fs.copyFileSync(FIXTURE_PNG, src);
  const outDir = path.join(dir, 'out');
  const manifestPath = path.join(dir, 'manifest.json');

  const r1 = await engine.optimize({ srcPath: src, outDir, manifestPath, now: fixedNowFactory('2026-06-17T00:00:00.000Z') });
  assert.strictEqual(r1.encoded, 1);

  // Mutate the source bytes (append a chunk -> different sha256).
  const sharp = require('sharp');
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  fs.writeFileSync(src, buf);

  const r2 = await engine.optimize({ srcPath: src, outDir, manifestPath, now: fixedNowFactory('2026-06-18T00:00:00.000Z') });
  assert.strictEqual(r2.encoded, 1, 'changed bytes -> re-encode');
  assert.strictEqual(r2.skipped, 0);
});

// ---------------------------------------------------------------------------
// Nested source tree: enumerateSources must RECURSE and the output must PRESERVE
// the relative subdir structure (two same-named files in different subdirs must
// NOT collide). Re-run on the nested tree must be a true no-op (zero encodes).
// ---------------------------------------------------------------------------
test('nested src tree: recurse, preserve subdirs (no collision), idempotent', async () => {
  const dir = tmpDir();
  const src = path.join(dir, 'src');
  // sub-a/x.png and sub-b/x.png share a basename but live in different subdirs;
  // a flattening optimizer would collide them. top.png lives at the root.
  fs.mkdirSync(path.join(src, 'sub-a'), { recursive: true });
  fs.mkdirSync(path.join(src, 'sub-b'), { recursive: true });
  fs.copyFileSync(FIXTURE_PNG, path.join(src, 'sub-a', 'x.png'));
  fs.copyFileSync(FIXTURE_PNG, path.join(src, 'sub-b', 'x.png'));
  fs.copyFileSync(FIXTURE_PNG, path.join(src, 'top.png'));

  const outDir = path.join(dir, 'out');
  const manifestPath = path.join(dir, 'manifest.json');

  const r1 = await engine.optimize({
    srcPath: src,
    outDir,
    manifestPath,
    now: fixedNowFactory('2026-06-17T00:00:00.000Z'),
  });
  assert.strictEqual(r1.total, 3, 'recursion finds all 3 nested sources');
  assert.strictEqual(r1.encoded, 3, 'all 3 encoded on first run');

  // Outputs preserve the subdir structure and DO NOT collide.
  const outA = path.join(outDir, 'sub-a', 'x.webp');
  const outB = path.join(outDir, 'sub-b', 'x.webp');
  const outTop = path.join(outDir, 'top.webp');
  assert.ok(fs.existsSync(outA), 'sub-a/x.webp present');
  assert.ok(fs.existsSync(outB), 'sub-b/x.webp present');
  assert.ok(fs.existsSync(outTop), 'top.webp present');
  // No flattened collision artifact at the out root for the subdir files.
  assert.strictEqual(
    fs.existsSync(path.join(outDir, 'x.webp')),
    false,
    'no flattened x.webp at out root (would mean a collision)'
  );

  // Re-run on the unchanged nested tree = ZERO encodes.
  const r2 = await engine.optimize({
    srcPath: src,
    outDir,
    manifestPath,
    now: fixedNowFactory('2026-06-18T00:00:00.000Z'),
  });
  assert.strictEqual(r2.encoded, 0, 're-run on nested tree performs ZERO encodes');
  assert.strictEqual(r2.skipped, 3, 're-run skips all 3');
});
