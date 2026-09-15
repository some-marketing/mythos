---
name: source-command-debrief-run
description: "Run end-of-session debrief producing improve and replicate plans"
---

# /debrief-run

Canonical authority: `instructions/canonical/commands/debrief-run.yaml`. Read that file at execution time; this projection never copies or overrides its behavioral body.

Capability tier: **BLOCKING**.

Run `node tools/commands/mythos-command-runner.cjs` with one positional command string formed from `/debrief-run` followed by the user's actual invocation arguments. With no arguments, pass exactly `/debrief-run`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.
