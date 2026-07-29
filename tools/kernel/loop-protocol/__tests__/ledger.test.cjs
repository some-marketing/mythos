#!/usr/bin/env node
'use strict';

/**
 * ledger.test.cjs — W3 acceptance tests. Runnable via plain node (no framework):
 *   node tools/kernel/loop-protocol/__tests__/ledger.test.cjs
 *
 * Proves:
 *   - ledger append / read / findLayer
 *   - ledger-ratchet.cjs REFUSES without --operator-confirm and writes a signed
 *     reclassify entry WITH it
 *   - iteration-cap hard-stops at 0 (never negative; isExhausted flips)
 *   - reconcile.cjs flags an unbacked down-layer as drift, and treats an
 *     operator-signed reclassify as a legitimate override (bonus coverage)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ledger = require('../ledger.js');
const itercap = require('../iteration-cap.js');

const RATCHET = path.join(__dirname, '..', 'ledger-ratchet.cjs');
const RECONCILE = path.join(__dirname, '..', 'reconcile.cjs');
const MANIFEST_PATH = path.join(__dirname, '..', 'protected-path-manifest.json');

let passed = 0;
function ok(label) {
  passed++;
  process.stdout.write(`  ok - ${label}\n`);
}

// --- isolated test instances (unique so parallel builders don't collide) ---
const stamp = Date.now();
const INST = `__test-ledger-${stamp}`;
const CAP_INST = `__test-itercap-${stamp}`;
const RECON_INST = `__test-reconcile-${stamp}`;

function cleanup() {
  for (const inst of [INST, CAP_INST, RECON_INST]) {
    for (const f of [
      ledger.ledgerPath(inst),
      itercap.capPath(inst),
      itercap.auditPath(inst),
    ]) {
      try { fs.rmSync(f, { force: true }); } catch (_) {}
    }
  }
  // remove a manifest ONLY if this test authored it (W1 owns the real one)
  if (wroteManifest && fs.existsSync(MANIFEST_PATH)) {
    try { fs.rmSync(MANIFEST_PATH, { force: true }); } catch (_) {}
  }
}

let wroteManifest = false;

function run() {
  cleanup();

  // ============================================================= ledger core
  assert.deepStrictEqual(ledger.read(INST), [], 'fresh instance reads empty');
  assert.strictEqual(ledger.findLayer(INST, 'a/b.js'), null, 'unknown path -> null layer');
  ok('read()/findLayer() on empty ledger');

  const e1 = ledger.append(INST, {
    path: 'tools/kernel/hooks/pretool.cjs',
    layer: 'L1',
    classified_by: { actor: 'codex', harness: 'codex-cli', family: 'openai' },
    change_ref: 'sha-aaa',
  });
  assert.strictEqual(e1.layer, 'L1');
  assert.ok(typeof e1.ts === 'string' && e1.ts.length > 0, 'append stamps ts');
  ok('append() stamps ts + returns entry');

  ledger.append(INST, {
    path: 'frameworks/{CLIENT_CODE}/perf/copy.md',
    layer: 'L0.5',
    classified_by: { actor: 'gemini', harness: 'gemini-cli', family: 'google' },
  });
  const entries = ledger.read(INST);
  assert.strictEqual(entries.length, 2, 'read() returns 2 entries');
  ok('read() returns appended entries in order');

  assert.strictEqual(
    ledger.findLayer(INST, 'tools/kernel/hooks/pretool.cjs'),
    'L1',
    'findLayer returns recorded L1'
  );
  assert.strictEqual(
    ledger.findLayer(INST, 'frameworks/{CLIENT_CODE}/perf/copy.md'),
    'L0.5',
    'findLayer returns recorded L0.5'
  );
  ok('findLayer() resolves recorded layers');

  // latest-wins for findLayer
  ledger.append(INST, {
    path: 'frameworks/{CLIENT_CODE}/perf/copy.md',
    layer: 'L0',
    classified_by: { actor: 'claude', harness: 'claude-code', family: 'anthropic' },
  });
  assert.strictEqual(
    ledger.findLayer(INST, 'frameworks/{CLIENT_CODE}/perf/copy.md'),
    'L0',
    'findLayer returns latest entry layer'
  );
  ok('findLayer() returns latest (effective) layer');

  // append validation
  assert.throws(() => ledger.append(INST, { path: 'x', layer: 'LZ', classified_by: { actor: 'a', harness: 'h', family: 'f' } }), /layer must be one of/);
  assert.throws(() => ledger.append(INST, { path: 'x', layer: 'L1', classified_by: { actor: 'a' } }), /classified_by/);
  ok('append() rejects malformed records');

  // ===================================================== ratchet operator gate
  const baseArgs = [
    RATCHET,
    '--instance', INST,
    '--path', 'tools/kernel/hooks/pretool.cjs',
    '--from', 'L1',
    '--to', 'L0',
    '--reason', 'operator vetted this hook path is inert draft-only for the test',
  ];

  // (a) refuses without --operator-confirm
  let refused = false;
  try {
    execFileSync('node', baseArgs, { stdio: 'pipe' });
  } catch (err) {
    refused = true;
    assert.ok(/operator-confirm/.test(String(err.stderr)), 'refusal cites operator-confirm');
  }
  assert.ok(refused, 'ratchet exits non-zero without --operator-confirm');
  // and it must NOT have written a reclassify entry
  assert.strictEqual(
    ledger.read(INST).filter((e) => e.kind === 'reclassify').length,
    0,
    'no reclassify entry written on refusal'
  );
  ok('ledger-ratchet REFUSES without --operator-confirm (no entry written)');

  // (b) refuses an up-layer move even WITH confirm
  let upRefused = false;
  try {
    execFileSync('node', [
      RATCHET, '--instance', INST, '--path', 'x/y.js',
      '--from', 'L0', '--to', 'L1', '--reason', 'up', '--operator-confirm',
    ], { stdio: 'pipe' });
  } catch (_) { upRefused = true; }
  assert.ok(upRefused, 'ratchet refuses non-down-layer moves');
  ok('ledger-ratchet refuses up-layer / same-layer moves');

  // (c) writes a signed reclassify entry WITH --operator-confirm
  const out = execFileSync('node', [...baseArgs, '--operator', '{OPERATOR_NAME}', '--operator-confirm'], {
    stdio: 'pipe',
  }).toString();
  assert.ok(/OK — signed reclassify/.test(out), 'ratchet reports OK');
  const reEntry = ledger.read(INST).filter((e) => e.kind === 'reclassify').pop();
  assert.ok(reEntry, 'reclassify entry exists');
  assert.strictEqual(reEntry.layer, 'L0', 'reclassify lands at L0');
  assert.strictEqual(reEntry.reclassify.from, 'L1');
  assert.strictEqual(reEntry.reclassify.confirmed, true);
  assert.ok(/^sha256:/.test(reEntry.signature), 'reclassify carries a signature');
  assert.strictEqual(
    ledger.findLayer(INST, 'tools/kernel/hooks/pretool.cjs'),
    'L0',
    'findLayer reflects operator down-layer'
  );
  ok('ledger-ratchet writes signed reclassify WITH --operator-confirm');

  // ===================================================== iteration-cap hard-stop
  itercap.init(CAP_INST, 2);
  assert.strictEqual(itercap.remaining(CAP_INST), 2, 'init sets remaining=2');
  assert.strictEqual(itercap.isExhausted(CAP_INST), false, 'not exhausted at 2');
  assert.strictEqual(itercap.decrement(CAP_INST), 1, 'decrement -> 1');
  assert.strictEqual(itercap.decrement(CAP_INST), 0, 'decrement -> 0');
  assert.strictEqual(itercap.isExhausted(CAP_INST), true, 'exhausted at 0');
  // hard stop: further decrements never go negative
  assert.strictEqual(itercap.decrement(CAP_INST), 0, 'decrement past 0 stays 0');
  assert.strictEqual(itercap.decrement(CAP_INST), 0, 'still 0 (hard stop)');
  assert.strictEqual(itercap.isExhausted(CAP_INST), true, 'remains exhausted');
  ok('iteration-cap hard-stops at 0 (never negative)');

  // re-init requires an operator token now (v3 hardening, Fable #3). CAP_INST
  // already has state from above, so this is a RE-INIT: token required.
  assert.throws(() => itercap.init(CAP_INST, 0), /requires an operator-signed token/,
    're-init without token is refused');
  itercap.init(CAP_INST, 0, { operatorToken: 'op-test-token' });
  assert.strictEqual(itercap.isExhausted(CAP_INST), true, 'init(0) exhausted');
  // n is validated before the re-init token check, so -1 still reports numeric error.
  assert.throws(() => itercap.init(CAP_INST, -1), /non-negative integer/);
  assert.throws(() => itercap.remaining('__never-initialized-xyz'), /no cap initialized/);
  ok('iteration-cap init(0)/re-init-token/validation semantics');

  // ===================================================== reconcile drift (bonus)
  // Author a throwaway manifest ONLY if W1 hasn't shipped the real one.
  if (!fs.existsSync(MANIFEST_PATH)) {
    wroteManifest = true;
    fs.writeFileSync(
      MANIFEST_PATH,
      JSON.stringify(
        {
          version: 1,
          auto_L1_globs: ['tools/kernel/hooks/**'],
          instances: { [RECON_INST]: { L0_globs: [], L05_grant_globs: [], floor_tripwire_globs: [] } },
          default: 'L1',
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  // Only run the drift assertions when the (real or throwaway) manifest classifies
  // our probe path as L1 — otherwise skip gracefully (W1's real globs may differ).
  const reconcileMod = require('../reconcile.cjs');
  const probe = 'tools/kernel/hooks/__recon_probe.cjs';
  if (reconcileMod.manifestLayer(manifest, RECON_INST, probe) === 'L1') {
    // Unbacked down-layer: ledger says L0 where manifest says L1 -> DRIFT.
    ledger.append(RECON_INST, {
      path: probe,
      layer: 'L0',
      classified_by: { actor: 'loop', harness: 'x', family: 'y' },
    });
    let drifted = false;
    try {
      execFileSync('node', [RECONCILE, '--instance', RECON_INST], { stdio: 'pipe' });
    } catch (err) {
      drifted = err.status === 2;
      assert.ok(/DRIFT DETECTED/.test(String(err.stderr)), 'reconcile reports drift');
    }
    assert.ok(drifted, 'reconcile exits 2 on unbacked down-layer drift');
    ok('reconcile flags unbacked down-layer as drift');

    // Now add an operator-signed reclassify for the SAME path -> legitimate override.
    execFileSync('node', [
      RATCHET, '--instance', RECON_INST, '--path', probe,
      '--from', 'L1', '--to', 'L0', '--reason', 'operator override for test', '--operator-confirm',
    ], { stdio: 'pipe' });
    const reconOut = execFileSync('node', [RECONCILE, '--instance', RECON_INST], {
      stdio: 'pipe',
    }).toString();
    assert.ok(/OK —/.test(reconOut), 'reconcile OK after operator reclassify');
    ok('reconcile treats operator-signed reclassify as legitimate override');
  } else {
    ok('reconcile drift test skipped (manifest globs differ) — no false failure');
  }

  cleanup();
  process.stdout.write(`\nALL PASS — ${passed} assertions/groups\n`);
}

try {
  run();
} catch (err) {
  cleanup();
  process.stderr.write(`\nFAIL: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
