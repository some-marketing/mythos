# Framework Execution Workflow

## Steps

1. **[AUTO] Load context** — Read manifest, guardrails, and project intake data
2. **[AUTO] Initialize run state** — Run: `npm run workspace:run:init -- --framework <id> --output <project-output-root>` to create run_state.json
3. **[AUTO] Determine prompt chain** — Get execution order from manifest
4. **[AUTO] For each prompt in chain:**
   a. Read the prompt file
   b. Set execution mode as declared
   c. Execute the prompt with project inputs
   d. Log prompt result to run_state.json via `logPromptResult` (prompt_id, result, artifacts). Artifacts are automatically propagated to `artifacts_produced` — this is the single canonical source of changed-files evidence for completion auditing.
   e. Pass outputs to next prompt as inputs
5. **[AUTO] Finalize run** — Run: `npm run workspace:run:finalize -- --run-state <path> --framework <id> --output <output-root>`
6. **[GATE: validation fails] Output validation** — If finalize reports blockers, stop and report
7. **[GATE: errors found] Error handling** — If any prompt failed, stop and report

## Post-Execution Review

8. **[AUTO] Chain to review workflow** — After execution completes successfully, follow `workflows/review.md` for output validation and completion auditing. This step ensures outputs meet the framework's output contract and acceptance criteria before the run is declared done.

## Guardrail Enforcement
- Check execution mode at each prompt boundary
- FINDINGS_ONLY prompts must not write files
- RUN_ONLY prompts must not modify source files
- PATCH_ALLOWED changes must be minimal and justified

## Output Base

All files created or updated by framework execution must be written under `<PROJECT_ROOT>/` (workspace project root or legacy Mythos project root).
