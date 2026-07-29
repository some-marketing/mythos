# HandoffSignal/2.0 Schema

## Actor run feedback outcome extension

HandoffSignal/1.0 actor feedback signals carry `run_outcome.outcome` with one of `success`, `cli_failure`, `missing_binary`, `timeout`, `interrupted`, or `narrative_incomplete`. Only `success` may set `run_outcome.success: true`. A `narrative_incomplete` result must include `run_outcome.narrative_completion` with `required: true`, `complete: false`, and one or more concrete reasons. This outcome means the actor process may have exited, but a required run-ID and content-hash-bound canonical narrative pair was not observed; consumers must treat the signal as blocked.

Schema constant: `"schema": "HandoffSignal/2.0"`. Validator: `tools/verify/lib/signal.cjs validateHandoffSignalV2()`. Lifecycle helper: `tools/signals/lib/signal-lifecycle.js`.

## Lifecycle states

| State | Set by | Meaning |
|---|---|---|
| `live` | Asker on creation | Signal is open; threshold not yet satisfied |
| `complete` | The LAST reader whose acknowledgement satisfies the threshold | Distributed completion — the stamping session's hook flips the state and fires `on_complete` |
| `closed` | Operator/cleanup | Historical, archived to `_dev/reports/signals/closed/` |

The lifecycle helper drives the flip — no central polling. See `signal-lifecycle.js completeIfSatisfied()` and the driver at `tools/signals/lib/signal-lifecycle-driver.js`.

## Required fields

```json
{
  "schema": "HandoffSignal/2.0",
  "signal_type": "coordination-request",
  "lifecycle_state": "live",
  "source": "<actor-id>",
  "produced_by_session_id": "<session-id>",
  "scope": "<scope-string>",
  "timestamp": "<ISO 8601 with .000Z>",
  "request": "<asker's ask>",
  "target_addressees": {
    "mode": "snapshot | dynamic | broadcast | deadline-only | at-least",
    "source": "active-session-registry | manual-snapshot | ...",
    "resolved_at": "<ISO 8601>",
    "sessions": ["<session-id>", ...],
    "actors": ["<actor-id>", ...]
  },
  "acknowledgement_threshold": {
    "mode": "all | at-least | named-list | deadline-only",
    "count": 2,
    "actor_ids": ["<id>", ...]
  },
  "deadline": "<ISO 8601>",
  "on_timeout": {
    "mode": "operator-review | auto-close | fallback-signal"
  },
  "on_complete": {
    "trigger_command": "archive_to_closed | post_followup_signal | trigger_normalize_signals",
    "archive_to": "_dev/reports/signals/closed/",
    "emit_followup_signals": [],
    "commit_with_message": "<optional>"
  },
  "acknowledgements": [
    {
      "actor_id": "<compound id>",
      "session_id": "<session-id>",
      "ts": "<ISO 8601>",
      "action_taken": "noted | responded | passing-through"
    }
  ],
  "responses": []
}
```

## Field semantics

- **`actor_id`**: compound `<model-id>[:<worker-name>]`, e.g. `claude-opus-4-7` or `claude-opus-4-7:kerneling-rupert`. Substring match allowed for class-level targeting.
- **`acknowledgements`**: append-only, idempotent by `session_id`. Same session can advance `noted → responded` but not downgrade. Distinct from `responses` (response = "I'm doing the thing the asker asked").
- **`target_addressees.mode`**:
  - `snapshot` — list of sessions resolved at signal-create time. Default; immutable.
  - `dynamic` — resolves against `active-session-registry.listActive()` at completion-check time.
  - `broadcast` — without snapshot resolution, only deadline-based thresholds are safe.
  - `at-least` / `deadline-only` — count or time threshold.
- **`acknowledgement_threshold.mode`**:
  - `all` — every target must acknowledge. Does NOT auto-shrink on dead targets unless `target_addressees.allow_unreachable_shrink: true` (default false, fail-closed).
  - `at-least` — count met.
  - `named-list` — specific actors must acknowledge.
  - `deadline-only` — completion gated by deadline + `on_timeout`.
- **`on_complete.trigger_command`**: ALLOWLISTED only. Default allowlist: `archive_to_closed`, `post_followup_signal`, `trigger_normalize_signals`. Anything else is rejected with allowlist-violation error. **No auto-commit.** Hooks mutate files only; the session's commit cadence handles git.
- **`on_timeout.mode`**:
  - `operator-review` — escalate to operator on deadline expiry; signal stays live.
  - `auto-close` — only mode that grants automatic completion when threshold isn't met but deadline reached.
  - `fallback-signal` — emit a follow-up signal addressed to the operator/scheduler.

## Edge cases (designed for, tested where applicable)

- **Dead target session in `mode: all`** — marked `unreachable` in `target_addressees.unreachable_sessions`; threshold stays unmet. Only `on_timeout` or operator override can complete. Auto-shrinking is opt-in.
- **New session after snapshot** — not obligated. `mode: snapshot` is the default precisely to make membership immutable.
- **Same session stamps twice** — idempotent. Validator does not enforce; lifecycle helper handles dedup.
- **Concurrent last-reader writes** — atomic temp+rename in driver. Two sessions racing to flip `complete` cannot corrupt the file.
- **Non-allowlisted `trigger_command`** — rejected at runOnComplete time with clear error; signal stays live.

## Schema enforcement

- Validator: `tools/verify/lib/signal.cjs validateHandoffSignalV2(signal, opts)` — returns `{valid, errors}`.
- 12/12 tests passing in `tools/verify/lib/__tests__/coordination-signal-2.0.test.cjs`.
- Backward compat: 1.0 signals continue to validate against the 1.0 path. 2.0 is additive at the schema-version boundary; lifecycle semantics changed are NOT backward compatible (different field names, different completion model). Migration is hand-edit per signal.

## In-flight 1.0 signals (deferred migration)

Two `HandoffSignal/1.0` signals on `fleet-onto-dev-workspace` need migration:
- `_dev/reports/signals/coordination-request__20260427T160000Z__branch-freeze-for-dev-workspace-reconciliation.json` (`lifecycle_state: "consumed"` — invalid 1.0 enum; migrate → `closed` or `complete`)
- `_dev/reports/signals/coordination-request__20260427T161500Z__claim-or-clear-dirty-worktree-files.json` (`lifecycle_state: "live"`, no responses; migrate → 2.0 shape)

Migration plan: codex S3 (see `_dev/reports/analysis/codex-bridge-response__active-session-registry-review.md`).
