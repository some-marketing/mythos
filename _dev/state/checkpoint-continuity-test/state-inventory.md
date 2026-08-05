# ant-hive-world state inventory (S1 first deliverable)

Plan: `ant-world-checkpoint-loader`, step S1 (codex r1 MAJOR 1).
Produced: 2026-08-05, by mechanical audit of `tools/ant-hive-world/*.js`.
Method: `grep -n "rng()\|rng ||\|mulberry32(\|createNetwork(\|Math.random\|Date.now()\|new Date()\|randomUUID"` across
`tools/ant-hive-world/*.js`, plus a read of every module-level binding in each
file that `run-live.js` transitively loads. `dashboard.js`, `mirror-detector.js`,
`llm-decide.js`, `train-tick.js`'s CLI path, `world-mind-harness.cjs`,
`lore-engine/`, `embodiment*/` and `unreal-export/` are excluded and justified in
section 5 — they are not loaded by the live turn driver.

The audit answers three questions per item: (1) is it mutable state that
survives a tick, (2) does it feed a decision or an RNG draw, (3) is it in the
checkpoint. Anything answering yes/yes/no is a determinism hole.

---

## 1. RNG streams — every consumer, by file:line

The engine has exactly one PRNG algorithm, `mulberry32`
(`untrained-network.js:75-83`): a single 32-bit integer of state (`a`) held in a
closure, advanced by `a = (a + 0x6d2b79f5) | 0` per draw. The closure variable is
not readable from outside, which is precisely why the checkpoint cannot capture
it as written — see section 6.

`run-live.js` constructs **six** RNG-bearing objects. Three are *consumed to
exhaustion at construction* (network weight init) and three are *live streams*
that advance every tick.

### 1.1 Live streams (state advances per tick — MUST be serialized)

| Stream | Constructed | Seed expression | Consumers (file:line) |
|---|---|---|---|
| `rngs['hive-a']` | `run-live.js:114` | `mulberry32((seedA + 12345) >>> 0)` | see table 1.2 |
| `rngs['hive-b']` | `run-live.js:115` | `mulberry32((seedB + 12345) >>> 0)` | see table 1.2 |
| `worldRng` | `run-live.js:125` | `mulberry32((seedW + 12345) >>> 0)` | see table 1.3 |

**Table 1.2 — draws taken from a hive's stream, in the order they occur in one
`trainTick` call** (`train-tick.js:211-241`; the same `rng` object is threaded
into both the decision and the environmental phase, so the two share one stream):

| # | Site | file:line | What the draw decides |
|---|---|---|---|
| 1 | `decide()` action sample | `untrained-network.js:192` (`const r = (rng \|\| Math.random)()`) | which of the 5 verbs is sampled (or, when forced exploration fires, the uniform index at `:200`) |
| 2 | `chooseForageTile()` trail-follow draw | `untrained-network.js:169` (`const draw = rng()`) | exploit the strongest trail vs. explore — reached only for `gather-food`/`gather-wood` (`:215`, `:219`) |
| 3 | `chooseForageTile()` explore tile | `untrained-network.js:172` (`tile-${Math.floor(rng() * 100)}`) | which fresh tile a non-trail-following forage lands on — reached only when draw #2 explores |
| 4 | `claim-territory` tile | `untrained-network.js:223` (`Math.floor((rng \|\| Math.random)() * 100)`) | which tile is claimed — reached only for `claim-territory` |
| 5 | `maybeSpawnFoodSource` spawn roll | `world-state.js:294` (`if (rng() >= chance) return state`) | whether a new food patch spawns this tick |
| 6 | `maybeSpawnFoodSource` tile | `world-state.js:295` (`tile-${Math.floor(rng() * 100)}`) | where it spawns — reached only if #5 passed |
| 7 | `applyMaterialDynamics` spawn roll | `world-state.js:418` (`rng() < spawnChance`) | per material in `['clay','water','ore','fiber']` — 4 draws per tick |
| 8 | `applyMaterialDynamics` tile | `world-state.js:419` (`${key}-tile-${Math.floor(rng() * 100)}`) | where — reached only when the matching #7 passed |

`applyEcosystemDynamics` (`world-state.js:336`) takes an `rng` parameter and
**never draws from it** (verified: no `rng(` inside `:336-397`). Recorded so a
reviewer does not have to re-derive it; it means the per-tick draw count is
variable (branch-dependent), which is why a *counter* alone cannot reconstruct
the stream — the full PRNG state must be stored, not a draw count.

**Table 1.3 — draws taken from `worldRng`, per tick** (`run-live.js:196-221`):

| # | Site | file:line | What the draw decides |
|---|---|---|---|
| 1 | `decideWorld` verb sample | `world-mind.js:111` (`let r = rng()`) | which of the 5 world verbs — **skipped entirely** when an operator-console packet is present (`run-live.js:201-205`), which is why S3 forbids console packets |
| 2 | `applyWorldVerb` placement | `world-mind.js:134` / `:142` / `:148` (`Math.floor(rng() * 100)`) | tile for `seed-wood` / `seed-stone` / `signal-food`; `relax-decay` and `idle` draw nothing |

### 1.3 Construction-only RNG (consumed at t=0 — NOT serialized, by design)

| Stream | file:line | Draws | Why it need not be serialized |
|---|---|---|---|
| `createNetwork(seedA)` internal rng | `untrained-network.js:94`, called from `run-live.js:106` | `HIDDEN_SIZE*INPUT_SIZE + OUTPUT_SIZE*HIDDEN_SIZE` = 72+40 = 112 | the *output* (W1/W2) is serialized directly; the generator is never touched again |
| `createNetwork(seedB)` internal rng | `run-live.js:107` | 112 | same |
| `createWorldMind(seedW)` internal rng | `world-mind.js:100` -> `untrained-network.js:94`, called from `run-live.js:124` | 112 | same |

The root seeds are still recorded in the manifest for provenance and replay.

### 1.4 `Math.random` fallbacks — reachable? (determinism escape hatches)

| Site | file:line | Reachable from the live driver? |
|---|---|---|
| `decide()` `rng \|\| Math.random` | `untrained-network.js:192`, `:211`, `:223` | **No** — `train-tick.js:214` always passes a stream. |
| `harness.tick()` `rng = Math.random` default | `harness.js:109` | **No** — `train-tick.js:217` always passes `rng`. |
| `createNetwork()` `Date.now() ^ Math.random()` | `untrained-network.js:94` | **No** — `run-live.js` always passes an explicit seed. |
| `mirror-detector.js:96` | `mirror-detector.js:96` | **No** — not imported by `run-live.js` or anything it loads. |

Conclusion: with the seeding change in section 3, the live driver has **no**
reachable `Math.random` call. This is a falsifiable claim — see the seed-sweep
evidence in `continuity-evidence.json`.

---

## 2. Mutable in-process state (survives a tick, lives only in RAM)

| # | State | Owner (file:line) | Shape | Feeds decisions? | In checkpoint |
|---|---|---|---|---|---|
| 1 | `networks['hive-a']` | `run-live.js:106` | `{W1[8][9], b1[8], W2[5][8], b2[5]}` | yes — `forward()` at `untrained-network.js:120` | `mind.hives['hive-a'].network` |
| 2 | `networks['hive-b']` | `run-live.js:107` | same | yes | `mind.hives['hive-b'].network` |
| 3 | `worldMind` | `run-live.js:124` | `{W1[8][8], b1[8], W2[5][8], b2[5]}` — see correction note below | yes — `world-mind.js:108` | `mind.world_mind.network` |
| 4 | `controllers['hive-a']` | `run-live.js:135` | `{active: bool, prev_post_update_entropy: number\|undefined}` | yes — `train-tick.js:168-187` sets the effective entropy-bonus weight, which changes the gradient, which changes the next policy | `mind.hives['hive-a'].controller` |
| 5 | `controllers['hive-b']` | `run-live.js:136` | same | yes | `mind.hives['hive-b'].controller` |
| 6 | round counter `i` | `run-live.js:156` | int | **yes** — threaded as `tickIndex` into `computeEntropyBonusWeight` (`train-tick.js:97-107`) and forced exploration (`untrained-network.js:194-196`) | `identity.absolute_tick` |
| 7 | `stopRequested` | `run-live.js:65` | bool | no (loop control only) | no — deliberately transient |
| 8 | `hive.nextEventTick` | `harness.js:73`, incremented `:111` | int | no (log labelling only) | recorded in `identity.hives[].next_event_tick` for completeness |
| 9 | `EVENT_CONTEXT` | `run-live.js:59` | `{run_id, episode_id, arm_id}` | **no** — verified in section 4 | `identity.event_context` (provenance only) |
| 10 | `liveConfig` (per round) | `run-live.js:161` | object | yes — every threshold | `world.live_config` (snapshot; the file is authoritative on resume) |

**CORRECTION 2026-08-05 (plan `ant-world-mind-network-repair`, S2).** Row 3's
shape was WRONG when this inventory was written, and the original text is left
in place above rather than silently edited so that anyone reading an artifact
that cites it can see what it said.

Row 3 recorded the world mind as `{W1[8][8], ...}`. That was the shape the
constants in `world-mind.js` *declared*. The shape the engine actually *built*
was `{W1[8][9], ...}`: `createWorldMind()` called `createNetwork()` with no
dimensions and inherited the hive network's `INPUT_SIZE = 9`, while
`encodeWorldState()` emitted 8 features. The audit read the declaration and did
not probe the construction — which is precisely how the defect stayed invisible
for as long as it did.

| | pre-repair (as built) | post-repair (as built) |
|---|---|---|
| world mind `W1` | `[8][9]` | `[8][8]` |
| `matches_declared` | `false` | `true` |
| architecture hash | `359184320348f765…` | `c32c9232429a7cdd…` |

Post-repair the declared and actual shapes agree, so row 3's `{W1[8][8], ...}`
is now correct as written — but it was not correct on the date this document
claims, and the r6/r7 baselines plus the checkpoint-loader evidence were all
recorded while the built shape was `[8][9]`.

Consequence for this document's own subject matter: the architecture hash
changed, so every generation committed before 2026-08-05 now refuses to resume
with `resume-failed-halt:version:architecture-hash-mismatch`. That is the
forward-compatibility design working as intended, not a regression. Evidence:
`_dev/state/mind-repair-test/mind-repair-evidence.json`.

**Module-level mutable state: none.** Every module-level binding in
`harness.js` (`VERBS:44`, `BUILD_COST:54`, `PHEROMONE_DEPOSIT:63`),
`untrained-network.js` (`INPUT_SIZE:37`..`UPKEEP_COST:71`),
`world-state.js` (`MATERIAL_SOURCE_TYPES:100`, `INITIAL_MATERIAL_SOURCE_COUNTS:101`,
`INITIAL_MATERIAL_SOURCE_AMOUNTS:102`, the `DEFAULT_*` rate constants),
`live-config.js` (`DEFAULT_CONFIG:17`), `world-mind.js` (`WORLD_*:39-58`) and
`train-tick.js` (`REWARD_CONTRACT_VERSION:66`) is a frozen-by-convention
constant, never assigned after load. The single exception is
`event-schema.js:23`'s `processEventContext`, which is created once at module
load from `crypto.randomUUID()` and is `Object.freeze`d — it is identity, not
behavior, and `run-live.js:59-63` overrides it with its own `EVENT_CONTEXT`
anyway.

This is the reason the checkpoint can be a pure data structure: there is no
hidden singleton to rehydrate.

---

## 3. Time-derived and non-reproducible inputs (S3 frozen-input requirement)

| # | Site | file:line | Feeds behavior? | Disposition |
|---|---|---|---|---|
| 1 | `const baseSeed = Date.now()` | `run-live.js:101` (pre-change) | **YES** — seeds `seedA`, `seedB` (`:102-103`) and `seedW` (`:123`), i.e. all three network inits and all three live streams | **ELIMINATED** — replaced by an explicit root seed from `--root-seed` / `ROOT_SEED` in `job.env`, defaulting to `crypto.randomInt` (not wall-clock) and always recorded in provenance. |
| 2 | `new Date().toISOString()` in `generateBlankHiveSeed` call | `run-live.js:81` | no — lands in `hive-state.json` `provenance.when`, read by nothing | left as-is; carried verbatim through the checkpoint so a restored hive keeps its genesis stamp |
| 3 | `new Date().toISOString()` run-log `ts` | `run-live.js:152` | no | left as-is; **excluded from the decision stream** |
| 4 | `new Date().toISOString()` audit `ts` | `harness.js:79` | no | left as-is |
| 5 | `at: new Date().toISOString()` in geometry entries | `harness.js:181` | no — `encodeState` counts geometry entries (`untrained-network.js:145`), never reads `at` | left as-is; means a resumed world-state file is **not** byte-identical to an uninterrupted one even when behavior is. Enumerated divergence, see S3 verdict. |
| 6 | `written_at` | `world-state.js:163` | no | same as #5 |
| 7 | `crypto.randomUUID()` run/episode id | `event-schema.js:17-18` | no — see section 4 | new ids per process; parent ids recorded in the manifest for lineage |
| 8 | `world-mind-decision.json` operator packet | `run-live.js:201` | **YES** — bypasses `decideWorld` and its RNG draw entirely | S3 arms run with **no** console packet present; absence asserted per-arm in the evidence file |
| 9 | `seq` write counter | `world-state.js:162` (`seq: (state.seq \|\| 0) + 1`) | no — produced only; grep shows no consumer in the tick path (`dashboard.js` is the sole reader, and no arm runs it) | serialized inside `world_state`. A resume performs one genuine extra write when it materialises the checkpointed world into the sandbox, so a resumed lineage's `seq` runs exactly one ahead per resume. Enumerated in `continuity-evidence.json` -> `divergence_enumeration`, not suppressed: the counter is still accurate about the thing it counts. |

---

## 4. Explicit non-dependence check: identity must not feed RNG or decisions

Plan S3 clause (c) requires proving run/episode identity feeds provenance only.
Mechanical check: `run_id`, `episode_id`, `arm_id` are produced at
`event-schema.js:15-21` and consumed at exactly three sites —
`event-schema.js:26` (`tickKey`, a log string), `event-schema.js:40-44`
(`decorateEvent`, log row decoration), and `run-live.js:147` (a stdout banner).
`decorateEvent` is called from `harness.js:79`, `harness.js:180` and
`run-live.js:151` — all three append to a log or to `geometry_log`. The
`geometry_log` case is the only one that lands in world state; `encodeState`
(`untrained-network.js:139-159`) reads `geometry_log` only via
`.filter((g) => g.hive === hiveState.identity).length`, i.e. the count, never
`run_id`/`episode_id`/`tick_key`. **Verified: no identity field reaches a
network input, a reward, or an RNG seed.**

The falsifier for this claim is arm C in S3: arms A and C differ only in
per-stream seed assignment, and every arm is given a different `run_id`
(uuid, fresh per process) — if identity leaked into behavior, replicate pairs
within one arm would not reproduce each other. They do.

---

## 5. Excluded modules and why

| Module | Reason |
|---|---|
| `dashboard.js` | separate process, read-only over the sandbox, never started by S3 arms |
| `mirror-detector.js` | analysis tool; uses `Math.random` at `:96` but is not imported by `run-live.js` (verified: no `require` of it in the driver's transitive set) |
| `llm-decide.js` | superseded by `untrained-network.js`; not imported by `run-live.js` |
| `world-mind-harness.cjs` | host-side LLM harness; its only channel into the sim is `world-mind-decision.json`, covered by row 3.8 |
| `lore-engine/`, `embodiment/`, `embodiment-bridge/`, `unreal-export/` | downstream consumers of run outputs; not in the tick path |
| `train-tick.js` CLI path | none exists; the file exports only |
| `validate-hive-mind.js`, `generate-blank-hive-seed.js` CLI paths | `generate-blank-hive-seed.js` is imported for its pure function only (`run-live.js:35`) |

Transitive require set of `run-live.js`, confirmed by reading each `require` at
the top of each file: `harness.js`, `generate-blank-hive-seed.js`,
`untrained-network.js`, `world-mind.js`, `world-state.js`, `train-tick.js`,
`live-config.js`, `event-schema.js`, and (added by this plan) `checkpoint.js`.

---

## 6. Determinism holes this inventory found, and what closes each

| Hole | Consequence if unclosed | Closure |
|---|---|---|
| **H1.** `mulberry32`'s state is a closure variable with no accessor (`untrained-network.js:75-83`) | the three live streams cannot be captured; a resumed run re-draws from a fresh stream and diverges immediately | `checkpoint.js` ships `createSerializableRng(seed)` — the *same* recurrence, byte-for-byte, with `getState()`/`setState()`. `run-live.js` uses it for the three live streams. `untrained-network.js` is **not** modified (it is outside this plan's write set), and an equality assertion (`assertRngParity`) proves the two generators emit identical sequences. |
| **H2.** wall-clock root seed (`run-live.js:101`) | no arm is reproducible; A' cannot be given "A's exact seeds" | explicit root seed, section 3 row 1 |
| **H3.** variable per-tick draw count (branch-dependent, section 1.2) | a draw *counter* would not reconstruct the stream | full PRNG state is stored, not a counter |
| **H4.** controller hysteresis state (`{active, prev_post_update_entropy}`) is per-hive RAM only | a resumed hive would restart with the controller disengaged and `prev` undefined, changing the effective entropy-bonus weight on the very first resumed tick | serialized, rows 2.4/2.5 |
| **H5.** `tickIndex` restarting at 0 on resume | forced exploration (`i % 75`) and the entropy decay schedule would restart, so the resumed run would not continue the same schedule | the loop runs on an **absolute** tick index restored from `identity.absolute_tick` |
| **H6.** world state, hive states and live config live on disk in the sandbox, not in the process | resuming into a fresh sandbox would reset the world | full contents serialized into the generation and rewritten on restore |
| **H7.** append-only logs would double-append on resume into a reused sandbox | corrupt evidence | byte-length log cursors recorded per file; restore truncates to the cursor when the file is longer |
| **H8.** the world mind's declared and actual parameter shapes disagree | see below — this is a PRE-EXISTING engine defect, not a checkpoint hole | the checkpoint serializes the parameters in full anyway, and hashes BOTH shapes into the architecture descriptor |

### H8 in full: the world mind's weights are currently inert

Found while building the restore path's shape check, then confirmed by direct
probe (`createWorldMind(12345)`, `encodeWorldState`, `forward`):

- `world-mind.js:39-40` declares `WORLD_INPUT_SIZE = 8`, `WORLD_HIDDEN_SIZE = 8`.
- `world-mind.js:100`'s `createWorldMind` delegates to `untrained-network.js:93`'s
  `createNetwork`, which builds `W1` at the HIVE network's dimensions:
  measured `W1 = [8][9]`, because `INPUT_SIZE = 9`.
- `encodeWorldState` (`world-mind.js:87-96`) returns 8 features.
- `forward` (`untrained-network.js:122`) therefore reads `input[8] === undefined`;
  every `hiddenPre` entry is `NaN`; `relu(NaN)` returns 0 (`NaN > 0` is false);
  `logits` collapse to `b2`, which `createNetwork` zero-initializes.
- Measured result: `probs === [0.2, 0.2, 0.2, 0.2, 0.2]` for every seed and every
  world state. Two world minds seeded 1 and 999999 produce identical policies.

So the world mind is presently a uniform random verb sampler: its weights are
inert and its observations are unread. This is consistent with the r6 baseline
(world verbs 600/570/594/591/645 over 3000 ticks — uniform to within sampling
noise) and with this slice's arms (see `behaviour_shape` in the evidence file).

**Not fixed here, deliberately.** It predates this plan, and repairing it would
change fresh-run behavior, which this plan's constraints require be reported
rather than papered over. The checkpoint still serializes the parameters in
full — they are real state, and a checkpoint that dropped them would silently
become lossy the moment the defect is repaired — and `architecture.hash` covers
both the declared and the actual shape, so a future repair correctly invalidates
old checkpoints instead of loading weights into a re-shaped network.

**Consequence for this slice's continuity claim:** the world mind contributes to
continuity only through its RNG stream today, not through its weights. Arms A
and A-PRIME therefore test world-mind continuity at the stream level. If the
defect is repaired, the weight-level path is already carried and the same arms
re-run unchanged would test it.

---

## 7. Serialization coverage map (inventory item -> manifest field)

Every row in sections 1.1, 2 and 6 maps to exactly one field:

```
mind.json     hives[id].network            <- 2.1, 2.2
              hives[id].controller         <- 2.4, 2.5   (H4)
              world_mind.network           <- 2.3
rng.json      streams[id].state            <- 1.1        (H1, H3)
              streams[id].seed             <- provenance
              construction_seeds           <- 1.3
world.json    world_state                  <- H6
              hives[id].hive_state         <- H6
              live_config                  <- 2.10
              log_cursors                  <- H7
identity.json absolute_tick / absolute_day <- 2.6        (H5)
              run/episode/turn/parent ids  <- 2.9
              root_seed + derivation       <- H2
              architecture_hash            <- config/arch integrity
              next_event_tick              <- 2.8
manifest.json per-file sha256 + lineage    <- commit token
```

No inventory row is unmapped. The falsifier for that claim is the
save -> load -> save byte-identity test (S1) plus arm A vs. A' (S3): any state
that is read but not carried shows up as a decision-stream divergence at the
resume boundary.
