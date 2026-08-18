#!/usr/bin/env bash
# _dev/sim-runs/vm/revert-to-golden.sh — reset the working VM to the pristine
# provisioned baseline, so every experiment family starts from the same state.
#
# WHY CLONE AND NOT SNAPSHOT: `limactl snapshot` is QEMU-only; on an Apple
# Virtualization.framework instance it exits with "unimplemented" (verified,
# see the runbook). Lima's supported equivalent for vz is a full instance
# clone, so the baseline here is a whole protected instance, ant-world-golden,
# that is provisioned and then never run. Reverting means destroying the
# working instance and re-cloning it from that untouched original.
#
# DESTRUCTIVE: this deletes the working instance, including any run output
# still inside it. Pull anything you care about FIRST:
#     _dev/sim-runs/vm/pull-results.sh <run-name>
#
# Usage:
#   _dev/sim-runs/vm/revert-to-golden.sh          # prompts before destroying
#   _dev/sim-runs/vm/revert-to-golden.sh --yes    # unattended

set -euo pipefail

INSTANCE="${ANT_WORLD_INSTANCE:-ant-world}"
GOLDEN="${ANT_WORLD_GOLDEN:-ant-world-golden}"

if [ "$INSTANCE" = "$GOLDEN" ]; then
  echo "FAIL-CLOSED: working instance and golden instance are the same ('$INSTANCE')" >&2
  exit 2
fi

if ! limactl list --quiet | grep -qx "$GOLDEN"; then
  echo "FAIL-CLOSED: golden instance '$GOLDEN' does not exist; nothing to revert to." >&2
  exit 2
fi

ASSUME_YES=false
[ "${1:-}" = "--yes" ] && ASSUME_YES=true

if limactl list --quiet | grep -qx "$INSTANCE"; then
  echo "About to DESTROY instance '$INSTANCE' and re-clone it from '$GOLDEN'."
  echo "Any run output still inside the guest will be lost."
  if [ "$ASSUME_YES" != true ]; then
    read -r -p "Type 'revert' to continue: " reply
    [ "$reply" = "revert" ] || { echo "aborted."; exit 1; }
  fi
  limactl stop "$INSTANCE" 2>/dev/null || true
  limactl delete "$INSTANCE"
fi

limactl clone "$GOLDEN" "$INSTANCE"
echo "reverted: '$INSTANCE' is now a fresh copy of '$GOLDEN' (stopped)."
echo "start it with: limactl start $INSTANCE"
