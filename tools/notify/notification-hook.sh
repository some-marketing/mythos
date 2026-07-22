#!/usr/bin/env bash
# notification-hook.sh — Claude Code Notification-event bridge to operator-ping.
# Fires automatically whenever Claude Code needs your attention (permission
# prompt, input needed, idle-waiting). DESK banner + sound only — deliberately
# NOT phone/Twilio, so an automatic trigger can never spam your phone. Phone
# push (PushNotification) and Twilio calls stay model-driven, reserved for real
# gates the model judges worth a walk-back.
#
# NOTE: NOT yet wired — the .claude/settings.json hooks.Notification entry is governance-gated and
# must be added by the operator before this fires. Reads the event JSON on
# stdin ({ "message": "...", ... }); never fails the hook (exit 0 always).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PAYLOAD="$(cat 2>/dev/null || true)"
MSG="$(printf '%s' "$PAYLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.message||'needs your input').slice(0,140))}catch(e){process.stdout.write('needs your input')}})" 2>/dev/null)"
[ -z "$MSG" ] && MSG="needs your input"
"$ROOT/tools/notify/operator-ping.sh" --msg "$MSG" --level gate --title "Mythos — come check" >/dev/null 2>&1 || true
exit 0
