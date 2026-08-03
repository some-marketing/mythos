# A dashboard that grows with the mind's understanding

> Concept seed · authored 2026-08-03T00:30Z · session c76a44f9 · branch `client-storage-cloud-drives`
> Status: ALPHA interpretation only — the opening leg of a `123|perplexity|321` evidence loop.
> Nothing here is ratified, nothing is built, no engine code is changed by this document.
> Related: [[solar-system-scoped-mind]], [[programmatic-scope-mind-assignment]],
> [[world-minds-tick-turn-operator-boundary]], Q-B channel spec + carriage-confound convene
> (`convene-runs/20260803T002158Z-pheromone-carriage-confound-fix/synthesis.md`).

## The operator's framing

The simulation should eventually carry the same elements this system carries — plans, evidence,
review, memory, gates. Presenting all of that at once would be overwhelming, both for the operator
watching and (the more interesting half) for the mind inside. So: a dashboard that **grows with
the mind's understanding of the world**, informed by research into hallucinated operating systems
and hallucinated visual interfaces.

## ALPHA's interpretation — what I think is actually being proposed

The naive reading is "progressive disclosure UI": hide panels until the run is complex enough to
need them. That reading is cheap and I believe it is wrong, because progressive disclosure is
keyed to *the observer's* attention budget. The operator's phrasing keys it to **the mind's
understanding**. That is a different object entirely.

My interpretation: **the dashboard is a rendering of the mind's world model, not a readout of the
simulator's state.** The simulator always knows the full world. The mind does not. A dashboard
keyed to the mind shows only what the mind has come to represent — and it grows a new panel, axis,
or affordance exactly when the mind acquires a new distinction. The dashboard is therefore not a
reporting layer sitting beside the sim; it is an **instrument that externalises the mind's
representation**, and its growth curve *is* a measurement of learning.

Three consequences follow, and they are the substance of this concept:

**1. The dashboard becomes a probe, not just a display.** If a panel can only appear once the mind
represents the corresponding distinction, then "did a panel appear" is an observable claim about
the mind's internals — expressible, falsifiable, loggable. This connects directly to the open
carriage question: an instrument that renders what a mind represents is precisely what "did the
mind *use* the signal, or merely get perturbed by it" has been missing. A communicated signal that
never becomes a representational distinction never earns a panel.

**2. "Hallucinated interface" is the right prior art, but the direction is inverted.** The
hallucinated-OS work (generative UI, world-model-rendered interfaces, systems that synthesise a
plausible screen on demand) generates an interface *for a human* from a model's latent state. What
is proposed here generates an interface *from the mind's* latent state, for a human observer. The
machinery may be shared; the epistemics are opposite. In the hallucinated-OS case, plausibility is
the goal and confabulation is acceptable. Here, **confabulation is the failure mode**: a dashboard
that renders a panel the mind has not actually earned is not a cosmetic bug, it is a false
measurement. Any borrowed technique must be audited for this inversion before adoption.

**3. Growth needs an earning criterion, and that criterion is the whole design.** "The dashboard
grows" is only meaningful if there is a stated, mechanical, falsifiable answer to *what earns a
panel*. Candidate criteria, none yet chosen:
  - **behavioural** — the mind's policy is measurably conditioned on a variable (ablate the
    variable, behaviour changes beyond a preregistered threshold);
  - **representational** — a probe (e.g. linear decoding) recovers the distinction from internal
    state above chance;
  - **predictive** — the mind's forward predictions about that variable beat a baseline;
  - **declarative** — the mind emits a symbol for it (only available once there is a channel, and
    circular if the channel is what's under test).
The behavioural and representational criteria are the two that do not presuppose language, so they
are where I would start. Whichever is chosen must be preregistered, because "panel appeared"
becomes evidence and a criterion invented after seeing results is not a criterion.

## What I believe is genuinely novel here

Not the growing UI — dependency-gated interfaces are old. The novel move is **binding panel
existence to an earned epistemic criterion about the observed system**, making the interface a
falsifiable instrument rather than a presentation choice. I am not aware of prior work that treats
UI element existence as a measurement claim. That is exactly the kind of claim that must go to
external research rather than be asserted from inside this session (see
[[recalled-citations-are-coin-flip]]).

## Second-order risk I want the reviewers to attack

Building this creates an incentive to make panels appear — a satisfying dashboard is one that
grows. If the earning criterion is even slightly soft, the instrument will drift toward flattering
the mind, and it will do so invisibly because a richer dashboard *looks like progress*. This is the
same failure family as the pheromone relay: an effect that tracks the medium rather than the
message. It needs a designed-in negative control — something structurally analogous to a decoy arm
— such that a mind which has learned nothing produces a dashboard that visibly does not grow.

## Open questions for the loop

- **Q1.** Is the earning criterion behavioural (ablation), representational (probing), predictive,
  or a conjunction — and what is the negative control that proves the dashboard *can* fail to grow?
- **Q2.** Does hallucinated-OS / generative-UI prior art contribute usable machinery, or only a
  misleading aesthetic given the epistemic inversion above?
- **Q3.** Who is the dashboard for — the operator (legibility), the mind (as an observation
  surface it can read, which changes the sim and re-raises every carriage confound), or a third-party
  reviewer? These need different designs, and conflating them is the most likely failure.
- **Q4.** Does a dashboard whose growth is bound to representation actually resolve, or merely
  restate, the carriage question the pheromone probe could not answer?
- **Q5.** What is the minimum viable version that produces a real measurement rather than a demo?
