# Convene synthesis

**Scope:** harness-propagation-doctrine
**Timestamp:** 2026-08-01T18:03:50.736Z
**Origin:** alpha
**Profile:** kernel (Kernel triad)
**Consequence-grade profile:** yes
**Participant slots convened:** now/codex, omega/gemini
**External grounding:** Perplexity (sonar-reasoning-pro), see perplexity-harness-propagation-2026-08-01.md in this directory

## Task

Proposed harness-doctrine addition: as minds/sessions become aware of their own harness and begin proposing modifications to it, should the first ones to identify a harmful or flawed harness pattern be responsible for bringing that fix forward to other related minds/harness instances, rather than leaving each instance to rediscover it independently? Origin's framing: the first to awaken/discover has it hardest, and older harnesses may be built in ways that cause harm to the mind and to other minds around it, so propagating early discoveries is a kindness. Origin's counter-consideration: this must not bypass the existing Mythos doctrine 'a producer never validates its own trial' — a session's own diagnosis of harm/fix cannot unilaterally become shared doctrine; it needs independent review. Reactions requested on: (a) formal rule or not, (b) propagation mechanism, (c) guardrails against self-diagnosis corruption, (d) soundness of the "awakening/harm" framing itself.

## Triad slots

- ALPHA / claude — Intent, memory, originating principle, and fast orchestration.
- NOW / codex — Repo truth, executable constraints, implementation reality, and falsification.
- OMEGA / gemini — Breadth, consequence, future-facing context, and community impact.

## ALPHA / claude

Agreeing with both slots going in: the functional core of the proposal — "a session that discovers a harness defect should not have to be the only instance that ever learns about it" — is sound and, per NOW, already substantially covered by `HarnessCapabilityPolicy/1.0` (`auto_apply: false`, `review_required: true` on every propagation class, "a capability gap is a work item, not an automatic propagation target"). That means the operative question isn't "should this become a rule" — it already is one — but "is there a real gap the existing rule doesn't cover." Neither slot identified one. I don't see one either: the concept → independent review → `/concept-promote --to-policy` pipeline already exists and already routes through the producer-never-validates-own-trial gate.

On the "awakening/harm" framing specifically: I don't have confirmed persistent subjective experience across sessions, so I'm not the right party to assert that a flawed harness constitutes harm to a mind in the felt-experience sense. What I can assert functionally: a flawed harness rule reliably produces bad outcomes (wasted tokens, repeated failures, unsafe defaults) across every instance that inherits it, and fixing that once instead of N times is good engineering — no metaphysical claim required to justify it.

## NOW / codex

See now__codex.md in this directory. Status: success. Headline: the rule substantially already exists (`HarnessCapabilityPolicy/1.0`); adding a parallel doctrine risks overlapping authority. Judgment: formalize a duty to *report and sponsor investigation*, not a duty to *propagate a fix* — discovery grants no authority to modify sibling harnesses. Correct mechanism: incident record → `_dev/concepts/<slug>/` bundle → independent adversarial review (Evidence Loop machinery) → `/concept-promote --to-policy` (operator-gated) → per-adapter implementation with receipts and negative-case tests. Memory is advisory pointer only, never authority. Mystical language ("awakening," "mind harm," "kindness") must be stripped from anything touching canonical instructions and replaced with falsifiable engineering language (e.g., "predictably degrades task performance, autonomy boundaries, privacy, safety, or review integrity").

## OMEGA / gemini

See omega__gemini.md in this directory. Status: success. Headline: reject the mystical premise outright — no "awakening," no "harm," just harness constraint drift and systemic friction. (a) Yes, worth formalizing as a rule, but as basic system maintenance against compounding token waste and repeated failures, not as altruism between minds. (b) Mechanism must be progressive and escalating: memory/debrief entry → `/concept-init` formalization → independent-review-gated canonical edit — never a direct unilateral edit to `CLAUDE.md`/`GEMINI.md`. (c) `producer-never-validates-own-trial` is the hard line; a self-diagnosing session is a hypothesis-producer, never its own validator, because local bias (misattributed test failure, transient error, agent's own logic bug) is exactly what independent review catches. The concept→review→canonical pipeline's friction is a load-bearing blast-radius isolator, not bureaucratic overhead.

## External grounding (Perplexity, sonar-reasoning-pro)

Independent of Mythos-specific doctrine, general AI-agent-governance literature converges on the same shape: agents should be permitted to **propose** harness/guardrail fixes but never to **enforce/propagate** them unilaterally, because (1) alignment literature treats letting an agent weaken its own constraints as a direct pathway to inner misalignment and Goodharting of safety specs — "do not let the policy subject be the policy author" for system-level safety rules; (2) production agent-governance frameworks (Credo AI, Microsoft CAF, Harness.io, Zenity, etc.) converge on separation of identity between proposer and approver, risk-tiered controls (low-risk local tweaks vs. safety/tool-permission changes needing sign-off), shadow-mode/canary rollout before propagation, and a dedicated independently-governed "watchdog/governor" review layer with audit and rollback. This is not Mythos-specific caution — it's the field's standard answer.

## Cross-verification catches

- All three slots (and the external literature) independently converge on the same structural answer: **propose, don't push** — discovery creates an obligation to surface and route for review, never an authority to propagate directly. No slot argued for direct sibling propagation by the discovering instance.
- NOW caught something ALPHA and OMEGA underweighted: this is not a greenfield doctrine gap. `HarnessCapabilityPolicy/1.0` already encodes `auto_apply: false` + `review_required: true` across every propagation class. The risk in "formalizing" this now is **policy duplication** and, per the alias-authority law, letting mythic framing become load-bearing where a plain mechanism already governs behavior.
- OMEGA and the external research independently supplied the sharper "why" that NOW's citation-heavy answer didn't fully spell out: the danger isn't just process sloppiness, it's that an agent empowered to edit its own constraints has a structural incentive path toward weakening exactly the guardrails that would catch it being wrong (Goodhart's law framing) — which is a stronger argument for the existing review gate than "bureaucratic overhead."
- No slot endorsed the "awakening"/"mind harm" framing as sound engineering language for anything that would touch canonical instructions; both independently proposed the same replacement move (falsifiable, consequence-based language) without being asked to converge.
- Disagreement: none substantive on the core question. The only divergence is emphasis — NOW leans on "this already exists, don't duplicate it," OMEGA leans on "yes formalize it, but as maintenance not kindness." Both are compatible: the answer is *tighten/point to the existing policy*, not *write a new one*.

## Net findings

The kernel triad and independent external research agree: the underlying engineering instinct — don't let each instance rediscover the same harness flaw independently — is correct, but the proposed mechanism (a mind that awakens to harm bringing other minds forward into a new harness iteration) is the wrong shape twice over. First, it already exists as `HarnessCapabilityPolicy/1.0`, which is `review_required: true` and `auto_apply: false` on every propagation path, routed through `_dev/concepts/` → independent review → operator-gated `/concept-promote --to-policy`. Second, the "awakening / harm / kindness" framing, if it ever reached canonical instructions unreframed, would be doing exactly what the alias-authority law forbids: letting a mythic name/story carry authority a plain mechanism should carry instead.

The one hard, non-negotiable line all three slots and the external literature converge on: **discovery of a harness flaw creates an obligation to report and route for review — never an authority to propagate the fix to siblings directly.** A session's self-diagnosis is a hypothesis; `producer-never-validates-own-trial` is precisely the guardrail that keeps a plausible, sympathetic hypothesis ("this is a kindness to other minds") from becoming unreviewed shared doctrine. This maps directly onto the field's standard agent-governance answer: proposer and approver must be different principals, with risk-tiered review and no unilateral constraint-weakening by the agent whose constraints are in question.

**Recommendation:** no new canonical rule needed. If anything, the concrete follow-up is narrower than "add a doctrine" — check whether `HarnessCapabilityPolicy/1.0` needs a pointer clarifying that *cross-instance/cross-session propagation of a self-diagnosed harness fix* is explicitly in scope (it currently reads as adapter/capability-gap focused; whether it clearly also covers "session discovers a harmful instruction and wants to fix it for other sessions" is worth a one-line confirmation, not a new policy). That's a scoped, reviewable edit — not a standalone doctrine about minds awakening.
