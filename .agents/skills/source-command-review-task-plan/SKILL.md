---
name: source-command-review-task-plan
description: "Review a generated task plan before execution"
---

# /review-task-plan

Canonical authority: `instructions/canonical/commands/review-task-plan.yaml`. Read that file at execution time; this projection never copies or overrides its behavioral body.

Capability tier: **BLOCKING**.

Run `node tools/commands/mythos-command-runner.cjs` with one positional command string formed from `/review-task-plan` followed by the user's actual invocation arguments. With no arguments, pass exactly `/review-task-plan`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.
