#!/usr/bin/env bash
# _dev/sim-runs/vm/pull-results.sh — the ONLY sanctioned way results leave the
# ant-world VM.
#
# THE MEMBRANE IS ONE-WAY BY CONSTRUCTION, NOT BY POLICY. The guest has no
# mount of any host path and no network egress (see ant-world.yaml), so it
# cannot push anything anywhere. Every byte that crosses does so because the
# HOST reached in and took a copy, using Lima's SSH-over-vsock control channel.
# That asymmetry is the whole design: there is no "the guest decided to send
# something" code path to audit, because the guest has no way to originate one.
#
# This script is deliberately a copy-OUT only. It never writes into the guest.
#
# Usage:
#   _dev/sim-runs/vm/pull-results.sh <run-name> [dest-parent-dir]
#
#   run-name          directory under the guest's /opt/antworld/_dev/state/
#   dest-parent-dir   host directory to place it IN (default: _dev/state)
#
# The run lands at <dest-parent-dir>/<run-name>. The second argument is the
# parent, not the final path, because that is how the underlying copy behaves;
# naming it "parent" here keeps the script's contract and the tool's contract
# from disagreeing.
#
# Example:
#   _dev/sim-runs/vm/pull-results.sh ant-sim-vm-smoke
#     -> _dev/state/ant-sim-vm-smoke/

set -euo pipefail

INSTANCE="${ANT_WORLD_INSTANCE:-ant-world}"
GUEST_STATE_ROOT="/opt/antworld/_dev/state"

if [ $# -lt 1 ]; then
  echo "usage: $0 <run-name> [dest-dir]" >&2
  exit 2
fi

RUN_NAME="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEST_PARENT="${2:-${REPO_ROOT}/_dev/state}"

# A run name must be a single path segment. Without this, a caller could pass
# "../../../etc" and pull from outside the run-state area, which would quietly
# turn a results pull into an arbitrary guest-filesystem read.
case "$RUN_NAME" in
  */*|..|.|"") echo "FAIL-CLOSED: run-name must be a single directory name, got '$RUN_NAME'" >&2; exit 2 ;;
esac

# Write-containment on the HOST side, mirroring the driver's own guard: results
# land under the repo's _dev surface or not at all. This keeps a mistyped
# destination from scattering guest output across the working tree (or over
# Mythos-memories mirrors, instructions/canonical, tools/kernel, ...).
DEST_PARENT_ABS="$(mkdir -p "$DEST_PARENT" && cd "$DEST_PARENT" && pwd)"
ALLOWED_PREFIX="${REPO_ROOT}/_dev/"
case "${DEST_PARENT_ABS}/" in
  "${ALLOWED_PREFIX}"*) ;;
  *) echo "FAIL-CLOSED: destination ${DEST_PARENT_ABS} is not under ${ALLOWED_PREFIX}" >&2; exit 2 ;;
esac
DEST_RUN="${DEST_PARENT_ABS}/${RUN_NAME}"

# CODE REVIEW (PR #12, codex P2): limactl copy is a copy, not a deleting
# mirror -- re-running this pull for the same run name merges into an
# existing destination, and the PULL-MANIFEST.txt `find` below then records
# stale files that never came from the current guest pull. Refuse a nonempty
# destination (same guard as the Orwell courier pulls and the sim drivers):
# a pull is a pull.
if [ -d "$DEST_RUN" ]; then
  existing="$(find "$DEST_RUN" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$existing" -ne 0 ]; then
    echo "FAIL-CLOSED: destination ${DEST_RUN} is not empty (${existing} entries); a re-pull would mix stale files into PULL-MANIFEST.txt -- choose a fresh run-name or move the old pull aside" >&2
    exit 2
  fi
fi

if ! limactl list "$INSTANCE" --format json 2>/dev/null | grep -q '"status":"Running"'; then
  echo "FAIL-CLOSED: instance '${INSTANCE}' is not running. Start it with: limactl start ${INSTANCE}" >&2
  exit 2
fi

SRC="${GUEST_STATE_ROOT}/${RUN_NAME}"
if ! limactl shell "$INSTANCE" -- test -d "$SRC"; then
  echo "FAIL-CLOSED: no such run directory in guest: ${SRC}" >&2
  exit 2
fi

echo "pulling ${INSTANCE}:${SRC} -> ${DEST_RUN}"
limactl copy -r "${INSTANCE}:${SRC}" "${DEST_PARENT_ABS}/"

# Provenance: record what was pulled, from where, and when. Results that leave
# a quarantined environment should never be anonymous once they are outside it.
MANIFEST="${DEST_RUN}/PULL-MANIFEST.txt"
{
  echo "pulled_at:      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "instance:       ${INSTANCE}"
  echo "guest_path:     ${SRC}"
  echo "host_path:      ${DEST_RUN}"
  echo "guest_node:     $(limactl shell "$INSTANCE" -- node --version)"
  echo "pulled_by:      $0"
  echo "files:"
  find "${DEST_RUN}" -type f -not -name PULL-MANIFEST.txt -exec shasum -a 256 {} \; 2>/dev/null | sed 's|^|  |'
} > "$MANIFEST"

echo "wrote ${MANIFEST}"
echo "done."
