# Prompt Chain Patterns

## Sequential Chain
Prompts execute in strict order. Output of N feeds input of N+1.
```
01_INTAKE → 02_PROCESS → 03_REPORT
```
Best for: Linear workflows with clear dependencies.

## Branching Chain
A decision point routes to different prompts based on conditions.
```
01_INTAKE → 02_ANALYZE → [if issue] → 03_FIX → 04_VERIFY
                         [if clean] → 05_REPORT
```
Best for: Workflows with conditional paths.

## Parallel Chain
Multiple prompts execute simultaneously on different inputs.
```
01_INTAKE → 02A_ENV_A (parallel)
          → 02B_ENV_B (parallel)
          → 02C_ENV_C (parallel)
          → 03_SYNTHESIZE
```
Best for: Multi-environment testing, multi-source analysis.

## Iteration Loop
A subset of prompts repeats until a condition is met.
```
01_INTAKE → 02_RUN → 03_CHECK → [fail] → 04_FIX → 02_RUN
                               → [pass] → 05_REPORT
```
Best for: Test-fix-verify cycles.

## Reference Prompts
Not executed directly — referenced by other prompts for shared definitions.

---

## Operator Command Flow

Mythos provides five operator-facing commands for prompt-system and pipeline work. Each command has a distinct intent boundary. Collapsing them casually creates operator confusion and harness-truth drift.

### Command Intent Map

| Command | Mode | Intent Boundary | What It Must NOT Do |
|---|---|---|---|
| `/review-progress` | REVIEW_ONLY | Observe and report on current state. Produce findings-first assessment with evidence. | Never implement, fix, or modify files beyond analysis artifacts. Never widen into execution. |
| `/author-prompt-system` | PATCH_ALLOWED | Create new prompt-system assets from `_dev` research, audits, and proposed flows. Convert intent into concrete prompt packs and master-run-order entries. | Never reconcile existing assets (that is `/assemble-prompt-system`). Never invent prompt packs without cited source material. |
| `/assemble-prompt-system` | PATCH_ALLOWED | Reconcile existing prompt-system assets for coherence. Ensure manifest, master run order, and prompt packs reference each other correctly. | Never invent new prompt packs (that is `/author-prompt-system`). Never execute pipeline stages. |
| `/plan-pipeline` | REVIEW_ONLY | Decide the next eligible stage or track. Write a planning artifact with a recommended next command and model. | Never execute the stage. Planning only. Never modify prompt-system assets. |
| `/execute-plan` | COORDINATOR | Execute exactly one stage from a compatible prompt plan using the build-verify-gate pattern. Update the plan status surface on completion. | Never skip verification. Never merge multiple stages into one task. Never proceed past human gates. |
| `/advance-pipeline` | COORDINATOR | Legacy alias for the canonical master workflow. | Prefer `/execute-plan master` for new usage. |

### Typical Operator Flow

```
/review-progress          Understand current state
       |
       v
/author-prompt-system     Create missing prompt assets (if needed)
       |
       v
/assemble-prompt-system   Reconcile prompt assets (if needed)
       |
       v
/plan-pipeline            Decide what to execute next
       |
       v
/execute-plan master     Execute the next stage in the canonical master workflow
/advance-pipeline        Legacy alias for the canonical master workflow
       |
       v
/review-progress          Verify the result independently
```

### Decision Boundaries

These transitions require explicit operator intent. They must not be automated or collapsed:

- **review -> author**: The operator decides whether observations warrant new prompt-system work
- **author -> assemble**: The operator decides whether newly authored assets need reconciliation
- **plan -> advance**: The operator decides whether to proceed with the recommended stage
- **advance -> review**: The operator decides whether to independently verify the completed stage

### Deterministic Finalize Steps

These transitions may be automated because they do not change intent:

- Manifest sync after authoring or assembly
- Instruction validation after canonical surface changes
- Expectation-failure JSON creation (always written, even when empty)

### Harness Resolution

Each command is defined in `.claude/commands/` for the Claude Code harness. Other harnesses (Codex, generic) resolve the same operation behavior through their adapter surface (`instructions/adapters/`). If a command exists in repo documentation but is not registered for the current harness, the model must say so immediately rather than simulating native support.
