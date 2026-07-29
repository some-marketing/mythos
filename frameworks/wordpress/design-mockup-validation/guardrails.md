# Design Mockup Validation Guardrails

## Core Rules
- Keep outputs project-scoped and non-destructive by default.
- Do not copy client-specific identifiers into framework assets.
- Escalate for human review if the task still depends on undocumented judgment.

## Execution Modes

### RUN_ONLY
- **Purpose:** Execute the mockup generation and review pipeline without modifying source inputs
- **Allowed:** Run evidence scrape, design extraction, Gemini generation, Codex review, write outputs
- **Forbidden:** Modify intake files, edit spec references, change framework files
- **Use when:** Standard mockup validation runs, iterative generation cycles

### REVIEW_ONLY
- **Purpose:** Compare produced outputs against success criteria and source evidence
- **Allowed:** Read all outputs and evidence, write review reports
- **Forbidden:** Modify outputs, re-run generation, edit framework files
- **Use when:** Post-execution quality review, operator review packet assessment

### PATCH_ALLOWED
- **Purpose:** Make minimal, targeted modifications to resolve review findings
- **Allowed:** Fix HTML output issues (accessibility, data accuracy, image consumption), update schemas, adjust prompt chain handoffs
- **Forbidden:** Large refactors, unrelated changes, modifications outside the identified issue scope
- **Constraints:**
  - Changes must be minimal and scoped to the identified issue
  - Each change must have a clear justification from the review gate
  - No "drive-by" fixes or style improvements
- **Use when:** Post-Codex-review fix pass, schema corrections, prompt chain adjustments
