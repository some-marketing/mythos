---
description: Ground a proposed system-level change against the operator's epistemic framework, or run a periodic drift check-in
mode: REVIEW_ONLY
---

<objective>
Check whether a proposed system-level change honors the operator's grounding philosophy, or audit recent system-level changes for drift. The canonical process dispatches the philosophy-grounding subagent. In pi, sub-agent spawning is not available — this skill provides the manual fallback path.
</objective>

<process>
- Parse $ARGUMENTS. If empty, ask the operator what to ground. If --check-in is present, use periodic mode. Otherwise, pre-change mode with the rest as the change reference.
- **Capability-gap: sub-agent.** Pi cannot natively spawn sub-agents. Apply checks manually: read _dev/research/{OPERATOR_NAME}-philosophy/grounding-patterns.md in full, apply all 16 checks to the proposed change/system state, run the disconfirmation pass, and produce an honest alignment report.
- The reading list in priority order: instructions/canonical/guardrails.md, _dev/research/{OPERATOR_NAME}-philosophy/grounding-patterns.md, _dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md (if exists), _dev/concepts/nervous-system-speed-tiers.md (if exists), _dev/concepts/orchestrator-router-worker-contract.md (if exists)
- For each of the 16 checks, produce: CHECK #N, result (aligned/in tension/misaligned), and a one-sentence rationale. After all 16, run the disconfirmation pass: actively search for reasons the change might fail the checks even if initial assessment passes.
- Present the full report to the operator. If verdict is misaligned/needs-adjustment, summarize top adjustments. If aligned but individual checks are in tension, flag them explicitly. If uncertain, report what would resolve it.
- Do NOT block work. The operator decides.
</process>

<success_criteria>
- All 16 checks assessed
- Disconfirmation pass run and reported
- Report displayed in full, not summarized
- Any tensions surfaced to operator, not buried
- No action taken without operator confirmation
</success_criteria>
