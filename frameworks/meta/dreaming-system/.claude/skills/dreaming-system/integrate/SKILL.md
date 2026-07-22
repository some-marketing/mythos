---
name: integrate
description: "Integrate a deterministic dreaming engine into the system's session lifecycle"
---

**Framework skill:** `meta/dreaming-system`
**Mode:** PATCH_ALLOWED

<skill>
<objective>
Orchestrate the full dreaming system integration: assess the corpus, build the associative engine, wire it into session hooks, surface non-obvious associations at session start, schedule periodic rebuilds, and add entity persistence.
</objective>

<process>
1. Run the prompt chain in order: 01-assess-corpus → 02-implement-scoring → 03-wire-session-hooks → 04-surface-output → 05-schedule-rebuild → 06-design-persistence → 07-verify-e2e.
2. For each prompt: read it from `prompts/`, execute the described work, verify against the prompt's gates before moving to the next.
3. If a gate fails, stop and report which gate, why it failed, and what evidence is needed to proceed.
4. After all 7 prompts complete, produce a consolidated verification artifact.
</process>

<success_criteria>
- All 7 prompts executed in order
- All gates pass
- Verification evidence artifact written
</success_criteria>
</skill>
