#!/usr/bin/env bash
# litellm-gateway.sh — start/stop/status/health for the Tool Broker's LiteLLM
# gateway (sovereign-core-harness P2 step 1). TOOLING, not an orphan daemon:
# every run is foregroundable, has a pidfile, a captured log, and a health probe.
#
# The gateway is layer 2 of the Tool Broker (the OpenAI-compatible proxy). It
# fronts OpenRouter (proven) + config-ready Ollama, and owns the virtual key,
# budgets, model access-control, request ids, and cost logs. Config is committed
# at tools/broker/litellm/config.yaml; secrets are resolved from the environment
# at start (never committed).
#
# Usage:
#   tools/broker/litellm-gateway.sh start [--port N] [--foreground]
#   tools/broker/litellm-gateway.sh stop
#   tools/broker/litellm-gateway.sh status
#   tools/broker/litellm-gateway.sh health
#
# Credentials (resolved at start, never persisted):
#   OPENROUTER_API_KEY   required for live OpenRouter calls; if absent the
#                        gateway still starts but live calls will 401 upstream.
#   LITELLM_MASTER_KEY   the virtual key clients present. If unset, an ephemeral
#                        sk-... key is generated for this run and printed once.
#   OLLAMA_BASE_URL      optional; activates the config-ready local-analysis model.

set -euo pipefail

BROKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_BIN="${BROKER_DIR}/.venv/bin"
CONFIG="${BROKER_DIR}/litellm/config.yaml"
RUNTIME_DIR="${BROKER_DIR}/.runtime"
PIDFILE="${RUNTIME_DIR}/gateway.pid"
LOGFILE="${RUNTIME_DIR}/gateway.log"
KEYFILE="${RUNTIME_DIR}/master-key.txt"    # ephemeral key for THIS run; gitignored
PORT="${LITELLM_GATEWAY_PORT:-4010}"
FOREGROUND=0

mkdir -p "${RUNTIME_DIR}"

log()  { printf '[litellm-gateway] %s\n' "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }

resolve_litellm() {
  if [[ -x "${VENV_BIN}/litellm" ]]; then
    echo "${VENV_BIN}/litellm"
  elif command -v litellm >/dev/null 2>&1; then
    command -v litellm
  else
    die "litellm not found. Install with: VIRTUAL_ENV=${BROKER_DIR}/.venv uv pip install 'litellm[proxy]'"
  fi
}

is_running() {
  [[ -f "${PIDFILE}" ]] || return 1
  local pid; pid="$(cat "${PIDFILE}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null
}

ensure_master_key() {
  # Access-control invariant: the gateway ALWAYS runs with a master key. If the
  # operator did not provision one, generate an ephemeral sk-... key for this run
  # only. It is written to a gitignored runtime file, never committed.
  if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
    LITELLM_MASTER_KEY="sk-mythos-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    export LITELLM_MASTER_KEY
    printf '%s\n' "${LITELLM_MASTER_KEY}" > "${KEYFILE}"
    chmod 600 "${KEYFILE}"
    log "no LITELLM_MASTER_KEY provided; generated an ephemeral virtual key for this run -> ${KEYFILE}"
  else
    printf '%s\n' "${LITELLM_MASTER_KEY}" > "${KEYFILE}"
    chmod 600 "${KEYFILE}"
  fi
}

cmd_start() {
  if is_running; then
    log "already running (pid $(cat "${PIDFILE}"), port ${PORT})"
    return 0
  fi
  [[ -f "${CONFIG}" ]] || die "config not found: ${CONFIG}"
  local bin; bin="$(resolve_litellm)"
  ensure_master_key

  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    log "WARNING: OPENROUTER_API_KEY is not set — the gateway will start but live OpenRouter calls will fail upstream (operator-gated)."
  fi

  log "starting litellm proxy on port ${PORT} (config: ${CONFIG})"
  if [[ "${FOREGROUND}" -eq 1 ]]; then
    exec "${bin}" --config "${CONFIG}" --port "${PORT}" --host 127.0.0.1
  fi
  nohup "${bin}" --config "${CONFIG}" --port "${PORT}" --host 127.0.0.1 \
    >>"${LOGFILE}" 2>&1 &
  echo $! > "${PIDFILE}"
  log "started (pid $(cat "${PIDFILE}")); log: ${LOGFILE}"
  log "waiting for health..."
  for _ in $(seq 1 30); do
    if cmd_health >/dev/null 2>&1; then
      log "healthy on http://127.0.0.1:${PORT}"
      return 0
    fi
    sleep 1
  done
  log "started but health did not come up within 30s — inspect ${LOGFILE}"
  return 1
}

cmd_stop() {
  if ! is_running; then
    log "not running"
    rm -f "${PIDFILE}"
    return 0
  fi
  local pid; pid="$(cat "${PIDFILE}")"
  log "stopping pid ${pid}"
  kill "${pid}" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "${pid}" 2>/dev/null || break
    sleep 0.5
  done
  kill -9 "${pid}" 2>/dev/null || true
  rm -f "${PIDFILE}"
  log "stopped"
}

cmd_status() {
  if is_running; then
    printf 'running pid=%s port=%s log=%s\n' "$(cat "${PIDFILE}")" "${PORT}" "${LOGFILE}"
  else
    printf 'stopped\n'
    return 1
  fi
}

cmd_health() {
  # LiteLLM exposes an unauthenticated /health/liveliness endpoint.
  local url="http://127.0.0.1:${PORT}/health/liveliness"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${url}" 2>/dev/null || echo 000)"
  if [[ "${code}" == "200" ]]; then
    printf 'healthy (%s -> %s)\n' "${url}" "${code}"
    return 0
  fi
  printf 'unhealthy (%s -> %s)\n' "${url}" "${code}"
  return 1
}

main() {
  local sub="${1:-}"; shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port) PORT="$2"; shift 2;;
      --foreground) FOREGROUND=1; shift;;
      *) die "unknown option: $1";;
    esac
  done
  case "${sub}" in
    start)  cmd_start;;
    stop)   cmd_stop;;
    status) cmd_status;;
    health) cmd_health;;
    *) echo "usage: $0 {start|stop|status|health} [--port N] [--foreground]" >&2; exit 2;;
  esac
}

main "$@"
