# Task plan: ant-world-liveness-gate

**Schema**: TaskIntake/1.0
**Title**: Promote masked-coordinate liveness from ADVISORY non-zero check to BLOCKING informative-signal gate
**Timestamp**: 2026-08-05T07:15:00.000Z
**Requested by**: operator
**Source**: `_dev/reports/analysis/meditation__20260805.md`, candidate 1 (#1 ranked of 6, tonight's first `/meditate` cycle, TOCK of `/ticktock` cycle 1)
**Scope type**: system
**Storage root**: `_dev/reports/analysis/task-plans`

## Description

`assessMaskedCoordinateLiveness` (`tools/ant-hive-world/world-mind.js:236-275`) already
computes per-coordinate `constant_coordinates` and `effective_dimensionality`, but
`assertMaskedCoordinatesLive` (`world-mind.js:278-291`) throws only on `dead_zero`, has
no caller anywhere in `tools/ant-hive-world/`, and its own emitted evidence never
carries the block — `grep -c liveness` on
`_dev/state/goal-round-rehearsal/goal-round-rehearsal-evidence.json` returns 0.

The meditation's own 900-row census over both arms of the goal-round rehearsal found
**three** zero-variance masked-and-adjacent input coordinates, not one:

- coordinate 2 (`total_stone`), frozen at 0.2727 because build success is 0% from
  tick ~150
- coordinate 4 (`hive_count`), constant `0.047619047619047616` = 1/21
- coordinate 7 (`starvation_pressure`), the **same** constant 1/21 — 2 hives and 2
  starving hives both normalize through `x/(x+40)` to 2/42

`WORLD_LOSS_MASK = [4,6,7]` means two of the three trained coordinates are
byte-identical and frozen; only coordinate 6 (`pheromone_signal_strength`) carries
any variance. Effective dimensionality is 1 of 3, and the coordinator's public claim
that "coord 7 is alive, 450/450 ticks" was sourced from an instrument whose declared
standard is non-zero-ness, not variance — a capability-tier failure (an ADVISORY read
reported as BLOCKING evidence).

This plan promotes the gate, redefines its standard as **informative** (variance-based,
not non-zero-based) with a proposed and justified epsilon, adds a collinear-duplicate
check for the coord-4/coord-7 case (flagged in the meditation as possibly novel — no
surveyed tool reports two input coordinates as numerically indistinguishable across an
entire run), closes the two remaining producer/consumer boundaries the meditation
named (`untrained-network.js`'s hardcoded `INPUT_SIZE=9`, still live on the hive
network; the unschema'd `world-state.json` write boundary), and verifies against the
meditation's own falsifiers.

## Context

### Precedents

- `_dev/reports/analysis/meditation__20260805.md` — full evidence base; candidates 1
  and 2; the per-coordinate census in section 1.1
- `_dev/reports/analysis/ticktock-cycle-1-observe.md` section 2 and section 7A/7B —
  the coord-7 activation/constant contradiction that triggered the census
- `_dev/reports/analysis/task-plans/ant-world-mind-network-repair__plan.json` —
  sibling repair; precedent for construction-time self-deriving dimension probes
  (`WORLD_INPUT_SIZE = encodeWorldState({}).length`, `world-mind.js:160`) and for a
  throwing liveness-style gate with an exact evidence-schema contract
- `tools/ant-hive-world/world-mind.js:236-291` — `assessMaskedCoordinateLiveness`
  (report-only) and `assertMaskedCoordinatesLive` (throwing, uncalled)
- `tools/ant-hive-world/run-live.js:79,646-658,867-871` — imports only the
  non-throwing assess variant; prints a liveness line to console but does not write
  it into any evidence file
- `tools/ant-hive-world/untrained-network.js:37` — `INPUT_SIZE = 9`, a plain
  constant, no re-probe against `encodeState`'s actual output length (instance 1's
  exact shape, unrepaired on the hive side)
- `tools/ant-hive-world/world-state.js` — the shared world-state producer; no
  schema or NaN guard at write time (`summarizeHives` at line 44, `writeFileSync`
  at line 208)
- `_dev/state/goal-round-rehearsal/run-rehearsal.cjs`, `derive-goal-packet.cjs` —
  the evidence-emitting harness that currently omits the liveness block entirely

### Hard constraints

- Local sandbox only; no VM/Orwell contact; no courier change
- Promoting the gate to BLOCKING is expected to **fail** the current goal-round
  rehearsal run (effective dimensionality 1 of 3 does not clear an informative
  standard) — this is the mechanism working, not a defect, and this plan does not
  soften the standard to make an existing run pass
- Do not touch `WORLD_RESOURCE_NORM_K` (`world-mind.js:71`) or the encoder's
  normalization formula — out of scope; this plan gates and reports, it does not
  redesign the reward or encoding contract (that is candidate 4, a separate plan)
- Preserve the existing `dead_zero` throw path and its message contract; the
  constant/collinear checks are additive, not replacements

### Decisions made in this amendment (decided-in-plan, not operator-ratified)

Round 2 review raised two operator questions
(`_dev/reports/analysis/task-plan-reviews/ant-world-liveness-gate__review.md`
§7). This round-3 amendment answers both directly in the plan rather than
escalating, and marks both as **decided-in-plan** — a task-plan-author
decision, not an operator ratification:

1. The `LIVENESS_ALLOWED_COLLINEAR_PAIRS` allowlist stays **permanently
   empty** for this task. Any future entry requires operator-gated mechanical
   provenance, enforced by a fail-closed load-time validator (see S0 item
   2(e)) — not a review promise.
2. Setup/legacy writes without a `hives` key are **compatible** and must not
   fail the write-path guard; live tick writes (any write where the caller
   has populated `worldState.hives`) **must** carry a valid `{ count,
   starvation_pressure }` object (see S1 item 2).

## Bounded plan

### S0 — Promote the gate to BLOCKING and redefine the standard as informative

1. **Unified pass predicate** (closes the MAJOR gap where `live` reflected
   `dead_zero` only). Rewrite `assessMaskedCoordinateLiveness`'s `live` field so it
   is true only if NONE of the failure categories fired:

   ```
   live = rows.length > 0
        && dead_zero_coordinates.length === 0
        && constant_coordinates.length === 0
        && collinear_duplicate_pairs.length === 0
        && non_finite_coordinates.length === 0
        && insufficient_coordinates.length === 0
        && insufficient_pairs.length === 0
   ```

   (Round 3 correction of F1-r2: the prior predicate omitted
   `insufficient_coordinates`/`insufficient_pairs`, so a report with an
   INSUFFICIENT-only sample — no dead_zero, constant, collinear, or
   non_finite finding, but also no coordinate/pair that cleared N=30 — could
   read `live: true`. INSUFFICIENT is a failure-to-certify category exactly
   like the other four; it must appear in the boolean the same way they do.
   The general rule this closes: every prose failure category named anywhere
   in this plan must appear in the explicit boolean acceptance predicate, not
   only in surrounding prose.)

   `assertMaskedCoordinatesLive` (`world-mind.js:278-291`) reads `report.live`
   directly as its sole pass/fail source — it must not re-derive a separate throw
   condition from `dead_zero_coordinates` alone — and its thrown message names
   every failing category and coordinate/pair that fired (dead_zero, constant,
   collinear, non_finite, or insufficient), not only dead_zero. **Any evidence-emitting caller**
   (item 3 below) that writes a `status`/`live` field into evidence MUST copy
   `report.live` verbatim; no caller computes its own separate liveness verdict
   from a subset of the report's fields — this is the exact mechanism that
   prevents a future artifact from reporting LIVE while a check failed. Rewrite
   the `standard` string at `world-mind.js:274` to state this unified criterion
   explicitly instead of "non-zero on at least one tick."

   **Informative** is defined mechanically as: range (max − min) over the sampled
   run > EPSILON, where **EPSILON = 1e-6** (absolute, on the coordinate's
   already-normalized [0,1) scale).

   **Epsilon justification.** Every masked coordinate passes through
   `normalizeWorldResource(x) = x/(x+40)` (`WORLD_RESOURCE_NORM_K`,
   `world-mind.js:71`). At the observed operating point (small integer counts near
   x=2, the hive-count/starvation-pressure regime), the smallest possible real step
   between two adjacent integer inputs is `40/((x+40)(x+41))`, which is
   approximately 0.022 at x=0 and approximately 0.0215 at x=2 — so any genuine
   single-unit change in an underlying count produces a jump of roughly 0.02 or
   larger. 1e-6 sits about four orders of magnitude below that smallest real step
   (so it never mistakes a genuine small integer-count change for noise) and about
   nine orders of magnitude above IEEE-754 double round-off on repeated identical
   computations of `x/(x+40)` (~1e-15 to 1e-16) — so it never mistakes exact
   floating-point repetition (the observed failure mode: `0.047619047619047616`
   repeated bit-for-bit across all 900 rows) for a hair of real variance.

2. Add a **fully specified collinear-duplicate check**:

   - **(a) Finite values only.** NaN/Infinity values are excluded from every
     comparison (dead_zero, constant, and collinear). A masked coordinate's
     non-finite values are instead recorded in a new `non_finite_coordinates`
     field (coordinate index, tick positions, count), and any masked coordinate
     carrying one or more non-finite values is itself a failure condition in
     `assertMaskedCoordinatesLive` — a NaN/Infinity in a trained input is worse
     than a merely-constant one.
   - **(b) Row alignment.** For a given coordinate pair, compare values only
     across rows where BOTH coordinates hold a finite numeric value at that row
     index; rows where either side is missing or non-finite are excluded from
     that pair's comparison only (they still count toward each coordinate's own
     `non_finite` tally under (a)).
   - **(c) Minimum sample.** N = 30 aligned rows. Below N aligned rows for a pair
     (or below N total samples for a coordinate's own dead_zero/constant check),
     the check reports **INSUFFICIENT** for that coordinate/pair, not PASS —
     recorded in new `insufficient_coordinates` and `insufficient_pairs` fields,
     and INSUFFICIENT is itself excluded from the `live` predicate's PASS
     condition — enforced directly by the `insufficient_coordinates.length
     === 0 && insufficient_pairs.length === 0` conjuncts in the unified `live`
     predicate above (an insufficient sample cannot certify liveness, only
     fail to disprove it). **Justification for N=30**: it sits far below the
     hundreds-to-thousands of ticks a real run produces (the meditation's own
     census used 900 rows), but is small enough that a short synthetic or
     smoke-test run can still exercise the check meaningfully; below 30 samples,
     "no variance observed" is equally consistent with "genuinely constant" and
     "not enough ticks yet for the signal to differ," so INSUFFICIENT keeps the
     gate from asserting a claim the sample size cannot support (evidence, not
     intention).
   - **(d) Truncation.** `run-live.js:645`'s `LIVENESS_SAMPLE_CAP` (5000 samples)
     does NOT invalidate a dead_zero/constant/collinear verdict computed over the
     retained window; the retained samples are a real, unweighted subsequence of
     the run, and a relationship holding across the full retained window is real
     evidence regardless of what happened before or after the cap. The report
     must carry `truncated: true` and the exact `samples` count used whenever the
     accumulator hit its cap.
   - **(e) Intentional alias — permanently empty, provenance-gated (round 3
     correction of F3-r2).** Add an exported `LIVENESS_ALLOWED_COLLINEAR_PAIRS`
     allowlist; a pair matching the allowlist (in either coordinate order) is
     recorded in a new `collinear_duplicate_pairs_allowed` field but does not
     trigger the throw. The allowlist ships and **stays PERMANENTLY EMPTY for
     this task** — none of the current `WORLD_LOSS_MASK` coordinates are
     legitimately aliased per the meditation's own census, and this plan does
     not add an entry.

     The round-2 draft treated "gated by S3 review" as sufficient protection
     for a future entry; that is a promise, not a mechanism, and this is a
     BLOCKING gate — an unenforced escape hatch on a blocking gate defeats the
     gate. This amendment replaces the promise with an enforced, fail-closed
     load-time check:

     - Each allowlist entry is a structured record, not a bare pair: `{ a, b,
       reason, operator_authorization, stamped_at }`. `a`/`b` are the
       coordinate indices and `reason` is the human-readable justification, as
       before. `operator_authorization` is a required non-empty string naming
       the explicit operator grant that authorized the entry (e.g. an
       operator-gate id, or a verbatim reference to the operator's sign-off);
       `stamped_at` is a required, well-formed ISO-8601 timestamp recording
       when that authorization was given.
     - A dedicated load-time validator — invoked by
       `assessMaskedCoordinateLiveness` before it evaluates any row, not only
       at module construction — walks `LIVENESS_ALLOWED_COLLINEAR_PAIRS` and,
       for every entry, confirms `a`, `b`, `reason`, `operator_authorization`,
       and `stamped_at` are all present, non-empty, and (for `stamped_at`)
       parse as a valid timestamp. Any entry that fails this validation on any
       field causes the validator to **throw before the liveness assessment
       runs at all** — the gate fails closed on an unprovenanced entry, it
       does not silently drop the entry back into the ordinary collinear
       failure path and it does not silently accept it. An empty allowlist
       trivially satisfies this validator (there is nothing to validate), so
       this task's shipped, empty-allowlist state is unaffected.
     - There is no other path by which an entry can suppress a
       collinear-duplicate finding. Any future addition must supply all four
       provenance fields and pass this load-time validator; S3-style distinct
       review remains required as a human check on the *reasoning* for the
       entry, but the mechanism that actually prevents an unauthorized or bare
       entry from silently passing is this validator, not the review step.

   For every non-allowlisted pair identical (within EPSILON) across all aligned,
   sufficient-sample rows, record the pair in `collinear_duplicate_pairs` and
   treat it as a failure condition in `assertMaskedCoordinatesLive` alongside
   dead-zero, constant, and non-finite. This is the coord-4/coord-7 case named in
   the meditation.

3. Wire the throwing variant into both call sites: `run-live.js` (replace/augment
   the current console-only report path at line ~867 with a call to
   `assertMaskedCoordinatesLive`, or catch-and-record so the run halts loudly with
   the existing evidence still flushed) and the goal-round rehearsal harness
   (`_dev/state/goal-round-rehearsal/run-rehearsal.cjs`) so the liveness report —
   including `effective_dimensionality`, `collinear_duplicate_pairs`,
   `collinear_duplicate_pairs_allowed`, `non_finite_coordinates`,
   `insufficient_coordinates`/`insufficient_pairs`, `truncated`, and the unified
   `live` field — is written verbatim into `goal-round-rehearsal-evidence.json`
   under a `liveness` key. After this step, `grep -c liveness` on any freshly
   emitted evidence artifact from either path must return a non-zero count.

- **is_gap**: true
- **mode**: PATCH_ALLOWED
- **files_touched**: `tools/ant-hive-world/world-mind.js`,
  `tools/ant-hive-world/run-live.js`,
  `_dev/state/goal-round-rehearsal/run-rehearsal.cjs`

### S1 — Close the two remaining producer/consumer boundaries the meditation named

1. `untrained-network.js:37` — replace the hardcoded `INPUT_SIZE = 9` with a
   self-deriving probe against `encodeState`'s actual return length, mirroring the
   world-mind precedent at `world-mind.js:160`
   (`WORLD_INPUT_SIZE = encodeWorldState({}).length`); the derivation must call
   `encodeState` with representative empty/minimal `hiveState` and `worldState`
   arguments and use the resulting array length as the single source of truth, with
   a load-time or construction-time throw if the derived width and the network's
   weight matrix disagree. This closes instance 1 of the bug family (network built
   at N inputs, encoder emits M) on the hive side, where it is still structurally
   live per the meditation's section 1.5.

2. `world-state.js` — add a producer-side schema/NaN check **inside
   `writeWorldState` itself** (`world-state.js:198-210`), immediately before the
   `fs.writeFileSync` call at line 208: before writing, assert the outgoing
   object satisfies the declared shape the encoder depends on (the `hives`
   summary carrying numeric `count` and `starvation_pressure`, per the coupling
   repair comment at `world-mind.js:90-108`) and contains no NaN in any numeric
   field the encoder reads.

   **Call-site enumeration** (grep-verified via
   `grep -rn "writeWorldState(" tools/ant-hive-world/`, excluding `__tests__/`):
   `writeWorldState` has exactly four production callers —

   - `tools/ant-hive-world/harness.js:261` (tick-path write)
   - `tools/ant-hive-world/harness.js:299` (setup-path write, initial world state)
   - `tools/ant-hive-world/harness.js:332` (another tick-path write)
   - `tools/ant-hive-world/run-live.js:775` (live-run tick-path write)

   Because `writeWorldState` is the single production chokepoint for the
   `world-state.json` file (confirmed: no other module performs its own
   `fs.writeFileSync` to the world-state path; the only other `writeFileSync`
   calls in `tools/ant-hive-world/` target hive-state files, checkpoint files, or
   unrelated config), placing the check inside `writeWorldState` itself guards
   all four call sites without per-caller duplication — the step must implement
   the check at that chokepoint, not in any individual caller.

   **Verified actual shape (round 3 correction of F4-r2).** The prior draft of
   this plan stated `hives[].count` / `hives[].starvation_pressure`, implying
   an array of per-hive records. That was wrong. The actual shape, confirmed
   by reading `summarizeHives` (`tools/ant-hive-world/world-state.js:44-61`,
   return statement at line 60: `return { count: ids.length,
   starvation_pressure: starving };`) and its only production caller
   (`run-live.js:757`, `worldStateNow.hives =
   summarizeHives(roundHiveStates)`, immediately before the write at
   `run-live.js:775`), is a single **object**, not an array: `hives: { count:
   <number>, starvation_pressure: <number> }`, where `count` is the number of
   hives and `starvation_pressure` is a COUNT (not a ratio) of currently
   starving hives. The encoder at `world-mind.js:90-108` reads exactly this
   object shape. Every reference below to `hives[].count` /
   `hives[].starvation_pressure` is corrected to `hives.count` /
   `hives.starvation_pressure`.

   **Schema compatibility rule: additive-only, unversioned, and
   lifecycle-aware.** Requiring `hives` on every write would break legitimate
   setup and legacy writes: `harness.js:299` writes
   `initialWorldState(resourcePool)` before any hive has ticked, and that
   object carries no `hives` key at all — this is the documented pre-1.1.0
   shape (see the `SCHEMA_VERSION`/backward-compatibility comment at
   `world-state.js:21-27`) and remains valid on any checkpoint-restored state
   captured before the `hives` summary existed. The check therefore
   distinguishes two compatibility classes instead of applying one rule to
   every write:

   - **Setup/legacy writes** — no `hives` key present at all (e.g.
     `harness.js:299`'s initial write, and any restore path whose captured
     state predates the summary or has not yet completed a round that
     populates it). Absence of `hives` is compatible and MUST NOT fail the
     guard.
   - **Live tick writes** — any write where the caller has populated
     `worldState.hives` (concretely, `run-live.js`'s round-level write at
     `run-live.js:775`, downstream of the `summarizeHives` assignment at
     `run-live.js:757`). When `hives` is present, it MUST be an object
     carrying numeric, non-NaN `count` and `starvation_pressure`; the check
     throws — naming which field is missing/invalid and its actual value —
     if either is absent, non-numeric, or NaN. Presence of a malformed
     `hives` object is never exempted by the setup/legacy allowance above;
     only true absence of the key is exempt.

   The other fields enumerated in `ENCODER_COUPLING_PROBE` at
   `world-mind.js:186-223` follow the same additive-only, non-NaN numeric
   validation regardless of `hives`'s presence. This does not reject
   additional fields a caller adds, and it does not enforce an exact/closed
   shape — mirroring `ENCODER_COUPLING_PROBE`'s own posture and staying
   inside this plan's hard constraint against touching the
   encoder/normalization contract. A future producer that needs to remove or
   rename a currently-required field is a breaking change requiring its own
   reviewed plan, not a silent pass through this additive-only check. S2 item
   (h) below tests both compatibility classes explicitly, per caller.

   This is a producer-side complement to the existing consumer-side
   `ENCODER_COUPLING_PROBE` (`world-mind.js:186-223`), which defends the
   encoder's reading but not the writer's writing — the exact boundary instance 2
   (`worldState.hives` never existed) tripped over.

- **is_gap**: true
- **mode**: PATCH_ALLOWED
- **files_touched**: `tools/ant-hive-world/untrained-network.js`,
  `tools/ant-hive-world/world-state.js`

### S2 — Verification against the meditation's own falsifiers

Run all **eight** falsifiers named below (expanded from the meditation's original
four, through seven in round 2, to eight in round 3 to cover F1-r2/F3-r2/F4-r2),
and record each as a pass/fail with its artifact:

- **(a) Synthetic constant-nonzero test.** Construct a synthetic encodings array
  where a masked coordinate is pinned at a single non-zero value across every row;
  call `assertMaskedCoordinatesLive` and confirm it **throws** and that
  `report.live` is false (if it passes, the promoted gate did not kill the class
  and S0 has failed).
- **(b) Synthetic collinear-duplicate test.** Construct a synthetic encodings array
  where two non-allowlisted masked coordinates carry identical value sequences
  across at least N=30 aligned rows; confirm `assertMaskedCoordinatesLive` throws,
  the failure names both coordinate indices, and `report.live` is false.
- **(c) Hive encoder/network drift test — one side only per sub-case.** Self-
  derivation cannot mask a real mismatch if both sides move together, so each
  sub-case mutates exactly one side while pinning the other:
  - **(c-i)** Pin the network's declared input width at its current constructed
    value and call the self-deriving probe against an `encodeState` variant that
    returns one extra coordinate (representative minimal `hiveState`/`worldState`
    fixture, length N+1). Confirm the probe **throws** and the message names both
    the derived encoder length (N+1) and the network's pinned width (N).
  - **(c-ii)** Inverse of c-i: pin `encodeState`'s output at its current length N
    and construct the network with a weight matrix declaring width N+1 (or N-1).
    Confirm construction **throws** and the message names both numbers.
  A test that self-derives both sides from the same `encodeState` call does not
  satisfy this falsifier — both sides moving together proves nothing about drift.
  If either sub-case fails to throw, instance 1's bug class is still live on the
  hive network and S1 item 1 has failed.
- **(d) Evidence propagation test.** Re-run the goal-round rehearsal end to end and
  confirm `grep -c liveness` on the freshly regenerated
  `goal-round-rehearsal-evidence.json` returns a non-zero count, with
  `effective_dimensionality`, `collinear_duplicate_pairs`,
  `non_finite_coordinates`, `insufficient_coordinates`/`insufficient_pairs`,
  `truncated`, and the unified `live` field present and populated.
- **(e) Regression check.** Re-run the existing checkpoint refusal ladder and any
  prior goal-round rehearsal regression suite to confirm nothing outside the
  liveness gate itself regressed.
- **(f) Non-finite / insufficient-sample test.** Construct a synthetic encodings
  array with a NaN or Infinity value in a masked coordinate and confirm it is
  flagged in `non_finite_coordinates` and treated as its own throw condition (not
  silently absorbed into constant or collinear); separately construct an array
  with fewer than N=30 aligned rows for a coordinate pair and confirm the verdict
  reports **INSUFFICIENT** (recorded in `insufficient_coordinates`/
  `insufficient_pairs`) rather than PASS, and that `report.live` is not true on
  the strength of an insufficient sample.
- **(g) Allowlist test (round 3: split into two parts to cover F3-r2).**
  (i) Confirm the shipped `LIVENESS_ALLOWED_COLLINEAR_PAIRS` is empty by
  default (no entries land in this plan), and confirm a pair placed on it
  **with** a valid, fully-populated `{a, b, reason, operator_authorization,
  stamped_at}` record is recorded in `collinear_duplicate_pairs_allowed` but
  does not trigger the throw. (ii) Confirm a pair placed on the allowlist
  **without** valid provenance (missing or empty `operator_authorization`,
  missing or malformed `stamped_at`, or missing `reason`) causes the
  load-time validator to throw before any liveness assessment runs — a
  non-empty allowlist without valid provenance FAILS the gate outright,
  rather than silently passing or silently degrading to an ordinary
  unallowlisted collinear failure.
- **(h) Hive-summary write compatibility test (round 3, closes F4-r2) — one
  case per lifecycle stage.** (i) SETUP/LEGACY: call `writeWorldState` with a
  world-state object that has no `hives` key at all (the exact shape
  `harness.js:299`'s initial write produces, and the shape of any
  checkpoint-restored state captured before the `hives` summary existed);
  confirm the write-path schema/NaN check (S1 item 2) does **not** fail it —
  absence of `hives` is compatible. (ii) LIVE TICK: call `writeWorldState`
  with a world-state object carrying `hives: { count, starvation_pressure }`
  (the exact shape `run-live.js:757`'s `summarizeHives` call produces before
  the write at `run-live.js:775`); confirm the check passes when both fields
  are numeric and non-NaN, and throws — naming the offending field and its
  actual value — when either field is missing, non-numeric, or NaN. This
  confirms the guard does not require `hives` universally (which would break
  setup writes) while still validating it strictly wherever a live-tick
  caller supplies it.

**Expected result, recorded not suppressed**: the real (non-synthetic) goal-round
rehearsal run is expected to **fail** the newly-blocking gate, because the current
run's measured effective dimensionality is 1 of 3 (coordinates 4 and 7
collinear-constant, coordinate 2 adjacent-and-constant). That failure is evidence
the gate works, not a reason to weaken the standard — if it is instead treated as a
reason to raise EPSILON, narrow the collinear check, lower N, or add an unreviewed
allowlist entry until the current run passes, this step has failed regardless of
what the test output says.

- **is_gap**: false
- **mode**: RUN_ONLY
- **files_touched**: `_dev/state/liveness-gate-test/` (evidence),
  `_dev/state/goal-round-rehearsal/goal-round-rehearsal-evidence.json` (regenerated)

### S3 — Distinct-family review + debrief

Codex-bridge trial bound to the S0-S2 diff and the falsifier evidence
(gate `G-LIVENESS-GATE-REVIEW`). Review must specifically check:

1. the EPSILON justification against the normalizer's actual step sizes at other
   operating-point scales, not just the observed 1/21 case;
2. whether the collinear-duplicate check as specified could false-positive on two
   coordinates that are legitimately identical by construction rather than by
   defect (e.g. two coordinates whose formulas are meant to track the same
   underlying quantity);
3. whether the expected-failure framing in S2 was honored rather than quietly
   softened.

Then run the standard debrief and record: what changed, what the promoted gate now
blocks that it did not before, and the concrete disposition of the current
goal-round rehearsal run's failure (rerun after a rescoped reward contract per
candidate 4, or explicitly parked as a known-failing baseline pending that separate
plan).

- **is_gap**: false
- **mode**: REVIEW_ONLY
- **files_touched**: `_dev/reports/analysis/run-debrief__ant-world-liveness-gate__<date>.md`

## Required gates

- **G-LIVENESS-GATE-REVIEW** — status: pending. S3 codex-bridge trial must clear
  before this gate's promotion to BLOCKING is treated as landed for any downstream
  run or evidence-consuming report.

## Expected outcomes

| Outcome | Artifact | Field |
|---|---|---|
| `live` is a single unified predicate — true only if none of {dead_zero, constant, collinear_duplicate, non_finite} fired for any masked coordinate AND no masked coordinate or pair is INSUFFICIENT — and every evidence-emitting caller copies `report.live` verbatim rather than re-deriving its own status | `tools/ant-hive-world/world-mind.js` | `assessMaskedCoordinateLiveness().live` (including the `insufficient_coordinates.length === 0 && insufficient_pairs.length === 0` conjuncts) + `assertMaskedCoordinatesLive()` throw condition + `assessMaskedCoordinateLiveness().standard` |
| Two masked coordinates that are numerically identical across an entire run (over finite, aligned, sufficiently-sampled rows, excluding allowlisted pairs) are detected and named | `tools/ant-hive-world/world-mind.js` | `assessMaskedCoordinateLiveness().collinear_duplicate_pairs`, `.collinear_duplicate_pairs_allowed`, `.non_finite_coordinates`, `.insufficient_coordinates`, `.insufficient_pairs`, `.truncated` |
| Every freshly emitted goal-round rehearsal evidence file carries the liveness report, not zero occurrences of the term | `_dev/state/goal-round-rehearsal/goal-round-rehearsal-evidence.json` | `liveness` |
| The hive network's input width is self-deriving from `encodeState`, matching the world-mind precedent, with no second hardcoded number to forget | `tools/ant-hive-world/untrained-network.js` | `INPUT_SIZE` (replaced by a probe of `encodeState`'s return length) |
| The shared world-state file is validated against its declared additive-only shape at write time inside `writeWorldState` itself, guarding all four production call sites (`harness.js:261`, `harness.js:299`, `harness.js:332`, `run-live.js:775`) without per-caller duplication, not only defended at read time by the encoder's coupling probe | `tools/ant-hive-world/world-state.js` | write-path schema/NaN assertion preceding `writeFileSync` (`world-state.js:198-210`) |
| All seven falsifiers pass as specified, and the real (non-synthetic) rehearsal run's failure is recorded honestly rather than suppressed | `_dev/state/liveness-gate-test/` evidence + `run-debrief__ant-world-liveness-gate__<date>.md` | `falsifier_results[a, b, c-i, c-ii, d, e, f, g]` and current-run gate outcome |

## Risk notes

- **Primary risk, named deliberately**: making the liveness gate BLOCKING is
  expected to fail the current live goal-round rehearsal run, because the
  meditation's own census measured effective dimensionality 1 of 3 on that run.
  This is the intended behavior of the fix, not a regression to route around. What
  happens then: the run is not rerun blind against the same reward contract; it is
  either (a) parked explicitly as a known-failing baseline with the failure cited
  in the debrief, pending candidate 4 (the reward-contract audit) landing first, or
  (b) rerun after candidate 4's fix, whichever the operator or the S3 review
  directs. The plan must not, and does not, weaken EPSILON or narrow the
  collinear-duplicate check merely to make the current run pass — doing so would be
  exactly the failure mode this plan exists to close.
- EPSILON is a single fixed constant chosen a priori from the normalizer's known
  step structure (mirroring the `WORLD_RESOURCE_NORM_K` precedent's own
  no-per-run-tuning discipline); if a future coordinate uses a different
  normalization formula with a much smaller natural step, this EPSILON may need a
  per-coordinate variant — flagged for S3 review, not resolved in this plan.
- The collinear-duplicate check could in principle false-positive on two
  coordinates that are legitimately meant to move together; this amendment adds
  the `LIVENESS_ALLOWED_COLLINEAR_PAIRS` allowlist as the honest mechanism for
  that case (S0 item 2(e)), shipped and kept **permanently empty for this
  task** because none of the current `WORLD_LOSS_MASK` coordinates have that
  relationship. Any future non-empty entry is gated by an enforced,
  fail-closed load-time provenance validator (round 3, closing F3-r2 — every
  entry must carry non-empty `operator_authorization` and a valid
  `stamped_at`, or the validator throws before any liveness assessment runs),
  not merely a review promise; S3 review must confirm this mechanism itself
  (not a widened EPSILON or narrowed pair search) before it is trusted as a
  general-purpose check.
- The minimum-sample threshold N=30 (S0 item 2(c)) and the
  truncation-does-not-invalidate rule (S0 item 2(d)) are both a priori choices
  grounded in the normalizer's step structure and the observed 900-row census,
  not per-run tuning; S3 review must confirm N=30 is not itself weakened to make
  a short or partial run pass.
- Wiring the throwing variant into `run-live.js` changes a live run from
  "completes and reports a liveness line" to "halts on a dead or non-informative or
  collinear mask" — any caller or downstream script that currently expects
  `run-live.js` to always complete must be checked for a matching change during S3.

## Scope identity

**Owned artifacts**:

- `tools/ant-hive-world/world-mind.js`
- `tools/ant-hive-world/run-live.js`
- `tools/ant-hive-world/untrained-network.js`
- `tools/ant-hive-world/world-state.js`
- `_dev/state/goal-round-rehearsal/run-rehearsal.cjs`
- `_dev/state/liveness-gate-test/`
- `_dev/reports/analysis/run-debrief__ant-world-liveness-gate__<date>.md`

## Routing expectations

- **Risk tier**: medium
- **Review lane**: codex-bridge
- **Review lane rationale**: Small, well-scoped engine fix (gate promotion + two
  boundary closures), but it is expected to change the live/pass status of an
  existing run and touches the shared world-state producer path; local-only
  execution, no VM/Orwell contact.
- **Escalation triggers**:
  - EPSILON or the collinear-duplicate check needs to be softened to make the
    current rehearsal run pass
  - the world-state schema/NaN guard requires a shape change that ripples into the
    checkpoint loader or the hive network's own read path
  - any caller outside `tools/ant-hive-world/` depends on `run-live.js` completing
    even when the mask is dead, non-informative, or collinear

## Operator gates

None.

## Artifacts

- `_dev/reports/analysis/task-plans/ant-world-liveness-gate__plan.json`
- `_dev/reports/analysis/task-plans/ant-world-liveness-gate__plan.md`
