---
name: validate-checks
description: "Prompt 03 — Validate SEO Checks"
skill: seo-validation
mode: FINDINGS_ONLY
---

Execute a specific phase of the framework prompt chain as defined by the phase prompt and the manifest contract.

1. Load `guardrails.md` for execution constraints.
2. Read `prompts/03_VALIDATE_CHECKS.md` for detailed procedure
3. Execute the instructions in the prompt, ensuring the execution mode (FINDINGS_ONLY, RUN_ONLY, etc.) is respected.
4. Produce the required output artifacts for this phase.
5. Verify artifacts against the expected schema or contract.
