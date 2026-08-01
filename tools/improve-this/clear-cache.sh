#!/usr/bin/env bash
# Clear-on-exit for the .improve-this/ derived cache.
#
# Ratified 2026-06-30 (operator freshness contract): the .improve-this/ cache
# is permitted, on the condition that it is cleared at session exit and
# refreshed-on-touch during the session (see .claude/skills/prompt-refinement/SKILL.md
# <cache_policy> and tools/context/build-improve-this-cache.cjs).
#
# This script only ever touches .improve-this/ under the repo root. It removes
# the generated knowledgebase files and freshness.json so the next session (or
# next refresh-on-touch) starts from source truth, not a stale snapshot. It is
# idempotent: running it against an already-clear or missing cache is a no-op.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="${REPO_ROOT}/.improve-this"

# Safety: refuse to run unless CACHE_DIR resolves under the repo root and is
# named exactly .improve-this. Never rm -rf anything else.
case "${CACHE_DIR}" in
  "${REPO_ROOT}"/.improve-this) ;;
  *) echo "improve-this clear-cache: refusing unexpected path: ${CACHE_DIR}" >&2; exit 1 ;;
esac

if [ ! -d "${CACHE_DIR}" ]; then
  echo "improve-this clear-cache: no cache directory present, nothing to do"
  exit 0
fi

# Known generated artifacts (must match CACHE_FILES + freshness.json in
# tools/context/build-improve-this-cache.cjs). Listed explicitly rather than
# wildcard-deleting the directory, so any future non-generated file placed
# here by an operator is left untouched.
GENERATED_FILES=(
  "README.md"
  "repo-map.md"
  "commands.md"
  "conventions.md"
  "testing.md"
  "risks.md"
  "freshness.json"
)

removed=0
for f in "${GENERATED_FILES[@]}"; do
  target="${CACHE_DIR}/${f}"
  if [ -f "${target}" ]; then
    rm -f -- "${target}"
    removed=$((removed + 1))
  fi
done

echo "improve-this clear-cache: removed ${removed} generated file(s) from ${CACHE_DIR}"
exit 0
