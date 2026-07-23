#!/usr/bin/env bash
# sibling-query.sh — index-first /aside lookup against a past Claude Code session.
#
# Two modes:
#   index             — cheap call; lists available workstreams + slice keys + counts.
#   slice <key> [ws]  — pulls one named slice (optionally scoped to a workstream id).
#
# Usage:
#   tools/signals/sibling-query.sh <session-id> index
#   tools/signals/sibling-query.sh <session-id> slice <key> [workstream-id]
#
# Slice keys: goals decisions artifacts commands_run dead_ends open_threads
#             posture_changes vendor_state memory_writes plans_touched
#
# Output goes to stdout. The caller (this Claude session) reads + absorbs.
# No credential handling. No file writes. Read-only against the resumed session.

set -euo pipefail

SESSION_ID="${1:-}"
MODE="${2:-}"

if [[ -z "$SESSION_ID" || -z "$MODE" ]]; then
  echo "usage: $0 <session-id> index | slice <key> [workstream-id]" >&2
  exit 2
fi

VALID_KEYS="goals decisions artifacts commands_run dead_ends open_threads posture_changes vendor_state memory_writes plans_touched"

case "$MODE" in
  index)
    PROMPT='You are being sibling-queried. Output ONLY a JSON index of available slices for this session. No prose, no markdown fence. Schema:
{
  "workstreams": [{"id": "<short-id>", "one_line": "<terse>"}],
  "slices": [
    {"key": "goals", "count": <int>, "one_line": "<terse>"},
    {"key": "decisions", "count": <int>, "one_line": "<terse>"},
    {"key": "artifacts", "count": <int>, "one_line": "<terse>"},
    {"key": "commands_run", "count": <int>, "one_line": "<terse>"},
    {"key": "dead_ends", "count": <int>, "one_line": "<terse>"},
    {"key": "open_threads", "count": <int>, "one_line": "<terse>"},
    {"key": "posture_changes", "count": <int>, "one_line": "<terse>"},
    {"key": "vendor_state", "count": <int>, "one_line": "<terse>"},
    {"key": "memory_writes", "count": <int>, "one_line": "<terse>"},
    {"key": "plans_touched", "count": <int>, "one_line": "<terse>"}
  ]
}
Omit slices with count 0. Self-contained — assume reader has zero prior context.'
    ;;
  slice)
    KEY="${3:-}"
    WS="${4:-}"
    if [[ -z "$KEY" ]]; then
      echo "slice mode requires <key>. Valid: $VALID_KEYS" >&2
      exit 2
    fi
    if ! [[ " $VALID_KEYS " == *" $KEY "* ]]; then
      echo "invalid key: $KEY. Valid: $VALID_KEYS" >&2
      exit 2
    fi

    SCOPE_LINE=""
    [[ -n "$WS" ]] && SCOPE_LINE="Scope: workstream id = $WS. Exclude items outside that workstream."

    case "$KEY" in
      goals)
        SCHEMA='[{"workstream":"<id>","ask":"<verbatim or near-verbatim>","when":"<order index>"}]'
        ;;
      decisions)
        SCHEMA='[{"workstream":"<id>","decision":"<terse>","why":"<verbatim quote if available>","load_bearing":<bool>}]'
        ;;
      artifacts)
        SCHEMA='[{"workstream":"<id>","path":"<absolute>","kind":"<plan|spec|memory|signal|debrief|code|other>","status":"<created|updated|reverted>"}]'
        ;;
      commands_run)
        SCHEMA='[{"cmd":"<exact>","outcome":"<one_line>","artifacts_touched":["<absolute>"]}]'
        ;;
      dead_ends)
        SCHEMA='[{"tried":"<terse>","reverted":<bool>,"why":"<verbatim if available>"}]'
        ;;
      open_threads)
        SCHEMA='[{"workstream":"<id>","item":"<terse>","blocker":"<terse|none>","next_owner":"<operator|coordinator|worker|reviewer>","next_command":"<exact or null>"}]'
        ;;
      posture_changes)
        SCHEMA='[{"rule":"<terse>","verbatim_quote":"<from operator if any>","scope":"<this-session|durable>"}]'
        ;;
      vendor_state)
        SCHEMA='[{"system":"<1password|git|launchd|other>","change":"<terse>","identifier":"<vault|branch|item-id|etc>"}]'
        ;;
      memory_writes)
        SCHEMA='[{"path":"<absolute>","kind":"<feedback|project|user|reference>","one_line":"<terse>"}]'
        ;;
      plans_touched)
        SCHEMA='[{"plan_id":"<id>","path":"<absolute>","status":"<authored|executed|amended|awaiting-approval|complete|blocked>"}]'
        ;;
    esac

    PROMPT="You are being sibling-queried. Return ONLY slice '$KEY' as a JSON array matching this schema: $SCHEMA. No prose, no markdown fence, no trailing commentary. $SCOPE_LINE Verbatim quotes where the schema asks for them. Absolute paths only."
    ;;
  *)
    echo "unknown mode: $MODE. Use: index | slice" >&2
    exit 2
    ;;
esac

# Anchor cwd to Mythos repo root so the resumed Claude session inherits the
# canonical per-project memory key, not whatever cwd the caller invoked us from.
# Identity env declares this an identity-class Sam launch for the SessionStart
# boot guard (~/.claude/hooks/mythos-session-start-guard.cjs).
cd "$(dirname "$0")/../.." || exit 1
export MYTHOS_IDENTITY_ID=sam
exec claude --print --resume "$SESSION_ID" "$PROMPT"
