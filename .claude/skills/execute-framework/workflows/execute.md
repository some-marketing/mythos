# Framework Execution Workflow

## Steps

1. **[AUTO] Load context** — Read manifest, guardrails, and project intake data
2. **[AUTO] Initialize run state** — Run: `npm run workspace:run:init -- --framework <id> --output <project-output-root>` to create run_state.json
3. **[AUTO] Determine prompt chain and detect parallel groups** — Get execution order from manifest. For each group in `prompt_chain`:
   - If the group is a simple array (e.g., `"intake": ["01_INTAKE"]`), it is sequential (default behavior).
   - If the group is an object with `"parallel_safe": true` (e.g., `"parallel_run": {"parallel_safe": true, "prompts": ["02A_ENV_A", "02B_ENV_B"]}`), mark it for parallel execution.
   - If `parallel_safe` is absent or `false`, the group is sequential regardless of prompt count.
   - **Parallel safety is explicit opt-in only. Never infer parallel safety from array length or group structure.**
4. **[AUTO] Execute prompt chain by group:**

   **For sequential groups (default):**
   a. Read the prompt file
   b. Set execution mode as declared
   c. Spawn `framework-executor` subagent with `mode: "auto"` — subagents run autonomously without interactive permission prompts. The orchestrator retains control at gate boundaries.
   d. Log prompt result to run_state.json via `logPromptResult` (prompt_id, result, artifacts). Artifacts are automatically propagated to `artifacts_produced` — this is the single canonical source of changed-files evidence for completion auditing.
   e. Pass outputs to next prompt as inputs

   **For parallel-safe groups (`parallel_safe: true`):**
   a. Spawn one `framework-executor` subagent per prompt in the group, all with `mode: "auto"`, all simultaneously
   b. Each subagent receives the same input context (outputs from the previous group)
   c. Each subagent writes results to a temporary location (not directly to run_state.json)
   d. Wait for all subagents in the group to complete
   e. The orchestrator performs a single atomic merge of all results into run_state.json
   f. Combined outputs from all prompts in the group are passed to the next group

   **Between groups:** Always sequential. Group N must complete before group N+1 begins, regardless of parallel safety within groups.

5. **[AUTO] Finalize run** — Run: `npm run workspace:run:finalize -- --run-state <path> --framework <id> --output <output-root>`
6. **[GATE: validation fails] Output validation** — If finalize reports blockers, stop and report
7. **[GATE: errors found] Error handling** — If any prompt failed, stop and report

### Parallel-Safety Requirements

- A group must opt in explicitly via `parallel_safe: true` in the manifest `prompt_chain`.
- Parallel safety must never be inferred from array length, group name, or structural heuristics.
- Each parallel unit must have a disjoint write scope, or the orchestrator must provide an explicit merge step for shared outputs.
- If write scope is ambiguous, default to sequential execution.
- Example manifest pattern:
  ```json
  "prompt_chain": {
    "intake": ["01_INTAKE"],
    "parallel_run": {
      "parallel_safe": true,
      "prompts": ["02A_ENV_A", "02B_ENV_B", "02C_ENV_C"]
    },
    "synthesize": ["03_SYNTHESIZE"]
  }
  ```

## Post-Execution Review

8. **[AUTO] Chain to review workflow** — After execution completes successfully, follow `workflows/review.md` for output validation and completion auditing. This step ensures outputs meet the framework's output contract and acceptance criteria before the run is declared done.

## Subagent Autonomy Policy

All subagents spawned during framework execution use `mode: "auto"`. This means:
- Subagents execute without interactive permission prompts
- A background classifier reviews each action for safety and scope
- The orchestrator (this level) remains interactive — gates and escalations still require user input
- Execution modes and tool restrictions remain enforced within each agent's definition

| Agent | Mode | Rationale |
|---|---|---|
| `framework-executor` | `auto` | Write-capable; classifier validates actions against declared execution mode |
| `framework-auditor` | `auto` | Read-only tools; classifier is belt-and-suspenders |
| `output-reviewer` | `auto` | Read-only tools; no write risk |
| `completion-auditor` | `auto` | Read-only tools; no write risk |
| `extract-skill-agent` | `auto` | Write-capable; classifier validates scope |

## Guardrail Enforcement
- Check execution mode at each prompt boundary
- FINDINGS_ONLY prompts must not write files
- RUN_ONLY prompts must not modify source files
- PATCH_ALLOWED changes must be minimal and justified

## Output Base

All files created or updated by framework execution must be written under `<PROJECT_ROOT>/` (private operations project root under `clients/` or external workspace project root).
