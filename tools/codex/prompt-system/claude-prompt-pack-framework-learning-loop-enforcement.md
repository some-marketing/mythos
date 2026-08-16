# Claude Prompt Pack: Framework Learning Loop Enforcement

Prompt pack for making the learning-and-automation doctrine operational across all framework creation, replay, promotion, and improvement flows.

Primary source material:
- [`_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`](../concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md)
- [`_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`](../FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md)
- [`_dev/FRAMEWORK_LEARNING_LOOP_IMPLEMENTATION_PLAN.md`](../FRAMEWORK_LEARNING_LOOP_IMPLEMENTATION_PLAN.md)
- [`guides/framework-promotion.md`](../../guides/framework-promotion.md)

Primary target files:
- [`tools/workspace/capture-task.js`](../../tools/workspace/capture-task.js)
- [`tools/workspace/normalize-capture.js`](../../tools/workspace/normalize-capture.js)
- [`tools/workspace/scaffold-candidate.js`](../../tools/workspace/scaffold-candidate.js)
- [`tools/workspace/replay-candidate.js`](../../tools/workspace/replay-candidate.js)
- [`tools/workspace/candidate-status.js`](../../tools/workspace/candidate-status.js)
- [`tools/workspace/promote-candidate.js`](../../tools/workspace/promote-candidate.js)
- [`tools/workspace/lib/capture-candidate.js`](../../tools/workspace/lib/capture-candidate.js)
- [`tools/workspace/schemas/`](../../tools/workspace/schemas/)

## Goal

Make framework learning mandatory and inspectable.

Desired outcome:
- every new framework candidate can collect user feedback and internal signals
- candidate maturity reflects learning evidence, not just structure
- promotion requires learning readiness
- future automation and template extraction are justified by explicit evidence

## Use This Pack When

Run this pack whenever:
- a new framework lifecycle is being added
- a framework candidate flow is being improved
- promotion thresholds are being tightened
- template extraction or new automation is being introduced

This pack should become the default implementation workflow for enforcing the doctrine on framework evolution.

## How To Use This Pack

Run this pack as four implementation tasks, in order:

1. learning artifact and schema foundation
2. candidate ledger and status integration
3. promotion-gate enforcement
4. docs and migration alignment

Then run:

5. validation
6. completion audit

Do not combine all implementation work into one task unless the repo state is already very stable.

---

## Prompt 1: Coordinator Kickoff

Use this as the initial Claude prompt.

```text
Implement the framework learning loop so it becomes the default evolution path for all framework work in Mythos.

Read these files first:
- `_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`
- `_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`
- `_dev/FRAMEWORK_LEARNING_LOOP_IMPLEMENTATION_PLAN.md`
- `guides/framework-promotion.md`
- `tools/workspace/capture-task.js`
- `tools/workspace/scaffold-candidate.js`
- `tools/workspace/replay-candidate.js`
- `tools/workspace/promote-candidate.js`
- `tools/workspace/lib/capture-candidate.js`

Goal:
- add explicit feedback and learning artifacts to the framework lifecycle
- make candidate maturity and promotion decisions depend on that evidence
- create the smallest safe implementation that starts enforcing the doctrine

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for artifact/schema design
   - one for promotion/readiness integration analysis
4. Synthesize findings in the main thread.
5. Implement the changes in bounded phases.
6. Add or update tests where practical.
7. Run validation.
8. Launch one read-only completion-auditor-style Task subagent.
9. Reopen only blocker items if needed.

Acceptance criteria:
1. The framework lifecycle can store user feedback and internal signal artifacts.
2. Candidate status can report learning maturity separately from structural maturity.
3. Promotion logic includes learning readiness, not just structural readiness.
4. Template or automation offloading decisions have an explicit evidence model.
5. Docs reflect the new mandatory learning loop.

Constraints:
- keep client-specific data out of reusable framework files
- keep changes incremental and migration-aware
- do not force immediate historical backfill for all old frameworks
- avoid broad unrelated refactors

Final response must include:
- changed files
- lifecycle artifacts introduced
- validations run
- migration gaps still remaining
```

## Prompt 2: Explorer A - Artifact And Schema Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Design the minimal artifact and schema additions needed to make the framework learning loop real.

Read:
- `_dev/FRAMEWORK_LEARNING_LOOP_ARCHITECTURE.md`
- `_dev/FRAMEWORK_LEARNING_LOOP_IMPLEMENTATION_PLAN.md`
- `tools/workspace/capture-task.js`
- `tools/workspace/normalize-capture.js`
- `tools/workspace/scaffold-candidate.js`
- `tools/workspace/schemas/`

Return exactly these sections:

Findings
- current gaps in capture and candidate artifact modeling with file references

Implementation notes
- recommended new artifacts
- recommended schema files
- safest insertion points in the workspace tooling

Risks
- likely migration friction
- placeholder-vs-required tradeoffs

Do not edit files.
```

## Prompt 3: Explorer B - Readiness And Promotion Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Audit the current readiness and promotion flow for places where learning evidence must become mandatory.

Read:
- `tools/workspace/replay-candidate.js`
- `tools/workspace/candidate-status.js`
- `tools/workspace/promote-candidate.js`
- `tools/workspace/lib/capture-candidate.js`
- `guides/framework-promotion.md`

Return exactly these sections:

Findings
- where structural readiness exists without learning readiness
- where promotion can still occur without explicit feedback evidence

Implementation notes
- safest way to extend candidate readiness
- recommended default learning thresholds
- how to separate legacy gaps from current-policy violations

Risks
- rollout risks
- thresholds that are too strict or too weak

Do not edit files.
```

## Prompt 4: Worker - Artifact Foundation And Ledger Integration

Use this as the first write-owning implementation prompt.

```text
Implement the learning-loop artifact foundation and candidate ledger integration.

Ownership:
- `tools/workspace/capture-task.js`
- `tools/workspace/normalize-capture.js`
- `tools/workspace/scaffold-candidate.js`
- `tools/workspace/candidate-status.js`
- `tools/workspace/lib/capture-candidate.js`
- `tools/workspace/schemas/*`
- any new helper under `tools/workspace/lib/`

You are not alone in the codebase. Do not revert edits by others.

Task:
- add feedback and learning artifacts to captures or candidates
- add schemas for the new artifacts
- add candidate-level learning ledger support
- surface learning maturity in candidate status

Constraints:
- do not yet over-automate template extraction
- keep migration handling explicit
- preserve compatibility where possible

Final response must include:
- changed files
- new artifacts and schemas
- how candidate status now reports learning maturity
```

## Prompt 5: Worker - Promotion Gate And Docs Alignment

Use this after Prompt 4 is complete.

```text
Implement promotion-gate enforcement and documentation alignment for the framework learning loop.

Ownership:
- `tools/workspace/replay-candidate.js`
- `tools/workspace/promote-candidate.js`
- `guides/framework-promotion.md`
- supporting workspace helper files only if required

You are not alone in the codebase. Do not revert edits by others.

Task:
- make promotion readiness include learning readiness
- keep structural blockers distinct from learning blockers
- document the new gate and how legacy frameworks should be treated during migration

Constraints:
- do not require impossible historical backfill
- make blocker messages explicit and actionable
- keep the initial thresholds conservative and easy to tune later

Final response must include:
- changed files
- exact new gate conditions
- any remaining follow-up work for legacy framework migration
```

## Prompt 6: Validation Prompt

Use this after implementation.

```text
Validate the framework learning loop enforcement work.

Acceptance criteria:
1. Feedback and learning artifacts exist in the framework lifecycle.
2. Candidate status exposes learning maturity distinctly.
3. Promotion readiness includes learning evidence.
4. The implementation is migration-aware.
5. Docs explain the new learning loop clearly.

Run the relevant validation commands and inspect changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining migration risks
```

## Prompt 7: Completion Audit Prompt

Use this as the final read-only audit.

```text
Act as a completion auditor for the framework learning loop enforcement work.

Acceptance criteria:
1. The doctrine is now backed by inspectable lifecycle artifacts.
2. Promotion can no longer rely only on structural readiness.
3. The implementation distinguishes current gaps from legacy migration gaps.
4. Future template automation must now point to explicit evidence.

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
