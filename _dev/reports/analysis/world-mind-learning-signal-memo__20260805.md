# World-mind learning-signal design memo

**Plan:** `ant-world-mind-learning-path`, step S0 (`REVIEW_ONLY`)
**Gate this memo faces:** `G-LEARNING-SIGNAL-DESIGN` (codex design review, must clear before S1)
**Date:** 2026-08-05
**Mode discipline:** the engine under `tools/ant-hive-world/` was read only. Every
measurement below was produced by scripts written into a session scratchpad
(`/private/tmp/claude-501/-Users-admin-mythos/2a3e83da-becd-4845-b2de-1be1dca94142/scratchpad/`),
which construct networks in memory and require the engine as a library. One local
300-tick run was executed into a scratchpad sandbox. Nothing was staged or committed.

---

## 0. The recommendation in one sentence, and the tension it exposes

**Recommended: candidate (c), one-step masked prediction error on a hidden-layer
prediction head — the only one of the three that does not optimize the world
mind's action distribution, and therefore the only one that leaves the mirror gate
interpretable.** Choosing it forces a decision the plan does not currently
anticipate: **candidate (c) cannot satisfy S2's criterion (b′) as written**, and
that is a measured fact, not a tuning problem (§5.3). The memo recommends (c) and
proposes a replacement criterion, calibrated by measurement, for the gate to accept
or reject.

The reason the tension exists is worth stating before anything else, because it
governs the whole design:

> **Two of the world mind's five verbs author the mirror detector's feature field.**
> `seed-wood` and `seed-stone` create `wood_sources` / `stone_sources` tiles;
> `mirror-detector.js:44` reads exactly those families as the "world features" that
> builds are correlated against. Measured on a frozen 300-tick local run: **40 of
> the 46 feature tiles present at tick 300 (87%) were authored by the world mind's
> own verbs**, and both source caps (20 each, `world-mind.js:190,198`) were already
> saturated. Therefore *any* learning signal that shifts the world mind's verb
> distribution shifts the input to the mirror statistic. Mirror-safety is not a
> property you can add to a policy-optimizing signal by choosing the reward terms
> carefully; it is a property of not optimizing the policy against outcomes at all.

---

## 1. The three candidates, fully sketched

Shared context. `encodeWorldState()` (`world-mind.js:69-102`) emits exactly 8
features, and `WORLD_INPUT_SIZE` is a live probe of that function, not a restated
constant (`world-mind.js:112`). Index and meaning, used throughout this memo:

| idx | feature | source |
|---|---|---|
| 0 | normalized total food across `food_sources` | `sumFoodSources()` |
| 1 | normalized `resources.wood` (shared pool) | `worldState.resources` |
| 2 | normalized `resources.stone` (shared pool) | `worldState.resources` |
| 3 | normalized `food_sources` **count** | `Object.keys(food_sources).length` |
| 4 | normalized hive count | `Object.keys(hives).length` |
| 5 | normalized territory-tile count | `Object.keys(territory).length` |
| 6 | normalized total pheromone strength | sum over all kinds/tiles |
| 7 | normalized starvation pressure (hives at stockpile ≤ 0) | `hives[*].hive_state.stockpile` |

All eight pass through `normalizeWorldResource(x) = x/(x+40)`
(`WORLD_RESOURCE_NORM_K = 40`), which matters for magnitude arguments below: a
2-hive world puts feature 7 in `{0, 0.0244, 0.0476}`.

The policy path is `probs = softmax(W2·relu(W1·x + b1) + b2)`, sampled — never
argmax — in `decideWorld()` (`world-mind.js:163-181`). `createNetwork()` draws
weights from ±0.1 and initializes both bias vectors to zero
(`untrained-network.js:106-122`), so a fresh world mind's logits are O(0.01) and
its policy is near-uniform by construction. That fact is the reason the repair
evidence records entropy pinned at ln(5) with a *working* forward path, and it is
the reason §5.3's result comes out the way it does.

### (a) Outcome reward, mirroring the hive pattern

**Shape.** Exactly `train-tick.js`'s composition, one level up: sample the world
verb once, apply it, score the application, call a REINFORCE update with the world
mind as subject. `reward = +1` if `applyWorldVerb()` reports `applied`, `-0.5` if it
refuses (cap reached, unknown verb, or `idle`, which returns `applied:false`).

**What it optimizes.** The probability that the verb the world emits is a verb the
world can actually carry out. Nothing else — there is no notion in it of whether
the world got better.

**Expected behavioral consequence.** `signal-food` and `relax-decay` always apply,
so they are always rewarded; `idle` never applies, so it is always punished;
`seed-wood`/`seed-stone` are rewarded until their 20-tile caps and punished after.
The learned policy is therefore "never idle, prefer whichever environmental
intervention is currently uncapped." Measured in the 300-step magnitude probe:
`signal-food` rose to 109/300 draws and `idle` fell to 12/300, from a frozen
baseline of 51 and 68 respectively. It optimizes *acting*, not *coordinating*.

**Checkpoint-state footprint.** Zero new persisted state. The sampled action index
is consumed within the tick; plain REINFORCE has no accumulators. (If the hive
side's entropy schedule or reactive controller were reused, that would add a
per-mind controller object — this memo does not propose reusing them.)

**Determinism story.** Clean. The action is already drawn from the checkpointed
`world` RNG stream; the update consumes no further randomness and reads no clock.

**Mirror-gate interpretability — CONFOUNDED.** This is the failure mode the plan's
risk note names, and it is direct rather than subtle: the reward pays `+1` for
`seed-wood` and `seed-stone`, which are the verbs that create the mirror detector's
feature tiles. A run under this signal reaches the source caps sooner and holds a
different verb mix than any control, so mirror-p is being computed on a feature
field the reward function shaped. Rejected on that ground alone.

**Second, independent defect.** `run-live.js:520-532` prefers a *pushed* decision
from the Mythos world-mind harness when `world-mind-decision.json` is present, and
falls back to the network only when it is absent. On a pushed tick there is no
sampled action index, so an outcome-reward signal has nothing to train on and must
skip the tick — learning would silently become a function of whether the harness
happened to be running. Any action-conditioned signal inherits this.

### (b) World-level objective (homeostasis delta)

**Shape.** Same REINFORCE update, different reward: a scalar world-health objective
`J`, with `reward_t = J_{t+1} − J_t` (a delta, so the reward is centered near zero
rather than a level).

**What it optimizes.** Keeping the world's populations and resources near a target
regime — hives fed, starvation low.

**Expected behavioral consequence.** In principle: `signal-food` and `relax-decay`
when starvation rises (pheromone recruitment is the world's only lever on hive
foraging), quiet otherwise. In practice, see below.

**Checkpoint-state footprint.** One float — `J_{t-1}` — needed to form the delta.
Plus whatever the objective itself reads, which is already in world state.

**Determinism story.** Clean, same as (a).

**Mirror-gate interpretability — CONFOUNDED, though less directly than (a).** The
tempting formulation of `J` reads food availability, i.e. features 0 and 3, which
are the `food_sources` family the mirror detector reads. That much can be excluded
by restricting `J` to hive-internal stockpiles (feature 7's raw source), which is
genuinely mirror-orthogonal. But the confound survives the exclusion, because the
signal still *optimizes the verb distribution* — and the verb distribution is what
authors 87% of the feature field. Restricting the reward's inputs does not restrict
the reward's effect on `seed-wood`/`seed-stone` frequency; a signal that makes the
world quieter seeds fewer tiles, and a signal that makes it busier seeds more.

**Two further defects, both measured or arithmetic.**

1. *No baseline.* `trainStep`'s gradient is `((1[a=chosen] − p) · reward)` with no
   value baseline (the identical concern `train-tick.js:56-65` records as
   UNRESOLVED for the hive side). A level-form objective produces a large positive
   mean reward — 0.927 in the probe — which inflates every sampled action in
   proportion to how often it was sampled. That is rich-get-richer amplification,
   not learning. The delta form fixes it, which is why it is specified above.
2. *The delta form is then too small to matter.* On the normalized encoder
   coordinate, a 2-hive world gives feature 7 ∈ `{0, 0.0244, 0.0476}`, so
   `|reward| ≤ 0.048` — roughly 20× weaker than (a), which would put policy motion
   back below the noise floor. Escaping that requires defining `J` on *raw* counts
   (starving hives ∈ {0,1,2}, total hive stockpile), at which point the reward is
   dominated by the hives' own simultaneous REINFORCE learning rather than by
   anything the world verb did. Credit assignment is then so poor that S2's
   criterion (c) — "learning improves the signal it optimizes" — is unlikely to
   hold, and if it did hold it would be unattributable.

### (c) Prediction error — RECOMMENDED

**Shape.** Add a linear prediction head reading the *hidden* layer. At each tick the
mind predicts the next tick's world features; one tick later it is scored against
what actually happened and the error is backpropagated into the head and the shared
trunk (`W1`, `b1`). **`W2` and `b2` — the verb-preference weights — receive no
gradient from this signal, ever.** The policy changes only because the
representation it reads changes.

**What it optimizes.** A world model: how this world's pheromone field, starvation
pressure and population evolve from one tick to the next, marginalizing over the
mind's own stochastic verb choice.

**Expected behavioral consequence.** The mind's verb preferences drift as its
internal representation reorganizes, in a direction not selected by any outcome.
This is deliberately *not* a behavioral improvement claim. What improves is
prediction: measured in the feasibility probe, masked loss fell from 0.0308 (first
50 steps) to 0.0052 (steps 250–300), a 5.9× reduction, and relative parameter
displacement reached 21.5% of the initial parameter norm at 300 steps.

**Checkpoint-state footprint.** 80 new floats and one nullable flag:
`Wp` (8×8 = 64), `bp` (8), and `prev_features` (the 8-vector encoded at the previous
tick, or `null`). **No optimizer accumulators**: plain SGD at a fixed learning rate,
no momentum, no schedule, no tick-dependent term. This is a deliberate choice — the
plan's hard constraint is that learning state must persist completely, and the
cheapest way to guarantee that is to have almost none.

**Determinism story.** Strongest of the three. The update is pure arithmetic on
stored doubles: it draws **zero** RNG values, so the `world` stream's state after a
tick is bit-identical to what it is today, and it reads no clock. Replays are
byte-reproducible under a fixed seed. Because the signal is not conditioned on the
sampled verb, it also keeps working on ticks where `run-live.js` takes the *pushed
harness* decision instead of the network's — defect (a) does not apply.

**Mirror-gate interpretability — the only clean one.** No term in the loss is a
function of any tile position, and no term rewards or punishes any verb. The verb
distribution is not being optimized against anything, so a shift in it is
directionless with respect to the mirror statistic rather than pushed toward it.
The formal contract, including the excluded coordinates, is §4.

---

## 2. Recommendation

**Candidate (c), hidden-layer prediction head, masked one-step prediction error.**

1. **It is the only mirror-safe option, and mirror-safe wins ties** (plan risk
   note). This is not a close call once §0's measurement is on the table: `seed-wood`
   and `seed-stone` author 87% of the mirror detector's feature field, so (a) and (b)
   both make the mirror gate measure the reward function.
2. **Its determinism story is the strongest**: zero RNG draws, no clock, no
   accumulators, and it is unaffected by whether the harness-pushed decision path is
   active on a given tick.
3. **Its checkpoint footprint is small and fully enumerable** (80 floats + one flag),
   which is what makes the plan's "learning that half-persists is worse than either"
   constraint actually satisfiable at S2(d).
4. **It has a real, monotone objective to report** for S2 criterion (c): masked
   prediction loss, measured to fall 5.9× in 300 steps under the feasibility probe.

**Considered and rejected within (c):** attaching the head to the *logits* instead
of the hidden layer, which would let the world-modelling gradient reach `W2`/`b2`
and move the policy more. Measured: policy L2 from own initialization rose only from
0.0070 to 0.0107 — still under the noise floor — while giving up the clean claim
that the verb-preference weights are never touched by the learning signal. Not worth
the trade.

**The cost of the recommendation, stated plainly:** (c) will not show a policy that
has visibly moved. §5.3 quantifies this and §3.4 proposes what to measure instead.

---

## 3. The exact signal, for the recommended candidate

### 3.1 New parameters and state

```
Wp : R[F][H]   prediction head weights   (F = encoder feature count = 8, H = WORLD_HIDDEN_SIZE = 8)
bp : R[F]      prediction head biases    (initialized to zeros)
prev_features : R[F] | null              the previous tick's encoded features
```

`Wp` is initialized with the same `randSmall` draw (`(rng()−0.5)·0.2`) the rest of
the engine uses, from a **derived** stream `mulberry32((seed + 2654435761) >>> 0)`.
The derivation matters: `createWorldMind(seed)` must keep calling
`createNetwork(seed, dims)` with its existing draw order untouched, so that `W1`,
`b1`, `W2`, `b2` for a given construction seed stay byte-identical to what they are
today. Anything else silently invalidates `prove-alive.js`'s reconstruct-and-compare
check and the recorded repair evidence.

### 3.2 Constants

```
WORLD_LEARNING_RATE            = 0.05     // same value as untrained-network.js's LEARNING_RATE,
                                          // declared separately in world-train.js so the two can
                                          // diverge deliberately rather than by accident
WORLD_LOSS_MASK           M    = [4, 6, 7]          // included loss coordinates
WORLD_LOSS_EXCLUDED       E    = [0, 1, 2, 3, 5]    // see §4.1
WORLD_LEARNING_CONTRACT_VERSION = 1
```

No schedule, no decay, no adaptive optimizer, no clipping. If S2 shows the update is
too large or too small, the fix is a new contract version with its own hash — not a
knob that makes old evidence incomparable in silence.

### 3.3 Forward, loss and update

At tick *t*, with `x_t = encodeWorldState(S_t)` and parameters `θ_t = (W1,b1,W2,b2,Wp,bp)`:

```
z_t     = W1·x_t + b1                      hidden pre-activations
h_t     = relu(z_t)
ŷ_t     = Wp·h_t + bp                      the prediction of x_{t+1}          (F-vector)
```

The policy path is unchanged and untouched: `probs_t = softmax(W2·h_t + b2)`.

Loss, one tick later, masked to `M` (|M| = 3):

```
L_t = (1/|M|) · Σ_{j∈M} (ŷ_t[j] − x_{t+1}[j])²
```

Gradient at the head's output — zero on every excluded coordinate, which is what
"excluded from the reward computation" means mechanically:

```
δ_j = (2/|M|) · (ŷ_t[j] − x_{t+1}[j])      for j ∈ M
δ_j = 0                                     for j ∈ E
```

Update rule. This is **gradient descent on a loss**, so the sign is negative — the
one place it deliberately differs from `trainStep`, which ascends on reward
(`untrained-network.js:296-311`). Loop order and the read-then-write convention for
accumulating `dHidden` are transcribed from `trainStep` exactly, so a reviewer can
diff the two side by side:

```
dHidden[j] = 0  for all j
for i in 0..F-1:
    for j in 0..H-1:
        dHidden[j] += Wp[i][j] · δ_i          // pre-update Wp read, then written
        Wp[i][j]   -= η · δ_i · h_t[j]
    bp[i] -= η · δ_i

for j in 0..H-1:
    dPre = dHidden[j] · (z_t[j] > 0 ? 1 : 0)
    for k in 0..F-1:
        W1[j][k] -= η · dPre · x_t[k]
    b1[j] -= η · dPre

// W2 and b2 are not written. Not "left at zero gradient" — not written at all.
```

Learning-rate treatment: `η = WORLD_LEARNING_RATE = 0.05`, a fixed constant applied
identically to every parameter it touches, on every tick, for the whole run. It is
part of `training_config_hash` (§6), so a generation trained at a different rate is
detectable rather than assumed comparable.

### 3.4 Tick order and the lazy-prediction invariant

The update runs at the **top of the world block, before `decideWorld()`**, so no
decision is ever informed by an observation from its own future:

```
world block, tick t:
  1. S_t ← readWorldState()                    (after both hives have acted this tick)
  2. x_t ← encodeWorldState(S_t)               (encoded once)
  3. if prev_features ≠ null:
         re-form ŷ from prev_features under the CURRENT θ, and apply §3.3
         with target = x_t                     ← this is the whole learning step
  4. decision ← decideWorld(worldMind, S_t, worldRng, t)     (uses the updated θ)
  5. applyWorldVerb(...) ; writeWorldState(...)
  6. prev_features ← x_t
```

**Why re-forming the prediction at step 3 is exact rather than an approximation.**
`θ` is mutated at exactly one site, exactly once per tick, at step 3. Between the end
of tick *t−1*'s step 3 and the start of tick *t*'s step 3, no parameter changes.
So re-forming `ŷ(prev_features; θ)` at tick *t* yields bit-identical values to
forming it at tick *t−1* would have. This is what lets the checkpoint carry one
8-vector instead of the stored activations `(z, h, ŷ)` — 8 floats instead of 24.
**S1 must assert the invariant rather than rely on it**: a test that drives the world
block twice and fails if `θ` is written anywhere other than the single update site.

**Skipped world blocks.** `run-live.js:520` guards on `worldStateNow` being truthy.
If the block is skipped, `prev_features` must be set to `null`, not left in place —
otherwise the lag silently stretches to two ticks and the signal becomes something
other than what this memo describes.

### 3.5 What the mind is actually predicting

The transition spanned by one prediction is `[world verb of tick t] + [both hives'
actions of tick t+1]`, because the world block runs after the hive loop. It includes
the consequence of the mind's own action, which is the tightest available loop.

The prediction is **not conditioned on the sampled verb** — `ŷ_t` is a function of
`x_t` only, which is the pre-action state. The mind therefore learns the transition
marginalized over its own policy. This is the design choice that keeps the policy
un-optimized, and it has a consequence that must be stated as a falsifier rather
than discovered later: the sampled verb's residual variance puts a floor under the
loss. **If masked prediction loss does not fall measurably below its tick-0 level in
the S2 run, the signal has failed criterion (c) and the recommendation is wrong.**
Feasibility bracket for that falsifier: 0.0308 → 0.0052 over 300 steps on the repair
fixture (a harsher input stream than a real trajectory, see §5.4).

### 3.6 Proposed S1 divergence from the plan's file list

The plan's S1 entry lists `train-tick.js (call site only)`. `train-tick.js` is
per-hive and never receives the world mind; the world decision lives in
`run-live.js:509-557`. Recommended: `world-train.js` owns the update and exports one
function; **`run-live.js`'s world block** is the call site; `train-tick.js` is not
touched at all. Flagged here rather than silently re-routed at S1.

---

## 4. Mirror-safety contract

### 4.1 Feature coordinates EXCLUDED from the loss

| idx | feature | why excluded |
|---|---|---|
| 0 | total food across `food_sources` | `food_sources` is a mirror feature family (`mirror-detector.js:44`) |
| 1 | `resources.wood` | the gather-yield of `wood_sources` — a family the world mind itself authors |
| 2 | `resources.stone` | the gather-yield of `stone_sources` — likewise |
| 3 | `food_sources` count | direct count of a mirror feature family |
| 5 | territory-tile count | territory is where the harness resolves build placement, i.e. the *other* side of the mirror statistic (`decide()`'s build branch passes `coords: null` and lets the harness place onto owned territory) |

**INCLUDED (M = {4, 6, 7}):**

| idx | feature | why safe |
|---|---|---|
| 4 | hive count | not a feature family and not a build; near-constant at 2 in real runs, so it contributes ≈0 gradient — retained for completeness, not for signal |
| 6 | total pheromone strength | pheromones are not in `featureCoords`' key list and are not builds; rich dynamics (deposit 0.5, decay, hive deposits) make this the substantive learning target |
| 7 | starvation pressure | derived from `hives[*].hive_state.stockpile` — hive-internal, mirror-orthogonal |

**Known, bounded coupling, stated rather than hidden.** Excluded coordinates remain
*inputs*: the `W1` gradient is `η · dPre · x_t[k]` for every `k`, so excluded
coordinates multiply into the update even though they contribute nothing to `δ`.
This is unavoidable for any signal, since the mind must read its world to think about
it. The contract governs **what is optimized, not what is observed**, and §4.3 is
what adjudicates the residual empirically rather than by argument.

### 4.2 Lag structure

One tick, in exactly one direction:

- The prediction formed from `x_t` (state at tick *t*, before tick *t*'s verb is applied)
- is trained against `x_{t+1}` (state at tick *t+1*, after tick *t*'s verb and after tick *t+1*'s hive actions),
- with the weight update applied at the top of tick *t+1*'s world block, **before** tick *t+1*'s decision.

Therefore: **tick *t+1*'s outcome trains the representation that produces tick *t+1*'s
decision and every decision after it, and never a decision before it.** No decision
is ever informed by an observation from its own future. `prev_features` is the only
carrier of this lag, which is precisely why it must be in the checkpoint (§6) — a
mid-learning resume that loses it would skip one update and silently break the A/A′
byte-identity the plan's S2(d) requires.

### 4.3 The designed confound test

**Instrument.** `mirror-detector.js`'s statistic is mean nearest-feature distance
for builds, with a permutation null over build positions on the 10×10 grid;
`p = P(null_mean ≤ observed_mean)`.

**Test.** For each arm (learning run L, frozen control F), take the final world
state and, holding **build positions fixed and feature *count* fixed**, permute the
**feature positions** uniformly over the grid. Recompute mirror-p. Repeat for
K = 200 permutations; report the median and the fraction of permutations reaching a
p at least as small as the unshuffled one.

**The discrimination it makes.** A genuine mirror is a *correspondence* between where
builds are and where features are; it must be destroyed by permuting feature
positions. A **density artifact** — builds look near features because the world mind
saturated the grid with `seed-wood`/`seed-stone` tiles — *survives* permutation,
because on a saturated grid everything is near something regardless of arrangement.

**FAIL RULE (binding).** If the median shuffled p is less than or equal to the
unshuffled p — i.e. mirror-p does not get worse, or gets *better*, once feature
positions are randomized — then the apparent mirror is explained by feature density
and arrangement-independent structure, both of which the world mind's verbs control.
**The signal is confounded and fails.** Equivalently: the mirror claim only stands if
fewer than 5% of position-permutations reach a p as extreme as the observed one.

**Prototype run, so the machinery is not proposed untested.** On the frozen 300-tick
run (14 builds, 46 feature tiles, 41% grid saturation): unshuffled p = 0.264, median
shuffled p = 0.52, fraction at least as extreme = 0.275. The run is null-consistent —
correctly, since nothing there should produce a mirror — and the test discriminates
in the expected direction. Script and output:
`scratchpad/mirror-baseline.js`, `scratchpad/mirror-baseline.json`.

### 4.4 Second, cheaper guard: feature-density parity between arms

Report the feature-tile count and grid saturation at tick 300 for **both** arms. If
they differ materially, mirror comparisons across arms are contaminated regardless of
what §4.3 returns, and that must be said in the evidence bundle rather than left for
a reader to notice.

Measured baseline for the frozen arm: `wood_sources` 20 (**at cap**),
`stone_sources` 20 (**at cap**), `food_sources` 0, plus 6 tiles from other families
— 46 total, 41 distinct cells, 41% saturation. **Both world-authored caps are already
saturated at 300 ticks under a frozen, near-uniform policy.** This partially closes
the density channel at this horizon — a signal that seeds *more* eagerly cannot exceed
the cap, only reach it sooner — but it leaves the channel wide open in the other
direction: a signal that suppresses seeding lands below cap and changes density.
Under the recommended signal neither is optimized, which is the point.

### 4.5 The inverted falsifier

For a mirror-safe signal, a **large** policy displacement is evidence of
contamination, not success. If the S2 run shows the world mind's policy diverging
from its initialization by more than 10× the noise floor under candidate (c), the
correct reading is that something is pushing the verb weights that should not be —
a reward term leaked in, or `W2`/`b2` are being written. That is a failure. Stated
here so it cannot later be reported as a win.

---

## 5. Quantified S2 constants (measured, not asserted)

### 5.1 Initialization-noise floor

**Constant: `INIT_NOISE_FLOOR = 0.012274953713908984`**

- **Definition used:** maximum policy L2 distance between world minds built at
  different fresh seeds, over the repair fixture.
- **Method:** 10 fresh construction seeds — `[1, 2, 3, 7, 11, 101, 1009, 20260805,
  1001004, 999999]`, fixed a priori (the two probe seeds already in the repair
  evidence, the recorded baseline's world construction seed, and seven round values;
  no seed was chosen after seeing a result) — scored against all 1000 states of
  `_dev/state/mind-repair-test/fixture-gen.js` (seed 20260805). All 45 unordered
  seed pairs × 1000 states = **45,000 comparisons**.
- **Distribution:** max 1.2275e-2, p99 9.9787e-3, median 3.7793e-3, mean 4.0504e-3,
  min 1.8386e-4. Argmax at seeds 1/3, fixture state 776.
- **Consistency check against existing evidence:** `liveness-post-repair.json`
  reports `l2_max = 0.004950702123988338` for the single pair (1, 999999). This
  measurement covers 45 pairs and finds a larger extreme, as an extreme-value
  statistic over 45× more pairs should. The two are consistent.
- **Provenance:** `scratchpad/init-noise-floor.js` → `scratchpad/init-noise-floor.json`,
  run 2026-08-05. Read-only on the engine.
- **Derived S2 bar as the plan specifies it:** `(b′) = 10 × floor = 0.12274953713908984`.

### 5.2 Frozen fluctuation band

**Constants: `FROZEN_ENTROPY_MIN = 1.6094361817721468`,
`FROZEN_ENTROPY_MAX = 1.6094374109145348`, band width = 1.2291423880927965e-6**

- **Method:** one 300-tick run of the engine exactly as it stands, into a scratchpad
  sandbox: `node tools/ant-hive-world/run-live.js --ticks 300 --tick-interval-ms 0
  --sandbox-root <scratchpad>/frozen-300 --checkpoint-root <...>/checkpoints
  --root-seed 20260805 --run-name frozenband --arm frozen-band-s0`. Entropy read from
  the 300 `actor:"world"` rows of `decision-stream.jsonl` (the value `decideWorld()`
  computes). Committed generation `gen-300-frozenband`.
- **"Frozen" verified, not assumed:** the committed world-mind parameters are
  byte-identical to a freshly constructed network at the run's recorded construction
  seed 21260808 — checksum `6639724d7021f184…` on both sides. No weights moved, which
  is what makes this a frozen-mind measurement.
- **Context:** mean entropy 1.6094369092307328; ln(5) = 1.6094379124341003; maximum
  departure from ln(5) over the run = **1.7306619535251144e-6**. World verb counts:
  `idle` 68, `seed-stone` 67, `relax-decay` 62, `seed-wood` 52, `signal-food` 51 —
  near-uniform, as a near-uniform policy should be, and the baseline any learning
  claim must depart from.
- **Provenance:** `scratchpad/frozen-band.js` → `scratchpad/frozen-band.json`;
  run log `scratchpad/frozen-300.log`; sandbox `scratchpad/frozen-300/`.
- **Derived S2 bar as the plan specifies it:** `(d′)` = entropy at tick 300 departs
  from ln(5) by more than `3 × band width = 3.6874e-6`.

**Margin warning on (d′), flagged not silently fixed.** The frozen control's *own*
maximum departure from ln(5) is 1.7307e-6, so the bar sits only **2.13×** above the
control's observed excursion. That is thin for a criterion meant to separate learning
from fluctuation. **Recommended strengthening, for the gate to accept or reject:**
use `3 × max frozen departure = 5.1920e-6` instead. The recommended signal clears
either by roughly 100× (§5.3), so this choice does not change the verdict — it
changes how much the verdict is worth.

### 5.3 The measured problem with S2's (b′)

Feasibility probe of the recommended update over 300 steps at η = 0.05:

| candidate | policy L2 from own init (max) | vs (b′) bar 0.1227 | relative parameter displacement ‖Δθ‖/‖θ₀‖ | masked loss |
|---|---|---|---|---|
| **(c) prediction error, hidden head** | **0.00703** | **fails (17× short)** | **0.2146** | 0.0308 → 0.0052 (first/last 50 of 300) |
| (c) prediction error, logits head | 0.01068 | fails | — | 0.0769 → 0.0064 (first/last 10) |
| (a) outcome reward | 0.3471 | passes (2.8×) | 3.147 | n/a |
| (b) homeostasis (level form) | 0.2036 | passes (1.7×) | — | n/a |
| frozen control | 0 (exact) | — | 0 (exact) | — |

**Candidate (c)'s policy displacement of 0.00703 is below the 0.01227 initialization-noise
floor itself** — its whole 300 ticks of learning move the policy less than swapping one
construction seed for another does.

**This is structural, not a horizon or learning-rate problem, and both alternatives
were tested:**

- *Learning rate.* η ∈ {0.05, 0.25, 1.0} × head placement ∈ {hidden, logits} — all six
  cells fail (b′); the largest policy L2 in the sweep is 0.0107. Higher η converges the
  loss faster and therefore moves the trunk *less*, not more.
- *Horizon.* At 3000 ticks, candidate (c)'s policy L2 is 0.00544 and its relative
  parameter displacement is 0.185 — both *below* their 300-tick values. A supervised loss
  is self-limiting: once the head fits, the gradient becomes zero-mean noise and the
  weights stop travelling. Candidate (a) over the same horizon goes the other way,
  0.347 → 0.892, drifting toward policy collapse.

**Root cause.** `createNetwork` initializes `b2` to zeros and draws `W2` from ±0.1, so
the policy is a near-uniform readout of a small-weight trunk. Moving the *representation*
by 21% of its parameter norm moves the *logits* by O(0.01), which softmax barely
registers. The repair evidence already documented this from the other direction: the
weight-scale probe had to multiply weights by 10 to pull mean entropy from 1.6094 to
1.2746. Only a signal that writes `W2`/`b2` directly — i.e. an action-optimizing one —
moves the policy far, and those are exactly the confounded ones.

### 5.4 Proposed replacement for (b′), calibrated by measurement

This is the memo's one request for a plan amendment, surfaced to
`G-LEARNING-SIGNAL-DESIGN` rather than taken silently.

> **(b″) — parameter-space displacement.** Relative parameter displacement
> `‖θ_300 − θ_0‖₂ / ‖θ_0‖₂` over `(W1, b1, W2, b2)` must exceed **0.05** (5% of the
> initial parameter norm), against a frozen control measured at exactly **0**
> (byte-identical checksums, §5.2).
>
> **(b‴) — policy-space displacement becomes a reported diagnostic with an inverted
> bound.** Report policy L2 from own initialization. For a mirror-safe signal it is
> *expected to sit at or below* the initialization-noise floor. Exceeding 10× the
> floor is a **contamination alarm** (§4.5), not a pass.

Calibration: the recommended signal measured 0.2146 at 300 ticks and 0.185 at 3000,
so the 0.05 bar carries roughly a 4× margin and is not tuned to just-pass. Candidate
(a) would measure 3.147 — the bar separates "learning happened" from "nothing moved"
without pretending to separate (c) from (a), which is the honest scope of a
displacement metric.

**The falsifier for the whole recommendation** remains §3.5's: if masked prediction
loss does not fall in the S2 run, (c) is not learning and the memo is wrong,
regardless of how far the parameters travelled.

### 5.5 Caveat on §5.3–5.4, stated up front

The engine does not persist a per-tick world-feature trajectory, so the feasibility
and comparison probes drive the update with the repair fixture's **IID** states
rather than a real trajectory. These are order-of-magnitude design brackets, not S2
evidence. Two brackets were run to fence the real case — a high-variance one (target =
next IID state, a transition larger than any real one-tick step) and a zero-change one
(target = the current state, a perfectly static world). They agree to within 16% on
policy displacement (0.00703 vs 0.00818) and both fail (b′), which is why the
conclusion is reported as robust rather than as a point estimate. **S2 must re-measure
all of it on the real run.** Scripts: `scratchpad/signal-c-feasibility.js`,
`scratchpad/signal-c-variants.js`, `scratchpad/signal-ab-magnitude.js`,
`scratchpad/param-displacement.js`, with `.json` outputs alongside.

---

## 6. Checkpoint impact: what `CheckpointManifest/1.1`'s two hashes must cover

Today `architectureDescriptor()` (`checkpoint.js:176-215`) mixes shape with training
configuration — it hashes `hive.learning_rate` alongside `world_mind.input_size` — and
`validateGeneration` refuses on any mismatch of the single hash
(`checkpoint.js:670-672`). That is the conflation MAJOR 1 identifies, and this signal
makes it bite: adding a prediction head is a shape change (must refuse), while
changing the loss mask or the learning rate is a comparability change (must warn).

**`shape_hash` — mismatch ⇒ VERSION-stage refusal.** Everything whose mismatch makes a
restore *silent corruption*:

- hive `input_size` / `hidden_size` / `output_size`
- world mind `input_size` (the live probe of `encodeWorldState`), `hidden_size`, `output_size`
- `ACTUAL_WORLD_MIND_SHAPE` (`w1_rows`, `w1_cols`, `w2_rows`, `w2_cols`, `matches_declared`)
- **NEW:** prediction-head dims — `wp_rows` (= encoder feature count), `wp_cols` (= hidden size), `bp_length`
- **NEW:** `prev_features` arity (= encoder feature count), so a resize of the encoder cannot restore a stale-width lag vector
- verb orders: `hive_verb_order`, `harness_verbs`, `world_verb_order` (position *is* meaning)

**`training_config_hash` — mismatch ⇒ WARN in provenance, never refusal.** Everything
that changes what the numbers *mean* without breaking the restore:

- `WORLD_LEARNING_RATE` (0.05)
- `WORLD_LEARNING_CONTRACT_VERSION` (1)
- loss form identifier (`masked-mse-onestep`) and the **loss mask `M` as an explicit sorted index list** — the mask belongs here, not in `shape_hash`, because changing it restores fine and trains differently
- lag convention identifier (`prev-input-t, target-t+1, update-before-decide`)
- prediction-head seed-derivation constant (2654435761) — affects reproduction of a *fresh* mind and therefore `prove-alive.js`'s reconstruct-and-compare, not a restore
- existing hive-side `learning_rate` and both `resource_norm_k` values, moved out of the shape hash

**The WARN must be load-bearing, not decorative.** An evidence summarizer that pools
generations across differing `training_config_hash` values is pooling incomparable
series. `train-tick.js:50-54` already establishes this discipline for
`reward_contract_version` ("any summarizer pooling rows must reject mixed or missing
versions"); the same rule must bind here, and S2's evidence bundle should record the
hash per generation so it is checkable.

**1.0 fallback.** A `CheckpointManifest/1.0` manifest has no split. `shape_hash` falls
back to the legacy `architecture.hash`; `training_config_hash` is **absent, and must be
reported as `UNKNOWN` with a WARN** — never treated as matching. "No value" and "same
value" are different facts and collapsing them is the kind of quiet lie the whole
checkpoint design exists to prevent.

**Expected and intended breakage.** Adding the prediction head changes `shape_hash`, so
every generation committed before S1 — including `gen-300-frozenband` from this memo's
own measurement — will fail the VERSION stage with a shape mismatch. That is the design
working, exactly as the network repair's invalidation was. It should be stated in the
S1 change note rather than discovered by a resume.

**`state-inventory.md` dated addition (S1).** Three new entries under the world mind:
`world_mind.prediction_head.Wp` (8×8 doubles), `world_mind.prediction_head.bp` (8
doubles), `world_mind.learning_state.prev_features` (8 doubles or `null`). Owner:
`serializeWorldMind`/`restoreWorldMind` — the world mind owns the definition of what
its state is, which `checkpoint.js:494-497` already anticipates in a comment ("a future
world-level optimizer accumulator should have exactly one place to be added").
**No optimizer accumulators and no RNG additions**: the update consumes zero random
draws, so the `world` stream's checkpointed state is unaffected.

---

## 7. Open questions for the gate

1. **Accept the (b″)/(b‴) replacement for S2's (b′)?** The alternative is to accept a
   policy-optimizing signal and give up mirror-gate cleanliness for this generation.
   Recommended: accept the replacement; the mirror gate is the experiment's whole point.
2. **Accept the strengthened (d′)** (3 × max frozen departure = 5.1920e-6 rather than
   3 × band width = 3.6874e-6)? Does not change the verdict; improves its worth.
3. **Accept the S1 call-site relocation** from `train-tick.js` to `run-live.js`'s world
   block (§3.6)?
4. **Is the exclusion of feature 5 (territory count) too conservative?** It costs a
   learnable target; it buys severance from the build-placement side of the mirror
   statistic. Recommended: keep it excluded — mirror-safe wins ties.
