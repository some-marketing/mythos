# Completion grammar fixtures

These synthetic fixtures exercise the shared completion classifier and dashboard readiness behavior. They do not represent real task outcomes or reviews. `cases.cjs` creates temporary project roots and removes them after each test.

Coverage includes accepted durable outcomes with distinct synthetic provenance, declared completion without evidence, debrief-only evidence, bare completed steps, admission-only ready/needs-review lanes with full review metadata, blocked bridge cases with and without execution evidence, and invalid outcome-delta shapes. The accepted fixture uses the existing operator-gate review lane; admission fixtures use codex-bridge and never supply execution evidence.

Run each test explicitly with `node --test`; the suites are advisory, not an automatically enforced completion gate.
