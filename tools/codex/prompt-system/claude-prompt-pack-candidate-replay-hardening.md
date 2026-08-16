# Claude Prompt Pack: Candidate Replay And Promotion Hardening

Prompt pack for turning candidate replay from a readiness stub into a more trustworthy promotion gate.

Primary target files:
- [`tools/workspace/replay-candidate.js`](../../tools/workspace/replay-candidate.js)
- [`tools/workspace/scaffold-candidate.js`](../../tools/workspace/scaffold-candidate.js)
- [`tools/workspace/lib/capture-candidate.js`](../../tools/workspace/lib/capture-candidate.js)
- [`tools/workspace/promote-candidate.js`](../../tools/workspace/promote-candidate.js)
- [`guides/framework-promotion.md`](../../guides/framework-promotion.md)

## Prompt 1: Coordinator Kickoff

```text
Harden the candidate replay and promotion flow in Mythos.

Read these files first:
- `tools/codex/prompt-system/claude-health-remediation-playbook.md`
- `tools/workspace/replay-candidate.js`
- `tools/workspace/scaffold-candidate.js`
- `tools/workspace/lib/capture-candidate.js`
- `tools/workspace/promote-candidate.js`
- `guides/framework-promotion.md`

Goal:
- make replay and promotion readiness less dependent on placeholders and weak heuristics
- improve evidence quality for repeatability claims
- keep the implementation honest about what is or is not a true replay

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch two read-only Task subagents:
   - one for replay-gate weakness inventory
   - one for candidate scaffold/promotion evidence inventory
4. Synthesize their findings.
5. Implement fixes in the main thread unless there is a cleanly separable test-only worker.
6. Add tests or fixture-based validation where practical.
7. Run validation.
8. Launch one final completion audit.

Acceptance criteria:
1. Replay status clearly distinguishes preflight from actual replay execution.
2. Promotion readiness requires stronger evidence than mere directory presence and a non-empty inputs folder.
3. Candidate scaffolding and promotion docs accurately describe the current behavior after the fix.
4. Sanitization and evidence requirements remain intact or are improved.
5. The code does not claim true replay execution unless it actually performs it.

Constraints:
- do not overbuild a full runtime if the repo is not ready for it
- prefer honest naming and stronger gates over fake automation
- keep the changes incremental and testable

Final response must include:
- changed files
- validations run
- whether replay is now stronger preflight, true replay, or both
- residual limitations
```

## Prompt 2: Explorer A - Replay Gate Weakness Inventory

```text
You are a read-only Task subagent.

Purpose:
Identify where replay and promotion claims are stronger than the current implementation supports.

Read:
- `tools/workspace/replay-candidate.js`
- `tools/workspace/lib/capture-candidate.js`
- `tools/workspace/promote-candidate.js`
- `guides/framework-promotion.md`

Return exactly these sections:

Findings
- concrete mismatches between implementation and claimed replay rigor

Minimum viable hardening
- the smallest set of code and terminology changes that would materially improve trustworthiness

Risks
- where naming changes or stronger blockers could disrupt current workflows

Do not edit files.
```

## Prompt 3: Explorer B - Candidate Scaffold Evidence Inventory

```text
You are a read-only Task subagent.

Purpose:
Evaluate whether candidate scaffolding and readiness checks are using strong enough evidence.

Read:
- `tools/workspace/scaffold-candidate.js`
- `tools/workspace/lib/capture-candidate.js`
- `guides/framework-promotion.md`

Return exactly these sections:

Findings
- weak evidence assumptions
- missing structured checks

Improvement options
- stricter capture requirements
- stronger replay-case requirements
- stronger promotion blockers

Risks
- increased operator burden
- any likely friction for legitimate lightweight candidates

Do not edit files.
```

## Prompt 4: Optional Worker - Tests And Fixtures

```text
You are a write-owning Task subagent.

Ownership:
- tests and fixtures related to workspace replay/candidate validation only

You are not alone in the codebase. Do not revert edits made by others.

Task:
- add targeted tests or fixtures that prove stronger replay/promotion gating behavior

Constraints:
- keep write scope limited to tests and fixtures
- do not modify production files outside your ownership

Return:
- changed files
- what scenarios the new tests cover
- any production-code gaps the coordinator still must handle
```

## Prompt 5: Validation Prompt

```text
Validate the candidate replay hardening work.

Acceptance criteria:
1. Replay terminology and behavior are aligned.
2. Promotion readiness uses stronger evidence.
3. Docs reflect the actual implementation.
4. Sanitization protections remain in place.

Inspect changed files and run the relevant tests/commands.

Return:
- criterion-by-criterion pass/fail
- command evidence
- any remaining limitations that should be documented explicitly
```

## Prompt 6: Completion Audit Prompt

```text
Act as a completion auditor for the candidate replay hardening remediation.

Acceptance criteria:
1. Replay claims now match actual behavior.
2. Promotion gating is stricter and evidence-based.
3. Documentation no longer overstates repeatability proof.
4. The implementation remains incremental and defensible.

Inputs to inspect:
- changed files
- validation output
- updated docs

Return:
- PASS or FAIL
- blocker, warning, and info findings
- evidence for each finding
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
