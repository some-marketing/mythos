---
name: intake-from-capture
description: "Intake From Capture"
skill: design-mockup-validation
mode: RUN_ONLY
---

Execute a specific phase of the framework prompt chain as defined by the phase prompt and the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Read `prompts/01_INTAKE_FROM_CAPTURE.md` for detailed procedure
3. Execute the instructions in the prompt, ensuring the execution mode (FINDINGS_ONLY, RUN_ONLY, etc.) is respected.
4. Produce the required output artifacts for this phase.
5. Verify artifacts against the expected schema or contract.
