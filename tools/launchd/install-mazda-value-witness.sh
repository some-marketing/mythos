#!/usr/bin/env bash
# Install (or reinstall) the Mazda lead-value clearance witness LaunchAgent.
# Idempotent: boots out any stale registration first, then bootstraps fresh.
# Fixes "Bootstrap failed: 5: Input/output error" (= label already registered).
#
# Run:  bash tools/launchd/install-mazda-value-witness.sh
set -euo pipefail

REPO_ROOT="/Users/admin/dev/Mythos-recovered"
LABEL="ca.somemarketing.smos.mazda-value-witness"
SRC="${REPO_ROOT}/tools/launchd/${LABEL}.plist"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

echo "==> copying plist -> ${DEST}"
cp "${SRC}" "${DEST}"

echo "==> clearing any stale registration (ok if this errors)"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true

echo "==> bootstrapping"
launchctl bootstrap "gui/${UID_NUM}" "${DEST}"

echo "==> verify"
launchctl print "gui/${UID_NUM}/${LABEL}" | grep -iE "state|runatload|hour|minute" || true

echo "==> done. It stays idle until 2026-06-10, then runs the read-only witness daily and self-retires on LIKELY_FIXED."
