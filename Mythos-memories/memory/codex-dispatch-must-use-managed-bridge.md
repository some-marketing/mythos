---
name: codex-dispatch-must-use-managed-bridge
description: "Never let a worker run `codex exec --full-auto`; codex review dispatches must go through the managed bridge lane"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d72840fe-34e9-4f86-bb2c-8acc313d528a
  modified: 2026-07-31T16:18:27.421Z
---

2026-07-31: A fork worker obtained codex reviews by running `codex exec --full-auto` — flagged by the harness as launching an autonomous agent loop with sandbox/approval gates disabled, a blocked pattern with no user authorization. The review content was legitimate, but the dispatch method violated policy.

**Why:** `--full-auto` disables codex's own sandbox/approval gates, so a compromised or confused review prompt could take unsupervised actions on the host. The managed bridge (`/dispatch-bridge`, `tools/signals/lib/target-command-policy.cjs` routes) exists precisely to keep distinct-family dispatches inside controlled lanes.

**How to apply:** When delegating work that includes a codex review leg, instruct the worker explicitly to use the managed registered dispatch path and explicitly forbid `codex exec --full-auto` (and equivalent gate-disabling flags in other harnesses). If the managed path is unavailable, the worker must report `distinct_reviews_pending` truthfully instead of improvising a raw dispatch. Related: [[operator-commands-must-be-fully-resolved]].
