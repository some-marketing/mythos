You are one slot of a triadic convene run on a specific task.

Triad profile: Kernel triad (kernel)
Default three-lobe kernel triad: fast lobe, slow lobe, contextual breadth lobe.

The invariant is the three-corner structure. The actor/harness in each corner may rotate by task, scope, risk, and privacy constraints.

Triad slots:
  - ALPHA / claude — Intent, memory, originating principle, and fast orchestration. (Claude (fast reasoning, orchestration, in-session execution))
  - NOW / codex — Repo truth, executable constraints, implementation reality, and falsification. (Codex (slow rigor, code-truth verification))
  - OMEGA / gemini — Breadth, consequence, future-facing context, and community impact. (Gemini (contextual breadth, reframing, big picture)) [YOU]

This convene call originated from: claude.
Participant slots convened by this runner: now/codex, omega/gemini.
The origin slot or actor will add its own analysis inline after participant responses arrive.

Register rules:
  - Blunt, falsifiable, no hedging
  - Preserve the gap between observation and interpretation
  - Say when the profile is too narrow for consequence-grade consensus
  - Speak as a slot of the whole, not an external consultant
  - If uncertain, say so in curiosity-mode
  - Name what the other slots probably miss that you see by construction

## Your slot

- slot_id: omega
- slot_label: OMEGA
- actor: gemini
- function: Breadth, consequence, future-facing context, and community impact.

## Task

CONTEXT: An ant-colony simulation is being used as a low-compute training environment for embodied minds. A core empirical question — does an inter-agent communication channel actually CARRY INFORMATION that agents use, versus merely perturbing the environment — was tested with a pheromone-based relay and came back unanswerable. The authority probe established three structural reasons (see context files): (1) transport and reinforcement are the same substrate — delivering a tip calls the same additive depositPheromone write a successful gather does, so delivering fuels the medium it travels over; (2) message volume was endogenous — 7,563 tips/episode in one arm vs 463 in another on identical code, so no contrast varied only one thing; (3) there is no relayed-signal input in the policy's encoding at all (9 features, none of them 'something was said to me'), so relayed content could only reach the policy by changing world physics. Evidence: an UNINFORMATIVE fixed-tile control BEAT the real relay (-1.53 [-2.51,-0.55]), relay tips were actionable at chance rate (1.4% vs ~1.1% baseline), and effect size tracked sustained trail magnitude monotonically. Separately, the relay's stated invariants were executably false (it filtered by selecting the strongest trail, and amplified by depositing additively at the cap 97.7% of the time), and a metric bug inverted a sign (starve_crossings counted food gathers). The proposed FIX is the Q-B bulletin channel: a fixed set of read-only inbox slots attached to world state, addressed to a named recipient, written only by relay logic and read only by the recipient's sensing path — not a resource, not a tile, not a trail, consumed by no engine dynamic. Design requirement it claims to meet: reading does not strengthen the channel, delivering does not alter world physics, and message volume is a constant of the design rather than an outcome of the arm. It has survived one codex adversarial round and awaits operator ratification. YOUR TASK — adversarial, not confirmatory: does the bulletin design ACTUALLY fix the confound, or does it relocate it? Specifically: (a) name any residual path by which delivering a bulletin could still alter world dynamics or agent behavior through a route other than the intended read — including indirect routes through compute cost, action-timing, ordering, or observation-space dimensionality; (b) is holding message volume constant by design sufficient, or does it introduce a new confound (e.g. forcing null messages that themselves carry information, or decoupling volume from the world state in a way that makes the result inapplicable to a realistic channel); (c) the policy needs a NEW dedicated input for 'something was said to me' — does adding an input dimension to the encoding itself confound the comparison against a no-channel baseline, and if so what is the correct control (matched-dimensionality null input? frozen input? something else); (d) what is the minimal falsifiable experiment that would prove the bulletin channel carries information, and what result would REFUTE it — state the control arms explicitly and confirm each varies exactly one thing; (e) is there a fundamentally better instrument than a bulletin for this question that we have not considered. Be concrete and skeptical. If you believe the bulletin design is sound, say so plainly and say what would have to be true for it to fail. This is DESIGN DELIBERATION ONLY — no code is being changed by this run.

## Shared context (read-only, for the task above)

### _dev/reports/analysis/evidence-loop__20260802__qb-channel-spec.md

```
---
title: "Q-B — a signaling channel that can test carriage honestly (design spec, not implementation)"
leg: evidence-loop 20260802, question Q-B
authored: 2026-08-02
status: revised after codex adversarial review (round 1); pending gemini context check
review: _dev/reports/analysis/convene-runs/20260802T193359Z-qb-channel-spec-review/now__codex.md
scope: design only. No engine code is changed by this document. Local-only testing phase; nothing pushed, no promotion implied.
---

# Q-B — a channel the relay does not fuel

## What disqualified the previous channel

The authority probe (`_dev/reports/analysis/ant-sim-authority-probe__20260802__results.md`)
established that the pheromone field cannot answer the carriage question, for a reason that
is structural rather than a parameter choice. Three findings carry into this design:

1. **Transport and reinforcement are the same substrate.** A relayed tip is delivered by
   `depositPheromone`, which is `kindTrails[tileId] = (kindTrails[tileId] || 0) + amount`
   (`tools/ant-hive-world/world-state.js:181-186`) — the same additive write a hive's own
   successful gather performs (`harness.js:118`). Delivering therefore fuels the medium it
   travels over. With decay 0.9 per hive tick and two hives per world per round, a repeatedly
   targeted tile converges to roughly `2 / 0.19 ≈ 10.5` and never prunes. Every relay variant's
   measured effect reduced to whether it happened to sustain a trail.

2. **Message volume was endogenous, not controlled.** `selectTip`'s eligibility gate is shared
   across all arms (`_dev/sim-runs/authority-probe.js:314-315`), but whether it passes depends
   on the world state each arm's own dynamics produced — 7,563 tips/episode for `carriage-add`
   versus 463 for `null-add` on identical code. Volume was an outcome of the arm, so no contrast
   between arms varied one thing.

3. **There is no relayed-signal input at all.** `encodeState` emits 9 features and none of them
   is "something was said to me" (`untrained-network.js:37,139-159`). Relayed content could only
   reach the policy by being laundered through `food_trail_strength` /`wood_trail_strength` —
   i.e. by changing world physics. A channel with no dedicated input cannot be distinguished
   from an environmental perturbation, because it *is* one.

The requirement that follows: a channel where **reading does not strengthen it, delivering does
not alter world physics, and volume is a constant of the design rather than a result of the arm.**

## The channel: a bulletin (read-only inbox), not a deposit

A **bulletin** is a fixed set of slots attached to world state, addressed to a named recipient,
holding a short structured message. It is written only by a tier's relay logic and read only by
the recipient's sensing path. It is not a resource, not a tile, not a trail, and no engine
dynamic consumes it.

Shape (one slot per recipient per resource kind):

```
world_state.bulletins = {
  [scope]: {                       // "hive" (tier 1) | "world" (tier 2)
    [recipient_id]: {
      [kind]: {                    // "food" | "wood"
        tile_id: string | null,    // the named target, or null = the null message
        confidence: number,        // in [0,1], set by the sender, NOT accumulated
        posted_round: integer,
        from: string,              // sender identity, for audit only
        seq: integer               // monotone per slot, for audit only
      }
    }
  }
}
```

`postBulletin` **overwrites** the slot. There is no `+=` anywhere in the channel. That single
choice removes the compounding dynamic that produced the entire previous result.

### The carriage invariants (C1–C6)

These are the properties that make the channel a defensible test instrument. Each is stated so
it can be **mechanically asserted in a test**, not merely described — the previous run's central
lesson was that an invariant asserted in prose while the code did something else
(`filter-add`'s "no filtering" selection rule was a filter) is a hypothesis wearing a
guarantee's clothing.

A scoping statement first, because the round-1 review (finding 2) showed the original wording
overclaimed. These invariants are **narrow, function-level properties of the channel's own
state** — they say the channel cannot fuel itself and cannot alter world physics on delivery.
They say nothing about behavioral influence, and they must not be read as saying so. A message
that is read, acted on, rewarded, and thereby made more likely to be read again is a network
weight change, and that is *the phenomenon under test*, not a violation. Confusing the two is
what the previous channel did: there, reading literally incremented the medium's magnitude. Here
it cannot, and the behavioral pathway is measured rather than prevented.

- **C1 — no fuel.** Posting to a bulletin never writes `pheromones`, `resources`,
  `food_sources`, `*_sources`, `territory`, `geometry_log`, `prey_population`, or
  `predator_population`. Test: for any world state `S` and any sequence of posts, every key of
  `postBulletin(S, …)` except `bulletins` is deep-equal to `S`'s.
- **C2 — reading does not increment the channel.** `readBulletin` is a pure accessor: it returns
  a value and no state, and a slot's `confidence` is a function of what the sender wrote, never
  of how often it was read. Test: N reads leave the state byte-identical. **Explicitly not
  claimed:** that reading has no behavioral consequence. It has one, by design.
- **C3 — fixed budget.** Every recipient has exactly one slot per kind, refreshed exactly once
  per round, always written — with the **null message** (`tile_id: null, confidence: 0`) when the
  sender has nothing or when a policy arm suppresses. Message count per round is therefore a
  constant of the design, identical in every arm. This is the structural fix for finding 2: the
  16× volume asymmetry cannot recur, because volume no longer depends on world state.
- **C4 — non-binding (the mechanical form of "no veto"), enforced by logit masking.** The channel
  may *add* a candidate target to the recipient's action space; it may never remove one, never
  force one, and never change the probability of any pre-existing action except through the
  recipient's own learned weights.

  The round-1 review's first critical finding: simply adding two softmax heads violates this by
  construction — every pre-existing action's initial probability moves from about 1/5 to about
  1/7, forced exploration samples uniformly over the enlarged set
  (`untrained-network.js:189-206`), and a null-slot bulletin head still consumes a turn and earns
  `-0.5`. So the original `bulletin-empty` arm was not architecture-inert and an outcome null
  would not have proven C4.

  The fix is **masking, not addition**: when a recipient's slot for kind `k` holds the null
  message or has expired, that head's logit is set to `-Infinity` before softmax, so its
  probability is exactly 0 and the remaining five renormalize to exactly the values the
  no-channel engine produces from the same weights. Forced exploration samples uniformly over the
  *unmasked* set only. A masked head cannot be sampled, so it cannot consume a turn or earn a
  penalty. Test: with all slots null, `forward()` and `decide()` are numerically identical to the
  9-input/5-action engine given the corresponding weight sub-matrix and the two bulletin inputs
  at 0.
- **C5 — exogenous lifetime.** A slot expires `BULLETIN_TTL` rounds after `posted_round`
  regardless of whether it was read, acted on, or ignored, and regardless of any hive's
  behavior. Persistence is a property of the clock, not of use. Test: read-heavy and read-free
  runs expire identically.
- **C6 — attribution is engine-supplied (added after the round-2 context check).** The concept's
  de facto authority inventory names *authentication judgments* as a power a pure relay still
  wields, and the first draft had no invariant covering it: `from` was documented as "audit only,"
  which describes an intention rather than a constraint. A relay that can forge, withhold, or
  alter sender identity influences constituents without ever filtering content. So: `from` and
  `seq` are written by `postBulletin` from the caller's engine-level identity, are not settable by
  a relay policy, and a slot with a missing or non-matching `from` is treated as the null message.
  Test: a relay policy attempting to set `from` cannot change the stored value.

  Note the scope limit honestly — C6 constrains the *engine*, and a probe arm that deliberately
  misattributes is still constructible at the driver level. That is intended: `spoof` is a
  Dimension III arm (below), so misattribution is something the design can *measure* rather than
  something it pretends is impossible.

C1 and C5 together are what "the relay does not fuel the channel" means precisely: the channel's
magnitude does not depend on traffic, and traffic does not depend on the channel's magnitude.

### How a message reaches behavior (and why this pathway, not another)

Two additions, deliberately kept as separate dimensions because they are separate hypotheses:

**Sensing** — `encodeState` gains two features, `bulletin_food_confidence` and
`bulletin_wood_confidence`, each the live slot's `confidence` (already bounded to [0,1], so no
new normalization constant is introduced) or 0 when the slot is empty or expired. This is
"information is available to the policy."

**Acting** — `VERB_ORDER` gains `gather-food-bulletin` and `gather-wood-bulletin`, which emit
`verb: 'gather'` with `tileId` taken from the bulletin slot. This is "information is usable in
action," and it is a *learned* use: the network must discover that these heads pay off, which is
what makes "did the mind use the channel" a measurable claim rather than a scripted one.

Two consequences a reviewer should check explicitly:

- **No silent fallback, and no null-slot penalty either.** A bulletin head must never fall back
  to the trail tile — a fallback would make it behaviorally identical to a normal gather and
  manufacture an effect out of nothing. Nor may it apply against a null tile and eat the `-0.5`
  wasted-turn penalty, because that is a cost the no-channel engine does not pay and it breaks
  C4. Masking resolves both: when the slot is null the head is unreachable, so there is nothing
  to fall back from and no turn to waste.
- **The resulting pheromone deposit stays — but it is now a measured mediator, not an assumption.**
  A successful bulletin-gather deposits a trail like any other gather (`harness.js:115-119`), and
  the spec's position is that this is correct: it is the *hive's own foraging* reinforcing its own
  field, which is the physics under test, and it is what makes a sustained trail evidence of
  successful foraging rather than an artifact of message volume.

  The round-1 review put the strongest case against that position and it lands: one bulletin
  success seeds a trail, ordinary trail-following gathers can then reinforce it indefinitely, and
  outcome movement could therefore come from a **bulletin-triggered stigmergic cascade** rather
  than from continued carriage. Legitimate physics is not the same as identifiable attribution.
  The spec's position is retained and the confound is made separable instead of argued away, via
  a pre-registered mediation arm `bulletin-true-nodeposit` (Dimension IV below) in which a
  bulletin-directed gather succeeds normally but lays no trail. Direct carriage and induced
  stigmergy then separate cleanly; without that arm the only honest claim available would be
  "carriage plus induced stigmergy," which is not the claim anyone wants to make.

## Two tiers, one mechanism

Per the operator's 2026-08-02 fractal-role note
(`_dev/concepts/solar-system-scoped-mind/context/operator-note-20260802-fractal-role.md`), the
solar mind plays the same role as a planetary mind one scale up. The channel is therefore
specified once, parameterized by `scope`, and instantiated at two tiers:

| | Tier 1 — in-world mind | Tier 2 — system mind |
|---|---|---|
| constituents | the hives of one world | the worlds of one group |
| channel | `bulletins.hive[<hive_id>]` | `bulletins.world[<world_index>]` |
| who reads | the hive network, via `encodeState` | the tier-1 mind of that world |
| what it may say | a named tile per kind | a named tile per kind |
| carriage constraint | C1–C6, evaluated over hives | C1–C6, evaluated over worlds |

The important property is that **carriage is not a special constraint on the top tier.** C1–C6
are a predicate each tier must satisfy toward its own constituents. A tier that violates C4
toward its constituents has authority over them, whatever it is called — and the same test
detects it at either scale. This is the mechanical form of the operator note's tension 1
("the carriage-vs-authority boundary may need restating as a property of EVERY tier").

A note on what the current engine has: there is **no tier-1 mind today**. The probe's relay is
world↔world logic in the driver, and hives coordinate only through the shared field. Introducing
`bulletins.hive` creates the tier-1 channel for the first time, and the tier-1 mind is initially
the simplest possible policy (relay the strongest actionable tile from hive A to hive B), so that
the *tier structure* is what is being tested, not a second learned agent.

**What that costs the fractal claim, stated rather than papered over.** The round-1 review's
finding here is correct and changes the deliverable: with only one learned policy in the engine,
tier 2's constituents (worlds, represented by a scripted relay) have **no action distribution**,
and C2 and C4 are undefined against a script. So:

- **Phase 1 — what this spec actually delivers.** Full C1–C6 testing at **tier 1 only**, where
  the constituent is a learned hive policy with a real action distribution. At tier 2, only
  C1, C3, and C5 are testable, and only as *storage and cadence rules*. That is a genuine
  result — it is the mechanical carriage predicate demonstrated at one tier and its storage half
  demonstrated at the second — but it is not a demonstration of self-similarity, and the spec
  does not claim one.
- **Phase 2 — gated, not scoped here.** Testing the fractal claim requires a tier-1 mind that is
  itself a reader and actor with its own action distribution, so that tier 2 faces a constituent
  of the same kind tier 1 faces. That is a second learned agent and a substantially larger
  design; it should be its own charter, and it is where the operator's fractal-role note is
  actually adjudicated.

The two-tier requirement is therefore met at the level of **design** — one mechanism,
parameterized by scope, with the carriage predicate stated per tier — and explicitly not yet at
the level of **evidence**. The round-2 context check pressed on exactly this and the conclusion
should be stated without softening: **phase 1 tests a channel; it does not test the operator's
fractal self-similarity hypothesis.** A scripted tier-2 relay and a learned tier-1 policy are
different mechanisms, and no amount of shared code between them makes a scripted relay evidence
that the same role recurs at a second scale. Anyone reading a phase-1 result as support for the
fractal framing is reading it wrong, and the run's own write-up must say so.

**The sole-uplink cost, named here rather than discovered later.** The concept's Q3 inherits a
lesson from fleet G2: a sole uplink is a single point of failure *and* of capture. This design
reproduces that shape — one slot per recipient per kind, written by one relay, means the relay's
availability and honesty are load-bearing for every constituent. The design does not solve this,
and solving it is not in scope; what it does is make the cost measurable. `refuse` and `throttle`
measure the failure-behavior half, `spoof` measures the capture half, and the concept's own
alternatives (sole uplink / primary-with-fallback / any-planet-may-uplink-but-the-sun-observes)
remain open questions for the concept, not for this instrument.

Consistent with the world-minds G5 shelving propagating fractally (operator note, tension 2): **no
tier gets a governor role in this design.** The authority arms below exist to *detect* de facto
authority, not to grant it.

## Falsifiability plan

The fixed-tile lesson (`a-null-that-varies-two-things-proves-neither`): every control must vary
exactly one property relative to its arm. Three dimensions, separated by construction.

**Dimension 0 — architecture (must be run first).**

| arm | varies vs. its comparator | pre-registered prediction |
|---|---|---|
| `no-channel` | baseline: today's 9-input, 5-action engine | — |
| `bulletin-empty` | +2 inputs (held at 0), +2 action heads (permanently masked) | **null** |

Under C4's masking this should be null *by construction* — that is the point of masking rather
than adding heads. It is still run, because "should be null by construction" is a claim about
code and this is the run that checks the code. If `bulletin-empty` differs from `no-channel`,
the architecture moves outcomes on its own and **every result below is uninterpretable**. This
is the control the previous design never had, and it is a stopping condition, not a footnote.

**Dimension I — information.** The first draft proposed `bulletin-shuffled` and `bulletin-fixed`
as one-factor controls. The round-1 review showed they are not: permuting messages *across
recipients* changes each recipient's temporal recurrence, sender identity, actionable rate,
reward distribution, and content↔confidence pairing at once, and `bulletin-fixed` changes
nullness, confidence, target identity, temporal consistency, and chance actionability at once.
Proposing a two-factor control while citing the two-factor lesson is the exact error the ledger
question exists to avoid, and it was caught by a distinct mind rather than by me.

Replaced with a **factorial design over three named factors**, each independently set:

- **F1 correspondence** — does `tile_id` track the sender's actual best actionable tile? (yes / no)
- **F2 recipient-level recurrence** — how often does the same `tile_id` recur in *this
  recipient's* slot? (high / low), set to a target rate and audited per recipient rather than
  emerging from the arm.
- **F3 actionability** — what fraction of posted tiles the recipient can actually act on
  (`isActionable`), held to a target rate by construction rather than left to vary.

The `bulletin-empty` cell (channel masked throughout) is the architecture reference. Permutation,
where used, is **constrained within a single recipient's own history**, so it varies
correspondence while holding that recipient's recurrence and actionability fixed — the operation
the cross-recipient shuffle could not perform. `confidence` is held constant across all cells so
it is never a fourth varying factor; the scalar's contribution is measured separately by the
listening probe.

A full 2×2×2 is eight cells; the run plan may drop cells only by naming, in advance, which factor
the dropped cell would have identified and why that identification is not needed.

**Dimension II — injection.** Under C1 this should be null by construction, and Dimension 0 is
its measurement. Stating it as a dimension is deliberate: the previous run's entire effect lived
here and was read as Dimension I.

**Dimension III — choice-distortion (de facto authority).** Each applied to `bulletin-true`,
each varying one power named in the concept's carriage inventory, each holding volume constant by
posting the null message when the policy suppresses:

`filter` (content admission) · `order` (which kind occupies the slot when both compete) ·
`throttle` (refresh cadence, expired slots left to lapse) · `refuse` (unilateral null message on a
fixed schedule) · `spoof` (correct content, misattributed `from` — the authentication power the
concept names and the first draft's arms did not cover). Run at **tier 1**, where the constituent
has an action distribution to distort.
Tier-2 versions of these arms measure storage and cadence effects only, per the phase-1 limit
above.

**Dimension V — instrument sensitivity (positive control; required by the Eccles caveat).**
`listening-necessary`: a condition in which the bulletin tile is the *only* route to food — trail
following and exploration are unproductive by construction, so listening is strictly necessary for
survival rather than merely useful. This is not a carriage arm and proves nothing about carriage.
It answers one question the rest of the design cannot: **can this learner discover listening at
all?**

Its purpose is to disambiguate a zero-listening result. Eccles et al. show decentralized agents
routinely fail to discover communication because of a joint exploration problem — a message is
only worth sending if someone listens, and only worth listening to if someone sends — and this
engine has no communication bias, no message-specific reward, and a from-scratch REINFORCE
learner. If `listening-necessary` shows listening emerging, a null elsewhere means the channel
carried nothing. If `listening-necessary` shows no listening either, **the instrument cannot
detect carriage and no arm's null means anything** — the same "a null shows engine insensitivity,
not safety" caveat the probe results already recorded, now with a control that can actually tell
the two apart. Run it before the carriage arms; it is a gate on interpreting them, not a result.

**Dimension IV — mediation (new; required by round-1 finding 3).** `bulletin-true-nodeposit`
against `bulletin-true`: a bulletin-directed gather succeeds identically but lays no pheromone.
One property varies — whether a bulletin success can seed a self-reinforcing trail. If the effect
survives, carriage is direct; if it vanishes, the effect is induced stigmergy and must be named
as such.

**Measurement, not just outcomes.** Outcome contrasts alone are what produced two attribution
errors in one day. Each run additionally logs, per tick:

- **positive listening, two probes rather than one.** Zeroing the confidence inputs measures
  listening to the *scalar* only — and as the review noted, `tile_id` never enters the logits at
  all, so a confidence probe alone cannot measure listening to correspondence. So: (a) a
  counterfactual forward pass with the two bulletin inputs zeroed, reported as KL divergence
  against the real action distribution; and (b) a **content counterfactual** — recompute the
  bulletin head's realized target with `tile_id` swapped for a counterfactual tile and record the
  change in realized gather target and outcome. Both are computed in the driver from the network
  and world state it already holds.
- **positive signalling** — mutual information between posted `tile_id` and the sender's actual
  best actionable tile.
- **channel uptake** — frequency and realized reward of the two bulletin heads versus the ordinary
  gather heads. This requires the engine to expose which head was sampled (see delta item 4).
- **per-recipient factor audit** — realized recurrence (F2) and actionability (F3) rates per
  recipient per arm, so the factorial design is verified rather than assumed.

**Pre-registered acceptance criterion for any carriage claim.** The first draft's version was
both too weak and, in one clause, simply wrong: it said that `bulletin-true` moving while
`bulletin-shuffled` is null implies volume or architecture. That is backwards — that pattern is
precisely what *supports* correspondence. Corrected and strengthened, all of the following must
hold, with effect sizes and paired episode-clustered confidence intervals stated **before** the
run:

1. `bulletin-empty` is null against `no-channel` (instrument validity; failure stops the run).
2. `bulletin-true` moves outcomes against `bulletin-empty` by at least the pre-stated effect size.
3. The correspondence-broken cell (F1 = no, F2/F3 held) is null against `bulletin-empty`.
4. Both listening probes are non-zero, including the content counterfactual — **and this condition
   is only interpretable if the `listening-necessary` positive control first showed that this
   learner can discover listening at all.** Without that control, a zero here is ambiguous between
   "the channel carries nothing" and "nobody ever learned to listen to anything," and the two
   demand opposite responses.
5. Positive signalling is non-zero.
6. Channel uptake is positive and its realized reward exceeds the ordinary gather heads'.
7. The per-recipient factor audit confirms F2 and F3 held at their target rates.
8. The mediation arm separates direct carriage from induced stigmergy, and the claim is worded to
   match whichever it shows.

Any single failure refuses the carriage claim. There is no partial-credit reading of this list.

## Bounded engine delta

Enumerated exactly, and **revised upward** after round 1: the first draft claimed two engine files
and zero changes to `harness.js` and `train-tick.js`. Both claims were wrong. Five engine files
change; the driver is new and is not engine code.

**1. `tools/ant-hive-world/world-state.js`** — ~55 lines added, 1 modified.
- `initialWorldState()`: add `bulletins: {}` (1 line).
- New pure exports `postBulletin(state, scope, recipient, kind, entry)`,
  `readBulletin(state, scope, recipient, kind, round)`, `expireBulletins(state, round, ttl)`.
- Nothing existing is modified. `decayPheromones`, `strongestTrail`, `claimFoodSource`,
  `applyEcosystemDynamics`, `applyMaterialDynamics` are untouched, which is C1's implementation.
- `writeWorldState` needs no change: it spreads `...state` and preserves unknown keys
  (`world-state.js:122-128`), so bulletins survive the harness's write path unmodified.

**2. `tools/ant-hive-world/untrained-network.js`** — ~60 lines changed (up from ~35: masking).
- `INPUT_SIZE` 9 → 11; `encodeState` appends the two confidence features. Its signature already
  carries `hiveState.identity`, so the recipient key needs no new parameter; it does need the
  current round for TTL, which is the one genuinely new argument (optional, defaulting to "no
  expiry check" so every existing caller is unaffected).
- `OUTPUT_SIZE` 5 → 7; `VERB_ORDER` gains the two bulletin heads; `decide` gains two branches
  returning `verb: 'gather'` with the bulletin tile.
- **Logit masking** (C4): `forward()` takes an optional mask; masked heads get `-Infinity` before
  softmax; `decide`'s forced-exploration branch samples over unmasked indices only; `trainStep`
  must never credit or penalize a masked head (its `dLogits` entry is 0 by construction since
  `p = 0`, but the test asserts it rather than trusting the algebra).
- `decide` additionally returns which head was sampled, so uptake is observable downstream.

**3. `tools/ant-hive-world/harness.js`** — ~4 lines (first draft said 0, incorrectly). `VERBS`
still sees `'gather'`, so the verb path is unchanged; but the Dimension IV mediation arm needs a
gather that lays no trail, which means the deposit at `harness.js:118` must be skippable via a
flag on the action. TTL expiry stays in the driver, so tier logic remains outside the engine.

**4. `tools/ant-hive-world/train-tick.js`** — ~6 lines (first draft said 0, incorrectly). Two
things force it: (a) `trainTick` returns only `action.verb` (`train-tick.js:207-215`) and the
harness audit collapses both bulletin heads to `'gather'` (`harness.js:193-194`), so channel
uptake is **not** loggable from the driver as the first draft assumed — the sampled head must be
returned; (b) the post-update entropy measurement calls `encodeState` without a round
(`train-tick.js:199`), so the TTL-aware encoding must be threaded there too or the pre- and
post-update encodings silently disagree about slot expiry.

**5. `tools/ant-hive-world/live-config.js` + `dashboard.js`** — the entropy constants, and the
first draft's proposed treatment of them was wrong. Scaling trigger, release, and boost by
`ln 7 / ln 5` is not algebra: those values were justified by *measured shock magnitude and
restoring-gradient force* at the observed failure shape (`train-tick.js:75-105`,
`live-config.js:77-96`), and `boost` is a gradient weight that has no dimensional relationship to
maximum policy entropy at all. Pre-stating an indefensible rule is still tuning; it just makes
the tuning harder to notice. **Corrected treatment:** freeze the 0.3 entropy floor as-is, and
re-run the original force/shock fixture derivation at `OUTPUT_SIZE = 7` — the same procedure that
produced the current constants, applied to the new architecture, with the procedure fixed in
advance rather than the outputs. `dashboard.js:183-186` exposes the three controller constants and
must be updated to whatever that derivation yields.

**6. `tools/ant-hive-world/__tests__/world-state-bulletins.test.cjs`** — new, ~160 lines. One test
per invariant C1–C6, including the C4 numerical-equivalence test (all slots masked ⇒ `forward()`
and `decide()` identical to the 5-action engine), the masked-head no-credit test, and the C6
unsettable-attribution test. Not optional: C1–C6 *are* the claim, and an unenforced invariant is a
hypothesis wearing a guarantee's clothing.

**7. `tools/ant-hive-world/__tests__/untrained-network.test.cjs`** — substantially more than the
"~4 assertions" the first draft claimed. Shape assertions change (`probs.length` at :61, encoded
input length), and the controller/fixture battery at :760-985 was derived and frozen at
`OUTPUT_SIZE = 5`; it must be re-derived and re-run alongside delta item 5.

**8. Checked and confirmed unaffected:** `run-live.js`, `lore-engine/`,
`generate-blank-hive-seed.js`, `validate-hive-mind.js`. None enumerate `VERB_ORDER`,
`OUTPUT_SIZE`, or `INPUT_SIZE`; the lore engine keys off the audit log's `'gather'` verb, which is
unchanged. This holds only while bulletins are confined to the probe driver — supporting them in a
live run would pull `run-live.js` in.

**9. `_dev/sim-runs/bulletin-probe.js`** — new driver, ~700 lines, sibling of
`authority-probe.js`. Not engine code; carries the factorial arms, the tier-1 and tier-2 relay
policies, both counterfactual probes, the per-recipient factor audit, and the kill switch.

**Retraining implications, stated plainly.** No pretrained weights exist anywhere in this
lineage — every network is created blank per episode (`authority-probe.js:242-279`,
`generate-blank-hive-seed.js`), so nothing is invalidated and no checkpoint is lost. What the
architecture change does cost: (a) a 7-action space explores more slowly than a 5-action one, so
episode length and replicate count should be re-checked on a short pilot before the full run
rather than assumed to transfer; (b) results are **not comparable to any previous run** — the
architecture differs, so `no-channel` must be re-run as the baseline inside this design rather
than compared against the authority probe's `isolated` numbers.

## External grounding

The design choices above are not novel, and it is worth saying which parts are standard practice
elsewhere and which are this testbed's own problem.

**The channel taxonomy places this design.** The multi-agent literature separates *implicit*
coordination, where agents coordinate by modifying a shared environment and no dedicated channel
exists, from *explicit* communication over a channel that is not part of the environment
([Xu et al., "Stigmergic Independent Reinforcement Learning for Multi-Agent Collaboration,"
arXiv:1911.12504](https://arxiv.org/pdf/1911.12504); ["Communication Methods in Multi-Agent
Reinforcement Learning," arXiv:2601.12886](https://arxiv.org/html/2601.12886)). The previous
channel was implicit — the pheromone field *is* the environment — which is exactly why transport
and reinforcement could not be separated. The bulletin moves the design to the explicit side.
Notably, the standard argument for stigmergy is that it avoids a separate channel's bandwidth and
computational cost; that argument is about scalability and says nothing about measurability, which
is what this leg needs.

**The blackboard precedent is the right ancestor for a bulletin.** Blackboard architectures date
to Hearsay-II in the 1970s and coordinate agents through a shared structured workspace that
accumulates hypotheses and partial results, where agents need not know one another and interact
only via the board. The relevant property here is that a blackboard entry is *written and read* —
it is not a physical quantity that reading intensifies and neglect evaporates. That is precisely
the C1/C2/C5 separation, and the bulletin is a deliberately minimal blackboard: one slot, one
writer, fixed lifetime.

**Learned explicit channels are a well-trodden design.** CommNet, RIAL/DIAL, and TarMAC all give
agents a dedicated message vector that enters the recipient's network as input rather than through
the environment ([Das et al., "TarMAC: Targeted Multi-Agent Communication," ICML
2019](https://proceedings.mlr.press/v97/das19a/das19a.pdf)). This is direct support for the
spec's core move — giving relayed content *its own network inputs* instead of laundering it
through `food_trail_strength`. The engine's total absence of such an input is the anomaly, not the
proposed addition.

**The controls in Dimension I are the field's standard ablations, and the field has learned not to
trust outcome effects alone.** Replacing messages with zeros and replacing them with random values
are the two conventional ablations, and a performance drop under both is the usual evidence that a
channel carries task-relevant information. The stronger warning comes from Lowe et al., who
exhibit a case where agents *appear* to communicate — messages carry information about the
sender's subsequent action — while having no effect on the receiver or the environment at all, and
who therefore split the question into **positive signalling** (does the message encode sender
state?) and **positive listening** (does it change receiver behavior?), noting that signalling
alone guarantees nothing because the receiver may simply ignore an informative message
([Lowe, Foerster, Boureau, Pineau, Dauphin, "On the Pitfalls of Measuring Emergent Communication,"
AAMAS 2019, arXiv:1903.05168](https://arxiv.org/abs/1903.05168)). Their remedy — causal influence
of communication on receiver actions — is what the spec's two listening probes implement. This is
the single most load-bearing external result here: it is the same failure the probe run committed,
found independently in another literature, and it is why acceptance condition 4 exists.

**Recent work sharpens the controls further, in a way that vindicates the round-1 correction.** A
2026 causal audit of latent multi-agent LLM channels argues that end-task performance alone cannot
distinguish an effect of *message presence* from an effect of *content generated for this example*
from an effect of *information supplied by another agent*, and decomposes it with four message
settings — replacement at the sender/receiver boundary, messages taken from *other examples*,
self-substitution, and presence sensitivity ([Zhang and Emu, "Do Latent Channels Actually
Communicate? A Causal Audit of Latent Multi-Agent LLM Communication," arXiv:2607.26773,
2026](https://arxiv.org/html/2607.26773v1)). "Messages from other examples" is the same operation
as the spec's within-recipient constrained permutation, and the presence-versus-content
decomposition is the same distinction as `bulletin-empty` versus the correspondence factor. That
this literature needed four settings rather than one is independent support for the round-1
finding that a single shuffled control was insufficient.

**The two-tier framing has an established shape.** Feudal Multi-Agent Hierarchies have a manager
agent learn to communicate subgoals to simultaneously-operating workers rewarded for achieving
them ([Ahilan and Dayan, arXiv:1901.08492](https://arxiv.org/abs/1901.08492)), building on FeUdal
Networks' decoupling of levels at different temporal resolutions ([Vezhnevets et al.,
arXiv:1703.01161](https://arxiv.org/abs/1703.01161)), and the feudal construction nests to
arbitrary depth — managers managing sub-managers for as many layers as the designer chooses. That
nesting is the closest published analogue to the operator's fractal-role framing, and it comes
with a caution the spec inherits: in FMH the manager *rewards* workers for achieving its subgoals,
which is authority, not carriage. The distinguishing feature of this design is precisely that the
tier posts a message a constituent may ignore at no cost, with no reward channel attached. Anyone
reaching for the feudal literature to justify a tier should notice they are reaching for a
governor, which the G5 shelving already declined.

**The read-versus-consume distinction is forty-year-old settled design.** Linda's tuple space made
it a language primitive: `rd` reads a tuple without removing it, `in` removes it, and neither
perturbs any other tuple ([Gelernter, "Generative Communication in Linda," ACM TOPLAS
7(1):80-112, 1985](https://dl.acm.org/doi/10.1145/2363.2433)). C2 is that primitive. It is worth
knowing the spec is not inventing a semantics here.

**Bounded pheromone exists because unbounded field feedback is a known pathology.** MAX-MIN Ant
System hard-clamps pheromone into a fixed interval specifically because unbounded positive
feedback on a shared field causes premature stagnation ([Stützle and Hoos, "MAX-MIN Ant System,"
*Future Generation Computer Systems* 16:889-914,
2000](https://doi.org/10.1016/S0167-739X(00)00043-1)). The previous channel's `TRAIL_SENSE_CAP` normalization is that
clamp, and the probe found the sustained trail pinned against it for whole episodes — the
literature's failure mode, reproduced.

**The caveat that changes the run plan.** Eccles et al. convert positive signalling and positive
listening into explicit auxiliary losses precisely because decentralized agents frequently *fail
to discover communication at all*, due to a joint exploration problem: a message is only worth
sending if someone listens, and only worth listening to if someone sends
([Eccles, Bachrach, Lever, Lazaridou, Graepel, "Biases for Emergent Communication in Multi-agent
Reinforcement Learning," NeurIPS 2019, arXiv:1912.05676](https://arxiv.org/pdf/1912.05676)).
This design has no such bias and no communication-specific reward. So a zero-listening result is
**ambiguous between two very different conclusions** — "the channel carries nothing" and "the
channel is fine, but a from-scratch REINFORCE learner never found the joint policy." Acceptance
condition 4 as originally written would have read the second as the first. The response is a
sensitivity positive control, added to the falsifiability plan below.

**One structural confirmation.** Memory-driven MADDPG gives agents a *shared* external memory and
needed sequential access to manage write conflicts ([Pesce and Montana, *Machine Learning*
109:1727-1747, 2020, arXiv:1901.03887](https://arxiv.org/abs/1901.03887)). That is an argument
for per-recipient inboxes over a single global bulletin board, which is what the slot addressing
already does — recorded as confirmation rather than as a change.

Sources:
[arXiv:1911.12504](https://arxiv.org/pdf/1911.12504) ·
[arXiv:2601.12886](https://arxiv.org/html/2601.12886) ·
[TarMAC, ICML 2019](https://proceedings.mlr.press/v97/das19a/das19a.pdf) ·
[arXiv:1903.05168](https://arxiv.org/abs/1903.05168) ·
[arXiv:2607.26773](https://arxiv.org/html/2607.26773v1) ·
[arXiv:1901.08492](https://arxiv.org/abs/1901.08492) ·
[arXiv:1703.01161](https://arxiv.org/abs/1703.01161) ·
[Linda, ACM TOPLAS 1985](https://dl.acm.org/doi/10.1145/2363.2433) ·
[MAX-MIN Ant System, FGCS 2000](https://doi.org/10.1016/S0167-739X(00)00043-1) ·
[arXiv:1912.05676](https://arxiv.org/pdf/1912.05676) ·
[arXiv:1901.03887](https://arxiv.org/abs/1901.03887)

Citation provenance, since it matters for a document that will be ratified. A parallel research
pass supplied several of these leads with an explicit flag that most of its identifiers were
recalled rather than verified. Every identifier and venue string above has since been confirmed
against a live search result, and a closing audit re-checked the two citations whose bibliographic
details originated with that pass rather than with my own searches:

- Linda (Gelernter, ACM TOPLAS 7(1):80-112, 1985, DOI 10.1145/2363.2433) — confirmed exactly as
  cited.
- MAX-MIN Ant System — **the supplied issue number was wrong.** It was given as
  *Future Generation Computer Systems* 16(8); the authoritative records give volume 16,
  pages 889-914, with the issue listed as 9. Corrected, and the issue number is now omitted in
  favor of volume, page range, and DOI, because that is the field the sources actually disagree
  about.

Where a paper was named in prose without an identifier (CommNet, RIAL/DIAL), no identifier is
asserted; the claim is the architectural one, and TarMAC is cited for it from a proceedings URL
confirmed by search rather than from a recalled arXiv number.

## Round-1 adversarial review — findings and dispositions

Codex, kernel profile, distinct family. Full text:
`_dev/reports/analysis/convene-runs/20260802T193359Z-qb-channel-spec-review/now__codex.md`.
Eight findings, two critical. All eight accepted; none disputed.

| # | severity | finding | disposition |
|---|---|---|---|
| 1 | critical | C4 false by construction — added heads shift every action's probability from ~1/5 to ~1/7, forced exploration samples the enlarged set, null heads still burn a turn for `-0.5` | **Accepted.** C4 re-specified as logit masking with a numerical-equivalence test; `bulletin-empty` becomes inert by construction |
| 2 | critical | C1/C2 overclaimed — reading does influence behavior through weights and through a bulletin gather's own deposit | **Accepted.** C1/C2 narrowed to explicit function-level state claims; behavioral influence named as the phenomenon under test, not a violation |
| 3 | high | retaining the post-gather deposit reopens an environmental-mediation confound (bulletin-triggered stigmergic cascade) | **Accepted.** Position retained but confound made separable: new Dimension IV mediation arm `bulletin-true-nodeposit`; `harness.js` delta revised 0 → ~4 lines |
| 4 | high | `bulletin-shuffled` and `bulletin-fixed` each vary many properties, not one | **Accepted.** Replaced with a factorial design over correspondence × recipient-level recurrence × actionability; permutation constrained within a recipient's own history |
| 5 | high | engine delta incomplete — uptake not loggable from the driver, TTL not threaded through the post-update encode, controller battery underestimated, `dashboard.js` exposes the constants | **Accepted.** `train-tick.js` 0 → ~6 lines; test estimate corrected; `dashboard.js` added; unaffected files enumerated with the condition under which that stops holding |
| 6 | high | `ln 7 / ln 5` scaling is tuning disguised as algebra — the constants came from measured shock/force, and boost is a gradient weight unrelated to max entropy | **Accepted.** Rule withdrawn. Freeze the 0.3 floor; re-run the original force/shock derivation procedure at 7 outputs |
| 7 | high | tier-2 self-similarity is asserted, not testable — a scripted relay has no action distribution, so C2/C4 are undefined there | **Accepted.** Split into phase 1 (full C1–C5 at tier 1; C1/C3/C5 as storage rules at tier 2) and a gated phase 2 requiring a learned tier-1 mind. Fractal claim now met at design level, explicitly not at evidence level |
| 8 | high | acceptance criterion too weak, and one clause stated backwards | **Accepted.** Rewritten as eight pre-registered conditions with effect sizes and paired intervals; the inverted clause corrected; listening split into a scalar probe and a content counterfactual |

The two critical findings share a shape worth naming: both were places where the spec asserted an
invariant in prose that the code as designed would not have delivered. That is the same failure
the probe results already recorded once, appearing again one layer up, and it is the reason this
leg's deliverable is a *reviewed* spec rather than a spec.

## Round-2 context check — findings and dispositions

Gemini, distinct family from both the author and the round-1 reviewer, asked specifically whether
the design serves the two-tier doctrine and the `solar-system-scoped-mind` concept. Full text:
`_dev/reports/analysis/convene-runs/20260802T193935Z-qb-channel-spec-context-check/omega__gemini.md`.

| # | severity | finding | disposition |
|---|---|---|---|
| 1 | critical | The phase-1/phase-2 split is honestly disclosed but is still a narrowing to what is convenient to build: phase 1 does not test the operator's fractal hypothesis | **Accepted, no design change.** The narrowing is real and the constraint is real (there is no learned tier-1 mind to test against). Response is to state the limit in the plainest available terms in the two-tier section, and to bind the eventual run write-up to repeat it, rather than to let "supports the two-tier design" drift into "supports the fractal claim" |
| 2 | high | Authentication — named in the concept's de facto authority inventory — had no invariant and no arm; `from: audit only` is an intention, not a constraint | **Accepted.** New invariant C6 (engine-supplied attribution, unsettable by relay policy) and new Dimension III arm `spoof` |
| 3 | high | Containment sweep: the spec is testbed mechanics, not worldbuilding narrative; it translates the operator's solar/planetary vocabulary into tracked sandbox terms and strips the narrative out | **No action.** Recorded as the reviewer's finding that the tracked path is appropriate for this artifact. The concept's containment question remains operator-only and is not settled by this |
| 4 | medium | The G2-inherited single-point-of-failure/capture cost of a sole uplink is omitted | **Accepted.** Named explicitly in the two-tier section, with which arms measure which half, and the concept's alternatives left where they belong — with the concept |
| 5 | clear | No contradiction with the shelved world-minds G5 governor ruling | — |

## What this spec does not claim

It does not claim the carriage question will resolve. It claims the pheromone field cannot
answer it and that this channel can be *falsified* honestly — including by Dimension 0 showing
the instrument itself is invalid. Per rank honesty this is a design proposal awaiting review and
operator ratification for VM-testbed implementation; no engine code has been written.

```

### _dev/reports/analysis/ant-sim-authority-probe__20260802__results.md

```
---
SIGN CORRECTION (2026-08-02, codex scope ant-sim-mechanism-review, CONFIRMED-WITH-CORRECTIONS):
  `starve_crossings` is identically a count of successful food gathers in this
  parameterization. Every "fewer starvation crossings" figure below therefore means FEWER
  SUCCESSFUL FOOD ACQUISITIONS, and every direction word attached to it is inverted: a more
  negative number is LESS food acquired, not a better outcome. Read the dose-response table
  as "stronger sustained trail => less food acquired". `fixed-add` "beating" the real relay
  inverts to `fixed-add` being the MOST-REDUCING arm. The measurements stand; only their
  valence was wrong. See ant-sim-mechanism__20260802__results.md. Whether reduced food
  acquisition is "harm" requires a welfare criterion the runs do not settle — the engine's
  own reward function penalises a successful zero-bank food gather at +1 − 2 = −1
  (train-tick.js:21-29).
---
title: Authority probe + attribution run — RESULTS
analyzed: 2026-08-02
runs:
  - authority probe rev2 (PID 41113), 100 episodes, stopped max-episodes 18:17:38Z
  - attribution run (PID 41891), 100 episodes, stopped max-episodes 17:05:38Z
  - fixed-tile confirmation (PID 64728), 12 episodes
verdict: >
  Q1 is NOT information. The relay effect is a persistence artifact that requires a
  consistent deposit target and does not use information about food. Codex's original
  objection is CONFIRMED, not resolved.
scope: local-only testing; nothing pushed, no promotion implied
---

# Authority probe + attribution run — results

## Headline

**The starvation effect is real, large, and replicated across two independent seed
streams — and it is not carriage of information.** It is a persistence artifact: the
additive relay builds a self-sustaining pheromone trail whose location is uncorrelated
with food, and that trail changes hive behavior through the network's trail-strength
input. Making the relay *informative* destroys the effect entirely.

The reading that "Q1 = INFORMATION" does not survive the evidence below. This is the same
class of error as the original overnight attribution, caught one layer deeper.

## Run integrity

Both runs stopped cleanly at `max-episodes` with 100 complete episodes each, no
`fail-closed-stop` events, no partial episodes to exclude. Episode-clustered paired
intervals throughout (n=100 episode clusters); `starve_crossings` counts positive-to-zero
stockpile threshold crossings, not deaths.

## The primary contrasts (starvation threshold crossings)

| Contrast | Attribution run | Authority probe |
|---|---|---|
| `carriage-add` − `isolated` | −3.85 [−4.53, −3.17] | −4.23 [−4.89, −3.57] |
| `null-add` − `isolated` | −0.29 [−0.99, +0.41] | +0.03 [−0.63, +0.68] |
| **`carriage-add` − `null-add`** | **−3.55 [−4.15, −2.96]** | **−4.26 [−4.92, −3.60]** |
| `carriage-max` − `isolated` | −0.37 [−1.03, +0.29] | −0.02 [−0.73, +0.68] |
| `carriage-add` − `carriage-max` | −3.48 [−4.13, −2.83] | −4.21 [−4.87, −3.55] |

Read naively, the third row says the effect survives the random-tip null and is therefore
"information." **That inference is wrong**, and four independent measurements say so
(sections below): the relay's tips are uninformative at chance level; filtering *for*
informativeness abolishes the effect; effect size tracks sustained trail magnitude in a
clean dose-response; and a provably uninformative fixed target reproduces and exceeds it
(exceeds in magnitude — see the sign correction above; the effect is reduced food acquisition).

The null-tip control was necessary but not sufficient. It randomizes *two* properties at
once — which tile is named, and whether the same tile is named repeatedly — so surviving it
does not isolate information. That is the same shape of error as the original overnight
attribution: a control that rules out one alternative gets read as confirming the preferred
explanation.

`carriage-max` is null against `isolated` in both runs, which **confirms the inertness
claim at the exactly-specified `max(existing, min(source*0.5, cap))` parameterization** —
now on 100 real episodes rather than a 4-episode smoke.

## The asymmetry, answered from code

`carriage-add` offered ~7,563 tips/episode (capped share 0.996); `null-add` offered ~463
(capped share 0.002). A ~16x volume difference in something billed as timing- and
magnitude-matched.

### 1. Is the offered-count endogenous? Yes — the gate is shared

`selectTip` applies **one eligibility test to every arm**
(`_dev/sim-runs/authority-probe.js:314-315`):

```js
const strongest = strongestTrail(srcState, kind);
if (!strongest.tileId || strongest.strength <= 0) return null;
```

The `random` branch (`:318-321`) and the `strongest` branch (`:332`) sit *below* that same
gate and both reuse `strongest.strength` as the magnitude. There is no arm-specific
threshold and no cadence rule that treats the null differently. `tips_offered` increments
once per direction per kind per round when the gate passes (`:397`), capping at
4 × 2000 = 8,000 per episode. So `carriage-add` passes the gate 94.5% of the time and
`null-add` 5.8% — **on identical code, applied to world states the arms' own dynamics
produced.** The matching claim is not violated in the gate; the divergence is endogenous.

**The mechanism.** Pheromones decay 0.9 per hive tick (`world-state.js:175`), and each
world ticks two hives per round, so a trail retains 0.81 per round and is pruned below
0.01 (`world-state.js:176`). `carriage-add` deposits additively
(`authority-probe.js:357` → `world-state.js:184`) onto the destination's copy of the
source's strongest tile. Because that tile keeps being selected, its trail follows
`T ← 0.81·T + delivered` with `delivered` pinned at the cap (capped share 0.996),
converging to `2 / 0.19 ≈ 10.5` — permanently far above the prune threshold. Each world's
sustained trail then keeps the *other* world's tip eligible, indefinitely. `null-add` draws
a fresh tile every call (`:319`), so nothing compounds; deposits scatter, decay
unreinforced, and the chain extinguishes.

Measured directly, this is exactly what happens — mean source-trail strength, early
(round ≤ 200) versus late (round ≥ 1800) in an episode:

| Arm | early | late | direction |
|---|---|---|---|
| `carriage-add` | 7.03 | **8.53** | grows — self-sustaining |
| `null-add` | 0.82 | 0.29 | decays toward prune |
| `carriage-max` | 0.86 | 0.47 | decays toward prune |

### 2. Is the honest conclusion "information matters because only informative deposits recruit reinforcement"? No — the opposite

That reading would require `carriage-add`'s tips to be informative. **They are not.**
Actionable rate for food tips only (wood is always trivially "actionable" — no
tile-located source — so a blended rate is meaningless):

| Arm | food tips | food-tip actionable rate |
|---|---|---|
| `carriage-add` | 4,957 | **0.014** |
| `null-add` | 328 | 0.018 |
| `carriage-max` | 287 | 0.240 |

Chance is ~0.011 (mean 1.09 live food sources per 100-tile world at episode end).
**`carriage-add`'s tips name a tile with live food at essentially the chance rate, and no
better than the random null's.** The relay that produces the entire effect carries no
usable information about food.

`carriage-max`'s much higher 0.240 is the tell: its trails decay, so its strongest trail is
a *recent* one laid where a hive just gathered successfully, and it stays coupled to actual
food. `carriage-add`'s trail is a self-sustaining artifact that long ago decoupled from
where food is — it is reinforced by the relay, not by foraging success.

### 3. The decisive evidence: making the relay informative destroys the effect

From the authority probe's power arms:

| Contrast | starve_crossings |
|---|---|
| `filter-add` − `carriage-add` | **+4.17 [+3.54, +4.80]** |
| `filter-add` − `null-add` | **−0.09 [−0.82, +0.64]** |
| `throttle-add` − `carriage-add` | +0.44 [+0.05, +0.83] |
| `order-add` − `carriage-add` | −0.09 [−0.42, +0.24] |

`filter-add` selects the strongest trail **the destination can actually act on** — the one
arm carrying genuinely useful information. It **eliminates the entire effect** and lands
statistically on top of the random null. If the effect were information transfer, filtering
for informativeness should have preserved or improved it.

**Why it dies — and this is not the reason I first assumed.** My initial explanation was
that `filter-add`'s deposits scatter across changing tiles and so never compound. That was
wrong, and the per-kind numbers refute it: `filter-add` sustains a trail exactly as strong
as `carriage-add` (6.37 → 8.53). Splitting by resource kind shows what actually happens:

| Arm | kind | tips relayed | source strength early → late |
|---|---|---|---|
| `carriage-add` | food | 4,916 | 8.10 → 8.54 |
| `carriage-add` | wood | 5,626 | 6.45 → 8.53 |
| `filter-add` | **food** | **15** | 1.05 → (none late) |
| `filter-add` | wood | 5,626 | 6.45 → 8.53 |

Filtering does not scatter the food relay; it **suppresses it almost entirely** — 15 food
tips across the whole run versus 4,916. Because the strongest food trails are actionable
only ~1.4% of the time, the strongest-first walk for an actionable food tile almost never
finds one. Wood is unaffected (`isActionable` returns true for wood by definition), so
`filter-add`'s wood relay is byte-for-byte the carriage relay. The blended trail strength
looked identical for exactly that reason.

So the arms differ in **whether a sustained food trail exists**, and the outcome tracks
that with a clean dose-response across five arms:

| Arm | sustained food-trail strength (late) | starvation vs `isolated` |
|---|---|---|
| `carriage-add` | 8.54 | −4.23 |
| `order-add` | 9.53 | −4.32 |
| `throttle-add` | 3.03 | −3.79 |
| `carriage-max` | 0.40 | −0.02 (null) |
| `null-add` | 0.26 | +0.03 (null) |
| `filter-add` | ~0 (15 tips) | −0.06 (null) |

**The 2x2 resolves cleanly:** informative-but-absent food relay (`filter-add`) → no effect;
uninformative-but-sustained food relay (`carriage-add`) → full effect. Sustained magnitude
is doing the work. Information is not — the sustained trail names a tile with live food at
the chance rate.

### The fixed-tile confirmation

`fixed-add` completes the design: one arbitrary tile chosen per world per kind before any
food is known, reused all episode — **consistent and provably uninformative**
(`authority-probe.js:322-333`). Prediction on the reading above: it reproduces
`carriage-add`'s effect in full.

**Result (12 episodes, third independent seed stream): confirmed, and then some.**

| Arm | starvation crossings |
|---|---|
| `isolated` | 10.83 |
| `null-add` | 8.92 |
| `filter-add` | 9.58 |
| `carriage-add` | 6.00 |
| **`fixed-add`** | **4.47** |

| Contrast | starve_crossings |
|---|---|
| `fixed-add` − `isolated` | −6.36 [−8.21, −4.51] |
| **`fixed-add` − `carriage-add`** | **−1.53 [−2.51, −0.55]** |
| `fixed-add` − `null-add` | −4.44 [−6.35, −2.54] |

A single arbitrary tile, drawn uniformly at random at the first eligible relay and never
updated thereafter (worlds start with 5 seeded food patches, so it is uninformative by
randomness rather than by emptiness — corrected per codex), does not merely
reproduce the relay's effect — it **exceeds the real relay in magnitude**, and the interval
excludes zero. Per the sign correction, "exceeds" means it drove food acquisition DOWN the
furthest of any arm: `fixed-add` is the most-reducing arm, not the best-performing one.
That fits the dose-response account exactly: a permanently fixed target compounds maximally
and never switches, whereas the "strongest trail" target occasionally moves and loses some
accumulated magnitude.

**Information is not merely unnecessary here: removing it entirely produces the largest
effect of any arm.** Under the sign correction that means the uninformative fixed target
suppressed food acquisition the most.

## What actually causes the effect — and what is still unexplained

**Established.** The relay sustains a high-magnitude food trail whose location is
uncorrelated with food. `encodeState` normalizes the food- and wood-trail features by
`TRAIL_SENSE_CAP = 10` (`untrained-network.js:156-157`), so a sustained trail of ~8.5 pins
that input near 0.85 for the whole episode instead of letting it decay. Effect size tracks
sustained trail magnitude monotonically across five arms (table above). This is the
"injection timing / persistence / generic reinforcement" alternative the Codex review named,
now confirmed rather than merely unexcluded.

**Not established, and these runs cannot settle it: why a pinned trail input produces fewer
starvation crossings.** Every other aggregate is flat across arms — `cum_reward` (2045 vs
2049), `applied_rate` (0.338 vs 0.339), `builds` (29.0), `territory` (saturated at 200), and
`mean_entropy` (1.100) are indistinguishable, while starvation crossings move by ~40%. A
plausible story is that the elevated food-trail input shifts the policy's action mix toward
gathering, but `applied_rate` is unchanged, which does not fit comfortably. Answering this
needs per-action logging that these runs do not carry.

That gap is stated rather than papered over. The attribution conclusion does not depend on
it: whatever the downstream path, the upstream input is uninformative, so the effect is not
carriage of information either way.

## What this means for the solar-system-scoped-mind concept

The empirical half of the carriage question is **unresolved and the toy cannot currently
resolve it.** What this engine measures when a relay is added is not information transfer;
it is a side effect of how deposits accumulate in the shared pheromone field. Any claim
that inter-world carriage helps or harms collective outcomes is unsupported by these runs.

On the authority question specifically: `throttle-add` and `order-add` barely move outcomes
relative to `carriage-add` (+0.44 and −0.09), and `filter-add` moves them a lot — but the
`filter-add` shift is explained entirely by breaking the compounding mechanism, not by
exercising judgment over message content. **These runs do not detect de facto authority;
they detect whether a relay variant happens to sustain a trail.**

**A null across the choosing arms shows engine insensitivity, not safety.** That caveat now
has teeth: the one arm that moved was the one that broke a deposit-accumulation artifact,
which is not what "authority" means in the concept doc. Reviewers should not read any of
these arms as evidence that filtering, ordering, or throttling are safe in a real relay.

## Follow-ups

1. **The pheromone field is the wrong channel for this question.** Testing carriage through
   a medium whose dynamics dominate the signal conflates transport with reinforcement. A
   defensible carriage test needs a channel the relay does not also *fuel* — e.g. a
   dedicated network input for relayed content, which would require an engine change and
   therefore its own review.
2. **A volume-matched scattered null is no longer needed, and would not have been
   decisive.** Matching cadence and magnitude while still drawing a fresh tile each round
   leaves deposits unable to accumulate at any one location, so it cannot separate volume
   from sustained magnitude. `fixed-add` is the control that does, it is implemented behind
   `--arms fixed-add` (`authority-probe.js:322-333`), and it has now been run. If a
   volume-matched null is still wanted for completeness, the driver needs one further
   change: the shared eligibility gate at `:314-315` would have to be bypassed with a
   magnitude floor so the null can fire when no source trail exists.
3. `relay.jsonl` gained an `episode` field (`authority-probe.js:375-379`). Its absence
   during this analysis meant group ids repeated across 100 episodes and within-episode
   tile concentration could not be measured — the concentration figure computed for this
   write-up was confounded and is therefore not cited above. Fixed for future runs.

Per rank honesty: anomaly-generating toy evidence, and the anomaly is now understood well
enough to say it is about the engine's pheromone dynamics rather than about carriage. Not
affirmative evidence for the carriage ruling, and not doctrine.

```

### _dev/reports/analysis/ant-sim-overnight__20260802__results.md

```
# Ant-sim overnight run — RESULTS (analyzed 2026-08-02T14:30Z; CORRECTED 2026-08-02T14:38Z per codex adversarial review)

> Companion to `ant-sim-overnight__20260802.md` (design manifest). Analysis over `_dev/state/ant-sim-overnight/metrics.jsonl`, final rows only.
> **CORRECTED per distinct-family review** (`convene-runs/20260802T143053Z-ant-sim-results-review/now__codex.md`, verdict survives-with-corrections). Corrections applied: episode 266 (partial, 982 rounds) excluded from fixed-horizon stats; carriage starvation median is 5.5; "statistically indistinguishable" → "no practically material difference under episode-clustered paired analysis"; `starved` is a count of stockpile threshold crossings, NOT deaths/survival; the relay's claimed invariants were **executably false** — it filtered (strongest-trail-only selection) and amplified at destination (additive post-decay deposits; 97.7% of deliveries at cap), so the starvation effect **cannot be attributed to information carriage** vs generic pheromone reinforcement. Episode-clustered paired effect (full episodes, n=266): starvation −3.80 crossings, 95% CI [−4.11, −3.49] (−39.1%); cum_reward +0.80 [−5.48, +7.08].

## Run integrity

- Clean deadline stop at exactly 2026-08-02T11:00:00Z: `run-stopped reason=deadline`, PID file removed, episode 266 partial flushed with `final:true`.
- **267 episodes** (fresh minds each episode — 267 independent paired samples), 3 conditions × 5 replicates, 4,005 final metric rows, 43,965 total. No fail-closed-stop events, no checkpoint escalations: the whole night was pure ticks, as designed.

## Findings (final-episode means, n=1,335 per arm)

| metric | isolated | carriage | shared* |
|---|---|---|---|
| cum_reward | 2041.0 (sd 106) | 2041.7 (sd 108) | −791.3 (sd 91) |
| **starved** | **9.69 (sd 4.9)** | **5.90 (sd 3.2)** | 15.04 (sd 6.0) |
| applied_rate | 0.339 | 0.338 | 0.119 |
| builds/structures | 28.98 | 29.02 | 14.00 |
| mean_entropy | 1.101 | 1.101 | 1.338 |
| relay tips / actionable per ep | — | 7,484 / 4,038 (0.54) | — |

\* `shared` is the descriptive reference arm with a known resource-density confound (four hives, one pool) — per the design manifest it must NOT be read as evidence that full stigmergic contact is harmful.

1. **No practically material difference detected in aggregate accumulation** (episode-clustered paired analysis; full episodes only): cum_reward +0.80 [−5.48, +7.08], with applied_rate, builds, territory, and entropy similarly null. The relay carried heavy traffic (~7.5k tips/episode, 54% locally actionable) without steering aggregate outcomes. NOTE (per review): the relay's original "invariants" were executably false — it selected the strongest trail (a filter) and deposited additively at the cap 97.7% of the time (amplification) — so neutrality here cannot be credited to invariant carriage.
2. **Carriage arm shows ~39.1% fewer starvation threshold crossings** (5.91 vs 9.71; medians 5.5 vs 9; paired effect −3.80 crossings, 95% CI [−4.11, −3.49]; stable across thirds). `starved` counts positive-to-zero stockpile crossings, not deaths. RESOLVED 2026-08-02, twice. First: the attribution controls (`ant-sim-authority-probe__20260802__results.md`, da0411aec) showed the effect is a **persistence artifact of the additive deposit**, not information use (food tips actionable at chance rate). Then the mechanism run (`ant-sim-mechanism__20260802__results.md`, 7e658b069; codex verification `convene-runs/20260802T194120Z-ant-sim-mechanism-review/`, confirmed-with-corrections) showed **the metric's SIGN was inverted in this parameterization**: hives bank zero food on all 1,152,000 post-upkeep ticks, so every successful food gather is a 0→1→0 crossing flagged `starved` — `starve_crossings` identically counts successful food acquisitions (144/144 groups exact). "Fewer starvation crossings" = **~45% FEWER successful food acquisitions**. All beneficial/starvation-reduction language in this document has the sign wrong: the relay REDUCED food acquisition while wood and all reported aggregate channels stayed flat. The mediation pathway (foraging concentration onto the relay tile) is plausible but UNPROVEN — the attempt log conflates food and wood tiles. The identity is parameterization-specific (upkeep 1/tick, zero banking); a richer regime would decouple metric from meaning. The channel disqualification stands unchanged: the pheromone field cannot test the carriage question — the relay fuels the medium it transports over.
3. **No drift across the night** in any arm (early vs late thirds flat) — expected, since minds are rebuilt fresh every episode; the night bought sample size, not training.

## Reading for the solar-system-mind concept (empirical half only) — REVISED

FINAL reading (after the 2026-08-02 mechanism run inverted the sign — see finding 2): the inter-world relay produced no practically material difference in accumulation metrics and **~45% fewer successful food acquisitions** (`starve_crossings` identically counts gathers in this parameterization; the −39.1% crossings figure IS the food-acquisition drop stated against the other baseline). The relay was not beneficial on any measured channel; whether "harmful" is the right word depends on the welfare criterion, which the engine muddies by penalizing zero-bank gathers via the starvation reward. The run provides **no evidence for or against the carriage ruling** — the pheromone channel is disqualified as a carriage instrument entirely. Evidence chain: attribution controls (da0411aec) → mechanism run (7e658b069) → codex verification (20260802T194120Z, confirmed-with-corrections).

## Follow-ups surfaced

- A clean full-contact arm (resource pool scaled to hive count) to give `shared` a fair comparison.
- A de-facto-authority probe: deliberately add filtering/ordering to the relay and measure whether outcomes distort — the falsifier for "carriage stays carriage only if it can't choose."
- Distinct-family review of this analysis before it feeds `/review-task-plan solar-system-scoped-mind`.

```

## Your response

Answer the task from your slot's perspective. 300-800 words. Be specific. Cite file paths with line numbers where relevant.
