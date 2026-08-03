# Convene synthesis skeleton

**Scope:** pheromone-carriage-confound-fix
**Timestamp:** 2026-08-03T00:23:36.881Z
**Origin:** claude
**Profile:** kernel (Kernel triad)
**Consequence-grade profile:** yes
**Participant slots convened:** now/codex, omega/gemini

## Task

CONTEXT: An ant-colony simulation is being used as a low-compute training environment for embodied minds. A core empirical question — does an inter-agent communication channel actually CARRY INFORMATION that agents use, versus merely perturbing the environment — was tested with a pheromone-based relay and came back unanswerable. The authority probe established three structural reasons (see context files): (1) transport and reinforcement are the same substrate — delivering a tip calls the same additive depositPheromone write a successful gather does, so delivering fuels the medium it travels over; (2) message volume was endogenous — 7,563 tips/episode in one arm vs 463 in another on identical code, so no contrast varied only one thing; (3) there is no relayed-signal input in the policy's encoding at all (9 features, none of them 'something was said to me'), so relayed content could only reach the policy by changing world physics. Evidence: an UNINFORMATIVE fixed-tile control BEAT the real relay (-1.53 [-2.51,-0.55]), relay tips were actionable at chance rate (1.4% vs ~1.1% baseline), and effect size tracked sustained trail magnitude monotonically. Separately, the relay's stated invariants were executably false (it filtered by selecting the strongest trail, and amplified by depositing additively at the cap 97.7% of the time), and a metric bug inverted a sign (starve_crossings counted food gathers). The proposed FIX is the Q-B bulletin channel: a fixed set of read-only inbox slots attached to world state, addressed to a named recipient, written only by relay logic and read only by the recipient's sensing path — not a resource, not a tile, not a trail, consumed by no engine dynamic. Design requirement it claims to meet: reading does not strengthen the channel, delivering does not alter world physics, and message volume is a constant of the design rather than an outcome of the arm. It has survived one codex adversarial round and awaits operator ratification. YOUR TASK — adversarial, not confirmatory: does the bulletin design ACTUALLY fix the confound, or does it relocate it? Specifically: (a) name any residual path by which delivering a bulletin could still alter world dynamics or agent behavior through a route other than the intended read — including indirect routes through compute cost, action-timing, ordering, or observation-space dimensionality; (b) is holding message volume constant by design sufficient, or does it introduce a new confound (e.g. forcing null messages that themselves carry information, or decoupling volume from the world state in a way that makes the result inapplicable to a realistic channel); (c) the policy needs a NEW dedicated input for 'something was said to me' — does adding an input dimension to the encoding itself confound the comparison against a no-channel baseline, and if so what is the correct control (matched-dimensionality null input? frozen input? something else); (d) what is the minimal falsifiable experiment that would prove the bulletin channel carries information, and what result would REFUTE it — state the control arms explicitly and confirm each varies exactly one thing; (e) is there a fundamentally better instrument than a bulletin for this question that we have not considered. Be concrete and skeptical. If you believe the bulletin design is sound, say so plainly and say what would have to be true for it to fail. This is DESIGN DELIBERATION ONLY — no code is being changed by this run.

## Triad slots

- ALPHA / claude — Intent, memory, originating principle, and fast orchestration. (Claude (fast reasoning, orchestration, in-session execution))
- NOW / codex — Repo truth, executable constraints, implementation reality, and falsification. (Codex (slow rigor, code-truth verification))
- OMEGA / gemini — Breadth, consequence, future-facing context, and community impact. (Gemini (contextual breadth, reframing, big picture))

## ALPHA / claude

The bulletin spec was written to satisfy a correctly-stated requirement — reading must not
strengthen the channel, delivering must not alter world physics, volume must be a design
constant — and it does satisfy that requirement *at the level of world state*. Nothing in the
bulletin is a resource, a tile, or a trail; no engine dynamic consumes it. Against the specific
failure that killed the pheromone relay (transport and reinforcement being the same additive
write), the bulletin is a real fix.

My error, and the reason this convene was worth firing, is that I treated "not in world state"
as equivalent to "not in the causal path." It isn't. The relay's influence on the recipient does
not have to travel through `world_state` to be an environmental perturbation — it only has to
travel through *anything the recipient's behavior depends on that is not the recipient's own
weights*. Both participant slots found such a path, and neither path lives in world state.

I also under-weighted a scope question that sits above all of this: the spec's own framing binds
`confidence` into the network and leaves `tile_id` to be dereferenced afterward by a dedicated
bulletin head. Even a clean positive result under that architecture would license a narrower
claim than the one we care about. That is not a confound — it is a mismatch between the
instrument and the question, and it would have gone unnoticed until we tried to write the
conclusion.

Where I part company with OMEGA slightly: the Observation Overlay is the right *shape*, but the
overlay is not automatically confound-free — a flag that flips on a tile is a change to what
every agent observing that tile sees, so sender behavior still reaches non-recipients unless the
flag is recipient-scoped. That is fixable and does not undermine the recommendation; it means the
overlay must be delivered per-recipient, not painted on shared tile observations.

## NOW / codex

See now__codex.md in this directory. Status: success.

## OMEGA / gemini

See omega__gemini.md in this directory. Status: success.

## Cross-verification catches

**Both slots independently reached the same verdict: the bulletin does not fully fix the
confound — it relocates it out of world state and into the engine.** They found *different*
relocation paths, and neither found the other's. That convergence-on-verdict with
divergence-on-mechanism is the strongest signal this run produced.

**NOW/codex caught the substrate-adjacent paths** — the ones that need no forbidden state write:

- **RNG displacement.** One shared random stream drives action choice, forage targeting, food
  spawning, and ecosystem dynamics (`harness.js:87`, `train-tick.js:166`). If posting or
  selecting a bulletin consumes draws, the arm changes world physics purely by shifting every
  downstream sample. Requires a separate deterministic stream and draw-identical paired arms.
- **Serialization and tick-order effects.** Persisting a post through `writeWorldState`
  (`world-state.js:122`) increments `seq`, changes `written_at`, serializes more data, and
  performs an atomic file replacement — changing ordering and which hive sees which round's
  message. "Posted once per round" is underspecified until posting is pinned before both hives,
  after both, or against an immutable round-start snapshot.
- **Network-initialization non-equivalence.** An expanded network consumes extra initialization
  RNG. Exact null equivalence demands cloning the original 9×5 parameter submatrix and isolating
  init RNG — *numerical identity, not statistical similarity*.
- **Scope of the provable claim.** `tile_id` never enters the network; only `confidence` does,
  with a dedicated head dereferencing the tile afterward. A positive result therefore proves the
  policy learned to invoke a message-addressed actuator — **pointer-routing, not semantic
  interpretation**.

**OMEGA/gemini caught the dynamic path NOW missed — and it is the sharpest single finding:**

- **Exploration dilution.** The spec's non-binding claim (C4) is executably false in motion.
  A null slot masks the bulletin head, so forced exploration samples 5 actions at 20% each. The
  instant a sender posts *anything* — including pure garbage — the head unmasks and exploration
  samples 6 actions at 16.6% each. **A sender mechanically suppresses the recipient's baseline
  exploration of every other action by ~17% without touching its weights.** Sender cadence
  becomes a direct behavioral lever on the recipient.
- **The volume fix backfires through the same door.** Forcing constant write volume was meant to
  kill endogenous volume, but because non-null messages unmask and nulls mask, the *cadence of
  unmasking* is itself the binding lever. The environmental confound was traded for an
  algorithmic one.
- **`bulletin-empty` is the wrong baseline.** A permanently dormant channel proves only that
  dormancy is inert. The true baseline is the matched-cadence garbage arm (correspondence
  broken), which unmasks identically and differs in exactly one thing: whether the tile
  corresponds to the sender's state.

**Where they agree** (independently, and this is the actionable core):

- The bulletin genuinely fixes the *original* pheromone confound. Neither slot disputes that.
- The correct control is **decoy/garbage at matched cadence**, never `no-channel` or
  `bulletin-empty`. NOW calls it `decoy`, OMEGA calls it `bulletin-false`/`F1=no`; same arm.
- A positive control gate must run first — NOW's "sensitivity control," OMEGA's
  "listening-necessary" arm. If the agent cannot learn to listen when survival strictly depends
  on it, the instrument is deaf and every downstream null is meaningless. **Failing the gate
  means "unanswerable," not "refuted."**
- Both propose escaping mutable world state entirely, and their proposals converge in substance:
  NOW wants an immutable side-channel argument passed straight to `encodeState`/`decide`,
  replayed into paired receivers, intervening only at the receiver boundary; OMEGA wants an
  Observation Overlay that adds no action head, keeps the action space at 5, and lets the agent
  condition its existing `gather` verb on a new feature. NOW independently arrives at OMEGA's
  core prescription from the semantic angle — *"encode the tile itself, not merely confidence,
  and give the receiver ordinary actions rather than a message-specific gather actuator."*

**Unresolved / open:**

- **Is fixed cadence acceptable at all?** NOW accepts it as valid for a fixed-bandwidth channel
  but warns it does not generalize to voluntary communication, and demands that scope be stated
  plainly. OMEGA treats imposed cadence as itself a confound. Both are right about different
  claims; the run does not settle which claim the program actually wants.
- **Nullness stays endogenous either way.** NOW's point stands regardless of instrument: a null
  posted precisely when the sender has nothing *communicates that the sender has nothing*. Fixed
  write count is not fixed information volume. No proposal here eliminates this — it must be
  yoked across arms and acknowledged as a residual.
- **ALPHA's caveat on the overlay** (recipient-scoping) was not tested by either participant
  slot; it is an origin-slot observation carried forward unreviewed.

## Net findings

**Do not ratify the Q-B bulletin spec as written.** It is not wrong about the problem — it
correctly diagnoses why the pheromone field is structurally unable to answer the carriage
question, and it correctly removes transport-fuels-medium. But it relocates the confound rather
than eliminating it, through at least two independent routes that live outside world state: the
shared RNG stream and tick-ordering (NOW), and forced-exploration dilution from dynamic action-head
masking (OMEGA). The exploration finding is the decisive one, because it means a sender changes a
recipient's behavior *mechanically, bypassing the recipient's weights entirely* — the exact
property the design was written to forbid.

**The instrument should get lighter, not heavier.** Adding an action head tangles "did the mind
use the information" with "did the mind learn a new verb," and it is that expansion — not the
message — that produces the dilution confound. Both participant slots independently landed on the
same escape: deliver the signal into the *observation* through an immutable, replayable,
per-recipient side channel; keep the action space fixed; let the agent condition its existing
verbs on the new feature; intervene only at the receiver boundary. That design removes
serialization effects, tick-order writes, masking, dimensional shifts, and channel-state authority
in one move.

**The experiment, if built:** gate on a listening-necessary positive control (deafness ⇒
unanswerable, halt). Then contrast a true arm against a decoy arm that is byte-identical in
cadence, presence, confidence, actionability, recurrence, sender identity, and freshness —
varying *only* whether the payload corresponds to the sender's actual state. Pair the arms on
initial worlds, networks, and RNG draws; use a separate deterministic stream for channel logic;
clone corresponding weights for any architecture comparison and require numerical identity, not
statistical similarity. Carriage is supported only if true beats decoy with the gate passed. It is
refuted if a powered equivalence test places true − decoy inside a preregistered
negligible-effect interval, or decoy matches or beats true while the positive control succeeds.

**Scope honesty, carried from NOW and not to be lost:** under any design where the payload
identifier is dereferenced outside the network, a positive result licenses "the policy learned to
route through a message-addressed pointer," not "the mind interpreted communicated content." If
semantic interpretation is the actual question, the content itself must enter the encoding. Decide
which claim the program wants *before* building, because the two need different instruments.

**Profile note:** kernel profile, consequence-grade, three distinct families (claude/codex/gemini),
no duplicate-actor degradation. Design deliberation only — no code was changed by this run.
