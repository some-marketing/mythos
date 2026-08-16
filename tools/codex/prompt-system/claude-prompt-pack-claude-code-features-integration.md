# Claude Prompt Pack: Claude Code Features Integration

Prompt pack for integrating recent Claude Code capabilities into Mythos in a way that strengthens the harness layer without creating a hidden second control plane.

Primary source material:
- [`_dev/CLAUDE_CODE_FEATURES_FOR_Mythos.md`](../CLAUDE_CODE_FEATURES_FOR_Mythos.md)
- [`_dev/CLAUDE_CODE_FEATURES_IMPLEMENTATION_PLAN.md`](../CLAUDE_CODE_FEATURES_IMPLEMENTATION_PLAN.md)
- [`_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`](../concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md)
- [`_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md`](../FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md)
- [`_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`](../FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md)

Primary target files:
- [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md)
- [`.claude/settings.local.json`](../../.claude/settings.local.json)
- tracked `.claude/settings.json` if created
- [`.claude/agents/`](../../.claude/agents/)
- [`.claude/commands/project-status.md`](../../.claude/commands/project-status.md)
- future lifecycle hook runner files under `tools/framework-lifecycle/`

## Goal

Use recent Claude Code features to complement Mythos.

Desired outcome:
- tracked Claude Code policy exists in repo-safe files
- hooks complement the Mythos lifecycle runner
- governance-oriented subagents exist where useful
- local settings remain local
- Claude memory is not treated as the framework-learning ledger

## Why This Matters For The Claude Harnesses

Yes, this is specifically good for the Claude harness layer.

It affects:
- tracked harness policy via `.claude/settings.json`
- harness-triggered lifecycle hooks
- project-level subagent roles
- how Claude Code sessions load doctrine and lifecycle context

It should make the Claude harness more consistent and less dependent on local manual setup.

## How To Use This Pack

Run this pack in four implementation tasks:

1. tracked settings and policy split
2. governance subagents
3. hook integration
4. project-status and documentation alignment

Then run:

5. validation
6. completion audit

Do not combine all implementation work into one task unless the repo state is already very stable.

---

## Prompt 1: Coordinator Kickoff

Use this as the initial Claude prompt.

```text
Integrate recent Claude Code features into Mythos in a way that strengthens the Claude harness layer without creating a hidden second control plane.

Read these files first:
- `_dev/CLAUDE_CODE_FEATURES_FOR_Mythos.md`
- `_dev/CLAUDE_CODE_FEATURES_IMPLEMENTATION_PLAN.md`
- `_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`
- `_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md`
- `_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`
- `.claude/CLAUDE.md`
- `.claude/settings.local.json`
- `.claude/commands/project-status.md`
- `.claude/agents/completion-auditor.md`
- `.claude/agents/framework-auditor.md`
- `.claude/agents/framework-executor.md`
- `.claude/agents/output-reviewer.md`

Goal:
- create tracked Claude Code policy where it belongs
- preserve local-only settings where they belong
- add governance-oriented subagents where useful
- prepare hook integration around the Mythos lifecycle runner
- keep memory and lifecycle learning boundaries explicit

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for settings/hooks architecture
   - one for subagent/project-status integration
4. Synthesize findings in the main thread.
5. Implement in bounded phases.
6. Add or update docs as needed.
7. Run validation.
8. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. Shared Claude Code harness policy is represented in tracked repo files.
2. Machine-specific local settings remain in `.claude/settings.local.json`.
3. Claude Code hook usage is designed to complement the Mythos lifecycle runner.
4. Governance-oriented subagents are added only where role boundaries are clear.
5. Project-status and related docs are not left misleading.
6. No client-specific operational learning is moved into implicit Claude memory.

Constraints:
- do not commit machine-specific absolute-path allowlists into tracked settings
- do not rely on auto memory as the learning ledger
- keep hooks thin and lifecycle logic centralized
- preserve local-clients-first repo behavior

Final response must include:
- changed files
- tracked versus local settings decisions
- hook/subagent additions
- validations run
- remaining rollout risks
```

## Prompt 2: Explorer A - Settings And Hook Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Design the safest split between tracked Claude Code settings and local-only settings for Mythos.

Read:
- `_dev/CLAUDE_CODE_FEATURES_FOR_Mythos.md`
- `_dev/CLAUDE_CODE_FEATURES_IMPLEMENTATION_PLAN.md`
- `.claude/settings.local.json`
- `.claude/CLAUDE.md`

Return exactly these sections:

Findings
- what in the current local settings is clearly machine-specific
- what shared policy is currently missing from tracked files

Implementation notes
- recommended first tracked `.claude/settings.json` shape
- safest first hook events to introduce
- what should remain local-only

Risks
- secret leakage risks
- over-automation risks
- memory-boundary risks

Do not edit files.
```

## Prompt 3: Explorer B - Subagent And Status Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Evaluate where new Claude Code subagents and project-status changes would most improve the Mythos harness layer.

Read:
- `.claude/agents/completion-auditor.md`
- `.claude/agents/framework-auditor.md`
- `.claude/agents/framework-executor.md`
- `.claude/agents/output-reviewer.md`
- `.claude/commands/project-status.md`
- `_dev/FRAMEWORK_POST_WORKFLOW_HOOKS_ARCHITECTURE.md`
- `_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`

Return exactly these sections:

Findings
- current harness-role gaps
- current project-status blind spots

Implementation notes
- recommended new subagents, if any
- what project-status should recognize once hook/lifecycle artifacts exist
- what should be deferred

Risks
- overlapping agent responsibilities
- project-status becoming too opinionated too early

Do not edit files.
```

## Prompt 4: Worker - Tracked Settings And Governance Subagents

Use this as the first write-owning implementation prompt.

```text
Implement tracked Claude Code policy and any clearly justified governance subagents for Mythos.

Ownership:
- `.claude/settings.json` if created
- `.claude/CLAUDE.md`
- `.claude/agents/*.md`
- related docs only if required

You are not alone in the codebase. Do not revert edits by others.

Task:
- create a conservative tracked `.claude/settings.json`
- keep machine-specific local behavior in `.claude/settings.local.json`
- add governance-oriented subagents only where the role is clearly distinct
- document the tracked-vs-local settings split

Constraints:
- do not copy machine-specific allowlists into tracked settings
- do not introduce hooks that bypass lifecycle gating
- keep the first tracked settings version minimal

Final response must include:
- changed files
- what is now tracked
- what intentionally remains local-only
- which new subagents were added and why
```

## Prompt 5: Worker - Hook And Project-Status Alignment

Use this after Prompt 4 is complete.

```text
Implement the first safe Claude Code hook integration points and align project-status/documentation to the new harness behavior.

Ownership:
- `.claude/settings.json`
- `.claude/commands/project-status.md`
- lifecycle docs only if needed
- hook-runner integration docs only if needed

You are not alone in the codebase. Do not revert edits by others.

Task:
- add the smallest safe hook integration points that complement the Mythos lifecycle runner
- keep hooks thin
- update project-status so new lifecycle or audit surfaces are not misleading
- document any deferred hook events explicitly

Constraints:
- do not treat auto memory as the learning backend
- do not auto-promote anything through hooks
- keep the implementation compatible with local-clients-first workflows

Final response must include:
- changed files
- hook events introduced
- project-status changes
- what was deferred and why
```

## Prompt 6: Validation Prompt

Use this after implementation.

```text
Validate the Claude Code feature integration work for Mythos.

Acceptance criteria:
1. Shared Claude Code harness policy is tracked safely.
2. Local-only settings remain local.
3. Hook integration is thin and does not bypass lifecycle gates.
4. Any new subagents have clear non-overlapping roles.
5. Project-status and docs remain truthful.
6. No client-specific learning was moved into implicit memory.

Run relevant validation and inspect the changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining risks
```

## Prompt 7: Completion Audit Prompt

Use this as the final read-only audit.

```text
Act as a completion auditor for the Claude Code feature integration work.

Acceptance criteria:
1. Claude Code now complements the Mythos harness layer more effectively.
2. Repo policy is more explicit and less dependent on local machine state.
3. Hooks and subagents reinforce the nervous-system model without becoming a hidden second control plane.
4. Local-client and lifecycle-learning boundaries remain respected.

Inputs to inspect:
- changed files
- validation output
- updated harness docs and settings

Return:
- PASS or FAIL
- blocker, warning, and info findings
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
