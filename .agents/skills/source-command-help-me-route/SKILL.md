---
name: source-command-help-me-route
description: "Human-friendly alias for /route"
---

# /help-me-route

Typed-wrapper provenance: `instructions/canonical/commands/help-me-route.yaml`. Canonical behavioral authority: `instructions/canonical/commands/route.yaml`. Read the authority file at execution time; the wrapper preserves invocation provenance but never overrides authoritative behavior.

Capability tier: **BLOCKING**.

Run `node tools/commands/mythos-command-runner.cjs` with one positional command string formed from `/help-me-route` followed by the user's actual invocation arguments. With no arguments, pass exactly `/help-me-route`. Never pass placeholder text in place of the user's arguments. The exported HANDLERS registry is the evidence for deterministic execution.
