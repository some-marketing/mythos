#!/usr/bin/env bash
# PostToolUse hook: auto-create Dart task when a plan/amendment/repair JSON is written.
#
# Reads tool input from stdin (Claude Code hook contract), extracts file_path,
# checks if it matches a plan-class artifact, and dispatches the dart task creation
# in the background so the hook never blocks the operator.
#
# Always exits 0 so a Dart-side failure cannot block plan writes.

set -u

# env-path-hardening s2: REPO_ROOT was a hardcoded OLD absolute path — the
# CRITICAL silent-resurrection writer (mkdir -p of an old-path lifecycle dir on
# every plan write). Now the ONE canonical shell source. circuit-breaker during
# staged rollout; promoted to 'hard' (with mkdir guarded on rc) after s5.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=../lib/repo-root.sh
source "$SELF_DIR/../lib/repo-root.sh"
REPO_ROOT="$(repo_root hard)" || exit 3
HELPER="$REPO_ROOT/tools/dart-integration/create-task-from-plan.js"
LOG_DIR="$REPO_ROOT/_dev/reports/lifecycle"
LOG_FILE="$LOG_DIR/dart-autocreate.jsonl"

mkdir -p "$LOG_DIR"

# Read stdin (claude code passes tool-input JSON)
input=$(cat 2>/dev/null || true)

# Extract file_path with a tolerant grep + python fallback
file_path=$(printf '%s' "$input" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    p = d.get('tool_input', {}).get('file_path') or d.get('tool_input', {}).get('path') or ''
    print(p)
except Exception:
    pass
" 2>/dev/null)

if [ -z "$file_path" ]; then
  exit 0
fi

# Classify the artifact: plan-class (existing) vs concept (new)
artifact_kind=""
case "$file_path" in
  *"/plans/"*"__plan.json") artifact_kind="plan" ;;
  *"/plans/"*"__amendment__"*".json") artifact_kind="plan" ;;
  *"/plans/"*"__repair__"*".json") artifact_kind="plan" ;;
  *"/_dev/reports/analysis/task-plans/"*"__plan.json") artifact_kind="plan" ;;
  *"/_dev/reports/analysis/task-plans/"*"__amendment__"*".json") artifact_kind="plan" ;;
  *"/_dev/reports/analysis/task-plans/"*"__repair__"*".json") artifact_kind="plan" ;;
  *"/_dev/concepts/"*.md)
    # Skip private/template/readme files (any flat concept whose basename starts with _)
    base="$(basename "$file_path")"
    case "$base" in
      _*) exit 0 ;;
    esac
    artifact_kind="concept"
    ;;
  *) exit 0 ;;
esac

# Log the trigger (one line jsonl) for audit
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '{"ts":"%s","file":"%s","kind":"%s","action":"dispatch"}\n' "$ts" "$file_path" "$artifact_kind" >> "$LOG_FILE"

# Dispatch in background, log output to lifecycle dir, never block
if [ "$artifact_kind" = "concept" ]; then
  CONCEPT_HELPER="$REPO_ROOT/tools/dart-integration/concept-md-to-task.js"
  (
    node "$CONCEPT_HELPER" "$file_path" >> "$LOG_FILE" 2>&1
    printf '{"ts":"%s","file":"%s","kind":"concept","action":"complete","exit":%d}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$file_path" "$?" >> "$LOG_FILE"
  ) &
else
  (
    node "$HELPER" "$file_path" >> "$LOG_FILE" 2>&1
    printf '{"ts":"%s","file":"%s","kind":"plan","action":"complete","exit":%d}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$file_path" "$?" >> "$LOG_FILE"
  ) &
fi

exit 0
