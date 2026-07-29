# Response Checker — operator answers → resume packets for Dart

Watches Dart for **operator answers** to "Decision Needed" tasks and turns each
answer into a resume packet + a handoff-signal file (schema `DartHandoffSignal/1.0`) + acknowledgement comment,
so a human or `/orchestrate-loop` can pick the work back up exactly when the
operator replies. Companion to [Relay](RELAY.md): relay assigns *forward* when
blockers finish; the response checker resumes *backward* when the operator
decides.

## Why

"Decision Needed" tasks assigned to the operator's own Dart user account
otherwise stall silently until someone re-reads the board.
This poller closes that loop: the moment the operator answers, the blocked work
gets a durable resume packet and a live signal pointing at the exact next move.

## Files

- `operator-response-poller.js` — CLI entry; one pass or `--watch`.
- `lib/operator-response.js` — pure detection (unit-tested, no network).
- `__tests__/operator-response.test.js` — detection tests.
- `../launchd/com.mythos.operator-response-poller.plist` — scheduled runner (StartInterval 300s).
- Emits to: `_dev/state/operator-responses/` (packets), `_dev/reports/signals/` (signals),
  `_dev/state/dart-operator-responses/state.json` (cursor).

## Autonomy bound (v1)

DETECTS answers and EMITS packet + signal + ack. It does **not** autonomously
execute the resumed work — pickup stays human/orchestrator-gated
(`/follow-signal`, `/orchestrate-loop`). Unbounded auto-resume is a deliberate
later step requiring review; do not add it here without that review.

## Run

```bash
# Dry-run (default): prints the report, mutates nothing.
node tools/dart-integration/operator-response-poller.js

# Apply: emit resume packets + signals + acks.
node tools/dart-integration/operator-response-poller.js --apply

# Also enforce the standing rule: Mythos user owns any active (Doing) task.
node tools/dart-integration/operator-response-poller.js --apply --assign-active
```

## Going live (continuous)

```bash
node tools/dart-integration/operator-response-poller.js --watch --interval-seconds 300 --apply
```

Or load the launchd plist (`com.mythos.operator-response-poller.plist`) for a
managed 300s poll.

## Test

```bash
node --test tools/dart-integration/__tests__/operator-response.test.js
```

Related: [RELAY.md](RELAY.md) · memory `dart-relay-dependency-assignment`,
`feedback_bubble-up-questions-to-dart`.
