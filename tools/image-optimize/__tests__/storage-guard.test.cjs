'use strict';

// tools/image-optimize/__tests__/storage-guard.test.cjs
//
// S3 unit tests (node --test). Gate: verify-local. NO live connection — every
// remote df reading is INJECTED. NOTHING is deleted unless --apply / apply:true
// is passed explicitly.
//
// Run: node --test tools/image-optimize/__tests__/storage-guard.test.cjs

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sg = require('../storage-guard.cjs');

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `imgopt-s3-${tag || ''}-`));
}

// A healthy `df -Pk` reading: ~40GB free on a 75GB box (40 * 1024 * 1024 1K-blocks).
const HEALTHY_DF =
  'Filesystem     1024-blocks      Used Available Capacity Mounted on\n' +
  '/dev/sda1         78643200  36000000  41943040      47% /\n';

// A low-free reading: ~3GB free -> below the 10GB default threshold.
const LOW_DF =
  'Filesystem     1024-blocks      Used Available Capacity Mounted on\n' +
  '/dev/sda1         78643200  75497472   3145728      96% /\n';

// A reading where the filesystem name wrapped onto its own line (df WITHOUT -P).
// The parser must stitch it.
const WRAPPED_DF =
  'Filesystem            1024-blocks      Used Available Capacity Mounted on\n' +
  '/dev/mapper/very-long-volume-name-that-wraps\n' +
  '                         78643200  36000000  41943040      47% /\n';

// ---------------------------------------------------------------------------
// (1) df parser / quota preflight
// ---------------------------------------------------------------------------
test('(1a) healthy df reading -> ok, no abort (injected, no live connection)', () => {
  const res = sg.dfQuotaPreflight({ dfOutput: HEALTHY_DF });
  assert.equal(res.ok, true);
  assert.equal(res.abort, false);
  assert.equal(res.reading.filesystem, '/dev/sda1');
  assert.ok(res.reading.available_gb > 39 && res.reading.available_gb < 41, `~40GB, got ${res.reading.available_gb}`);
  assert.equal(res.min_free_gb, 10);
});

test('(1b) low-free reading -> abort (deploy must not proceed)', () => {
  const res = sg.dfQuotaPreflight({ dfOutput: LOW_DF });
  assert.equal(res.abort, true, 'below 10GB threshold -> abort');
  assert.equal(res.ok, false);
  assert.match(res.reason, /below the 10GB threshold/);
});

test('(1c) configurable threshold: 2GB min lets the 3GB reading pass', () => {
  const res = sg.dfQuotaPreflight({ dfOutput: LOW_DF, minFreeGb: 2 });
  assert.equal(res.abort, false, '3GB free clears a 2GB threshold');
  assert.equal(res.ok, true);
});

test('(1d) injected runner (DI seam) is used when no dfOutput given', () => {
  let called = false;
  const runDf = ({ command }) => {
    called = true;
    assert.ok(command && command.remote_command.startsWith('df -Pk'), 'runner receives the composed command');
    return HEALTHY_DF;
  };
  const res = sg.dfQuotaPreflight({ runDf });
  assert.equal(called, true, 'the injected runner was invoked (no live connection)');
  assert.equal(res.abort, false);
});

test('(1e) no reading + no runner -> FAIL SAFE abort (never silent pass)', () => {
  const res = sg.dfQuotaPreflight({});
  assert.equal(res.abort, true);
  assert.equal(res.ok, false);
  assert.match(res.reason, /failing safe: ABORT/);
});

test('(1f) wrapped df line is stitched and parsed', () => {
  const reading = sg.parseDfPk(WRAPPED_DF);
  assert.equal(reading.filesystem, '/dev/mapper/very-long-volume-name-that-wraps');
  assert.equal(reading.available_1k, 41943040);
});

test('(1g) empty df output throws (treated as abort by the CLI)', () => {
  assert.throws(() => sg.parseDfPk(''), /empty df output/);
});

test('(1h) remote df command is composed (df -Pk), not run', () => {
  const cmd = sg.buildRemoteDfCommand({ remoteDir: '.' });
  assert.equal(cmd.remote_command, 'df -Pk .');
  assert.ok(cmd.shell.includes('PubkeyAuthentication=no'), 'matches sftp-deploy auth posture');
  assert.ok(cmd.shell.includes('${ADPORTAL_FTPS_USER}@${ADPORTAL_FTPS_HOST}'));
});

// ---------------------------------------------------------------------------
// (2) originals-never-on-VPS check
// ---------------------------------------------------------------------------
test('(2a) deploy set with a .png original -> not ok (originals-present)', () => {
  const dir = tmpDir('orig');
  fs.writeFileSync(path.join(dir, 'logo.webp'), 'webp-bytes');
  fs.writeFileSync(path.join(dir, 'hero.png'), 'png-original-bytes');
  const res = sg.originalsCheck({ dir });
  assert.equal(res.ok, false);
  assert.equal(res.originals.length, 1);
  assert.equal(res.originals[0].rel, 'hero.png');
  assert.equal(res.derivatives, 1);
});

test('(2b) deploy set with only derivatives -> ok', () => {
  const dir = tmpDir('deriv');
  fs.writeFileSync(path.join(dir, 'a.webp'), 'x');
  fs.writeFileSync(path.join(dir, 'b.avif'), 'y');
  const res = sg.originalsCheck({ dir });
  assert.equal(res.ok, true);
  assert.equal(res.originals.length, 0);
  assert.equal(res.derivatives, 2);
});

// ---------------------------------------------------------------------------
// (3) retention: current + exactly one rollback bundle
// ---------------------------------------------------------------------------
test('(3a) 3 timestamp bundles -> keeps current+1, lists 1 prunable; dry-run deletes nothing', () => {
  const dir = tmpDir('ret');
  const bundles = ['20260101T000000Z', '20260102T000000Z', '20260103T000000Z'];
  for (const b of bundles) fs.mkdirSync(path.join(dir, b));

  const res = sg.retention({ bundlesDir: dir }); // apply defaults false
  assert.equal(res.applied, false);
  assert.equal(res.retained.length, 2, 'current + 1 previous retained');
  assert.equal(res.prunable.length, 1, 'oldest is prunable');
  assert.equal(path.basename(res.prunable[0]), '20260101T000000Z', 'oldest flagged');
  assert.equal(res.pruned.length, 0, 'dry-run deletes nothing');
  // all bundles still on disk
  for (const b of bundles) assert.ok(fs.existsSync(path.join(dir, b)), `${b} still present after dry-run`);
});

test('(3b) --apply removes ONLY the oldest bundle', () => {
  const dir = tmpDir('ret-apply');
  const bundles = ['20260101T000000Z', '20260102T000000Z', '20260103T000000Z'];
  for (const b of bundles) fs.mkdirSync(path.join(dir, b));

  const res = sg.retention({ bundlesDir: dir, apply: true });
  assert.equal(res.applied, true);
  assert.equal(res.pruned.length, 1);
  assert.ok(!fs.existsSync(path.join(dir, '20260101T000000Z')), 'oldest removed');
  assert.ok(fs.existsSync(path.join(dir, '20260102T000000Z')), 'previous retained');
  assert.ok(fs.existsSync(path.join(dir, '20260103T000000Z')), 'current retained');
});

// ---------------------------------------------------------------------------
// (4) orphan-prune against the current manifest
// ---------------------------------------------------------------------------
test('(4a) a derivative not in the manifest -> orphan; dry-run deletes nothing; --apply removes it', () => {
  const dir = tmpDir('orphan');
  const referenced = path.join(dir, 'kept-960.webp');
  const orphan = path.join(dir, 'stale-960.webp');
  fs.writeFileSync(referenced, 'kept');
  fs.writeFileSync(orphan, 'stale');

  const manifestPath = path.join(dir, 'derivative-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schema: 'DerivativeManifest/1.0',
      generated_at: '2026-06-17T00:00:00Z',
      entries: [{ source_path: '/src/kept.png', derivative_path: referenced }],
    }) + '\n'
  );

  // dry-run
  const dry = sg.orphanPrune({ dir, manifestPath });
  assert.equal(dry.applied, false);
  assert.equal(dry.referenced, 1);
  assert.equal(dry.orphans.length, 1);
  assert.equal(dry.orphans[0].rel, 'stale-960.webp');
  assert.equal(dry.pruned.length, 0);
  assert.ok(fs.existsSync(orphan), 'dry-run left the orphan on disk');

  // apply
  const applied = sg.orphanPrune({ dir, manifestPath, apply: true });
  assert.equal(applied.pruned.length, 1);
  assert.ok(!fs.existsSync(orphan), 'orphan removed under --apply');
  assert.ok(fs.existsSync(referenced), 'referenced derivative untouched');
});

test('(4b) avif + png_fallback sub-records are treated as referenced (not orphaned)', () => {
  const dir = tmpDir('orphan-sub');
  const webp = path.join(dir, 'x-960.webp');
  const avif = path.join(dir, 'x-960.avif');
  fs.writeFileSync(webp, 'w');
  fs.writeFileSync(avif, 'a');
  const manifestPath = path.join(dir, 'derivative-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schema: 'DerivativeManifest/1.0',
      generated_at: null,
      entries: [{ source_path: '/s/x.png', derivative_path: webp, avif: { derivative_path: avif } }],
    }) + '\n'
  );
  const res = sg.orphanPrune({ dir, manifestPath });
  assert.equal(res.orphans.length, 0, 'avif sub-record counts as referenced');
  assert.equal(res.referenced, 2);
});

// ---------------------------------------------------------------------------
// (5) deploy evidence JSON shape
// ---------------------------------------------------------------------------
test('(5) evidence JSON shape is correct (totals, largest, counts, skipped originals)', () => {
  const dir = tmpDir('evid');
  fs.writeFileSync(path.join(dir, 'small.webp'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'big.webp'), Buffer.alloc(5000));
  fs.writeFileSync(path.join(dir, 'orig.png'), Buffer.alloc(2000));

  const ev = sg.deployEvidence({ dir, now: () => '2026-06-17T00:00:00Z' });
  assert.equal(ev.schema, 'ImageDeployEvidence/1.0');
  assert.equal(ev.generated_at, '2026-06-17T00:00:00Z');
  assert.equal(ev.image_count, 3);
  assert.equal(ev.derivative_count, 2);
  assert.equal(ev.original_count, 1);
  assert.equal(ev.total_image_bytes, 7100);
  assert.equal(ev.largest_image.rel, 'big.webp');
  assert.equal(ev.largest_image.bytes, 5000);
  assert.equal(ev.skipped_originals.length, 1);
  assert.equal(ev.skipped_originals[0].rel, 'orig.png');
});
