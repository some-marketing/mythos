# Claude Prompt Pack: Multi-Step Orchestration Abstraction

Prompt pack for extracting the reusable execution pattern discovered in `/advance-pipeline` into a system-level orchestration policy and reusable execution primitive.

Primary source material:
- [`_dev/concepts/multi-step-orchestration-abstraction.md`](../concepts/multi-step-orchestration-abstraction.md)
- [`_dev/MULTI_STEP_ORCHESTRATION_IMPLEMENTATION_PLAN.md`](../MULTI_STEP_ORCHESTRATION_IMPLEMENTATION_PLAN.md)
- [`tools/codex/prompt-system/claude-master-run-order.md`](./claude-master-run-order.md)

Primary target files:
- canonical guardrails and generated instruction surfaces
- future `tools/orchestration/*`
- `.claude/commands/advance-pipeline.md`
- related validation/status surfaces as needed

## Goal

Make Mythos’s multi-step execution pattern reusable across plans and commands instead of keeping it embedded only inside `/advance-pipeline`.

Desired outcome:
- verification becomes a reusable orchestration law
- plan execution contracts become explicit
- `/advance-pipeline` can narrow toward a thin wrapper over a reusable primitive
- the abstraction proves itself outside one master run order

## Why This Matters

The pattern is already visible in real usage:
- build agents self-report too optimistically
- verification must be mandatory
- hardcoded stage assumptions drift
- gate/deferral logic belongs below any one command

This is execution-engine work, not framework work.

## Claude Optimization Notes

Optimize this pack for Claude by:
- preferring policy extraction and contract definition over large executor builds
- keeping the first write-owning slice narrow and auditable
- making verification and gate semantics explicit in every task
- using subagents only for bounded design/tooling inventories
- requiring concrete artifacts instead of abstract orchestration prose

Avoid Claude anti-patterns:
- jumping straight to a large reusable executor
- rewriting `/advance-pipeline` wholesale before the policy/contract is stable
- claiming generality before a second use case is actually proven

## Multi-Agent Functionality

- Main Claude thread owns orchestration-policy decisions, synthesis, and stop/go decisions.
- Use at most 2 read-only subagents for policy/contract and tooling/validation inventories.
- Use one write-owning worker slice at a time.
- Validation and completion audit remain read-only and independent of the worker.
- Do not split write ownership across multiple workers until the primitive boundary is clearer.

## Model Guidance

- Coordinator kickoff:
  - use the strongest implementation-capable Claude path available
  - keep policy and execution-boundary judgment in the main thread
- Explorer prompts:
  - use read-only Task/Explore style execution
  - bound them to inventory and contract analysis only
- Worker prompts:
  - use an implementation-capable Claude path with tool access
  - favor narrow policy/contract/status slices over broad executor work
- Validation prompt:
  - use a read-only validation posture
  - verify the claimed slice, not the full long-term abstraction
- Completion audit prompt:
  - use a read-only auditor posture
  - focus on whether the slice is credible, bounded, and truthful

## How To Use This Pack

Run this pack in four implementation tasks:

1. orchestration policy extraction
2. plan-file contract and status artifact design
3. reusable executor prototype
4. wrapper and validation alignment

Then run:

5. validation
6. completion audit

Keep the first pass bounded. Do not try to generalize every multi-step workflow in one task.

## Value Prioritization

Treat these as the highest-value aspects first:
- making independent verification reusable policy
- defining a stable plan contract
- making gate/status artifacts explicit

Treat these as later-value aspects:
- a full reusable executor with write automation
- broad generalization across many plan types before a second use case proves the need

The pack should optimize for less drift and more trustworthy execution before optimizing for abstraction elegance.

## Recommended Near-Term Slice

If this pack is used soon, start with:
1. encoding the independent-verification mandate in canonical orchestration policy
2. defining a draft plan contract from `tools/codex/prompt-system/claude-master-run-order.md`
3. standardizing stage-state and gate artifacts before building a heavier executor

Why this first:
- it reduces execution drift immediately
- it improves trust in multi-step work before deeper tooling exists
- it keeps `/advance-pipeline` usable while narrowing the future executor design surface

Do not start with:
- a full write-capable plan executor
- broad multi-plan automation before a second use case proves the need
- a large `/advance-pipeline` rewrite before policy and contract are stable

---

## Prompt 1: Coordinator Kickoff

```text
Extract Mythos’s multi-step execution pattern into a reusable orchestration abstraction.

Read these files first:
- `_dev/concepts/multi-step-orchestration-abstraction.md`
- `_dev/MULTI_STEP_ORCHESTRATION_IMPLEMENTATION_PLAN.md`
- `tools/codex/prompt-system/claude-master-run-order.md`
- `.claude/commands/advance-pipeline.md`
- `instructions/canonical/guardrails.md`
- `tools/verify/verify-system.cjs`

Goal:
- turn the proven execution pattern into system-level policy plus a reusable primitive
- keep independent verification mandatory
- avoid hardcoding stage assumptions into one command
- prioritize the highest-value slices first: policy, contract, and status artifacts before a full executor
- follow the recommended near-term slice before attempting broader executor work

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for orchestration policy and plan-contract design
   - one for execution-tooling and validation impact analysis
4. Synthesize findings in the main thread.
5. Implement exactly one bounded first slice.
6. Add or update validation where practical.
7. Run validation.
8. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. The orchestration pattern is expressed as reusable policy or primitive, not just command prose.
2. Independent verification remains mandatory and explicit.
3. A standard plan contract or prototype path exists.
4. The first pass stays bounded and does not over-generalize.
5. The implementation clearly favors the highest-value aspects before deeper abstraction.

Final response must include:
- changed files
- abstraction decisions
- validations run
- what remains intentionally deferred
- what higher-complexity executor work was deliberately not started
```

## Prompt 2: Explorer A - Policy And Plan Contract Inventory

```text
You are a read-only Task subagent.

Purpose:
Design the smallest reusable orchestration contract for Mythos.

Read:
- `_dev/concepts/multi-step-orchestration-abstraction.md`
- `_dev/MULTI_STEP_ORCHESTRATION_IMPLEMENTATION_PLAN.md`
- `tools/codex/prompt-system/claude-master-run-order.md`
- `.claude/commands/advance-pipeline.md`
- `instructions/canonical/guardrails.md`

Return exactly these sections:

Findings
- current orchestration assumptions with file references

Implementation notes
- what belongs in policy
- what belongs in a reusable primitive
- recommended plan-file contract

Risks
- over-abstraction risks
- hidden command-coupling risks
- validation gaps

Do not edit files.
```

## Prompt 3: Explorer B - Tooling And Validation Inventory

```text
You are a read-only Task subagent.

Purpose:
Audit what tooling and validation changes are needed for reusable orchestration.

Read:
- `.claude/commands/advance-pipeline.md`
- `tools/verify/verify-system.cjs`
- existing analysis/status artifacts under `_dev/reports/analysis/`

Return exactly these sections:

Findings
- current execution-state assumptions with file references

Implementation notes
- candidate reusable executor boundaries
- status artifact expectations
- validation coverage to add

Risks
- accidental behavior drift
- resume-state ambiguity
- partial refactor hazards

Do not edit files.
```

## Prompt 4: Worker - First Orchestration Abstraction Slice

```text
Implement the first bounded slice of multi-step orchestration abstraction in Mythos.

Ownership:
- canonical orchestration policy files
- future `tools/orchestration/*`
- `.claude/commands/advance-pipeline.md`
- supporting validation/tests only where required

You are not alone in the codebase. Do not revert edits by others.

Task:
- extract the smallest reusable orchestration rule or primitive
- preserve mandatory independent verification
- keep `/advance-pipeline` usable during migration
- prefer policy/contract extraction over a heavy executor build if both cannot be done cleanly in one pass
- emit concrete follow-up boundaries rather than silently widening scope

Final response must include:
- changed files
- first abstraction slice implemented
- validation changes made
- remaining follow-up work
```

## Prompt 5: Validation Prompt

```text
Validate the multi-step orchestration abstraction work.

Acceptance criteria:
1. The orchestration pattern is more reusable than before.
2. Verification remains mandatory.
3. The first pass does not overstate generality.
4. Existing execution behavior remains truthful.

Run relevant validation and inspect changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining orchestration risks
```

## Prompt 6: Completion Audit Prompt

```text
Act as a completion auditor for the multi-step orchestration abstraction work.

Acceptance criteria:
1. Mythos moved orchestration logic below a single command surface.
2. Verification discipline remains intact.
3. The abstraction is credible but still bounded.
4. The next migration steps are clear.

Return:
- PASS or FAIL
- blocker, warning, and info findings
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
