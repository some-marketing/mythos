---
name: cross-session-emits-pickup-prompt
description: "/cross-session's final message must end with ONE copy-paste-ready prompt for the next session (containing /new-session, the scope, and the order of operations)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5d29c832-456d-4d0c-8268-fc19eacb4cea
  modified: 2026-07-28T20:46:17.506Z
---

When finishing `/cross-session` (or any session-boundary handoff), the closing message must include a single fenced, copy-paste-ready prompt the operator can paste into the fresh session after clearing context. It should contain: the `/new-session <scope>` invocation, a one-line resume statement naming the handoff/plan, and the explicit order of operations including where the session must stop for operator confirmation.

**Why:** Operator feedback 2026-07-28 — the crossing summary alone made them reassemble the pickup by hand; one ideal prompt removes that friction and encodes the gates so the next session can't miss them.

**How to apply:** After writing the boundary marker, compose the prompt from the handoff's RECOMMENDED NEXT COMMAND plus its step ordering and operator gates, and place it in a code block as the final element of the closing message.
