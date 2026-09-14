---
name: source-command-help-me-route
description: "Human-friendly alias for /route"
---

# /help-me-route

Canonical authority: `instructions/canonical/commands/help-me-route.yaml`. Read that file at execution time; this projection never copies or overrides its behavioral body.

Capability tier: **BLOCKING**.

Run `node tools/commands/mythos-command-runner.cjs` with one positional command string formed from `/help-me-route` followed by the user's actual invocation arguments. With no arguments, pass exactly `/help-me-route`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.
