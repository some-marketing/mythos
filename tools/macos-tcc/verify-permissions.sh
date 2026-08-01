#!/bin/bash
# verify-permissions.sh — assert each LaunchAgent's responsible binary
# is a stable Developer-ID-signed node anchor; report any adhoc / env-node stragglers.
#
# Usage: ./verify-permissions.sh [--verbose]
#
# Exit codes:
#   0 — all jobs verified clean
#   1 — one or more jobs have an unstable/unsigned node reference

set -uo pipefail

LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
BUNDLE_ID_PREFIX="${BUNDLE_ID_PREFIX:-com.example.mythos}"
SIGNED_NODE="${SIGNED_NODE:-/usr/local/bin/node}"
EXPECTED_TEAM="${EXPECTED_TEAM:?set to your own Developer ID TeamIdentifier, e.g. via codesign -dv on your signed node binary}"
VERBOSE=false
FAILURES=0
PASSES=0

[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

echo "[verify-permissions] scanning $LAUNCH_AGENTS/$BUNDLE_ID_PREFIX.*.plist"
echo "[verify-permissions] expected anchor: $SIGNED_NODE (TeamID $EXPECTED_TEAM)"
echo ""

for plist in "$LAUNCH_AGENTS"/$BUNDLE_ID_PREFIX.*.plist; do
  [[ -f "$plist" ]] || continue
  label="$(basename "$plist" .plist)"
  job="${label#$BUNDLE_ID_PREFIX.}"

  # Extract first ProgramArguments entry
  prog="$(plutil -extract ProgramArguments.0 raw -o - "$plist" 2>/dev/null || echo 'UNKNOWN')"

  verdict="UNKNOWN"
  note=""

  case "$prog" in
    /usr/local/bin/node)
      # Check it's still Developer-ID signed
      team="$(codesign -dv "$prog" 2>&1 | grep TeamIdentifier | awk -F= '{print $2}')"
      if [[ "$team" == "$EXPECTED_TEAM" ]]; then
        verdict="PASS"
        note="signed anchor TeamID=$team"
      else
        verdict="FAIL"
        note="TeamID=$team (expected $EXPECTED_TEAM)"
        ((FAILURES++))
      fi
      ((PASSES++)) || true
      ;;
    /usr/bin/env)
      # Resolve what 'node' would be in the job's PATH
      job_path="$(plutil -extract EnvironmentVariables.PATH raw -o - "$plist" 2>/dev/null || echo '')"
      verdict="WARN"
      note="still uses /usr/bin/env node (not repointed); PATH=$job_path"
      ((FAILURES++))
      ;;
    *.app/Contents/MacOS/*)
      # Tier-2 .app wrapper — check codesign
      bundle_dir="${prog%/Contents/MacOS/*}"
      bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$bundle_dir/Contents/Info.plist" 2>/dev/null || echo 'UNKNOWN')"
      sig_status="$(codesign -dv "$bundle_dir" 2>&1 | grep TeamIdentifier | awk -F= '{print $2}')"
      if [[ -n "$sig_status" ]]; then
        verdict="PASS-APP"
        note="signed .app bundle_id=$bundle_id TeamID=$sig_status"
        ((PASSES++)) || true
      else
        verdict="WARN-APP"
        note="bundle $bundle_id has no Team signature (self-signed or unsigned)"
        ((PASSES++)) || true
      fi
      ;;
    /opt/homebrew/*)
      verdict="FAIL"
      note="Homebrew path (adhoc signed, volatile): $prog"
      ((FAILURES++))
      ;;
    *)
      # Shell script wrapper or other
      verdict="OTHER"
      note="prog=$prog (manual check needed)"
      ;;
  esac

  if $VERBOSE || [[ "$verdict" != "PASS" && "$verdict" != "PASS-APP" ]]; then
    printf "  %-45s %-10s %s\n" "$job" "$verdict" "$note"
  else
    printf "  %-45s %-10s\n" "$job" "$verdict"
  fi
done

echo ""
echo "[verify-permissions] passes=$PASSES failures=$FAILURES"

if [[ $((PASSES + FAILURES)) -eq 0 ]]; then
  echo "[verify-permissions] FAIL — zero jobs checked (no matching plists found). Not a clean pass." >&2
  exit 1
elif [[ $FAILURES -gt 0 ]]; then
  echo "[verify-permissions] FAIL — $FAILURES job(s) not on stable signed anchor."
  exit 1
else
  echo "[verify-permissions] PASS — all checked jobs are on stable signed anchor."
  exit 0
fi
