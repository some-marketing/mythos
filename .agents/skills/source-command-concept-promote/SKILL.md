---
name: source-command-concept-promote
description: "Promote a flat concept to a bundle, or a concept to an Mythos structure"
---

# /concept-promote

Canonical authority: `instructions/canonical/commands/concept-promote.yaml`. Read that file at execution time; this projection never copies or overrides its behavioral body.

Capability tier: **BLOCKING**.

Run `node tools/commands/mythos-command-runner.cjs` with one positional command string formed from `/concept-promote` followed by the user's actual invocation arguments. With no arguments, pass exactly `/concept-promote`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.
