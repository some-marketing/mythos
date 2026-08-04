---
name: local-models-are-pii-lane-only
description: Operator policy 2026-08-04 — local models (opencode-local/Ollama) serve ONLY PII/credential-touching lanes for now; API minds for everything else
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a3e83da-becd-4845-b2de-1be1dca94142
  modified: 2026-08-04T19:55:03.142Z
---

Operator policy stated 2026-08-04 while shaping the `/go` skill: do not use local
models as a general cost tier yet — "API for now." The one exception is work whose
payload touches PII, credentials, or secret values: that routes to opencode-local so
bytes stay on-device.

**Why:** Local models aren't trusted/enabled as a general execution lane yet, but the
canonical dispatch-routing-rule's credential-adjacent-prefers-opencode-local guidance
still holds for sensitive payloads.

**How to apply:** When tiering dispatches (in `/go`, orchestrate-loop, or any fan-out),
mechanical work goes to haiku-class API, not local models — unless the scope carries
PII/credentials, in which case opencode-local is the lane regardless of altitude.
Revisit when the operator opts local models into general tiering. See
[[codex-dispatch-must-use-managed-bridge]].
