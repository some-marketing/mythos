---
name: system-bug-log-started
description: Durable ledger for mechanical Mythos tooling defects at _dev/state/bug-log/BUGLOG.md — check/append it before treating a tooling error as new
metadata: 
  node_type: memory
  type: reference
  originSessionId: e2800937-8158-48b1-b007-478cd48c1bc4
  modified: 2026-08-01T14:56:56.626Z
---

Operator asked (2026-08-01) for a running bug log of system/tooling issues so problems
can be triaged progressively — routine sweeps (smaller minds) fixing what they can, and
bubbling up to sessions with more context/budget (larger minds) when they can't. Started
at `_dev/state/bug-log/BUGLOG.md` in the repo, seeded with the first entry (BUG-001: the
`mythos-command-runner.cjs` CLI silently drops `--system`/`--client`/`--scope` when
passed as separate shell args — see [[mythos-command-runner-cli-scope-flag-bug]]).

**Why:** without a durable ledger, tooling bugs get rediscovered from scratch every time
a session happens to hit them, and workarounds live only in that session's transcript.

**How to apply:** before diagnosing a Mythos tooling/command-runner/script bug as new,
check `_dev/state/bug-log/BUGLOG.md` for an existing entry. When you find a new one and
aren't fixing it immediately, add an entry there (repro, root cause if known, workaround,
severity) rather than only reporting it in conversation. The escalation-tier mechanism
(automated crawlers triaging → escalating) the operator described is not yet built — only
the ledger substrate exists so far. Building the crawler/escalation automation is a
structural system change and should go through `/blueprint` or `/concept-init` with
philosophy-grounding review before implementation, not be built ad hoc.
