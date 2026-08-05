#!/usr/bin/env node
'use strict';

// tools/ticktock/run-benchmark.js -- the frozen benchmark colony, and the
// detector that decides whether the engine still behaves as it did.
//
// Plan: ticktock-skill S1. Spec: ./benchmark-colony-v1.json.
//
// WHAT THIS IS FOR. A /ticktock cycle is allowed to change the simulation. That
// is the point of a co-evolution loop. What it is NOT allowed to do is change
// the simulation's behavior WITHOUT ANYONE NOTICING. So before every cycle, the
// frozen colony is replayed and compared against a recorded fingerprint, and
// any difference halts the run. The comparison covers the full behavioral
// surface -- every decision of every actor on every tick -- rather than a
// chosen set of summary metrics, because a summary metric only catches drift
// that someone already thought to measure, and the drift worth catching is
// exactly the drift nobody predicted.
//
// WHY THE SPEC IS A FILE AND THE FINGERPRINT IS A FILE. Both are inputs to a
// comparison, so both have to be things a reviewer can read and diff. The spec
// says what to run; the fingerprint says what running it produced. Neither is
// computed at compare time from the other.
//
// FIRST_DIVERGING_TICK. Reporting "something changed" is nearly useless for
// diagnosis, so the decision stream's rows are digested PER TICK as well as in
// full. When two runs disagree, the first tick whose digest differs is the tick
// where the behavioral paths separated, and that is the number a human needs
// first. Dimensions with no tick attribution (a defaults change, for instance)
// report their divergence with a null tick rather than a guessed one.
//
// TWO PARTS, ONE GATE (review finding F2). The behavioral fingerprint is the
// PRIMARY GATE and the only thing that halts: dimensions diverge, the run
// stops. Beside it sits a non-fatal SOURCE-DRIFT SIGNAL comparing engine source
// digests and runtime/dependency identity. It exists because "never compare the
// digests" -- the original position, taken to avoid firing on comment edits --
// left no drift gate at all: an engine edit this one 300-tick trajectory does
// not exercise passed as identical with nothing recorded. A NOTICE says what a
// digest change actually proves (a file changed) and what it does not (that
// behavior changed, or that it didn't), and never stops a run on its own.
//
// THE DETECTOR IS NOT A STRAITJACKET. A legitimate improvement WILL diverge --
// that is what improving the engine means. The valve is the re-baselining
// ritual, and it is deliberately loud: a plan, a reason, the cycle that caused
// it, a distinct review, an operator ratification, and a lineage chain entry.
// checkRebaselineFrequency() below is the guard on the valve: re-baselining
// more than N of the last M cycles is itself a halt and a finding, because a
// frame that has to be widened every cycle is not a frame.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('node:crypto');
const { execFileSync } = require('child_process');

const { canonicalize, sha256Hex, hashObject } = require('./canonical.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ENGINE_ROOT = path.join(REPO_ROOT, 'tools', 'ant-hive-world');
const DEFAULT_SPEC_PATH = path.join(__dirname, 'benchmark-colony-v1.json');
const DEFAULT_FINGERPRINT_PATH = path.join(REPO_ROOT, '_dev', 'state', 'ticktock', 'benchmark-fingerprint-v1.json');

const FINGERPRINT_SCHEMA = 'BenchmarkFingerprint/1.0';

// Engine source files whose digests are recorded, and -- since review finding
// F2 -- also COMPARED, as a DRIFT NOTICE rather than as a halt. The original
// reasoning ("a comment edit changes a digest without changing a decision, and
// a detector that fires on that trains its reader to ignore it") identified a
// real false-positive problem, but answering it with "never compare" left no
// source-drift gate at all: an engine edit that this one 300-tick trajectory
// happens not to exercise passed as identical, silently.
//
// The two-part answer is in compareFingerprints() below. The behavioral
// fingerprint stays the PRIMARY GATE and is the only thing that can halt a run.
// Source digests produce a separate, non-fatal DRIFT NOTICE. See
// SOURCE_DRIFT_MEANING for exactly what that notice does and does not prove.
const ENGINE_PROVENANCE_FILES = Object.freeze([
  'run-live.js', 'train-tick.js', 'untrained-network.js', 'world-mind.js',
  'world-train.js', 'world-state.js', 'harness.js', 'live-config.js'
]);

// ---------------------------------------------------------------------------
// Canonicalization of engine output
// ---------------------------------------------------------------------------

// Stripped recursively before hashing any state file. Every key here differs
// between two behaviorally identical runs -- wall clock stamps and per-process
// UUIDs -- so leaving one in would make the detector fire on every comparison,
// which is indistinguishable from having no detector at all.
const VOLATILE_KEYS = Object.freeze(['written_at', 'at', 'ts', 'when', 'run_id', 'episode_id', 'tick_key']);

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (VOLATILE_KEYS.includes(k)) continue;
      out[k] = stripVolatile(value[k]);
    }
    return out;
  }
  return value;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Running the frozen colony
// ---------------------------------------------------------------------------

// engineRoot is a parameter, not a constant, for one specific reason: proving
// the detector works requires running it against a DELIBERATELY MUTATED copy of
// the engine. A detector that has only ever been pointed at a correct engine
// has never been shown to detect anything.
function runColony(spec, options = {}) {
  const engineRoot = options.engineRoot || DEFAULT_ENGINE_ROOT;
  const driver = path.join(engineRoot, path.basename(spec.engine.driver));
  if (!fs.existsSync(driver)) throw new Error(`runColony: driver not found at ${driver}`);

  const sandboxRoot = options.sandboxRoot
    || fs.mkdtempSync(path.join(os.tmpdir(), 'tt-benchmark-'));
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
  fs.mkdirSync(sandboxRoot, { recursive: true });

  // World params are written BEFORE the driver starts. The driver's own fresh-
  // start path merges its tick interval into whatever config file it finds, so
  // pre-writing the full surface pins every parameter instead of inheriting
  // live-config.js's defaults, which are free to move.
  const worldParams = { ...spec.world_params };
  delete worldParams._note;
  fs.writeFileSync(path.join(sandboxRoot, 'live-config.json'), JSON.stringify(worldParams, null, 2));

  const args = [driver, ...spec.engine.cli_args, '--sandbox-root', sandboxRoot];
  const started = Date.now();
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, args, {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, RESUME_FROM: '', ROOT_SEED: '', GOAL_PACKET: '' }
    });
  } catch (e) {
    const err = new Error(`runColony: the driver exited non-zero (${e.status}). A benchmark that cannot run is a halt, never a pass.`);
    err.stdout = e.stdout ? String(e.stdout).slice(-4000) : '';
    err.stderr = e.stderr ? String(e.stderr).slice(-4000) : '';
    throw err;
  }
  return { sandboxRoot, engineRoot, wall_clock_ms: Date.now() - started, stdout_tail: stdout.slice(-2000) };
}

// ---------------------------------------------------------------------------
// Fingerprint dimensions
// ---------------------------------------------------------------------------

function digestOf(obj) {
  return sha256Hex(canonicalize(obj));
}

// FINAL WORLD STATE. Covers the shared world state and both hive states, each
// volatile-stripped. Hive states are included because a colony whose world
// looks identical while its hives hold different stockpiles has not, in any
// useful sense, ended in the same place.
function dimensionFinalWorldState(sandboxRoot) {
  const worldPath = path.join(sandboxRoot, 'shared', 'world-state.json');
  const world = stripVolatile(JSON.parse(fs.readFileSync(worldPath, 'utf8')));
  const hives = {};
  for (const id of ['hive-a', 'hive-b']) {
    const p = path.join(sandboxRoot, id, 'hive-state.json');
    if (fs.existsSync(p)) hives[id] = stripVolatile(JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  const projection = { world, hives };
  return {
    digest: digestOf(projection),
    summary: {
      seq: world.seq,
      resources: world.resources,
      prey_population: world.prey_population,
      predator_population: world.predator_population,
      territory_tiles: Object.keys(world.territory || {}).length,
      geometry_events: (world.geometry_log || []).length,
      hive_stockpiles: Object.fromEntries(Object.entries(hives).map(([k, v]) => [k, v.hive_state && v.hive_state.stockpile]))
    }
  };
}

// DECISION STREAM. The full behavioral surface: one row per actor per tick,
// carrying only quantities a decision actually depends on. The driver already
// excludes wall-clock and identity fields from it, which is exactly why it can
// be hashed whole with no stripping. per_tick_digests is what makes
// first_diverging_tick answerable.
function dimensionDecisionStream(sandboxRoot) {
  const rows = readJsonl(path.join(sandboxRoot, 'decision-stream.jsonl'));
  const byTick = new Map();
  for (const r of rows) {
    if (!byTick.has(r.t)) byTick.set(r.t, []);
    byTick.get(r.t).push(r);
  }
  const ticks = [...byTick.keys()].sort((a, b) => a - b);
  const per_tick_digests = ticks.map((t) => ({ t, digest: digestOf(byTick.get(t)) }));
  return {
    digest: digestOf(rows),
    per_tick_digests,
    summary: { rows: rows.length, ticks: ticks.length, actors: [...new Set(rows.map((r) => r.actor))].sort() }
  };
}

// RESOURCE CURVES. Per-actor stockpile trajectory across the run, plus the
// final world resource pool. Derived from the decision stream, so a curve
// divergence implies a stream divergence -- it is carried as its own dimension
// anyway because "the colony ran out of food forty ticks earlier" is the shape
// of drift a human recognizes fastest.
function dimensionResourceCurves(sandboxRoot) {
  const rows = readJsonl(path.join(sandboxRoot, 'decision-stream.jsonl'));
  const curves = {};
  for (const r of rows) {
    if (!r.stock) continue;
    if (!curves[r.actor]) curves[r.actor] = [];
    curves[r.actor].push({ t: r.t, ...r.stock });
  }
  const world = JSON.parse(fs.readFileSync(path.join(sandboxRoot, 'shared', 'world-state.json'), 'utf8'));
  const projection = { curves, final_pool: world.resources };
  return {
    digest: digestOf(projection),
    summary: {
      actors: Object.keys(curves).sort(),
      points_per_actor: Object.fromEntries(Object.entries(curves).map(([k, v]) => [k, v.length])),
      final_pool: world.resources
    }
  };
}

// APPLIED RATES. What fraction of each actor's chosen actions the world
// actually applied. A change here without a change in chosen actions means the
// world's acceptance rules moved, which is a different kind of drift from the
// minds' policies moving.
function dimensionAppliedRates(sandboxRoot) {
  const rows = readJsonl(path.join(sandboxRoot, 'decision-stream.jsonl'));
  const tally = {};
  for (const r of rows) {
    if (!tally[r.actor]) tally[r.actor] = { total: 0, applied: 0 };
    tally[r.actor].total += 1;
    if (r.applied) tally[r.actor].applied += 1;
  }
  const rates = {};
  for (const [actor, v] of Object.entries(tally)) {
    rates[actor] = { total: v.total, applied: v.applied, rate: v.total ? v.applied / v.total : 0 };
  }
  return { digest: digestOf(rates), summary: rates };
}

// ENTROPY. The exploration surface. Policy entropy is the quantity the whole
// exploration-collapse fix line of work was about, so a silent change to it is
// precisely the regression this benchmark exists to refuse.
function dimensionEntropy(sandboxRoot) {
  const rows = readJsonl(path.join(sandboxRoot, 'decision-stream.jsonl'));
  const series = {};
  for (const r of rows) {
    const value = r.pe !== undefined ? r.pe : r.entropy;
    if (value === undefined || value === null) continue;
    if (!series[r.actor]) series[r.actor] = [];
    series[r.actor].push({ t: r.t, e: value, post: r.peu === undefined ? null : r.peu });
  }
  const summary = {};
  for (const [actor, s] of Object.entries(series)) {
    const vals = s.map((x) => x.e);
    summary[actor] = {
      points: vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
      final: vals[vals.length - 1]
    };
  }
  return { digest: digestOf(series), summary };
}

// BUILD PLACEMENTS. Where and when the hives built. Geometry events carry a
// tick, so this dimension CAN attribute a first diverging tick of its own even
// when the decision stream somehow matched.
function dimensionBuildPlacements(sandboxRoot) {
  const world = JSON.parse(fs.readFileSync(path.join(sandboxRoot, 'shared', 'world-state.json'), 'utf8'));
  const events = (world.geometry_log || []).map((e) => stripVolatile({
    hive: e.hive, kind: e.kind, coords: e.coords, tick: e.tick, state_at_event: e.state_at_event
  }));
  const byKind = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  return {
    digest: digestOf(events),
    events,
    summary: { count: events.length, by_kind: byKind, ticks: events.map((e) => e.tick) }
  };
}

// WORLD PARAMS DEFAULTS. The spec pins every world parameter explicitly, so a
// defaults change cannot move the baseline -- but it should not be INVISIBLE
// either. Hashing DEFAULT_CONFIG makes it a named, non-tick-attributable
// divergence: loud, and correctly separated from a behavioral change.
function dimensionWorldParamsDefaults(engineRoot) {
  const configPath = path.join(engineRoot, 'live-config.js');
  if (!fs.existsSync(configPath)) return { digest: digestOf(null), summary: { present: false } };
  delete require.cache[require.resolve(configPath)];
  const { DEFAULT_CONFIG } = require(configPath);
  return { digest: digestOf(DEFAULT_CONFIG), summary: { keys: Object.keys(DEFAULT_CONFIG).length } };
}

function engineProvenance(engineRoot) {
  const files = [];
  for (const name of ENGINE_PROVENANCE_FILES) {
    const p = path.join(engineRoot, name);
    if (!fs.existsSync(p)) continue;
    files.push({ path: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') });
  }
  return files;
}

// What a source-drift notice means, stated once and carried on every
// fingerprint so a reader never has to reconstruct it from the code.
const SOURCE_DRIFT_MEANING = Object.freeze({
  proves: 'At least one engine source file differs, byte for byte, from the file the baseline was recorded against. Something in the engine was edited between the two recordings.',
  does_not_prove: 'That behavior changed. A comment, a rename, or a reordering all move a digest without moving a decision. It equally does not prove behavior did NOT change: the fingerprint samples one 300-tick trajectory, so an edit this trajectory never exercises is invisible to the behavioral gate and a digest change is the only signal that it happened at all.',
  severity: 'NOTICE, never a halt. The behavioral fingerprint remains the only halting gate. A drift notice with an identical fingerprint is the case worth a human glance: the engine changed and this trajectory did not notice.'
});

// ---------------------------------------------------------------------------
// Environment and dependency identity (review finding F5)
// ---------------------------------------------------------------------------

// F5 confirmed that a copied engine at a different absolute path reproduced all
// seven dimensions -- but noted that identity: true is close to vacuous unless
// the environment the two runs shared is actually PINNED somewhere. A run under
// a different Node major, or against a different ajv, could reproduce or fail to
// reproduce for reasons no dimension records. So it is recorded here: not as a
// comparison input to the halting gate, but as a named part of the fingerprint
// a drift notice can fire on.
//
// Dependencies are discovered by reading the engine's own bare requires rather
// than the repo's package.json, so what is recorded is what the engine actually
// loads, not what the repository happens to declare.
//
// WHAT THE SCAN COVERS, AND -- SINCE REVIEW DEFECT D3 -- WHAT IT DOES NOT.
// The first version read only the TOP-LEVEL .js/.cjs files in the engine root
// and only literal `require('name')` calls, while the surrounding block was
// described as environment identity. An adversarial probe walked straight
// through it: a require in a SUBDIRECTORY file was invisible, and so was
// `require(name)` with a computed specifier. Two repairs, of different kinds:
//
//   1. Discovery is now RECURSIVE over the whole engine tree (node_modules,
//      dot-directories and non-source files excluded), and reads ESM `import`
//      specifiers as well as `require`. That closes the nested-file miss
//      outright -- it is a real fix, not a caveat.
//
//   2. The remaining gaps are COUNTED AND REPORTED rather than described away.
//      A static scan cannot resolve a computed specifier, and this one
//      deliberately does not walk into installed packages to enumerate their
//      own dependencies. Both limits now appear in the recorded block, with a
//      count and the file:line of every dynamic call site, so a reader can see
//      the size of what was not covered instead of inferring completeness from
//      the block's name.
//
// The honest description of the result is therefore "the direct, statically
// resolvable dependency surface of the engine tree, plus a census of what could
// not be resolved statically" -- not "the environment".
// DEFECT D5. The first repair of this block counted computed require() only,
// while does_not_cover claimed "Computed require()/import() specifiers" were
// counted. A fixture using `await import(name)` produced dynamic_require_count:
// 0 with no site recorded -- the census claiming coverage it did not have,
// which is the exact failure the D3 repair existed to end. Two separate misses
// were behind the one claim, and both are fixed here:
//
//   1. `import('some-package')` -- a dynamic import with a LITERAL specifier --
//      is statically resolvable, but BARE_IMPORT_RE requires whitespace after
//      `import`, so the parenthesised form matched nothing and the dependency
//      was invisible. It is now read and resolved like any other specifier.
//   2. `import(name)` -- a COMPUTED specifier -- is unresolvable, and is now
//      counted and sited in its own fields rather than being covered by a claim
//      about require().
//
// The counts are deliberately kept in two separate fields. dynamic_require_count
// counts computed require() and nothing else; dynamic_import_count counts
// computed import() and nothing else. Neither name may describe more than the
// regex beside it actually matches.
const BARE_REQUIRE_RE = /require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g;
const BARE_IMPORT_RE = /(?:^|[\s;}])import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'".][^'"]*)['"]/gm;
const LITERAL_DYNAMIC_IMPORT_RE = /(?<![\w$.])import\s*\(\s*['"]([^'".][^'"]*)['"]\s*\)/g;
// A require whose first non-space argument is not a quote: a computed
// specifier. Unresolvable by any static scan, so it is counted, not guessed at.
const DYNAMIC_REQUIRE_RE = /require\(\s*(?!['"])[^)]/g;
// The same shape for dynamic import(). The lookbehind keeps `foo.import(` and
// identifiers ending in "import" from being read as the import operator.
const DYNAMIC_IMPORT_RE = /(?<![\w$.])import\s*\(\s*(?!['"])[^)]/g;

const SOURCE_EXTENSIONS = Object.freeze(['.js', '.cjs', '.mjs']);
const SCAN_SKIP_DIRS = Object.freeze(['node_modules', '.git']);

function collectEngineSourceFiles(dir, engineRoot, out, skipped) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    skipped.push({ path: path.relative(engineRoot, dir) || '.', reason: e.code || 'unreadable' });
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.includes(entry.name) || entry.name.startsWith('.')) {
        skipped.push({ path: path.relative(engineRoot, full), reason: 'excluded directory' });
        continue;
      }
      collectEngineSourceFiles(full, engineRoot, out, skipped);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function packageNameOf(specifier) {
  return specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
}

function lineOfIndex(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

function engineDependencies(engineRoot) {
  const names = new Set();
  const files = [];
  const skipped = [];
  const dynamicSites = [];
  const dynamicImportSites = [];
  try {
    if (!fs.statSync(engineRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    return {
      resolved: [],
      unresolved: [],
      scan: {
        files_scanned: 0,
        dynamic_require_count: 0,
        dynamic_require_sites: [],
        dynamic_import_count: 0,
        dynamic_import_sites: [],
        skipped: [],
        error: `engine root ${engineRoot} could not be listed`
      }
    };
  }
  collectEngineSourceFiles(engineRoot, engineRoot, files, skipped);

  const builtins = require('module').builtinModules;
  for (const full of files) {
    const src = fs.readFileSync(full, 'utf8');
    const rel = path.relative(engineRoot, full);
    for (const re of [BARE_REQUIRE_RE, BARE_IMPORT_RE, LITERAL_DYNAMIC_IMPORT_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const name = m[1];
        if (name.startsWith('node:')) continue;
        // Node builtins are pinned by node_version, not by a package version.
        if (builtins.includes(name)) continue;
        names.add(packageNameOf(name));
      }
    }
    DYNAMIC_REQUIRE_RE.lastIndex = 0;
    let d;
    while ((d = DYNAMIC_REQUIRE_RE.exec(src)) !== null) {
      dynamicSites.push({ file: rel, line: lineOfIndex(src, d.index) });
    }
    DYNAMIC_IMPORT_RE.lastIndex = 0;
    let di;
    while ((di = DYNAMIC_IMPORT_RE.exec(src)) !== null) {
      dynamicImportSites.push({ file: rel, line: lineOfIndex(src, di.index) });
    }
  }

  const resolved = [];
  const unresolved = [];
  for (const name of [...names].sort()) {
    try {
      const pkgPath = require.resolve(`${name}/package.json`, { paths: [engineRoot, REPO_ROOT] });
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      resolved.push({ name, version: pkg.version });
    } catch (e) {
      // Recorded, never swallowed: "the engine requires something that is not
      // installed here" is precisely the environment difference F5 hit.
      unresolved.push({ name, reason: e.code || 'unresolved' });
    }
  }
  return {
    resolved,
    unresolved,
    scan: {
      files_scanned: files.length,
      extensions: [...SOURCE_EXTENSIONS],
      recursive: true,
      dynamic_require_count: dynamicSites.length,
      dynamic_require_sites: dynamicSites,
      dynamic_import_count: dynamicImportSites.length,
      dynamic_import_sites: dynamicImportSites,
      skipped,
      covers: 'Every .js/.cjs/.mjs file in the engine tree, read recursively, for literal require() specifiers, literal static import specifiers, and literal dynamic import("...") specifiers. Bare specifiers are reduced to their package name and resolved to an installed version.',
      does_not_cover: [
        'Computed require(...) specifiers. dynamic_require_count is the number found and dynamic_require_sites gives the file:line of each; every one is a dependency this block may be silently missing.',
        'Computed import(...) specifiers. dynamic_import_count is the number found and dynamic_import_sites gives the file:line of each; counted separately from require() because they are detected separately, and neither count stands in for the other.',
        'Transitive dependencies of the packages listed. Only the engine\'s own direct requires are enumerated; a version change inside a listed package\'s own dependency tree moves no field here.',
        'Files outside the engine tree that the engine loads (repo-level helpers reached by a relative path above engineRoot).',
        'Anything loaded through a mechanism other than require/import -- child processes, eval, native addons, or a package resolved at runtime from configuration.'
      ]
    }
  };
}

// Speaks only about what the scan actually counted: computed require() and
// computed import() are reported separately, and a scan block that predates
// either count says its reach is unknown rather than implying completeness.
function dynamicSpecifierCaveat(scan) {
  if (!scan) return 'the observed fingerprint predates dependency-scan coverage reporting; the reach of its dependency list is unknown';
  const requires = Number(scan.dynamic_require_count) || 0;
  const imports = scan.dynamic_import_count === undefined ? null : (Number(scan.dynamic_import_count) || 0);
  if (imports === null) {
    return requires > 0
      ? `the observed engine tree contains ${requires} computed require() site(s) whose specifiers no static scan can resolve; agreement on the listed dependencies says nothing about those. The block predates computed-import() counting, so the number of unresolvable import() sites is unknown`
      : 'no computed require() sites were found in the observed engine tree, but the block predates computed-import() counting, so the number of unresolvable import() sites is unknown, and transitive dependencies of the listed packages are outside this comparison either way';
  }
  const total = requires + imports;
  if (total > 0) {
    return `the observed engine tree contains ${requires} computed require() site(s) and ${imports} computed import() site(s) whose specifiers no static scan can resolve; agreement on the listed dependencies says nothing about those`;
  }
  return 'no computed require() or import() sites were found in the observed engine tree, but transitive dependencies of the listed packages are still outside this comparison';
}

function environmentIdentity(engineRoot) {
  const deps = engineDependencies(engineRoot);
  return {
    node_version: process.version,
    node_major: Number(process.versions.node.split('.')[0]),
    v8_version: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    engine_dependencies: deps.resolved,
    engine_dependencies_unresolved: deps.unresolved,
    engine_dependency_scan: deps.scan,
    note: 'Recorded so that a future identical: true is a claim about two runs whose runtime identity is known, rather than an unexamined assumption that they shared one. Compared as a non-fatal DRIFT NOTICE, exactly like engine source digests; never a halt. NOT a completeness claim about the environment: engine_dependencies is the statically resolvable direct dependency surface of the engine tree, and engine_dependency_scan.does_not_cover states in full what a static scan cannot see. Read a matching environment block as "these named things agree", never as "the two runs were identical".'
  };
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

// `options.lineage` supplies the re-baselining record. The default below is the
// initial-baseline case; anything else has to be stated by whoever re-records,
// because a re-baseline whose reason is generated rather than supplied is a
// re-baseline nobody accounted for. The CLI exposes it as --prior-fingerprint /
// --reason / --review-artifact / --ratification / --triggering-cycle.
function computeFingerprint(spec, run, options = {}) {
  const { sandboxRoot, engineRoot } = run;
  const lineage = options.lineage || {
    prior_fingerprint_hash: null,
    triggering_cycle: null,
    review_artifact: null,
    ratification_reference: null,
    reason: 'initial baseline -- no prior fingerprint exists'
  };
  const specForHash = { ...spec };
  const fingerprint = {
    schema: FINGERPRINT_SCHEMA,
    colony_spec_version: spec.colony_spec_version,
    colony_spec_hash: hashObject(specForHash, []),
    recorded_at: new Date().toISOString(),
    engine: {
      engine_root_relative: path.relative(REPO_ROOT, engineRoot),
      node_version: process.version,
      files: engineProvenance(engineRoot),
      note: 'Recorded as provenance AND compared as a non-fatal drift notice (review finding F2). Never part of fingerprint_hash and never a halt: behavior is judged by behavior. See drift_notice_meaning.',
      drift_notice_meaning: SOURCE_DRIFT_MEANING
    },
    environment: environmentIdentity(engineRoot),
    dimensions: {
      final_world_state: dimensionFinalWorldState(sandboxRoot),
      decision_stream: dimensionDecisionStream(sandboxRoot),
      resource_curves: dimensionResourceCurves(sandboxRoot),
      applied_rates: dimensionAppliedRates(sandboxRoot),
      entropy: dimensionEntropy(sandboxRoot),
      build_placements: dimensionBuildPlacements(sandboxRoot),
      world_params_defaults: dimensionWorldParamsDefaults(engineRoot)
    },
    lineage,
    fingerprint_hash: 'placeholder'
  };
  // recorded_at, the engine block and the environment block are provenance and
  // MUST NOT enter the identity hash: two recordings of an unchanged engine
  // minutes apart are the same fingerprint, and a hash that said otherwise
  // could never be compared. They are compared SEPARATELY, as drift notices --
  // recording them outside the hash is what makes that possible, and what keeps
  // a Node patch release from halting a run whose behavior did not move.
  fingerprint.fingerprint_hash = hashObject(
    { colony_spec_version: fingerprint.colony_spec_version, colony_spec_hash: fingerprint.colony_spec_hash, dimensions: fingerprint.dimensions },
    []
  );
  return fingerprint;
}

// ---------------------------------------------------------------------------
// Comparison -- the detector
// ---------------------------------------------------------------------------

// SOURCE DRIFT (review finding F2), the non-fatal half of the two-part gate.
// Compares the recorded and observed engine file digests and reports what
// changed. It cannot halt anything and is not consulted by `identical`.
function compareSourceDrift(recorded, observed) {
  const toMap = (fp) => new Map((((fp || {}).engine || {}).files || []).map((f) => [f.path, f.sha256]));
  const a = toMap(recorded);
  const b = toMap(observed);
  const changed = [];
  const added = [];
  const removed = [];
  for (const [p, sha] of b) {
    if (!a.has(p)) added.push(p);
    else if (a.get(p) !== sha) changed.push({ path: p, recorded_sha256: a.get(p), observed_sha256: sha });
  }
  for (const p of a.keys()) if (!b.has(p)) removed.push(p);
  const detected = changed.length > 0 || added.length > 0 || removed.length > 0;
  return {
    detected,
    severity: detected ? 'NOTICE' : null,
    changed_files: changed,
    added_files: added,
    removed_files: removed,
    files_compared: b.size,
    baseline_available: a.size > 0,
    meaning: SOURCE_DRIFT_MEANING
  };
}

// ENVIRONMENT DRIFT (review finding F5). Same non-fatal contract. Compares the
// runtime and dependency identity the two fingerprints were taken under, so an
// `identical: true` can be read as "identical under a KNOWN environment" rather
// than as an unexamined assumption that both runs shared one.
function compareEnvironmentDrift(recorded, observed) {
  const a = recorded.environment;
  const b = observed.environment;
  if (!a || !b) {
    return {
      detected: false,
      severity: null,
      comparable: false,
      reason: !a
        ? 'the recorded fingerprint predates environment capture; there is nothing to compare against and this is reported rather than treated as agreement'
        : 'the observed run recorded no environment block',
      changed: []
    };
  }
  const changed = [];
  for (const key of ['node_version', 'node_major', 'v8_version', 'platform', 'arch']) {
    if (a[key] !== b[key]) changed.push({ field: key, recorded: a[key], observed: b[key] });
  }
  const depMap = (list) => new Map((list || []).map((d) => [d.name, d.version]));
  const da = depMap(a.engine_dependencies);
  const db = depMap(b.engine_dependencies);
  for (const [name, version] of db) {
    if (!da.has(name)) changed.push({ field: `dependency:${name}`, recorded: null, observed: version });
    else if (da.get(name) !== version) changed.push({ field: `dependency:${name}`, recorded: da.get(name), observed: version });
  }
  for (const [name, version] of da) {
    if (!db.has(name)) changed.push({ field: `dependency:${name}`, recorded: version, observed: null });
  }
  const unresolvedNow = (b.engine_dependencies_unresolved || []).map((u) => u.name);
  const detected = changed.length > 0 || unresolvedNow.length > 0;
  return {
    detected,
    severity: detected ? 'NOTICE' : null,
    comparable: true,
    changed,
    unresolved_dependencies: unresolvedNow,
    // Carried onto the comparison, not just the fingerprint, so that
    // `detected: false` is never read as "the environments matched". It means
    // the named, statically discoverable fields matched. Defect D3: a scan that
    // reports agreement without reporting its own reach overstates itself.
    scan_coverage: {
      observed: b.engine_dependency_scan || null,
      recorded: a.engine_dependency_scan || null,
      // DEFECT D5: this read dynamic_require_count alone, so a tree whose only
      // computed specifiers were import() reported "no dynamic require sites
      // were found" -- true of require(), and misleading about the tree.
      caveat: dynamicSpecifierCaveat(b.engine_dependency_scan)
    },
    meaning: {
      proves: 'The two runs did not execute under the same runtime and dependency identity.',
      does_not_prove: 'That the difference caused, or would cause, any behavioral change. It is the context in which an identical (or divergent) fingerprint should be read. It equally does not prove the environments were the same when nothing changed: only the statically discoverable direct dependencies are compared -- see scan_coverage.',
      severity: 'NOTICE, never a halt.'
    }
  };
}

// SPEC DRIFT. Found while repairing F2, and the same shape of gap: the
// fingerprint records colony_spec_hash and folds it into fingerprint_hash, but
// the comparison reads only `dimensions` -- so editing the spec produced
// identical: true alongside two DIFFERENT fingerprint_hash values, and nothing
// said so. Reported here as a notice on the same non-fatal terms. A spec change
// that moves world_params will normally also diverge a dimension and halt on
// its own; a change to the spec's prose will not, and should not.
function compareSpecDrift(recorded, observed) {
  const versionChanged = recorded.colony_spec_version !== observed.colony_spec_version;
  const hashChanged = recorded.colony_spec_hash !== observed.colony_spec_hash;
  const fingerprintHashChanged = recorded.fingerprint_hash !== observed.fingerprint_hash;
  const detected = versionChanged || hashChanged;
  return {
    detected,
    severity: detected ? 'NOTICE' : null,
    colony_spec_version_changed: versionChanged,
    colony_spec_hash_changed: hashChanged,
    recorded_colony_spec_hash: recorded.colony_spec_hash,
    observed_colony_spec_hash: observed.colony_spec_hash,
    fingerprint_hash_changed: fingerprintHashChanged,
    meaning: {
      proves: 'The benchmark spec file differs from the one the baseline was recorded against -- anywhere in it, prose included.',
      does_not_prove: 'That the RUN changed. A spec edit that touches world_params or cli_args changes behavior and will diverge a dimension on its own; an edit to the spec\'s comments moves colony_spec_hash (and therefore fingerprint_hash) while every dimension stays put.',
      severity: 'NOTICE, never a halt. Worth knowing because it explains a fingerprint_hash mismatch that the dimension comparison correctly calls identical.'
    }
  };
}

// Returns exactly the shape S1 specifies: {identical, diverging_dimensions[],
// first_diverging_tick}. Extra fields are additive detail; the three named ones
// are the contract.
//
// TWO-PART GATE (review finding F2). `identical` / `halt` are decided by the
// behavioral dimensions ALONE -- unchanged, deliberately, because a source
// digest firing a halt on a comment edit is how a detector gets ignored. The
// source and environment drift notices ride alongside as separate, non-fatal
// signals, so drift is VISIBLE without being fatal. The combination worth
// reading closely is drift_detected: true with identical: true -- the engine
// changed and this one trajectory did not notice, which is a statement about
// the trajectory's coverage, not a clean bill of health.
function compareFingerprints(recorded, observed) {
  const diverging = [];
  const detail = {};
  const dimensionNames = [...new Set([
    ...Object.keys(recorded.dimensions || {}),
    ...Object.keys(observed.dimensions || {})
  ])].sort();

  for (const name of dimensionNames) {
    const a = (recorded.dimensions || {})[name];
    const b = (observed.dimensions || {})[name];
    if (!a || !b) {
      diverging.push(name);
      detail[name] = { reason: !a ? 'dimension absent from the recorded fingerprint' : 'dimension absent from the observed run' };
      continue;
    }
    if (a.digest !== b.digest) {
      diverging.push(name);
      detail[name] = { recorded_digest: a.digest, observed_digest: b.digest };
    }
  }

  // Tick attribution. The decision stream is the primary source because it
  // covers every actor on every tick; build placements are the fallback for the
  // (unlikely) case where geometry diverged while the stream matched.
  let firstDivergingTick = null;
  const attribution = [];

  const ra = recorded.dimensions && recorded.dimensions.decision_stream;
  const ob = observed.dimensions && observed.dimensions.decision_stream;
  if (ra && ob && ra.digest !== ob.digest) {
    const rt = ra.per_tick_digests || [];
    const ot = ob.per_tick_digests || [];
    const n = Math.max(rt.length, ot.length);
    for (let i = 0; i < n; i += 1) {
      const r = rt[i];
      const o = ot[i];
      if (!r || !o || r.t !== o.t || r.digest !== o.digest) {
        firstDivergingTick = r ? r.t : (o ? o.t : i);
        attribution.push({ dimension: 'decision_stream', first_diverging_tick: firstDivergingTick });
        break;
      }
    }
  }

  const rb = recorded.dimensions && recorded.dimensions.build_placements;
  const obp = observed.dimensions && observed.dimensions.build_placements;
  if (rb && obp && rb.digest !== obp.digest) {
    const re = rb.events || [];
    const oe = obp.events || [];
    const n = Math.max(re.length, oe.length);
    for (let i = 0; i < n; i += 1) {
      const r = re[i];
      const o = oe[i];
      if (!r || !o || digestOf(r) !== digestOf(o)) {
        const tick = r ? r.tick : (o ? o.tick : null);
        attribution.push({ dimension: 'build_placements', first_diverging_tick: tick });
        if (tick !== null && (firstDivergingTick === null || tick < firstDivergingTick)) firstDivergingTick = tick;
        break;
      }
    }
  }

  const identical = diverging.length === 0;
  const source_drift = compareSourceDrift(recorded, observed);
  const environment_drift = compareEnvironmentDrift(recorded, observed);
  const spec_drift = compareSpecDrift(recorded, observed);
  const drift_detected = source_drift.detected || environment_drift.detected || spec_drift.detected;

  return {
    identical,
    diverging_dimensions: diverging,
    first_diverging_tick: firstDivergingTick,
    // The halt decision reads the behavioral dimensions and nothing else. A
    // drift notice never appears in this line, which is the entire point of
    // separating them.
    halt: !identical,
    halt_state: identical ? null : 'BENCHMARK-DIVERGENCE',
    drift_detected,
    drift_severity: drift_detected ? 'NOTICE' : null,
    source_drift,
    environment_drift,
    spec_drift,
    drift_notice: drift_detected
      ? (identical
        ? 'DRIFT NOTICE (non-fatal): the engine, its environment, or the spec changed since the baseline, and the frozen colony still produced an identical fingerprint. That means this 300-tick trajectory does not exercise whatever changed -- it is not evidence that nothing behavioral changed. Worth a human glance; it does not halt the run.'
        : 'DRIFT NOTICE (non-fatal): the engine, its environment, or the spec changed since the baseline, alongside a behavioral divergence that has already halted the run. The changed files are the first place to look for the cause.')
      : null,
    tick_attribution: attribution,
    dimension_detail: detail,
    recorded_fingerprint_hash: recorded.fingerprint_hash,
    observed_fingerprint_hash: observed.fingerprint_hash
  };
}

// ---------------------------------------------------------------------------
// TT-003: repeated re-baselining detector
// ---------------------------------------------------------------------------

// Walks the lineage chain and computes how many of the last M cycles carried a
// re-baseline. Deliberately mechanical: it reads lineage entries, not a
// narrative claim that re-baselining has been rare. Exceeding the threshold is
// a HALT and a FINDING, never a routine event, because a frame that has to be
// widened every other cycle is either too tight or is being walked away from.
function checkRebaselineFrequency(lineageEntries, options = {}) {
  const n = options.n_threshold === undefined ? 2 : options.n_threshold;
  const m = options.m_window === undefined ? 5 : options.m_window;
  const currentCycle = options.current_cycle_index;

  const cycles = lineageEntries
    .map((e) => e.triggering_cycle)
    .filter((c) => Number.isInteger(c));
  const highest = currentCycle === undefined
    ? (cycles.length ? Math.max(...cycles) : 0)
    : currentCycle;
  const windowStart = Math.max(0, highest - m + 1);
  const inWindow = cycles.filter((c) => c >= windowStart && c <= highest);
  const count = new Set(inWindow).size;
  const exceeded = count > n;

  return {
    halted_on_threshold: exceeded,
    finding_recorded: exceeded,
    ratio_computed: `${count}/${m}`,
    n_threshold: n,
    m_window: m,
    window: { start_cycle: windowStart, end_cycle: highest },
    rebaseline_cycles_in_window: [...new Set(inWindow)].sort((a, b) => a - b),
    halt_state: exceeded ? 'REBASELINE-FREQUENCY' : null,
    finding: exceeded
      ? `re-baselining occurred in ${count} of the last ${m} cycles, above the charter threshold of ${n} -- the frame is too tight or the loop is drifting deliberately; an explicit operator decision is required before further cycles run`
      : null
  };
}

// Verifies the lineage chain links: each entry's prior_fingerprint_hash must
// equal the previous entry's new_fingerprint_hash. A break means a re-baseline
// happened that the chain does not account for.
function verifyLineageChain(lineageEntries) {
  const errors = [];
  for (let i = 1; i < lineageEntries.length; i += 1) {
    const prev = lineageEntries[i - 1];
    const cur = lineageEntries[i];
    if (cur.prior_fingerprint_hash !== prev.new_fingerprint_hash) {
      errors.push({ index: i, message: `prior_fingerprint_hash ${cur.prior_fingerprint_hash} does not match the preceding entry's new_fingerprint_hash ${prev.new_fingerprint_hash}` });
    }
    for (const required of ['triggering_cycle', 'review_artifact', 'ratification_reference', 'reason']) {
      if (cur[required] === undefined || cur[required] === null || cur[required] === '') {
        errors.push({ index: i, message: `lineage entry is missing "${required}" -- a re-baseline without it cannot be walked mechanically` });
      }
    }
  }
  return { chain_unbroken: errors.length === 0, independently_verified: true, errors, entries: lineageEntries.length };
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

function readSpec(specPath) {
  return JSON.parse(fs.readFileSync(path.resolve(specPath), 'utf8'));
}

function record(options = {}) {
  const spec = readSpec(options.specPath || DEFAULT_SPEC_PATH);
  const run = runColony(spec, options);
  const fingerprint = computeFingerprint(spec, run, options);
  if (options.keepSandbox !== true) fs.rmSync(run.sandboxRoot, { recursive: true, force: true });
  return { fingerprint, wall_clock_ms: run.wall_clock_ms };
}

function check(options = {}) {
  const spec = readSpec(options.specPath || DEFAULT_SPEC_PATH);
  const fingerprintPath = path.resolve(options.fingerprintPath || DEFAULT_FINGERPRINT_PATH);
  if (!fs.existsSync(fingerprintPath)) {
    throw new Error(`check: no recorded fingerprint at ${fingerprintPath}. A missing baseline is a halt, not an implicit pass -- run with --record first.`);
  }
  const recorded = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'));
  const run = runColony(spec, options);
  const observed = computeFingerprint(spec, run);
  if (options.keepSandbox !== true) fs.rmSync(run.sandboxRoot, { recursive: true, force: true });
  const result = compareFingerprints(recorded, observed);
  result.wall_clock_ms = run.wall_clock_ms;
  result.engine_root = path.relative(REPO_ROOT, run.engineRoot);
  return { result, observed, recorded };
}

module.exports = {
  FINGERPRINT_SCHEMA,
  DEFAULT_SPEC_PATH,
  DEFAULT_FINGERPRINT_PATH,
  DEFAULT_ENGINE_ROOT,
  VOLATILE_KEYS,
  SOURCE_DRIFT_MEANING,
  stripVolatile,
  runColony,
  computeFingerprint,
  compareFingerprints,
  compareSourceDrift,
  compareEnvironmentDrift,
  compareSpecDrift,
  environmentIdentity,
  engineDependencies,
  checkRebaselineFrequency,
  verifyLineageChain,
  record,
  check
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const argVal = (flag, def) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
  };
  const options = {
    specPath: argVal('--spec', DEFAULT_SPEC_PATH),
    fingerprintPath: argVal('--fingerprint', DEFAULT_FINGERPRINT_PATH),
    engineRoot: argVal('--engine-root', DEFAULT_ENGINE_ROOT),
    sandboxRoot: argVal('--sandbox-root', undefined),
    keepSandbox: argv.includes('--keep-sandbox')
  };

  if (argv.includes('--prior-fingerprint') || argv.includes('--reason')) {
    const cycle = argVal('--triggering-cycle', null);
    options.lineage = {
      prior_fingerprint_hash: argVal('--prior-fingerprint', null),
      triggering_cycle: cycle === null ? null : Number(cycle),
      review_artifact: argVal('--review-artifact', null),
      ratification_reference: argVal('--ratification', null),
      reason: argVal('--reason', null)
    };
  }

  if (argv.includes('--record')) {
    const { fingerprint, wall_clock_ms } = record(options);
    const out = path.resolve(options.fingerprintPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(fingerprint, null, 2) + '\n');
    process.stdout.write(JSON.stringify({
      recorded: out,
      fingerprint_hash: fingerprint.fingerprint_hash,
      wall_clock_ms,
      dimensions: Object.fromEntries(Object.entries(fingerprint.dimensions).map(([k, v]) => [k, v.digest]))
    }, null, 2) + '\n');
    process.exit(0);
  }

  const { result } = check(options);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  // The notice goes to stderr as well as into the JSON, so it is visible to
  // someone reading a terminal rather than only to something parsing the
  // output. It still does not touch the exit code.
  if (result.drift_detected) process.stderr.write(`\n${result.drift_notice}\n`);
  // Divergence is a HALT: a non-zero exit is how that reaches a caller that
  // only checks status codes.
  process.exit(result.identical ? 0 : 1);
}
