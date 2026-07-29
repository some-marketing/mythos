#!/usr/bin/env bash
#
# install.sh — idempotent installer for Mythos launchd routines.
#
# Copies every plist in tools/launchd/ to ~/Library/LaunchAgents/ and
# loads it via launchctl. Safe to re-run: existing agents are unloaded
# first, the plist file is overwritten, then reloaded. Compares hashes
# to skip work when nothing has changed.
#
# Usage:
#   tools/launchd/install.sh                # install all plists
#   tools/launchd/install.sh <basename>     # install only the named one
#                                           # (basename without .plist)
#   tools/launchd/install.sh --uninstall    # unload + remove all Mythos plists
#   tools/launchd/install.sh --status       # list status of installed agents
#
# Plists are installed at user scope (no sudo). Targets macOS launchd.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${REPO_ROOT}/tools/launchd"
DEST_DIR="${HOME}/Library/LaunchAgents"

mkdir -p "${DEST_DIR}"

list_plists() {
  local pattern="${1:-*}"
  find "${SRC_DIR}" -maxdepth 1 -name "${pattern}.plist" -type f 2>/dev/null | sort
}

label_from_plist() {
  /usr/libexec/PlistBuddy -c "Print :Label" "$1" 2>/dev/null
}

unload_if_loaded() {
  local label="$1" dest="$2"
  if launchctl list "${label}" >/dev/null 2>&1; then
    launchctl unload "${dest}" >/dev/null 2>&1 || true
  fi
}

install_one() {
  local src="$1"
  local base; base="$(basename "${src}")"
  local dest="${DEST_DIR}/${base}"
  local label; label="$(label_from_plist "${src}")"
  if [ -z "${label}" ]; then
    echo "  ! skipped ${base}: no Label key"
    return 1
  fi

  local src_hash dest_hash
  src_hash="$(shasum -a 256 "${src}" | awk '{print $1}')"
  dest_hash="$(shasum -a 256 "${dest}" 2>/dev/null | awk '{print $1}')"

  unload_if_loaded "${label}" "${dest}"

  if [ "${src_hash}" = "${dest_hash}" ]; then
    # Same contents, but it may have been unloaded — reload to be safe.
    launchctl load "${dest}" >/dev/null 2>&1 || true
    echo "  = ${label} (unchanged, reloaded)"
    return 0
  fi

  cp "${src}" "${dest}"
  if launchctl load "${dest}" >/dev/null 2>&1; then
    echo "  + ${label} (installed)"
  else
    echo "  ! ${label} (copied but launchctl load failed)"
    return 1
  fi
}

uninstall_one() {
  local src="$1"
  local base; base="$(basename "${src}")"
  local dest="${DEST_DIR}/${base}"
  local label; label="$(label_from_plist "${src}")"
  unload_if_loaded "${label}" "${dest}"
  if [ -f "${dest}" ]; then
    rm -f "${dest}"
    echo "  - ${label} (removed)"
  else
    echo "  . ${label} (not installed)"
  fi
}

show_status() {
  local src="$1"
  local label; label="$(label_from_plist "${src}")"
  local line; line="$(launchctl list 2>/dev/null | awk -v l="${label}" '$3 == l { print }')"
  if [ -n "${line}" ]; then
    echo "  ✓ ${label}    ${line}"
  else
    echo "  ✗ ${label}    not loaded"
  fi
}

main() {
  local mode="install"
  local filter="*"

  if [ $# -ge 1 ]; then
    case "$1" in
      --uninstall) mode="uninstall" ;;
      --status)    mode="status" ;;
      --help|-h)
        sed -n '3,17p' "${BASH_SOURCE[0]}"
        return 0
        ;;
      *) filter="$1" ;;
    esac
  fi

  echo "Mythos launchd ${mode} (source=${SRC_DIR})"
  local count=0
  while IFS= read -r src; do
    count=$((count + 1))
    case "${mode}" in
      install)   install_one "${src}" ;;
      uninstall) uninstall_one "${src}" ;;
      status)    show_status "${src}" ;;
    esac
  done < <(list_plists "${filter}")
  if [ "${count}" -eq 0 ]; then
    echo "  no plists matched"
    return 1
  fi
}

main "$@"
