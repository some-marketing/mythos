#!/usr/bin/env node
'use strict';

// _dev/state/checkpoint-continuity-test/run-arms.js — S3's five-arm,
// frozen-input, replicated continuity control, plus S1's save -> load -> save
// byte-identity falsifier.
//
// Everything here runs LOCALLY, in a sandbox under this directory. No VM, no
// Orwell contact, no courier. Usage:
//   node _dev/state/checkpoint-continuity-test/run-arms.js [--out <dir>]
//
// ARMS (plan ant-world-checkpoint-loader S3, codex r1 MAJOR 4 + r2 MAJOR 4):
//   A       150 ticks -> commit generation -> resume -> 150 more
//   A-PRIME 300 ticks uninterrupted, A's exact root seed and inputs
//   B       300 ticks, fresh root seed            (seeds differ)
//   C       300 ticks, A's root seed, per-stream assignment permuted
//   D       tamper a COPY of a committed generation, prove checksum refusal
//
// EQUIVALENCE STANDARD: A's post-resume decision stream (absolute ticks
// 150..299) must equal A-PRIME's ticks 150..299 byte for byte. Any divergence
// is enumerated and explained, or the arm fails.
//
// FROZEN INPUTS: no arm writes world-mind-decision.json, so the world mind's
// own RNG draw is never bypassed (state-inventory.md row 3.8); every arm's root
// seed is explicit, so no arm's behavior depends on invocation time; and the
// absence of the packet is asserted per-arm, not assumed.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DRIVER = path.join(REPO, 'tools', 'ant-hive-world', 'run-live.js');
const checkpoint = require(path.join(REPO, 'tools', 'ant-hive-world', 'checkpoint.js'));

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const OUT = path.resolve(argVal('--out', path.join(__dirname, 'runs')));
const TICKS_HALF = parseInt(argVal('--half', '150'), 10);
const TICKS_FULL = TICKS_HALF * 2;
const REPLICATES = parseInt(argVal('--replicates', '2'), 10);

// Fixed, explicit root seeds. Frozen in this file rather than generated, so a
// reviewer re-running this script reproduces the exact arms, not similar ones.
const ROOT_SEEDS = [20260805, 20260806];
const FRESH_SEEDS = [777000111, 777000222];
// Arm C's permutation: the SAME root seed produces the same three per-stream
// seeds, and this reassigns which stream gets which. That isolates "state
// carries behavior" from "seeds carry behavior" -- arm B changes the seeds, arm
// C keeps them and only changes who holds them.
const SHUFFLE = 'world,hive-a,hive-b';

const transcripts = [];

function run(label, args, opts = {}) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [DRIVER, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 256 * 1024 * 1024
  });
  const record = {
    label,
    argv: args,
    env_overrides: opts.env || {},
    exit_code: res.status,
    duration_ms: Date.now() - started,
    stdout_head: (res.stdout || '').split('\n').slice(0, 12),
    stdout_tail: (res.stdout || '').trim().split('\n').slice(-8),
    stderr: (res.stderr || '').trim().split('\n').filter(Boolean)
  };
  transcripts.push(record);
  process.stdout.write(`[${label}] exit=${res.status} ${record.duration_ms}ms\n`);
  if (opts.expectFailure) {
    if (res.status === 0) throw new Error(`${label}: expected a nonzero exit, got 0`);
  } else if (res.status !== 0) {
    process.stderr.write((res.stdout || '').split('\n').slice(-30).join('\n') + '\n');
    process.stderr.write(res.stderr || '');
    throw new Error(`${label}: driver exited ${res.status}`);
  }
  return record;
}

function sha256File(p) {
  return checkpoint.sha256Hex(fs.readFileSync(p));
}

function readStream(sandbox) {
  const p = path.join(sandbox, 'decision-stream.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

// Byte-level comparison of two decision-stream row lists over a tick window.
// Returns the first 10 differing rows plus the total count -- "divergences
// enumerated" means enumerated, not summarized away.
function compareStreams(left, right, fromTick, toTick, leftName, rightName) {
  const sel = (rows) => rows.filter((line) => {
    const t = JSON.parse(line).t;
    return t >= fromTick && t < toTick;
  });
  const l = sel(left);
  const r = sel(right);
  const diffs = [];
  const n = Math.max(l.length, r.length);
  for (let i = 0; i < n; i++) {
    if (l[i] !== r[i]) {
      if (diffs.length < 10) diffs.push({ index: i, [leftName]: l[i] ?? null, [rightName]: r[i] ?? null });
    }
  }
  const differing = (() => {
    let c = 0;
    for (let i = 0; i < n; i++) if (l[i] !== r[i]) c++;
    return c;
  })();
  return {
    window: [fromTick, toTick],
    rows_left: l.length,
    rows_right: r.length,
    identical: differing === 0 && l.length === r.length,
    differing_rows: differing,
    divergence_rate: n ? +(differing / n).toFixed(6) : 0,
    first_divergences: diffs,
    left_sha256: checkpoint.sha256Hex(l.join('\n')),
    right_sha256: checkpoint.sha256Hex(r.join('\n'))
  };
}

function assertNoConsolePacket(sandbox) {
  const p = path.join(sandbox, 'world-mind-decision.json');
  return { path: p, present: fs.existsSync(p) };
}

function manifestOf(checkpointRoot, id) {
  return checkpoint.readManifest(path.join(checkpointRoot, id)).manifest;
}

// ---------------------------------------------------------------------------
// S1 falsifier: save -> load -> save byte-identity
// ---------------------------------------------------------------------------
// Loads a committed generation, re-commits the loaded payload VERBATIM under a
// new run name, and compares each state file's sha256. Complete state coverage
// is exactly the property this tests: anything the loader silently drops or
// re-derives changes a byte.
function saveLoadSaveIdentity(checkpointRoot, sourceId, destRoot) {
  const loaded = checkpoint.loadGeneration(checkpointRoot, sourceId);
  if (!loaded.ok) throw new Error(`round-trip: could not load ${sourceId}: ${loaded.status}`);
  const src = loaded.manifest;

  const rngStates = Object.fromEntries(
    Object.entries(loaded.rngStates).map(([id, s]) => [id, { seed: s.seed, state: s.state }])
  );
  // Re-committed under the SAME run name into a DIFFERENT checkpoint root. Same
  // root plus a different name would change run_name inside identity.json and
  // manufacture a difference that says nothing about state coverage; the
  // collision rule forbids the same name in the same root, and rightly so.
  const committed = checkpoint.commitGeneration(destRoot, {
    runName: src.run_name,
    absoluteTick: src.absolute_tick,
    absoluteDay: src.absolute_day,
    networks: loaded.networks,
    worldMind: loaded.worldMind,
    controllers: loaded.controllers,
    rngStates,
    constructionSeeds: loaded.constructionSeeds,
    worldState: loaded.worldState,
    hiveStates: loaded.hiveStates,
    liveConfig: loaded.liveConfig,
    logCursors: loaded.logCursors,
    nextEventTicks: Object.fromEntries(
      Object.entries(loaded.identity.hives || {}).map(([k, v]) => [k, v.next_event_tick])
    ),
    identity: {
      event_context: loaded.identity.event_context,
      turn_index: loaded.identity.turn_index,
      root_seed: loaded.identity.root_seed,
      root_seed_source: loaded.identity.root_seed_source,
      fresh_start: loaded.identity.fresh_start,
      parent_run_id: loaded.identity.parent_run_id,
      parent_episode_id: loaded.identity.parent_episode_id
    },
    parent: src.parent.generation_id
      ? { generation_id: src.parent.generation_id, manifest_checksum: src.parent.manifest_checksum, lineage_depth: src.parent.lineage_depth - 1 }
      : null,
    inputPacket: src.input_packet,
    goal: src.goal
  });

  const before = Object.fromEntries(src.files.map((f) => [f.path, f.sha256]));
  const after = Object.fromEntries(committed.manifest.files.map((f) => [f.path, f.sha256]));
  const perFile = {};
  let allMatch = true;
  for (const name of checkpoint.STATE_FILES) {
    const match = before[name] === after[name];
    perFile[name] = { before: before[name], after: after[name], identical: match };
    if (!match) allMatch = false;
  }
  return {
    source_generation: sourceId,
    source_root: checkpointRoot,
    roundtrip_generation: committed.manifest.generation_id,
    roundtrip_root: destRoot,
    per_file: perFile,
    byte_identical: allMatch,
    // The manifest's own checksum is expected to differ: created_at is a
    // wall-clock stamp, deliberately provenance-only and never read by any
    // validation or decision path. Enumerated here rather than quietly excluded.
    manifest_checksum_differs_reason: 'created_at (provenance-only wall-clock field)'
  };
}

// ---------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------
function armA(rep) {
  const seed = ROOT_SEEDS[rep];
  const base = path.join(OUT, `arm-A/rep-${rep}`);
  const cpRoot = path.join(base, 'checkpoints');
  const leg1 = path.join(base, 'leg1');
  const leg2 = path.join(base, 'leg2');
  const runName = `A-rep${rep}`;

  run(`arm-A rep${rep} leg1`, [
    '--ticks', String(TICKS_HALF), '--tick-interval-ms', '0',
    '--sandbox-root', leg1, '--checkpoint-root', cpRoot,
    '--run-name', runName, '--root-seed', String(seed), '--arm', `A-rep${rep}-leg1`
  ]);

  const genId = `gen-${TICKS_HALF}-${runName}`;
  const genManifest = manifestOf(cpRoot, genId);
  if (!genManifest) throw new Error(`arm-A rep${rep}: generation ${genId} not committed`);

  // RESUME_FROM is delivered through the ENVIRONMENT here, deliberately: that
  // is the job.env path the guest runner uses, and testing only the CLI flag
  // would leave the shipped path unexercised.
  run(`arm-A rep${rep} leg2 (resume)`, [
    '--ticks', String(TICKS_HALF), '--tick-interval-ms', '0',
    '--sandbox-root', leg2, '--checkpoint-root', cpRoot,
    '--run-name', `${runName}b`, '--arm', `A-rep${rep}-leg2`
  ], { env: { RESUME_FROM: genId } });

  const resumedGen = `gen-${TICKS_FULL}-${runName}b`;
  return {
    rep,
    root_seed: seed,
    checkpoint_root: cpRoot,
    leg1_sandbox: leg1,
    leg2_sandbox: leg2,
    checkpoint_generation: genId,
    checkpoint_manifest_checksum: genManifest.manifest_self_checksum,
    checkpoint_files: genManifest.files,
    resumed_generation: resumedGen,
    resumed_manifest: manifestOf(cpRoot, resumedGen),
    console_packet_leg1: assertNoConsolePacket(leg1),
    console_packet_leg2: assertNoConsolePacket(leg2),
    stream: [...readStream(leg1), ...readStream(leg2)]
  };
}

function simpleArm(name, rep, seed, extraArgs) {
  const base = path.join(OUT, `arm-${name}/rep-${rep}`);
  const sandbox = path.join(base, 'sandbox');
  const cpRoot = path.join(base, 'checkpoints');
  const runName = `${name}-rep${rep}`;
  run(`arm-${name} rep${rep}`, [
    '--ticks', String(TICKS_FULL), '--tick-interval-ms', '0',
    '--sandbox-root', sandbox, '--checkpoint-root', cpRoot,
    '--run-name', runName, '--root-seed', String(seed), '--arm', runName,
    ...extraArgs
  ]);
  const genId = `gen-${TICKS_FULL}-${runName}`;
  return {
    rep,
    root_seed: seed,
    sandbox,
    checkpoint_root: cpRoot,
    generation: genId,
    manifest_checksum: manifestOf(cpRoot, genId).manifest_self_checksum,
    console_packet: assertNoConsolePacket(sandbox),
    stream: readStream(sandbox)
  };
}

// Arm D: tamper a COPY. The committed original is never touched -- the
// retention rule says last-known-good is never auto-deleted, and a test that
// corrupts the real one would be violating the contract it is testing.
function armD(sourceCheckpointRoot, sourceGenId) {
  const tamperRoot = path.join(OUT, 'arm-D/checkpoints');
  fs.rmSync(path.join(OUT, 'arm-D'), { recursive: true, force: true });
  fs.mkdirSync(tamperRoot, { recursive: true });
  fs.cpSync(sourceCheckpointRoot, tamperRoot, { recursive: true });

  const target = path.join(tamperRoot, sourceGenId, 'mind.json');
  const original = fs.readFileSync(target);
  const before = checkpoint.sha256Hex(original);
  // One byte, in a weight value: the smallest possible corruption, so passing
  // this proves the checksum stage and not merely that a mangled file fails to
  // parse. The tampered file is still valid JSON.
  const text = original.toString('utf8');
  const m = text.match(/(-?0\.\d)(\d)/);
  if (!m) throw new Error('arm-D: no weight literal found to perturb');
  const flipped = m[2] === '7' ? '8' : '7';
  const tampered = text.replace(m[0], `${m[1]}${flipped}`);
  if (tampered === text) throw new Error('arm-D: tamper was a no-op');
  fs.writeFileSync(target, tampered);
  const after = sha256File(target);
  JSON.parse(fs.readFileSync(target, 'utf8')); // proves it is still valid JSON

  const sandbox = path.join(OUT, 'arm-D/sandbox');
  const statusPath = path.join(OUT, 'arm-D/STATUS');
  fs.rmSync(sandbox, { recursive: true, force: true });
  const rec = run('arm-D tamper resume', [
    '--ticks', '10', '--tick-interval-ms', '0',
    '--sandbox-root', sandbox, '--checkpoint-root', tamperRoot,
    '--run-name', 'D-tamper', '--arm', 'D-tamper',
    '--status-path', statusPath,
    '--resume-from', sourceGenId
  ], { expectFailure: true });

  const status = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8').trim() : null;
  return {
    tampered_generation: sourceGenId,
    tampered_file: 'mind.json',
    sha256_before: before,
    sha256_after: after,
    still_valid_json: true,
    exit_code: rec.exit_code,
    status,
    expected_status_prefix: 'resume-failed-halt:checksums:',
    refused_at_checksum_stage: Boolean(status && status.startsWith('resume-failed-halt:checksums:')),
    // The proof that "zero state constructed" is not just a claim: the driver
    // must not have created its sandbox at all.
    sandbox_created: fs.existsSync(sandbox),
    original_generation_untouched: sha256File(path.join(sourceCheckpointRoot, sourceGenId, 'mind.json')) === before
  };
}

// Extra refusal arms: the other four validation stages, so the fail-closed
// claim covers the whole ladder rather than only the stage arm D happens to hit.
function refusalProbes(sourceCheckpointRoot, sourceGenId, childGenId) {
  const probes = [];
  const base = path.join(OUT, 'refusal-probes');
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });

  const probe = (name, mutate, expectedPrefix, beforeRun) => {
    const root = path.join(base, name, 'checkpoints');
    fs.mkdirSync(path.dirname(root), { recursive: true });
    fs.cpSync(sourceCheckpointRoot, root, { recursive: true });
    const resumeId = mutate(root) || sourceGenId;
    const sandbox = path.join(base, name, 'sandbox');
    const statusPath = path.join(base, name, 'STATUS');
    // beforeRun, when given, seeds the SANDBOX before the driver starts --
    // used by the input-packet probe, which needs a real
    // world-mind-decision.json on disk at gate time so the driver's own
    // currentInputPacket() computes something concrete to compare against the
    // tampered manifest value.
    if (beforeRun) beforeRun(sandbox);
    const rec = run(`refusal-probe ${name}`, [
      '--ticks', '5', '--sandbox-root', sandbox, '--checkpoint-root', root,
      '--run-name', `probe-${name}`, '--arm', `probe-${name}`,
      '--status-path', statusPath, '--resume-from', resumeId
    ], { expectFailure: true });
    const status = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8').trim() : null;
    // "Zero state constructed" is checked via live-config.json rather than
    // sandbox-directory existence: the input-packet probe below deliberately
    // pre-seeds the sandbox (via beforeRun) with a world-mind-decision.json so
    // the driver has something concrete to compare, which would otherwise make
    // sandbox_created a false positive for that one probe. live-config.json is
    // written by the driver ONLY after the resume gate returns successfully
    // (run-live.js's post-gate state-construction block), so its absence is
    // still an honest "no state was constructed" signal regardless of what a
    // probe seeded beforehand.
    const stateConstructed = fs.existsSync(path.join(sandbox, 'live-config.json'));
    probes.push({
      probe: name,
      resume_from: resumeId,
      exit_code: rec.exit_code,
      status,
      expected_status_prefix: expectedPrefix,
      matched: Boolean(status && status.startsWith(expectedPrefix)),
      sandbox_created: fs.existsSync(sandbox),
      state_constructed: stateConstructed
    });
  };

  probe('stage1-missing', () => 'gen-999999-does-not-exist', 'resume-failed-halt:exists:');
  probe('stage2-uncommitted', (root) => {
    fs.rmSync(path.join(root, sourceGenId, 'manifest.json'));
    return sourceGenId;
  }, 'resume-failed-halt:committed:');
  probe('stage2-torn-manifest', (root) => {
    const p = path.join(root, sourceGenId, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.absolute_tick = m.absolute_tick + 1; // body edited, self-checksum not updated
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    return sourceGenId;
  }, 'resume-failed-halt:committed:manifest-self-checksum-mismatch');
  // NEW -- identity stage (fix 2). Renames the committed generation directory
  // to a different (still well-formed) generation id WITHOUT touching
  // manifest.generation_id, which is exactly the "renamed generation
  // directory" defect codex S4 flagged: manifest.generation_id must equal the
  // directory basename, or a renamed/copied generation resumes silently under
  // a false identity.
  probe('stage-identity-renamed-dir', (root) => {
    const renamedId = `${sourceGenId}-renamed`;
    fs.renameSync(path.join(root, sourceGenId), path.join(root, renamedId));
    return renamedId;
  }, 'resume-failed-halt:identity:generation-id-mismatch-');

  probe('stage3-code-version', (root) => {
    const p = path.join(root, sourceGenId, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.code_version = 'ant-hive-world-checkpoint-0.9.0';
    const { manifest_self_checksum: _drop, ...body } = m;
    m.manifest_self_checksum = checkpoint.sha256Hex(checkpoint.canonicalJson(body));
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    return sourceGenId;
  }, 'resume-failed-halt:version:code-version-mismatch');
  probe('stage4-unlisted-file', (root) => {
    fs.writeFileSync(path.join(root, sourceGenId, 'extra.json'), '{}\n');
    return sourceGenId;
  }, 'resume-failed-halt:checksums:unlisted-file-');

  // NEW -- input-packet stage (fix 1). Tampers the manifest's recorded
  // input_packet to claim a frozen packet was present at commit time, then
  // (via beforeRun) gives the resuming driver a REAL world-mind-decision.json
  // whose sha256 does not match the tampered value -- present on both sides,
  // hash mismatched, which exercises the checksum-mismatch branch specifically
  // (as opposed to the cheaper presence/absence branch).
  probe('stage-input-packet-mismatch', (root) => {
    const p = path.join(root, sourceGenId, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.input_packet = { present: true, sha256: 'a'.repeat(64) };
    const { manifest_self_checksum: _drop, ...body } = m;
    m.manifest_self_checksum = checkpoint.sha256Hex(checkpoint.canonicalJson(body));
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    return sourceGenId;
  }, 'resume-failed-halt:input-packet:checksum-mismatch', (sandbox) => {
    fs.mkdirSync(sandbox, { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'world-mind-decision.json'),
      JSON.stringify({ verb: 'noop', rationale: 'refusal-probe: real packet, tampered manifest hash' }) + '\n'
    );
  });

  // Stage 5 needs a CHILD generation -- a lineage root has no parent to break.
  // childGenId is arm A's resumed generation, whose parent is sourceGenId.
  probe('stage5-parent-missing', (root) => {
    fs.rmSync(path.join(root, sourceGenId), { recursive: true, force: true });
    return childGenId;
  }, 'resume-failed-halt:lineage:parent-not-committed-');
  probe('stage5-parent-checksum', (root) => {
    // Re-seal the child's manifest after altering the recorded parent checksum,
    // so this probe reaches stage 5 rather than tripping the stage-2 self-check.
    const p = path.join(root, childGenId, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.parent.manifest_checksum = 'f'.repeat(64);
    const { manifest_self_checksum: _drop, ...body } = m;
    m.manifest_self_checksum = checkpoint.sha256Hex(checkpoint.canonicalJson(body));
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    return childGenId;
  }, 'resume-failed-halt:lineage:parent-checksum-mismatch');

  return probes;
}

// Collision arm: re-running a run name that already has a committed generation
// must refuse rather than overwrite.
function collisionProbe() {
  const base = path.join(OUT, 'collision');
  fs.rmSync(base, { recursive: true, force: true });
  const sandbox = path.join(base, 'sandbox');
  const cpRoot = path.join(base, 'checkpoints');
  const statusPath = path.join(base, 'STATUS');
  const args = (arm) => [
    '--ticks', '5', '--sandbox-root', sandbox, '--checkpoint-root', cpRoot,
    '--run-name', 'collide', '--root-seed', '4242', '--arm', arm,
    '--status-path', statusPath
  ];
  run('collision first', args('collide-1'));
  const genPath = path.join(cpRoot, 'gen-5-collide');
  const before = sha256File(path.join(genPath, 'manifest.json'));
  const rec = run('collision second', args('collide-2'), { expectFailure: true });
  const status = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8').trim() : null;
  return {
    generation: 'gen-5-collide',
    exit_code: rec.exit_code,
    status,
    expected_status: 'checkpoint-collision:gen-5-collide',
    matched: status === 'checkpoint-collision:gen-5-collide',
    committed_generation_unchanged: sha256File(path.join(genPath, 'manifest.json')) === before
  };
}

// Sweep arm: an uncommitted generation is swept on start; the committed
// last-known-good beside it is retained.
function sweepProbe() {
  const base = path.join(OUT, 'sweep');
  fs.rmSync(base, { recursive: true, force: true });
  const sandbox = path.join(base, 'sandbox');
  const cpRoot = path.join(base, 'checkpoints');
  run('sweep seed run', [
    '--ticks', '5', '--sandbox-root', sandbox, '--checkpoint-root', cpRoot,
    '--run-name', 'keep', '--root-seed', '99', '--arm', 'sweep-keep'
  ]);
  // Two kinds of residue: a generation directory with no manifest, and a
  // staging directory left behind by a crash mid-write.
  const orphan = path.join(cpRoot, 'gen-5-orphan');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, 'mind.json'), '{"partial":true}\n');
  const staging = path.join(cpRoot, '.staging-gen-5-orphan-4242');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'mind.json'), '{"partial":true}\n');

  const rec = run('sweep run', [
    '--ticks', '5', '--sandbox-root', path.join(base, 'sandbox2'), '--checkpoint-root', cpRoot,
    '--run-name', 'keep2', '--root-seed', '99', '--arm', 'sweep-keep2'
  ]);
  return {
    swept_lines: rec.stdout_head.concat(rec.stdout_tail).filter((l) => l.startsWith('swept ')),
    orphan_removed: !fs.existsSync(orphan),
    staging_removed: !fs.existsSync(staging),
    committed_retained: fs.existsSync(path.join(cpRoot, 'gen-5-keep')),
    committed_still_valid: checkpoint.isCommitted(path.join(cpRoot, 'gen-5-keep'))
  };
}

// Regression check against the r6/r7 baselines (plan risk note: "engine-code
// changes could alter baseline behavior even without resume"). Those runs are
// 3000 ticks and were seeded from the wall clock, so no exact match is possible
// or expected -- the comparable quantity is the SHAPE of the first 300 ticks:
// which verbs get chosen, how often actions apply, mean reward, and whether the
// policy is still exploring. A collapsed hive (entropy near zero) or a
// degenerate verb distribution in the fresh arms would implicate the engine
// rather than the loader, which is the plan's named escalation trigger.
function baselineShape(runLogPath, tickLimit) {
  if (!fs.existsSync(runLogPath)) return null;
  const byActor = {};
  for (const line of fs.readFileSync(runLogPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!r.hive || !Number.isInteger(r.tick) || r.tick > tickLimit) continue;
    const a = r.hive;
    if (!byActor[a]) byActor[a] = { n: 0, actions: {}, applied: 0, reward: 0, entropy: 0, entropyN: 0 };
    const b = byActor[a];
    b.n++;
    b.actions[r.action] = (b.actions[r.action] || 0) + 1;
    if (r.applied) b.applied++;
    if (typeof r.reward === 'number') b.reward += r.reward;
    if (typeof r.policy_entropy_post_update === 'number') { b.entropy += r.policy_entropy_post_update; b.entropyN++; }
  }
  for (const b of Object.values(byActor)) {
    b.applied_rate = +(b.applied / b.n).toFixed(4);
    b.mean_reward = +(b.reward / b.n).toFixed(4);
    b.mean_entropy_post = b.entropyN ? +(b.entropy / b.entropyN).toFixed(4) : null;
    delete b.reward; delete b.entropy; delete b.entropyN;
  }
  return byActor;
}

// The decision streams are byte-equal, but the world-state FILES are not, and
// pretending otherwise would be the easy lie here. This measures the actual
// difference: strip the three known wall-clock fields (world-state written_at,
// geometry_log entry `at`, and the identity decoration on geometry rows) and
// check whether anything else differs. Any residue is a real divergence and is
// reported as one.
// Tiered so the report says exactly WHICH class of field has to be removed
// before the two worlds agree, rather than asserting "equal modulo noise".
function worldStateDivergence(leftPath, rightPath) {
  if (!fs.existsSync(leftPath) || !fs.existsSync(rightPath)) return { comparable: false };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const mapGeometry = (s, fn) => {
    if (Array.isArray(s.geometry_log)) s.geometry_log = s.geometry_log.map(fn);
    return s;
  };
  const tiers = [
    { tier: 1, name: 'raw', strip: (s) => s },
    {
      tier: 2,
      name: 'minus wall-clock',
      fields: ['written_at', 'geometry_log[].at'],
      strip: (s) => { delete s.written_at; return mapGeometry(s, ({ at: _a, ...g }) => g); }
    },
    {
      tier: 3,
      name: 'minus wall-clock and run identity',
      fields: ['geometry_log[].run_id', 'geometry_log[].episode_id', 'geometry_log[].tick_key', 'geometry_log[].arm_id'],
      strip: (s) => mapGeometry(s, ({ run_id: _r, episode_id: _e, tick_key: _k, arm_id: _m, ...g }) => g)
    },
    {
      tier: 4,
      name: 'minus wall-clock, run identity and the world-file write counter',
      fields: ['seq'],
      strip: (s) => { delete s.seq; return s; }
    }
  ];
  const l0 = JSON.parse(fs.readFileSync(leftPath, 'utf8'));
  const r0 = JSON.parse(fs.readFileSync(rightPath, 'utf8'));
  let l = clone(l0);
  let r = clone(r0);
  const results = [];
  let equalAt = null;
  for (const t of tiers) {
    l = t.strip(l);
    r = t.strip(r);
    const equal = checkpoint.canonicalJson(l) === checkpoint.canonicalJson(r);
    results.push({ tier: t.tier, name: t.name, fields_removed_at_this_tier: t.fields || [], identical: equal });
    if (equal && equalAt === null) equalAt = t.tier;
  }
  return {
    comparable: true,
    tiers: results,
    identical_from_tier: equalAt,
    // seq counts writes to the world-state FILE. A resume performs one genuine
    // extra write (materialising the checkpointed world into the sandbox), so
    // the resumed lineage runs exactly one ahead per resume. The counter is
    // still telling the truth about how many times the file was written; it is
    // produced by world-state.js:162 and consumed by nothing in the tick path
    // (grep: only the dashboard reads it, and no arm runs the dashboard).
    seq_left: l0.seq,
    seq_right: r0.seq,
    seq_delta: l0.seq - r0.seq
  };
}

// ---------------------------------------------------------------------------
function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const parity = checkpoint.assertRngParity();

  const arms = { A: [], A_PRIME: [], B: [], C: [] };
  for (let rep = 0; rep < REPLICATES; rep++) {
    arms.A.push(armA(rep));
    arms.A_PRIME.push(simpleArm('Aprime', rep, ROOT_SEEDS[rep], []));
    arms.B.push(simpleArm('B', rep, FRESH_SEEDS[rep], []));
    arms.C.push(simpleArm('C', rep, ROOT_SEEDS[rep], ['--shuffle-streams', SHUFFLE]));
  }

  const comparisons = [];
  for (let rep = 0; rep < REPLICATES; rep++) {
    const a = arms.A[rep].stream;
    const ap = arms.A_PRIME[rep].stream;
    comparisons.push({
      name: `rep${rep}: A pre-checkpoint vs A-PRIME (ticks 0..${TICKS_HALF})`,
      purpose: 'sanity: identical seeds and identical start must already agree before any resume happens',
      result: compareStreams(a, ap, 0, TICKS_HALF, 'A', 'A_PRIME')
    });
    comparisons.push({
      name: `rep${rep}: A POST-RESUME vs A-PRIME (ticks ${TICKS_HALF}..${TICKS_FULL}) -- EQUIVALENCE STANDARD`,
      purpose: 'the plan\'s equivalence standard: resume must be a true continuation, byte-equal on the decision stream',
      result: compareStreams(a, ap, TICKS_HALF, TICKS_FULL, 'A', 'A_PRIME')
    });
    comparisons.push({
      name: `rep${rep}: A vs B (fresh-seed control, ticks 0..${TICKS_FULL})`,
      purpose: 'divergence control: different root seeds must produce a different trajectory',
      result: compareStreams(a, arms.B[rep].stream, 0, TICKS_FULL, 'A', 'B')
    });
    comparisons.push({
      name: `rep${rep}: A vs C (shuffled-RNG control, ticks 0..${TICKS_FULL})`,
      purpose: 'divergence control: same root seed, permuted per-stream assignment -- isolates state from seeds',
      result: compareStreams(a, arms.C[rep].stream, 0, TICKS_FULL, 'A', 'C')
    });
  }
  // Replicate-vs-replicate: two arms with DIFFERENT seeds must differ, and the
  // A/A-PRIME equality must hold in both replicates independently.
  if (REPLICATES > 1) {
    comparisons.push({
      name: 'rep0 vs rep1 of arm A (different root seeds)',
      purpose: 'replication: the equivalence result must not be an artifact of one seed',
      result: compareStreams(arms.A[0].stream, arms.A[1].stream, 0, TICKS_FULL, 'A_rep0', 'A_rep1')
    });
  }

  const roundTrip = [];
  for (let rep = 0; rep < REPLICATES; rep++) {
    roundTrip.push(saveLoadSaveIdentity(
      arms.A[rep].checkpoint_root,
      arms.A[rep].checkpoint_generation,
      path.join(OUT, `roundtrip/rep-${rep}/checkpoints`)
    ));
  }

  const tamper = armD(arms.A[0].checkpoint_root, arms.A[0].checkpoint_generation);
  const probes = refusalProbes(
    arms.A[0].checkpoint_root,
    arms.A[0].checkpoint_generation,
    arms.A[0].resumed_generation
  );
  const collision = collisionProbe();
  const sweep = sweepProbe();

  // ---- verdicts -----------------------------------------------------------
  const equivalence = comparisons.filter((c) => c.name.includes('EQUIVALENCE STANDARD'));
  const preResume = comparisons.filter((c) => c.name.includes('pre-checkpoint'));
  const controls = comparisons.filter((c) => c.name.includes('control'));

  const verdicts = {
    equivalence_A_vs_Aprime: {
      standard: 'byte-equal decision stream over ticks 150..299 in every replicate',
      pass: equivalence.every((c) => c.result.identical),
      per_replicate: equivalence.map((c) => ({ name: c.name, identical: c.result.identical, differing_rows: c.result.differing_rows }))
    },
    pre_resume_agreement: {
      pass: preResume.every((c) => c.result.identical),
      per_replicate: preResume.map((c) => ({ name: c.name, identical: c.result.identical }))
    },
    divergence_controls: {
      standard: 'A must differ replicably from BOTH B (fresh seeds) and C (shuffled streams)',
      pass: controls.every((c) => !c.result.identical && c.result.differing_rows > 0),
      per_control: controls.map((c) => ({ name: c.name, differing_rows: c.result.differing_rows, divergence_rate: c.result.divergence_rate }))
    },
    save_load_save_byte_identity: {
      pass: roundTrip.every((r) => r.byte_identical),
      per_replicate: roundTrip
    },
    tamper_refusal_arm_D: { pass: tamper.refused_at_checksum_stage && !tamper.sandbox_created && tamper.original_generation_untouched, detail: tamper },
    refusal_ladder: { pass: probes.every((p) => p.matched && !p.state_constructed), detail: probes },
    collision_fail_closed: { pass: collision.matched && collision.committed_generation_unchanged, detail: collision },
    sweep_and_retention: { pass: sweep.orphan_removed && sweep.staging_removed && sweep.committed_retained && sweep.committed_still_valid, detail: sweep },
    frozen_inputs: {
      standard: 'no arm may carry an operator-console decision packet',
      pass: [...arms.A.map((a) => a.console_packet_leg1.present || a.console_packet_leg2.present),
        ...arms.A_PRIME.map((a) => a.console_packet.present),
        ...arms.B.map((a) => a.console_packet.present),
        ...arms.C.map((a) => a.console_packet.present)].every((present) => present === false)
    },
    rng_parity: { pass: parity.ok, detail: parity }
  };
  verdicts.overall_pass = Object.values(verdicts).every((v) => v.pass !== false);

  // ---- behaviour-shape regression check against r6/r7 ---------------------
  const shape = {};
  for (const [armName, list] of Object.entries(arms)) {
    shape[armName] = list.map((a) => summarize(a.stream));
  }
  const worldStateComparisons = [];
  for (let rep = 0; rep < REPLICATES; rep++) {
    worldStateComparisons.push({
      name: `rep${rep}: arm A resumed leg final world-state vs A-PRIME final world-state`,
      result: worldStateDivergence(
        path.join(arms.A[rep].leg2_sandbox, 'shared', 'world-state.json'),
        path.join(arms.A_PRIME[rep].sandbox, 'shared', 'world-state.json')
      )
    });
  }

  const stateDir = path.join(REPO, '_dev', 'state');
  const baselines = {
    note: 'r6/r7 are 3000-tick wall-clock-seeded guest runs; only the first 300 ticks are compared, and only on shape. Exact equality is impossible by construction (different seeds) and is not the claim.',
    r6_first300: baselineShape(path.join(stateDir, 'baseline-3000-r6', 'baseline-3000-r6', 'run-log.jsonl'), TICKS_FULL),
    r7_first300: baselineShape(path.join(stateDir, 'baseline-3000-r7', 'baseline-3000-r7', 'run-log.jsonl'), TICKS_FULL),
    fresh_arms_this_slice: { A_PRIME: shape.A_PRIME, B: shape.B }
  };
  // Falsifiable shape assertions, stated so a reviewer can check them rather
  // than take the word "similar": every hive in every fresh arm must still be
  // exploring (post-update entropy above the frozen 0.3-nat floor) and must
  // still be using more than one verb.
  const freshHives = [...shape.A_PRIME, ...shape.B].flatMap((s) =>
    Object.entries(s).filter(([actor]) => actor !== 'world').map(([actor, v]) => ({ actor, ...v })));
  baselines.assertions = {
    all_fresh_hives_above_entropy_floor: freshHives.every((h) => h.mean_entropy_post > 0.3),
    all_fresh_hives_multi_verb: freshHives.every((h) => Object.keys(h.actions).length > 1),
    min_mean_entropy_post: Math.min(...freshHives.map((h) => h.mean_entropy_post)),
    verb_counts: freshHives.map((h) => ({ actor: h.actor, verbs: Object.keys(h.actions).length }))
  };

  const evidence = {
    schema: 'ContinuityEvidence/1.0',
    plan: 'ant-world-checkpoint-loader',
    step: 'S3',
    generated_at: new Date().toISOString(),
    node_version: process.version,
    // Top-level, authoritative verdict -- recomputed from verdicts.overall_pass
    // (itself Object.values(verdicts).every(v => v.pass !== false)) rather than
    // hardcoded, so a future run that actually fails writes "FAIL" here, not a
    // stale "PASS" left over from copy-paste.
    overall_verdict: verdicts.overall_pass ? 'PASS' : 'FAIL',
    design: {
      ticks_per_leg: TICKS_HALF,
      ticks_total: TICKS_FULL,
      replicates: REPLICATES,
      root_seeds: ROOT_SEEDS,
      fresh_seeds: FRESH_SEEDS,
      shuffle_streams: SHUFFLE,
      equivalence_standard: 'A post-resume decision stream (absolute ticks 150..299) byte-equal to A-PRIME ticks 150..299',
      decision_stream_fields: 'per actor per absolute tick: action, applied, reward, policy entropy pre/post update, forced-exploration flag, controller flag, effective entropy weight, stockpile; world rows add verb, source, RNG-drawn tile note, prob, entropy. Wall-clock and identity fields are deliberately excluded -- see run-live.js appendDecision.'
    },
    verdicts,
    arms: {
      A: arms.A.map(stripStream),
      A_PRIME: arms.A_PRIME.map(stripStream),
      B: arms.B.map(stripStream),
      C: arms.C.map(stripStream),
      D: tamper
    },
    comparisons,
    save_load_save: roundTrip,
    refusal_probes: probes,
    collision: collision,
    sweep: sweep,
    behaviour_shape: shape,
    baseline_comparison: baselines,
    divergence_enumeration: {
      standard: 'the equivalence claim is byte-equality of the DECISION STREAM. These are the places where a resumed run and an uninterrupted one legitimately differ, each named with the reason it cannot feed a decision.',
      known_divergences: [
        { field: 'world-state.json written_at', site: 'world-state.js:163', reason: 'wall-clock stamp; read by nothing in the tick path' },
        { field: 'geometry_log[].at', site: 'harness.js:181', reason: 'wall-clock stamp; encodeState reads only the COUNT of geometry entries (untrained-network.js:145), never their fields' },
        { field: 'geometry_log[] run_id / episode_id / tick_key / arm_id', site: 'harness.js:180 via decorateEvent', reason: 'run identity; a resumed run is a new process with new uuids, and arm_id is the --arm label this harness passes (deliberately different per leg). Verified non-feeding in state-inventory.md section 4' },
        { field: 'world-state.json seq', site: 'world-state.js:162', reason: 'counts writes to the world-state FILE. A resume performs one genuine extra write when it materialises the checkpointed world into the sandbox, so a resumed lineage runs exactly one ahead per resume. Produced only; no consumer in the tick path (the dashboard is the sole reader and no arm runs it). The counter remains accurate about what it measures.' },
        { field: 'run-log.jsonl ts', site: 'run-live.js:152', reason: 'wall-clock stamp on the log, not the sim' },
        { field: 'audit-log.jsonl ts', site: 'harness.js:79', reason: 'same' },
        { field: 'hive-state.json provenance.when', site: 'run-live.js fresh-start path', reason: 'genesis stamp; carried verbatim through the checkpoint, so a resumed hive keeps the ORIGINAL value and the uninterrupted run has its own' },
        { field: 'manifest.json created_at and therefore manifest_self_checksum', site: 'checkpoint.js commitGeneration', reason: 'provenance-only; never compared during validation' }
      ],
      measured: worldStateComparisons
    },
    transcripts
  };

  const outFile = path.join(__dirname, 'continuity-evidence.json');
  fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(`\nevidence written: ${outFile}\n`);
  process.stdout.write(`OVERALL: ${verdicts.overall_pass ? 'PASS' : 'FAIL'}\n`);
  for (const [k, v] of Object.entries(verdicts)) {
    if (k === 'overall_pass') continue;
    process.stdout.write(`  ${v.pass ? 'PASS' : 'FAIL'}  ${k}\n`);
  }
  if (!verdicts.overall_pass) process.exitCode = 1;
}

function stripStream(arm) {
  const { stream, ...rest } = arm;
  return { ...rest, decision_stream_rows: stream.length, decision_stream_sha256: checkpoint.sha256Hex(stream.join('\n')) };
}

function summarize(streamRows) {
  const byActor = {};
  for (const line of streamRows) {
    const r = JSON.parse(line);
    if (!byActor[r.actor]) byActor[r.actor] = { n: 0, actions: {}, applied: 0, reward: 0, entropy: 0, entropyN: 0 };
    const b = byActor[r.actor];
    b.n++;
    b.actions[r.action] = (b.actions[r.action] || 0) + 1;
    if (r.applied) b.applied++;
    if (typeof r.reward === 'number') b.reward += r.reward;
    if (typeof r.peu === 'number') { b.entropy += r.peu; b.entropyN++; }
  }
  for (const b of Object.values(byActor)) {
    b.applied_rate = +(b.applied / b.n).toFixed(4);
    b.mean_reward = +(b.reward / b.n).toFixed(4);
    b.mean_entropy_post = b.entropyN ? +(b.entropy / b.entropyN).toFixed(4) : null;
    delete b.reward; delete b.entropy; delete b.entropyN;
  }
  return byActor;
}

main();
