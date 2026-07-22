---
name: publish-or-freeze-and-handoff
description: "— Publish Or Freeze And Handoff"
skill: content-editing
mode: FINDINGS_ONLY
---

Execute a specific phase of the framework prompt chain as defined by the phase prompt and the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Read `prompts/05_PUBLISH_OR_FREEZE_AND_HANDOFF.md` for detailed procedure
3. Execute the instructions in the prompt, ensuring the execution mode (FINDINGS_ONLY, RUN_ONLY, etc.) is respected.
4. Produce the required output artifacts for this phase.
5. Verify artifacts against the expected schema or contract.
