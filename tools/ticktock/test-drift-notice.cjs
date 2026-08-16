#!/usr/bin/env node
'use strict';

// tools/ticktock/test-drift-notice.cjs -- acceptance tests for the two-part
// engine-drift gate (review finding F2) and for environment identity capture
// (review finding F5's caveat).
//
// The defect: engine source digests were recorded and never compared, so an
// engine edit that this one 300-tick trajectory does not exercise passed as
// identical with nothing said about it. The repair is NOT "halt on digest
// change" -- that fires on comment edits and trains readers to ignore the
// detector. It is a second, non-fatal signal alongside the behavioral gate.
//
// So the two things worth testing are exactly the two halves of that claim:
//   1. a source change that does NOT change behavior is REPORTED (not silent)
//   2. and does NOT halt (not fatal)
//
// The test runs against a COPY of the engine, which incidentally re-runs F5's
// different-path control. The copy is made inside tools/ticktock/ rather than
// in the system temp directory on purpose: F5 observed that a copied engine
// fails without its dependency context, and a copy under the repo resolves
// node_modules by the ordinary upward walk. That is itself the finding, kept
// visible rather than worked around silently.
//
// Run: node tools/ticktock/test-drift-notice.cjs

const fs = require('fs');
const path = require('path');

const benchmark = require('./run-benchmark.js');

const COPY_ROOT = path.join(__dirname, '.drift-test-engine');
const SOURCE_ROOT = benchmark.DEFAULT_ENGINE_ROOT;

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${detail === undefined ? '' : JSON.stringify(detail)}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

function cleanup() {
  fs.rmSync(COPY_ROOT, { recursive: true, force: true });
}

process.on('exit', cleanup);
cleanup();
fs.cpSync(SOURCE_ROOT, COPY_ROOT, { recursive: true });

// ---------------------------------------------------------------------------
section('1. A byte-identical copy at a DIFFERENT PATH: no drift, no divergence');
// ---------------------------------------------------------------------------
{
  const { result } = benchmark.check({ engineRoot: COPY_ROOT });
  check('the copied engine reproduces the fingerprint', result.identical === true, result.diverging_dimensions);
  check('no source drift is reported for an unmodified copy', result.source_drift.detected === false, result.source_drift.changed_files);
  check('the absolute path difference does not register as drift', result.drift_detected === false, result.drift_notice);
  check('environment identity is COMPARABLE, not merely absent', result.environment_drift.comparable === true, result.environment_drift);
  check('no environment drift against the recorded baseline', result.environment_drift.detected === false, result.environment_drift.changed);
  check('no dependency failed to resolve', (result.environment_drift.unresolved_dependencies || []).length === 0, result.environment_drift.unresolved_dependencies);
}

// ---------------------------------------------------------------------------
section('2. THE F2 DEFECT: a behavior-neutral source edit must be REPORTED');
// ---------------------------------------------------------------------------
{
  // A comment. The canonical false-positive case, and the exact edit the
  // original "never compare" position was chosen to avoid firing on. It should
  // now produce a NOTICE and nothing more.
  const target = path.join(COPY_ROOT, 'untrained-network.js');
  fs.appendFileSync(target, '\n// a comment added by test-drift-notice.cjs -- changes no decision\n');

  const { result } = benchmark.check({ engineRoot: COPY_ROOT });

  check('the comment edit does NOT change behavior', result.identical === true, result.diverging_dimensions);
  check('drift IS detected (the old code was silent here -- this is the defect)', result.drift_detected === true);
  check('the changed file is named', result.source_drift.changed_files.some((f) => f.path === 'untrained-network.js'), result.source_drift.changed_files);
  check('exactly one file is reported as changed', result.source_drift.changed_files.length === 1, result.source_drift.changed_files);
  check('the notice is a NOTICE', result.drift_severity === 'NOTICE' && result.source_drift.severity === 'NOTICE');

  check('drift does NOT halt the run', result.halt === false);
  check('drift does NOT set a halt_state', result.halt_state === null);
  check('drift does NOT flip identical', result.identical === true);
  check('the notice states what a digest change does not prove', /does not prove|does_not_prove/.test(JSON.stringify(result.source_drift.meaning)));
  check('the notice flags the identical-but-drifted case as the one worth reading', /trajectory does not exercise/.test(result.drift_notice || ''), result.drift_notice);
}

// ---------------------------------------------------------------------------
section('3. Real edits this trajectory does NOT exercise -- the gap F2 is about');
// ---------------------------------------------------------------------------
{
  // These are not contrived. Both constants are live code, and neither is
  // reachable under the benchmark's own configuration:
  //
  //   TRAIL_FOLLOW_PROB  the spec pins trail_follow_prob in world_params, and
  //                      liveConfig overrides the module constant, so editing
  //                      the constant changes nothing this run does.
  //   LEARNING_RATE      with --freeze-hive-learning (the F1 repair) no weight
  //                      is written at all, so the rate it would have been
  //                      written at is inert -- an honest consequence of
  //                      freezing worth stating out loud.
  //
  // Before the F2 repair, editing either produced identical: true and total
  // silence. Now it produces identical: true AND a notice. That difference is
  // the whole finding.
  for (const [constant, replacement] of [
    ['const TRAIL_FOLLOW_PROB = 0.8;', 'const TRAIL_FOLLOW_PROB = 0.5;'],
    ['const LEARNING_RATE = 0.05;', 'const LEARNING_RATE = 0.5;']
  ]) {
    cleanup();
    fs.cpSync(SOURCE_ROOT, COPY_ROOT, { recursive: true });
    const target = path.join(COPY_ROOT, 'untrained-network.js');
    const src = fs.readFileSync(target, 'utf8');
    if (!src.includes(constant)) { check(`the probe constant "${constant}" still exists`, false); continue; }
    fs.writeFileSync(target, src.replace(constant, replacement));

    const { result } = benchmark.check({ engineRoot: COPY_ROOT });
    check(`${constant.split(' ')[1]}: the behavioral gate does not fire (this trajectory never reaches it)`, result.identical === true, result.diverging_dimensions);
    check(`${constant.split(' ')[1]}: the edit is nonetheless REPORTED`, result.drift_detected === true && result.source_drift.changed_files.some((f) => f.path === 'untrained-network.js'));
    check(`${constant.split(' ')[1]}: and the run is not halted for it`, result.halt === false);
  }
}

// ---------------------------------------------------------------------------
section('4. A source change that DOES change behavior: both signals fire');
// ---------------------------------------------------------------------------
{
  // RESOURCE_NORM_K feeds encodeState() on every decision of every tick, so it
  // is genuinely on the trajectory -- the behavioral gate must be the thing
  // that halts here, with the drift notice riding alongside.
  cleanup();
  fs.cpSync(SOURCE_ROOT, COPY_ROOT, { recursive: true });
  const target = path.join(COPY_ROOT, 'untrained-network.js');
  const src = fs.readFileSync(target, 'utf8');
  check('the probe constant RESOURCE_NORM_K still exists', src.includes('const RESOURCE_NORM_K = 20;'));
  fs.writeFileSync(target, src.replace('const RESOURCE_NORM_K = 20;', 'const RESOURCE_NORM_K = 21;'));

  const { result } = benchmark.check({ engineRoot: COPY_ROOT });
  check('the behavioral gate halts', result.identical === false && result.halt === true, result.diverging_dimensions);
  check('halt_state is BENCHMARK-DIVERGENCE, from BEHAVIOR not from the digest', result.halt_state === 'BENCHMARK-DIVERGENCE');
  check('a first diverging tick is attributed', Number.isInteger(result.first_diverging_tick), result.first_diverging_tick);
  check('the drift notice also fires and names the file', result.source_drift.changed_files.some((f) => f.path === 'untrained-network.js'));
  check('the notice points at the changed files as the place to look', /first place to look/.test(result.drift_notice || ''), result.drift_notice);
}

// ---------------------------------------------------------------------------
section('5. A missing engine file is drift too, not an absence');
// ---------------------------------------------------------------------------
{
  const recorded = JSON.parse(fs.readFileSync(benchmark.DEFAULT_FINGERPRINT_PATH, 'utf8'));
  const observed = JSON.parse(JSON.stringify(recorded));
  observed.engine.files = observed.engine.files.filter((f) => f.path !== 'harness.js');
  const drift = benchmark.compareSourceDrift(recorded, observed);
  check('a removed engine file is reported', drift.detected === true && drift.removed_files.includes('harness.js'), drift);

  const observed2 = JSON.parse(JSON.stringify(recorded));
  observed2.engine.files.push({ path: 'new-file.js', sha256: 'f'.repeat(64) });
  const drift2 = benchmark.compareSourceDrift(recorded, observed2);
  check('an added engine file is reported', drift2.detected === true && drift2.added_files.includes('new-file.js'), drift2);
}

// ---------------------------------------------------------------------------
section('6. F5: environment differences are reported, and an absent baseline is not agreement');
// ---------------------------------------------------------------------------
{
  const recorded = JSON.parse(fs.readFileSync(benchmark.DEFAULT_FINGERPRINT_PATH, 'utf8'));
  check('the recorded fingerprint pins node version', typeof recorded.environment.node_version === 'string' && recorded.environment.node_version === process.version);
  check('the recorded fingerprint pins platform and arch', recorded.environment.platform === process.platform && recorded.environment.arch === process.arch);
  check('the recorded fingerprint pins engine dependency identity', Array.isArray(recorded.environment.engine_dependencies) && recorded.environment.engine_dependencies.length > 0, recorded.environment.engine_dependencies);
  check('every recorded dependency carries a version', recorded.environment.engine_dependencies.every((d) => typeof d.version === 'string' && d.version.length > 0));

  const otherNode = JSON.parse(JSON.stringify(recorded));
  otherNode.environment.node_version = 'v18.0.0';
  otherNode.environment.node_major = 18;
  const envDrift = benchmark.compareEnvironmentDrift(recorded, otherNode);
  check('a different Node version is reported as drift', envDrift.detected === true && envDrift.changed.some((c) => c.field === 'node_version'), envDrift);
  check('the environment notice is non-fatal', envDrift.meaning.severity === 'NOTICE, never a halt.');

  const otherDep = JSON.parse(JSON.stringify(recorded));
  otherDep.environment.engine_dependencies = otherDep.environment.engine_dependencies.map((d) => ({ ...d, version: '0.0.0-different' }));
  const depDrift = benchmark.compareEnvironmentDrift(recorded, otherDep);
  check('a different dependency version is reported as drift', depDrift.detected === true && depDrift.changed.some((c) => c.field.startsWith('dependency:')), depDrift.changed);

  const legacy = JSON.parse(JSON.stringify(recorded));
  delete legacy.environment;
  const legacyDrift = benchmark.compareEnvironmentDrift(legacy, recorded);
  check('a baseline with NO environment block reports not-comparable rather than agreement', legacyDrift.comparable === false && /nothing to compare/.test(legacyDrift.reason), legacyDrift);
}

// ---------------------------------------------------------------------------
section('7. DEFECT D3: dependency discovery is recursive, and says what it misses');
// ---------------------------------------------------------------------------
//
// The defect: engineDependencies() read only the TOP-LEVEL .js/.cjs files and
// only literal require() calls, while the block it fed was presented as
// environment identity. An adversarial probe walked through it twice -- a
// require nested in a subdirectory, and a computed require(name) -- and neither
// showed up anywhere in the output.
//
// The tests below are written against a PURPOSE-BUILT fixture tree rather than
// the real engine, because the real engine currently has neither a nested
// third-party require nor a dynamic one: asserting against it would pass on the
// old shallow code too, and prove nothing.
{
  const os = require('os');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-depscan-'));
  fs.writeFileSync(path.join(fixture, 'top.js'), "const path = require('path');\nconst Ajv = require('ajv');\n");
  fs.mkdirSync(path.join(fixture, 'nested', 'deeper'), { recursive: true });
  // 1. The nested miss: a real dependency two directories down.
  fs.writeFileSync(path.join(fixture, 'nested', 'deeper', 'engine-part.js'), "const Ajv2020 = require('ajv/dist/2020');\n");
  // 2. The dynamic miss: a specifier no static scan can resolve.
  fs.writeFileSync(path.join(fixture, 'nested', 'dynamic.cjs'), "const name = process.env.ENGINE_PLUGIN;\nconst mod = require(name);\nconst other = require(`${name}-extra`);\n");
  // 3. An .mjs file with a static import, which the old regex never looked at.
  fs.writeFileSync(path.join(fixture, 'nested', 'esm.mjs'), "import Ajv from 'ajv';\nimport { readFile } from 'node:fs/promises';\n");
  // 3b. DEFECT D5: dynamic import(). The computed form was counted by nothing
  //     at all, and the literal parenthesised form resolved to nothing, while
  //     does_not_cover claimed computed import() specifiers were counted.
  fs.writeFileSync(path.join(fixture, 'nested', 'dyn-import.mjs'),
    "const name = process.env.ENGINE_PLUGIN;\n"
    + "const mod = await import(name);\n"
    + "const other = await import(`${name}-extra`);\n"
    // A literal specifier that appears NOWHERE else in the fixture, so finding
    // it can only be the dynamic-import reader doing the work.
    + "const literal = await import('literal-dynamic-import-only-pkg');\n");
  // 4. node_modules must NOT be walked -- that is a different scan entirely.
  fs.mkdirSync(path.join(fixture, 'node_modules', 'decoy'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'node_modules', 'decoy', 'index.js'), "require('this-package-does-not-exist');\n");

  const deps = benchmark.engineDependencies(fixture);
  const names = deps.resolved.map((d) => d.name).concat(deps.unresolved.map((d) => d.name));

  check('the scan declares itself recursive', deps.scan.recursive === true, deps.scan);
  check('a NESTED require is found (the D3 miss)', names.includes('ajv'), names);
  check('the nested file was actually read', deps.scan.files_scanned === 5, deps.scan.files_scanned);
  check('an .mjs static import is found', deps.scan.extensions.includes('.mjs'), deps.scan.extensions);
  check('node_modules is NOT walked', !names.includes('this-package-does-not-exist'), names);
  check('node_modules is reported as deliberately skipped', deps.scan.skipped.some((s) => s.path.includes('node_modules')), deps.scan.skipped);

  check('dynamic requires are COUNTED, not silently dropped', deps.scan.dynamic_require_count === 2, deps.scan);
  check('every dynamic require site is named by file and line', deps.scan.dynamic_require_sites.length === 2
    && deps.scan.dynamic_require_sites.every((s) => typeof s.file === 'string' && Number.isInteger(s.line)), deps.scan.dynamic_require_sites);
  check('the dynamic sites point at the right file', deps.scan.dynamic_require_sites.every((s) => s.file.endsWith('dynamic.cjs')), deps.scan.dynamic_require_sites);

  // DEFECT D5. The probe that walked through the D3 repair: a fixture whose
  // only computed specifiers are import(), which returned dynamic_require_count
  // 0 and recorded no site, under a does_not_cover that claimed import() was
  // counted. Each check below fails on the pre-D5 code.
  check('computed dynamic import() calls are COUNTED', deps.scan.dynamic_import_count === 2, deps.scan);
  check('every dynamic import site is named by file and line',
    Array.isArray(deps.scan.dynamic_import_sites) && deps.scan.dynamic_import_sites.length === 2
    && deps.scan.dynamic_import_sites.every((s) => typeof s.file === 'string' && Number.isInteger(s.line)), deps.scan.dynamic_import_sites);
  check('the dynamic import sites point at the right file',
    deps.scan.dynamic_import_sites.every((s) => s.file.endsWith('dyn-import.mjs')), deps.scan.dynamic_import_sites);
  check('the two counts are kept separate, not merged into one another',
    deps.scan.dynamic_require_count === 2 && deps.scan.dynamic_import_count === 2, deps.scan);
  check('a LITERAL dynamic import("pkg") is read as a real dependency rather than vanishing',
    names.includes('literal-dynamic-import-only-pkg'), names);

  // The honesty half: the block must state its own reach.
  check('the scan states what it covers', typeof deps.scan.covers === 'string' && deps.scan.covers.length > 0);
  check('the scan states what it does NOT cover', Array.isArray(deps.scan.does_not_cover) && deps.scan.does_not_cover.length >= 3, deps.scan.does_not_cover);
  check('transitive package-internal dependencies are named as uncovered',
    deps.scan.does_not_cover.some((s) => /[Tt]ransitive/.test(s)), deps.scan.does_not_cover);
  check('computed specifiers are named as uncovered',
    deps.scan.does_not_cover.some((s) => /[Cc]omputed/.test(s)), deps.scan.does_not_cover);
  // DEFECT D5 was a does_not_cover line claiming more than the code detected.
  // Each uncovered-specifier claim must now name the field that actually backs
  // it, and that field must exist in the scan block.
  check('the computed-require claim names the field that backs it, and that field exists',
    deps.scan.does_not_cover.some((s) => /[Cc]omputed require/.test(s) && s.includes('dynamic_require_count'))
    && typeof deps.scan.dynamic_require_count === 'number', deps.scan.does_not_cover);
  check('the computed-import claim names the field that backs it, and that field exists',
    deps.scan.does_not_cover.some((s) => /[Cc]omputed import/.test(s) && s.includes('dynamic_import_count'))
    && typeof deps.scan.dynamic_import_count === 'number', deps.scan.does_not_cover);
  check('covers names dynamic import() only because dynamic import() is read',
    /dynamic import/.test(deps.scan.covers) && names.includes('literal-dynamic-import-only-pkg'), deps.scan.covers);

  // An unresolvable engine root still returns a scan block rather than a
  // half-shaped object the caller has to guess at.
  const missing = benchmark.engineDependencies(path.join(fixture, 'no-such-dir'));
  check('a missing engine root returns a scan block with an error', missing.scan.error !== undefined && missing.scan.files_scanned === 0, missing.scan);

  fs.rmSync(fixture, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
section('8. DEFECT D3: the recorded block does not overstate itself');
// ---------------------------------------------------------------------------
{
  const env = benchmark.environmentIdentity(COPY_ROOT);
  check('the fingerprint carries the scan coverage, not just the results', env.engine_dependency_scan !== undefined, Object.keys(env));
  check('the note explicitly disclaims completeness', /NOT a completeness claim/.test(env.note), env.note);
  check('the real engine tree is scanned recursively, well past its top level',
    env.engine_dependency_scan.files_scanned > 20, env.engine_dependency_scan.files_scanned);

  // The comparison surface must carry the caveat too: a reader who sees
  // `detected: false` should not be able to read it as "the environments matched".
  const recorded = JSON.parse(fs.readFileSync(benchmark.DEFAULT_FINGERPRINT_PATH, 'utf8'));
  const observed = JSON.parse(JSON.stringify(recorded));
  observed.environment = env;
  const drift = benchmark.compareEnvironmentDrift(recorded, observed);
  check('no drift is reported against the baseline after the recursive change', drift.detected === false, drift.changed);
  check('the comparison carries a scan-coverage caveat', typeof drift.scan_coverage.caveat === 'string' && drift.scan_coverage.caveat.length > 0, drift.scan_coverage);

  // DEFECT D5 on the comparison surface: the caveat read dynamic_require_count
  // alone, so a tree whose only computed specifiers were import() was described
  // as having no dynamic sites at all.
  const importOnly = JSON.parse(JSON.stringify(observed));
  importOnly.environment.engine_dependency_scan.dynamic_require_count = 0;
  importOnly.environment.engine_dependency_scan.dynamic_import_count = 3;
  const importOnlyDrift = benchmark.compareEnvironmentDrift(recorded, importOnly);
  check('a tree whose only computed specifiers are import() is not described as having none',
    /3 computed import\(\) site/.test(importOnlyDrift.scan_coverage.caveat)
    && !/no computed/.test(importOnlyDrift.scan_coverage.caveat), importOnlyDrift.scan_coverage.caveat);

  // A scan block recorded before import() counting existed must say so rather
  // than let a 0 stand in for "none".
  const preImportCount = JSON.parse(JSON.stringify(observed));
  delete preImportCount.environment.engine_dependency_scan.dynamic_import_count;
  const preImportDrift = benchmark.compareEnvironmentDrift(recorded, preImportCount);
  check('a scan block predating import() counting reports that reach as unknown',
    /unknown/.test(preImportDrift.scan_coverage.caveat), preImportDrift.scan_coverage.caveat);
  check('the meaning block denies that agreement means identical environments',
    /does not prove the environments were the same/.test(drift.meaning.does_not_prove), drift.meaning.does_not_prove);

  // A baseline recorded before coverage reporting must say the reach is
  // unknown, not imply it was complete.
  const legacyObserved = JSON.parse(JSON.stringify(observed));
  delete legacyObserved.environment.engine_dependency_scan;
  const legacyDrift = benchmark.compareEnvironmentDrift(recorded, legacyObserved);
  check('a pre-coverage block reports its reach as unknown', /unknown/.test(legacyDrift.scan_coverage.caveat), legacyDrift.scan_coverage);
}

// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
