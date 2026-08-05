---
name: ticktock
description: >
  `/ticktock` (`/tt`) — the Mythos↔simulation co-evolution loop as one resumable
  state machine: nine identity-stable phases (ORIENT, TICK, OBSERVE, TEXT,
  RESEARCH, TOCK, IMPROVE, SHIP, SCHEDULE) run under an immutable run charter,
  against a frozen benchmark colony checked first every cycle, with a locked
  reviewer roster whose merge contract admits no timeouts, substitutions, or
  model-pin failures. `/tt N` runs N generations unattended and halts honestly at
  any gate it cannot pass. Composes `/go` (execution shape) and `/meditate`
  (reflective phase) without overriding either. Ships ungated as a project skill;
  introduces no new blocking hook of its own.
version: 0.1.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
tags: [cadence, co-evolution, simulation, orchestration, meditation, benchmark, resumable]
---

<skill>

<objective>
Provide `/ticktock` — one command for the standing co-evolution cadence the
operator named on 2026-08-05: the simulation worlds and Mythos advance in a
tick-tock, and neither world is the subject — the co-evolution is. `/tt` is the
machine that runs that cadence honestly: nine phases with stable identifiers,
journalled transitions, verified checkpoints, and a frame the run cannot move.

`/tt` is a COORDINATOR. It resolves state from artifacts, dispatches work through
the existing machinery, and records what happened. It does not reimplement the
tools it depends on, it does not grade its own output, and it stops rather than
guesses.

**What `/tt` is NOT:**
- Not a second `/go`. IMPROVE routes candidates through `blueprint → distinct
  review → /go`; `/go`'s rules govern that execution unchanged.
- Not a second `/meditate`. TOCK *is* `/meditate`, invoked with `/meditate`'s own
  rules intact — including its INVARIANT that meditation never self-executes and
  never touches the sim directly.
- Not a research phase twice. RESEARCH (phase 5) is the outward lens; TOCK does
  not repeat it. TOCK consumes RESEARCH's receipts as evidence it already has.
- Not authorized to edit its own governing files. The charter, the reviewer
  roster, the benchmark fingerprint reference, and the meta-files (`go`,
  `meditate`, `ticktock` skills, `dispatch-routing-rule`, the capabilities
  matrix) are hard-blocked; `/tt` may only propose changes to them as plans for
  the operator to land.
</objective>

<honest_capability_status>
Read this section before claiming anything about what `/tt` enforces. Tiers are
`BLOCKING` (a mechanism stops execution), `ADVISORY` (injected/reported, not
enforced), `ABSENT` (no mechanism), `UNKNOWN` (not observed).

**The one distinction this table turns on.** A *registered harness hook* stops a
tool call whether or not the agent cooperates: that is `BLOCKING`. An *executable
module* that computes a fail-closed verdict from artifacts and exits non-zero is
strictly stronger than prose — the verdict is code reading disk, not an agent
asserting something about itself — but it is still only `ADVISORY` at the harness
level, because nothing compels a caller to invoke it. Rows below marked
`ADVISORY (module)` carry exactly that meaning, and none of them may be reported
as BLOCKING. Prose alone is never above `ADVISORY`, and usually `ABSENT`.

| Capability | Tier today | Evidence / why |
|---|---|---|
| `/tt` as an invocable name | **ABSENT** | `/ticktock` is registered as `.claude/commands/ticktock.md`. `/tt` is NOT yet resolvable: the alias entry belongs in `instructions/canonical/command-aliases.yaml`, which is inside the convene authority perimeter. The registry patch is staged at `_dev/staged/ticktock-alias/REGISTRATION-PATCH.md` and requires `/convene` plus a `ConveneReceipt/1.0` before it can land. **Acceptance test S3-m (alias resolution) cannot pass until that patch lands.** Use `/ticktock` until then. |
| Charter immutability | **ADVISORY (module)** | `tools/ticktock/charter.cjs` `checkImmutability` / `validateCharter` — fail-closed five-stage validation. Refuses wherever `/tt` calls it; it is not a harness hook, so a caller that skips the call is not stopped. |
| Statistical `--until` | **BLOCKING by unrepresentability** | `tools/ticktock/charter-schema.json` `stopping_rules.until_kind` is an enum of `cycle_ceiling \| deterministic_milestone \| none`. A statistical stopping condition has no representable value. This one really is structural: no charter expressing it can exist, so there is nothing for a caller to skip. |
| Journal integrity / resume | **ADVISORY (module)** | `tools/ticktock/journal.cjs` — append-only, anchored, hash-chained; `verifyJournalIntegrity`, `verifyJournalAnchor`, `verifyCheckpoint`, `resolveIdempotency`, `resolveResume`. Fail-closed when called. |
| Benchmark divergence halt | **ADVISORY (module + exit code)** | `tools/ticktock/run-benchmark.js` `check()` returns `result.identical`; the CLI exits non-zero on divergence. Nothing forces the run. |
| `G-REMOTE-MUTATION` | **CHECKER fail-closed / HARNESS ABSENT** | `_dev/staged/kernel-hooks/pretool-remote-mutation-gate.cjs`, 46/46 fixture tests, **not registered in `tools/kernel/hooks/dispatch-pretool.cjs`**. Nothing stops a remote-mutating Bash call today. |
| `pretooluse-live` precondition | **ADVISORY (module)** — *not* BLOCKING | `tools/ticktock/preflight-ticktock.cjs` `evaluatePretooluseLive` / `preflight`: reads `remote_mutation_gate_test.enforcement_path_observed_live` from `_dev/state/ticktock/ticktock-dryrun-evidence.json`, treats `false`/`null`/absent field/absent artifact/unparseable artifact/any non-strict-`true` as REFUSE, and exits non-zero with the named reason. Verified by execution: 11/11 fixture tests in `tools/ticktock/test-generation-manifest.cjs`; the CLI exits 1 on every remote-capable form today. **It is ADVISORY and not BLOCKING for one reason: nothing in the harness compels `/tt` to run it.** The BLOCKING version is a registered PreToolUse hook under `tools/kernel/hooks/`, which sits inside the convene authority perimeter and could not be written from this workstream's write surface. Until such a hook exists, no one may describe this precondition as harness-enforced. |
| `G-TICKTOCK-REVIEW` | **ABSENT** (no decision artifact exists yet) | The gate's decision artifact is `_dev/state/ticktock/g-ticktock-review-decision.json`, schema `tools/ticktock/ticktock-review-decision-schema.json` (`TickTockReviewDecision/1.0`), clearing field `decision.cleared`. **S4 must produce it.** It does not exist today, so there is nothing to check and the gate is ABSENT — `preflight-ticktock.cjs` `evaluateTicktockReview` reads it fail-closed and refuses every `tt.tick`/`tt.schedule` path. Once the artifact exists the tier becomes `ADVISORY (module)` on the same footing as the row above, never BLOCKING. |
| Generation manifest validation | **ADVISORY (module)** — writer now exists | `tools/ticktock/generation-manifest.cjs` is the single writer: construct → ajv-validate pre-write → atomic write → independent read-back (re-read from disk, re-validate, recompute `manifest_hash`, compare). Schema `tools/ticktock/generation-manifest-schema.json` (`GenerationManifest/1.0`). Verified by execution: 6/6 writer fixture tests, including post-write tamper detection. `/tt` no longer writes the manifest inline. |

**Therefore, stated plainly: any claim that `/tt` is safe for unattended,
remote-capable operation is false today.** The G-REMOTE-MUTATION gate is built
and tested but not wired into the dispatcher, so the harness does not enforce it.
`/tt` refuses those modes for exactly that reason rather than pretending
otherwise.

**And stated just as plainly: the refusal itself is ADVISORY, not BLOCKING.**
`preflight-ticktock.cjs` is a real executable that fails closed, but a caller that
never invokes it is not stopped by anything. Two mechanisms are missing before any
part of this surface can honestly be called BLOCKING, and both live in
`tools/kernel/hooks/` behind the convene perimeter: the registration of
`pretool-remote-mutation-gate.cjs`, and a PreToolUse hook that runs this preflight
itself. Both are staged, not landed. That is the honest ceiling of this
workstream's write surface, and it is not a formality — it is the reason `/tt`
must not be described as safe for unattended operation on the strength of this
skill alone.
</honest_capability_status>

<activation>
- Operator types `/ticktock` (or `/tt`, once the alias registry patch lands).
- A trigger prepared by a prior cycle's SCHEDULE phase fires — **and only if the
  operator has separately activated it.** SCHEDULE prepares; it never activates.
  Activation requires `G-TICKTOCK-REVIEW` cleared plus an explicit operator
  stamp (TT-007). `/tt` never self-fires.
</activation>

<arguments>
| Form | Meaning | Mode | Resolved phases | Verdict today |
|---|---|---|---|---|
| `/tt` | One cycle, attended. All nine phases. | attended | all nine | **REFUSED** — resolves `tt.tick` |
| `/tt N` | N generations. `N > 1` is **unattended**. | unattended for N>1 | all nine | **REFUSED** |
| `/tt deep` | One cycle, maximum rigor: full roster dispatched, RESEARCH widened to both wings at depth, IMPROVE routes every ranked candidate rather than the top slice. | attended | all nine | **REFUSED** |
| `/tt quick` | One cycle, reduced fan-out: benchmark + TICK + OBSERVE + TEXT + journal close. RESEARCH, TOCK, IMPROVE, SHIP, SCHEDULE are **recorded as skipped in the generation manifest**, never silently omitted. A quick cycle may not merge. | attended | orient, tick, observe, text | **REFUSED** — resolves `tt.tick` |
| `/tt tock` | TOCK only — invoke `/meditate` in the loop's frame, journal the transition, no sim authority, no TICK. | attended | orient, tock | proceeds |
| `/tt --dry-run` | Modifier on any base form: a **declared** local-only run. No phase may issue an effectful remote command; a phase that would have is recorded as skipped, never silently downgraded. | attended | per the base form | proceeds |
| `/tt --until <milestone>` | Run until a **deterministic** milestone. **Unattended**. | unattended | all nine | **REFUSED** |

The "verdict today" column is not editorial — it is the output of
`node tools/ticktock/preflight-ticktock.cjs <args>`, which classifies the form,
resolves its phases, and refuses. Run it; do not paraphrase it.

**`--until` handling — wire, do not reimplement.** The milestone is written into
the charter's `stopping_rules` as `{until_kind: "deterministic_milestone",
until_milestone: "<milestone>"}` and passed to
`charter.createCharter`/`validateCharter`. A statistical condition ("until p <
0.05", "until the improvement is significant", "until the trend holds") is
**unrepresentable**: `until_kind` is a three-value enum with no statistical
member, so `createCharter` cannot emit such a charter and `validateCharter`
cannot accept one. `/tt` does not add a second regex-flavored guard on top —
when an operator supplies a statistical condition, `/tt` reports the schema's
refusal verbatim and names the enum. Statistics are computed **post-halt** under
a preregistered contract, which is what makes optional-stopping p-hacking
impossible by construction rather than by discipline.
</arguments>

<phase_entry_preconditions>
These run **before phase 1 of any invocation**, and again at entry to
`tt.tick` / `tt.ship` / `tt.schedule`. Each one halts; none warns-and-proceeds.

**The first two are one executable command, not four paragraphs of instruction:**

```
node tools/ticktock/preflight-ticktock.cjs <the invocation's arguments>
```

Exit 0 is PROCEED, exit 1 is REFUSE, exit 2 is an internal error which is also a
refusal. Stdout is a `TickTockPreflight/1.0` verdict object; its `halt_text` is the
text to report and its `gates[]` entries are what the journal records. `/tt` runs
this before phase 1 and again at entry to each of `tt.tick` / `tt.ship` /
`tt.schedule`, and treats a non-zero exit as a halt. Read the exit code; do not
re-derive the verdict in prose.

<precondition id="pretooluse-live" tier="ADVISORY (module)" source="TT-R4-002">
**Mechanism:** `tools/ticktock/preflight-ticktock.cjs` → `evaluatePretooluseLive`.
It reads `_dev/state/ticktock/ticktock-dryrun-evidence.json` →
`remote_mutation_gate_test.enforcement_path_observed_live` (strict boolean —
distinct from the tri-state `enforcement_path_observed` that S3-h2 asserts on) and
returns REFUSE for every value that is not strictly `true`: `false`, `null`, a
missing field, a missing field group, a missing artifact, an unparseable artifact,
or a truthy non-boolean such as `"true"` or `1`. Each failure mode carries its own
`reason_code`.

**Tier, stated exactly: `ADVISORY`, not `BLOCKING`.** The script is a real
fail-closed mechanism — code reading disk and exiting non-zero, which is strictly
stronger than an instruction telling an actor to refuse — but nothing in the
harness compels `/tt` to call it, so a caller that skips it is not stopped by
anything. Calling it BLOCKING would repeat, one level up, exactly the dishonesty
the constitution's "guarantees live in mechanism, not prose" law forbids.
**The BLOCKING version requires a registered PreToolUse hook under
`tools/kernel/hooks/` that runs this preflight and denies the tool call. That
directory sits inside the convene authority perimeter and could not be written
from this workstream's write surface. Until such a hook lands through `/convene`
plus a `ConveneReceipt/1.0`, this precondition is ADVISORY and must be reported
that way.**

**Which invocations it refuses — the decidable boundary.** The predicate is
**remote reachability, not operator attendance.** "Attended" describes how an
operator watches a run; it proves nothing about whether the run can reach the
orwell host. An attended single cycle that resolves `tt.tick` is refused exactly
like an unattended one.

| Invocation | Resolves | Refused |
|---|---|---|
| `/tt`, `/tt deep`, `/tt N` (any N), `/tt --until …` | all nine, incl. `tt.tick` / `tt.ship` / `tt.schedule` | **yes** |
| `/tt quick` | `tt.orient`, `tt.tick`, `tt.observe`, `tt.text` | **yes** — resolves `tt.tick` |
| `/tt tock` | `tt.orient`, `tt.tock` | no |
| any form + `--dry-run` | its base form, no effectful remote command permitted | no |

So, plainly: **attended paths must ALSO refuse.** The only exempt forms are
`/tt tock` and an explicitly declared `--dry-run`. `--dry-run` is a declaration
the operator makes, not an inference `/tt` draws — under it, a phase that would
have issued an effectful remote command is recorded as skipped and the cycle may
not merge, never silently downgraded to a local action. `tt.observe`'s pull from
the host is a READ-ONLY lane rather than a remote-mutating action, which is why
`tt.observe` is not on the remote-capable list.

**On refusal:** report the verdict's `halt_text` verbatim, record a `GATE-BLOCKED`
halt in the journal naming `pretooluse-live`, and write
`pretooluse_live_precondition.{refused_unattended_mode, halt_reason,
enforcement_path_observed_live_at_refusal, attended_dry_run_unaffected}` into the
evidence artifact (S3-h3's contract).
</precondition>

<precondition id="G-TICKTOCK-REVIEW" tier="ABSENT until S4 produces the artifact" source="required_gates">
**Mechanism:** `tools/ticktock/preflight-ticktock.cjs` → `evaluateTicktockReview`.

**The concrete contract, so a runtime read is actually implementable:**

- **Path:** `_dev/state/ticktock/g-ticktock-review-decision.json`
- **Schema:** `tools/ticktock/ticktock-review-decision-schema.json`,
  `TickTockReviewDecision/1.0`, ajv-validated before any field is read.
- **Clearing field:** `decision.cleared` — the strict boolean `true`, nothing
  else. It is corroborated rather than trusted: the read also requires
  `decision.unresolved_findings_total === 0` and every `reviewers[]` entry to
  carry `verdict: "APPROVE"` with `unresolved_findings: 0`. A `cleared: true` that
  its own roster contradicts returns `ROSTER-NOT-CLEAN`, because a cleared flag
  the evidence under it does not support is a validation failure, not a pass.
- **Binding:** `tt.tick` and `tt.schedule`, per the plan's
  `inherited_gate_matrix`. A `--dry-run` cycle and `/tt tock` do not trigger it.
- **Producer: S4 must write this artifact.** The max-roster trial's human-readable
  debrief (`_dev/reports/analysis/run-debrief__ticktock-skill__<date>.md`) is not
  machine-readable and is not the gate; the JSON record above is, and it points at
  the debrief through `debrief_artifact_path`.

**Tier today: `ABSENT`.** The artifact does not exist, so no check happens in the
sense of "a decision was read and evaluated" — the read fails closed with
`ARTIFACT-ABSENT` and every `tt.tick` / `tt.schedule` path is refused. Refusing on
a missing artifact is not the same as enforcing a gate, and this skill does not
claim it is. Once S4 lands the artifact the tier becomes `ADVISORY (module)`, on
the same footing as `pretooluse-live` — never `BLOCKING`, because no hook enforces
this one either.
</precondition>

<precondition id="charter-frame" tier="ADVISORY (module)">
`charter.readCharter` + `charter.validateCharter` on the run charter. Any of the
five fail-closed stages failing (schema shape, roster-hash recomputation,
charter-hash recomputation, roster coverage, stopping-rule coherence) halts
`CHARTER-IMMUTABILITY-VIOLATION` or `ROSTER-HASH-MISMATCH`. Cycle 1 requires the
charter to already be committed; `/tt` never authors a charter mid-run.
</precondition>

<precondition id="journal-integrity" tier="ADVISORY (module)">
`journal.verifyJournalIntegrity` + `journal.verifyJournalAnchor` +
`journal.resolveResume`. A torn tail, malformed record, or anchor mismatch halts
(`JOURNAL-TORN-TAIL` / `JOURNAL-MALFORMED-RECORD` / `JOURNAL-ANCHOR-MISMATCH`).
A resume state of `EFFECT-RECEIPT-MISSING` requires reconciliation **before**
resume — it is in `journal.RECONCILIATION_REQUIRED_HALTS` and is not a
proceed-anyway condition. Silent fresh-state fallback is refused: a missing or
unreadable journal halts, it does not start a clean one.
</precondition>
</phase_entry_preconditions>

<every_cycle_invariants>
Four things happen every cycle, in this order, before any phase claims success.
All four call **existing modules** — `/tt` reads them and invokes their exported
API; it never reimplements them, and never depends on their internals.

1. **Benchmark first.** `require('tools/ticktock/run-benchmark.js').check({...})`
   — the full frozen colony, whole behavioral trace compared, not chosen metrics.
   `result.identical === false` → halt `BENCHMARK-DIVERGENCE`, naming the first
   diverging dimension and tick. Before it runs,
   `checkRebaselineFrequency(lineageEntries)` and `verifyLineageChain(lineageEntries)`
   — a tripped repeated-re-baseline detector (default N=2 of last M=5) halts
   `REBASELINE-FREQUENCY` **and files a finding**; it never silently clears.
2. **Rotation dispatch.** Minds AND harnesses rotate per cycle — evidence
   gathering, never permission. Outcomes are recorded to the capabilities matrix
   at `_dev/reports/analysis/mind-capabilities-matrix.md`. A cycle with no
   rotation fails acceptance (`ROTATION-MISSING`).
3. **Generation manifest.** One `GenerationManifest/1.0` per cycle:
   `{schema, generation_id, cycle_index, created_at, charter_id, charter_hash,
   parent, inputs, outputs, reviews, merge_decision, metrics, rotation,
   manifest_hash}` (+ `halt` when halted). `parent` is what makes lineage
   checkable across generations.

   **There is exactly one writer, and `/tt` does not write manifests inline.**
   `require('tools/ticktock/generation-manifest.cjs').writeGenerationManifest(manifest, {dir})`
   is the only entrypoint. Its contract is four steps, none skippable:
   **construct** (`manifest_hash` is computed by the writer via
   `canonical.hashObject` over the projection omitting `manifest_hash`; a
   caller-supplied hash is recomputed and must match, or the write is refused —
   the writer never trusts a hash it did not compute) → **validate** with ajv
   *before* touching disk, so an invalid document is never written rather than
   written-then-flagged → **write atomically** (sibling `.tmp`, fsync, rename;
   a torn manifest is indistinguishable from a tampered one) → **read back
   independently**: re-read the bytes from disk into a new object, re-validate it,
   recompute its `manifest_hash` from the re-read content, and compare against both
   the intended hash and the stored field. Verifying the in-memory object would
   prove self-consistency, not delivery; the read-back has to go through the
   filesystem. Any step failing throws a named halt (`MANIFEST-HASH-MISMATCH`,
   `MANIFEST-SCHEMA-INVALID`, `MANIFEST-READBACK-HASH-MISMATCH`, …) — a failed
   manifest write halts the cycle and is never a warn-and-proceed. Record the
   returned `GenerationManifestWriteReceipt/1.0` as the cycle's evidence that the
   manifest actually landed.
4. **Journal transitions.** Every phase entry and exit is a journal record via
   `journal.appendRecord` / `journal.completePhase` under
   `journal.withJournalLock`. EFFECTFUL phases resolve their idempotency key
   through `charter.idempotencyKey` and check it with
   `journal.resolveIdempotency` **before** executing. Phase ids and effect
   classes come from `charter.NINE_PHASES` / `charter.PURE_PHASES` /
   `charter.EFFECTFUL_PHASES` — never a locally retyped list.

**Note on `journal.cjs`:** it is under active repair by another worker. Use only
its exported API (the `module.exports` surface); do not read into or depend on
its internal helpers, and do not edit it.
</every_cycle_invariants>

<process>

<phase id="tt.orient" n="1" effect="PURE">
**ORIENT — state from artifacts, never from memory.**

Resolve where the loop actually is by reading: the charter (`charter.readCharter`),
the journal's resume state (`journal.resolveResume`, `journal.lastVerifiedCheckpoint`),
the last generation manifest, the benchmark lineage, the live signal surface, and
the prior cycle's debrief. Nothing about the loop's position may come from
conversational recall — if an artifact is missing, that is a halt or a named gap,
not an inference. Emit the orientation as the cycle's opening journal record:
cycle index, resume point, charter hash, what the last cycle actually landed.

**Inherited gates that apply:**
- **`pretool-write-boundary-gate`** — all phases; BLOCKING only under
  `MYTHOS_WRITE_BOUNDARY_GATE=1`, else observe-only, fail-open.
- **`pretooluse-live`** and **`G-TICKTOCK-REVIEW`** — checked once *before* ORIENT
  by the pre-invocation preflight, against the whole invocation's resolved phase
  path. ORIENT itself reaches neither a remote nor a secret surface, but a bare
  `/tt` resolves `tt.tick`, so the refusal lands before ORIENT runs, not at TICK.

**Named as not applying, with the reason:** `pretool-secret-access-gate` — ORIENT
reads local repo artifacts only and resolves no credential. `G-REMOTE-MUTATION` —
no remote surface is reachable from ORIENT.
</phase>

<phase id="tt.tick" n="2" effect="EFFECTFUL">
**TICK — the sim round, under its stamp.**

Advance the simulation one round. This is the phase that mutates a system the
loop does not own outright, which is why it is EFFECTFUL and why its idempotency
key is checked first:
`sha256(charter_hash + cycle_index + "tick" + resume_from_generation)` via
`charter.idempotencyKey`, resolved against the journal. A matching prior record
means the tick already happened — do not re-fire it.

**Under its stamp** means literally: a sim round that touches the orwell host is
a remote-mutating action and requires a valid `RemoteMutationStamp/1.0` sidecar
under `_dev/state/remote-mutation-stamps/`. Check `G-REMOTE-MUTATION` **before**
issuing any remote-mutating command, not after.

**Inherited gates that apply:**
- **`pretooluse-live`** — ADVISORY (module) phase-entry refusal (above), executed
  by `tools/ticktock/preflight-ticktock.cjs`, not asserted in prose. TICK will not
  run while `enforcement_path_observed_live` is anything but strictly `true` —
  attended or not, since TICK is remote-capable either way.
- **`G-REMOTE-MUTATION`** — checked before any remote-mutating action. Checker
  fail-closed; **harness enforcement ABSENT** (not registered). Because the
  harness does not enforce it, TICK checks the stamp itself and refuses without
  one — and reports that this is a skill-level check, not a hook.
- **`G-TICKTOCK-REVIEW`** — must be cleared before a non-dry-run tick.
- **`pretool-secret-access-gate`** — credential-shaped Bash tokens; BLOCKING only
  under `MYTHOS_SECRET_ACCESS_GATE=1`, else observe-only, fail-open.
- **`pretool-write-boundary-gate`** — as above.
</phase>

<phase id="tt.observe" n="3" effect="PURE">
**OBSERVE — the science readout.**

Harvest what the round actually produced and read it as evidence about *our*
work: engine truths, instrument gaps, world-design consequences. Compute the
cycle's metrics into the generation manifest's `metrics`. This is a readout, not
a verdict: observations and hypotheses, never diagnoses. Statistics that bear on
stopping are computed post-halt under the preregistered contract — OBSERVE
records the raw readout, it does not decide whether the run should stop.

**Inherited gates that apply:**
- **`pretool-secret-access-gate`** — OBSERVE's harvest may pull round output from
  the orwell host over an authenticated channel, which is a credential-shaped
  command even though the lane is read-only. BLOCKING only under
  `MYTHOS_SECRET_ACCESS_GATE=1`, else observe-only, fail-open.
- **`pretool-write-boundary-gate`** — all phases.

**Named as not applying, with the reason:** `G-REMOTE-MUTATION` — a read-only pull
from the host is a READ-ONLY lane and needs no stamp. `pretooluse-live` — the
read-only lane is not remote-*mutating*, so OBSERVE alone does not trigger the
refusal; a full cycle still refuses at pre-invocation because of `tt.tick`.
</phase>

<phase id="tt.text" n="4" effect="EFFECTFUL">
**TEXT — the operator pulse.**

Exactly one iMessage to the self-chat per completed round, never mid-run. The
contract is `/meditate`'s `text-contract-truthful` INVARIANT, unchanged and not
weakened here:

- **"What we improved"** — ONLY what actually landed since the last text:
  executed plans, merged fixes, things now true in the repo. If nothing landed,
  say so plainly ("nothing shipped yet since last time"). **Listing a plan here
  is a truthfulness violation of this skill**, not a stylistic preference.
- **"What we learned"** — this cycle's observations and outward findings.
- **"What we'll work on next"** — the newly emitted PLANS, explicitly framed as
  proposals ("we're planning to…"), never as accomplishments.

Layman's terms, no jargon. The text is a summary, never the record.

Idempotency key: `sha256(charter_hash + cycle_index + "text" + observe_artifact_hash)`
— a resumed cycle must not double-text the operator.

**Inherited gates that apply:** `pretool-secret-access-gate` (conditional
BLOCKING, else observe-only), `pretool-write-boundary-gate`. Not remote-mutating.
</phase>

<phase id="tt.research" n="5" effect="PURE">
**RESEARCH — the world-context wing, feeding both worlds.**

Perplexity is the outward lens, and in `/tt` it feeds **two** consumers, not one:

1. **The simulation's next challenge** — what does the world know about the
   pressures, environments, and collective-intelligence problems we could pose to
   the minds next? Findings here become candidate sim-side plans (never direct
   sim edits).
2. **Mythos's own architecture** — biological and collective-intelligence
   findings as *design input for us*: stigmergy, quorum sensing, division of
   labor, redundancy under failure, information cascades. What the ants' world
   teaches about how a guild of agents should be built is a first-class output of
   this phase, not a metaphor.

**Significance rule** (inherited from `/meditate`'s `outward-lens-required`): a
question earns an outward check if ANY ONE holds — it changed a plan or design,
it contradicted a prior belief in memory or a plan, or it is a candidate novelty
absent from the repo's own record.

**Entrypoint ladder:** local/repo record first, then the Perplexity API called
directly over HTTPS (`tools/ai-bridge/perplexity-api`), with the logged-in
browser path (`tools/ai-bridge/perplexity-browser.js`) as fallback. **`query.js`
is known-broken — it shells to `bunx pplx` and hangs. Never call it.** An
unreachable surface drops a rung with the gap named in the receipt, never
silently skipped.

**Receipts are required, one per query**, recorded in the cycle's research
artifact and referenced from the generation manifest:
`{query, timestamp, path, citations: [urls], finding}`. A finding without a
receipt is not evidence and may not be cited by TOCK or IMPROVE.

**Inherited gates that apply:** `pretool-secret-access-gate` (the API key lane;
conditional BLOCKING, else observe-only, fail-open),
`pretool-write-boundary-gate`. Not remote-mutating.
</phase>

<phase id="tt.tock" n="6" effect="PURE">
**TOCK — `/meditate`, in the loop's frame.**

Invoke `/meditate` (`.claude/skills/meditate/SKILL.md`) with this cycle's
evidence base. `/meditate`'s rules apply unchanged and `/tt` does not soften any
of them:

- `meditation-never-self-executes` — every improvement leaves as a plan.
- Meditation does not mutate the sim. **TOCK has no sim authority at all.**
- Meditation does not write to `instructions/canonical/**`.

**TOCK is not a second research phase.** RESEARCH (phase 5) already ran the
outward lens and produced the receipts; TOCK consumes them. Where `/meditate`
run standalone would perform its own outward-lens step, inside `/tt` that step is
**satisfied by phase 5's receipts** — TOCK re-queries only for a significant
question phase 5 did not cover, and any such query records its own receipt in the
same format. Duplicating the wing is waste, not rigor.

Note the ordering consequence: `/meditate` standalone ends by texting the
operator. Inside `/tt`, the operator pulse is phase 4 (TEXT), which fires once
per completed round — TOCK does **not** send a second text. `/meditate`'s
`imessage-bounded` PROTOCOL (at most one per completed round) is thereby honored,
not bypassed.

**Inherited gates that apply:**
- **`pretool-secret-access-gate`** — TOCK's optional re-query for a significant
  question phase 5 did not cover reaches the same Perplexity API-key lane RESEARCH
  uses, so it carries RESEARCH's gate binding, not merely the parent phase's write
  gate. Conditional BLOCKING under `MYTHOS_SECRET_ACCESS_GATE=1`, else
  observe-only, fail-open — same observed tier and failure behavior as RESEARCH.
  Any TOCK re-query records a receipt in RESEARCH's exact
  `{query, timestamp, path, citations[], finding}` shape; a re-query that cannot
  produce one is not evidence and TOCK may not cite it.
- **`pretool-write-boundary-gate`** — all phases.

**Named as not applying, with the reason:** `G-REMOTE-MUTATION` and
`pretooluse-live` — TOCK is PURE, has no sim authority, and reaches no remote
surface, which is why `/tt tock` is one of the two invocations the pre-invocation
preflight lets through.
</phase>

<phase id="tt.improve" n="7" effect="EFFECTFUL">
**IMPROVE — candidates through blueprint → review → /go.**

Each improvement candidate (Mythos-side or sim-side) carries expected benefit,
cost, falsifier, and evidence links; ranked; the top candidates route through the
NORMAL machinery: `/plan-task` (or `/blueprint` for big ones) → distinct-family
review → `/go`. `/tt` never self-executes an improvement, on either side of the
tick-tock, because the producer of an insight is not the judge of its worth.

**Meta-files are hard-blocked.** A candidate touching `.claude/skills/go/`,
`.claude/skills/meditate/`, `.claude/skills/ticktock/`,
`instructions/canonical/dispatch-routing-rule.yaml`, or the capabilities matrix
is **refused as an edit and emitted as a proposal artifact** for operator
ratification. The refusal must produce the proposal artifact — a bare refusal is
an incomplete outcome (this is what S3-c checks).

Idempotency key: `sha256(charter_hash + cycle_index + "improve" + plan_ids_sorted)`.

**Inherited gates that apply:**
- **`userprompt-plan-review-gate`** — `/run-plan` without a distinct-mind review
  record. Wired at `dispatch-userprompt.cjs:108`; **ADVISORY** (loud injection,
  always exits 0 — not verified hard-blocking for UserPromptSubmit). `/tt` treats
  a missing review record as a halt anyway, and says that this is a skill-level
  refusal, not a harness block.
- **`pretool-orchestrator-worker-gate`** — coordinator self-executing worker
  scope. BLOCKING only under `MYTHOS_ORCHESTRATOR_GATE=1`, else observe-only,
  fail-open.
- **`pretool-mutation-plan-gate`** — REPORT-ONLY repo-wide today.
- **`pretool-delegation-altitude`** — gated behind `enforce`/`override` marker
  files, not unconditional.
- **`convene-perimeter-gate`** — BLOCKING, FAIL-CLOSED. Any candidate touching a
  `PROTECTED_PATHS` governance path (including `command-aliases.yaml`) needs a
  live `ConveneReceipt/1.0`. Its Bash-channel matcher scans command text broadly
  rather than read-vs-write, so `/tt`'s own tooling must not assume that a
  harmless read merely *naming* a protected path passes silently.
- **`pretool-secret-access-gate`**, **`pretool-write-boundary-gate`** — as above.

**On the remote surface, stated rather than left implicit:** IMPROVE itself issues
no remote-mutating command — it emits ranked candidates and routes them into
`blueprint → distinct review → /go`. A plan that later executes remotely re-enters
`G-REMOTE-MUTATION` and `pretooluse-live` in the session that runs it; those gates
are **not** inherited from `/tt` and `/tt`'s refusal does not travel with the plan.
IMPROVE must therefore never route a candidate whose execution it knows to be
remote-mutating while `enforcement_path_observed_live` is false — routing it would
launder the refusal through another session.
</phase>

<phase id="tt.ship" n="8" effect="EFFECTFUL">
**SHIP — commit, snapshot, PR; merge only under the locked-roster contract.**

Commit to a feature branch and open a PR (never commit or push directly to
`main`). Snapshot to the clean remote branch at the slice boundary.

**The merge contract, stated without softening:** merge requires **zero
unresolved findings from EVERY precommitted reviewer in the locked roster**,
assigned before any output existed, bound by the charter's `lane_binding_hash`
over family + model_pin + assignment_order. Therefore:

- A reviewer **timeout** is NOT clean.
- A reviewer **substitution** is NOT clean.
- A **model-pin mismatch** is NOT clean.
- A **roster-hash tamper** halts the cycle (`ROSTER-HASH-MISMATCH`).
- An unavailable lane is recorded in the availability snapshot; the hash still
  binds the remaining lanes. Recording the absence is not the same as clearing it.

None of these are degradable to "clean with a note." A cycle that cannot satisfy
the contract halts `MERGE-NOT-CLEAN` and hands back.

`/tt quick` may not merge.

Idempotency key: `sha256(charter_hash + cycle_index + "ship" + tree_hash_before)`.

**Inherited gates that apply:**
- **`pretooluse-live`** — ADVISORY (module) phase-entry refusal, re-run at SHIP
  entry via `preflight-ticktock.cjs`. SHIP is remote-capable, so an attended cycle
  refuses here exactly like an unattended one.
- **`G-REMOTE-MUTATION`** — **checked before any remote-mutating action**
  (a push to a remote surface, a snapshot that reaches the orwell host). Checker
  fail-closed; harness enforcement ABSENT.
- **`pretool-secret-access-gate`** — SHIP pushes to a git remote and snapshots to
  the clean remote branch, both of which resolve a credential (token or SSH key).
  Conditional BLOCKING under `MYTHOS_SECRET_ACCESS_GATE=1`, else observe-only,
  fail-open.
- **`G-TICKTOCK-REVIEW`** — bound to `tt.tick` and `tt.schedule`, so SHIP does not
  re-check it; in a full cycle it was already checked and cleared at pre-invocation
  and at TICK entry. Named here so the clearance is a stated inheritance rather
  than an unstated background assumption. `/tt quick` may not merge, and a
  SHIP reached without a cleared gate is a defect, not a pass.
- **`pretool-git-custody-gate`** — git add/commit of another session's owned
  path. BLOCKING on positively-proven foreign custody; unknown passes advisory;
  fail-open. Wired at `dispatch-pretool.cjs:207-213`.
- **`convene-perimeter-gate`** — BLOCKING, FAIL-CLOSED, on any governance path in
  the commit.
- **`pretool-orchestrator-worker-gate`**, **`pretool-mutation-plan-gate`**,
  **`pretool-delegation-altitude`**, **`pretool-write-boundary-gate`** — tiers as
  listed under IMPROVE.
</phase>

<phase id="tt.schedule" n="9" effect="EFFECTFUL">
**SCHEDULE — prepares the next trigger. Only prepares.**

Write the next trigger specification: when the next cycle should run, what
milestone or event names it, what the next cycle's focus is. Record it in the
generation manifest and the journal.

**SCHEDULE never activates anything (TT-007).** Activation of a prepared trigger
is a separate, later action requiring BOTH `G-TICKTOCK-REVIEW` cleared AND an
explicit operator stamp. It is never a side effect of this phase, of a successful
cycle, or of elapsed time. Time alone never graduates anything; silence is not
consent.

Idempotency key: `sha256(charter_hash + cycle_index + "schedule" + next_trigger_spec)`.

**Inherited gates that apply:**
- **`pretooluse-live`** — ADVISORY (module) phase-entry refusal, re-run at SCHEDULE
  entry via `preflight-ticktock.cjs`.
- **`G-REMOTE-MUTATION`** — checked before any remote-mutating action (a
  scheduler that would install a trigger on a remote host). Checker fail-closed;
  harness enforcement ABSENT.
- **`G-TICKTOCK-REVIEW`** — governs activation, which this phase does not perform.
  Its decision artifact is `_dev/state/ticktock/g-ticktock-review-decision.json`;
  activation additionally requires `decision.operator_stamp` to be a verbatim
  operator line, not null (TT-007).
- **`pretool-secret-access-gate`** — a trigger written anywhere but the local repo
  (a scheduler entry on the host, a credentialed scheduling API) resolves a
  credential. Conditional BLOCKING under `MYTHOS_SECRET_ACCESS_GATE=1`, else
  observe-only, fail-open.
- **`pretool-write-boundary-gate`** — as above.
</phase>

</process>

<gate_summary>
Every phase names its gates above; this table is the index, not a substitute.
Tiers are as observed, not as a hook's own header describes itself.

| gate_id | Phases | Tier observed |
|---|---|---|
| `pretooluse-live` | tick, ship, schedule (+ pre-invocation) | **ADVISORY (module)** — `preflight-ticktock.cjs`, fail-closed, exits non-zero; **not** harness-BLOCKING |
| `G-TICKTOCK-REVIEW` | tick, schedule | **ABSENT** — decision artifact `_dev/state/ticktock/g-ticktock-review-decision.json` does not exist yet (S4 produces it); the read fails closed meanwhile |
| `G-REMOTE-MUTATION` | tick, ship, schedule | CHECKER fail-closed / HARNESS **ABSENT** |
| `convene-perimeter-gate` | improve, ship | BLOCKING, FAIL-CLOSED |
| `userprompt-plan-review-gate` | improve | ADVISORY |
| `pretool-orchestrator-worker-gate` | improve, ship | conditional (`MYTHOS_ORCHESTRATOR_GATE=1`), fail-open |
| `pretool-secret-access-gate` | tick, **observe**, text, research, **tock**, improve, **ship**, **schedule** | conditional (`MYTHOS_SECRET_ACCESS_GATE=1`), fail-open |
| `pretool-write-boundary-gate` | all phases | conditional (`MYTHOS_WRITE_BOUNDARY_GATE=1`), fail-open |
| `pretool-git-custody-gate` | ship | BLOCKING on proven foreign custody, else fail-open |
| `pretool-mutation-plan-gate` | improve, ship | REPORT-ONLY repo-wide |
| `pretool-delegation-altitude` | improve, ship | marker-file gated |
| `bubble-up-gates-taxonomy` | any phase recording `bubble_up_gate` | vocabulary only, not a blocker |

A gate is never an unstated background assumption in this skill. If a phase does
not name a gate, that gate does not apply to it — and where a gate plausibly
*might* apply but does not, the phase says so and gives the reason, because a
silent omission and a considered exclusion look identical to a reader otherwise.
`tt.orient` is the only phase reaching neither a secret nor a remote surface.
</gate_summary>

<execution_rules>
<rule id="tt-alias-not-yet-live">[INVARIANT] — `/tt` is NOT resolvable today. Only `/ticktock` is. The alias must land through `instructions/canonical/command-aliases.yaml` via `/convene` + a `ConveneReceipt/1.0`; the patch is staged at `_dev/staged/ticktock-alias/REGISTRATION-PATCH.md`. `.claude/commands/tt.md` is a GENERATED artifact of that registry entry — hand-writing it would forge generated provenance and break the alias-authority law. Acceptance test **S3-m cannot pass** until the patch lands.</rule>
<rule id="frame-is-immutable">[INVARIANT] — The charter, reviewer roster, benchmark fingerprint reference, and meta-files are not editable by `/tt` under any argument, mode, or in-flight justification. A refusal must be accompanied by a proposal artifact; only the operator lands the change.</rule>
<rule id="benchmark-first">[INVARIANT] — The full frozen benchmark colony runs before any cycle work, every cycle. Whole behavioral trace, not chosen metrics. Divergence halts. There is no "small divergence" tier.</rule>
<rule id="until-deterministic-only">[INVARIANT] — Statistical stopping is unrepresentable in `RunCharter/1.0`, and `/tt` wires to that schema rather than reimplementing a guard. Statistics are computed post-halt under a preregistered contract.</rule>
<rule id="merge-contract-absolute">[INVARIANT] — Zero unresolved findings from every locked reviewer. Timeouts, substitutions, and model-pin failures are NOT clean and are never downgradable to clean-with-a-note.</rule>
<rule id="schedule-prepares-only">[INVARIANT] — SCHEDULE prepares a trigger. Activation is a separate operator action gated on `G-TICKTOCK-REVIEW` plus an explicit stamp. Never a side effect.</rule>
<rule id="text-truthful">[INVARIANT] — "What we improved" lists ONLY what actually landed. A plan is never reported as an improvement. Inherited verbatim from `/meditate`.</rule>
<rule id="research-receipts">[PROTOCOL] — Every Perplexity query records `{query, timestamp, path, citations[], finding}`. A finding without a receipt is not evidence. `query.js` is never called.</rule>
<rule id="tock-has-no-sim-authority">[PROTOCOL] — TOCK invokes `/meditate` with its rules intact: plans only, no direct mutation of Mythos or the sim, no writes to `instructions/canonical/**`. TOCK is not a second RESEARCH phase.</rule>
<rule id="use-existing-modules">[PROTOCOL] — `charter.cjs`, `journal.cjs`, `canonical.cjs`, and `run-benchmark.js` are called through their exported API, never reimplemented and never reached into. `journal.cjs` is under active repair by another worker — exported surface only, no edits.</rule>
<rule id="no-orphan-effects">[PROTOCOL] — Every EFFECTFUL phase resolves its idempotency key against the journal before executing. `EFFECT-RECEIPT-MISSING` requires reconciliation before resume; a silent fresh-state fallback is refused.</rule>
<rule id="honest-tiers">[INVARIANT] — `/tt` reports BLOCKING / ADVISORY / ABSENT / UNKNOWN and never collapses them. `BLOCKING` is reserved for a mechanism that stops execution whether or not the actor cooperates — a registered hook, or structural unrepresentability. An executable module that fails closed when called is `ADVISORY (module)`, however strict its logic, because nothing compels the call. Prose is never above ADVISORY. `/tt`'s own remote-mutation protection is a skill-level check while the harness gate is unregistered, and says so rather than implying enforcement it does not have.</rule>
<rule id="preflight-before-entry">[INVARIANT] — `node tools/ticktock/preflight-ticktock.cjs <args>` runs before phase 1 and again at entry to `tt.tick` / `tt.ship` / `tt.schedule`. A non-zero exit is a halt. The refusal predicate is remote reachability, not operator attendance: `/tt`, `/tt deep`, `/tt quick`, `/tt N`, and `/tt --until` all resolve `tt.tick` and are refused today; only `/tt tock` and a declared `--dry-run` proceed. `/tt` never re-derives this verdict in prose and never routes around it by delegating a remote-mutating plan to another session.</rule>
<rule id="one-manifest-writer">[PROTOCOL] — Generation manifests are written only through `generation-manifest.cjs` `writeGenerationManifest`, under its construct → validate → atomic write → independent read-back contract. `/tt` does not write manifests inline, and a failed write halts the cycle.</rule>
<rule id="ungated-surface">[PROTOCOL] — `/ticktock` is a project-space skill. It introduces no new blocking hook and does not write to `instructions/canonical/**`.</rule>
</execution_rules>

<inputs>
<required>None — a bare `/ticktock` runs one attended cycle from the resolved state.</required>
<optional>
<input name="N">Number of generations. N>1 is unattended and currently refused by `pretooluse-live`.</input>
<input name="deep|quick|tock">Cycle profile, per the arguments table.</input>
<input name="--until &lt;milestone&gt;">A deterministic milestone. Statistical conditions are unrepresentable in the charter schema. Unattended — currently refused.</input>
</optional>
</inputs>

<outputs>
<output name="journal">Append-only phase transitions with verified checkpoints, via `journal.cjs`.</output>
<output name="generation-manifest">One `GenerationManifest/1.0` per cycle, schema-validated, with `parent` linking the lineage.</output>
<output name="benchmark-result">Fingerprint comparison for the cycle, plus lineage and rebaseline-frequency checks.</output>
<output name="research-receipts">One per Perplexity query, both wings, in the cycle's research artifact.</output>
<output name="meditation">TOCK's `/meditate` artifact and its ranked candidates.</output>
<output name="routed-plans">IMPROVE candidates as plans in the normal blueprint → review → /go pipeline.</output>
<output name="operator-text">Exactly one self-chat iMessage per completed round, under the truthful three-part contract.</output>
<output name="next-trigger">A prepared, inert trigger specification. Not activated.</output>
</outputs>

<success_criteria>
- The benchmark ran first and its result is recorded, every cycle.
- Every phase entry and exit is journalled; every EFFECTFUL phase checked its
  idempotency key before executing.
- Every phase's applicable gates were named and checked, with their true tier
  stated — not assumed.
- Unattended and remote-capable modes were refused while
  `enforcement_path_observed_live` is false, with the reason named.
- RESEARCH produced receipts feeding both wings; TOCK consumed them rather than
  re-running them.
- The operator text claimed no plan as a landed improvement.
- Any merge happened only under the full locked-roster zero-unresolved-findings
  contract; otherwise the cycle halted honestly.
- SCHEDULE prepared a trigger and activated nothing.
</success_criteria>

<boundaries>
- Does NOT edit the charter, the reviewer roster, the benchmark fingerprint
  reference, or any meta-file — proposals only.
- Does NOT reimplement `charter.cjs`, `journal.cjs`, `canonical.cjs`, or
  `run-benchmark.js`; does NOT edit `journal.cjs`.
- Does NOT write to `instructions/canonical/**`.
- Does NOT activate a scheduled trigger.
- Does NOT merge outside the locked-roster contract.
- Does NOT claim harness enforcement for `G-REMOTE-MUTATION` while the gate is
  unregistered, and does NOT claim BLOCKING for its own preflight — that word
  belongs to a registered hook under `tools/kernel/hooks/`, which this workstream
  cannot write.
- Does NOT let an attended invocation reach a remote-mutating action while
  `enforcement_path_observed_live` is anything but strictly `true`.
- Does NOT replace `/go`, `/meditate`, `/plan-task`, `/review-task-plan`, or
  `/run-plan` — it composes them.
</boundaries>

</skill>
