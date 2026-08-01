#!/usr/bin/env bash
# repo-root.sh — the ONE canonical repo-root source for SHELL hooks/scripts.
#
# env-path-hardening s1 decision: bash hooks cannot require() the Node
# canonical-root module, so this is its shell twin (same contract, same
# anchors). It is the IMPLEMENTATION of smallest-change for shell consumers,
# not a new mechanism. Resolution is script-location-relative
# (this file lives at <root>/tools/lib/), never $PWD, never hardcoded.
#
# Usage:
#   source "<root>/tools/lib/repo-root.sh"
#   ROOT="$(repo_root hard)"            || exit 3   # refuse on invalid root
#   ROOT="$(repo_root circuit-breaker)"               # log loud, proceed
#
# Validity = resolved root must contain ALL stable anchors. A root failing
# validation is stale/foreign; mkdir under it is the silent-resurrection bug.

repo_root() {
  local mode="${1:-hard}"
  local self_dir root
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || return 3
  root="${MYTHOS_ROOT:-$(cd "$self_dir/../.." && pwd -P)}"
  # .git is a directory in a normal checkout but a file in legitimate
  # worktrees/submodules — accept either, matching canonical-root.cjs's
  # existsSync semantics. Requiring -d here false-positives on git worktrees.
  if [ -d "$root/instructions/canonical" ] && { [ -d "$root/.git" ] || [ -f "$root/.git" ]; } && [ -f "$root/package.json" ]; then
    printf '%s\n' "$root"
    return 0
  fi
  local msg="[canonical-root] shell repo-root FAILED anchor validation: ${root} (anchors: instructions/canonical, .git, package.json)"
  if [ "$mode" = "circuit-breaker" ]; then
    printf '%s [circuit-breaker: proceeding with best-effort root]\n' "$msg" >&2
    printf '%s\n' "$root"
    return 0
  fi
  printf '%s [hard: refusing — do NOT mkdir/write under this root]\n' "$msg" >&2
  return 3
}
