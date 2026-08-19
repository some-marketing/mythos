#!/usr/bin/env bash
# inbound-push.sh — HOP 1 of the two-hop inbound membrane.
#
#   hop 0  build-export.sh      repo -> allowlisted archive + manifest (laptop)
#   hop 1  THIS SCRIPT          laptop -> orwell staging, outside every legacy tree
#   hop 2  load-courier.ps1     orwell staging -> FAT32 courier disk, VM off
#
# Hashes are verified on BOTH sides of hop 1: computed on the laptop, recomputed
# by orwell after the copy, and compared. A transfer that cannot be proven byte
# identical is a failed transfer.
#
# The destination is orwell's dedicated staging directory. Nothing is ever
# written to, or read from, any SM_OS tree on that host.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
HERE="$REPO_ROOT/_dev/sim-runs/vm/orwell"
EXPORT_DIR="$REPO_ROOT/_dev/state/antworld-export"
REMOTE='orwell'
REMOTE_STAGING='D:/HyperV/AntWorld/Staging/In'

say() { printf '%s\n' "$*"; }
die() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

# --- pick the payload -------------------------------------------------------
ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$(ls -1t "$EXPORT_DIR"/antworld-payload-*.tar.gz 2>/dev/null | head -1)" \
    || die "no payload archive found; run build-export.sh first"
fi
[ -f "$ARCHIVE" ] || die "payload archive not found: $ARCHIVE"
BASE="$(basename "$ARCHIVE")"
STEM="${BASE%.tar.gz}"
MANIFEST="$EXPORT_DIR/$STEM.MANIFEST.txt"
SUMFILE="$ARCHIVE.sha256"
[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"
[ -f "$SUMFILE" ]  || die "checksum not found: $SUMFILE"

LOCAL_SHA="$(cat "$SUMFILE")"
say "payload : $BASE"
say "sha256  : $LOCAL_SHA"
say "size    : $(du -h "$ARCHIVE" | awk '{print $1}')"

# --- refuse to ship anything that is not the allowlisted payload ------------
# CODE REVIEW (confirmation pass, codex P1): a bare `*` glob only checks the
# prefix/suffix -- a basename like antworld-payload-';...;#.tar.gz still
# matches it. BASE later crosses into a single-quoted PowerShell string on
# the remote side (hop 1 verification below); since orwell's SSH default
# shell is cmd.exe, an embedded quote or shell metacharacter reaches the
# remote command parser and can execute arbitrary commands under the
# provisioning account. Require the exact UTC-stamp grammar build-export.sh
# actually produces, character class by character class, so nothing but
# digits, 'T' and 'Z' can appear in the stamp position.
case "$BASE" in
  antworld-payload-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.tar.gz) ;;
  *) die "refusing to push '$BASE': must match antworld-payload-<UTC-stamp>.tar.gz exactly (build-export.sh's own stamp grammar; no extra characters)" ;;
esac

# --- ensure the remote staging tree exists ---------------------------------
say ""
say "[hop 1] preparing remote staging"
ssh "$REMOTE" "powershell -NoProfile -NonInteractive -Command \"New-Item -ItemType Directory -Path 'D:\\HyperV\\AntWorld\\Staging\\In\\cloud-init' -Force | Out-Null; 'ready'\"" \
  2>/dev/null | tr -d '\r'

# --- copy ------------------------------------------------------------------
say "[hop 1] copying payload, manifest and checksum"
scp -q "$ARCHIVE"  "$REMOTE:$REMOTE_STAGING/$BASE"
scp -q "$MANIFEST" "$REMOTE:$REMOTE_STAGING/$STEM.MANIFEST.txt"
scp -q "$SUMFILE"  "$REMOTE:$REMOTE_STAGING/$BASE.sha256"

say "[hop 1] copying cloud-init seed files"
for f in user-data meta-data network-config; do
  [ -f "$HERE/cloud-init/$f" ] || die "missing cloud-init/$f"
  scp -q "$HERE/cloud-init/$f" "$REMOTE:$REMOTE_STAGING/cloud-init/$f"
done

# --- verify on the far side -------------------------------------------------
say ""
say "[hop 1] verifying hashes on orwell"
REMOTE_SHA="$(ssh "$REMOTE" "powershell -NoProfile -NonInteractive -Command \"(Get-FileHash -LiteralPath '$REMOTE_STAGING/$BASE' -Algorithm SHA256).Hash.ToLower()\"" 2>/dev/null | tr -d '\r\n ')"

say "  local  : $LOCAL_SHA"
say "  remote : $REMOTE_SHA"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  die "hash mismatch across hop 1 — transfer rejected"
fi
say "  MATCH — hop 1 verified"

# Verify the cloud-init files survived byte-identically too. Their LF endings
# are load-bearing: user-data embeds shell scripts that CRLF would break.
say ""
say "[hop 1] verifying cloud-init byte fidelity"
for f in user-data meta-data network-config; do
  l="$(shasum -a 256 "$HERE/cloud-init/$f" | awk '{print $1}')"
  r="$(ssh "$REMOTE" "powershell -NoProfile -NonInteractive -Command \"(Get-FileHash -LiteralPath '$REMOTE_STAGING/cloud-init/$f' -Algorithm SHA256).Hash.ToLower()\"" 2>/dev/null | tr -d '\r\n ')"
  if [ "$l" = "$r" ]; then say "  OK   $f"; else die "cloud-init/$f differs across hop 1 ($l vs $r)"; fi
done

say ""
say "hop 1 complete. Payload is staged at $REMOTE_STAGING on orwell."
say "Next: hop 2 loads it onto the courier disk with the VM off (load-courier.ps1)."
