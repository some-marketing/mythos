#!/usr/bin/env bash
# mirror-deliverables.sh — mirror delesign delivered assets OUT of the repo to a
# cloud-synced destination (OneDrive / Internxt), preserving the client directory
# structure, WITHOUT deleting the source until the operator verifies.
#
# The repo keeps only deliverables-manifest.json pointers (git-tracked); the heavy
# binaries live in the cloud mirror. This tool is the copy step; pruning the local
# copies is a separate, deliberate operator action after verification.
#
# Usage:
#   tools/hygiene/mirror-deliverables.sh --client {CLIENT_CODE} --dest "/path/to/OneDrive/root" [--execute]
#   tools/hygiene/mirror-deliverables.sh --src clients/{CLIENT_CODE}/projects/july-2026-offers/delesign/deliverables --dest "..." [--execute]
#
# Default is DRY-RUN (rsync -n). Add --execute to copy. Never deletes source.
# Destination layout mirrors the in-repo path under <dest>/Mythos-deliverables/<relpath>.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT="" ; SRC="" ; DEST="" ; EXECUTE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --client) CLIENT="$2"; shift 2;;
    --src) SRC="$2"; shift 2;;
    --dest) DEST="$2"; shift 2;;
    --execute) EXECUTE=1; shift;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[ -n "$DEST" ] || { echo "ERROR: --dest required" >&2; exit 2; }

SRCS=()
if [ -z "$SRC" ] && [ -n "$CLIENT" ]; then
  # mirror ALL delesign deliverables dirs for the client (bash 3.2 portable — no mapfile)
  while IFS= read -r d; do [ -n "$d" ] && SRCS+=("$d"); done < <(cd "$REPO_ROOT" && find "clients/$CLIENT"/projects/*/delesign/deliverables -maxdepth 0 -type d 2>/dev/null)
elif [ -n "$SRC" ]; then
  SRCS=("$SRC")
else
  echo "ERROR: pass --client CODE or --src PATH" >&2; exit 2
fi

[ "${#SRCS[@]}" -gt 0 ] || { echo "no deliverables dirs found" >&2; exit 1; }

RSYNC_FLAGS=(-a --stats)
[ "$EXECUTE" -eq 1 ] || RSYNC_FLAGS+=(-n)

echo "[mirror-deliverables] mode=$([ $EXECUTE -eq 1 ] && echo COPY || echo DRY-RUN)  dest=$DEST"
for s in "${SRCS[@]}"; do
  abs="$REPO_ROOT/$s"
  [ -d "$abs" ] || { echo "  skip (missing): $s"; continue; }
  target="$DEST/Mythos-deliverables/$s"
  echo "  $s  ->  $target"
  [ "$EXECUTE" -eq 1 ] && mkdir -p "$target"
  rsync "${RSYNC_FLAGS[@]}" "$abs/" "${target}/" 2>&1 | tail -4
done
echo "[mirror-deliverables] done. Source NOT deleted — verify the cloud copy, then prune locally by hand."
