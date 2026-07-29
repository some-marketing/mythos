#!/usr/bin/env bash
# sync-repo-mirror.sh — Third /remember write leg: mirror ONE memory file into
# the version-controlled repo surface so memories ship with an install.
#
# WHAT:
#   1. Accepts a single memory file path as $1 (the plaintext copy already
#      written under the harness memory dir, e.g.
#      ~/.claude/projects/-Users-admin-dev-mythos-recovered/memory/<name>.md).
#   2. Copies it (idempotently — only writes if content differs) to
#      Mythos-memories/memory/<name>.md inside this repo.
#   3. Updates Mythos-memories/memory/MEMORY.md with a one-line index entry
#      `- [<name>](<filename>) — <description>`, replacing any existing line
#      for the same filename (never duplicating).
#
# This is a PLAINTEXT, no-secret leg — no 1Password, no credentials, nothing
# to redact. It exists purely so the memory corpus is git-tracked and travels
# with `git clone` / install, instead of living only in the operator's local
# harness directory and the AI-private vault.
#
# Usage:
#   bash tools/memory/sync-repo-mirror.sh <memory-file-path>
#
# Exit codes: 0 ok, 1 precondition fail, 2 frontmatter parse fail.

set -euo pipefail

MEMORY_FILE="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIRROR_DIR="$REPO_ROOT/Mythos-memories/memory"
INDEX_FILE="$MIRROR_DIR/MEMORY.md"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { log "FAIL: $*"; exit "${2:-1}"; }

[[ -n "$MEMORY_FILE" ]] || fail "usage: $0 <memory-file-path>" 1
[[ -f "$MEMORY_FILE" ]] || fail "memory file not found: $MEMORY_FILE" 1

mkdir -p "$MIRROR_DIR"
[[ -f "$INDEX_FILE" ]] || printf '# Memory Index\n\n' > "$INDEX_FILE"

filename="$(basename "$MEMORY_FILE")"
dest="$MIRROR_DIR/$filename"

# ─── Stage 1: parse frontmatter (name/description) for the index line ──────
delim_count="$(grep -c '^---$' "$MEMORY_FILE" || true)"
[[ "$delim_count" -ge 2 ]] \
  || fail "frontmatter malformed in $filename (need >=2 '---' delimiters; found $delim_count)" 2

name="$(awk '/^---$/{n++;next} n==1 && /^name:[[:space:]]/{sub(/^name:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"
description="$(awk '/^---$/{n++;next} n==1 && /^description:[[:space:]]/{sub(/^description:[[:space:]]*/,""); print; exit}' "$MEMORY_FILE")"

[[ -n "$name" ]] || fail "no name field in frontmatter of $filename" 2

# ─── Stage 2: idempotent plaintext copy ─────────────────────────────────────
if [[ -f "$dest" ]] && cmp -s "$MEMORY_FILE" "$dest"; then
  log "$filename already current in repo mirror; skipping copy"
else
  cp "$MEMORY_FILE" "$dest"
  log "copied $filename → $dest"
fi

# ─── Stage 3: idempotent index update (replace-or-append, never duplicate) ──
index_line="- [${name}](${filename}) — ${description}"

python3 - "$INDEX_FILE" "$filename" "$index_line" <<'PYEOF'
import re, sys

index_path, filename, new_line = sys.argv[1], sys.argv[2], sys.argv[3]

with open(index_path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines()

pattern = re.compile(r"^- \[.*\]\(" + re.escape(filename) + r"\)")
replaced = False
out = []
for line in lines:
    if pattern.match(line):
        if not replaced:
            out.append(new_line)
            replaced = True
        # drop any duplicate pre-existing lines for the same file
        continue
    out.append(line)

if not replaced:
    out.append(new_line)

with open(index_path, "w", encoding="utf-8") as f:
    f.write("\n".join(out).rstrip("\n") + "\n")
PYEOF

log "index entry for $filename: written (replace-or-append, deduped)"
log "sync-repo-mirror complete (file=$filename)"
