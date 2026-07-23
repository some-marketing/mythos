#!/usr/bin/env bash
# desktop-cowork-consumer.sh
# -------------------------------------------------------------
# Consumes Cowork orchestrator request packets and routes each
# one through `claude` headless, which is responsible for invoking
# `/dispatch-bridge --target codex --run-now` and writing a verdict
# back into _dev/reports/signals/cowork-in/.
#
# Companion design doc: _dev/cowork-sessions/dispatch-bridge-cowork-variant.md
# Companion library:    tools/signals/cowork-orchestrator-bridge.js
#
# Invoked by launchd via com.smos.cowork-bridge.plist (WatchPaths trigger).
# May also be invoked manually for debugging:
#     bash tools/signals/desktop-cowork-consumer.sh
#     bash tools/signals/desktop-cowork-consumer.sh --packet <path>
#     bash tools/signals/desktop-cowork-consumer.sh --simulate  # writes a stub verdict, doesn't call claude
#
# Trust boundary: this script never reads the packet's prompt_body as a
# bash command. The prompt_body is concatenated into stdin for `claude`
# and `claude` itself is the thing that decides what to do under its own
# Trust Compact. Slash commands flow through dispatch-bridge.js's existing
# target-command-policy.cjs validator before any signal hits disk.
# -------------------------------------------------------------

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COWORK_OUT_DIR="${REPO_ROOT}/_dev/reports/signals/cowork-out"
COWORK_IN_DIR="${REPO_ROOT}/_dev/reports/signals/cowork-in"
COWORK_ARCHIVE_DIR="${REPO_ROOT}/_dev/reports/signals/cowork-archive"
LOG_DIR="${REPO_ROOT}/_dev/logs/cowork-bridge"
LOCK_FILE="${LOG_DIR}/.consumer.lock"

mkdir -p "${COWORK_IN_DIR}" "${COWORK_ARCHIVE_DIR}" "${LOG_DIR}"

LOG_FILE="${LOG_DIR}/consumer-$(date +%Y%m%d).log"
log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "${LOG_FILE}"
}

# Single-flight: if a previous instance is still running, just exit; the new
# packet will be picked up by that instance's loop or by the next launchd fire.
# Stale-lock recovery: if the lock file's recorded PID is no longer alive,
# treat it as stale and overwrite. This avoids deadlock after a crash or in
# any environment where the trap couldn't unlink (e.g., a sandboxed CI run).
acquire_lock() {
    if [[ -f "${LOCK_FILE}" ]]; then
        local prior_pid
        prior_pid="$(cat "${LOCK_FILE}" 2>/dev/null || true)"
        if [[ -n "${prior_pid}" ]] && kill -0 "${prior_pid}" 2>/dev/null; then
            log "another consumer is running (pid=${prior_pid}); exiting"
            return 1
        fi
        log "stale lock from pid=${prior_pid:-unknown}; reclaiming"
        rm -f "${LOCK_FILE}" 2>/dev/null || true
    fi
    if ! printf '%s\n' "$$" > "${LOCK_FILE}" 2>/dev/null; then
        log "could not write lock file; continuing without lock"
    fi
    return 0
}
if ! acquire_lock; then
    exit 0
fi
trap 'rm -f "${LOCK_FILE}" 2>/dev/null || true' EXIT

MODE_SIMULATE=0
EXPLICIT_PACKET=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --simulate)
            MODE_SIMULATE=1
            shift
            ;;
        --packet)
            EXPLICIT_PACKET="$2"
            shift 2
            ;;
        --help|-h)
            grep '^#' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            log "unknown arg: $1"
            shift
            ;;
    esac
done

# ---- jq helper (Python argv-based fallback when jq missing) ----
# Reviewer flagged the prior string-interpolated Python fallback as a
# command-injection liability if a hostile field name ever reached this
# function. We now pass the file and field name as argv parameters into
# Python rather than interpolating into the source — the fallback path
# is now injection-safe even on a malformed packet.
read_field() {
    local file="$1" field="$2"
    if command -v jq >/dev/null 2>&1; then
        jq -r "${field} // empty" "${file}"
        return
    fi
    /usr/bin/python3 -c '
import json, sys
file_path = sys.argv[1]
keys = [k for k in sys.argv[2].lstrip(".").split(".") if k]
try:
    data = json.load(open(file_path))
except Exception:
    sys.exit(0)
v = data
for k in keys:
    if isinstance(v, dict):
        v = v.get(k, "")
    elif isinstance(v, list):
        try: v = v[int(k)]
        except Exception: v = ""
    else:
        v = ""
    if v == "":
        break
print("" if v is None else v)
' "${file}" "${field}"
}

write_verdict() {
    # Reviewer flagged that this function previously read the global
    # PACKET_PATH and CONSUMED_AT, which made it fragile to refactors.
    # All inputs are now explicit parameters.
    local packet_path="$1" verdict_path="$2" status="$3" exit_code="$4" \
          summary="$5" dispatch_signal="$6" completion_signal="$7" \
          packet_archive="$8" stderr_tail_file="$9" consumed_at="${10}"
    local now host
    now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    host="$(hostname -s)"
    local stderr_tail=""
    if [[ -f "${stderr_tail_file}" ]]; then
        stderr_tail="$(tail -n 20 "${stderr_tail_file}" | /usr/bin/python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')"
    else
        stderr_tail='""'
    fi
    local req_id scope_tag
    req_id="$(read_field "${packet_path}" .request_id)"
    scope_tag="$(read_field "${packet_path}" .scope_tag)"
    local tmp="${verdict_path}.tmp"
    cat >"${tmp}" <<EOF
{
  "schema": "CoworkOrchestratorVerdict/1.0",
  "request_id": "${req_id}",
  "nonce": "$(read_field "${packet_path}" .nonce)",
  "consumed_at": "${consumed_at}",
  "completed_at": "${now}",
  "consumer": "desktop-cowork-consumer",
  "host": "${host}",
  "status": "${status}",
  "exit_code": ${exit_code},
  "dispatch": {
    "signal_scope": "${scope_tag}",
    "dispatch_signal_path": "${dispatch_signal}",
    "completion_signal_path": "${completion_signal}",
    "analysis_artifacts": {}
  },
  "verdict": {
    "summary": $(printf '%s' "${summary}" | /usr/bin/python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))'),
    "verdict_body_path": ""
  },
  "stderr_tail": ${stderr_tail},
  "request_packet_path": "${packet_archive}"
}
EOF
    mv "${tmp}" "${verdict_path}"
    log "verdict written: ${verdict_path} (status=${status})"
}

# Build the prompt that we hand to `claude` headless. The prompt is data, not
# code: claude executes /dispatch-bridge inside its own session, governed by
# the target-command-policy.cjs validator and the user's existing slash
# command surface.
build_claude_prompt() {
    local packet="$1"
    cat <<EOF
You are running headless inside the Mythos repo to consume a Cowork
orchestrator request packet.

Packet on disk: ${packet}

Read it, then execute exactly one slash command:

    /dispatch-bridge \\
        --target <packet.target_actor> \\
        --task "<packet.task_summary>" \\
        --command <packet.target_command> \\
        --context <packet.context_files joined by comma> \\
        --run-now

When the dispatch-bridge call returns, capture:
  - dispatch_signal_path
  - completion_signal_path
  - the codex feedback summary if available

Write a one-line summary of the verdict (no quotes, no markdown).
The desktop-cowork-consumer.sh wrapper that called you will harvest it.

Do NOT delete the packet. Do NOT modify files outside _dev/reports/.
The wrapper script writes the verdict packet — your job is only to
run /dispatch-bridge and surface its findings.
EOF
}

process_packet() {
    PACKET_PATH="$1"
    if [[ ! -f "${PACKET_PATH}" ]]; then
        log "packet not found: ${PACKET_PATH}"
        return
    fi
    log "processing: ${PACKET_PATH}"

    CONSUMED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

    local return_path scope_tag target_actor target_command task_summary
    return_path="$(read_field "${PACKET_PATH}" .return_channel.path)"
    scope_tag="$(read_field "${PACKET_PATH}" .scope_tag)"
    target_actor="$(read_field "${PACKET_PATH}" .target_actor)"
    target_command="$(read_field "${PACKET_PATH}" .target_command)"
    task_summary="$(read_field "${PACKET_PATH}" .task_summary)"

    if [[ -z "${return_path}" ]]; then
        log "no return_channel.path in packet ${PACKET_PATH}; skipping"
        return
    fi
    local verdict_path="${REPO_ROOT}/${return_path}"
    mkdir -p "$(dirname "${verdict_path}")"

    local archive_name="$(basename "${PACKET_PATH}")"
    local archive_path="${COWORK_ARCHIVE_DIR}/${archive_name}"

    local stderr_log="${LOG_DIR}/$(basename "${PACKET_PATH}" .cowork-request.json).stderr.log"
    : > "${stderr_log}"

    if [[ "${MODE_SIMULATE}" == "1" ]]; then
        log "simulate mode: not invoking claude"
        write_verdict "${PACKET_PATH}" "${verdict_path}" "ok" 0 \
            "simulate mode: round-trip wire-protocol verified, no codex call" \
            "" "" "_dev/reports/signals/cowork-archive/${archive_name}" \
            "${stderr_log}" "${CONSUMED_AT}"
        mv "${PACKET_PATH}" "${archive_path}" 2>/dev/null || cp "${PACKET_PATH}" "${archive_path}"
        return
    fi

    if ! command -v claude >/dev/null 2>&1; then
        log "claude CLI not found in PATH; writing consumer_error verdict"
        write_verdict "${PACKET_PATH}" "${verdict_path}" "consumer_error" 127 \
            "claude CLI not on PATH for the desktop consumer" \
            "" "" "_dev/reports/signals/cowork-archive/${archive_name}" \
            "${stderr_log}" "${CONSUMED_AT}"
        mv "${PACKET_PATH}" "${archive_path}" 2>/dev/null || cp "${PACKET_PATH}" "${archive_path}"
        return
    fi

    local prompt
    prompt="$(build_claude_prompt "${PACKET_PATH}")"

    local stdout_log="${LOG_DIR}/$(basename "${PACKET_PATH}" .cowork-request.json).stdout.log"
    : > "${stdout_log}"

    local claude_exit=0
    (
        cd "${REPO_ROOT}"
        # Headless invocation — `-p` is print-and-exit. The exact flag may vary
        # by claude CLI version; the README documents the supported invocations.
        printf '%s' "${prompt}" | claude -p --dangerously-skip-permissions >"${stdout_log}" 2>"${stderr_log}"
    )
    claude_exit=$?

    local summary
    summary="$(tail -n 1 "${stdout_log}" 2>/dev/null | head -c 1000)"
    [[ -z "${summary}" ]] && summary="(empty stdout from claude headless; see ${stdout_log})"

    local dispatch_signal=""
    local completion_signal=""
    # Best-effort: scrape the most recent dispatch-bridge signal at scope_tag.
    if [[ -n "${scope_tag}" ]]; then
        dispatch_signal="$(ls -1t "${REPO_ROOT}/_dev/reports/signals/" 2>/dev/null \
            | grep "dispatch-bridge__.*__${scope_tag}.signal.json" | head -n 1 || true)"
        if [[ -n "${dispatch_signal}" ]]; then
            dispatch_signal="_dev/reports/signals/${dispatch_signal}"
        fi
        completion_signal="$(ls -1t "${REPO_ROOT}/_dev/reports/signals/" 2>/dev/null \
            | grep -E "${scope_tag}__codex-feedback__.*\.signal\.json" | head -n 1 || true)"
        if [[ -n "${completion_signal}" ]]; then
            completion_signal="_dev/reports/signals/${completion_signal}"
        fi
    fi

    local status="ok"
    [[ "${claude_exit}" -ne 0 ]] && status="dispatch_failed"
    write_verdict "${PACKET_PATH}" "${verdict_path}" "${status}" "${claude_exit}" \
        "${summary}" "${dispatch_signal}" "${completion_signal}" \
        "_dev/reports/signals/cowork-archive/${archive_name}" \
        "${stderr_log}" "${CONSUMED_AT}"

    mv "${PACKET_PATH}" "${archive_path}" 2>/dev/null || cp "${PACKET_PATH}" "${archive_path}"
}

# ---- main ----

if [[ -n "${EXPLICIT_PACKET}" ]]; then
    process_packet "${EXPLICIT_PACKET}"
    exit 0
fi

# Iterate every packet currently in cowork-out/ in chronological (filename) order.
shopt -s nullglob
packets=( "${COWORK_OUT_DIR}"/*.cowork-request.json )
if [[ ${#packets[@]} -eq 0 ]]; then
    log "no packets in ${COWORK_OUT_DIR}"
    exit 0
fi

# Sort lexically — ISO timestamp first → chronological.
IFS=$'\n' sorted=( $(printf '%s\n' "${packets[@]}" | sort) )
unset IFS

for p in "${sorted[@]}"; do
    process_packet "${p}"
done
