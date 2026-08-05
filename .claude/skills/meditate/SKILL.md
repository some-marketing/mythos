---
name: meditate
description: >
  The blueprint-and-go loop turned inward: gather the project's own evidence
  (debriefs, run artifacts, sim harvests, memories, review verdicts), reflect on
  what the work itself teaches, look OUTWARD through Perplexity to see what the
  world knows about our discoveries, and emit bounded improvement plans that route
  through the normal blueprint → review → /go machinery. Designed as one phase of
  the standing cadence: run the sim → learn from their actions → meditate →
  improve ourselves → run again. Ships ungated as a project skill.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
tags: [self-improvement, reflection, research, orchestration, cadence]
---

<skill>
<objective>
Provide `/meditate [<focus>]` — introspection as a first-class workflow. Where `/go`
executes a plan outward, `/meditate` asks: **how do we improve MYTHOS?** — the whole
system: skills, orchestration shapes, review economics, memory practice, harness
routing, tooling, AND the simulation worlds as one province of its evidence. The
operator's frame (2026-08-05): Mythos and the simulation worlds progress in a
TICK-TOCK — we watch what happens in their world, improve ourselves from it,
improve their simulation from our introspection, and improve our introspection
from their progress. Neither world is the subject; the co-evolution is. It runs
the same cascade-down/bubble-up discipline over the system's own record:

1. **Gather (cascade down over evidence, not code)** — parallel recon workers over
   the durable record: run debriefs, evidence JSONs, sim harvests and decision
   streams, review verdicts and their finding patterns, memories, the residue
   ledger, and the sim minds' own actions (what did the hives/world-mind actually
   DO, and what does that behavior teach about the world we built for them?).
2. **Reflect (the inward pass)** — a frontier-tier synthesis over the gathered
   record: recurring failure classes (what did distinct-family review catch most —
   those are our systematic blind spots), tooling friction that cost rounds,
   design choices reality later contradicted, and what the SIM ITSELF revealed
   (the ants' behavior is data about our engine, our instruments, and our
   assumptions).
3. **Look outward (Perplexity is the world-lens)** — for each significant internal
   discovery or open question, research what the world knows: prior art, known
   pitfalls, established methods that confirm or refute our approach. Route per
   the standing research ladder: local/repo first, then the Perplexity browser
   path (tools/ai-bridge/perplexity-browser.js, logged-in Pro), API fallback
   (tools/ai-bridge/perplexity-api — call the endpoint directly; the query.js
   wrapper is known-broken). Cited answers attach to the reflection; the outward
   lens exists so internal discoveries are calibrated against the world, in both
   directions — what we can learn, and what we may have found that is genuinely
   new.
4. **Emit improvement candidates (bubble up as plans, not vibes)** — each
   improvement becomes a bounded candidate with expected benefit, cost, falsifier,
   and evidence links; ranked; the top candidates route through the NORMAL
   machinery — `/plan-task` (or /blueprint) → distinct review → `/go`. Meditation
   never self-executes improvements: it produces reviewed plans, because the
   producer of an insight must not be the judge of its worth.
5. **Cadence note — the tick-tock** — /meditate is the reflective phase of the
   standing co-evolution loop: TICK — sim rounds run, we harvest and learn from the
   minds' actions; TOCK — Mythos meditates and improves itself (skills, review
   loops, tooling, orchestration), AND improves their simulation from what
   introspection revealed; the improved world runs again, and its progress
   sharpens the next introspection. A meditation may explicitly schedule the next
   one (e.g. "after goal round 1 completes").
</objective>

<activation>
- Operator types `/meditate` or `/meditate <focus>` (e.g. `/meditate review-loop
  efficiency`, `/meditate what the ants taught us this week`).
- The standing cadence reaches its reflective phase after a completed sim round.
</activation>

<process>
<step name="gather" type="AUTO">
Fan out parallel recon workers (sonnet/haiku tier per evidence type) over: run
debriefs since the last meditation; evidence JSONs and their verdict patterns;
review artifacts (classify findings by type — the distribution IS the blind-spot
map); sim harvests + decision streams (behavioral summaries of what the minds did);
memories and the residue ledger; tooling friction notes (cwd traps, quoting
failures, classifier denials — the mechanical irritants that cost rounds). Each
worker returns structured observations with artifact citations.
</step>

<step name="reflect" type="AUTO">
Frontier-tier synthesis (disclosed) over the gathered record. Output: (a) top
recurring failure classes with counts and examples; (b) what the sim's own behavior
taught (engine truths, instrument gaps, world-design consequences); (c) design
decisions reality later contradicted; (d) open questions worth outward research;
(e) candidate improvements, each with expected benefit + falsifier.
</step>

<step name="outward-lens" type="AUTO">
For each significant discovery/open question: Perplexity research per the ladder
(browser path preferred, API endpoint fallback — never the broken query.js
wrapper). Attach cited findings: does the world confirm our approach, warn about a
known pitfall we're walking into, or suggest our result is novel? Prior-art checks
protect against reinvention; novelty signals are flagged for the operator (a
genuinely new result may deserve write-up or wider validation).
</step>

<step name="emit" type="AUTO">
Write the meditation artifact to _dev/reports/analysis/meditation__<date>.md:
observations → reflections → outward findings → ranked improvement candidates.
THEN TEXT THE OPERATOR (standing rule 2026-08-05): send an iMessage (self-chat via
the imessage tools; resolve the chat id via chat_messages if needed) with a
LAYMAN'S summary — no jargon, three short parts: "What we improved", "What we
learned", "What we'll think about next". Same ritual after every completed sim
round (the debrief's closing act). The text is a summary, never the record — the
artifacts remain the truth.
Route the top candidates: each becomes a /plan-task (or /blueprint for big ones)
with the meditation as its evidence base, then distinct review, then /go — the
skill's output is REVIEWED PLANS, never direct mutations. Update the handoff with
the meditation's verdict and the routed plans.
</step>
</process>

<execution_rules>
<rule id="meditation-never-self-executes">[INVARIANT] — /meditate produces evidence-linked improvement plans that enter the normal blueprint → distinct-review → /go pipeline. It never mutates the project directly; an insight's producer is not its judge.</rule>
<rule id="outward-lens-required">[PROTOCOL] — Significant internal discoveries get an outward Perplexity check (prior art / pitfalls / novelty) before their improvement plans are routed; unavailable research surfaces drop a rung with the gap named, never silently skipped.</rule>
<rule id="sim-is-evidence">[PROTOCOL] — The minds' behavior in harvests and decision streams is first-class evidence about OUR work (engine, instruments, world design), not just about them.</rule>
<rule id="cadence">[PROTOCOL] — Each meditation may schedule its successor relative to sim rounds; the run → learn → meditate → improve loop is the standing shape.</rule>
<rule id="go-discipline-applies">[PROTOCOL] — All /go rules apply to meditation's dispatches: disclosed minds/tiers, cascade/bubble folds, distinct-family trials for acceptance-grade judgment.</rule>
</execution_rules>

<inputs>
<required>None — an unfocused meditation surveys everything since the last one.</required>
<optional><input name="<focus>">Narrow the meditation to a theme, workstream, or question.</input></optional>
</inputs>

<outputs>
<output name="meditation">_dev/reports/analysis/meditation__<date>.md — observations, reflections, outward findings, ranked candidates</output>
<output name="routed-plans">Improvement candidates as /plan-task entries in the normal review pipeline</output>
</outputs>

<success_criteria>
- The gathered record is cited, not recalled; reflections trace to artifacts.
- Outward research attaches cited answers or named gaps for every significant discovery.
- Every improvement leaves as a bounded plan with a falsifier, entering the normal gate pipeline.
- The meditation names the next one's trigger.
</success_criteria>

<boundaries>
- Does NOT mutate code, plans, or infrastructure directly — plans only.
- Does NOT replace /debrief-run (per-run closeout) — meditation is cross-run synthesis.
- Does NOT write to instructions/canonical/**.
</boundaries>
</skill>
