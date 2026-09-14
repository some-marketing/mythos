---
name: source-command-route
description: "Advisory operator-intent router for common Mythos workflow wording Aliases resolved at generation time: /help-me-route."
---

# /route

Canonical authority: `instructions/canonical/commands/route.yaml`. Read that file at execution time; this projection never copies or overrides its behavioral body.

Capability tier: **BLOCKING**.

Run `node tools/commands/mythos-command-runner.cjs` with one positional command string formed from `/route` followed by the user's actual invocation arguments. With no arguments, pass exactly `/route`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.
