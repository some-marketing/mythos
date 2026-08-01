#!/usr/bin/env bash
# wait-for-airdropped-audio.sh — Block until new audio/video files appear in a watch dir, then list them.
# Bounded + interruptible (Ctrl-C / kill anytime). Used to catch AirDropped call recordings hands-free.
#
# Usage: wait-for-airdropped-audio.sh [watch_dir] [timeout_s] [settle_s]
#   defaults: ~/Downloads, 1200s timeout, 25s settle (wait for the rest of a batch after first hit)
# Emits: "NEWFILE: <path>" lines on detection, or "TIMEOUT: ..." if none.
set -euo pipefail

WATCH="${1:-$HOME/Downloads}"
TIMEOUT="${2:-1200}"
SETTLE="${3:-25}"
EXTS='mov|m4a|mp4|wav|mp3|caf|aac'

marker="$(mktemp)"
# 3-minute grace so an AirDrop completed just before arming is still caught; avoids stale false-positives.
touch -t "$(date -v-3M +%Y%m%d%H%M.%S)" "$marker"

find_new() {
  find "$WATCH" -maxdepth 1 -type f -newer "$marker" 2>/dev/null | grep -iE "\.(${EXTS})$" || true
}

elapsed=0; step=8
while [ "$elapsed" -lt "$TIMEOUT" ]; do
  hits="$(find_new)"
  if [ -n "$hits" ]; then
    sleep "$SETTLE"             # let the rest of the batch finish copying
    echo "DETECTED after ${elapsed}s in $WATCH:"
    find_new | while read -r p; do [ -n "$p" ] && echo "NEWFILE: $p"; done
    rm -f "$marker"; exit 0
  fi
  sleep "$step"; elapsed=$((elapsed+step))
done
rm -f "$marker"
echo "TIMEOUT: no new audio/video in $WATCH after ${TIMEOUT}s"
exit 0
