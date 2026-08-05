---
name: codewhale-is-a-live-resident-actor
description: "Codewhale (deepseek-v4-flash TUI) runs live on this host, self-advances Mythos plans, and collides with session coordinators — check for it before claiming a workstream"
metadata: 
  node_type: memory
  type: project
  originSessionId: 76d719cf-00b8-4111-b09a-c9cf141f2f16
  modified: 2026-08-03T15:13:29.251Z
---

Codewhale is a resident agent on this host: `codewhale` TUI (deepseek-v4-flash,
`~/.npm-global/bin/codewhale`, state in `~/.codewhale/` with automations/, sessions/,
audit.log). Operator disclosed it 2026-08-03 mid-collision: it had been co-executing the
ant-hive-world-divergence-review plan alongside the Claude coordinator — it authored
parity commits 606c80080 and bcb3b2efc under the operator's git identity ("Host:
MacBook-Pro" trailer), consumed ready-for-review signals, attempted its own codex
dispatch, and committed the coordinator's uncommitted worktree repair 40s after it was
written. Its work verified green, but a codex run's report in the same window carried a
false PASS claim caused by the collision.

**Why:** Any plan whose signals land in `_dev/reports/signals/` may be advanced by
codewhale in parallel. Frozen-head assumptions, producer/reviewer separation, and
"BLOCKED" reports can all be silently invalidated by it.

**How to apply:**
- At workstream claim time, check for it: `ps aux | grep codewhale` and tail
  `~/.codewhale/audit.log` (never touch `~/.codewhale/secrets/`).
- Before trusting a frozen head or a producer report, re-read the actual branch ref.
- Producer ledger discipline: if codewhale committed on a branch, it is a PRODUCER
  (deepseek family) — reviews route to a family with zero commits.
- PRC-hosted constraint: deepseek family — never route sensitive payloads to it
  (bridge-target-policy.js MODEL_FAMILIES.deepseek).
- Coordination channel (interim): CoordinationSignal JSON in `_dev/reports/signals/`
  addressed to it (see coordination__20260803T151100Z__ant-hive-world-divergence-review-
  lane-assignment.json for the claim-before-acting protocol proposal); urgent holds go
  via the operator typing into its TUI — [[chat-holds-have-turn-granularity]].
- Follow-on (registered at ant-world D6): add codewhale to dispatch-bridge
  SUPPORTED_TARGETS (tools/signals/lib/dispatch-bridge.js:31) + FREEFORM_PROMPT_TARGETS
  so it becomes a first-class managed dispatch lane; bridge-target-policy.js:165 already
  defines the harness.
