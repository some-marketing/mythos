---
description: Chronicle — end-of-session debrief producing improve and replicate plans
argument-hint: [latest | <run-id>]
allowed-tools: [Read, Write, Glob, Grep]
---

> Authority: `debrief-run` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Write the chronicle (debrief a run): evaluate a completed execution slice by consuming the session's learnings, run artifacts, and any independent review. Produce structured improve-plan and replicate-plan outputs that close the learning loop and keep future actors from repeating completed work. This is REVIEW_ONLY — it writes analysis artifacts, it does not implement fixes.
</objective>

<process>
1. **Resolve scope.** Empty or `latest` means the most recent completed slice; a run-id means that specific slice.
2. **Read the evidence:** the session's learning notes, the stage report for the slice, and any independent review artifacts that exist for the matching scope.
3. **Evaluate from the builder's seat:** what was hard, what flowed, what surprised — friction points, spec/prompt gaps, validation misses, and patterns that worked.
4. **Classify each finding into one of two buckets:** *improve* (a local corrective change) or *replicate* (spreading a proven pattern laterally). A finding may be neither — discard anything below the threshold.
5. **Write three artifacts** under your analysis directory:
   - a short debrief markdown with 3–7 findings maximum, each citing a specific artifact or observation as evidence;
   - an improve-plan (0–3 items), each targeting a specific surface (spec, command contract, validation, closeout rule, orchestration primitive, grimoire prompt, or review gate) with a concrete suggested change, how to validate it, evidence references, and urgency;
   - a replicate-plan (0–3 items), each describing a proven pattern, what it applies to, a confidence level, evidence, and replication risk.
6. **"No lesson" is a valid output.** Do not invent findings to fill the artifacts — an empty items array is correct when the slice produced none.
7. **Answer the grimoire-delta question explicitly:** name which grimoire this slice created, improved, or executed. If the slice followed a repeatable shape no grimoire covers, recommend a capture (`/claim-spoils` or `/scribe-grimoire`). "No grimoire delta" is valid only with a stated reason.
8. If improve items target a grimoire, note that `/empower-grimoire` should consume them — do not apply the improvements here.
9. **Assess push-readiness:** if the slice changed repo truth materially and its validation surface is complete, say it is ready to commit before the next slice; if not, say why.
</process>

<review_rules>
- REVIEW_ONLY: writes analysis artifacts only. It does not implement fixes — the improve-plan recommends them; `/empower-grimoire` applies them.
- Do not fabricate lessons. An empty plan is always preferable to invented findings.
- Cite a specific file path or observation for every finding. No unsourced claims.
- The chronicle evaluates execution quality and the learning surface — it does not re-review the functional output.
</review_rules>

<success_criteria>
- Debrief markdown written with 3–7 findings max, each with evidence
- Improve-plan and replicate-plan JSON written (each may be an empty items array)
- No fabricated lessons
- Scope resolved before any artifact reading
- The grimoire-delta question answered explicitly
</success_criteria>

<handoff>
improve_items_exist: /empower-grimoire <grimoire-id>
default_next: commit the validated slice, or move to the next execution slice
no_findings: no follow-on needed
</handoff>
