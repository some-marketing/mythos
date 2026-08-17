---
description: Run the Mythos↔simulation co-evolution loop — nine phases, one resumable cycle
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

<objective>
Run `/ticktock` — the tick-tock co-evolution cadence as one resumable state
machine. Nine identity-stable phases under an immutable run charter:

**ORIENT → TICK → OBSERVE → TEXT → RESEARCH → TOCK → IMPROVE → SHIP → SCHEDULE**

The full command body is the skill at `.claude/skills/ticktock/SKILL.md`. Read it
before acting — the phase definitions, the per-phase gate bindings, the honest
capability tiers, and the refusals are all there and none of them are optional.
</objective>

<arguments>
- `/ticktock` — one attended cycle.
- `/ticktock N` — N generations (**unattended** for N>1).
- `/ticktock deep` — one cycle at maximum rigor.
- `/ticktock quick` — reduced fan-out; skipped phases are recorded, not omitted. May not merge.
- `/ticktock tock` — TOCK only (`/meditate` in the loop's frame; no sim authority).
- `/ticktock --until <deterministic milestone>` — run to a milestone (**unattended**).
- `--dry-run` — modifier on any form: a declared local-only run. No phase may issue
  an effectful remote command; one that would have is recorded as skipped and the
  cycle may not merge.

A statistical `--until` is **unrepresentable**: `RunCharter/1.0`'s
`stopping_rules.until_kind` is an enum of `cycle_ceiling | deterministic_milestone
| none`. Report the schema's refusal; do not add a second guard on top of it.
</arguments>

<process>
1. Follow `.claude/skills/ticktock/SKILL.md` in full.
2. Run the phase-entry preconditions first, as an executable and not as a
   recollection:

   ```
   node tools/ticktock/preflight-and-journal.cjs --charter <run-charter.json> --journal <journal.jsonl> [--cycle <n>] -- <the invocation's arguments>
   ```

   **`--charter <path>` is mandatory** (`ticktock-resume-and-binding-repair` B3,
   2026-08-13): the bare `preflight-ticktock.cjs` executable now also requires it
   at its own CLI boundary and refuses `RUN-CHARTER-UNRESOLVED` without it — there
   is no more bare-args form. `preflight-and-journal.cjs` is the phase-entry
   command proper: it calls the read-only `preflight-ticktock.cjs` and, on
   refusal, additionally records `GATE-BLOCKED` into the named journal (the
   preflight itself never writes).

   Exit 0 proceeds, exit 1 refuses, exit 2 is an internal error and also refuses.
   It evaluates exactly TWO gates fail-closed: `pretooluse-live` and
   `G-TICKTOCK-REVIEW` (the `gates` array built in the exported `preflight()`
   function in `preflight-ticktock.cjs` — cite the seam, not a line number, which
   drifts with edits). `G-TICKTOCK-REVIEW` additionally enforces run-roster
   binding when `--charter` names the run's charter: the decision's trial
   charter's locked lanes must match the run charter's locked lanes exactly by
   `lane_id`+`family`+`model_pin`+`assignment_order`, refusing
   `RUN-ROSTER-MISMATCH` otherwise. Any failure halts and names its reason;
   neither warns-and-proceeds.

   **It does NOT check the charter frame or journal integrity.** An earlier
   revision of this file claimed it did — corrected 2026-08-05T19:52Z after the
   S4-B codex lane caught the overclaim. Those two ARE required preconditions, but
   they are separate ones the caller must run itself via `charter.readCharter` +
   `charter.validateCharter` and `journal.verifyJournalIntegrity` +
   `journal.verifyJournalAnchor` + `journal.resolveResume`, per the skill's
   `phase_entry_preconditions`. A command file that promises more than its
   executable performs is the more dangerous direction of error: it invites a
   caller to believe four checks ran when two did.

   **The preflight is ADVISORY, not BLOCKING** — a real fail-closed script, but
   nothing in the harness compels the call, and the BLOCKING version would be a
   registered hook under `tools/kernel/hooks/`, inside the convene perimeter.
3. Every cycle, in order: benchmark first, rotation dispatch, generation
   manifest, journal transitions — calling `tools/ticktock/run-benchmark.js`,
   `charter.cjs`, `journal.cjs`, and `canonical.cjs` through their exported API.
   Never reimplement them. `journal.cjs` received a repair (B1/B2/B4 of
   `ticktock-resume-and-binding-repair`, 2026-08-13: terminal-halt resume
   blocking, missing-journal refusal, checkpoint re-verification at resume) and
   is not currently under active repair — exported surface only, as always.
4. Name each phase's applicable gates and their true tier (BLOCKING / ADVISORY /
   ABSENT / UNKNOWN) as you enter it.
</process>

<honest_status>
*Corrected 2026-08-05T18:17Z. The S4-B codex lane flagged this block as
contradicting current alias, hook and review-artifact state — a defect this
session had already tried to fix at ~15:40Z, when the harness permission
classifier denied the edit. Every claim below is now verified against the code.*

- **`/tt` resolves.** The registry entry landed at commit `3a952db1b` under an
  operator-minted `ConveneReceipt/1.0`. `.claude/commands/tt.md` is GENERATED from
  that entry by `tools/instructions/generate-alias-stubs.cjs` and must never be
  hand-written — a stub no registry entry produced forges generated provenance.
- **`G-REMOTE-MUTATION` is WIRED and BLOCKING on the Bash lane for commands its
  classifier can positively resolve** — it is not fully authoritative.
  Registered in `tools/kernel/hooks/dispatch-pretool.cjs` (require-site near
  line 280 at HEAD; the line drifts with edits — the require is the authority,
  not this citation); one live denial
  met the six-part standard and two distinct-family reviewers set
  `enforcement_path_observed_live: true`. Scope limit, stated because it is not
  a formality: Bash lane only. Non-Bash lanes (MCP, direct-execution tools) and
  already-running processes are outside it, and the gate reasons about command
  TEXT rather than the syscall. **Disclosed, unfixed gap (2026-08-11,
  `gate-classifier-structural-hardening` plan/convene):** when a command
  touches the remote surface by text (`touchesRemoteSurface()`) but no
  per-segment rule can positively classify it (`classifyCommand().applicable`
  is empty — e.g. an unenumerated wrapper like `timeout N <mutating cmd>`),
  the gate's current default is ALLOW (`reason: 'read-only-lane'`,
  `pretool-remote-mutation-gate.cjs:1015-1022`), not deny — the inverse of its
  own stated "ambiguity refuses" law. This was reproduced live and
  incidentally (not exploited) this session:
  `_dev/state/remote-mutation-stamps/audit.jsonl` records a `timeout`-prefixed
  command allowed with `reason: 'read-only-lane', keys: [], evidence: []` —
  zero evidence of read-only-ness, not proof of it. THE FIX LANDED 2026-08-11
  (commit `ff3755790`, convene 20260811T1950Z ratified): the ambiguity default
  is inverted — touches-remote with zero applicable segment classifications now
  DENIES (`unresolvable-remote-adjacent`), while positively-proven read-only
  verdicts (`scp:pull`/`rsync:pull`/allowlisted scripts) still allow. This
  paragraph previously described the gap as open with the fix pending; corrected
  2026-08-12 after a review lane flagged the staleness.
- **Unattended, remote-capable operation is still refused** — the conclusion is
  unchanged, the reason has moved. `pretooluse-live` now CLEARS. The refusal comes
  from `G-TICKTOCK-REVIEW`.
- **`G-TICKTOCK-REVIEW`'s decision artifact exists; read it, don't quote it.**
  `_dev/state/ticktock/g-ticktock-review-decision.json`'s own
  `decision_id`/`decision.cleared` fields are the authority — this file stopped
  pinning the id in prose 2026-08-12 after pinned ids here went stale twice in
  two days (caught by codewhale lanes both times). While `cleared` is false the
  gate refuses with `DECISION-NOT-CLEARED` (a decision was read and evaluated)
  rather than `ARTIFACT-ABSENT` (nothing to read), and also enforces
  charter-hash binding and exact locked-roster coverage. Refusing on a missing
  artifact was never the same as enforcing a gate; that gap is closed.
  **Run-roster binding at the CLI boundary (`ticktock-resume-and-binding-repair`
  B3, 2026-08-13):** `--charter <path>` is now mandatory on both
  `preflight-ticktock.cjs` and `preflight-and-journal.cjs` specifically so this
  gate's run-roster check (decision's trial charter vs. the run charter, by
  `lane_id`+`family`+`model_pin`+`assignment_order`) actually runs through the
  invocation this file directs callers to — before B3 the bare CLI never
  supplied a run charter, so a cleared decision from a stale or re-rostered
  trial could clear a run it was never bound to. That gap is closed too.
- **Attendance still exempts nothing.** The predicate is remote reachability, not
  who is watching. Only `/ticktock tock` and a declared `--dry-run` proceed.
- **Known open, per the same review:** the preflight evaluates two gates while
  this file's process block advertises charter and journal checks as
  preconditions — that half is a recorded, disclosed gap the caller must cover
  separately (see step 2 above), not fixed by this file.
- **`pretooluse-live` no longer trusts a mutable JSON boolean** (fixed
  2026-08-11, `enforcement-evidence-integrity` round 4/4b — see
  `_dev/reports/analysis/task-plans/enforcement-evidence-integrity__plan.md`).
  It now re-derives live enforcement every call from a three-part probe
  against the governance-protected `tools/kernel/hooks/` gate module and the
  `.claude/settings.json` PreToolUse wiring — nothing is stored, so nothing
  can be forged by editing a file. This still depends on G-REMOTE-MUTATION's
  own classifier being sound (a same-session `timeout N` bypass finding is a
  separately tracked, disclosed, unfixed dependency, not resolved here).
- **The effect-receipt halt states are library-only, production-unreachable**
  (recorded 2026-08-11T23:35Z, plan `tt-unowned-blockers` L2, per codewhale
  context sweep + codex repo-truth review). `tools/ticktock/effectful-phase.cjs`
  correctly implements the exactly-once wrapper (EFFECT-DID-NOT-HAPPEN vs
  EFFECT-RECEIPT-MISSING) and its consumer side in `journal.cjs` is complete,
  but it has NO production caller: `cycle-driver.cjs` requires it nowhere, and
  the three halt emitters wired by `f2eabbf95` (CEILING-EXCEEDED, GATE-BLOCKED,
  MERGE-NOT-CLEAN) do not include it. Until a real effectful dispatch site
  exists (an outbound text send, a ship push) with an INDEPENDENTLY confirmable
  receipt, no runtime path can journal either effect-receipt state — do not
  report that failure class as producible. Wiring precondition: dispatch +
  confirmReceipt per `runEffectfulPhase()`'s contract. Disposition for a
  dispatched-but-unconfirmed effect where the receiver offers neither
  idempotency nor lookup: escalate to an explicit operator decision — never
  assume exactly-once (journal.cjs's `reconcile` refusal blocks resume — see
  `resolveIdempotency()`'s `reconcile` branch and `resolveResume()`'s
  unreconciled-`EFFECT-RECEIPT-MISSING` check; cite the seam, not a line number,
  which drifts with edits — but that escalation rule is stated here, not
  encoded).
</honest_status>

<success_criteria>
- The skill was read and followed; no phase ran with its gates unstated.
- The benchmark ran first and its result was recorded.
- Every remote-capable invocation — attended or not — was refused unless the
  live three-part probe (settings wiring, direct gate-module `evaluate()`,
  spawned `dispatch-pretool.cjs`) confirmed, this run, that G-REMOTE-MUTATION
  denies a synthetic canary, naming `pretooluse-live` as the reason on refusal,
  with the refusal produced by the preflight's exit code rather than asserted.
- Every generation manifest was written through
  `tools/ticktock/generation-manifest.cjs`, never inline, and its read-back
  receipt was recorded.
- SCHEDULE prepared a trigger and activated nothing.
</success_criteria>
