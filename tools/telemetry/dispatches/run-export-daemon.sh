#!/usr/bin/env bash
# run-export-daemon.sh — Always-on daemon tick wrapper for the Langfuse exporter.
#
# Invoked by launchd on each StartInterval tick. Reads the export cursor,
# determines whether any new correlation_ids are pending in dispatches.jsonl,
# and drives run-export-with-op.sh for each pending trace. Advances the cursor
# on success; records the failure without crashing on any error.
#
# Three stop paths (enforce-interruptability):
#   1. launchd unload — launchd stops invoking this script entirely.
#   2. Kill-switch file: _dev/state/kill-switches/langfuse-export.off
#      If this file exists at tick start, the tick is skipped and logged.
#   3. SIGINT/SIGTERM — trapped; the exporter itself also handles SIGINT
#      cleanly (exit 130, safe to re-run).
#
# Fail-open semantics:
#   - Any exporter/auth/Langfuse error is caught; we log the failure and
#     EXIT 0 so launchd does NOT go into crash-backoff. The daemon stays alive.
#   - N=3 consecutive failures are handled by the 'fail' helper (which emits a
#     TelemetryFailureSignal via export-cursor.cjs). This wrapper only invokes it.
#
# Credentials: delegated to run-export-with-op.sh (unchanged from manual path).
# On the VPS pass LANGFUSE_HOST=http://localhost:3000 via EnvironmentVariables
# in the launchd plist.
#
# Inline Node helper convention (the bug Codex caught): the helper is invoked as
#   "$NODE" "$HELPER_PATH" <args...>
# i.e. a real script PATH, NOT `node -`. So process.argv[1] is the script path
# and the helper args are process.argv[2], [3], … (unambiguous). The earlier
# `node - "$ARG"` form put the first arg at argv[2] while the code read argv[1],
# so REPO_ROOT was "-" and the cursor module never loaded.
#
# Usage (manual test on VPS / tailnet):
#   LANGFUSE_HOST=http://localhost:3000 bash tools/telemetry/dispatches/run-export-daemon.sh
#
# Test hooks (used by the wrapper-boundary smoke test — no network):
#   MYTHOS_EXPORT_DAEMON_DRY=1   -> skip the real exporter; treat every pending
#                                 trace as SUCCESS (cursor advances).
#   MYTHOS_EXPORT_DAEMON_FAIL=1  -> skip the real exporter; treat every pending
#                                 trace as FAILURE (records failure, may signal).
#   MYTHOS_EXPORT_REPO_ROOT      -> override the DATA repo root (fixture tree).
#                                 The cursor LIBRARY always loads from the real
#                                 repo so the shell->Node boundary is exercised.

set -uo pipefail
# Note: -e is intentionally NOT set — we catch errors and exit 0 (fail-open).

DEFAULT_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REPO_ROOT="${MYTHOS_EXPORT_REPO_ROOT:-${DEFAULT_REPO_ROOT}}"
NODE="${NODE:-node}"

# The cursor library always resolves from the REAL repo (the code), even when a
# test points the DATA repo root at a fixture tree.
LIB_REPO_ROOT="${DEFAULT_REPO_ROOT}"

DISPATCHES_FILE="${REPO_ROOT}/_dev/reports/telemetry/dispatches.jsonl"
CURSOR_DIR="${REPO_ROOT}/_dev/state/langfuse-export"
CURSOR_FILE="${CURSOR_DIR}/cursor.json"
RUNS_FILE="${CURSOR_DIR}/daemon-runs.jsonl"
SIGNALS_DIR="${REPO_ROOT}/_dev/reports/signals"
KILL_SWITCH="${REPO_ROOT}/_dev/state/kill-switches/langfuse-export.off"
EXPORTER="${LIB_REPO_ROOT}/tools/telemetry/dispatches/run-export-with-op.sh"
FAIL_THRESHOLD=3

TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_S="$(date +%s)"

mkdir -p "${CURSOR_DIR}"

log() { printf '[langfuse-export] %s %s\n' "${TS_UTC}" "$*"; }

# ── Inline Node dispatcher ────────────────────────────────────────────────────
# One temp helper file invoked as a real script PATH so argv is unambiguous:
#   argv[1]=scriptPath  argv[2]=mode  argv[3]=cursorFile  argv[4]=libRepoRoot
#   argv[5]=arg5  argv[6]=arg6  argv[7]=arg7
# Modes: pending | advance | fail
HELPER="$(mktemp -t langfuse-export-helper.XXXXXX.cjs)"
trap 'rm -f "${HELPER}"' EXIT

cat > "${HELPER}" <<'NODE_EOF'
'use strict';
// argv: [node, scriptPath, mode, cursorFile, libRepoRoot, arg5, arg6, arg7]
const path = require('path');
const fs   = require('fs');

const mode        = process.argv[2];
const cursorFile  = process.argv[3];
const libRepoRoot = process.argv[4];

const cur = require(path.join(libRepoRoot, 'tools/telemetry/dispatches/lib/export-cursor.cjs'));
const cursor = cur.loadCursor(cursorFile);

if (mode === 'pending') {
  const dispatchesFile = process.argv[5];
  let allIds = [];
  try {
    const lines = fs.readFileSync(dispatchesFile, 'utf8').split('\n').filter(Boolean);
    const seen = new Set();
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const id = row.trace_id || row.correlation_id;
        if (id && id !== 'unknown' && !seen.has(id)) { seen.add(id); allIds.push(id); }
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message, pending: [] }) + '\n');
    process.exit(0);
  }
  const pending = cur.pendingIds(cursor, allIds);
  process.stdout.write(JSON.stringify({ ok: true, pending, total_ids: allIds.length }) + '\n');
  process.exit(0);
}

if (mode === 'advance') {
  const traceId = process.argv[5];
  cur.advance(cursorFile, cursor, [traceId]);
  process.stdout.write(JSON.stringify({ ok: true, advanced: traceId }) + '\n');
  process.exit(0);
}

if (mode === 'fail') {
  const reason     = process.argv[5];
  const signalsDir = process.argv[6];
  const threshold  = parseInt(process.argv[7], 10) || 3;

  cur.recordFailure(cursorFile, cursor, reason);

  let signalFile = null;
  if (cur.shouldEmitFailureSignal(cursor, threshold)) {
    fs.mkdirSync(signalsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const stamp = ts.replace(/[-:]/g, '').replace('Z', 'Z');
    const filename = `langfuse-export-failure__${stamp}.signal.json`;
    // A failure signal carries NO validation
    // run (nothing was verified to pass) — validation.ran is FALSE.
    const signal = {
      schema: 'TelemetryFailureSignal/1.0',
      signal_type: 'coordination-request',
      lifecycle_state: 'live',
      source: 'langfuse-export-daemon',
      scope: 'langfuse-export',
      signal_scope: 'langfuse-export',
      timestamp: ts,
      consecutive_failure_count: cursor.consecutive_failures,
      first_failure_at: cursor.first_failure_ts,
      last_error: cursor.last_failure_reason,
      artifacts: [
        '_dev/state/langfuse-export/cursor.json',
        '_dev/state/langfuse-export/daemon-runs.jsonl',
        '_dev/state/langfuse-export/launchd.stdout.log'
      ],
      decision_context_artifacts: [],
      validation: {
        ran: false,
        summary: `Langfuse exporter daemon hit ${cursor.consecutive_failures} consecutive failed ticks (threshold ${threshold}). First failure: ${cursor.first_failure_ts}. Last error: ${cursor.last_failure_reason}. No export was verified to succeed — this is a failure alert, not a validated run.`
      },
      recommended_next_actor: 'operator',
      recommended_next_command: '/telemetry-status',
      next_prompt_stub: 'The always-on Langfuse export daemon has failed ' + cursor.consecutive_failures + ' consecutive ticks. Diagnose: check VPS Langfuse reachability + 1Password credential freshness, review _dev/state/langfuse-export/daemon-runs.jsonl, then clear the failure (next success resets the counter) or pause via the kill-switch.',
      next_step_detail: [
        `Consecutive export failures: ${cursor.consecutive_failures} (threshold: ${threshold})`,
        `First failure at: ${cursor.first_failure_ts}`,
        `Last error: ${cursor.last_failure_reason}`,
        'Check VPS Langfuse reachability: curl http://localhost:3000/api/public/health',
        'Check 1Password credential: op read "op://Automation/mythos-langfuse-api/Public Key"',
        'Review daemon log: _dev/state/langfuse-export/launchd.stdout.log',
        'To silence while diagnosing: touch _dev/state/kill-switches/langfuse-export.off'
      ],
      blocked_by: [],
      ready_for_clear: false,
      grounding_mode: 'none'
    };
    fs.writeFileSync(path.join(signalsDir, filename), JSON.stringify(signal, null, 2) + '\n', 'utf8');
    cur.markSignalEmitted(cursorFile, cursor);
    signalFile = filename;
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    consecutive_failures: cursor.consecutive_failures,
    signal_emitted: signalFile
  }) + '\n');
  process.exit(0);
}

process.stdout.write(JSON.stringify({ ok: false, error: 'unknown mode: ' + mode }) + '\n');
process.exit(0);
NODE_EOF

run_helper() {
  # run_helper <mode> [arg5] [arg6] [arg7]
  "${NODE}" "${HELPER}" "$1" "${CURSOR_FILE}" "${LIB_REPO_ROOT}" "${2:-}" "${3:-}" "${4:-}" 2>&1
}

json_field() {
  # json_field <field> reads JSON from stdin, prints field or empty.
  # NOTE: with `node -e`, the FIRST user arg is process.argv[1] (there is no
  # script-path slot). Reading argv[2] here was the second copy of the argv
  # off-by-one Codex flagged — it silently made every `ok` check fail.
  "${NODE}" -e '
    const f = process.argv[1];
    let s = ""; try { s = require("fs").readFileSync(0, "utf8"); } catch {}
    try { const v = JSON.parse(s)[f]; process.stdout.write(v == null ? "" : String(v)); }
    catch { process.stdout.write(""); }
  ' "$1" 2>/dev/null || true
}

append_state() {
  # append_state <outcome> <exported_count> <reason>
  local outcome="$1" exported="${2:-0}" reason="${3:-}"
  local end_s duration_s
  end_s="$(date +%s)"; duration_s="$(( end_s - START_S ))"
  # `node -e` user args start at argv[1] — slice(1), not slice(2).
  "${NODE}" -e '
    const [outcome, ts, exported, duration, reason, runsFile] = process.argv.slice(1);
    require("fs").appendFileSync(runsFile, JSON.stringify({
      ts, outcome, exported_count: Number(exported), duration_s: Number(duration), reason: reason || null
    }) + "\n");
  ' "${outcome}" "${TS_UTC}" "${exported}" "${duration_s}" "${reason}" "${RUNS_FILE}" 2>/dev/null || true
}

# ── STOP PATH 2: Kill-switch ─────────────────────────────────────────────────
if [[ -f "${KILL_SWITCH}" ]]; then
  log "kill-switch active (${KILL_SWITCH}) — skipping tick"
  append_state "kill-switch" 0 "kill-switch file present"
  exit 0
fi

# ── STOP PATH 3: SIGINT/SIGTERM ──────────────────────────────────────────────
trap 'log "signal received — exiting cleanly"; append_state "interrupted" 0 "signal"; rm -f "${HELPER}"; exit 0' INT TERM

# ── dispatches.jsonl present? ────────────────────────────────────────────────
if [[ ! -f "${DISPATCHES_FILE}" ]]; then
  log "dispatches.jsonl not found (${DISPATCHES_FILE}) — nothing to export"
  append_state "skipped" 0 "dispatches.jsonl missing"
  exit 0
fi

# ── Determine pending traces ─────────────────────────────────────────────────
PENDING_RESULT="$(run_helper pending "${DISPATCHES_FILE}")"
PENDING_OK="$(printf '%s' "${PENDING_RESULT}" | json_field ok)"

if [[ "${PENDING_OK}" != "true" ]]; then
  ERR_MSG="$(printf '%s' "${PENDING_RESULT}" | json_field error)"
  [[ -z "${ERR_MSG}" ]] && ERR_MSG="cursor-helper crash: ${PENDING_RESULT}"
  log "cursor-helper error: ${ERR_MSG}"
  run_helper fail "${ERR_MSG}" "${SIGNALS_DIR}" "${FAIL_THRESHOLD}" >/dev/null 2>&1 || true
  append_state "error" 0 "${ERR_MSG}"
  exit 0
fi

PENDING_JSON="$(printf '%s' "${PENDING_RESULT}" | "${NODE}" -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).pending.join("\n")' 2>/dev/null || echo '')"

if [[ -z "${PENDING_JSON}" ]]; then
  log "no new correlation_ids pending — nothing to export"
  append_state "skipped" 0 "no pending traces"
  exit 0
fi

PENDING_COUNT="$(printf '%s\n' "${PENDING_JSON}" | grep -c . || true)"
log "pending traces: ${PENDING_COUNT} — starting export"

EXPORTED_COUNT=0
FAILED_IDS=()

while IFS= read -r TRACE_ID; do
  [[ -z "${TRACE_ID}" ]] && continue
  log "exporting trace ${TRACE_ID}"

  EXPORT_EXIT=0
  EXPORT_OUT=""
  if [[ "${MYTHOS_EXPORT_DAEMON_FAIL:-0}" == "1" ]]; then
    EXPORT_EXIT=1            # test hook: force failure, no network
  elif [[ "${MYTHOS_EXPORT_DAEMON_DRY:-0}" == "1" ]]; then
    EXPORT_EXIT=0            # test hook: force success, no network
  else
    EXPORT_OUT="$(bash "${EXPORTER}" --trace "${TRACE_ID}" --enable --single-pass 2>&1)"
    EXPORT_EXIT=$?
  fi

  if [[ "${EXPORT_EXIT}" -eq 0 ]]; then
    run_helper advance "${TRACE_ID}" >/dev/null 2>&1 || true
    EXPORTED_COUNT=$(( EXPORTED_COUNT + 1 ))
    log "  exported ${TRACE_ID} OK"
  else
    FAILED_IDS+=("${TRACE_ID}")
    log "  FAILED to export ${TRACE_ID} (exit ${EXPORT_EXIT}): ${EXPORT_OUT:-forced-fail}"
  fi
done <<< "${PENDING_JSON}"

# ── Record failures + maybe emit signal ──────────────────────────────────────
if [[ "${#FAILED_IDS[@]}" -gt 0 ]]; then
  FAILED_LIST="$(IFS=','; echo "${FAILED_IDS[*]}")"
  REASON="export failed for ${#FAILED_IDS[@]} trace(s): ${FAILED_LIST}"
  FAIL_RESULT="$(run_helper fail "${REASON}" "${SIGNALS_DIR}" "${FAIL_THRESHOLD}")"
  SIGNAL_EMITTED="$(printf '%s' "${FAIL_RESULT}" | json_field signal_emitted)"
  [[ -n "${SIGNAL_EMITTED}" ]] && log "sustained-failure signal emitted: ${SIGNAL_EMITTED}"
  append_state "partial" "${EXPORTED_COUNT}" "${REASON}"
  log "tick complete — exported: ${EXPORTED_COUNT} / failed: ${#FAILED_IDS[@]}"
  exit 0   # fail-open: launchd must not crash-backoff
fi

append_state "ok" "${EXPORTED_COUNT}" ""
log "tick complete — exported: ${EXPORTED_COUNT} new trace(s)"
exit 0
