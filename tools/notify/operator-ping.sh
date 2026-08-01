#!/usr/bin/env bash
# operator-ping.sh — one reusable "come check on this" signal that fans out across
# the surfaces available on this Mac. Dependency-free core (osascript + afplay +
# say, all built into macOS); optional phone escalation via the existing Twilio
# notifier. Safe to call from hooks (fast, best-effort, never fails the caller).
#
# Usage:
#   tools/notify/operator-ping.sh --msg "reviews done — plan v2 ready" --level done
#   tools/notify/operator-ping.sh --msg "gate: canonize the loop law?" --level gate --say
#   tools/notify/operator-ping.sh --msg "money gate: publish live ad" --level gate --call
#
# Flags:
#   --msg   "<text>"         (required) the one-line "what needs you"
#   --level info|done|gate   (default info) picks sound + urgency
#   --title "<text>"         (default "Mythos") notification title
#   --say                    also speak the message aloud (macOS `say`)
#   --call                   also place a Twilio phone call (gates when away; best-effort)
#
# Levels: info=quiet tick · done=pleasant chime · gate=insistent (needs a decision).
set -uo pipefail

MSG=""; LEVEL="info"; TITLE="Mythos"; DO_SAY=0; DO_CALL=0; DO_SMS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --msg)   MSG="${2:-}"; shift 2;;
    --level) LEVEL="${2:-info}"; shift 2;;
    --title) TITLE="${2:-Mythos}"; shift 2;;
    --say)   DO_SAY=1; shift;;
    --call)  DO_CALL=1; shift;;
    --sms)   DO_SMS=1; shift;;   # text the operator -> phone -> paired watch
    *) shift;;
  esac
done
[ -z "$MSG" ] && { echo "operator-ping: --msg required" >&2; exit 0; }  # exit 0: never fail a hook

case "$LEVEL" in
  gate) SOUND="/System/Library/Sounds/Sosumi.aiff"; OSA_SOUND="Sosumi";;
  done) SOUND="/System/Library/Sounds/Glass.aiff";  OSA_SOUND="Glass";;
  *)    SOUND="/System/Library/Sounds/Tink.aiff";   OSA_SOUND="Tink";;
esac

# 1) macOS banner (with native sound)
osascript -e "display notification \"${MSG//\"/\'}\" with title \"${TITLE}\" subtitle \"[${LEVEL}]\" sound name \"${OSA_SOUND}\"" >/dev/null 2>&1 &

# 2) guaranteed audible cue (gate = play twice for insistence)
if [ -f "$SOUND" ]; then
  afplay "$SOUND" >/dev/null 2>&1 &
  [ "$LEVEL" = "gate" ] && ( sleep 0.6; afplay "$SOUND" >/dev/null 2>&1 ) &
fi

# 3) optional spoken cue
[ "$DO_SAY" = "1" ] && say -v Samantha "${MSG}" >/dev/null 2>&1 &

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# 4) optional SMS -> phone -> paired watch (best-effort; needs operator number)
if [ "$DO_SMS" = "1" ]; then
  ( node "$ROOT/tools/notify/twilio-sms.js" --body "Mythos [${LEVEL}]: ${MSG}" >/dev/null 2>&1 || true ) &
fi

# 5) optional phone escalation (best-effort; needs Twilio creds — never blocks)
if [ "$DO_CALL" = "1" ]; then
  ( node "$ROOT/tools/notify/twilio-call.js" --say "Mythos needs you. ${MSG}" >/dev/null 2>&1 || true ) &
fi

exit 0
