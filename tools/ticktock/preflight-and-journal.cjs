#!/usr/bin/env node
'use strict';

// THE MISSING GATE-BLOCKED EMITTER.
//
// S4-B review finding G3 (gemini, MINOR), and this session's own halt-state
// audit before it: `GATE-BLOCKED` is a declared halt state that SKILL.md
// documents as being appended when the preflight refuses — and no code in
// tools/ticktock/ ever appends it. `preflight-ticktock.cjs` exits non-zero and
// writes nothing. The record only appeared when a human driver wrote one by hand.
//
// A declared failure mode that no code path can fire is a false safety claim.
// That is the standing lesson (halt-states-with-no-emitter-are-lies), and it has
// caught real defects here before.
//
// WHY THIS IS A SEPARATE TOOL RATHER THAN A CHANGE TO THE PREFLIGHT.
// The preflight is deliberately READ-ONLY: it is called at phase entry, possibly
// several times per cycle, and possibly by callers with no journal at all. Making
// it write would give a *checking* function a side effect, and would mean a
// refusal could itself fail for a reason unrelated to the gate (unwritable
// journal, missing charter). Checking and recording are different jobs. So the
// preflight keeps returning a verdict, and this wrapper is the thing that records
// one.
//
// Usage:
//   node tools/ticktock/preflight-and-journal.cjs \
//     --charter <path> --journal <path> [--cycle <n>] [-- <invocation args>]
//
// Exit code is the preflight's own: 0 PROCEED, 1 REFUSE, 2 internal error.
// Journalling never changes the verdict — if the record cannot be written, that
// is reported loudly and the refusal still stands.

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { preflight } = require('./preflight-ticktock.cjs');
const charterMod = require('./charter.cjs');
const journal = require('./journal.cjs');

function argOf(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main() {
  const charterPath = argOf('--charter');
  const journalPath = argOf('--journal');
  if (!charterPath || !journalPath) {
    console.error('usage: --charter <path> --journal <path> [--cycle <n>] [-- <invocation args>]');
    return 2;
  }
  const cycleIndex = Number(argOf('--cycle', '0'));

  // Everything after a bare `--` is the /tt invocation being checked.
  const sep = process.argv.indexOf('--');
  const invocationTokens = sep !== -1 ? process.argv.slice(sep + 1) : [];

  // S4-C codex finding 1 (2026-08-12): this wrapper previously dropped its
  // --charter and called preflight with {}, so G-TICKTOCK-REVIEW bound the
  // decision against a DEFAULT charter while the journal below recorded against
  // the caller's — a cleared decision for another charter could authorize the
  // wrong run. The run's charter now flows into the gate as runCharterPath.
  const verdict = preflight(invocationTokens, { runCharterPath: path.resolve(charterPath) });
  const refused = verdict.verdict !== 'PROCEED';

  process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');

  if (!refused) return 0;

  // Refused. Record it, naming the gate that refused.
  const blocking = (verdict.gates || []).filter((g) => g.verdict === 'REFUSE');
  const detail = [
    `HALT: preflight refused invocation ${JSON.stringify(invocationTokens.join(' ') || '(bare)')}.`,
    ...blocking.map((g) => `GATE ${g.gate_id}: ${g.reason_code} — ${g.reason}`),
    verdict.halt_text ? `HALT TEXT (verbatim):\n${verdict.halt_text}` : null,
    'Recorded by preflight-and-journal.cjs, the GATE-BLOCKED emitter. The preflight itself stays read-only; checking and recording are different jobs.'
  ].filter(Boolean).join('\n\n');

  try {
    const charter = charterMod.readCharter(path.resolve(charterPath));
    const v = charterMod.validateCharter(charter);
    if (!v.valid) {
      console.error('JOURNALLING SKIPPED: charter invalid — ' + JSON.stringify(v.errors || v));
      console.error('The refusal STANDS regardless; only the record is missing.');
      return 1;
    }
    const rec = journal.appendRecord(path.resolve(journalPath), {
      charter_hash: charter.charter_hash,
      cycle_index: cycleIndex,
      phase_id: 'tt.orient',
      halt_state: 'GATE-BLOCKED',
      halt_detail: detail
    });
    console.error(`GATE-BLOCKED journalled: record_index=${rec.record_index} gates=${blocking.map((g) => g.gate_id).join(',')}`);
  } catch (err) {
    // A failure to RECORD a refusal must never be mistaken for a pass.
    console.error(`JOURNALLING FAILED (${err.message}). The refusal STANDS; only the record is missing.`);
  }
  return 1;
}

process.exit(main());
