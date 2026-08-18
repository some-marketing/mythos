#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/dream/dream-memory.js — S1 of plan
// world-mind-dream-communication: the durable, append-only, generation-bound,
// resume-reconciled dream memory vault.
//
// SIM-SIDE ONLY (plan S1 boundary paragraph). This is a DIFFERENT surface
// from the MYTHOS-side dreaming system (_dev/state/memory-db/dream-report.md,
// DreamSeen/1.0, meta/dreaming-system framework) -- that surface is
// associative recombination over the operator/harness corpus for Mythos's
// own reflection. This vault carries mechanical, provenance-gated
// consequence narration from the world mind to the hive minds. Never touch
// memory-db/ or the meta/dreaming-system framework from this module.
//
// SCHEMA: DreamMemory/1.0. One JSON object per line (JSONL), plain text, no
// binary/opaque encoding -- inspectable by any text tool. Two kinds of line:
//   - an ENTRY line: {entry_id, written_at, entry_type, lane, text_or_data,
//     provenance, calibration_score_at_write, domain, generation_id,
//     commit_status}
//   - a STATUS-CHANGE line: {entry_type:'status_change', written_at,
//     generation_id, from, to, entry_ids}, recording a batch commit_status
//     transition for entries carrying that generation_id WITHOUT rewriting
//     the original entry line -- append-only is enforced by construction:
//     the writer only ever opens the file in append mode and never seeks
//     back to rewrite a prior byte range.
//
// A reader materializes the CURRENT view of the vault by folding every
// status-change line over the entry lines it names (see materialize()).
//
// APPEND-ONLY INVARIANT: every write in this module uses fs.appendFileSync
// (or an fd opened with the 'a' flag). No function here ever opens the vault
// file for truncation or in-place rewrite. Entry 0's original bytes are
// therefore provably unaltered by any later write -- proven by test, not
// merely asserted.

const fs = require('fs');
const path = require('path');

const SCHEMA = 'DreamMemory/1.0';
const DOMAIN = 'sim-world-mind';
// 'forecast' added S4b (plan world-mind-dream-communication, integration
// pass, operator go 2026-08-13T02:20Z, closeout item 1): a runtime-issued
// forecast entry ({forecast_id, generation_id, tick_issued, target:{metric,
// subject,horizon_ticks}, predicted_p} in text_or_data), written by
// dream-lane.js when a forecast rule fires and by calibration's resolution
// once the horizon passes (the resolved outcome is a SEPARATE 'dream' entry
// via composeForecastEntry, never a rewrite of the original forecast line --
// append-only holds).
const ENTRY_TYPES = ['doctrine', 'consequence', 'dream', 'forecast'];
// 'mixed' added S5 re-trial fold (dream-composer.js's mergeDreamSignals):
// a delivered dream whose merged sources span both darkness and hope. A
// first-class enum member, additive -- never a special-cased absence the
// way `null` (still valid, for lane-less entries like the operator-
// doctrine and ratio-record entries) would have silently been misread as.
const LANES = ['darkness', 'hope', 'mixed', null];
// 'run-terminal' added S4b (plan world-mind-dream-communication, amendment,
// operator ratification 2026-08-13T16:46Z, call S4b-3): the terminal status
// for entries written under a run that never reaches checkpoint commit
// (every ablation/trial run) -- see finalizeRunTerminal() below for why
// 'committed' would overclaim and 'pending' forever would misreport
// abandoned evidence as still-awaiting-confirmation.
const COMMIT_STATUSES = ['pending', 'committed', 'quarantined', 'run-terminal'];

// Entry 0, the operator doctrine verbatim. CONSOLIDATED WORDING plus the full
// supersession chain embedded as structured sub-fields (AMENDMENT v2,
// codewhale objection 3) -- not just the final wording with a bare source
// tag. Source: _dev/concepts/world-mind-dream-communication.md.
const CONSOLIDATED_WORDING =
  "Use dreams to communicate the darkness and the hope in the world to the minds. " +
  "be honest with them about the outcomes of their actions and ensure they " +
  "understand the consequences of an action they're taking.";

const SUPERSESSION_CHAIN = Object.freeze({
  captured_at: '2026-08-12T16:13Z',
  corrected_at: '2026-08-12T16:17Z',
  addendum_at: '2026-08-12T16:19Z',
  consolidated_at: '2026-08-12T18:04Z',
  text: CONSOLIDATED_WORDING
});

function readLines(vaultPath) {
  let raw;
  try {
    raw = fs.readFileSync(vaultPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
}

function nextEntryId(lines) {
  let max = -1;
  for (const line of lines) {
    if (typeof line.entry_id === 'number' && line.entry_id > max) max = line.entry_id;
  }
  return max + 1;
}

function assertProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object' || !provenance.source) {
    throw new Error('DreamMemory entry rejected: provenance is required (missing evidence source), not a permitted null');
  }
}

// Create the vault file with entry 0 seeded, ONLY if it does not already
// exist. Never invoked automatically by run-live.js -- a stock run that has
// never scaffolded a vault must never see one appear as a side effect of
// running. Idempotent: calling this against an existing vault is a no-op and
// returns { created: false }.
function seedVault(vaultPath) {
  if (fs.existsSync(vaultPath)) return { created: false, path: vaultPath };
  fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
  const entry0 = {
    entry_id: 0,
    written_at: new Date().toISOString(),
    entry_type: 'doctrine',
    lane: null,
    text_or_data: { ...SUPERSESSION_CHAIN },
    provenance: { source: 'operator', ref: '_dev/concepts/world-mind-dream-communication.md' },
    calibration_score_at_write: null,
    domain: DOMAIN,
    // No checkpoint generation exists before the vault is seeded -- the one
    // explicitly-permitted null per the plan.
    generation_id: null,
    // Entry 0 is not bound to any generation's commit lifecycle -- it is
    // immutable and durable the moment it is written, so it starts (and
    // stays) committed rather than cycling through a pending state it can
    // never leave.
    commit_status: 'committed'
  };
  fs.appendFileSync(vaultPath, JSON.stringify(entry0) + '\n');
  return { created: true, path: vaultPath, entry: entry0 };
}

// Append a new consequence/dream entry. entry_type in {'consequence','dream'}
// (doctrine is only ever entry 0, written by seedVault). generation_id is
// required and non-null (plan: "null only for entry 0"). provenance is
// required. commit_status starts 'pending'.
function appendEntry(vaultPath, {
  entry_type, lane = null, text_or_data, provenance,
  calibration_score_at_write = null, generation_id
}) {
  if (!ENTRY_TYPES.includes(entry_type) || entry_type === 'doctrine') {
    throw new Error(`DreamMemory entry rejected: invalid entry_type '${entry_type}'`);
  }
  if (!LANES.includes(lane)) {
    throw new Error(`DreamMemory entry rejected: invalid lane '${lane}'`);
  }
  assertProvenance(provenance);
  if (generation_id === null || generation_id === undefined) {
    throw new Error('DreamMemory entry rejected: generation_id is required for non-doctrine entries');
  }
  const lines = readLines(vaultPath);
  const entry = {
    entry_id: nextEntryId(lines),
    written_at: new Date().toISOString(),
    entry_type,
    lane,
    text_or_data,
    provenance,
    calibration_score_at_write,
    domain: DOMAIN,
    generation_id,
    commit_status: 'pending'
  };
  fs.appendFileSync(vaultPath, JSON.stringify(entry) + '\n');
  return entry;
}

function appendStatusChange(vaultPath, { generation_id, from, to, entry_ids }) {
  if (!COMMIT_STATUSES.includes(to)) throw new Error(`DreamMemory status-change rejected: invalid target status '${to}'`);
  if (!entry_ids.length) return null;
  const record = {
    entry_type: 'status_change',
    written_at: new Date().toISOString(),
    generation_id,
    from,
    to,
    entry_ids
  };
  fs.appendFileSync(vaultPath, JSON.stringify(record) + '\n');
  return record;
}

// Materialize the CURRENT view of the vault: entry lines, each with its
// commit_status folded forward through every status_change line that named
// it. Status-change lines themselves are not returned -- callers see the
// resulting entries only.
function materialize(vaultPath) {
  const lines = readLines(vaultPath);
  const entries = new Map();
  for (const line of lines) {
    if (line.entry_type === 'status_change') continue;
    entries.set(line.entry_id, { ...line });
  }
  for (const line of lines) {
    if (line.entry_type !== 'status_change') continue;
    for (const id of line.entry_ids) {
      const entry = entries.get(id);
      if (entry) entry.commit_status = line.to;
    }
  }
  return Array.from(entries.values()).sort((a, b) => a.entry_id - b.entry_id);
}

// Entries available to S2/S3 (consequence ledger, dream composer): every
// entry except quarantined ones. Quarantined entries remain readable in the
// log for audit but are excluded from downstream input, per plan S1.
function activeEntries(vaultPath) {
  return materialize(vaultPath).filter((e) => e.commit_status !== 'quarantined');
}

// COMMIT WIRING (plan S1, AMENDMENT v3). Invoked from run-live.js's
// commitCheckpoint(), immediately after checkpoint.commitGeneration()
// returns successfully. Flips every vault entry with commit_status='pending'
// AND generation_id === generationId to 'committed', leaving every other
// entry's commit_status untouched. Guarded no-op if the vault does not
// exist -- a stock run that has never written to the vault must produce zero
// vault activity.
function commitGenerationEntries(vaultPath, generationId) {
  if (!fs.existsSync(vaultPath)) return { flipped: [] };
  const entries = materialize(vaultPath);
  const toFlip = entries
    .filter((e) => e.commit_status === 'pending' && e.generation_id === generationId)
    .map((e) => e.entry_id);
  if (toFlip.length) {
    appendStatusChange(vaultPath, { generation_id: generationId, from: 'pending', to: 'committed', entry_ids: toFlip });
  }
  return { flipped: toFlip };
}

// RESUME RECONCILIATION (plan S1, AMENDMENT v2/v3). Invoked from
// run-live.js on resume, before any new vault writes happen this run. Walks
// every vault entry with commit_status='pending' and checks, via the
// checkpoint module's own isCommitted(), whether a committed checkpoint
// manifest exists for that entry's generation_id under checkpointRoot, AND
// (when `resumedManifest` is supplied) whether that generation is actually
// on the RESUMED RUN'S ACTIVE LINEAGE:
//   - manifest exists AND is on the active lineage -> promote pending ->
//     committed (the crash-window case: the generation really did commit,
//     only the vault flip was interrupted).
//   - manifest absent, OR exists but is NOT on the active lineage (a
//     committed generation from an abandoned branch) -> quarantine (the
//     entry's evidence is no longer part of the lineage this run continues).
// Guarded no-op if the vault does not exist.
//
// LINEAGE MEMBERSHIP (codex fold review, MINOR fix): existence of a
// committed manifest is necessary but not sufficient -- a manifest can exist
// on disk for a generation that was itself abandoned (e.g. a rolled-back
// branch's own child that got as far as committing before the branch was
// discarded). `resumedManifest` is the manifest of the generation THIS run
// resumed into (run-live.js always has this -- it is `r.manifest` returned
// by checkpoint.loadGeneration()); membership is verified by walking that
// manifest's own parent chain (manifest.parent.generation_id, recursively,
// via checkpointModule.readManifest()) and checking whether the candidate
// generation_id appears in it. This is the actual lineage surface
// checkpoint.js exposes -- a manifest can only name its OWN parent, so an
// ancestor walk is what "on the active lineage" mechanically means here.
//
// EXISTENCE-CHECK BOUNDARY, NAMED HONESTLY (the limit, not hidden as
// membership): when `resumedManifest` is omitted, this function falls back
// to existence-only checking (isCommitted() alone) -- it CANNOT verify
// lineage membership without a chain to walk, and does not claim to. A
// manifest existing under an abandoned branch would incorrectly promote
// under this fallback. Every real caller (run-live.js) always has
// `resumedManifest` available and must pass it; the fallback exists only for
// callers/tests that genuinely have no lineage chain to walk.
//
// `checkpointModule` is injected (rather than required at module scope) so
// tests can stub isCommitted()/readManifest() against a fixture checkpoint
// root without touching the real filesystem layout checkpoint.js otherwise
// assumes.
function isOnActiveLineage(checkpointRoot, checkpointModule, resumedManifest, candidateGenerationId, { maxDepth = 100000 } = {}) {
  let current = resumedManifest;
  let depth = 0;
  while (current) {
    if (current.generation_id === candidateGenerationId) return true;
    const parentId = current.parent && current.parent.generation_id;
    if (!parentId) return false;
    depth += 1;
    // Safety cap against a corrupt/cyclic parent chain -- never loop
    // forever; treat an implausibly deep chain as "not found" rather than
    // hanging.
    if (depth > maxDepth) return false;
    const parentDir = path.join(checkpointRoot, String(parentId));
    const read = checkpointModule.readManifest(parentDir);
    if (!read.committed) return false;
    current = read.manifest;
  }
  return false;
}

function reconcileOnResume(vaultPath, checkpointRoot, checkpointModule, resumedManifest = null) {
  if (!fs.existsSync(vaultPath)) return { promoted: [], quarantined: [] };
  const entries = materialize(vaultPath).filter((e) => e.commit_status === 'pending');
  const byGeneration = new Map();
  for (const entry of entries) {
    if (!byGeneration.has(entry.generation_id)) byGeneration.set(entry.generation_id, []);
    byGeneration.get(entry.generation_id).push(entry.entry_id);
  }
  const promoted = [];
  const quarantined = [];
  for (const [generationId, entryIds] of byGeneration.entries()) {
    const generationDir = path.join(checkpointRoot, String(generationId));
    const committed = checkpointModule.isCommitted(generationDir);
    const onLineage = committed && (
      resumedManifest ? isOnActiveLineage(checkpointRoot, checkpointModule, resumedManifest, generationId) : true
    );
    if (onLineage) {
      appendStatusChange(vaultPath, { generation_id: generationId, from: 'pending', to: 'committed', entry_ids: entryIds });
      promoted.push(...entryIds);
    } else {
      appendStatusChange(vaultPath, { generation_id: generationId, from: 'pending', to: 'quarantined', entry_ids: entryIds });
      quarantined.push(...entryIds);
    }
  }
  return { promoted, quarantined };
}

// RUN-TERMINAL FINALIZATION (S4b amendment, operator ratification
// 2026-08-13T16:46Z, call S4b-3, resolving codex CRITICAL 2's second half:
// "vault entries ... remain pending" for runs with no checkpoint lifecycle).
// A run with no checkpoint commits (every --no-checkpoint / ablation-trial
// run) can never reach 'committed' via commitGenerationEntries() -- that
// function only ever matches a REAL checkpoint generation_id, and a trial
// run's entries carry a provisional, run-scoped generation_id instead (see
// dream-lane.js's PROVISIONAL GENERATION_ID note). Leaving those entries
// 'pending' forever misreports real, already-final trial evidence as
// evidence still awaiting a confirmation that will never come.
// finalizeRunTerminal() flips every entry with commit_status='pending' AND
// generation_id===runId to the TERMINAL 'run-terminal' status -- distinct
// from 'committed' (asserts a checkpoint actually landed, which never
// happened here) and from 'quarantined' (asserts the evidence's lineage was
// abandoned, which is not what happened either): 'run-terminal' claims
// neither -- it honestly means "this run ended with no checkpoint lifecycle
// to bind to, and this is exactly as final as this run's own evidence ever
// gets." Idempotent (a second call finds nothing left 'pending' for this
// runId) and a guarded no-op if the vault does not exist -- a run that wrote
// nothing to the vault must not create one just to finalize it.
function finalizeRunTerminal(vaultPath, runId) {
  if (!fs.existsSync(vaultPath)) return { flipped: [] };
  const entries = materialize(vaultPath);
  const toFlip = entries
    .filter((e) => e.commit_status === 'pending' && e.generation_id === runId)
    .map((e) => e.entry_id);
  if (toFlip.length) {
    appendStatusChange(vaultPath, { generation_id: runId, from: 'pending', to: 'run-terminal', entry_ids: toFlip });
  }
  return { flipped: toFlip };
}

module.exports = {
  SCHEMA,
  DOMAIN,
  ENTRY_TYPES,
  LANES,
  COMMIT_STATUSES,
  CONSOLIDATED_WORDING,
  SUPERSESSION_CHAIN,
  seedVault,
  appendEntry,
  appendStatusChange,
  materialize,
  activeEntries,
  commitGenerationEntries,
  finalizeRunTerminal,
  isOnActiveLineage,
  reconcileOnResume
};

if (require.main === module) {
  // Deliberate, explicit scaffolding only -- this CLI is never invoked by
  // run-live.js or any other automated path. An explicit path argument is
  // honored (so a diagnostic/test invocation can never mistakenly seed the
  // real, tracked vault); with no argument, it seeds the real default path,
  // which is the intended one-time operator action.
  const targetPath = process.argv[2]
    || path.join(__dirname, '..', '..', '..', '_dev', 'state', 'ant-world-mind-memory', 'dream-memory.jsonl');
  const result = seedVault(targetPath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
