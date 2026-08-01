---
name: execute-framework
description: >
  Executes a framework's prompt chain against a client project with guardrail
  enforcement. Use when running a framework against a client project.
version: 1.0.0
---

<skill>
<objective>
Execute a framework's prompt chain against a client project: collect required inputs per the manifest, run each prompt in sequence with guardrail enforcement, and validate outputs against success criteria.
</objective>

<quick_start>
1. Run `/run-framework <service/framework> <WORKSPACE>/projects/<service>__<framework>__<slug>`
2. The skill reads the framework manifest and collects required inputs
3. Each prompt executes in order with its declared execution mode enforced
4. Gate conditions pause for user input; auto steps run autonomously
5. Output reviewer validates results against framework success criteria
</quick_start>

<commands>
| Command | Workflow | Description |
|---------|----------|-------------|
| `/run-framework` | execute | Execute a framework against a project |
</commands>

<workflows>
- `workflows/intake.md` — Read manifest, collect inputs, validate
- `workflows/execute.md` — Run prompt chain with guardrail enforcement
- `workflows/review.md` — Validate outputs against success criteria, then run completion audit
</workflows>

<guardrails>
- Always read the framework's guardrails.md before execution
- Enforce the declared execution mode for each prompt
- Stop on gate conditions and wait for user input
- Never skip prompts in the chain unless the framework explicitly allows it
</guardrails>

<failure_modes>
| Condition | Action |
|-----------|--------|
| Missing manifest.json | STOP. Report missing file path. Do not proceed without valid manifest. |
| Missing guardrails.md | STOP. Report missing guardrails file path. Do not proceed without guardrails. |
| Prompt chain failure | Log which prompt failed and its inputs. Halt execution and report to user. |
| Guardrail violation | STOP immediately. Report the violated constraint and execution mode. |
</failure_modes>

<success_criteria>
- All required inputs collected and validated against manifest input_contract
- Every prompt in the chain executed in declared order
- Execution mode enforced for each prompt (no writes in FINDINGS_ONLY, etc.)
- All outputs match the manifest output_contract
- Gate conditions respected — user prompted when triggered
- Output reviewer confirms PASS on all framework success criteria
- Completion auditor confirms no blocker-level findings remain (for multi-prompt runs)
</success_criteria>
</skill>
