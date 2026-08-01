---
description: Broadcast one bounded task to the three-lobe kernel, preserve per-lane dispatch artifacts, and produce a synthesis artifact that records convergence, disagreement, and blockers.
mode: COORDINATOR
---

<objective>
Satisfy the Cross-Verification Law for decisions of consequence by sending the same scoped task to three distinct-intelligence lanes, tracking each lane as a first-class dispatch artifact, and returning a synthetic consensus surface rather than isolated model outputs.
</objective>

<process>
- Resolve the bounded task, scope slug, and shared context set.
- Verify the three-lane roster and fail closed on any duplicate-intelligence routing. If a lane is unavailable, record it as an explicit blocked lane rather than silently reducing the convene.
- Assemble one shared prompt artifact plus any lane-specific prompt notes needed for Codex, Gemini, and the fast lobe.
- Emit or refresh one lane-scoped coordination signal per lane so the dispatch state is durable on disk before synthesis begins.
- Launch the external lanes in parallel through the trifecta runner unless --dry-run was requested.
- Collect each lane's output or blocker artifact and write a manifest recording status, duration, and artifact locations.
- Write the fast-lobe contribution after the external lanes return, then synthesize across all three lanes into one consensus artifact that names agreement, disagreement, unresolved gaps, and the net recommendation.
- Return the synthesis artifact as the operator-facing deliverable. The raw lane outputs remain supporting evidence, not the final answer.
</process>

<success_criteria>
- The same bounded task was dispatched across three distinct-intelligence lanes without scope drift.
- Each lane produced either a durable output artifact or a durable blocked-state artifact.
- The synthesis artifact captures agreement, disagreement, and unresolved blockers instead of flattening them into false consensus.
- The command leaves a traceable artifact bundle under _dev/reports/analysis/convene-runs/ plus lane state under _dev/reports/signals/.
</success_criteria>
