# Claude Prompt Pack: Project Health And Runtime Alignment

Prompt pack for fixing project/workspace health checks that currently rely on generic `outputs/` assumptions instead of framework contracts and runtime reality.

Primary target files:
- [`tools/workspace/validate-workspace.js`](../../tools/workspace/validate-workspace.js)
- [`tools/workspace/scaffold-project.js`](../../tools/workspace/scaffold-project.js)
- [`frameworks/deliverables/presentation-review/runtime/project_pack/framework/runner/cli.js`](../../frameworks/deliverables/presentation-review/runtime/project_pack/framework/runner/cli.js)
- [`frameworks/deliverables/scope-verification/runtime/project_pack/framework/runner/cli.js`](../../frameworks/deliverables/scope-verification/runtime/project_pack/framework/runner/cli.js)
- [`frameworks/deliverables/version-reconciliation/runtime/project_pack/framework/runner/cli.js`](../../frameworks/deliverables/version-reconciliation/runtime/project_pack/framework/runner/cli.js)
- [`tools/workspace/validate-output.js`](../../tools/workspace/validate-output.js)
- [`tools/workspace/lib/output-contract.js`](../../tools/workspace/lib/output-contract.js)
- [`.claude/commands/project-status.md`](../../.claude/commands/project-status.md)
- [`.claude/commands/system-status.md`](../../.claude/commands/system-status.md)

## Prompt 1: Coordinator Kickoff

```text
Fix the project/workspace health checks in Mythos so they match framework-specific runtime and output contracts.

Read these files first:
- `_dev/prompts/claude-health-remediation-playbook.md`
- `tools/workspace/validate-workspace.js`
- `tools/workspace/scaffold-project.js`
- `tools/workspace/validate-output.js`
- `tools/workspace/lib/output-contract.js`
- `.claude/commands/project-status.md`
- `.claude/commands/system-status.md`
- the runtime CLI files for the deliverables frameworks

Goal:
- remove or reduce hardcoded generic assumptions like `outputs/` where framework contracts already define the real output shape
- align project validation, runtime status reporting, and operator-facing status prompts

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents:
   - one for workspace/runtime mismatch inventory
   - one for operator/status command mismatch inventory
4. Synthesize findings.
5. Implement the fixes in the main thread unless the runtime CLI write surface is cleanly separable.
6. Add tests where practical.
7. Run validation.
8. Launch one read-only completion audit.

Acceptance criteria:
1. Project/workspace validation derives expected outputs from framework metadata or a single shared contract source, not scattered hardcoded assumptions.
2. Deliverables framework runtime CLIs validate the correct output directories.
3. Status-oriented docs/prompts no longer claim a generic `outputs/` flow when framework-specific outputs are used.
4. The implementation does not regress `wordpress/qa`.
5. Any remaining generic assumptions are explicit and justified.

Constraints:
- prefer shared logic over framework-specific branching where practical
- keep changes targeted
- do not invent runtime behavior that the repo does not support

Final response must include:
- changed files
- validations run
- any remaining framework exceptions
```

## Prompt 2: Explorer A - Workspace And Runtime Mismatch Inventory

```text
You are a read-only Task subagent.

Purpose:
Find mismatches between project validation logic and actual framework runtime/output layouts.

Read:
- `tools/workspace/validate-workspace.js`
- `tools/workspace/scaffold-project.js`
- `tools/workspace/validate-output.js`
- `tools/workspace/lib/output-contract.js`
- runtime CLI files for:
  - `deliverables/presentation-review`
  - `deliverables/scope-verification`
  - `deliverables/version-reconciliation`
  - `wordpress/qa`

Return exactly these sections:

Findings
- concrete mismatches with file references

Normalization strategy
- best shared source of truth for expected project outputs and runtime checks

Risks
- likely regressions
- cases where framework-specific exceptions are unavoidable

Do not edit files.
```

## Prompt 3: Explorer B - Status Command Inventory

```text
You are a read-only Task subagent.

Purpose:
Audit status-oriented prompts/docs for stale generic assumptions.

Read:
- `.claude/commands/project-status.md`
- `.claude/commands/system-status.md`
- `README.md`
- `guides/getting-started.md`
- `tools/workspace/README.md`

Return exactly these sections:

Findings
- stale assumptions about `outputs/`, `reports/`, or project phase reporting

Update recommendations
- what should be rewritten now
- what should remain generic

Risks
- wording that could overclaim current tooling behavior

Do not edit files.
```

## Prompt 4: Optional Worker - Runtime CLI Alignment

```text
You are a write-owning Task subagent.

Ownership:
- runtime CLI files under `frameworks/deliverables/*/runtime/project_pack/framework/runner/`

You are not alone in the codebase. Do not revert edits made by others.

Task:
- align each runtime CLI `validate` or `status` behavior with the framework's real output directory and artifact expectations

Constraints:
- keep changes local to runtime CLI files
- do not edit shared workspace logic outside your ownership
- avoid introducing new framework assumptions unless already declared in framework metadata

Return:
- changed files
- exact mismatches fixed
- any shared logic still needed from the coordinator
```

## Prompt 5: Validation Prompt

```text
Validate the project health alignment remediation.

Acceptance criteria:
1. Framework-specific outputs are recognized correctly.
2. Deliverables runtime CLIs validate the right directories.
3. Status prompts/docs no longer misstate the project structure.
4. `wordpress/qa` behavior still works.

Inspect changed files and run the relevant validation commands.

Return:
- criterion-by-criterion pass/fail
- command evidence
- any remaining framework-specific exceptions
```

## Prompt 6: Completion Audit Prompt

```text
Act as a completion auditor for the project health alignment remediation.

Acceptance criteria:
1. Hardcoded generic output assumptions were reduced or centralized.
2. Runtime status and validation now match framework reality.
3. Operator-facing status instructions are no longer misleading.
4. No regression was introduced for existing mature workflows.

Inputs to inspect:
- changed files
- validation output
- any updated tests

Return:
- PASS or FAIL
- blocker, warning, and info findings
- evidence for each finding
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
