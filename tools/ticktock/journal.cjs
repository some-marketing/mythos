#!/usr/bin/env node
'use strict';

// tools/ticktock/journal.cjs -- JournalRecord/1.0: append, read, verify, resume.
//
// Plan: ticktock-skill S0 (resumability contract TT-001). Schema:
// ./journal-schema.json. Phase identity and the idempotency formulas come from
// _dev/reports/analysis/ticktock-phase-identity-decision.md via charter.cjs.
//
// THE CONTRACT, in one paragraph, because the rest of this file is consequence:
// the journal is an append-only JSONL file of phase-transition records, each
// chained to the previous by prev_record_hash. A phase COMPLETES only when a
// record exists whose verified_checkpoint.verified is true, and that flag is
// set only after an INDEPENDENT re-read-and-re-hash of every artifact the phase
// wrote confirmed the digests recorded in the same record. Tool-reported write
// success never sets it: a tool reports what it attempted, and a checkpoint has
// to record what is on disk. Resume therefore reads only the last verified
// record; a phase interrupted before its checkpoint verified is treated as
// never having completed, and its partial work is DISCARDED rather than
// replayed forward.
//
// Two things follow that are easy to get subtly wrong, so they are stated
// rather than implied:
//
//   1. THE TWO UNCERTAINTY STATES ARE NOT THE SAME HALT. A phase that halted
//      before making any external call is EFFECT-DID-NOT-HAPPEN and resumes
//      normally. A phase that dispatched and then died before confirming a
//      receipt is EFFECT-RECEIPT-MISSING: the effect MAY have happened, so the
//      only honest move is to stop and ask the external system. Auto-retry
//      risks a double send; auto-skip risks a silent no-op. resolveResume()
//      refuses to return a resume point while such a record is unreconciled.
//
//   2. AN IDEMPOTENCY KEY IS ONLY MEANINGFUL IF IT IS WRITTEN BEFORE THE
//      EFFECT. resolveIdempotency() distinguishes three journal answers --
//      present-and-completed (skip), present-and-uncertain (halt into
//      reconciliation), absent (execute) -- and that middle case only exists on
//      disk because the record is appended at phase ENTRY with dispatched
//      recorded at dispatch time, not at completion.
//
//   3. A HASH CHAIN CANNOT DETECT ITS OWN TAIL BEING CUT OFF. prev_record_hash
//      makes a deleted or edited MIDDLE record fail verification, because the
//      record after the hole no longer chains. Delete the LAST record instead
//      and what remains is a shorter chain that is internally perfect -- and a
//      run interrupted mid-write is exactly the situation that produces one.
//      The fix is an independently written HEAD ANCHOR (JournalHeadAnchor/1.0,
//      stored beside the journal as <journal>.anchor.json) recording the head
//      record_hash and the record count. Truncation then shows up as the file
//      DISAGREEING with the anchor rather than as a valid shorter chain. See
//      the anchor section below for the crash-window ordering argument.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('node:crypto');
const Ajv = require('ajv');

const { hashObject } = require('./canonical.cjs');
const JOURNAL_SCHEMA = require('./journal-schema.json');
const { effectClass, PURE_PHASES, EFFECTFUL_PHASES, NINE_PHASES } = require('./charter.cjs');

// Same ajv configuration as tools/ant-hive-world/checkpoint.js and
// tools/ticktock/charter.cjs: draft-07, allErrors, strict.
const ajv = new Ajv({ allErrors: true, strict: true });
const validateRecordShape = ajv.compile(JOURNAL_SCHEMA);

const SCHEMA = 'JournalRecord/1.0';

const HALT_STATES = Object.freeze([
  'EFFECT-RECEIPT-MISSING',
  'EFFECT-DID-NOT-HAPPEN',
  'BENCHMARK-DIVERGENCE',
  'REBASELINE-FREQUENCY',
  'ROSTER-HASH-MISMATCH',
  'CHARTER-IMMUTABILITY-VIOLATION',
  'MERGE-NOT-CLEAN',
  'CEILING-EXCEEDED',
  'ROTATION-MISSING',
  'GATE-BLOCKED',
  'JOURNAL-INTEGRITY-BROKEN',
  'JOURNAL-ANCHOR-MISMATCH',
  // The two UNPARSABLE-FILE halts. Both mean "the journal could not even be
  // read as a list of records", which is a different finding from
  // JOURNAL-INTEGRITY-BROKEN ("it read fine and then failed its checks"), and
  // they are kept apart from each other because they have different CAUSES and
  // different repair paths. See scanJournal() for the discriminator.
  'JOURNAL-TORN-TAIL',
  'JOURNAL-MALFORMED-RECORD'
]);

// The halt states that make a run unresumable until a human-visible
// reconciliation record is appended. Exactly one member today; it is a list
// because the property ("resume is refused until reconciled") is the thing
// being named, not the single state that currently has it.
const RECONCILIATION_REQUIRED_HALTS = Object.freeze(['EFFECT-RECEIPT-MISSING']);

function computeRecordHash(record) {
  return hashObject(record, ['record_hash']);
}

function nowIso() {
  return new Date().toISOString();
}

// Deliberately hashes bytes, not a parsed value: a checkpoint has to detect a
// whitespace-only edit to an artifact just as surely as a semantic one.
function hashArtifact(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    path: filePath,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length
  };
}

// ---------------------------------------------------------------------------
// The head anchor
// ---------------------------------------------------------------------------
//
// WHAT IT IS. A second, separately written file beside the journal --
// <journal>.anchor.json -- carrying the record_hash of the journal's last
// record and how many records the journal had when that hash was the head.
// Nothing else. It is small on purpose: the less it says, the fewer ways it can
// disagree with the journal for reasons that are not tampering.
//
// WHY IT EXISTS. Everything verifyJournalIntegrity() checks is INTERNAL to the
// file, and every internal check passes on a file whose tail was cut off. The
// anchor is the only statement about the journal that does not come from the
// journal, so it is the only thing that can contradict a truncated one.
//
// THE WRITE ORDER, AND WHAT A CRASH IN THE WINDOW LEAVES BEHIND. Two records
// cannot be written atomically to two files, so one of them is written first
// and there is a window in between. The choice made here is APPEND THEN ANCHOR,
// for a single reason: the two failure states it can produce are
// DISTINGUISHABLE, and the alternative's are not.
//
//   append-then-anchor (chosen)  a crash in the window leaves the journal one
//                                or more records AHEAD of the anchor.
//                                Truncation leaves the journal BEHIND it.
//                                Opposite directions, so the reader can say
//                                which happened.
//
//   anchor-then-append (rejected) a crash in the window leaves the anchor ahead
//                                of the journal -- byte-for-byte the same state
//                                a truncated tail produces. Every interrupted
//                                run would be indistinguishable from tampering,
//                                which means the detector could report neither
//                                honestly.
//
// THE ASSUMPTION THAT ARGUMENT RESTS ON, NAMED AND NOW ENFORCED (review defect
// D2). The paragraph above is only true under a SINGLE WRITER. It was
// previously stated as though it were unconditional, and it is not: with two
// concurrent appenders, "the journal is ahead of the anchor" stops being a
// reliable signature of a crash in the window. Two writers that each read the
// same journal derive the same record_index and the same prev_record_hash, and
// both append; the file then holds two records at index N, and the second
// anchor write overwrites the first. The resulting state -- more records than
// the anchor vouches for -- is exactly the ANCHOR_BEHIND shape the argument
// attributes to a crash, so the reader would draw the wrong conclusion with
// full confidence. The interleaving also produces a chain break (two records
// claiming the same predecessor), which verifyJournalIntegrity() would catch --
// but "a second detector happens to catch it" is not the same as the ordering
// argument being sound, and the run has already written a corrupt file by then.
//
// So the assumption is now a MECHANISM rather than a hope: every mutation of
// the journal/anchor pair runs inside an exclusive on-disk writer lock
// (withJournalLock() below, O_EXCL). The read, the index derivation, the
// append, and the anchor write are one critical section. With that in place the
// restated argument is:
//
//   GIVEN that at most one writer is inside the append critical section at any
//   time -- enforced by the O_EXCL lock, not assumed -- the ONLY way the
//   journal can end up ahead of the anchor is a crash after the append and
//   before the anchor write, and the only way it can end up behind is loss of
//   the tail. Those remain opposite directions, so ANCHOR_BEHIND and
//   ANCHOR_AHEAD remain distinguishable and mean what they say.
//
// What the lock does NOT cover is stated at withJournalLock().
//
// BOTH WINDOW STATES ARE HALTS, NOT RECOVERIES. ANCHOR_BEHIND (the crash case)
// is not silently accepted, because "the journal has one more record than the
// anchor vouches for" is exactly as unproven as any other mismatch: the extra
// record chains correctly, but a correctly chained record is something anyone
// with write access can produce. It halts with its own reason and its own
// repair path -- reconcileAnchor(), which re-anchors only after the chain
// verifies and records that a human decided to do it. Automatic re-anchoring is
// deliberately absent: an anchor that repairs itself to match whatever the file
// currently says is not an anchor.
//
// WHAT THE ANCHOR DOES NOT PROVE. It is a consistency check, not an
// authentication one. Anyone who can rewrite the journal can also rewrite the
// anchor, and its own anchor_hash only catches accidental corruption, never a
// deliberate re-computation. It detects truncation, interrupted writes, and
// corruption -- the failure modes an unattended run actually produces -- and
// claims nothing about an adversary with write access to both files.

// ---------------------------------------------------------------------------
// The writer lock (review defect D2)
// ---------------------------------------------------------------------------
//
// WHY A LOCK AND NOT A DECLARED CONTRACT. The two options on the table were an
// enforced exclusive lock, or a single-writer contract that is mechanically
// DETECTED and halts on violation. The lock is chosen because detection is
// strictly weaker here: by the time a second writer could be detected it has
// already appended, and this file's whole premise is that the journal is
// append-only and never rewritten -- so there is no legal repair that removes
// the bad record. A detector would leave a corrupt file behind and name it. The
// lock prevents the corrupt file instead, and its own failure mode (a writer
// that cannot acquire) is a clean refusal that writes nothing.
//
// MECHANISM. fs.openSync(p, 'wx') is O_CREAT|O_EXCL|O_WRONLY: on a local
// filesystem the create-or-fail is atomic, so exactly one caller can win. The
// winner writes its pid, hostname and timestamp into the lock so a later
// arrival can say something specific about who holds it.
//
// STALE LOCKS. A writer killed with SIGKILL cannot clean up, so a lock outliving
// its owner must be breakable or the journal is bricked. It is broken only on
// POSITIVE evidence that the owner is gone: same hostname, and the pid does not
// exist (process.kill(pid, 0) throws ESRCH). Anything short of that is a
// refusal, never a break -- including a lock whose owner LOOKS alive because
// its pid was reused, and a lock written by another host whose liveness this
// process has no way to check. Every ambiguous case fails toward refusing to
// write, which costs a halt; the opposite bias costs a corrupt chain.
//
// WHAT THE LOCK DOES NOT COVER, stated so the guarantee is not read wider than
// it is:
//   - a writer that bypasses appendRecord()/reconcileAnchor() and writes the
//     JSONL file directly. The lock is advisory to this module, not to the OS.
//   - network filesystems (NFSv2, some SMB configurations) where O_EXCL create
//     is not atomic. On such a filesystem this degrades to no mutual exclusion.
//   - pid reuse across a reboot, where a stale lock's pid may be live again.
//     That case refuses rather than breaks, so it is a liveness cost, not a
//     safety one.
//   - anything the process does between releasing the lock and the next
//     acquisition. The lock serializes appends; it does not make a multi-append
//     sequence atomic.

const LOCK_SCHEMA = 'JournalWriterLock/1.0';
const LOCK_DEFAULT_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 20;
const LOCK_SUFFIX = '.lock';

function lockPathFor(journalPath) {
  return `${path.resolve(journalPath)}${LOCK_SUFFIX}`;
}

// The inverse of lockPathFor. Returns null when the path is not a lock path at
// all, which is itself a reason to refuse rather than a reason to guess.
function journalPathForLock(lockPath) {
  const resolved = path.resolve(lockPath);
  return resolved.endsWith(LOCK_SUFFIX) ? resolved.slice(0, -LOCK_SUFFIX.length) : null;
}

// Synchronous sleep. Everything else in this module is synchronous and callers
// depend on that; an async lock would force appendRecord() to become async and
// change every call site for a wait measured in milliseconds.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists and belongs to someone else -- alive.
    return e.code === 'EPERM';
  }
}

function readLockFile(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (parsed.schema !== LOCK_SCHEMA) return { readable: true, valid: false, holder: parsed, reason: `lock schema is "${parsed.schema}"` };
    return { readable: true, valid: true, holder: parsed, reason: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { readable: false, valid: false, holder: null, reason: 'lock disappeared' };
    return { readable: true, valid: false, holder: null, reason: `lock file is not readable as ${LOCK_SCHEMA}: ${e.message}` };
  }
}

// DEFECT D4. A lock file can be schema-valid and still fail to identify its
// owner: a partially-written payload, an explicit null pid, a pid of the wrong
// type, a missing host, or a payload naming some other journal entirely. Before
// this check existed, `{schema, host}` and `{schema, host, pid: null}` both
// reached the stale-owner logic, where pidAlive(undefined) and pidAlive(null)
// return false and the lock was declared BREAKABLE -- so a corrupt or
// half-written lock could be stolen out from under a live owner, which is the
// one thing the lock exists to prevent.
//
// The rule the module already stated is that an unknown owner must refuse.
// This makes that a mechanism rather than a comment: only a payload that
// positively proves same-host-and-pid-absent may be broken, and proving it
// requires every identifying field to be present and well formed FIRST.
// Returns null when the payload is usable, or the reason it is not.
function invalidLockPayloadReason(holder, lockPath) {
  if (!holder || typeof holder !== 'object' || Array.isArray(holder)) {
    return `the lock payload is not an object (got ${JSON.stringify(holder)})`;
  }
  if (!Number.isInteger(holder.pid) || holder.pid <= 0) {
    return `the lock payload carries no usable owner pid (pid: ${JSON.stringify(holder.pid)})`;
  }
  if (typeof holder.host !== 'string' || holder.host.trim() === '') {
    return `the lock payload carries no usable owner host (host: ${JSON.stringify(holder.host)})`;
  }
  if (typeof holder.journal !== 'string' || holder.journal.trim() === '') {
    return `the lock payload names no journal (journal: ${JSON.stringify(holder.journal)})`;
  }
  const expectedJournal = journalPathForLock(lockPath);
  if (expectedJournal === null) {
    return `"${path.resolve(lockPath)}" is not a journal lock path, so no owner identity can be confirmed against it`;
  }
  if (path.resolve(holder.journal) !== expectedJournal) {
    return `the lock payload names journal "${holder.journal}", which is not the journal this lock guards ("${expectedJournal}")`;
  }
  return null;
}

// Returns a description rather than a boolean so the caller can report WHY a
// lock was or was not broken. Breaking is a claim about another process, and a
// claim like that should be legible after the fact.
function inspectLock(lockPath) {
  const read = readLockFile(lockPath);
  if (!read.readable) return { gone: true, breakable: true, reason: 'the lock file no longer exists' };
  if (!read.valid || !read.holder) {
    return { gone: false, breakable: false, holder: read.holder, reason: `the lock file cannot be interpreted (${read.reason}); refusing to break a lock whose owner is unknown` };
  }
  const h = read.holder;
  // Owner-field validation runs BEFORE any stale-owner reasoning. Liveness is a
  // claim about a specific pid on a specific host; without a well-formed pid,
  // host and journal identity there is no such claim to be made, only a guess.
  const invalid = invalidLockPayloadReason(h, lockPath);
  if (invalid) {
    return { gone: false, breakable: false, holder: h, reason: `${invalid}; refusing to break a lock whose owner is unknown` };
  }
  if (h.host !== os.hostname()) {
    return { gone: false, breakable: false, holder: h, reason: `the lock is held by pid ${h.pid} on host "${h.host}", and this process cannot check liveness on another host` };
  }
  if (pidAlive(h.pid)) {
    return { gone: false, breakable: false, holder: h, reason: `the lock is held by pid ${h.pid} on this host and that pid is alive` };
  }
  return { gone: false, breakable: true, holder: h, reason: `the lock is held by pid ${h.pid} on this host and that pid no longer exists -- the owner died without releasing` };
}

function acquireJournalLock(journalPath, options = {}) {
  const p = lockPathFor(journalPath);
  const timeoutMs = options.timeoutMs === undefined ? LOCK_DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const deadline = Date.now() + timeoutMs;
  const broke = [];
  for (;;) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    try {
      const fd = fs.openSync(p, 'wx');
      try {
        fs.writeSync(fd, JSON.stringify({
          schema: LOCK_SCHEMA, pid: process.pid, host: os.hostname(), acquired_at: nowIso(), journal: path.resolve(journalPath)
        }) + '\n');
      } finally {
        fs.closeSync(fd);
      }
      return { path: p, held: true, pid: process.pid, broke_stale: broke };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const state = inspectLock(p);
      if (state.breakable) {
        try {
          fs.rmSync(p, { force: true });
          if (!state.gone) {
            broke.push({ at: nowIso(), reason: state.reason, holder: state.holder });
            // Deliberately noisy: silently reaping another process's lock is
            // exactly the kind of thing that should leave a trace.
            process.stderr.write(`[journal] broke a stale writer lock at ${p}: ${state.reason}\n`);
          }
        } catch { /* another writer may have removed it first; retry */ }
        continue;
      }
      if (Date.now() >= deadline) {
        const err = new Error(`acquireJournalLock: could not acquire the exclusive writer lock at ${p} within ${timeoutMs}ms -- ${state.reason}. Appends are serialized deliberately: two writers that read the same journal derive the same record_index and the same prev_record_hash, which corrupts the append-only chain and destroys the append-then-anchor crash-direction argument. Refusing to write is the safe half of that trade.`);
        err.code = 'JOURNAL_LOCK_TIMEOUT';
        err.lock_path = p;
        err.holder = state.holder || null;
        throw err;
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
}

// Releases only a lock this process still owns. If the lock on disk names a
// different pid, someone broke ours and took it; removing it then would hand a
// third writer a lock the current holder thinks it has.
function releaseJournalLock(lock) {
  if (!lock || !lock.held) return { released: false, reason: 'no lock held' };
  const read = readLockFile(lock.path);
  if (!read.readable) return { released: false, reason: 'the lock file was already gone' };
  if (!read.holder || read.holder.pid !== process.pid) {
    return { released: false, reason: `the lock is now held by ${read.holder ? `pid ${read.holder.pid}` : 'an unreadable owner'}; not removing someone else's lock` };
  }
  fs.rmSync(lock.path, { force: true });
  return { released: true, reason: null };
}

// The critical section. Every mutation of the journal/anchor pair goes through
// this, which is what turns "single writer" from an assumption into a checked
// property.
function withJournalLock(journalPath, fn, options = {}) {
  const lock = acquireJournalLock(journalPath, options);
  try {
    return fn(lock);
  } finally {
    releaseJournalLock(lock);
  }
}

const ANCHOR_SCHEMA = 'JournalHeadAnchor/1.0';

function anchorPathFor(journalPath) {
  return `${path.resolve(journalPath)}.anchor.json`;
}

function computeAnchorHash(anchor) {
  return hashObject(anchor, ['anchor_hash']);
}

// Returns a description of the anchor file rather than throwing: an unreadable
// or unparsable anchor is a finding the caller has to report, not an exception
// that aborts the read of an otherwise intact journal.
function readAnchor(journalPath) {
  const p = anchorPathFor(journalPath);
  if (!fs.existsSync(p)) return { present: false, path: p, anchor: null, corrupt: false, reason: 'no anchor file' };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { present: true, path: p, anchor: null, corrupt: true, reason: `anchor file is not valid JSON: ${e.message}` };
  }
  if (parsed.schema !== ANCHOR_SCHEMA) {
    return { present: true, path: p, anchor: parsed, corrupt: true, reason: `anchor schema is "${parsed.schema}", expected "${ANCHOR_SCHEMA}"` };
  }
  const recomputed = computeAnchorHash(parsed);
  if (recomputed !== parsed.anchor_hash) {
    return { present: true, path: p, anchor: parsed, corrupt: true, reason: `anchor_hash mismatch: stored ${parsed.anchor_hash}, recomputed ${recomputed}` };
  }
  return { present: true, path: p, anchor: parsed, corrupt: false, reason: null };
}

// Written via a temp file and a rename so a crash during the anchor write
// itself leaves the PREVIOUS anchor intact rather than a half-written one.
// A torn anchor would read as corruption -- true, but less informative than the
// stale-but-valid anchor the rename guarantees.
function writeAnchor(journalPath, { record_count, head_record_hash, reconciliations }) {
  const p = anchorPathFor(journalPath);
  const anchor = {
    schema: ANCHOR_SCHEMA,
    journal_basename: path.basename(path.resolve(journalPath)),
    record_count,
    head_record_hash,
    updated_at: nowIso(),
    reconciliations: reconciliations || [],
    anchor_hash: 'placeholder'
  };
  anchor.anchor_hash = computeAnchorHash(anchor);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(anchor, null, 2) + '\n');
  fs.renameSync(tmp, p);
  return anchor;
}

// The six answers, and which of them permit a resume (exactly two: OK and
// OK_EMPTY). Everything else is a halt -- including the crash window, on
// purpose.
function verifyJournalAnchor(journalPath, records) {
  const observedCount = records.length;
  const observedHead = observedCount ? records[observedCount - 1].record_hash : null;
  const read = readAnchor(journalPath);
  const base = {
    anchor_path: read.path,
    observed_record_count: observedCount,
    observed_head_record_hash: observedHead
  };

  if (!read.present) {
    if (observedCount === 0) {
      return { ...base, anchor_state: 'OK_EMPTY', valid: true, expected_record_count: 0, expected_head_record_hash: null, reason: 'no journal and no anchor -- a genuine fresh start' };
    }
    return {
      ...base,
      anchor_state: 'ANCHOR_MISSING',
      valid: false,
      expected_record_count: null,
      expected_head_record_hash: null,
      reason: 'the journal has records but no head anchor exists; without one a truncated tail is indistinguishable from a shorter run, so this is a halt rather than a pass'
    };
  }
  if (read.corrupt) {
    return { ...base, anchor_state: 'ANCHOR_CORRUPT', valid: false, expected_record_count: null, expected_head_record_hash: null, reason: read.reason };
  }

  const a = read.anchor;
  const shared = { ...base, expected_record_count: a.record_count, expected_head_record_hash: a.head_record_hash, anchor_updated_at: a.updated_at };

  if (a.record_count > observedCount) {
    return {
      ...shared,
      anchor_state: 'ANCHOR_AHEAD',
      valid: false,
      missing_record_count: a.record_count - observedCount,
      reason: `the anchor vouches for ${a.record_count} record(s) but the journal holds ${observedCount} -- the tail was truncated. The remaining chain verifies internally, which is exactly why the chain alone cannot be trusted to notice this.`
    };
  }
  if (a.record_count < observedCount) {
    return {
      ...shared,
      anchor_state: 'ANCHOR_BEHIND',
      valid: false,
      unanchored_record_count: observedCount - a.record_count,
      reason: `the journal holds ${observedCount} record(s) but the anchor vouches for only ${a.record_count} -- the shape of a crash between the append and the anchor write. The trailing record(s) are unvouched; resume requires an explicit reconcileAnchor(), never an automatic re-anchor.`
    };
  }
  if (a.head_record_hash !== observedHead) {
    return {
      ...shared,
      anchor_state: 'HEAD_MISMATCH',
      valid: false,
      reason: `record counts agree at ${observedCount} but the head record_hash does not: the anchor vouches for ${a.head_record_hash}, the journal ends at ${observedHead}. The final record was replaced rather than removed.`
    };
  }
  return { ...shared, anchor_state: 'OK', valid: true, reason: `the anchor and the journal agree on ${observedCount} record(s) and on the head record_hash` };
}

// The ONLY way out of ANCHOR_BEHIND, and it is deliberately a function a person
// calls rather than something resolveResume() does on its own. It re-verifies
// the chain first (re-anchoring to a broken chain would launder the break),
// then writes a new anchor carrying an appended, timestamped record of the fact
// that the anchor was moved by hand and why.
function reconcileAnchor(journalPath, options = {}) {
  return withJournalLock(journalPath, () => reconcileAnchorLocked(journalPath, options), options.lock);
}

function reconcileAnchorLocked(journalPath, options = {}) {
  // An unparsable journal is refused here as a return value for the same reason
  // resolveResume() does it: the caller of a repair function needs to be told
  // what is wrong with the file, not handed an exception about line 4.
  const scan = scanJournal(journalPath);
  if (scan.parse_state !== PARSE_INTACT) {
    return {
      reconciled: false,
      parse_state: scan.parse_state,
      halt_state: scan.parse_state === PARSE_TORN_TAIL ? 'JOURNAL-TORN-TAIL' : 'JOURNAL-MALFORMED-RECORD',
      reason: 'the journal cannot be parsed, so there is no chain to verify and no head to anchor to; re-anchoring here would attest to a file this module cannot read',
      malformed: scan.malformed
    };
  }
  const records = scan.records;
  const chain = verifyJournalIntegrity(records);
  if (!chain.valid) {
    return { reconciled: false, reason: 'the journal chain does not verify; re-anchoring would attest to a journal that is already broken', integrity: chain };
  }
  const before = readAnchor(journalPath);
  const state = verifyJournalAnchor(journalPath, records);
  if (state.anchor_state === 'OK' || state.anchor_state === 'OK_EMPTY') {
    return { reconciled: false, reason: 'the anchor already agrees with the journal; there is nothing to reconcile', anchor_state: state.anchor_state };
  }
  if (state.anchor_state === 'ANCHOR_AHEAD') {
    return {
      reconciled: false,
      reason: 'the anchor is AHEAD of the journal: record(s) the anchor vouched for are gone. Re-anchoring here would erase the only evidence that they existed. Restore the journal or open a truncation finding.',
      anchor_state: state.anchor_state,
      detail: state
    };
  }
  const priorReconciliations = (before.anchor && Array.isArray(before.anchor.reconciliations)) ? before.anchor.reconciliations : [];
  const entry = {
    at: nowIso(),
    from_anchor_state: state.anchor_state,
    from_record_count: state.expected_record_count,
    to_record_count: records.length,
    reason: options.reason || 'unstated',
    authorized_by: options.authorized_by || 'unstated'
  };
  const anchor = writeAnchor(journalPath, {
    record_count: records.length,
    head_record_hash: records.length ? records[records.length - 1].record_hash : null,
    reconciliations: [...priorReconciliations, entry]
  });
  return { reconciled: true, reason: `anchor moved from ${state.anchor_state} to the current head`, anchor, entry };
}

// ---------------------------------------------------------------------------
// Read + integrity
// ---------------------------------------------------------------------------

// THE PARSE STATES, and why an unparsable journal is not one finding but two
// (review defect D1).
//
// The previous version of readJournal() threw on any malformed line, which made
// the single most likely real-world failure -- a process killed part-way
// through appendFileSync, leaving a partial final line -- surface as an UNCAUGHT
// EXCEPTION from resolveResume(), the one function whose entire job is to
// return a structured refusal instead of crashing. A crash is not a halt: it
// carries no halt_state, cannot be recorded in the journal, and tells a resuming
// operator nothing except a stack trace.
//
// It is also two different findings wearing one error:
//
//   TORN_TAIL          the LAST line is unparsable and the file does not end in
//                      a newline. Every complete append writes the record and
//                      its terminating '\n' in one call, and a partial write
//                      loses a suffix -- so a present newline proves everything
//                      before it landed, and an absent one is the signature of
//                      a write that was cut off. This is the expected residue of
//                      a crash: benign in origin, and the bytes after the last
//                      complete record are not a record at all.
//
//   MALFORMED_MIDDLE   an unparsable line anywhere else, or an unparsable final
//                      line that IS newline-terminated. Neither can be produced
//                      by a truncated write, because a truncated write can only
//                      remove a suffix of the file. Something rewrote a line
//                      that had already been written -- corruption or tampering.
//
// Both are non-resumable and neither is repaired automatically. They are kept
// apart because they point a human at different questions: a torn tail asks
// "what was this run doing when it died", a malformed middle asks "who edited
// this file". Collapsing them would hand both to the same investigation.
const PARSE_INTACT = 'INTACT';
const PARSE_TORN_TAIL = 'TORN_TAIL';
const PARSE_MALFORMED_MIDDLE = 'MALFORMED_MIDDLE';

function scanJournal(journalPath) {
  const resolved = path.resolve(journalPath);
  if (!fs.existsSync(resolved)) {
    return {
      path: resolved, present: false, parse_state: PARSE_INTACT, records: [],
      malformed: [], line_count: 0, ends_with_newline: true
    };
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const endsWithNewline = raw.length === 0 || raw.endsWith('\n');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const records = [];
  const malformed = [];
  lines.forEach((line, i) => {
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      malformed.push({ line_index: i, byte_length: Buffer.byteLength(line), message: e.message });
    }
  });

  let parse_state = PARSE_INTACT;
  if (malformed.length === 1 && malformed[0].line_index === lines.length - 1 && !endsWithNewline) {
    parse_state = PARSE_TORN_TAIL;
  } else if (malformed.length > 0) {
    parse_state = PARSE_MALFORMED_MIDDLE;
  }

  return {
    path: resolved,
    present: true,
    parse_state,
    // For TORN_TAIL these are the complete records that precede the torn bytes,
    // which is genuinely all of them. For MALFORMED_MIDDLE the list has a hole
    // and its indexes no longer line up with the file -- it is diagnostic only,
    // and nothing downstream resumes from it.
    records,
    malformed,
    line_count: lines.length,
    ends_with_newline: endsWithNewline
  };
}

// Kept throwing, because every caller other than the resume path treats an
// unreadable journal as a programming-level failure. The difference from before
// is that the error now CARRIES the discrimination, so a caller that wants to
// turn it into a halt does not have to re-derive it from the message.
function readJournal(journalPath) {
  const scan = scanJournal(journalPath);
  if (scan.parse_state === PARSE_INTACT) return scan.records;
  const first = scan.malformed[0];
  const err = new Error(scan.parse_state === PARSE_TORN_TAIL
    ? `readJournal: the final line (${first.line_index}) is unterminated and unparsable -- the signature of a process killed mid-append. The journal cannot be trusted for resume until this is reconciled.`
    : `readJournal: line ${first.line_index} is not valid JSON and the file is not merely torn at the tail -- a completed line was rewritten, which truncation cannot cause.`);
  err.parse_state = scan.parse_state;
  err.halt_state = scan.parse_state === PARSE_TORN_TAIL ? 'JOURNAL-TORN-TAIL' : 'JOURNAL-MALFORMED-RECORD';
  err.line_index = first.line_index;
  err.scan = scan;
  throw err;
}

// Four INTERNAL checks: every record is schema-shaped, record_index equals
// position, record_hash recomputes, and prev_record_hash chains. The chain
// check is what catches a deleted MIDDLE record -- the other three would each
// pass on a file with a hole in it.
//
// None of the four can catch a deleted LAST record, and no internal check ever
// could: cut the tail off and what is left is a shorter chain that satisfies
// all four. That is what `journalPath` is for. Supply it and the anchor is
// checked too, which is the only way this function returns valid: false on a
// truncated tail. Omit it and the result is honestly narrower -- the chain is
// intact, and nothing has been claimed about the file's length.
function verifyJournalIntegrity(records, journalPath) {
  const errors = [];
  let prevHash = null;
  records.forEach((rec, i) => {
    if (!validateRecordShape(rec)) {
      for (const e of validateRecordShape.errors || []) {
        errors.push({ record_index: i, check: 'SCHEMA_SHAPE', message: `${e.instancePath || '(root)'} ${e.message}` });
      }
      prevHash = rec.record_hash || null;
      return;
    }
    if (rec.record_index !== i) {
      errors.push({ record_index: i, check: 'INDEX', message: `record_index ${rec.record_index} does not equal its position ${i} -- a gap or a repeat means a record was removed or duplicated` });
    }
    const recomputed = computeRecordHash(rec);
    if (recomputed !== rec.record_hash) {
      errors.push({ record_index: i, check: 'RECORD_HASH', message: `record_hash mismatch: stored ${rec.record_hash}, recomputed ${recomputed}` });
    }
    if (rec.prev_record_hash !== prevHash) {
      errors.push({ record_index: i, check: 'CHAIN', message: `prev_record_hash ${rec.prev_record_hash} does not match the preceding record_hash ${prevHash}` });
    }
    prevHash = rec.record_hash;
  });

  if (journalPath === undefined) {
    return {
      valid: errors.length === 0,
      errors,
      records_checked: records.length,
      anchor_checked: false,
      tail_truncation_detectable: false
    };
  }

  const anchor = verifyJournalAnchor(journalPath, records);
  if (!anchor.valid) {
    errors.push({ record_index: records.length ? records.length - 1 : 0, check: 'HEAD_ANCHOR', message: `${anchor.anchor_state}: ${anchor.reason}` });
  }
  return {
    valid: errors.length === 0,
    errors,
    records_checked: records.length,
    anchor_checked: true,
    tail_truncation_detectable: true,
    anchor
  };
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

// APPEND-ONLY, enforced by construction: this function only ever computes the
// next index from the existing file and appends one line. There is no update
// path, no rewrite path, and no delete path in this module -- an operation that
// does not exist cannot be reached by mistake.
//
// SERIALIZED, not merely append-only (review defect D2). The whole read ->
// derive index -> append -> anchor sequence runs inside the exclusive writer
// lock. Without it two concurrent callers read the same file, derive the same
// record_index and prev_record_hash, and both append -- producing a chain with
// two records at index N and an anchor that vouches for only one of them.
function appendRecord(journalPath, partial, options = {}) {
  return withJournalLock(journalPath, () => appendRecordLocked(journalPath, partial), options.lock);
}

// DEFECT D6: the hard gate described at the export site. The token is a
// sentence rather than a flag so that a call site cannot read as ordinary API
// use, and so that every use of the unlocked path is greppable by one string.
const UNLOCKED_CONTROL_OPT_IN =
  'I am the D2 differential control and I accept that this append corrupts the journal';
const UNLOCKED_CONTROL_ENV = 'TICKTOCK_ALLOW_UNLOCKED_CONTROL';

function unlockedAppendForDifferentialControl(optIn) {
  if (process.env[UNLOCKED_CONTROL_ENV] !== '1' || optIn !== UNLOCKED_CONTROL_OPT_IN) {
    const err = new Error(
      'unlockedAppendForDifferentialControl: refusing to hand out the unserialized append path. '
      + `It exists only as the differential control that demonstrates what the writer lock prevents, and it requires BOTH ${UNLOCKED_CONTROL_ENV}=1 in the environment AND the exact opt-in token. `
      + 'Appending outside the lock lets two writers derive the same record_index and the same prev_record_hash, which corrupts the append-only chain -- that is defect D2, reproduced on purpose by the test suite and by nothing else.'
    );
    err.code = 'JOURNAL_UNLOCKED_APPEND_FORBIDDEN';
    throw err;
  }
  return appendRecordLocked;
}

function appendRecordLocked(journalPath, partial) {
  const resolved = path.resolve(journalPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const existing = readJournal(resolved);
  const prev = existing.length ? existing[existing.length - 1] : null;

  const phaseId = partial.phase_id;
  if (!NINE_PHASES.includes(phaseId)) {
    throw new Error(`appendRecord: unknown phase_id "${phaseId}"`);
  }
  const cls = effectClass(phaseId);

  if (cls === 'EFFECTFUL' && !partial.idempotency_key) {
    throw new Error(`appendRecord: ${phaseId} is EFFECTFUL and requires an idempotency_key -- an effect recorded without one cannot be checked for a double-fire on resume`);
  }
  if (cls === 'PURE' && partial.idempotency_key) {
    throw new Error(`appendRecord: ${phaseId} is PURE and must not carry an idempotency_key -- a key implies an exactly-once claim the phase does not make`);
  }

  const record = {
    schema: SCHEMA,
    record_index: existing.length,
    charter_hash: partial.charter_hash,
    cycle_index: partial.cycle_index,
    phase_id: phaseId,
    effect_class: cls,
    entered: partial.entered || nowIso(),
    completed: partial.completed === undefined ? null : partial.completed,
    idempotency_key: partial.idempotency_key || null,
    artifact_hashes: partial.artifact_hashes || [],
    verified_checkpoint: partial.verified_checkpoint || {
      verified: false, verified_at: null, method: 'none', rehash_matches: null
    },
    halt_state: partial.halt_state === undefined ? null : partial.halt_state,
    prev_record_hash: prev ? prev.record_hash : null,
    record_hash: 'placeholder'
  };

  for (const optional of ['idempotency_inputs', 'dispatch', 'halt_detail', 'reconciliation', 'rollback', 'inherited_gate_checks']) {
    if (partial[optional] !== undefined) record[optional] = partial[optional];
  }

  if (record.halt_state !== null && !HALT_STATES.includes(record.halt_state)) {
    throw new Error(`appendRecord: unknown halt_state "${record.halt_state}"`);
  }
  // A record that halts into reconciliation must SAY so on the record itself.
  // Leaving it to a reader to infer "this halt needs reconciliation" from the
  // halt name is exactly the prose-instead-of-field failure the plan forbids.
  if (RECONCILIATION_REQUIRED_HALTS.includes(record.halt_state)) {
    record.reconciliation = record.reconciliation || {
      required: true, resolved: false, resolved_at: null, outcome: 'pending'
    };
    if (record.reconciliation.required !== true) {
      throw new Error(`appendRecord: halt_state ${record.halt_state} requires reconciliation.required === true`);
    }
  }

  record.record_hash = computeRecordHash(record);

  if (!validateRecordShape(record)) {
    const err = new Error('appendRecord: refused to append a schema-invalid record');
    err.errors = validateRecordShape.errors;
    throw err;
  }

  // APPEND, THEN ANCHOR -- in that order, for the reason argued at length in
  // the anchor section above: the crash window this leaves (journal ahead of
  // anchor) points the OPPOSITE way from a truncation (journal behind anchor),
  // so a reader can tell the two apart. Both still halt. That argument holds
  // only because this function runs inside the exclusive writer lock; see the
  // restated version in the anchor section for the assumption and its
  // enforcement.
  fs.appendFileSync(resolved, JSON.stringify(record) + '\n');
  const priorAnchor = readAnchor(resolved);
  writeAnchor(resolved, {
    record_count: record.record_index + 1,
    head_record_hash: record.record_hash,
    reconciliations: (priorAnchor.anchor && Array.isArray(priorAnchor.anchor.reconciliations)) ? priorAnchor.anchor.reconciliations : []
  });
  return record;
}

// ---------------------------------------------------------------------------
// Verified checkpoints
// ---------------------------------------------------------------------------

// THE VERIFICATION STEP. Re-reads every artifact from disk and re-hashes it,
// comparing against the digests the caller recorded. Returns a
// verified_checkpoint object suitable for a completion record. It never trusts
// a caller's claim that a write succeeded, and it never re-uses a hash computed
// earlier in the same process -- both would verify the intention rather than
// the disk.
function verifyCheckpoint(artifactHashes) {
  const mismatched = [];
  let matches = 0;
  for (const entry of artifactHashes) {
    let actual = null;
    try {
      actual = hashArtifact(entry.path).sha256;
    } catch {
      mismatched.push(entry.path);
      continue;
    }
    if (actual === entry.sha256) matches += 1;
    else mismatched.push(entry.path);
  }
  const verified = mismatched.length === 0;
  const checkpoint = {
    verified,
    verified_at: verified ? nowIso() : null,
    method: verified ? 'independent-rehash' : 'none',
    rehash_matches: matches
  };
  if (mismatched.length) checkpoint.rehash_mismatched_paths = mismatched;
  return checkpoint;
}

// Convenience for the completion path: hash the artifacts, then immediately
// re-hash them independently and append a completion record carrying the
// result. Split into two passes on purpose -- one write-then-hash pass and one
// separate read-then-hash pass -- so the second pass can actually disagree with
// the first.
function completePhase(journalPath, partial, artifactPaths) {
  const artifactHashes = artifactPaths.map((p) => hashArtifact(p));
  const verified_checkpoint = verifyCheckpoint(artifactHashes);
  return appendRecord(journalPath, {
    ...partial,
    completed: partial.completed || nowIso(),
    artifact_hashes: artifactHashes,
    verified_checkpoint
  });
}

function lastVerifiedCheckpoint(records) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r.verified_checkpoint && r.verified_checkpoint.verified === true) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Idempotency resolution
// ---------------------------------------------------------------------------

// The decision record's three-way answer, computed from the journal alone.
//
//   skip      the key is present on a record that verified its checkpoint --
//             the effect happened and was confirmed
//   reconcile the key is present but the record dispatched without a confirmed
//             receipt, or halted into EFFECT-RECEIPT-MISSING -- the effect MAY
//             have happened, so halt and query the external system
//   execute   the key is absent -- run the phase
//
// The middle answer is never merged into either neighbour. "Probably did not
// happen" collapses to execute and risks a double effect; "probably happened"
// collapses to skip and risks a silent no-op. Neither is a claim this module
// is entitled to make, so it returns the uncertainty instead.
function resolveIdempotency(records, idempotencyKey) {
  const matching = records.filter((r) => r.idempotency_key === idempotencyKey);
  if (matching.length === 0) {
    return { resolution: 'execute', reason: 'no journal record carries this idempotency key', record: null };
  }
  const completed = matching.find((r) => r.completed && r.verified_checkpoint && r.verified_checkpoint.verified === true && r.halt_state === null);
  if (completed) {
    return {
      resolution: 'skip',
      reason: `phase already completed at record_index ${completed.record_index} with a verified checkpoint`,
      record: completed
    };
  }
  const uncertain = matching.find((r) => r.halt_state === 'EFFECT-RECEIPT-MISSING'
    || (r.dispatch && r.dispatch.dispatched === true && r.dispatch.receipt_confirmed !== true));
  if (uncertain) {
    const reconciled = uncertain.reconciliation && uncertain.reconciliation.resolved === true;
    if (reconciled && uncertain.reconciliation.outcome === 'effect-happened') {
      return { resolution: 'skip', reason: `reconciliation at record_index ${uncertain.record_index} confirmed the effect happened`, record: uncertain };
    }
    if (reconciled && uncertain.reconciliation.outcome === 'effect-did-not-happen') {
      return { resolution: 'execute', reason: `reconciliation at record_index ${uncertain.record_index} confirmed the effect did not happen`, record: uncertain };
    }
    return {
      resolution: 'reconcile',
      reason: `record_index ${uncertain.record_index} dispatched an external action with no confirmed receipt (EFFECT-RECEIPT-MISSING) -- query the external system before resuming; never auto-retry and never assume success`,
      halt_state: 'EFFECT-RECEIPT-MISSING',
      record: uncertain
    };
  }
  // The key exists on a record that never dispatched: EFFECT-DID-NOT-HAPPEN.
  // Safe to execute -- this is the case the two-state distinction buys.
  return {
    resolution: 'execute',
    reason: `record_index ${matching[matching.length - 1].record_index} carries the key but never dispatched (EFFECT-DID-NOT-HAPPEN)`,
    record: matching[matching.length - 1]
  };
}

// ---------------------------------------------------------------------------
// Resume-point resolution
// ---------------------------------------------------------------------------

// What a resuming /tt reads before doing anything else. Returns the phase to
// resume FROM, the rollback set, and -- when the journal is in a state no
// automatic resume may leave -- a refusal carrying the halt_state that explains
// it. A refusal is a return value here, not an exception, because the caller
// has to record it in the journal rather than crash on it.
function resolveResume(journalPath) {
  // FIRST, BEFORE ANYTHING ELSE: can the file even be parsed? This used to be
  // an unguarded readJournal() call, so the most likely real-world corruption --
  // a partial final line left by a process killed mid-append -- escaped as an
  // exception past every structured refusal below it (review defect D1). An
  // integrity halt that arrives as a stack trace is not an integrity halt.
  const scan = scanJournal(journalPath);
  if (scan.parse_state !== PARSE_INTACT) {
    const torn = scan.parse_state === PARSE_TORN_TAIL;
    return {
      resumable: false,
      halt_state: torn ? 'JOURNAL-TORN-TAIL' : 'JOURNAL-MALFORMED-RECORD',
      parse_state: scan.parse_state,
      reason: torn
        ? `the journal's final line (index ${scan.malformed[0].line_index}, ${scan.malformed[0].byte_length} bytes) is unterminated and unparsable -- the signature of a process killed part-way through an append. The ${scan.records.length} complete record(s) before it are readable, but resuming past a write whose outcome is unknown would be a fresh-state fallback wearing a resume costume. A human decides whether the torn bytes are discarded, and reconcileAnchor() records that decision.`
        : `the journal has ${scan.malformed.length} unparsable line(s) (${scan.malformed.map((m) => m.line_index).join(', ')}) that a truncated write cannot explain: a partial write can only lose a suffix, so a broken line that is newline-terminated, or that has complete lines after it, was rewritten after it was already committed. Treat this as corruption or tampering, not as an interrupted run.`,
      malformed: scan.malformed,
      complete_record_count: scan.records.length,
      ends_with_newline: scan.ends_with_newline,
      reconciliation_required_before_resume: true,
      // Advisory only. The anchor is read against the records that DID parse, so
      // on a torn tail it usually reports OK or ANCHOR_BEHIND -- useful context
      // for the human, never a basis for resuming.
      anchor_advisory: verifyJournalAnchor(journalPath, scan.records),
      integrity: {
        valid: false,
        errors: scan.malformed.map((m) => ({ record_index: m.line_index, check: 'PARSE', message: m.message })),
        records_checked: 0,
        anchor_checked: false,
        tail_truncation_detectable: false
      },
      resume_point: null
    };
  }

  const records = scan.records;
  // The path is passed deliberately: without it this check cannot see a
  // truncated tail, which is the single most likely way an unattended run's
  // journal ends up wrong.
  const integrity = verifyJournalIntegrity(records, journalPath);
  if (!integrity.valid) {
    const anchorBroken = integrity.anchor && !integrity.anchor.valid;
    return {
      resumable: false,
      // An anchor disagreement gets its own halt state. "The chain is broken"
      // and "the file disagrees with what was independently committed about it"
      // are different findings with different repair paths, and collapsing them
      // would send a truncated journal down the wrong one.
      halt_state: anchorBroken ? 'JOURNAL-ANCHOR-MISMATCH' : 'JOURNAL-INTEGRITY-BROKEN',
      reason: anchorBroken
        ? `the journal disagrees with its head anchor (${integrity.anchor.anchor_state}): ${integrity.anchor.reason}`
        : 'the journal failed its integrity check; resuming from a journal that may have been edited or truncated would be a fresh-state fallback wearing a resume costume',
      anchor_state: integrity.anchor ? integrity.anchor.anchor_state : null,
      reconciliation_required_before_resume: Boolean(anchorBroken && integrity.anchor.anchor_state === 'ANCHOR_BEHIND'),
      integrity,
      resume_point: null
    };
  }

  if (records.length === 0) {
    return {
      resumable: true,
      halt_state: null,
      reason: 'empty journal -- this is a genuine fresh start, recorded explicitly rather than fallen back into',
      fresh_start: true,
      resume_point: { cycle_index: 0, phase_id: NINE_PHASES[0], from_record_index: null },
      rollback: { performed: false, restored_to_record_index: null, discarded_paths: [] },
      integrity
    };
  }

  // An unreconciled uncertain-effect record blocks resume outright, wherever it
  // sits in the file. Checked before the checkpoint search, because a verified
  // checkpoint appended after such a record would otherwise mask it.
  const unreconciled = records.find((r) => r.halt_state === 'EFFECT-RECEIPT-MISSING'
    && !(r.reconciliation && r.reconciliation.resolved === true));
  if (unreconciled) {
    return {
      resumable: false,
      halt_state: 'EFFECT-RECEIPT-MISSING',
      reason: `record_index ${unreconciled.record_index} (${unreconciled.phase_id}) dispatched an external action whose receipt is unknown; an explicit reconciliation record is required before resume`,
      reconciliation_required_before_resume: true,
      blocking_record_index: unreconciled.record_index,
      resume_point: null,
      integrity
    };
  }

  const checkpoint = lastVerifiedCheckpoint(records);
  if (!checkpoint) {
    return {
      resumable: false,
      halt_state: 'JOURNAL-INTEGRITY-BROKEN',
      reason: 'the journal has records but not one verified checkpoint; there is no state to resume TO, and inventing one would be a silent fresh-state fallback',
      resume_point: null,
      integrity
    };
  }

  // PARTIAL-PHASE ROLLBACK. Every record after the last verified checkpoint
  // belongs to phases that did not complete. Their artifacts are the residue of
  // writes that were never confirmed, so they are discarded rather than trusted
  // -- replaying mid-phase work forward would build the next generation on top
  // of state no checkpoint ever attested to.
  const after = records.slice(checkpoint.record_index + 1);
  const discarded = [];
  for (const r of after) {
    for (const a of r.artifact_hashes || []) {
      if (!discarded.includes(a.path)) discarded.push(a.path);
    }
  }

  const nextPhaseIndex = NINE_PHASES.indexOf(checkpoint.phase_id) + 1;
  const wrapped = nextPhaseIndex >= NINE_PHASES.length;

  return {
    resumable: true,
    halt_state: null,
    reason: `resuming from the last VERIFIED checkpoint (record_index ${checkpoint.record_index}, ${checkpoint.phase_id}); ${after.length} later record(s) belong to phases that never verified and are rolled back`,
    fresh_start: false,
    last_verified_record_index: checkpoint.record_index,
    resume_point: {
      cycle_index: wrapped ? checkpoint.cycle_index + 1 : checkpoint.cycle_index,
      phase_id: wrapped ? NINE_PHASES[0] : NINE_PHASES[nextPhaseIndex],
      from_record_index: checkpoint.record_index
    },
    rollback: {
      performed: after.length > 0,
      restored_to_record_index: checkpoint.record_index,
      discarded_paths: discarded
    },
    integrity
  };
}

module.exports = {
  SCHEMA,
  ANCHOR_SCHEMA,
  HALT_STATES,
  RECONCILIATION_REQUIRED_HALTS,
  PURE_PHASES,
  EFFECTFUL_PHASES,
  NINE_PHASES,
  PARSE_INTACT,
  PARSE_TORN_TAIL,
  PARSE_MALFORMED_MIDDLE,
  appendRecord,
  // DEFECT D6. This used to be `__appendRecordUnlocked: appendRecordLocked` --
  // a fully callable, unserialized append sitting on the public export surface,
  // guarded by nothing but the comment saying not to call it. Prose is not
  // mechanism, and the section-9 differential control proves what a runtime
  // caller would get: a corrupted chain.
  //
  // What is exported now is not an append at all. It is a factory that refuses
  // to hand the unlocked path out unless the caller has performed two separate,
  // deliberate acts that no production code path performs by accident: setting
  // TICKTOCK_ALLOW_UNLOCKED_CONTROL=1 in the environment, and passing the exact
  // opt-in token below. Either one missing throws loudly, so a runtime caller
  // fails at the call rather than silently corrupting the journal.
  UNLOCKED_CONTROL_OPT_IN,
  unlockedAppendForDifferentialControl,
  completePhase,
  readJournal,
  scanJournal,
  lockPathFor,
  acquireJournalLock,
  releaseJournalLock,
  withJournalLock,
  inspectLock,
  verifyJournalIntegrity,
  verifyCheckpoint,
  lastVerifiedCheckpoint,
  hashArtifact,
  computeRecordHash,
  resolveIdempotency,
  resolveResume,
  anchorPathFor,
  readAnchor,
  writeAnchor,
  verifyJournalAnchor,
  reconcileAnchor
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const [cmd, target] = process.argv.slice(2);
  // An unparsable journal exits with a named finding on stdout rather than a
  // stack trace on stderr: the CLI is what an operator reaches for when a run
  // died, which is exactly when the file is most likely to be torn.
  if (target && ['verify', 'anchor', 'read'].includes(cmd)) {
    const scan = scanJournal(target);
    if (scan.parse_state !== PARSE_INTACT) {
      process.stdout.write(JSON.stringify({
        valid: false,
        halt_state: scan.parse_state === PARSE_TORN_TAIL ? 'JOURNAL-TORN-TAIL' : 'JOURNAL-MALFORMED-RECORD',
        parse_state: scan.parse_state,
        malformed: scan.malformed,
        complete_record_count: scan.records.length,
        next_step: 'run `resume` for the full structured halt; no automatic repair exists by design'
      }, null, 2) + '\n');
      process.exit(1);
    }
  }
  if (cmd === 'verify' && target) {
    // The path is passed, so `verify` checks the anchor as well as the chain.
    const result = verifyJournalIntegrity(readJournal(target), target);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.valid ? 0 : 1);
  } else if (cmd === 'anchor' && target) {
    const result = verifyJournalAnchor(target, readJournal(target));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.valid ? 0 : 1);
  } else if (cmd === 'reconcile-anchor' && target) {
    const result = reconcileAnchor(target, { reason: process.argv[5] || 'unstated', authorized_by: process.argv[6] || 'unstated' });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.reconciled ? 0 : 1);
  } else if (cmd === 'resume' && target) {
    const result = resolveResume(target);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.resumable ? 0 : 1);
  } else if (cmd === 'read' && target) {
    process.stdout.write(JSON.stringify(readJournal(target), null, 2) + '\n');
  } else {
    process.stderr.write('usage: journal.cjs verify|anchor|reconcile-anchor|resume|read <journal.jsonl>\n');
    process.exit(2);
  }
}
