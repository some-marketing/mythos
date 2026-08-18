#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/unreal-export/import-turn.js -- UnrealImport/1.0
// converter: harvested ant-hive-world pull directory -> per-turn import file
// for the Unreal-side timelapse renderer.
//
// Contract: unreal-world-projection plan S0/S1
// (_dev/reports/analysis/task-plans/unreal-world-projection__plan.json,
// six codex review rounds). Read-only projection consumer -- input is ONLY
// a harvest directory that has already crossed the courier (guest ->
// orwell sterile staging -> this repo) and carries a verified manifest
// chain (RESULT-MANIFEST.txt -> HARVEST-MANIFEST.txt -> PULL-MANIFEST.txt).
// This file never opens a channel into a running guest, never touches VM
// config, seed, or golden image -- it only reads files already on disk.
//
// Determinism: the mirror re-derivation below uses the importer's OWN
// seeded PRNG (mulberry32, seeded from a stable 32-bit hash of turn_id) --
// never mirror-detector.js's unseeded Math.random -- so any reviewer can
// reproduce the emitted p-value byte-for-byte from the same harvest
// directory. The seed and shuffle count are recorded in the output.
//
// Journal (import-index.jsonl, append-only, one line per turn_id): a
// turn's absolute_day_start is fixed at FIRST ingestion and is immutable
// after that. Re-importing a known turn_id reuses the journaled
// absolute_day_start and requires payload_hash to match what was recorded
// then -- a mismatch is a fail-closed refusal (non-zero exit, no write),
// never a silent reassignment. Arrival/retry order never changes a
// previously assigned absolute_day_start.
//
// Usage:
//   node import-turn.js <harvest-dir> [--out-dir <dir>] [--shuffles <n>]
//
// <harvest-dir> is a pulled directory such as _dev/state/baseline-3000-r6,
// containing PULL-MANIFEST.txt, HARVEST-MANIFEST.txt and a run subdirectory
// (e.g. baseline-3000-r6/) with RESULT-MANIFEST.txt, world-state.json, and
// turn-projection.json. --out-dir defaults to this directory
// (tools/ant-hive-world/unreal-export/), which is also where the journal
// lives.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Ajv2020 = require('ajv/dist/2020');

const { buildCoords, featureCoords, meanNearest } = require('../mirror-detector.js');

const SCHEMA = require('./schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateShape = ajv.compile(SCHEMA);

const DEFAULT_SHUFFLES = 1000;
const GRID_SIZE = 10; // tools/ant-hive-world/world-state.js TILE_GRID_SIZE

// --- CLI ------------------------------------------------------------------

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function hasFlag(flag) {
  return process.argv.indexOf(flag) !== -1;
}

// --- hashing / manifest chain ----------------------------------------------

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Parses a "<sha256>  <relative-path>" manifest -- RESULT-MANIFEST.txt,
// HARVEST-MANIFEST.txt and PULL-MANIFEST.txt all share this shape (comment
// lines start with '#'). Paths are normalized to forward slashes and a
// leading "./" is stripped so entries from all three manifests key the
// same way despite the Windows guest side writing backslashes.
function parseManifest(text) {
  const out = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
    if (!m) continue;
    let rel = m[2].replace(/\\/g, '/');
    if (rel.startsWith('./')) rel = rel.slice(2);
    out.set(rel, m[1]);
  }
  return out;
}

function readManifest(filePath) {
  return parseManifest(fs.readFileSync(filePath, 'utf8'));
}

// Locates the single run subdirectory of a harvest dir -- the one carrying
// RESULT-MANIFEST.txt (e.g. baseline-3000-r6/baseline-3000-r6/).
function findRunSubdir(harvestDir) {
  const entries = fs.readdirSync(harvestDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const candidates = entries.filter((e) => fs.existsSync(path.join(harvestDir, e.name, 'RESULT-MANIFEST.txt')));
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly one run subdirectory carrying RESULT-MANIFEST.txt under ${harvestDir}, found ${candidates.length}`
    );
  }
  return path.join(harvestDir, candidates[0].name);
}

// Verifies a file's manifest coverage BEFORE touching its bytes, then
// verifies its actual sha256. Two phases, strictly ordered:
//   Phase 1 (no payload read): confirm all three manifests carry an entry
//   for this file, and that the three entries agree with each other. A
//   missing entry or a cross-manifest disagreement throws here -- before
//   sha256File ever opens the file.
//   Phase 2 (payload read): only now hash the actual file bytes and compare
//   against the (already cross-checked) expected digest.
// Fails closed at either phase: nothing is read, and nothing is written,
// until the manifest chain itself checks out.
function verifyFile(runSubdir, runName, relInRun, resultManifest, harvestManifest, pullManifest) {
  const checks = [
    { manifest: 'RESULT-MANIFEST.txt', map: resultManifest, key: relInRun },
    { manifest: 'HARVEST-MANIFEST.txt', map: harvestManifest, key: `${runName}/${relInRun}` },
    { manifest: 'PULL-MANIFEST.txt', map: pullManifest, key: `${runName}/${relInRun}` }
  ];

  // Phase 1: entries must exist and agree, before any payload byte is read.
  const entries = [];
  for (const c of checks) {
    const expected = c.map.get(c.key);
    if (!expected) {
      throw new Error(`${c.manifest} has no entry for ${c.key} -- fail-closed refusal to read an unverified file`);
    }
    entries.push({ manifest: c.manifest, expected });
  }
  const [first, ...rest] = entries;
  for (const e of rest) {
    if (e.expected !== first.expected) {
      throw new Error(
        `manifest chain disagreement for ${relInRun}: ${first.manifest} says ${first.expected}, ${e.manifest} says ${e.expected} -- fail-closed refusal to read an unverified file`
      );
    }
  }

  // Phase 2: entries agree with each other -- now read + hash the actual
  // file bytes and compare against the cross-checked expected digest.
  const actual = sha256File(path.join(runSubdir, relInRun));
  const receipts = [];
  for (const e of entries) {
    if (e.expected !== actual) {
      throw new Error(
        `hash mismatch for ${relInRun} against ${e.manifest}: manifest says ${e.expected}, actual file is ${actual} -- fail-closed refusal`
      );
    }
    receipts.push({ manifest: e.manifest, file: `${runName}/${relInRun}`, sha256: actual });
  }
  return { sha256: actual, receipts };
}

// --- deterministic mirror re-derivation -------------------------------------

// mulberry32 -- small, fast, deterministic 32-bit PRNG. Given the same
// seed it produces the same sequence every time; unlike mirror-detector.js's
// Math.random, this makes the permutation-null result reproducible.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over turn_id -- a stable 32-bit hash so the same turn_id always
// seeds the same PRNG sequence, on any machine, any run.
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Faithful port of mirror-detector.js's permutationTest, with the RNG
// swapped for the seeded one above. Same statistic (mean nearest-feature
// distance), same shuffle procedure, same p-value definition
// (P(null_mean <= observed_mean)).
function seededPermutationTest(builds, features, shuffles, rng, gridSize) {
  const observed = meanNearest(builds, features);
  if (observed === null) {
    return {
      observed: null,
      p_value: null,
      null_mean: null,
      null_sd: null,
      n_builds: builds.length,
      n_features: features.length
    };
  }
  let count = 0;
  let sum = 0;
  let sumsq = 0;
  for (let i = 0; i < shuffles; i++) {
    const shuffled = builds.map(() => [Math.floor(rng() * gridSize), Math.floor(rng() * gridSize)]);
    const m = meanNearest(shuffled, features);
    if (m !== null) {
      if (m <= observed) count += 1;
      sum += m;
      sumsq += m * m;
    }
  }
  const nullMean = sum / shuffles;
  const variance = Math.max(0, sumsq / shuffles - nullMean * nullMean);
  return {
    observed,
    p_value: count / shuffles,
    null_mean: nullMean,
    null_sd: Math.sqrt(variance),
    n_builds: builds.length,
    n_features: features.length,
    shuffles
  };
}

function deriveMirror(worldState, turnId, shuffles) {
  const builds = buildCoords(worldState);
  const features = featureCoords(worldState);
  if (!builds.length) return null;
  const seed = fnv1a32(turnId);
  const rng = mulberry32(seed);
  const stat = seededPermutationTest(builds, features, shuffles, rng, GRID_SIZE);
  const distinctTiles = new Set(builds.map((b) => `${b[0]},${b[1]}`)).size;
  return {
    observed: stat.observed,
    null_mean: stat.null_mean,
    null_sd: stat.null_sd,
    p_value: stat.p_value,
    n_builds: stat.n_builds,
    n_features: stat.n_features,
    distinct_tiles: distinctTiles,
    seed,
    shuffles
  };
}

// --- build ledger ------------------------------------------------------------

// Derives the Unreal-facing build ledger from geometry_log -- never present
// verbatim in world-state.json. hive/kind/coords/tick/run_id/episode_id are
// the raw build-event fields S0 names explicitly; state_at_event carries the
// stockpile/tile snapshot for HUD display.
function deriveBuildLedger(worldState) {
  const log = Array.isArray(worldState.geometry_log) ? worldState.geometry_log : [];
  return log.map((e) => ({
    hive: e.hive,
    kind: e.kind,
    coords: e.coords,
    tick: e.tick,
    at: e.at === undefined ? null : e.at,
    run_id: e.run_id,
    episode_id: e.episode_id,
    state_at_event: e.state_at_event === undefined ? null : e.state_at_event
  }));
}

// --- journal (import-index.jsonl) -------------------------------------------

// Tolerant load: a truncated or corrupt line (e.g. a process killed
// mid-append) fails closed rather than silently dropping or accepting
// partial data. Names the exact line number and gives a repair instruction;
// never auto-truncates or otherwise mutates the caller's journal file.
function readJournal(journalPath) {
  if (!fs.existsSync(journalPath)) return [];
  const text = fs.readFileSync(journalPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue; // blank lines (incl. the trailing newline split) are not errors
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (err) {
      const lineNo = i + 1;
      const isFinal = lines.slice(i + 1).every((l) => l === '');
      throw new Error(
        `${journalPath} line ${lineNo} is truncated or corrupt${isFinal ? ' (appears to be an incomplete final write, e.g. a process killed mid-append)' : ''} -- refusing to load the journal. ` +
          `Repair instruction: open ${journalPath}, inspect line ${lineNo} by hand, and either complete/fix its JSON or delete that single line if you have confirmed it is a partial write from a crashed import. Do not auto-truncate; the rest of the journal is append-only history and must be preserved.`
      );
    }
    out.push(entry);
  }
  return out;
}

function appendJournalLine(journalPath, entry) {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.appendFileSync(journalPath, `${JSON.stringify(entry)}\n`);
}

// Resolves what this turn's absolute_day_start IS (or would be), without
// writing anything. First ingestion: the cumulative offset (sum of every
// already-journaled turn's ticks, in append order) -- not yet appended.
// Re-ingestion of a known turn_id: reuses the journaled absolute_day_start
// and requires payload_hash to match -- mismatch is a fail-closed refusal,
// never a silent reassignment. Call commitJournalEntry() afterward (only
// once the caller's output has actually been written) to make a new
// ingestion durable.
function planAbsoluteDayStart(journal, turnId, ticks, payloadHash) {
  const existing = journal.find((e) => e.turn_id === turnId);
  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      throw new Error(
        `turn_id "${turnId}" is already journaled with payload_hash ${existing.payload_hash}, but this import computed ${payloadHash} -- fail-closed refusal (absolute_day_start is frozen at first ingestion and is never silently reassigned)`
      );
    }
    return { absoluteDayStart: existing.absolute_day_start, isNew: false };
  }
  const cumulativeTicks = journal.reduce((acc, e) => acc + e.ticks, 0);
  return { absoluteDayStart: cumulativeTicks, isNew: true };
}

// Makes a new ingestion durable. Must only be called AFTER the output file
// has been validated, written, and renamed into place -- see the ordering
// note in importTurn(). A failure at any point before this call leaves the
// journal completely untouched.
function commitJournalEntry(journalPath, turnId, ticks, absoluteDayStart, payloadHash, ingestedAt) {
  appendJournalLine(journalPath, {
    turn_id: turnId,
    ticks,
    absolute_day_start: absoluteDayStart,
    ingested_at: ingestedAt,
    payload_hash: payloadHash
  });
}

// --- journal lock (import-index.jsonl.lock) ---------------------------------
//
// Exclusive lock protecting the read-journal / decide / write-output /
// append-journal sequence from concurrent import-turn.js invocations.
// Created with O_EXCL ('wx') so acquisition itself is atomic. Content is
// {pid, acquired_at} -- used only for stale-lock detection (a lock whose
// pid is no longer alive is dead weight from a crashed process, and is
// safe to reclaim). A live pid's lock is never broken automatically.

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false; // no such process -- definitely dead
    return true; // EPERM etc -- process exists, just not ours; treat as alive/held
  }
}

function acquireLock(journalPath) {
  const lockPath = `${journalPath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`;
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, payload);
    fs.closeSync(fd);
    return lockPath;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  let existing = null;
  let readError = null;
  try {
    existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    readError = err;
  }
  if (!existing || typeof existing.pid !== 'number') {
    throw new Error(
      `lock file ${lockPath} exists but its content is missing or unreadable (${readError ? readError.message : 'no pid field'}) -- refusing to proceed. If you have confirmed no import-turn.js process is running, delete ${lockPath} by hand and retry.`
    );
  }
  if (isPidAlive(existing.pid)) {
    throw new Error(
      `import lock held by pid ${existing.pid} since ${existing.acquired_at} (${lockPath}) -- another import-turn.js run appears to be in progress. Refusing to proceed to avoid a concurrent journal write. If that process is confirmed gone, delete ${lockPath} by hand and retry.`
    );
  }
  // Stale: the pid that took the lock is no longer alive. Reclaim it.
  fs.unlinkSync(lockPath);
  return acquireLock(journalPath);
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Positive-integer guard for the shuffle count, shared by the CLI arg
// parser and the importTurn() library entry point -- 0, negative, and
// fractional shuffle counts are rejected rather than silently coerced.
function assertPositiveInt(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

// --- main --------------------------------------------------------------------

function importTurn(harvestDir, opts) {
  const options = opts || {};
  const outDir = options.outDir || __dirname;
  const shuffles =
    options.shuffles === undefined || options.shuffles === null
      ? DEFAULT_SHUFFLES
      : assertPositiveInt(options.shuffles, 'shuffles');

  const resolvedHarvestDir = path.resolve(harvestDir);
  const runSubdir = findRunSubdir(resolvedHarvestDir);
  const runName = path.basename(runSubdir);

  const resultManifest = readManifest(path.join(runSubdir, 'RESULT-MANIFEST.txt'));
  const harvestManifest = readManifest(path.join(resolvedHarvestDir, 'HARVEST-MANIFEST.txt'));
  const pullManifest = readManifest(path.join(resolvedHarvestDir, 'PULL-MANIFEST.txt'));

  const worldStateCheck = verifyFile(runSubdir, runName, 'world-state.json', resultManifest, harvestManifest, pullManifest);
  const turnProjectionCheck = verifyFile(
    runSubdir,
    runName,
    'turn-projection.json',
    resultManifest,
    harvestManifest,
    pullManifest
  );

  const worldState = JSON.parse(fs.readFileSync(path.join(runSubdir, 'world-state.json'), 'utf8'));
  const turnProjection = JSON.parse(fs.readFileSync(path.join(runSubdir, 'turn-projection.json'), 'utf8'));

  const turnId = turnProjection.run_name;
  const ticks = turnProjection.ticks;
  if (!turnId) throw new Error('turn-projection.json is missing run_name -- cannot derive turn_id');
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error('turn-projection.json ticks must be a non-negative integer');
  }

  // payload_hash: sha256 over the sorted (path, sha256) pairs verified
  // against the manifest chain above -- stable across re-imports of the
  // same harvest directory; this is the freeze/verify key in the journal.
  const payloadEntries = [
    `${runName}/world-state.json:${worldStateCheck.sha256}`,
    `${runName}/turn-projection.json:${turnProjectionCheck.sha256}`
  ].sort();
  const payloadHash = crypto.createHash('sha256').update(payloadEntries.join('\n')).digest('hex');

  const journalPath = path.join(outDir, 'import-index.jsonl');
  const ingestedAt = new Date().toISOString();

  // Everything from here on touches the journal or the output file it
  // guards, so it all happens under one exclusive lock: a second
  // concurrent import-turn.js invocation refuses outright rather than
  // interleaving with this one (see acquireLock() above).
  const lockPath = acquireLock(journalPath);
  let outPath;
  try {
    const journal = readJournal(journalPath);
    const { absoluteDayStart, isNew } = planAbsoluteDayStart(journal, turnId, ticks, payloadHash);

    const buildLedger = deriveBuildLedger(worldState);
    const mirror = deriveMirror(worldState, turnId, shuffles);

    const doc = buildDoc({
      turnId,
      ticks,
      absoluteDayStart,
      payloadHash,
      worldState,
      turnProjection,
      buildLedger,
      mirror,
      receipts: [...worldStateCheck.receipts, ...turnProjectionCheck.receipts]
    });

    // Test-only hook (never exposed as a documented CLI flag): lets the
    // failure-mode test suite prove that a schema-validation failure
    // leaves the journal untouched, without needing to corrupt a real
    // fixture to trigger it. No-op unless explicitly opted into.
    if (options.__debugForceSchemaFail) {
      delete doc.provenance;
    }

    const shapeValid = validateShape(doc);
    if (!shapeValid) {
      const details = (validateShape.errors || []).map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ');
      throw new Error(`emitted document failed schema validation, refusing to write: ${details}`);
    }

    // Derive -> validate -> write-to-temp -> rename-into-place, ALL before
    // the journal is touched. Any failure above this line leaves both the
    // output file and the journal completely untouched. Only after the
    // rename below has succeeded do we append the (single, atomic) journal
    // line -- so a failed import can never orphan a timeline entry, and a
    // successful output write can never be left unjournaled while holding
    // the lock.
    outPath = path.join(outDir, `unreal-import__${turnId}.json`);
    fs.mkdirSync(outDir, { recursive: true });
    const tmp = `${outPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
    fs.renameSync(tmp, outPath);

    if (isNew) {
      commitJournalEntry(journalPath, turnId, ticks, absoluteDayStart, payloadHash, ingestedAt);
    }

    return { doc, outPath, journalPath };
  } finally {
    releaseLock(lockPath);
  }
}

function buildDoc({ turnId, ticks, absoluteDayStart, payloadHash, worldState, turnProjection, buildLedger, mirror, receipts }) {
  return {
    schema: 'UnrealImport/1.0',
    turn_id: turnId,
    source: {
      geometry_log: worldState.geometry_log || [],
      resources: worldState.resources || {},
      prey_population: worldState.prey_population,
      predator_population: worldState.predator_population,
      territory: worldState.territory || {},
      food_source_coords: worldState.food_source_coords || {},
      food_sources: worldState.food_sources || {},
      wood_sources: worldState.wood_sources || {},
      stone_sources: worldState.stone_sources || {},
      clay_sources: worldState.clay_sources || {},
      water_sources: worldState.water_sources || {},
      ore_sources: worldState.ore_sources || {},
      fiber_sources: worldState.fiber_sources || {},
      seq: worldState.seq,
      complete: worldState.complete,
      written_at: worldState.written_at,
      schema_version: worldState.schema_version
    },
    derived: {
      build_ledger: buildLedger,
      mirror
    },
    provenance: {
      turn_id: turnId,
      ticks,
      absolute_day_start: absoluteDayStart,
      payload_hash: payloadHash,
      receipts
    },
    advisory: {
      mind_state: turnProjection.mind_state === undefined ? null : turnProjection.mind_state,
      resume_continuity: turnProjection.resume_continuity === undefined ? null : turnProjection.resume_continuity
    }
  };
}

module.exports = {
  importTurn,
  parseManifest,
  mulberry32,
  fnv1a32,
  seededPermutationTest,
  deriveBuildLedger,
  deriveMirror
};

if (require.main === module) {
  const harvestDir = process.argv[2];
  if (!harvestDir || harvestDir.startsWith('--')) {
    process.stderr.write('usage: import-turn.js <harvest-dir> [--out-dir <dir>] [--shuffles <n>]\n');
    process.exit(2);
  }
  const outDir = argVal('--out-dir', null);
  const shufflesRaw = argVal('--shuffles', String(DEFAULT_SHUFFLES));
  let shuffles;
  try {
    if (!/^[0-9]+$/.test(shufflesRaw.trim())) {
      throw new Error(`--shuffles must be a positive integer, got "${shufflesRaw}"`);
    }
    shuffles = assertPositiveInt(parseInt(shufflesRaw, 10), '--shuffles');
  } catch (err) {
    process.stderr.write(`import-turn.js: ${err.message}\n`);
    process.exit(2);
  }
  // Undocumented test-only hook -- see the __debugForceSchemaFail comment
  // in importTurn(). Not part of the public usage banner.
  const debugForceSchemaFail = hasFlag('--debug-force-schema-fail');
  try {
    const { outPath, journalPath, doc } = importTurn(harvestDir, {
      outDir,
      shuffles,
      __debugForceSchemaFail: debugForceSchemaFail
    });
    process.stdout.write(
      `imported turn_id=${doc.turn_id} absolute_day_start=${doc.provenance.absolute_day_start} payload_hash=${doc.provenance.payload_hash} -> ${outPath} (journal: ${journalPath})\n`
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`import-turn.js: ${err.message}\n`);
    process.exit(1);
  }
}
