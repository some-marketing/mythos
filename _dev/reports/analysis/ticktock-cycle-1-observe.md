# /ticktock cycle 1 — OBSERVE

Local-only. No Orwell/VM contact. Nothing staged or committed.

**TICK evidence**: `_dev/state/goal-round-rehearsal/goal-round-rehearsal-evidence.json`
(regenerated 2026-08-05T06:22:52.758Z, repo_head `6dce6fa7d`). Both commands ran clean:
`derive-goal-packet.cjs` (packet_sha256 `37cedbe9…`) then `run-rehearsal.cjs`
(6 turns, all exit 0, 2.6s wall). Both packet and evidence validated against their
JSON schemas. Overall verdict recorded in the artifact: `PASS_WITH_FINDINGS`.

Raw per-tick sources used below: `arms/{goal,control}/turn{1,2,3}/decision-stream.jsonl`
(450 rows each) and `run-log.jsonl` (450 rows each), all under
`_dev/state/goal-round-rehearsal/`.

---

## 1. Goal progress

Per-condition measured value vs. threshold, from `arms.goal.turns[*].goal_result.final_evaluation.per_condition`:

| tick | food-stockpile (≥4.7561) | water-pool (≥5.5879) | both-hives-alive (≥2) | met |
|---|---|---|---|---|
| 150 | 0 | 0.000444 | 2 (sat.) | false |
| 300 | 0 | 2.3545 | 2 (sat.) | false |
| 450 (deadline) | 0 | 0.03235 | 2 (sat.) | `met_at_deadline: false` |

Only `both-hives-alive` was ever satisfied. Food stayed pinned at exactly 0 for all three
checkpoints. Water rose from tick 150→300 (0.0004 → 2.35) then collapsed by tick 450
(2.35 → 0.032) — closer to survival at the midpoint, then further away by the deadline.
Net verdict at deadline: **not met**, 1 of 3 conditions satisfied, and the colony ended
the run further from the water threshold than it was at its own turn-2 peak.

The `reachability` block (control-arm dynamics only) shows the food and hive-count
thresholds do have a live pathway (`control_max` 32.04 for food vs. threshold 4.76,
`progress_ratio` 6.74 — the world *can* reach it, just didn't on this seed/run), while
water's control-arm max (2.35) never even reached its own threshold
(`progress_ratio` 0.42) — water is the harder of the two resource conditions on this
seed.

## 2. Coord-7 / starvation

Two independent readings disagree, and this is the headline anomaly (see §7).

- `coord7_events.activation`: `activated: true`, nonzero on 450/450 ticks, first
  activation at tick 0, for both arms.
- `coord7_events.per_tick_series`: **exactly one distinct value the entire run** —
  `0.047619047619047616` — for all 450 ticks, both arms. Verified directly against
  raw decision-stream rows: `wx[7]` (world coordinate 7) is
  `0.047619047619047616` on every single world-actor row in
  `arms/{goal,control}/turn{1,2,3}/decision-stream.jsonl` (1350 rows checked, zero
  variation).
- Cross-check against `run-log.jsonl`: `food_exhausted: true` on 900/900 hive-tick
  rows in the goal arm and 900/900 in the control arm — every hive, every tick, for
  the full 450-tick chain. But the `starved` flag (a different field on the same
  rows) is `false` on 599/600 rows across turn1+turn3 sampled, flipping `true` only
  once (turn3, one row).

So: the underlying ecology condition (zero food stockpile) is genuinely constant and
total from tick 0 — this part is real and matches the "hives never had food" story.
But the coord-7 *encoder value* that is supposed to represent starvation pressure per
tick never moves at all, which is inconsistent with a coordinate meant to encode a
per-tick pressure signal. It reads as a fixed constant (1/21) rather than a measured
quantity — see §7.

## 3. Learning (world-mind)

Prediction-loss trajectory, `learning_continuity.per_turn` (identical for goal and
control, as expected under isolation):

| turn | ticks | first_loss | last_loss | mean_loss |
|---|---|---|---|---|
| 1 (t 1–149) | 149/149 updated | 1.56e-3 | 2.66e-6 | 3.11e-4 |
| 2 (t 150–299, resumed) | 150/150 updated | 2.48e-6 | 2.64e-5 | 6.91e-6 |
| 3 (t 300–449, resumed) | 150/150 updated | 1.26e-5 | 1.56e-7 | 3.33e-6 |

Loss drops ~3 orders of magnitude within turn 1 alone (1.56e-3 → 2.66e-6), continues
improving through turn 3's final tick (1.56e-7). Turn 2 opens slightly higher
(2.48e-6) than turn 1's end (2.66e-6 — comparable) then dips before a small
mid-turn bump to 2.64e-5 at its close; turn 3 opens higher again (1.26e-5) and drives
down another order of magnitude by its end. Net: the world-mind keeps improving
across all three chained resumes, with a small give-back at each new turn's start
(consistent with fresh stochastic ticks against a slightly stale model) that gets
retrained down within the turn.

Parameter displacement at generation `gen-450-goal-turn3` / `gen-450-control-turn3`:
identical `absolute_l2 = 0.008316`, `relative_to_init_norm = 0.01839` for both arms —
a small, bounded drift from initialization after 450 ticks and two resumes.

Contamination alarm: `verb_weights_unchanged` — `W2`/`b2` byte-identical to
initialization for both arms. `verdict: QUIET`. The masked-prediction training signal
is not leaking into verb-preference weights.

## 4. Mirror

`confound_results.mirror_test`:

| arm | n_builds | n_features | distinct_tiles | observed | p_value | null_mean | null_sd | verdict |
|---|---|---|---|---|---|---|---|---|
| goal | 14 | 43 | 12 | 0.5 | 0.085 | 0.7355 | 0.1710 | approaching-null |
| control | 14 | 43 | 12 | 0.5 | 0.091 | 0.7332 | 0.1691 | approaching-null |

Feature-density parity between arms: identical counts (`wood_sources: 20`,
`stone_sources: 20`, `clay_sources: 2`, `water_sources: 1`, `food_sources: 0`,
`ore_sources: 0`, `fiber_sources: 0`, total 43 tiles) — the mirror comparison is not
contaminated by differing terrain between arms.

Confound test applicability: `confound_results.applicable = false`,
`verdict: NOT_APPLICABLE`. The D1 confound predicate only fires when there's an
observed policy-path divergence to attribute; with 0 diverging decision-stream rows
at identical seeds, there is nothing to attribute, so the predicate is correctly
marked not-applicable rather than "passed."

## 5. Behavioral delta (goal vs. control)

Decision-stream SHA-256 identical for both arms across all three chained turns:
`655a630b406eb76d98ffa9d2b0c7b3bd…8349816` (goal) ==
`655a630b406eb76d98ffa9d2b0c7b3bd…8349816` (control). `diverging_rows: 0`,
`first_divergence: null`, `verdict: ISOLATION_HELD`.

The static call-graph audit (`isolation_call_graph_audit`) found exactly one importer
of the goal evaluator (`run-live.js`) and traced every read of its return value —
all six sinks are report/checkpoint surfaces (`goal-evaluator-trace.jsonl`,
checkpoint manifest `goal:` field, `goal-result.json`); none feed back into
simulation state. `verdict: ONE_WAY_CONFIRMED`.

**Isolation still holds after the coord-7 change.** The evaluator remains report-only;
the coord-7 fix touches the encoder input the world-mind trains on, not the goal
evaluation path, so this is consistent with the isolation claim rather than a
challenge to it.

## 6. What the ants actually did

Hive-actor action counts (excludes the `world` actor rows), from the decision streams:

| turn | claim-territory | gather | build | idle |
|---|---|---|---|---|
| 1 (t 0–149) | 107 | 95 | 55 | 43 |
| 2 (t 150–299) | 175 | 59 | 38 | 28 |
| 3 (t 300–449) | 186 | 55 | 32 | 27 |

`claim-territory` dominates and grows across the run (107→175→186); `gather` and
`build` both shrink. Success rates (`applied: true` fraction) tell the sharper story:

| turn | gather applied | build applied | claim-territory applied |
|---|---|---|---|
| 1 | 30/95 (32%) | 14/55 (25%) | 91/107 (85%) |
| 2 | 2/59 (3%) | 0/28 (0%) | 106/175 (61%) |
| 3 | 1/55 (2%) | 0/28 → 0/27 (0%) | 80/186 (43%) |

Gather collapses from a 32% success rate to 2–3% between turn 1 and turns 2–3 —
consistent with food sources being effectively exhausted early (food-stockpile
measured 0 at every checkpoint, §1). Build success drops to exactly 0% for the last
two turns (0/28, then 0/27), meaning every build attempt from tick ~150 onward failed
— resource-starved hives keep trying to build and keep failing. Claim-territory stays
the one action that mostly succeeds, though its own success rate also decays
(85%→61%→43%) as more of the map gets claimed or contested. Net narrative: as the
colony's food and build materials run out, the ants increasingly default to the one
action that still works (claiming territory) while gather and build attempts pile up
as failures rather than stopping — the policy keeps trying the same starved-out
actions rather than adapting away from them within this 450-tick window.

---

## 7. Anomalies / contradictions for TOCK

**A. Coord-7 reads as a frozen constant, not a per-tick series.** The evidence
artifact's own `activation` block says `activated: true` with the coordinate
"nonzero" on all 450 ticks — technically true, but misleading: it is the *same*
value (`0.047619047619047616`, i.e. 1/21) on literally every one of the 1350
world-actor rows checked across both arms and all three turns. There is zero
movement to observe. The task brief asked for "how many hives starving, when, how it
moved across the 450 ticks" — the honest answer is: the underlying condition (zero
food, `food_exhausted: true` on 900/900 hive-rows) is real and total from tick 0, but
whatever coord-7 is currently encoding is not tracking it dynamically; it looks like
a static function of hive count (2 hives) rather than a live starvation-pressure
measurement. This deserves a look at the normalization formula in
`world-state.js`/`encodeWorldState`, not just the boolean predicate.

**B. The evidence file's own `deviations` list is stale relative to its
`coord7_events` block.** `deviations[2]` (`D-COORD7-DEAD`) states "Coord 7
(starvation pressure) cannot activate: world-state.js summarizeHives compares an
OBJECT stockpile against 0, which is always false in JavaScript" and says this is
unrepaired ("world-state.js is outside the declared write set"). But the same
artifact's `coord7_events.activation.activated` is `true` and the per-tick series is
nonzero throughout. Either the deviation text is left over from before the coord-7
fix mentioned in the task brief and should be retired, or the fix only partially
addressed the predicate (made it nonzero but not dynamic) — worth resolving which,
since right now the artifact contradicts itself on whether coord-7 is dead or alive.

**C. `starved` and `food_exhausted` disagree almost entirely.** `food_exhausted` is
`true` on 100% of hive-tick rows (900/900 both arms) but `starved` is `true` on only
1 of ~1800 hive-tick rows sampled. If "exhausted" means zero stockpile and "starved"
is meant to be a consequence of sustained exhaustion, a 450-tick run at 100%
exhaustion producing essentially 0% starvation looks like a second predicate that
also isn't tracking the condition it's named for — possibly the same class of bug as
(A)/(B), possibly a different threshold/cooldown that just hasn't tripped yet. Worth
checking whether `starved` is gated on a duration threshold that 450 ticks doesn't
reach, or whether it has its own dead-predicate bug.

**D. Deployment-path deviations are unrelated to this TICK but still open**:
`D-GOAL-PACKET-FORWARD` (`blocks_s2: true`) — the guest runner does not yet forward
`GOAL_PACKET` to the driver as `--goal-packet`, so a real Orwell run would currently
record `goal: null` even with a valid packet staged. Not exercised by this local
rehearsal (which calls the driver directly), but blocking for any next TICK that
tries to leave localhost.

**E. Passthrough validation is rule-parity-only, not an execution receipt.**
`passthrough_validation.executed: false` — PowerShell isn't installed on this host,
so `run-job.ps1`'s validation rules were checked for literal presence and re-exercised
in a JS transcription, not run for real. `verdict: RULE_PARITY_ONLY`. Consistent with
the LOCAL ONLY constraint on this cycle, but a claim of "this validation actually
runs" would not be earned yet.

---

**Artifact**: `_dev/reports/analysis/ticktock-cycle-1-observe.md` (this file)
**Evidence regenerated this TICK**: `_dev/state/goal-round-rehearsal/goal-round-rehearsal-evidence.json`
