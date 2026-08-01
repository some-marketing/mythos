#!/usr/bin/env bash
# sync-obsidian-vault.sh — mirror Mythos knowledge into Obsidian vault
#
# Usage: ./tools/hygiene/sync-obsidian-vault.sh [--dry-run]
#
# Syncs knowledge content from the repo into the Obsidian vault at Mythos-memories/.
# Only mirrors the lightweight knowledge surface — NOT the full repo.
#
# Mappings:
#   _dev/concepts/          → vault/concepts/
#   _dev/reports/analysis/  → vault/reports/
#   _dev/reports/debriefs/  → vault/debriefs/
#   instructions/           → vault/instructions/
#   AGENTS.md, CLAUDE.md    → vault/
#   _dev/state/*.txt        → vault/transcripts/ (session transcripts)
#   ~/.claude/.../memory/   → vault/memory/ (harness auto-memory store)
#
# Weight: ~420MB (vs 18GB for full-repo sync)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VAULT="$REPO_ROOT/Mythos-memories"
# Harness auto-memory store (outside the repo, in ~/.claude). Override with SMOS_MEMORY_DIR.
MEMORY_DIR="${SMOS_MEMORY_DIR:-$HOME/.claude/projects/{PROJECT_SLUG}/memory}"
DRY_RUN=""

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "[sync-obsidian] DRY RUN — no changes will be made"
fi

sync_dir() {
  local src="$1"
  local dst="$2"
  local label="${3:-$dst}"
  mkdir -p "$dst"
  rsync -a $DRY_RUN --delete --exclude='.DS_Store' "$src" "$dst" 2>/dev/null
  local count=$(find "$dst" -type f | wc -l | tr -d ' ')
  echo "[sync-obsidian] $label: $count files"
}

echo "[sync-obsidian] Syncing $REPO_ROOT → $VAULT"
echo ""

# — Root docs —
mkdir -p "$VAULT"
rsync -a $DRY_RUN "$REPO_ROOT/AGENTS.md" "$VAULT/AGENTS.md" 2>/dev/null
rsync -a $DRY_RUN "$REPO_ROOT/CLAUDE.md" "$VAULT/CLAUDE.md" 2>/dev/null
echo "[sync-obsidian] root-docs: synced"

# — Concepts —
sync_dir "$REPO_ROOT/_dev/concepts/" "$VAULT/concepts/" "concepts"

# — Reports (analysis only — not audit, credentials, chats) —
sync_dir "$REPO_ROOT/_dev/reports/analysis/" "$VAULT/reports/" "reports"

# — Session debriefs (separate top-level dir so the reports --delete above can't wipe it) —
[ -d "$REPO_ROOT/_dev/reports/debriefs" ] && sync_dir "$REPO_ROOT/_dev/reports/debriefs/" "$VAULT/debriefs/" "debriefs"

# — Harness auto-memory store (~/.claude/.../memory) —
if [ -d "$MEMORY_DIR" ]; then
  sync_dir "$MEMORY_DIR/" "$VAULT/memory/" "memory"
else
  echo "[sync-obsidian] memory: SKIPPED (not found at $MEMORY_DIR)"
fi

# — Instructions —
sync_dir "$REPO_ROOT/instructions/" "$VAULT/instructions/" "instructions"

# — Entity MOC hubs (generated repo-side by tools/memory/build-entity-mocs.cjs) —
# Additive mapping (plan mdoi-entity-mocs): own scope, own --delete; existing
# mappings above are untouched.
[ -d "$REPO_ROOT/_dev/state/memory-db/mocs" ] && sync_dir "$REPO_ROOT/_dev/state/memory-db/mocs/" "$VAULT/mocs/" "mocs"

# — Transcripts (.txt files from _dev/state) —
mkdir -p "$VAULT/transcripts"
rsync -a $DRY_RUN --include='*.txt' --include='*.md' --exclude='*' \
  "$REPO_ROOT/_dev/state/" "$VAULT/transcripts/" 2>/dev/null
TX_COUNT=$(find "$VAULT/transcripts" -type f | wc -l | tr -d ' ')
echo "[sync-obsidian] transcripts: $TX_COUNT files"

# — Handoffs (symlink next-session-handoff to vault root for quick access) —
if [ -f "$VAULT/reports/next-session-handoff.md" ]; then
  cp "$VAULT/reports/next-session-handoff.md" "$VAULT/next-session-handoff.md" 2>/dev/null || true
  echo "[sync-obsidian] handoff: copied to vault root"
fi

echo ""
TOTAL=$(find "$VAULT" -type f -not -path '*/.obsidian/*' -not -path '*/.git/*' | wc -l | tr -d ' ')
echo "[sync-obsidian] Done. $TOTAL total vault files."
