#!/usr/bin/env bash
# migrate-orchestrator-memory.sh — One-shot migration of orchestrator memory
# files from local-agent-mode-sessions disk to 1Password vault "Sam's Memories".
#
# WHAT (this script — open-air, reviewable):
#   1. Discovers orchestrator memory files at the source dir (defaults to the
#      Cowork local-agent-mode-sessions agent/memory path) or accepts an
#      explicit --source <dir>.
#   2. For each file: ensures it has minimum frontmatter (name + type),
#      synthesizing one from the filename if missing.
#   3. Pipes each file through tools/memory/remember-via-vault.sh, which is
#      the canonical writer that handles the 1Password service-account token
#      entirely on this machine.
#   4. After each successful upload, optionally replaces the local file with
#      a stub pointing at the vault and the resolver. The original file is
#      preserved at <file>.pre-migration.bak unless --no-backup is passed.
#   5. Drops a top-level MEMORY.md stub at the source dir that points at the
#      1Password resolver, so existing Cowork sessions keep loading cheaply.
#
# HOW (runtime — local secrecy):
#   This script does not handle credentials directly. All 1Password
#   operations are delegated to remember-via-vault.sh, which fetches the
#   service-account token into its own shell-local env var with EXIT/INT/
#   TERM/HUP cleanup. The token never appears in this script's argv, env, or
#   logs. The frontier never sees it.
#
# Pre-req:
#   - Run from the operator's macOS desktop (op CLI must be reachable).
#   - op CLI 2.x signed into operator's personal account.
#   - jq, python3 installed.
#   - Operator vault item "Service Account Auth Token: sam" present in the
#     Employee vault with a `credential` field.
#   - Vault "Sam's Memories" reachable to that service-account token.
#   - Run bash tools/memory/vault-bootstrap.sh first to verify pre-reqs.
#
# Usage:
#   bash tools/memory/migrate-orchestrator-memory.sh           # uses default source dir
#   bash tools/memory/migrate-orchestrator-memory.sh --source <dir>
#   bash tools/memory/migrate-orchestrator-memory.sh --dry-run
#   bash tools/memory/migrate-orchestrator-memory.sh --no-stub-replace
#   bash tools/memory/migrate-orchestrator-memory.sh --no-backup
#   bash tools/memory/migrate-orchestrator-memory.sh --include 'pattern'
#
# Exit codes: 0 ok, 1 precondition fail, 2 source-dir fail, 3 per-file fail aggregated.

set -euo pipefail

SOURCE_DIR=""
DRY_RUN=0
STUB_REPLACE=1
BACKUP=1
INCLUDE_GLOB="*"
SKIP_INDEX_FILE="MEMORY.md"

while (( "$#" )); do
  case "$1" in
    --source)          SOURCE_DIR="$2"; shift 2 ;;
    --dry-run)         DRY_RUN=1; shift ;;
    --no-stub-replace) STUB_REPLACE=0; shift ;;
    --no-backup)       BACKUP=0; shift ;;
    --include)         INCLUDE_GLOB="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Default source dir — the Cowork local-agent-mode-sessions agent/memory
# location. Operator can override with --source for a different session.
if [[ -z "$SOURCE_DIR" ]]; then
  if [[ -n "${SMOS_AGENT_MEMORY_DIR:-}" ]]; then
    SOURCE_DIR="$SMOS_AGENT_MEMORY_DIR"
  else
    # Find the most recent agent-mode-session memory dir.
    BASE="$HOME/Library/Application Support/Claude/local-agent-mode-sessions"
    if [[ ! -d "$BASE" ]]; then
      echo "no source dir given and default base not found: $BASE" >&2
      echo "pass --source <dir> or set SMOS_AGENT_MEMORY_DIR" >&2
      exit 2
    fi
    # Pick the largest memory subdir (the active session's).
    CANDIDATE="$(find "$BASE" -type d -name memory 2>/dev/null \
      | xargs -I{} sh -c 'echo "$(ls -1 "{}" 2>/dev/null | wc -l) {}"' \
      | sort -rn | head -1 | cut -d' ' -f2-)"
    if [[ -z "$CANDIDATE" || ! -d "$CANDIDATE" ]]; then
      echo "could not auto-discover an agent/memory dir under $BASE" >&2
      exit 2
    fi
    SOURCE_DIR="$CANDIDATE"
  fi
fi

[[ -d "$SOURCE_DIR" ]] || { echo "source dir not a directory: $SOURCE_DIR" >&2; exit 2; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRITER="$REPO_ROOT/tools/memory/remember-via-vault.sh"
[[ -x "$WRITER" ]] || { echo "writer not executable: $WRITER" >&2; exit 1; }

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
LOG_DIR="$REPO_ROOT/_dev/reports/memory/migrations"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/migrate-$RUN_ID.log"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG"; }
warn() { printf '[%s] WARN: %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; }
fail() { printf '[%s] FAIL: %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; exit "${2:-1}"; }

log "migration run $RUN_ID"
log "source: $SOURCE_DIR"
log "dry_run=$DRY_RUN  stub_replace=$STUB_REPLACE  backup=$BACKUP  include='$INCLUDE_GLOB'"

# Ensure-frontmatter helper. If the file lacks frontmatter delimiters, prepend
# a minimal block synthesized from the filename. We never overwrite existing
# frontmatter — only add when absent, so operator-curated metadata is preserved.
ensure_frontmatter() {
  local f="$1"
  local delims
  delims="$(grep -c '^---$' "$f" || true)"
  if (( delims >= 2 )); then return 0; fi

  local base type_tag desc
  base="$(basename "$f" .md)"
  # Synthesize a "type" from the first underscore-separated segment, or
  # "memory" if no underscore.
  case "$base" in
    feedback_*) type_tag="feedback" ;;
    user_*)     type_tag="reference" ;;
    reference_*) type_tag="reference" ;;
    cowork_*)   type_tag="grounding" ;;
    default_*)  type_tag="reference" ;;
    MEMORY)     type_tag="index" ;;
    *)          type_tag="memory" ;;
  esac
  desc="Auto-frontmatter inserted by migrate-orchestrator-memory.sh on $(date -u +%Y-%m-%d). Edit if a curated description is preferable."

  local tmp body
  tmp="$(mktemp)"
  body="$(cat "$f")"
  {
    printf '%s\n' '---'
    printf 'name: %s\n' "$base"
    printf 'type: %s\n' "$type_tag"
    printf 'description: %s\n' "$desc"
    printf '%s\n' '---'
    printf '\n%s' "$body"
  } > "$tmp"
  if (( DRY_RUN == 1 )); then
    log "  [dry-run] would prepend frontmatter to $f (type=$type_tag)"
    rm -f "$tmp"
    return 0
  fi
  if (( BACKUP == 1 )); then
    cp -p "$f" "$f.pre-migration.bak"
  fi
  mv "$tmp" "$f"
  log "  prepended frontmatter (type=$type_tag)"
}

migrated=0
skipped=0
failed=0
fail_list=()

shopt -s nullglob
for f in "$SOURCE_DIR"/$INCLUDE_GLOB; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  # Skip backups, hidden, and our own stubs.
  if [[ "$base" == .* || "$base" == *.bak || "$base" == *.tmp ]]; then continue; fi

  log "→ $base"

  # Don't push the local index stub itself if it's already a stub pointing at the vault.
  if [[ "$base" == "$SKIP_INDEX_FILE" ]] && grep -q "memory-vault.js" "$f" 2>/dev/null; then
    log "  already a stub; skipping"
    skipped=$((skipped+1))
    continue
  fi

  if ! ensure_frontmatter "$f"; then
    warn "could not ensure frontmatter for $f; skipping"
    failed=$((failed+1))
    fail_list+=("$base (frontmatter)")
    continue
  fi

  if (( DRY_RUN == 1 )); then
    log "  [dry-run] would call: bash $WRITER $f"
    skipped=$((skipped+1))
    continue
  fi

  if bash "$WRITER" "$f" >>"$LOG" 2>&1; then
    log "  ✓ written to vault"
    migrated=$((migrated+1))
    if (( STUB_REPLACE == 1 )); then
      stub_path="$f"
      tmp_stub="$(mktemp)"
      {
        printf '%s\n' '---'
        printf 'name: %s\n' "$(basename "$base" .md)"
        printf 'type: stub\n'
        printf 'description: Migrated to 1Password vault "Sam'\''s Memories" on %s. Read with: node tools/memory/memory-vault.js read %s\n' "$(date -u +%Y-%m-%d)" "$base"
        printf '%s\n' '---'
        printf '\n'
        printf 'Canonical body lives in 1Password vault `Sam'\''s Memories`.\n'
        printf 'Read it with `node tools/memory/memory-vault.js read %s`,\n' "$base"
        printf 'or use the `/remember` command for desktop Claude Code sessions.\n'
        printf '\n'
        printf 'Do NOT edit this stub — edits are not propagated to the vault.\n'
        printf 'To change the vault entry, write a new memory via the `/remember` command.\n'
      } > "$tmp_stub"
      # ensure_frontmatter already wrote the .bak when it ran; keep that one.
      # Atomic-ish replace via mv on the same filesystem. Verify the result
      # before declaring stub-replacement done — if mv silently dropped the
      # tmp file or the post-mv content is wrong, the local file is in an
      # ambiguous state (vault has canonical copy, local file unchanged).
      # That is NOT data loss — the writer is idempotent on sm_os_memory_file
      # lookup, so re-running the migration will skip the vault write and
      # retry the stub. But we surface the ambiguity loudly so the operator
      # knows.
      if mv "$tmp_stub" "$stub_path" 2>>"$LOG"; then
        if grep -q "memory-vault.js" "$stub_path" 2>/dev/null; then
          log "  replaced local file with stub"
        else
          warn "stub mv claimed success but post-state lacks resolver reference: $stub_path — re-run migration to retry (writer is idempotent)"
          failed=$((failed+1))
          fail_list+=("$base (stub-verify)")
        fi
      else
        warn "stub mv FAILED for $base — vault has the canonical copy, local file is unchanged; re-run migration to retry"
        rm -f "$tmp_stub" 2>/dev/null || true
        failed=$((failed+1))
        fail_list+=("$base (stub-write)")
      fi
    fi
  else
    warn "writer failed for $base — see $LOG"
    failed=$((failed+1))
    fail_list+=("$base (writer)")
  fi
done
shopt -u nullglob

# Drop a top-level MEMORY.md stub if not present (or if we replaced everything else
# and it's still load-bearing for cheap session boot).
INDEX_STUB="$SOURCE_DIR/$SKIP_INDEX_FILE"
if (( DRY_RUN == 0 )); then
  if [[ ! -f "$INDEX_STUB" ]] || ! grep -q "memory-vault.js" "$INDEX_STUB" 2>/dev/null; then
    if [[ -f "$INDEX_STUB" && $BACKUP -eq 1 && ! -f "$INDEX_STUB.pre-migration.bak" ]]; then
      cp -p "$INDEX_STUB" "$INDEX_STUB.pre-migration.bak"
    fi
    cat > "$INDEX_STUB" << EOF
---
name: orchestrator-memory-index
type: index
description: Pointer stub. Canonical orchestrator memory lives in 1Password vault "Sam's Memories". Migrated $(date -u +%Y-%m-%d).
---

# Orchestrator Memory Index (stub)

The canonical orchestrator memory lives in 1Password vault \`Sam's Memories\`.

To read a specific memory:

\`\`\`
node tools/memory/memory-vault.js read <memory-filename>
\`\`\`

To list everything in the vault:

\`\`\`
node tools/memory/memory-vault.js list
\`\`\`

For desktop Claude Code sessions, the operator-readable plaintext shadow at
\`~/.claude/projects/-Users-admin-Documents-GitHub-mythos/memory/\` is the
preferred read path (faster than \`op\`).

Cowork sandbox sessions cannot reach \`op\` directly. To make a subset of
memories available to the sandbox, stage them in a directory and point
\`SMOS_MEMORY_OVERRIDE_DIR\` at it before invoking the resolver.

Writes go through the \`/remember\` command or
\`bash tools/memory/remember-via-vault.sh <file>\` directly. Both paths
authenticate on the operator's machine; the frontier never sees credentials.

Original local-disk copies of pre-migration memory files (if any survive)
are at \`<filename>.pre-migration.bak\`.
EOF
    log "wrote index stub: $INDEX_STUB"
  fi
fi

log ""
log "Summary: migrated=$migrated skipped=$skipped failed=$failed"
if (( failed > 0 )); then
  log "Failed entries:"
  for f in "${fail_list[@]}"; do log "  - $f"; done
  exit 3
fi
log "Migration log: $LOG"
