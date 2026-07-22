#!/usr/bin/env bash
# cli.sh — OPERATOR-ONLY CLI for the outbound iMessage gate.
#
# Refuses to run inside any AI session. Refuses if stdin is not a real tty.
# These are belt-and-suspenders: the AI cannot approve its own drafts.
#
# Usage:
#   tools/channels/outbound/cli.sh list
#   tools/channels/outbound/cli.sh show <draft-id>
#   tools/channels/outbound/cli.sh approve <draft-id>
#   tools/channels/outbound/cli.sh reject <draft-id> "<reason>"

set -euo pipefail

# --- Hard refusal: AI session detection ---------------------------------------
# Common env vars set in AI/agent sessions. If ANY are set, refuse.
AI_SESSION_VARS=(
  CLAUDE_SESSION CLAUDE_CODE_SESSION CLAUDE_AGENT
  CLAUDECODE CLAUDE_CODE_ENTRYPOINT
  CODEX_SESSION OPENAI_AGENT
  ANTHROPIC_AGENT
)
for v in "${AI_SESSION_VARS[@]}"; do
  if [ -n "${!v:-}" ]; then
    echo "REFUSED: AI session detected via env var '$v'." >&2
    echo "This CLI is operator-only. Open a fresh terminal (no Claude/Codex) and re-run." >&2
    exit 2
  fi
done

# --- Hard refusal: stdin must be a real tty -----------------------------------
if [ ! -t 0 ]; then
  echo "REFUSED: stdin is not a tty. This CLI must be run interactively from a terminal." >&2
  exit 2
fi

# --- Locate repo root ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DRAFTS_DIR="$REPO_ROOT/_dev/state/outbound/drafts"
APPROVED_DIR="$REPO_ROOT/_dev/state/outbound/approved"
REJECTED_DIR="$REPO_ROOT/_dev/state/outbound/rejected"
mkdir -p "$DRAFTS_DIR" "$APPROVED_DIR" "$REJECTED_DIR"

cmd="${1:-list}"
shift || true

case "$cmd" in
  list)
    echo "Pending drafts in $DRAFTS_DIR:"
    found=0
    for f in "$DRAFTS_DIR"/*.json; do
      [ -e "$f" ] || continue
      found=1
      id=$(basename "$f" .json)
      to=$(/usr/bin/python3 -c "import json,sys; d=json.load(open('$f')); print(d['recipient_handle'])")
      expires=$(/usr/bin/python3 -c "import json,sys; d=json.load(open('$f')); print(d['expires_at'])")
      reason=$(/usr/bin/python3 -c "import json,sys; d=json.load(open('$f')); print(d['draft_reason'][:60])")
      echo "  $id  →  $to  (expires $expires)"
      echo "      reason: $reason"
    done
    [ $found -eq 0 ] && echo "  (none)"
    ;;

  show)
    id="${1:?show requires <draft-id>}"
    f="$DRAFTS_DIR/$id.json"
    [ -e "$f" ] || { echo "Not found: $f" >&2; exit 1; }
    /usr/bin/python3 -m json.tool "$f"
    ;;

  approve)
    id="${1:?approve requires <draft-id>}"
    f="$DRAFTS_DIR/$id.json"
    [ -e "$f" ] || { echo "Not found: $f" >&2; exit 1; }

    # Check expiry
    expired=$(/usr/bin/python3 -c "
import json, datetime, sys
d = json.load(open('$f'))
exp = datetime.datetime.fromisoformat(d['expires_at'].replace('Z','+00:00'))
now = datetime.datetime.now(datetime.timezone.utc)
print('yes' if now > exp else 'no')
")
    if [ "$expired" = "yes" ]; then
      echo "REFUSED: draft $id has expired. Ask the AI to re-draft." >&2
      mv "$f" "$REJECTED_DIR/${id}__expired.json"
      node "$SCRIPT_DIR/lib/audit-emit.cjs" approve-refused-expired "$id" || true
      exit 1
    fi

    # Show body, ask for confirmation
    echo "=== DRAFT $id ==="
    to=$(/usr/bin/python3 -c "import json; print(json.load(open('$f'))['recipient_handle'])")
    body=$(/usr/bin/python3 -c "import json; print(json.load(open('$f'))['body'])")
    reason=$(/usr/bin/python3 -c "import json; print(json.load(open('$f'))['draft_reason'])")
    echo "  TO:     $to"
    echo "  REASON: $reason"
    echo "  BODY:"
    echo "$body" | sed 's/^/    /'
    echo "================="
    read -r -p "Type 'yes' to approve and queue for send: " confirm
    if [ "$confirm" != "yes" ]; then
      echo "Approval cancelled."
      exit 0
    fi

    # Move to approved/
    mv "$f" "$APPROVED_DIR/$id.json"
    /usr/bin/python3 -c "
import json
p = '$APPROVED_DIR/$id.json'
d = json.load(open(p))
d['state'] = 'approved'
d['approved_by'] = 'operator-cli'
d['approved_at'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
json.dump(d, open(p, 'w'), indent=2)
"
    node "$SCRIPT_DIR/lib/audit-emit.cjs" approved "$id"
    echo "Approved. Send with: tools/channels/outbound/send.cjs --id $id"
    ;;

  reject)
    id="${1:?reject requires <draft-id>}"
    reason="${2:-no-reason-given}"
    f="$DRAFTS_DIR/$id.json"
    [ -e "$f" ] || { echo "Not found: $f" >&2; exit 1; }
    mv "$f" "$REJECTED_DIR/$id.json"
    /usr/bin/python3 -c "
import json
p = '$REJECTED_DIR/$id.json'
d = json.load(open(p))
d['state'] = 'rejected'
d['rejected_at'] = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
d['rejection_reason'] = '$reason'
json.dump(d, open(p, 'w'), indent=2)
"
    node "$SCRIPT_DIR/lib/audit-emit.cjs" rejected "$id" "$reason"
    echo "Rejected: $id"
    ;;

  *)
    echo "Usage: $0 {list|show <id>|approve <id>|reject <id> <reason>}" >&2
    exit 1
    ;;
esac
