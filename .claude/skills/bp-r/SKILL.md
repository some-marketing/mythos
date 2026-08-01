---
name: bp-r
description: >
  "Blueprint-reviewed" — thin wrapper chaining /blueprint (deliberate → concept-init →
  plan-task) into a pre-bubble-up research-resolve triage pass and a distinct-family
  adversarial review (default Codex, convene if BIG) before synthesis and onward routing
  through the existing /run-plan distinct-review gate. Ships ungated as a project skill.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
tags: [orchestration, blueprint, review, alias, research-resolve, distinct-review]
---

<skill>
<objective>
Provide `/bp-r <request>` — the "blueprint, researched, and reviewed" wrapper. It chains
EXISTING Mythos commands into one ergonomic flow and does not reimplement any of them:

1. **Plan/blueprint** — resolve `/blueprint <request>` (deliberate → concept-init →
   plan-task, terminal authority pinned to plan-task REVIEW_ONLY), producing a concept
   artifact and a task plan.
2. **Research-resolve** — before any operator bubble-up, triage every open question
   surfaced during blueprint/review into research-resolvable (resolve via the
   inference-cost ladder and attach cited answers) vs. operator-only (money,
   live/irreversible, scope/priority, secrets/PII, brand judgment).
3. **Distinct review** — dispatch the resulting plan to a distinct-family adversarial
   reviewer via a managed registered command (default Codex; convene the kernel triad
   only if the plan is BIG).
4. **Synthesize** — main-chain Claude synthesizes reviewer verdict + research answers
   into the finalized plan and routes onward through the existing plan-review markers.

`/bp-r` adds no new gate: it rides the existing `/run-plan` distinct-review surface.
</objective>

<activation>
- Operator types `/bp-r <request-or-task-or-task-id | path>`
- Operator asks to blueprint AND get it reviewed in one motion ("blueprint this and get
  it reviewed", "the /bp-r way")
</activation>

<process>
<step name="plan-blueprint" type="AUTO">
Resolve `/blueprint <request>` (deliberate → concept-init → plan-task; terminal authority
pinned to plan-task REVIEW_ONLY). If a consequence-grade deliberation (a `/convene`
kernel-triad run) on this exact design already exists in-session, carry it forward as the
deliberate leg rather than re-running it — do not double-deliberate. Output: a concept
artifact plus a task plan, with any open questions named.
</step>

<step name="research-resolve" type="AUTO">
Before any bubble-up to the operator, triage every open question surfaced during
blueprint/review:
- **Research-resolvable** (facts, prior art, capability/support checks, market/
  regulatory/competitive data): resolve via the inference-cost ladder — local
  tools/repo-read first, then Gemini local search, then Perplexity for open-web
  (prefer the logged-in Pro browser path `tools/ai-bridge/perplexity-browser.js`, API
  fallback `tools/ai-bridge/perplexity-api/query.js` via `run-with-op.sh`). Attach the
  cited answer into the plan/concept. Do not escalate these.
- **Operator-only** (money, live/irreversible, scope & priority, secrets/PII, brand
  judgment): these are the ONLY items that bubble up.
If a research surface is unavailable, drop to the next rung with the gap named — never
silently skip a rung.
</step>

<step name="distinct-review" type="AUTO">
Dispatch the resulting task plan to a distinct-family adversarial reviewer via a managed
registered command (e.g. `/review-task-plan <plan-id>`), not a freeform prompt. Default
reviewer = Codex for repo-truth/plan-contract review; escalate to `/convene` (kernel
triad) only when the plan is BIG (`routing_expectations.risk_tier === "high"` or
`marker.big === true`). Fable-5 is preferred-if-available but never a hard dependency.
</step>

<step name="synthesize" type="AUTO">
Main-chain Claude synthesizes the reviewer verdict and the research answers into the
finalized plan, and routes onward through the existing plan-review markers
(`distinct_reviews[]` is the authority; `distinct_reviews_pending` does not satisfy it).
No new gate is introduced — `/bp-r` rides the existing `/run-plan` review-gate surface.
</step>
</process>

<execution_rules>
<rule id="research-before-bubble-up">[PROTOCOL] — Open questions are research-resolved before any operator escalation; operator attention is the scarce last resort, never the first move.</rule>
<rule id="distinct-family-review">[PROTOCOL] — The review leg is distinct-family (review_family != author_family). Default reviewer = Codex; escalate to `/convene` only when the plan is BIG.</rule>
<rule id="fable-optional">[PROTOCOL] — Fable-5 is preferred-if-available for the review leg but degrades natively to Codex/Gemini when unavailable; it is never a hard dependency and its absence never blocks the flow.</rule>
<rule id="no-double-deliberate">[PROTOCOL] — If a consequence-grade `/convene` kernel-triad run on this exact design already exists in-session, reuse it as the deliberate leg rather than re-running it.</rule>
<rule id="ungated-surface">[PROTOCOL] — `/bp-r` is a project-space wrapper. It never requires a ConveneReceipt and never writes to `instructions/canonical/**`.</rule>
<rule id="no-new-gate">[PROTOCOL] — `/bp-r` adds no new blocking hook; it rides the existing `/run-plan` distinct-review gate. A future hard `--override-distinct-review` gate is explicitly out of scope (Layer 2, operator-gated).</rule>
<rule id="delegate-builds">[PROTOCOL] — The coordinator delegates any substantial code/file authoring to worker lanes and routes distinct review to a distinct family; it does not hand-code substantial work on the main chain.</rule>
</execution_rules>

<inputs>
<required>
A rough request, task, task-id, or path to blueprint-and-review.
</required>
<optional>
<input name="reviewer=<mind>">Override the distinct reviewer mind (default codex)</input>
</optional>
</inputs>

<outputs>
<output name="plan">Finalized task plan with research-resolved open questions attached</output>
<output name="review">Distinct-family review verdict (`distinct_reviews[]` entry)</output>
<output name="handoff">Onward routing through the existing `/run-plan` review-gate surface</output>
</outputs>

<success_criteria>
- Blueprint (deliberate → concept-init → plan-task) ran, or an existing in-session
  convene was carried forward instead of re-run.
- Every open question was triaged; research-resolvable ones were resolved and cited
  before any operator bubble-up; only operator-only items reached the operator.
- The task plan received a distinct-family review (review_family != author_family),
  escalated to convene only if BIG, with Fable-5 used if available and skipped cleanly
  if not.
- The plan was synthesized and routed through the existing `distinct_reviews[]` /
  `/run-plan` gate — no new gate was introduced.
</success_criteria>

<boundaries>
- Does NOT replace `/blueprint`, `/convene`, `/review-task-plan`, or `/run-plan` — it
  wraps and chains them.
- Does NOT write to `instructions/canonical/**` (that path is ConveneReceipt-gated) —
  `/bp-r` lives in ungated project space.
- Does NOT introduce a new enforcement hook or gate; a hard override gate is Layer-2,
  explicitly out of scope for this skill.
</boundaries>
</skill>
