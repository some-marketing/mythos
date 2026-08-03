---
title: "Growing dashboard as mind-legibility instrument — 123|perplexity|321 evidence loop"
scope: growing-dashboard-mind-legibility
authored: 2026-08-03T00:45Z
session: c76a44f9
branch: client-storage-cloud-drives
status: RETURN LEG COMPLETE — design deliberation only, nothing built, nothing ratified
legs:
  - "1 ALPHA/claude interpretation: _dev/concepts/growing-dashboard-mind-legibility.md"
  - "2 NOW/codex + OMEGA/gemini adversarial: convene-runs/20260803T003126Z-growing-dashboard-mind-legibility/"
  - "3 Perplexity Pro external research: 2 calls, 86 citations (see Provenance)"
  - "4 ALPHA return-leg review of each adversarial review, below"
related:
  - "convene-runs/20260803T002158Z-pheromone-carriage-confound-fix/synthesis.md"
  - "_dev/reports/analysis/evidence-loop__20260802__qb-channel-spec.md"
---

# Growing dashboard — evidence loop, return leg

## Headline

**The concept survives, the architecture does not.** External research independently
confirmed ALPHA's novelty claim (no precedent for binding interface-element existence to a
preregistered falsifiable criterion) *and* independently confirmed both reviewers' central
objection (probing a memoryless network whose inputs already name the variable proves
essentially nothing). Those two findings are compatible and together they define the build:
the idea is worth pursuing, and the current ant-world network cannot host it.

## Return-leg review of NOW/codex

**Upheld — and strengthened by research.** Codex's core move was to relocate the instrument:
the *detector* is the instrument; the dashboard merely renders a detector verdict. I accept
this. My original framing ("the dashboard externalises the mind's representation") was
imprecise in a way that matters, because it invited exactly the collapse both reviewers
predicted. The corrected statement: the dashboard is a **committed rendering surface** for a
detector, and the epistemic weight lives entirely in the detector plus its controls.

Codex's strongest technical catch — that a linear probe may succeed at initialization because
the 8-unit hidden layer is a random projection of an explicitly-supplied food feature — is
corroborated by the external research on two independent grounds. Perplexity's Q3 answer
states it directly: *"if the input already encodes the variable explicitly … then encoding it
in the hidden layer is just a transformation, not a separate world model"* and *"probing a
memoryless network whose inputs already name the variable proves essentially nothing about
learning."* Codex reached this from repo truth (`untrained-network.js:37,139`); the literature
reached it from theory. Independent convergence.

Codex's proposed missing criterion — **counterfactual generalization with causal mediation**,
requiring that intervening on the alleged internal mediator removes the behavioural change —
is squarely the causal-abstraction / interchange-intervention framework (Geiger et al. 2021;
Vig et al. NeurIPS 2020; Wang et al. IOI circuit 2022 for path patching; Redwood's causal
scrubbing). Research confirms this is the accepted stronger-than-probing standard, with
Interchange Intervention Accuracy as the operational metric. **Codex was right and named real
methodology, not an invented one.**

Where I now think codex was *incomplete*: it did not flag that its own four-arm control design
requires checkpointed weights that **do not currently exist** — it noted the gap
(`run-live.js:79`, networks live only in process memory) but treated it as a build precondition
rather than as the finding it is. That gap gates everything, including its own MVP.

## Return-leg review of OMEGA/gemini

**Upheld on mechanism, overreaching on one conclusion.**

Gemini's polysemanticity/superposition objection to ablation — that cutting a node in a small
network causes a "motor stroke rather than a cognitive lesion" — is sound and is the standard
critique. Its "Mirage Probe" negative control (a shadow probe on a time-scrambled version of
the same variable, with the panel gated on true minus decoy exceeding a preregistered margin)
is, in the literature's terms, **the control-task / selectivity design** — the same shape as
Hewitt and Liang's selectivity metric. Gemini derived a published methodology independently
without citing it. That is a point in its favour, not against: convergent derivation is
evidence the design is forced rather than arbitrary.

Its "Causal Counterfactual Injection" criterion is the same object codex called causal
mediation and the literature calls interchange intervention. **All three legs converged on one
criterion from three directions.** That is the strongest signal this loop produced, and it
should be treated as settled: passive decoding is insufficient; destructive ablation is
confounded; injection-and-measure-counterfactual-shift is the standard.

**Where I part company with gemini:** it claims the epistemic inversion *"completely
disqualifies"* generative-UI machinery. Research does not support the strong form. Perplexity's
Q4 confirms every surveyed generative-interface system (NeuralOS, GameNGen/Genie-class world
models, websim-style systems) optimises plausibility for a human viewer and that **no surveyed
system uses a generated interface as a faithful auditable readout of internal state** — which
supports the *inversion* but establishes only that the prior art is unsuitable **on the
measurement path**. Codex's narrower ruling is the correct one: generative machinery may
render a strictly-typed versioned detector result, but must never invent panel existence,
semantics, confidence, or explanatory prose. Gemini's blanket disqualification would also
forbid harmless presentation-layer use. I rule with codex.

Gemini's third "do not build" condition — *the policy is memoryless, therefore there is no
world model to measure, and the dashboard is a redundant transformation of the current input
vector* — is the single most consequential claim in the entire loop, and the research
independently confirms it.

## What external research added that no internal leg had

1. **The novelty claim is real.** Perplexity searched interpretability tooling, HCI, visual
   analytics, MLOps monitoring, capability dashboards, and preregistration practice and found
   no peer-reviewed work treating UI-element existence as a primary preregistered measurement
   outcome. Nearest neighbours (thresholded status badges; the emergent-abilities-as-mirage
   critique, Schaeffer/Miranda/Koyejo NeurIPS 2023) are visualizations *of* measurements, not
   measurement practice. **Verdict: novel, with the caveat that novelty is not value.**

2. **There is NO standard control for a growing action space.** Directly relevant to both the
   Q-B bulletin design and this dashboard. Research states plainly: NAS, progressive networks,
   DEN and POET all hold observation and action spaces CONSTANT — growth affects capacity, not
   action cardinality — so the exploration-denominator confound gemini identified in the
   carriage convene *has no canonical fix in the literature*. Changing action cardinality
   defines a different MDP, and cross-MDP comparison is known-hard. Available partial
   mitigations: match exploration entropies, use per-action metrics, or restrict the grown
   agent to its original actions at evaluation. **This independently vindicates the carriage
   convene's recommendation to keep the action space fixed and put the signal in the
   observation.**

3. **Entropy/complexity as a competence metric is defensible but documented-gameable.**
   (Folded in per an operator-supplied discussion thread, where organic systems reducing
   local entropy was the framing for why ants are a good model.) Empowerment (Klyubin/Polani/
   Nehaniv; Salge) shows information-theoretic metrics can drive real structure-building;
   active inference and dissipative adaptation (England) give theoretical grounding; assembly
   theory (Cronin/Walker) offers a complexity measure. **But the failure modes are specific and
   named:** agents maximise empowerment by confining themselves to small highly-controllable
   regions, and minimise regional entropy by trivial homogenization — filling the region with
   uniform undifferentiated material. Both are reward-hacking without understanding. Any
   entropy-based panel criterion needs an explicit anti-homogenization guard. There is no
   canonical "entropy reduction as understanding" metric — building blocks and warnings only.

## Recovered by full-thread harvest (operator correction)

The operator observed that the streaming extractor was cutting replies short and directed a
full-conversation download. Correct: the live driver's completion heuristic (6 seconds of output
stability) captured ~53k characters across two calls, while the settled thread holds **103,829
characters**. Harvesting the whole conversation recovered Q1 in full. Harvester promoted to
`tools/ai-bridge/perplexity-harvest-conversation.js`; full thread preserved at
`_dev/reports/analysis/research__20260803__growing-dashboard-mind-legibility__perplexity-full-thread.md`
(118 KB, 55 external links).

**Q1 — the minimum probing control set, now externally sourced.** There is no single codified
standard, but recommendations converge on four controls, and the first three are treated as
expected-before-belief rather than optional:

1. **Random-label control task** — Hewitt & Liang, *Designing and Interpreting Probes with
   Control Tasks*, EMNLP 2019. Same inputs and label space, labels randomly assigned; report
   **selectivity** = real accuracy − control accuracy. Their headline result is directly
   cautionary: popular ELMo probes were *not* selective, scoring similarly on real and random
   control tasks, meaning the probe's own capacity was doing the work.
2. **Random-representation / random-network baseline** — train the identical probe on a frozen
   randomly-initialized network of the same architecture, or on random projections of the
   inputs. This is exactly the control codex derived from repo truth.
3. **Probe-complexity / MDL control** — keep probes linear or near-linear for initial claims and
   prefer shorter description length, not merely higher accuracy (Voita & Titov; Pimentel et al.).
4. **Amnesic or causal intervention** — required *if* the claim is causal rather than
   correlational.

The literature adds a warning specific to this case: **work targeting 8-unit probing is thin to
non-existent**, so best practice must be extrapolated from larger networks — and because a hidden
layer that small sits so close to the inputs, the correct posture is *more* conservative, not
less. No universally accepted numeric threshold exists; report mean ± standard deviation across
seeds, demonstrate statistical significance over baselines, and treat a panel as unearned unless
the effect is large and robust.

This vindicates both reviewers: gemini's independently-derived "Mirage Probe" is Hewitt & Liang
selectivity, and codex's frozen-initialization arm is the random-representation baseline. Neither
cited the literature; both reconstructed it.

**Q8 (dashboard/observer bias in ML) was never answered** — it does not appear anywhere in the
settled thread, so this is a genuine gap in the research leg, not an extraction artifact. The
second-order risk ALPHA raised (a soft criterion drifting toward flattering the mind because a
growing dashboard looks like progress) therefore remains **unsupported by external evidence** and
rests on internal reasoning alone.

**Citation caution stands** ([[recalled-citations-are-coin-flip]]): the identifiers above are as
reported by Perplexity with citation links attached and have not been individually opened.
Live-verify before any of them enter a ratifiable artifact.

## Net position

**The blocking fact:** the ant-world policy is a 9→8→5 memoryless feedforward network whose
inputs already explicitly name food, wood, territory, structures, and trail strengths, and whose
weights are never checkpointed (`run-live.js:79`). Under those three conditions the dashboard
cannot measure anything — there is no latent state distinct from the current observation, any
probe recovers what was handed in, and no offline re-analysis is even possible. **The concept is
not blocked by its design; it is blocked by the substrate it would measure.**

Three preconditions, in order, before any panel is built:

1. **Checkpoint weights.** Nothing offline, replayable, or seed-paired is possible until the
   networks persist. This is cheap and useful regardless of whether the dashboard is ever built.
2. **Give the mind something to represent that is not handed to it.** Either partial
   observability (so latent state exists), or recurrence/memory (so state persists), or both.
   Without this there is no world model to render, and gemini's "do not build" condition holds.
3. **Preregister one distinction and its full control set** — true arm, frozen-initialization
   arm, permuted-within-bins arm, matched decoy variable — plus a positive control that is
   known-learnable. Failure to grow must be distinguishable from detector deafness.

**Minimum viable instrument** (both reviewers converged, and I concur): operator-only,
non-generative, zero visual elements — one preregistered distinction, evaluated offline from
checkpointed weights on held-out paired states, printing a binary verdict to a terminal, with
the four-arm control. If that produces a real measurement, the UI is a trivial afterthought. If
it cannot, no amount of interface work rescues it.

**Do not let the mind read the dashboard.** All three legs agree, and the research supplies the
mechanism: a readable dashboard re-enters the observation space, and every confound from the
carriage convene returns — plus the literature confirms there is no standard control for the
action-space growth it would imply. Operator-only is the only safe design at this stage.

## Provenance

- ALPHA interpretation: `_dev/concepts/growing-dashboard-mind-legibility.md` (this session).
- Adversarial reviews: `_dev/reports/analysis/convene-runs/20260803T003126Z-growing-dashboard-mind-legibility/`
  (now__codex.md, omega__gemini.md), kernel profile, consequence-grade, three distinct families.
- External research: Perplexity Pro, 2026-08-03T00:38Z and 00:43Z, 29 + 57 citations.
  Conversations `a285d5fc-89a0-49bc-989b-42a5eda4f82c`. Raw markdown retained in session
  scratchpad (not committed — scratchpad is ephemeral; re-run if needed).
- Citation caution: every identifier above is as reported by Perplexity with citation links and
  has NOT been individually opened and verified. Before any of these enter a ratifiable artifact,
  live-verify per [[recalled-citations-are-coin-flip]].
