---
description: Base spec for a single framework phase command
mode: FINDINGS_ONLY
---

<objective>
Execute a specific phase of the framework prompt chain as defined by the phase prompt and the manifest contract.
</objective>

<process>
- Load `guardrails.md` for execution constraints.
- Read the phase-specific prompt from the `prompts/` directory.
- Execute the instructions in the prompt, ensuring the execution mode (FINDINGS_ONLY, RUN_ONLY, etc.) is respected.
- Produce the required output artifacts for this phase.
- Verify artifacts against the expected schema or contract.
</process>

<success_criteria>
- Phase instructions followed exactly
- Outputs match the phase-specific contract
- Execution mode enforced throughout the phase
</success_criteria>
