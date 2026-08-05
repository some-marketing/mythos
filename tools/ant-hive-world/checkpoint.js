#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/checkpoint.js — CheckpointManifest/1.0: generation-level
// atomic checkpoint write, five-stage fail-closed validation, and restore.
//
// Plan: ant-world-checkpoint-loader (S0 + S1). Contract source: the convene
// synthesis 20260805T014353Z, hardened across codex rounds r1-r4.
//
// THE ATOMICITY CONTRACT, in one paragraph, because everything else here is a
// consequence of it: a checkpoint is ONE generation directory,
// gen-<absolute_day>-<run_name>/. Every authoritative state file (mind, world,
// rng, identity) is written into a staging directory first, each file fsynced,
// each file's sha256 recorded; the staging directory is then renamed to the
// generation's final path -- at which point the generation exists but is
// UNCOMMITTED and therefore invalid by definition -- and only then is
// manifest.json renamed into place. The arrival of a checksum-valid manifest at
// <generation>/manifest.json IS the single commit token. There is no separate
// marker file, because a second file means a second failure mode: a marker
// present with a torn manifest, or a manifest present with a missing marker,
// and no rule that says which one wins. One token, one rule.
//
// Three standing rules follow:
//   RECOVERY   an uncommitted generation is swept (deleted) on next start. It
//              is not repairable and it is not evidence -- it is the residue of
//              a write that did not finish.
//   RETENTION  the newest COMMITTED generation is last-known-good and is NEVER
//              auto-deleted, by this module or by anything calling it. Manual
//              operator recovery is the only path that removes one.
//   COLLISION  a generation id that already names a COMMITTED generation is a
//              fail-closed refusal (STATUS=checkpoint-collision:<id>). Never
//              overwrite, never auto-suffix: both silently destroy or silently
//              fork a lineage, and a lineage that forks silently cannot support
//              a continuity claim. The caller must choose a new run_name.
//
// Nothing here ever touches the courier. Checkpoints are guest-local under
// _dev/state/checkpoints/ (or a caller-supplied --checkpoint-root).

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const Ajv = require('ajv');

const {
  INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE, VERB_ORDER, RESOURCE_NORM_K, mulberry32
} = require('./untrained-network.js');
const { VERBS } = require('./harness.js');
const {
  WORLD_INPUT_SIZE, WORLD_HIDDEN_SIZE, WORLD_OUTPUT_SIZE, WORLD_VERB_ORDER,
  WORLD_MIND_RESOURCE_NORM_K, ACTUAL_WORLD_MIND_SHAPE, serializeWorldMind, restoreWorldMind
} = require('./world-mind.js');
const CHECKPOINT_SCHEMA = require('./checkpoint-schema.json');

// draft-07 (matches checkpoint-schema.json's $schema); same pattern as
// validate-hive-mind.js's Ajv2020 use for the 2020-12 hive-mind schema, just
// pointed at the older draft this manifest schema declares.
const ajv = new Ajv({ allErrors: true, strict: true });
const validateManifestShape = ajv.compile(CHECKPOINT_SCHEMA);

const SCHEMA = 'CheckpointManifest/1.0';
const SCHEMA_VERSION = '1.0';
// Bump whenever the MEANING of any state file's fields changes. Compared for
// exact equality at validation stage 3: a checkpoint written by different
// serialization code is not resumable, because the field-by-field meaning of
// the state files is exactly what changed.
const CHECKPOINT_CODE_VERSION = 'ant-hive-world-checkpoint-1.0.0';

const MANIFEST_NAME = 'manifest.json';
const STATE_FILES = ['mind.json', 'rng.json', 'world.json', 'identity.json'];
const STAGING_PREFIX = '.staging-';
const MANIFEST_TMP = '.manifest.json.tmp';

// Named refusal reasons, so a STATUS string is a machine-readable fact and not
// a sentence someone has to parse.
const STAGES = Object.freeze({
  EXISTS: 'exists',
  COMMITTED: 'committed',
  IDENTITY: 'identity',
  VERSION: 'version',
  CHECKSUMS: 'checksums',
  INPUT_PACKET: 'input-packet',
  LINEAGE: 'lineage'
});

class CheckpointCollisionError extends Error {
  constructor(generationId) {
    super(`checkpoint-collision:${generationId}`);
    this.name = 'CheckpointCollisionError';
    this.status = `checkpoint-collision:${generationId}`;
    this.generationId = generationId;
  }
}

// ---------------------------------------------------------------------------
// Serializable RNG (state-inventory.md H1)
// ---------------------------------------------------------------------------
// untrained-network.js's mulberry32 holds its entire state in a closure
// variable with no accessor, so a live stream cannot be captured as written.
// This is the SAME recurrence, transcribed line for line, with getState/
// setState added. untrained-network.js is deliberately NOT modified: it is
// outside this plan's write set, and a checkpoint contract has no business
// editing the learning core. assertRngParity() below proves the two generators
// emit identical sequences, so using this one changes no behavior.
function createSerializableRng(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // int32 (signed) -- exactly the representation mulberry32 carries after its
  // first `a |= 0`, and JSON-safe without precision loss.
  fn.getState = function () { return a | 0; };
  fn.setState = function (state) { a = state | 0; };
  fn.seed = seed >>> 0;
  return fn;
}

// Falsifier for "this generator is mulberry32": draw N values from both and
// compare. Called once at driver start; throws rather than warns, because a
// silent divergence here would invalidate every continuity claim downstream.
function assertRngParity(draws = 4096, seeds = [0, 1, 12345, 2166136261, 4294967295]) {
  for (const seed of seeds) {
    const reference = mulberry32(seed);
    const serializable = createSerializableRng(seed);
    for (let i = 0; i < draws; i++) {
      const a = reference();
      const b = serializable();
      if (a !== b) {
        throw new Error(
          `RNG parity broken: seed=${seed} draw=${i} mulberry32=${a} serializable=${b}`
        );
      }
    }
  }
  return { ok: true, seeds, draws };
}

// ---------------------------------------------------------------------------
// Canonical serialization + hashing
// ---------------------------------------------------------------------------
// Deterministic key ordering. Byte-identity of save -> load -> save is the S1
// falsifier for complete state coverage, and it only means something if the
// serializer itself is deterministic: JS object key order is insertion order,
// which a restore path can trivially permute.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue; // JSON drops these anyway; be explicit
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value), null, 2) + '\n';
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

// ---------------------------------------------------------------------------
// Architecture descriptor
// ---------------------------------------------------------------------------
// Restoring an [8][9] weight matrix into a differently-shaped network is silent
// corruption, not continuity -- and verb ORDER is just as load-bearing as
// shape, since a network's output index means a verb only by position.
function architectureDescriptor() {
  const desc = {
    hive: {
      input_size: INPUT_SIZE,
      hidden_size: HIDDEN_SIZE,
      output_size: OUTPUT_SIZE,
      // LEARNING_RATE is not exported by untrained-network.js; it is pinned
      // here as the value that module ships (0.05). A drift between the two is
      // caught by the architecture hash only if this constant is maintained --
      // recorded as a known limitation in the S3 verdict rather than hidden.
      learning_rate: 0.05,
      resource_norm_k: RESOURCE_NORM_K
    },
    world_mind: {
      input_size: WORLD_INPUT_SIZE,
      hidden_size: WORLD_HIDDEN_SIZE,
      output_size: WORLD_OUTPUT_SIZE,
      resource_norm_k: WORLD_MIND_RESOURCE_NORM_K,
      // The DECLARED sizes above and the shape the engine actually builds do
      // not currently agree -- see the defect note in world-mind.js. Both are
      // hashed, so the architecture hash catches drift in either one, and a
      // future repair of the defect correctly invalidates old checkpoints
      // instead of silently loading weights into a re-shaped network.
      actual_shape: {
        w1_rows: ACTUAL_WORLD_MIND_SHAPE.w1_rows,
        w1_cols: ACTUAL_WORLD_MIND_SHAPE.w1_cols,
        w2_rows: ACTUAL_WORLD_MIND_SHAPE.w2_rows,
        w2_cols: ACTUAL_WORLD_MIND_SHAPE.w2_cols,
        matches_declared: ACTUAL_WORLD_MIND_SHAPE.matches_declared
      }
    },
    verbs: {
      hive_verb_order: VERB_ORDER.slice(),
      harness_verbs: VERBS.slice(),
      world_verb_order: WORLD_VERB_ORDER.slice()
    }
  };
  desc.hash = sha256Hex(canonicalJson(desc));
  return desc;
}

// ---------------------------------------------------------------------------
// Generation identity
// ---------------------------------------------------------------------------
const GENERATION_ID_RE = /^gen-[0-9]+-[A-Za-z0-9._-]+$/;

function generationId(absoluteDay, runName) {
  const id = `gen-${absoluteDay}-${runName}`;
  if (!GENERATION_ID_RE.test(id)) {
    throw new Error(
      `invalid generation id ${JSON.stringify(id)}: run_name must match [A-Za-z0-9._-]+ and absolute_day must be a non-negative integer`
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Durability primitives
// ---------------------------------------------------------------------------
function fsyncPath(target) {
  // Directories need O_RDONLY on both macOS and Linux; files are opened 'r+'
  // so the fsync is a real flush of the data we just wrote.
  let fd;
  try {
    fd = fs.openSync(target, fs.statSync(target).isDirectory() ? 'r' : 'r+');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeFileSynced(filePath, contents) {
  fs.writeFileSync(filePath, contents);
  fsyncPath(filePath);
}

// ---------------------------------------------------------------------------
// Manifest read + commit-token evaluation
// ---------------------------------------------------------------------------
// "Committed" is not a flag anyone sets. It is: manifest.json is present at the
// generation's final path, parses, declares this schema, and its own
// self-checksum holds. Anything else is uncommitted.
function readManifest(generationDir) {
  const manifestPath = path.join(generationDir, MANIFEST_NAME);
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return { committed: false, reason: 'manifest-absent', manifest: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { committed: false, reason: 'manifest-unparseable', manifest: null };
  }
  if (!manifest || manifest.schema !== SCHEMA) {
    return { committed: false, reason: 'manifest-schema-mismatch', manifest };
  }
  const declared = manifest.manifest_self_checksum;
  if (typeof declared !== 'string' || !/^[a-f0-9]{64}$/.test(declared)) {
    return { committed: false, reason: 'manifest-self-checksum-missing', manifest };
  }
  const { manifest_self_checksum: _omit, ...body } = manifest;
  const actual = sha256Hex(canonicalJson(body));
  if (actual !== declared) {
    return { committed: false, reason: 'manifest-self-checksum-mismatch', manifest, expected: declared, actual };
  }
  // Runtime schema validation (ajv, same pattern as validate-hive-mind.js): a
  // manifest can be checksum-self-consistent and still not be a
  // CheckpointManifest/1.0 document -- e.g. a field with the wrong type
  // written by future/foreign code that happens to reproduce this exact
  // schema+checksum shape. Checked here, inside "committed", because a
  // manifest that fails its own declared schema is not a trustworthy commit
  // token regardless of what its self-checksum says.
  if (!validateManifestShape(manifest)) {
    const detail = (validateManifestShape.errors || [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
      .join('; ')
      .replace(/[^A-Za-z0-9.-]+/g, '-');
    return { committed: false, reason: `manifest-schema-invalid-${detail}`, manifest, schemaErrors: validateManifestShape.errors };
  }
  return { committed: true, reason: null, manifest };
}

function isCommitted(generationDir) {
  return readManifest(generationDir).committed;
}

// ---------------------------------------------------------------------------
// RECOVERY RULE: sweep uncommitted generations on start
// ---------------------------------------------------------------------------
// Deletes: leftover staging directories, and any generation directory without a
// checksum-valid manifest. Never touches a committed generation -- that is the
// retention rule, and it is enforced here by construction, not by a caller
// remembering to be careful.
//
// `opts.exempt` is a list of generation ids the sweep must leave alone even
// when uncommitted. The resume gate passes the generation the caller asked to
// resume from, for two reasons: sweeping it would destroy the evidence an
// operator needs in order to repair it, and reporting "generation-dir-absent"
// for a directory that plainly exists is a worse diagnostic than reporting the
// precise stage-2 reason it is not committed. Halt-for-repair is only useful if
// the refusal names the actual defect.
function sweepUncommitted(checkpointRoot, opts = {}) {
  const exempt = new Set(opts.exempt || []);
  const swept = [];
  const retained = [];
  const exempted = [];
  let entries;
  try {
    entries = fs.readdirSync(checkpointRoot, { withFileTypes: true });
  } catch {
    return { swept, retained, exempted };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(checkpointRoot, entry.name);
    if (exempt.has(entry.name)) {
      exempted.push(entry.name);
      continue;
    }
    if (entry.name.startsWith(STAGING_PREFIX)) {
      fs.rmSync(dir, { recursive: true, force: true });
      swept.push({ name: entry.name, reason: 'staging-residue' });
      continue;
    }
    if (!GENERATION_ID_RE.test(entry.name)) continue; // not ours; leave it alone
    const state = readManifest(dir);
    if (state.committed) {
      retained.push(entry.name);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      swept.push({ name: entry.name, reason: state.reason });
    }
  }
  swept.sort((a, b) => a.name.localeCompare(b.name));
  retained.sort();
  exempted.sort();
  return { swept, retained, exempted };
}

function listCommittedGenerations(checkpointRoot) {
  let entries;
  try {
    entries = fs.readdirSync(checkpointRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && GENERATION_ID_RE.test(e.name))
    .map((e) => ({ id: e.name, state: readManifest(path.join(checkpointRoot, e.name)) }))
    .filter((g) => g.state.committed)
    .map((g) => ({
      generation_id: g.id,
      absolute_day: g.state.manifest.absolute_day,
      manifest_checksum: g.state.manifest.manifest_self_checksum
    }))
    .sort((a, b) => a.absolute_day - b.absolute_day || a.generation_id.localeCompare(b.generation_id));
}

// ---------------------------------------------------------------------------
// State serialization (state-inventory.md section 7 coverage map)
// ---------------------------------------------------------------------------
function serializeNetwork(network) {
  return {
    W1: network.W1.map((row) => row.slice()),
    b1: network.b1.slice(),
    W2: network.W2.map((row) => row.slice()),
    b2: network.b2.slice()
  };
}

function deserializeNetwork(payload) {
  return {
    W1: payload.W1.map((row) => row.slice()),
    b1: payload.b1.slice(),
    W2: payload.W2.map((row) => row.slice()),
    b2: payload.b2.slice()
  };
}

function serializeController(controller) {
  return {
    active: Boolean(controller.active),
    // undefined is a MEANINGFUL value here (no measurement yet); JSON has no
    // undefined, so it is encoded as null and decoded back to undefined.
    prev_post_update_entropy: controller.prev_post_update_entropy === undefined
      ? null
      : controller.prev_post_update_entropy
  };
}

function deserializeController(payload) {
  return {
    active: Boolean(payload.active),
    prev_post_update_entropy: payload.prev_post_update_entropy === null
      ? undefined
      : payload.prev_post_update_entropy
  };
}

// Byte length of each append-only log at checkpoint time (H7). On restore into
// a sandbox that already holds a longer version of the same log, the log is
// truncated back to the cursor -- otherwise a resumed run double-appends and
// the evidence is corrupt.
function captureLogCursors(sandboxRoot, hiveIds) {
  const cursors = {};
  const add = (relPath) => {
    const abs = path.join(sandboxRoot, relPath);
    try {
      cursors[relPath] = fs.statSync(abs).size;
    } catch {
      cursors[relPath] = 0;
    }
  };
  add('run-log.jsonl');
  add('decision-stream.jsonl');
  for (const id of hiveIds) add(path.join(id, 'audit-log.jsonl'));
  return cursors;
}

function applyLogCursors(sandboxRoot, cursors) {
  const applied = [];
  for (const [relPath, cursor] of Object.entries(cursors || {})) {
    const abs = path.join(sandboxRoot, relPath);
    let size;
    try {
      size = fs.statSync(abs).size;
    } catch {
      applied.push({ path: relPath, cursor, action: 'absent' });
      continue;
    }
    if (size > cursor) {
      fs.truncateSync(abs, cursor);
      applied.push({ path: relPath, cursor, action: 'truncated', from: size });
    } else {
      applied.push({ path: relPath, cursor, action: size === cursor ? 'match' : 'shorter', actual: size });
    }
  }
  return applied;
}

// ---------------------------------------------------------------------------
// WRITER: commit one generation
// ---------------------------------------------------------------------------
// `state` is the full live-state bundle assembled by the driver:
//   { networks, worldMind, controllers, rngStates, worldState, hiveStates,
//     liveConfig, logCursors, identity, parent, inputPacket, goal,
//     absoluteTick, absoluteDay, runName }
function commitGeneration(checkpointRoot, state) {
  const id = generationId(state.absoluteDay, state.runName);
  const finalDir = path.join(checkpointRoot, id);
  const staging = path.join(checkpointRoot, `${STAGING_PREFIX}${id}-${process.pid}`);

  fs.mkdirSync(checkpointRoot, { recursive: true });

  // COLLISION RULE. Checked before any bytes are written, and re-checked at
  // both rename boundaries below -- this is a single-writer design (one driver
  // per sandbox), so the re-checks close the window against a stray concurrent
  // writer rather than providing a real lock. A real lock would be a stronger
  // claim than this code can support, so it is not claimed.
  if (fs.existsSync(finalDir)) {
    if (isCommitted(finalDir)) throw new CheckpointCollisionError(id);
    // Uncommitted residue at the target path: invalid by definition, swept.
    fs.rmSync(finalDir, { recursive: true, force: true });
  }

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const hiveIds = Object.keys(state.networks).sort();

  const mind = {
    hives: Object.fromEntries(hiveIds.map((hid) => [hid, {
      network: serializeNetwork(state.networks[hid]),
      controller: serializeController(state.controllers[hid])
    }])),
    // Via world-mind.js's own serializer, not the generic one: the world mind
    // owns the definition of what its state IS, and a future world-level
    // optimizer accumulator should have exactly one place to be added.
    world_mind: { network: serializeWorldMind(state.worldMind) }
  };

  const rng = {
    streams: Object.fromEntries(Object.entries(state.rngStates).map(([sid, s]) => [sid, {
      algorithm: 'mulberry32',
      seed: s.seed,
      state: s.state
    }])),
    construction_seeds: state.constructionSeeds
  };

  const world = {
    world_state: state.worldState,
    hives: Object.fromEntries(hiveIds.map((hid) => [hid, { hive_state: state.hiveStates[hid] }])),
    live_config: state.liveConfig,
    log_cursors: state.logCursors
  };

  const identity = {
    absolute_tick: state.absoluteTick,
    absolute_day: state.absoluteDay,
    run_name: state.runName,
    event_context: state.identity.event_context,
    turn_index: state.identity.turn_index,
    root_seed: state.identity.root_seed,
    root_seed_source: state.identity.root_seed_source,
    fresh_start: state.identity.fresh_start,
    parent_run_id: state.identity.parent_run_id === undefined ? null : state.identity.parent_run_id,
    parent_episode_id: state.identity.parent_episode_id === undefined ? null : state.identity.parent_episode_id,
    hives: Object.fromEntries(hiveIds.map((hid) => [hid, {
      next_event_tick: state.nextEventTicks ? (state.nextEventTicks[hid] ?? null) : null
    }]))
  };

  const payloads = {
    'mind.json': canonicalJson(mind),
    'rng.json': canonicalJson(rng),
    'world.json': canonicalJson(world),
    'identity.json': canonicalJson(identity)
  };

  const files = [];
  for (const name of STATE_FILES) {
    const filePath = path.join(staging, name);
    writeFileSynced(filePath, payloads[name]);
    const buf = Buffer.from(payloads[name]);
    files.push({ path: name, sha256: sha256Hex(buf), bytes: buf.length });
  }
  fsyncPath(staging);

  const architecture = architectureDescriptor();
  const manifestBody = {
    schema: SCHEMA,
    schema_version: SCHEMA_VERSION,
    code_version: CHECKPOINT_CODE_VERSION,
    generation_id: id,
    absolute_day: state.absoluteDay,
    absolute_tick: state.absoluteTick,
    run_name: state.runName,
    created_at: new Date().toISOString(),
    parent: {
      generation_id: state.parent ? state.parent.generation_id : null,
      manifest_checksum: state.parent ? state.parent.manifest_checksum : null,
      lineage_depth: state.parent ? state.parent.lineage_depth + 1 : 0
    },
    identity: {
      run_id: state.identity.event_context.run_id,
      episode_id: state.identity.event_context.episode_id,
      arm_id: state.identity.event_context.arm_id,
      turn_index: state.identity.turn_index,
      root_seed: state.identity.root_seed,
      root_seed_source: state.identity.root_seed_source,
      fresh_start: state.identity.fresh_start,
      parent_run_id: state.identity.parent_run_id === undefined ? null : state.identity.parent_run_id,
      parent_episode_id: state.identity.parent_episode_id === undefined ? null : state.identity.parent_episode_id
    },
    architecture,
    files,
    input_packet: state.inputPacket || { present: false, sha256: null },
    goal: state.goal === undefined ? null : state.goal
  };
  const manifest = {
    ...manifestBody,
    manifest_self_checksum: sha256Hex(canonicalJson(manifestBody))
  };

  // COMMIT BOUNDARY, part 1: the staged generation arrives at its final path
  // WITHOUT a manifest. It is now visible and still, correctly, invalid.
  if (fs.existsSync(finalDir) && isCommitted(finalDir)) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new CheckpointCollisionError(id);
  }
  fs.renameSync(staging, finalDir);
  fsyncPath(checkpointRoot);

  // COMMIT BOUNDARY, part 2: the manifest is written to a dot-prefixed temp
  // inside the generation and renamed to its final name. THIS rename is the
  // commit. Everything before it is reversible; nothing after it is needed.
  const tmpManifest = path.join(finalDir, MANIFEST_TMP);
  writeFileSynced(tmpManifest, canonicalJson(manifest));
  fs.renameSync(tmpManifest, path.join(finalDir, MANIFEST_NAME));
  fsyncPath(finalDir);

  return { generation_id: id, dir: finalDir, manifest };
}

// ---------------------------------------------------------------------------
// VALIDATOR: seven stages, each failing closed, in this order
// ---------------------------------------------------------------------------
// Returns { ok: true, manifest, dir, stages_passed } or
//         { ok: false, stage, reason, status } where status is exactly
//         `resume-failed-halt:<stage>:<reason>`.
// NOTHING here mutates state, on any path. The caller must have constructed no
// state object before calling this.
//
// opts.currentInputPacket, when supplied, is compared against the manifest's
// frozen input_packet at the INPUT_PACKET stage (see below). Omitting it
// skips that stage entirely -- inspection/tooling callers that have no
// current-run input packet to compare get no opinion on this axis; the CLI
// driver (run-live.js) always supplies it, which is what actually enforces
// the freeze on resume.
function validateGeneration(checkpointRoot, id, opts = {}) {
  const fail = (stage, reason) => ({
    ok: false,
    stage,
    reason,
    status: `resume-failed-halt:${stage}:${reason}`
  });

  if (typeof id !== 'string' || !GENERATION_ID_RE.test(id)) {
    return fail(STAGES.EXISTS, 'malformed-generation-id');
  }
  const dir = path.join(checkpointRoot, id);

  // STAGE 1 -- exists
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return fail(STAGES.EXISTS, 'generation-dir-absent');
  }
  if (!stat.isDirectory()) return fail(STAGES.EXISTS, 'generation-path-not-a-directory');

  // STAGE 2 -- committed manifest present and self-consistent (checksum AND
  // schema-valid; see readManifest's ajv check).
  const read = readManifest(dir);
  if (!read.committed) return fail(STAGES.COMMITTED, read.reason);
  const manifest = read.manifest;

  // STAGE 2.5 -- generation identity. manifest.generation_id is written once,
  // at commit time, from the SAME id used to build the directory path
  // (commitGeneration's `id`); nothing after that ever re-derives it from the
  // directory name. A directory renamed on disk (operator `mv`, backup tool,
  // manual repair) carries an unchanged manifest.generation_id, so without
  // this check a renamed generation resumes silently under a false identity
  // -- lineage, parent linkage and provenance would all report the OLD name
  // while the caller resumed the NEW path. Checked against the basename, not
  // against the caller-supplied `id`: those are equal by construction
  // (dir = path.join(checkpointRoot, id)), so comparing to `id` would never
  // catch anything.
  const basename = path.basename(dir);
  if (manifest.generation_id !== basename) {
    return fail(STAGES.IDENTITY, `generation-id-mismatch-manifest-${manifest.generation_id}-dir-${basename}`);
  }

  // STAGE 3 -- schema / code / architecture compatibility
  if (manifest.schema_version !== SCHEMA_VERSION) {
    return fail(STAGES.VERSION, `schema-version-${manifest.schema_version}-expected-${SCHEMA_VERSION}`);
  }
  if (manifest.code_version !== CHECKPOINT_CODE_VERSION) {
    return fail(STAGES.VERSION, `code-version-mismatch-${manifest.code_version}`);
  }
  const liveArchitecture = architectureDescriptor();
  if (!manifest.architecture || manifest.architecture.hash !== liveArchitecture.hash) {
    return fail(STAGES.VERSION, 'architecture-hash-mismatch');
  }

  // STAGE 4 -- per-file checksums, both directions
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return fail(STAGES.CHECKSUMS, 'file-list-empty');
  }
  const listed = new Set();
  for (const entry of manifest.files) {
    const filePath = path.join(dir, entry.path);
    listed.add(entry.path);
    let buf;
    try {
      buf = fs.readFileSync(filePath);
    } catch {
      return fail(STAGES.CHECKSUMS, `file-absent-${entry.path}`);
    }
    if (buf.length !== entry.bytes) {
      return fail(STAGES.CHECKSUMS, `size-mismatch-${entry.path}`);
    }
    if (sha256Hex(buf) !== entry.sha256) {
      return fail(STAGES.CHECKSUMS, `checksum-mismatch-${entry.path}`);
    }
  }
  // Unlisted extra files are a refusal too: an attacker or a half-finished
  // write that ADDS a file is exactly as much of an integrity failure as one
  // that changes a byte, and a one-directional checksum sweep misses it.
  for (const entry of fs.readdirSync(dir)) {
    if (entry === MANIFEST_NAME) continue;
    if (!listed.has(entry)) return fail(STAGES.CHECKSUMS, `unlisted-file-${entry}`);
  }

  // STAGE 4.5 -- input packet continuity. The manifest records the frozen
  // external decision input (world-mind-decision.json) that was in force
  // WHEN THIS GENERATION WAS WRITTEN. A resume that silently continues under
  // a DIFFERENT input packet -- or a different presence/absence of one -- is
  // not a continuation of the same run; it is a fork with the label of a
  // continuation. Only runs when the caller supplies opts.currentInputPacket
  // ({ present, sha256 }); callers that have no current-run packet to compare
  // (inspection tools, dashboards) skip this stage entirely rather than
  // getting a false pass on a comparison they never made.
  if (opts.currentInputPacket !== undefined) {
    const manifestPacket = manifest.input_packet || { present: false, sha256: null };
    const current = opts.currentInputPacket;
    const manifestPresent = Boolean(manifestPacket.present);
    const currentPresent = Boolean(current.present);
    // Presence/absence asymmetry is refused BEFORE any checksum comparison:
    // a packet that appeared or disappeared between commit and resume is a
    // change to the frozen input regardless of what either hash says.
    if (manifestPresent !== currentPresent) {
      return fail(
        STAGES.INPUT_PACKET,
        `presence-mismatch-manifest-${manifestPresent}-current-${currentPresent}`
      );
    }
    if (manifestPresent && manifestPacket.sha256 !== current.sha256) {
      return fail(STAGES.INPUT_PACKET, 'checksum-mismatch');
    }
  }

  // STAGE 5 -- parent linkage continuity
  const parent = manifest.parent || {};
  if (parent.generation_id === null || parent.generation_id === undefined) {
    if (parent.lineage_depth !== 0) return fail(STAGES.LINEAGE, 'root-with-nonzero-depth');
  } else {
    const parentDir = path.join(checkpointRoot, parent.generation_id);
    const parentRead = readManifest(parentDir);
    if (!parentRead.committed) {
      // Nothing in this system auto-deletes a committed generation (retention
      // rule), so an absent or uncommitted parent means the lineage was
      // truncated or tampered with. That is precisely what halt-for-repair is
      // for; silently accepting it would let a broken lineage carry a
      // continuity claim.
      return fail(STAGES.LINEAGE, `parent-not-committed-${parentRead.reason}`);
    }
    if (parentRead.manifest.manifest_self_checksum !== parent.manifest_checksum) {
      return fail(STAGES.LINEAGE, 'parent-checksum-mismatch');
    }
    if (parentRead.manifest.parent.lineage_depth + 1 !== parent.lineage_depth) {
      return fail(STAGES.LINEAGE, 'lineage-depth-discontinuity');
    }
    if (parentRead.manifest.absolute_tick > manifest.absolute_tick) {
      return fail(STAGES.LINEAGE, 'absolute-tick-regression');
    }
  }

  const stagesPassed = Object.values(STAGES).filter(
    (s) => s !== STAGES.INPUT_PACKET || opts.currentInputPacket !== undefined
  );
  return { ok: true, manifest, dir, stages_passed: stagesPassed };
}

// ---------------------------------------------------------------------------
// LOADER: read a VALIDATED generation into a restore payload
// ---------------------------------------------------------------------------
// Only ever called after validateGeneration returned ok. Re-reads from disk
// rather than trusting anything cached, and re-verifies each file's checksum on
// the way in -- cheap, and it means the loader alone is enough to make the
// integrity claim even if the call order is ever refactored.
function loadGeneration(checkpointRoot, id, opts = {}) {
  const validation = validateGeneration(checkpointRoot, id, opts);
  if (!validation.ok) return validation;
  const { dir, manifest } = validation;

  const byName = Object.fromEntries(manifest.files.map((f) => [f.path, f]));
  const readState = (name) => {
    const buf = fs.readFileSync(path.join(dir, name));
    if (sha256Hex(buf) !== byName[name].sha256) {
      throw new Error(`checkpoint ${id}: ${name} changed between validation and load`);
    }
    return JSON.parse(buf.toString('utf8'));
  };

  const mind = readState('mind.json');
  const rng = readState('rng.json');
  const world = readState('world.json');
  const identity = readState('identity.json');

  const networks = {};
  const controllers = {};
  for (const [hid, entry] of Object.entries(mind.hives)) {
    networks[hid] = deserializeNetwork(entry.network);
    controllers[hid] = deserializeController(entry.controller);
  }

  return {
    ok: true,
    manifest,
    dir,
    generation_id: id,
    networks,
    controllers,
    worldMind: restoreWorldMind(mind.world_mind.network),
    rngStates: rng.streams,
    constructionSeeds: rng.construction_seeds,
    worldState: world.world_state,
    hiveStates: Object.fromEntries(Object.entries(world.hives).map(([hid, h]) => [hid, h.hive_state])),
    liveConfig: world.live_config,
    logCursors: world.log_cursors,
    identity
  };
}

module.exports = {
  SCHEMA,
  SCHEMA_VERSION,
  CHECKPOINT_CODE_VERSION,
  MANIFEST_NAME,
  STATE_FILES,
  STAGES,
  GENERATION_ID_RE,
  CheckpointCollisionError,
  createSerializableRng,
  assertRngParity,
  canonicalize,
  canonicalJson,
  sha256Hex,
  sha256File,
  architectureDescriptor,
  generationId,
  readManifest,
  isCommitted,
  sweepUncommitted,
  listCommittedGenerations,
  serializeNetwork,
  deserializeNetwork,
  serializeController,
  deserializeController,
  captureLogCursors,
  applyLogCursors,
  commitGeneration,
  validateGeneration,
  loadGeneration
};
