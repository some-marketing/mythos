# Relay — dependency-driven task assignment for Dart

**The relay-race model.** Every task knows who *should* do it (its intended
owner, held in reserve) and which upstream tasks must be `Done` before it can
start. Tasks sit **unassigned** until they are ready. When all of a task's
blockers reach `Done`, the relay hands off the baton: it assigns the task to its
owner and posts a "you're up" comment — so a person is pinged **exactly when
their work becomes doable, never before.**

## Why

Manual assignment either pings people too early (work they can't start) or
relies on someone remembering to re-assign the next step when one finishes.
Relay makes the hand-off automatic and ordered, while honoring the rule:
*never assign a task until someone is ready to work it.*

## Files

| File | Role |
|---|---|
| `relay.js` | Generic engine (pure readiness logic + thin Dart IO). |
| `<project>/relay-graph.json` | Per-project dependency graph (the manifest). |
| `_dev/state/dart-relay/<relay_id>.state.json` | Idempotency state (which nodes were activated). |
| `__tests__/relay.test.js` | Unit tests (no live network). |

## Manifest shape

```json
{
  "relay_id": "homenet-replacement",
  "nodes": [
    { "task_id": "<dart-id>", "label": "Human label",
      "intended_assignee": "Person Name", "blocked_by": ["<dart-id>", ...] }
  ]
}
```

- `intended_assignee` must match a Dart workspace user name. If the person is
  not yet a Dart user (e.g. before they're invited), the node is held as
  `ready_pending_user` and **not** assigned — it activates on a later run once
  the user exists.
- `blocked_by` may reference relay nodes *or* any other Dart task (e.g. an
  operator-setup task). A blocker that isn't a relay node still renders cleanly
  in the comment via its live Dart title.
- A node with no blockers is the entry point of its chain — ready as soon as its
  owner is a Dart user.

## Run

```bash
# Dry-run (default): prints the plan, mutates nothing.
node tools/dart-integration/relay.js --manifest <path-to-relay-graph.json>

# Apply: assigns ready tasks + posts hand-off comments, writes state.
node tools/dart-integration/relay.js --manifest <path> --apply
```

Re-running is safe and idempotent: already-activated nodes are skipped, so no
double-assignment and no duplicate comments.

## Going live (continuous hand-off)

To make hand-offs automatic, run `--apply` on a cadence. The proven pattern in
this repo is the launchd poller used by `tools/mcp/delesign` — clone it to run
relay every N minutes. **Choosing the host + cadence is the open operator input
(HomeNet dep #7, "runner owner/host + cadence").** Until that's decided, relay
is run manually with `--apply` whenever a task is marked `Done`.

## Test

```bash
node --test tools/dart-integration/__tests__/relay.test.js
```
