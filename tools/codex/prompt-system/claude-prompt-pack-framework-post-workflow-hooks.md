# Claude Prompt Pack: Framework Post-Workflow Hooks

Prompt pack for implementing automatic deterministic tail hooks on framework lifecycle workflows.

Primary source material:
- [`_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md`](../FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md)
- [`_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_IMPLEMENTATION_PLAN.md`](../FRAMEWORK_POST_WORKFLOW_HOOKS_IMPLEMENTATION_PLAN.md)
- [`_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`](../concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md)

Primary target files:
- [`.claude/commands/new-framework.md`](../../.claude/commands/new-framework.md)
- [`.claude/commands/scaffold-framework.md`](../../.claude/commands/scaffold-framework.md)
- [`.claude/commands/improve-framework.md`](../../.claude/commands/improve-framework.md)
- [`.claude/commands/promote-framework.md`](../../.claude/commands/promote-framework.md)
- [`.claude/skills/manage-frameworks/workflows/create-framework.md`](../../.claude/skills/manage-frameworks/workflows/create-framework.md)
- [`.claude/skills/manage-frameworks/workflows/scaffold-framework.md`](../../.claude/skills/manage-frameworks/workflows/scaffold-framework.md)
- [`.claude/skills/manage-frameworks/workflows/improve-framework.md`](../../.claude/skills/manage-frameworks/workflows/improve-framework.md)
- [`.claude/skills/manage-frameworks/workflows/promote-framework.md`](../../.claude/skills/manage-frameworks/workflows/promote-framework.md)
- future hook runner files under `tools/framework-lifecycle/`

## Goal

Make end-of-workflow housekeeping automatic for framework lifecycle operations, while keeping explicit lifecycle transitions gated.

Desired outcome:
- framework lifecycle commands automatically run deterministic tail steps
- manifests and validations stay fresh
- completion audit and next-action artifacts are always emitted
- promotion and similar irreversible moves remain explicit

## How To Use This Pack

Run this pack in four implementation tasks:

1. hook runner and profiles
2. command/workflow integration
3. artifact generation
4. validation and docs alignment

Then run:

5. validation
6. completion audit

## Prompt 1: Coordinator Kickoff

```text
Implement automatic deterministic tail hooks for framework lifecycle workflows.

Read these files first:
- `_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md`
- `_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_IMPLEMENTATION_PLAN.md`
- `_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`
- `.claude/commands/new-framework.md`
- `.claude/commands/scaffold-framework.md`
- `.claude/commands/improve-framework.md`
- `.claude/commands/promote-framework.md`
- `.claude/skills/manage-frameworks/workflows/create-framework.md`
- `.claude/skills/manage-frameworks/workflows/improve-framework.md`
- `.claude/skills/manage-frameworks/workflows/promote-framework.md`

Goal:
- centralize deterministic tail hooks
- wire them into framework lifecycle workflows
- preserve explicit gating for irreversible transitions

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for hook runner/profile design
   - one for command/workflow integration design
4. Synthesize findings.
5. Implement the hook system in bounded phases.
6. Add or update tests where practical.
7. Run validation.
8. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. Deterministic tail steps are centralized in a reusable mechanism.
2. `new-framework`, `scaffold-framework`, `improve-framework`, and `promote-framework` each have a defined automatic hook chain.
3. Completion audit and next-action artifacts are part of the automatic tail.
4. Promotion remains explicit and gated.
5. Docs reflect the new behavior.

Final response must include:
- changed files
- hook profiles added
- workflows wired
- validations run
```

## Prompt 2: Explorer A - Hook Runner Inventory

```text
You are a read-only Task subagent.

Purpose:
Design the smallest safe hook runner and profile model for framework lifecycle tails.

Read:
- `_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md`
- `_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_IMPLEMENTATION_PLAN.md`
- `.claude/commands/new-framework.md`
- `.claude/commands/scaffold-framework.md`
- `.claude/commands/improve-framework.md`
- `.claude/commands/promote-framework.md`

Return exactly these sections:

Findings
- current duplicated deterministic tail behavior with file references

Implementation notes
- recommended hook runner structure
- recommended profile format
- safest first workflow to wire

Risks
- coupling risks
- over-automation risks

Do not edit files.
```

## Prompt 3: Explorer B - Workflow Integration Inventory

```text
You are a read-only Task subagent.

Purpose:
Audit how framework lifecycle command and workflow docs should change to reflect automatic hooks.

Read:
- `.claude/skills/manage-frameworks/workflows/create-framework.md`
- `.claude/skills/manage-frameworks/workflows/scaffold-framework.md`
- `.claude/skills/manage-frameworks/workflows/improve-framework.md`
- `.claude/skills/manage-frameworks/workflows/promote-framework.md`
- `guides/framework-promotion.md`

Return exactly these sections:

Findings
- current post-workflow steps that should become automatic

Implementation notes
- doc changes needed
- where manual gates must remain

Risks
- behavior drift between docs and code
- places where users could misunderstand automatic hooks as automatic promotion

Do not edit files.
```

## Prompt 4: Worker - Hook Runner And Profiles

```text
Implement the framework post-workflow hook runner and initial profiles.

Ownership:
- `tools/framework-lifecycle/**`
- tests related to the new hook runner only

You are not alone in the codebase. Do not revert edits by others.

Task:
- create a reusable hook runner
- add initial profiles for the key framework lifecycle workflows
- support command steps and lifecycle artifact generation
- stop on failure and preserve evidence

Final response must include:
- changed files
- profiles added
- supported step types
- remaining integration work
```

## Prompt 5: Worker - Lifecycle Command Integration

```text
Implement integration of the hook runner into framework lifecycle commands and workflow docs.

Ownership:
- `.claude/commands/new-framework.md`
- `.claude/commands/scaffold-framework.md`
- `.claude/commands/improve-framework.md`
- `.claude/commands/promote-framework.md`
- `.claude/skills/manage-frameworks/workflows/*.md`
- related docs only if needed

You are not alone in the codebase. Do not revert edits by others.

Task:
- update lifecycle docs to describe the automatic tail hooks
- wire end-of-workflow hook execution into the intended flow
- preserve explicit gates for promotion and other irreversible transitions

Final response must include:
- changed files
- which workflows now auto-run hooks
- where manual gates still remain by design
```

## Prompt 6: Validation Prompt

```text
Validate the framework post-workflow hook implementation.

Acceptance criteria:
1. Hook profiles exist for the target lifecycle workflows.
2. Deterministic tail work is centralized.
3. Docs reflect the automatic tail behavior.
4. Promotion remains explicit.
5. Failures produce inspectable artifacts.

Run relevant validation and inspect the changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining rollout risks
```

## Prompt 7: Completion Audit Prompt

```text
Act as a completion auditor for the framework post-workflow hook implementation.

Acceptance criteria:
1. Framework lifecycle workflows now end in a predictable validated state.
2. Deterministic housekeeping is no longer a manual burden.
3. The hook system does not blur automatic checks with automatic promotion.
4. Docs and behavior are aligned.

Inputs to inspect:
- changed files
- validation output
- lifecycle artifacts

Return:
- PASS or FAIL
- blocker, warning, and info findings
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
