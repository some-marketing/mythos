# Langfuse Export Daemon — README

Always-on daemon that promotes the manual `run-export-with-op.sh` Langfuse
exporter to a VPS-resident poller. Mirrors the proven `delesign-poll` launchd
pattern.

**OFF BY DEFAULT.** Enabling is an explicit operator action (see below).

---

## What it does

Every 30 minutes (configurable), `run-export-daemon.sh`:

1. Reads `_dev/reports/telemetry/dispatches.jsonl` for all `correlation_id` /
   `trace_id` values.
2. Compares against the cursor (`_dev/state/langfuse-export/cursor.json`) to
   find traces not yet exported.
3. Calls `run-export-with-op.sh --trace <id> --enable --single-pass` for each
   pending trace.
4. Advances the cursor only after a confirmed successful export.
5. On any failure, logs and exits 0 (fail-open — launchd does not crash-backoff).
6. After 3 consecutive failed ticks, writes a durable failure-signal file to
   `_dev/reports/signals/` so the failure surfaces at next session start.

The exporter is already idempotent (content-stable span IDs — Langfuse de-dups).
The cursor is a re-scan-storm preventer, not a deduplication gate.

---

## Trustworthiness Evidence

(Required by the Learning-and-Automation promotion rule before enabling.)

- Manual `run-export-with-op.sh` export run count: **[operator to fill in]**
- Idempotency verified: re-running on already-exported traces produces no
  duplicate Langfuse spans — confirmed by **[operator to fill in, e.g. "3 runs,
  Langfuse trace count stable"]**.
- Cursor unit tests: `node --test tools/telemetry/dispatches/__tests__/export-cursor.test.cjs` — **PASS**.

---

## Enable (operator action)

**Do this on the VPS or the Mac where Langfuse is reachable.**

```bash
# 1. Copy the plist to LaunchAgents.
cp tools/launchd/dev.mythos.langfuse-export.plist ~/Library/LaunchAgents/

# 2. Bootstrap (start).
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.mythos.langfuse-export.plist

# 3. Verify it loaded.
launchctl print gui/$(id -u)/dev.mythos.langfuse-export

# 4. Optional: trigger immediately for smoke test.
launchctl kickstart -k gui/$(id -u)/dev.mythos.langfuse-export
```

**`LANGFUSE_HOST` default = your telemetry host** `http://${TELEMETRY_HOST}:3000` (set in
the plist's `EnvironmentVariables`, matching the manual `run-export-with-op.sh`
default). Use the localhost override **only when running the daemon ON the VPS
itself** (the Langfuse container is local there): `LANGFUSE_HOST=http://localhost:3000`.

On the VPS (Linux), adapt for `systemd` or run via `cron`. Because the daemon
runs on the same host as Langfuse, override to localhost there:
```bash
# Cron every 30 minutes (run ON the VPS — localhost override):
*/30 * * * * LANGFUSE_HOST=http://localhost:3000 bash /path/to/run-export-daemon.sh >> /path/to/langfuse-export.log 2>&1
```

---

## Disable

### Stop path 1 — launchd unload (permanent until re-bootstrapped)
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/dev.mythos.langfuse-export.plist
```

### Stop path 2 — kill-switch (temporary; daemon stays registered, ticks skip)
```bash
# Pause:
mkdir -p _dev/state/kill-switches
touch _dev/state/kill-switches/langfuse-export.off

# Resume:
rm _dev/state/kill-switches/langfuse-export.off
```

### Stop path 3 — SIGINT
Sending SIGINT to the running process exits cleanly. The exporter handles SIGINT
during its settle wait (exit 130, safe to re-run).

---

## Logs

| Path | Content |
|---|---|
| `_dev/state/langfuse-export/launchd.stdout.log` | Daemon tick output |
| `_dev/state/langfuse-export/launchd.stderr.log` | Daemon stderr |
| `_dev/state/langfuse-export/daemon-runs.jsonl` | Per-tick outcome log (JSON) |
| `_dev/state/langfuse-export/cursor.json` | Cursor state (exported ids, failure count) |

---

## Cursor state

`cursor.json` tracks:

- `exported_ids` — set of `correlation_id`s successfully exported (never shrinks).
- `last_export_ts` — ISO timestamp of last successful export tick.
- `consecutive_failures` — resets to 0 on any success.
- `last_failure_ts` / `last_failure_reason` — last failure detail.
- `signal_emitted_at` — when the last sustained-failure signal was emitted.

---

## Failure alerting

After **3 consecutive failed ticks**, a failure-signal file is written to
`_dev/reports/signals/langfuse-export-failure__<ts>.signal.json`. This signal
surfaces as a pending failure item the next time you check signal state.

A single failure stays quiet (retry next tick). The counter resets to 0 on
any successful export.

To diagnose:
1. Check `_dev/state/langfuse-export/daemon-runs.jsonl` for recent tick outcomes.
2. Check `cursor.json` for `last_failure_reason`.
3. Verify Langfuse host reachability: `curl http://${TELEMETRY_HOST}:3000/api/public/health` (or `http://localhost:3000` if Langfuse runs on the same host)
4. Verify 1Password credential: `op read "op://Automation/mythos-langfuse-api/Public Key"`
5. Pause via kill-switch while diagnosing.

---

## Interval knob

Default: `1800` seconds (30 min). Open for codex review (telemetry-freshness vs
VPS-load tradeoff). To change: edit `StartInterval` in the plist and reload.

---

## Credentials

Delegated to `run-export-with-op.sh` (unchanged from manual path). The plist
sets `LANGFUSE_HOST=http://${TELEMETRY_HOST}:3000` by default — matching
the manual runner. When the daemon runs **ON the VPS itself**, override to
`LANGFUSE_HOST=http://localhost:3000` (edit the plist's `EnvironmentVariables`
or pass it inline). The VPS can also resolve keys from a local `.env` file:

```bash
# Running ON the VPS — localhost override:
LANGFUSE_HOST=http://localhost:3000 \
LANGFUSE_PUBLIC_KEY=pk-lf-... \
LANGFUSE_SECRET_KEY=sk-lf-... \
bash tools/telemetry/dispatches/run-export-daemon.sh
```
