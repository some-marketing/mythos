#!/usr/bin/env bash
# sync-private-remotes.sh — push current branch to private redundancy remotes
#
# Usage: ./tools/hygiene/sync-private-remotes.sh
#
# Pushes the current branch only to remote names listed in the ignored local
# MYTHOS_REDUNDANCY_REMOTES binding. Remote URLs stay in local git config.
#
# Policy (operator decision 2026-06-10):
#   - Each remote is attempted independently; an absent/unreachable remote is a
#     WARN + continue (exit 0) — a missing drive or lost network must not block
#     the shutdown sequence.
#   - A push REJECTION (non-fast-forward) is a loud error that exits 1. That
#     signals a divergence that requires human resolution; force-push is never
#     performed by this script.
#
# Local-only path exclusions come from the ignored local
# MYTHOS_LOCAL_ONLY_PATHS comma-separated binding. The script refuses to push
# when an unpushed commit touches a configured prefix.
#
# Integrates into the /shutdown sequence as the last mechanical step.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH="$(git -C "$REPO_ROOT" symbolic-ref --short HEAD 2>/dev/null)"

REDUNDANCY_REMOTES=()
EXCLUDED_PATH_PATTERNS=()
IFS=',' read -r -a REDUNDANCY_REMOTES <<< "${MYTHOS_REDUNDANCY_REMOTES:-}"
IFS=',' read -r -a EXCLUDED_PATH_PATTERNS <<< "${MYTHOS_LOCAL_ONLY_PATHS:-}"

if [ -z "$BRANCH" ]; then
  echo "[sync-private-remotes] ERROR: could not determine current branch (detached HEAD?)" >&2
  exit 1
fi

echo "[sync-private-remotes] Branch: $BRANCH"
echo "[sync-private-remotes] Remotes: ${REDUNDANCY_REMOTES[*]:-(none configured)}"
echo "[sync-private-remotes] Excluded local-only paths: ${EXCLUDED_PATH_PATTERNS[*]-}"
echo ""

EXIT_CODE=0

if [ "${#REDUNDANCY_REMOTES[@]}" -eq 0 ] || [ -z "${REDUNDANCY_REMOTES[0]}" ]; then
  echo "[sync-private-remotes] WARN  MYTHOS_REDUNDANCY_REMOTES is empty; no push performed"
  exit 0
fi

# Returns 0 (found) if any commit in remote_tip..HEAD touches an excluded
# path. remote_tip may be empty (new/unknown remote branch) -- in that case
# check the whole local history reachable from HEAD, since nothing has ever
# been confirmed pushed.
find_excluded_commit() {
  local remote_tip="$1"
  if [ "${#EXCLUDED_PATH_PATTERNS[@]}" -eq 0 ] || [ -z "${EXCLUDED_PATH_PATTERNS[0]}" ]; then
    return 1
  fi
  local range
  if [ -n "$remote_tip" ] && git -C "$REPO_ROOT" cat-file -e "$remote_tip" 2>/dev/null; then
    range="$remote_tip..HEAD"
  else
    range="HEAD"
  fi
  local hit
  hit="$(git -C "$REPO_ROOT" log --oneline "$range" -- "${EXCLUDED_PATH_PATTERNS[@]}" 2>/dev/null | head -1)"
  if [ -n "$hit" ]; then
    echo "$hit"
    return 0
  fi
  return 1
}

# --- push to one remote ---
# Arguments: <remote-name>
push_remote() {
  local remote="$1"

  # 1. Confirm the remote is registered in this repo
  if ! git -C "$REPO_ROOT" remote get-url "$remote" >/dev/null 2>&1; then
    echo "[sync-private-remotes] WARN  $remote — remote not registered in this repo, skipping"
    return 0
  fi

  # 2. Reachability probe (cheap; treat failure as absent, not an error)
  if ! git -C "$REPO_ROOT" ls-remote "$remote" HEAD >/dev/null 2>&1; then
    echo "[sync-private-remotes] WARN  $remote — not reachable, skipping"
    return 0
  fi

  # 3. Local-only path guard: refuse to push THIS remote at all if any
  # not-yet-pushed commit touches an excluded path. A partial/rewritten push
  # is not attempted -- git history is linear here, so there is no clean way
  # to push "everything except commit X" without a history rewrite, which is
  # far riskier than simply waiting until the excluded work is no longer new.
  local remote_tip
  remote_tip="$(git -C "$REPO_ROOT" ls-remote "$remote" "refs/heads/$BRANCH" 2>/dev/null | cut -f1)"
  local excluded_hit
  if excluded_hit="$(find_excluded_commit "$remote_tip")"; then
    echo "[sync-private-remotes] WARN  $remote — skipping push: local-only commit(s) not yet pushed (e.g. \"$excluded_hit\")" >&2
    echo "[sync-private-remotes]       Touches an excluded path (${EXCLUDED_PATH_PATTERNS[*]}). This is expected while that work is in progress -- not an error." >&2
    return 0
  fi

  # 4. Push — capture stderr so we can classify the outcome
  local push_out
  if push_out=$(git -C "$REPO_ROOT" push "$remote" "$BRANCH" 2>&1); then
    # git prints "Everything up-to-date" or the ref update line to stderr/stdout
    if echo "$push_out" | grep -qi "up.to.date\|up-to-date"; then
      echo "[sync-private-remotes] OK    $remote — already up-to-date"
    else
      echo "[sync-private-remotes] OK    $remote — pushed $BRANCH"
    fi
  else
    # Distinguish rejection causes. Check DISK/UNPACKER errors FIRST — a full
    # remote disk also prints "[remote rejected]", and mislabeling it as
    # divergence sends operators chasing history-conflict phantoms.
    if echo "$push_out" | grep -qi "unpack failed\|unpacker error\|no space left\|unable to create temporary object\|ENOSPC"; then
      echo "[sync-private-remotes] WARN  $remote — push failed: remote DISK FULL / unpacker error (NOT divergence)" >&2
      echo "[sync-private-remotes]       Free space on the remote target, then re-run. Do NOT resolve as a merge conflict." >&2
      echo "$push_out" | sed 's/^/[sync-private-remotes]       /' >&2
    elif echo "$push_out" | grep -qi "non-fast-forward\|fetch first\|tip of your current branch is behind\|\[rejected\]"; then
      echo "[sync-private-remotes] ERROR $remote — push REJECTED (non-fast-forward divergence detected)" >&2
      echo "[sync-private-remotes]       Human resolution required. Never force-push." >&2
      echo "$push_out" | sed 's/^/[sync-private-remotes]       /' >&2
      EXIT_CODE=1
    else
      echo "[sync-private-remotes] WARN  $remote — push failed (network/ssh error, treating as absent)" >&2
      echo "$push_out" | sed 's/^/[sync-private-remotes]       /' >&2
    fi
  fi
}

for remote in "${REDUNDANCY_REMOTES[@]}"; do
  remote="${remote#"${remote%%[![:space:]]*}"}"
  remote="${remote%"${remote##*[![:space:]]}"}"
  [ -n "$remote" ] && push_remote "$remote"
done

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[sync-private-remotes] Done — all reachable remotes synced."
else
  echo "[sync-private-remotes] Done — one or more remotes reported a REJECTION (see errors above)." >&2
fi

exit "$EXIT_CODE"
