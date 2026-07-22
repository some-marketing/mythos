# Claude Prompt Pack: Semantic Output Audit Hardening

Prompt pack for improving output review beyond pure file existence and schema checks, while staying honest about the limits of deterministic validation.

Primary target files:
- [`tools/workspace/validate-output.js`](../../tools/workspace/validate-output.js)
- [`tools/workspace/lib/output-contract.js`](../../tools/workspace/lib/output-contract.js)
- [`.claude/skills/execute-framework/workflows/review.md`](../../.claude/skills/execute-framework/workflows/review.md)
- [`.claude/agents/output-reviewer.md`](../../.claude/agents/output-reviewer.md)
- [`.claude/agents/completion-auditor.md`](../../.claude/agents/completion-auditor.md)

## Prompt 1: Coordinator Kickoff

```text
Improve Mythos output auditing so it goes beyond structural existence checks without pretending semantic correctness can be made fully deterministic.

Read these files first:
- `_dev/prompts/claude-health-remediation-playbook.md`
- `tools/workspace/validate-output.js`
- `tools/workspace/lib/output-contract.js`
- `.claude/skills/execute-framework/workflows/review.md`
- `.claude/agents/output-reviewer.md`
- `.claude/agents/completion-auditor.md`

Goal:
- strengthen semantic output review expectations
- make the split between mechanical validation and LLM review explicit and actionable
- improve the evidence expected from review outputs

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch two read-only Task subagents:
   - one for mechanical-vs-semantic validation boundary analysis
   - one for review workflow / agent prompt quality analysis
4. Synthesize findings.
5. Implement changes in the main thread unless agent-prompt edits can be cleanly split.
6. Run validation.
7. Launch one completion audit.

Acceptance criteria:
1. The repo clearly distinguishes structural validation from semantic review.
2. Review workflow guidance requires evidence-backed semantic checks where appropriate.
3. Output reviewer and completion auditor prompts are aligned with the improved review expectations.
4. No deterministic script is claimed to prove business correctness it cannot actually prove.
5. The implementation remains usable for current frameworks.

Constraints:
- do not claim full semantic automation
- prefer stronger review contracts and evidence standards over vague aspirational wording
- keep changes targeted

Final response must include:
- changed files
- validations run
- what remains mechanical vs semantic after the change
- residual limitations
```

## Prompt 2: Explorer A - Validation Boundary Analysis

```text
You are a read-only Task subagent.

Purpose:
Define the correct boundary between mechanical output validation and semantic review in the current repo.

Read:
- `tools/workspace/validate-output.js`
- `tools/workspace/lib/output-contract.js`
- `tools/verify/README.md`

Return exactly these sections:

Findings
- where current validation is purely structural
- where the repo language overimplies semantic assurance

Recommendations
- what should remain mechanical
- what should move into review workflow expectations

Risks
- overengineering
- false confidence

Do not edit files.
```

## Prompt 3: Explorer B - Review Workflow And Agent Quality Analysis

```text
You are a read-only Task subagent.

Purpose:
Audit whether the review workflow and reviewer agents ask for strong enough evidence.

Read:
- `.claude/skills/execute-framework/workflows/review.md`
- `.claude/agents/output-reviewer.md`
- `.claude/agents/completion-auditor.md`

Return exactly these sections:

Findings
- weak or ambiguous review instructions
- missing evidence requirements
- places where prompt-level success criteria are assumed but not operationalized

Recommendations
- highest-value prompt changes
- wording that should explicitly separate structure checks from semantic review

Risks
- making the workflow too heavy
- overlapping reviewer and completion-auditor responsibilities

Do not edit files.
```

## Prompt 4: Optional Worker - Agent Prompt Updates

```text
You are a write-owning Task subagent.

Ownership:
- `.claude/skills/execute-framework/workflows/review.md`
- `.claude/agents/output-reviewer.md`
- `.claude/agents/completion-auditor.md`

You are not alone in the codebase. Do not revert edits made by others.

Task:
- strengthen semantic review instructions
- clarify the division of responsibility between structural validation, output review, and completion audit
- improve evidence requirements

Constraints:
- do not edit tooling files outside your ownership
- keep changes aligned with current repo behavior
- do not promise deterministic semantic guarantees

Return:
- changed files
- specific prompt-quality improvements made
- any remaining tooling gaps the coordinator should handle
```

## Prompt 5: Validation Prompt

```text
Validate the semantic output audit remediation.

Acceptance criteria:
1. Structural vs semantic validation boundaries are explicit.
2. Review workflow guidance is stronger and evidence-backed.
3. Reviewer and completion-auditor prompts are aligned.
4. The repo does not overclaim deterministic correctness.

Inspect changed files and run the relevant checks.

Return:
- criterion-by-criterion pass/fail
- evidence for each criterion
- remaining limitations
```

## Prompt 6: Completion Audit Prompt

```text
Act as a completion auditor for the semantic output audit remediation.

Acceptance criteria:
1. Mechanical and semantic validation responsibilities are clearly separated.
2. Review workflow expectations are stronger and evidence-based.
3. Agent prompts are internally consistent.
4. The implementation does not overstate its assurance level.

Inputs to inspect:
- changed files
- validation output
- relevant workflow and agent prompts

Return:
- PASS or FAIL
- blocker, warning, and info findings
- evidence for each finding
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
