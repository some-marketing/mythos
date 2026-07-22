# Claude Prompt Pack: Multiagent Planning And Compliance

Detailed planning prompt pack for Claude Code that uses bounded parallel subagents, explicit workstream decomposition, and code-level verification design before implementation begins.

Primary source material:
- [`_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`](../concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md)
- [`_dev/concepts/multi-step-orchestration-abstraction.md`](../concepts/multi-step-orchestration-abstraction.md)
- [`claude-prompt-pack-subagent-autonomy-and-template-efficiency.md`](./claude-prompt-pack-subagent-autonomy-and-template-efficiency.md)
- [`claude-prompt-pack-master-prompt-and-operator-ux-hardening.md`](./claude-prompt-pack-master-prompt-and-operator-ux-hardening.md)
- [`claude-master-run-order.md`](./claude-master-run-order.md)

Primary target outputs:
- a bounded execution plan
- a parallel subagent map
- a code-level verification matrix
- an execution handoff packet with exact next commands

## Goal

Turn an ambiguous or broad initiative into a truthful implementation plan that Claude Code can execute with:
- clear bounded slices
- explicit subagent roles
- disjoint write ownership
- mandatory independent verification
- exact command and artifact expectations

Desired outcome:
- the plan is based on repo truth instead of assumptions
- planning uses parallel read-only subagents where they add real leverage
- code-level verification is designed before implementation starts
- the resulting plan can be executed without re-planning the same problem mid-run

## Why This Matters

Mythos already learned several planning lessons the hard way:
- sequencing and execution are different from authoring and reconciliation
- broad planning drifts when value-ordering is implicit
- build-agent self-reports are not enough
- multi-step work needs independent verification and gate checks
- subagents are most valuable when they gather independent evidence in parallel, not when they duplicate the coordinator

This pack turns those lessons into a reusable planning surface.

## Claude Optimization Notes

- Keep the coordinator in the main thread for judgment, synthesis, and prioritization.
- Use parallel subagents only for bounded read-only inventory or verification design work.
- Prefer 2-4 read-only subagents with distinct scopes over many near-duplicate explorers.
- Require every planned implementation slice to name its exact verification evidence up front.
- Default to one first slice and one fallback slice, not a sprawling equal-weight backlog.

Avoid:
- planning a large queue without ranking value and prerequisites
- mixing inventory, implementation, and verification into one prompt
- allowing workers to define their own success criteria after they start coding
- relying on prose compliance where code-level checks can be named

## Multi-Agent Functionality

- Main thread owns:
  - initiative framing
  - value ranking
  - bounded slice selection
  - merge of subagent findings
  - final command and handoff decisions
- Keep the main thread thin:
  - it frames the problem, issues bounded instructions, performs extra checks, and synthesizes what to communicate to the user and to the distinct-family reviewer
  - it is not the primary deep-work surface when bounded read-only subagents can gather the evidence
- Read-only subagents may own:
  - repo-truth inventory
  - dependency and architecture inventory
  - code-level verification inventory
  - risk and blocker inventory
- Write-owning workers are not used in this planning pack.
- Validation and completion audit remain read-only.
- If a later implementation run is spawned from this pack, each worker must receive a disjoint write scope and an explicit verification contract.

## Model Guidance

- Coordinator and synthesis prompts:
  - strongest planning-capable Claude path available
  - keep prioritization and tradeoff judgment in the main thread
- Explorer prompts:
  - read-only only
  - bounded to their declared inventory lane
- Verification-design prompt:
  - read-only only
  - prefer executable checks over narrative assertions
- Completion audit prompt:
  - read-only auditor posture
  - focus on plan quality, verification completeness, and execution readiness

## Recommended Execution Order

1. coordinator kickoff
2. parallel repo-truth and architecture inventory
3. parallel compliance and verification inventory
4. plan synthesis and workstream decomposition
5. verification matrix authoring
6. execution handoff packet
7. completion audit

## Prompt 1: Coordinator Kickoff

```text
Build a detailed execution plan for this initiative using Claude Code’s multiagent strengths without widening into implementation yet.

Read first:
- the user request or target initiative description
- `_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`
- `_dev/concepts/multi-step-orchestration-abstraction.md`
- `_dev/prompts/claude-prompt-pack-subagent-autonomy-and-template-efficiency.md`
- `_dev/prompts/claude-master-run-order.md`
- any directly relevant repo files for the target initiative

Goal:
- turn the initiative into a truthful bounded plan
- use parallel read-only subagents where they add distinct evidence
- define code-level verification before implementation
- end with an execution handoff that names exact next commands

Required execution pattern:
1. Read the core sources and the initiative-specific files.
2. Write a short planning frame:
   - initiative
   - desired outcome
   - constraints
   - likely first slice
   - likely verification surfaces
3. Launch exactly 3 read-only subagents in parallel:
   - repo-truth and current-state inventory
   - architecture, dependency, and integration inventory
   - code-level compliance and verification inventory
4. Synthesize the findings in the main thread.
5. Keep the main thread as coordinator only. Subagents gather the detailed evidence before any slice recommendation is finalized.
6. Define one first slice, one optional second slice, and explicit deferrals.
7. Produce a verification matrix before any implementation recommendation.
8. Produce an execution handoff packet with exact next commands.
9. Launch one read-only completion-auditor-style subagent.

Acceptance criteria:
1. The plan is evidence-backed.
2. The subagents have non-overlapping scopes.
3. The first slice is bounded and high-value.
4. Verification includes code-level checks, not only narrative review.
5. The final handoff names exact next commands and ownership boundaries.

Final response must include:
- chosen first slice
- why it is first
- which subagents ran and what each covered
- code-level verification matrix
- exact next commands
```

## Prompt 2: Explorer A - Repo Truth Inventory

```text
You are a read-only subagent.

Purpose:
Establish the current repo truth for this initiative so planning starts from existing state rather than assumptions.

Read:
- the initiative-specific files
- the most relevant current-state reports under `_dev/reports/analysis/`
- any relevant manifests, command specs, or runtime files already present

Return exactly these sections:

Findings
- what already exists with file references
- what is already complete, partially complete, or missing
- any current-state contradictions

Planning implications
- what should be treated as the first slice
- what should not be re-planned because it already exists

Risks
- stale planning risks
- duplicate-work risks

Do not edit files.
```

## Prompt 3: Explorer B - Architecture And Dependency Inventory

```text
You are a read-only subagent.

Purpose:
Identify the architectural seams, dependencies, and integration points that the plan must respect.

Read:
- the initiative-specific files
- the most relevant command, workflow, or runtime code paths
- any existing docs that define contracts or sequencing rules

Return exactly these sections:

Findings
- key modules and contracts involved
- dependency order or prerequisite constraints
- likely integration edges and drift risks

Planning implications
- safest disjoint work boundaries
- where sequencing must remain strict
- where read-only work can proceed in parallel

Risks
- coupling risks
- merge-conflict or ownership risks

Do not edit files.
```

## Prompt 4: Explorer C - Code-Level Compliance And Verification Inventory

```text
You are a read-only subagent.

Purpose:
Design the compliance surface for this initiative so the later implementation can be checked mechanically where possible.

Read:
- the initiative-specific files
- relevant tests under `tests/`
- relevant validators, scripts, or package commands
- any schemas, guardrails, or contracts that define expected behavior

Return exactly these sections:

Findings
- existing code-level checks that already cover the initiative
- gaps where compliance currently depends on prose or manual review
- the smallest useful new verification checks if implementation changes are made

Verification candidates
- exact test files or commands to run
- exact assertions that should be added if coverage is missing
- exact artifacts or signals that should exist after a correct implementation

Risks
- false confidence from weak checks
- overbuilding a test harness before the slice is stable

Do not edit files.
```

## Prompt 5: Planner - Synthesis And Workstream Decomposition

```text
Synthesize the three read-only inventories into one actionable execution plan.

Task:
- produce one bounded first slice
- produce one optional second slice only if it is a natural continuation
- explicitly defer everything else
- define disjoint ownership boundaries for any future implementation workers
- preserve value-first sequencing

Required output sections:

Current truth
- what exists
- what is missing
- what is blocked

Recommended slices
- first slice
- optional second slice
- explicit deferrals

Ownership map
- future worker 1 scope
- future worker 2 scope if needed
- files that must stay coordinator-owned

Gate checks
- what must be true before slice 2 starts
- what would force a stop after slice 1

Constraints:
- do not propose a broad queue of equal-priority work
- do not leave verification undefined
- do not assign overlapping write scopes
```

## Prompt 6: Planner - Verification Matrix Author

```text
Author the verification matrix for the planned slices.

Task:
- map each planned change area to the strongest truthful verification available
- prefer executable checks first
- use review-only checks only where no mechanical check exists

Return exactly this matrix shape:

| Planned area | Files/modules | Verification type | Exact command or check | Expected evidence | Blocking failure |

Then add:

Coverage notes
- where coverage is already strong
- where a small new test or validation should be added during implementation
- where only partial/manual verification is possible and why

Rules:
- every first-slice change area must have at least one verification row
- if a planned claim cannot be verified, mark it explicitly as unverifiable and reduce the plan’s ambition
- include signal/artifact checks when the initiative changes orchestration or control-plane behavior
```

## Prompt 7: Planner - Execution Handoff Packet

```text
Write the execution handoff packet for Claude Code.

Task:
- translate the plan and verification matrix into exact execution instructions
- optimize for a coordinator that will later launch workers and validators

Return exactly these sections:

Objective
- one-sentence description of the first slice

Read first
- exact files

Write ownership
- exact files or directories allowed for the first worker

Execution steps
- ordered flat list of the first worker’s steps

Verification steps
- ordered flat list of commands and checks

Stop conditions
- when to stop instead of widening

Next commands
- exact next command if the slice succeeds
- exact next command if the slice fails

Cross-actor handoff
- whether the slice should stay inside Claude or hand off to a distinct-family reviewer/operator
- exact handoff-note and listener steps if distinct-family reviewer feedback is required
- exact operator action item shape if no exact repo command is supportable

Rules:
- keep the packet specific enough that a worker would not need to re-plan
- do not include speculative second-slice instructions in the first-slice handoff
- if distinct-family reviewer feedback is planned, include the dispatch step (record the handoff note under `_dev/reports/signals/` and generate the review prompt) and the exact point where the handoff is closed out
- never allow the handoff packet to end on vague review language without either an exact repo command or an explicit operator action item
```

## Prompt 8: Completion Audit

```text
You are a read-only completion auditor for a planning run.

Read:
- the coordinator output
- the three explorer outputs
- the synthesis plan
- the verification matrix
- the execution handoff packet

Audit questions:
1. Does the plan start from current repo truth?
2. Did the subagents cover distinct scopes?
3. Is the first slice bounded and value-ranked?
4. Does the verification matrix provide code-level evidence where possible?
5. Can an implementation worker execute the handoff without re-planning?

Return:
- verdict
- findings first
- missing planning evidence
- missing verification evidence
- whether the plan is ready for execution
```
