#!/usr/bin/env bash
# pull-results.sh — OUTBOUND HOP 2: orwell sterile staging -> laptop repo.
#
# Hop 1 (harvest-results.ps1) already moved guest output off the courier into
# sterile staging on orwell, rejecting anything that was not a plain data file
# and verifying the guest-written manifest. This script performs the second and
# final hop, and re-verifies every hash on arrival.
#
# The laptop initiates. orwell never pushes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
REMOTE='orwell'
RUN_NAME="${1:-}"
[ -n "$RUN_NAME" ] || { echo "usage: pull-results.sh <run-name>" >&2; exit 1; }

# CODE REVIEW (PR #12, codex P1): RUN_NAME is interpolated into a remote
# PowerShell command and a local destination path; a quote or path traversal
# would break out of the quoted Test-Path argument or redirect the pull
# outside _dev/state. Enforce the same single-token grammar as run-job.ps1.
case "$RUN_NAME" in
  '' | -* | _* | *[!A-Za-z0-9_-]*) echo "usage: run name must match ^[A-Za-z0-9][A-Za-z0-9_-]*$" >&2; exit 1 ;;
esac

REMOTE_DIR="D:/HyperV/AntWorld/Staging/Out/$RUN_NAME"
DEST="$REPO_ROOT/_dev/state/$RUN_NAME"

say() { printf '%s\n' "$*"; }
die() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

say "pulling $REMOTE:$REMOTE_DIR -> $DEST"

# Confirm the remote staging directory exists before touching the local tree.
exists="$(ssh "$REMOTE" "powershell -NoProfile -NonInteractive -Command \"Test-Path -LiteralPath '$REMOTE_DIR'\"" 2>/dev/null | tr -d '\r\n ')"
[ "$exists" = "True" ] || die "no sterile staging directory on orwell for run '$RUN_NAME'"


# CODE REVIEW (PR #12, codex P1): pulling into a nonempty destination leaves
# stale files from earlier pulls -- scp does not remove them -- and the
# PULL-MANIFEST.txt then presents them as part of the newly verified pull.
# Refuse a nonempty destination.
if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  die "destination $DEST is not empty; move it aside or remove it before pulling"
fi
mkdir -p "$DEST"
scp -q -r "$REMOTE:$REMOTE_DIR/." "$DEST/"

# --- re-verify the harvest manifest locally ---------------------------------
MAN="$DEST/HARVEST-MANIFEST.txt"
[ -f "$MAN" ] || die "no HARVEST-MANIFEST.txt in pulled results"

say ""
say "verifying harvest manifest on the laptop side"
ok=0; bad=0; malformed=0
manifest_list="$(mktemp)"
trap 'rm -f "$manifest_list"' EXIT
while IFS= read -r line; do
  # PowerShell writes this manifest with CRLF, so strip the carriage return
  # before anything else -- otherwise every path carries a trailing \r and every
  # single file reports MISSING while sitting right there on disk.
  line="${line%$'\r'}"
  case "$line" in \#*|'') continue ;; esac
  # CODE REVIEW (confirmation pass, codex P1): a comment-only/truncated
  # manifest previously fell straight through this loop with ok=0, bad=0,
  # and the sole gate below (`bad -eq 0`) accepted that as success -- so a
  # broken harvest, or a pull where scp copied files the manifest never
  # mentions, was presented as fully verified. Require a strict "<64-hex>
  # <sp><sp><path>" grammar per line, and require the pulled-file set to
  # match the manifest set exactly.
  if ! printf '%s' "$line" | LC_ALL=C grep -Eq '^[0-9a-f]{64}  .+$'; then
    say "  MALFORMED $line"; malformed=$((malformed+1)); continue
  fi
  want="${line%%  *}"
  rel="${line#*  }"
  # orwell writes Windows separators; normalise for the local filesystem.
  rel="$(printf '%s' "$rel" | tr '\\' '/')"
  rel="${rel%$'\r'}"
  case "/$rel/" in
    */../*|*/./*) say "  MALFORMED (path escape) $rel"; malformed=$((malformed+1)); continue ;;
  esac
  printf '%s\n' "$rel" >> "$manifest_list"
  f="$DEST/$rel"
  if [ ! -f "$f" ]; then say "  MISSING  $rel"; bad=$((bad+1)); continue; fi
  got="$(shasum -a 256 "$f" | awk '{print $1}')"
  if [ "$got" = "$want" ]; then ok=$((ok+1)); else say "  MISMATCH $rel"; bad=$((bad+1)); fi
done < "$MAN"

# CODE REVIEW (confirmation pass, codex P2): excluding by basename anywhere
# in the tree (rather than by exact top-level path) would let a nested guest
# file that happens to be named HARVEST-MANIFEST.txt or PULL-MANIFEST.txt
# silently skip the unlisted-file check. Exclude only the two actual
# generated files at $DEST's root.
unlisted=0
while IFS= read -r pulled; do
  rel="${pulled#"$DEST"/}"
  case "$rel" in
    HARVEST-MANIFEST.txt|PULL-MANIFEST.txt) continue ;;
  esac
  if ! grep -qxF "$rel" "$manifest_list"; then
    say "  UNLISTED $rel"
    unlisted=$((unlisted+1))
  fi
done < <(find "$DEST" -type f)

say "  $ok verified, $bad bad, $malformed malformed, $unlisted unlisted"
if [ "$bad" -ne 0 ] || [ "$malformed" -ne 0 ] || [ "$ok" -eq 0 ] || [ "$unlisted" -ne 0 ]; then
  die "hop 2 verification failed — results are not byte-identical to (or not fully covered by) what orwell harvested (ok=$ok bad=$bad malformed=$malformed unlisted=$unlisted)"
fi

# --- provenance -------------------------------------------------------------
{
  echo "# PULL-MANIFEST — ant-world orwell testbed"
  echo "# pulled:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# run:       $RUN_NAME"
  echo "# source:    $REMOTE:$REMOTE_DIR"
  echo "# hop 1:     guest courier -> orwell sterile staging (harvest-results.ps1)"
  echo "# hop 2:     orwell sterile staging -> this repo (pull-results.sh)"
  echo "# verified:  $ok files, sha256 matched at both hops"
  echo "#"
  echo "# sha256  relative-path"
  ( cd "$DEST" && find . -type f ! -name PULL-MANIFEST.txt | LC_ALL=C sort | while read -r f; do
      printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "${f#./}"
    done )
} > "$DEST/PULL-MANIFEST.txt"

say ""
say "results at: $DEST"
say "provenance: $DEST/PULL-MANIFEST.txt"
