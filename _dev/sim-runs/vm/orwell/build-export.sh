#!/usr/bin/env bash
# build-export.sh — assemble the ONLY payload authorized to reach orwell.
#
# Authority: destination review D1 ruling
#   _dev/reports/analysis/convene-runs/20260802T193227Z-ant-world-orwell-destination-review/now__codex.md
#
# The allowlist is enumerated below and nowhere else. Anything not named here is
# absent by construction, not by filter — the archive is built from an explicit
# file list, so an accidental addition elsewhere in the repo cannot ride along.
#
# Forbidden by the ruling and asserted against after staging: .git, repository
# metadata, clients/, fleet tooling, arbitrary _dev content, host-derived
# configuration, and symlinks escaping the export root.
#
# Output: <out>/antworld-payload-<UTC>.tar.gz + .sha256 + MANIFEST.txt
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="${1:-$REPO_ROOT/_dev/state/antworld-export}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

PAYLOAD="$STAGE/payload"
mkdir -p "$PAYLOAD"

say() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------------------
# ALLOWLIST 1 — the engine.
# ---------------------------------------------------------------------------
say "[1/4] engine: tools/ant-hive-world"
mkdir -p "$PAYLOAD/tools"
cp -R "tools/ant-hive-world" "$PAYLOAD/tools/ant-hive-world"

# ---------------------------------------------------------------------------
# ALLOWLIST 2 — the drivers. Top-level .js only. The vm/ subdirectory is
# deliberately excluded: it is laptop-side Lima/orwell tooling (limactl, ssh
# invocations, host paths) and is host-derived configuration by definition.
# ---------------------------------------------------------------------------
say "[2/4] drivers: _dev/sim-runs/*.js (vm/ excluded)"
mkdir -p "$PAYLOAD/_dev/sim-runs"
for f in _dev/sim-runs/*.js; do
  [ -f "$f" ] || continue
  cp "$f" "$PAYLOAD/_dev/sim-runs/"
done

# ---------------------------------------------------------------------------
# ALLOWLIST 3 — audited runtime dependency closure (ajv, required by
# validate-hive-mind.js). Copied from the host's own resolved node_modules so
# the guest is pinned byte-identical: a host/guest result difference can then
# never be a silent dependency-drift artifact. All five are pure JavaScript.
# ---------------------------------------------------------------------------
say "[3/4] deps: ajv closure"
mkdir -p "$PAYLOAD/node_modules"
for p in ajv fast-deep-equal fast-uri json-schema-traverse require-from-string; do
  [ -d "node_modules/$p" ] || { echo "FATAL: missing dependency node_modules/$p" >&2; exit 1; }
  cp -R "node_modules/$p" "$PAYLOAD/node_modules/$p"
done

# Empty run tree, mirroring the repo layout so the driver runs unmodified:
# it resolves its engine at ../../tools/ant-hive-world and fail-closes unless
# --root sits under <repo>/_dev/.
mkdir -p "$PAYLOAD/_dev/state/kill-switches" "$PAYLOAD/_dev/results"

# ---------------------------------------------------------------------------
# ASSERTIONS — fail closed. These prove the forbidden classes are absent rather
# than trusting that the copy steps above were careful enough.
# ---------------------------------------------------------------------------
say "[4/4] asserting forbidden content is absent"
fail=0

if find "$PAYLOAD" -name '.git' -o -name '.gitignore' -o -name '.gitmodules' | grep -q .; then
  echo "FATAL: git metadata present in payload" >&2; fail=1
fi
if find "$PAYLOAD" -type l | grep -q .; then
  echo "FATAL: symlink present in payload:" >&2; find "$PAYLOAD" -type l >&2; fail=1
fi
if find "$PAYLOAD" -name 'node_modules' -mindepth 2 | grep -q .; then
  echo "FATAL: nested node_modules present" >&2; fail=1
fi
# Nothing may be a socket, device, or fifo.
if find "$PAYLOAD" \( -type s -o -type b -o -type c -o -type p \) | grep -q .; then
  echo "FATAL: non-regular file present in payload" >&2; fail=1
fi
# Credential-shaped and host-config-shaped filenames.
if find "$PAYLOAD" \( -name '.env*' -o -name '*.pem' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '.npmrc' -o -name '.netrc' \) | grep -q .; then
  echo "FATAL: credential/host-config file present in payload" >&2; fail=1
fi
# The word 'clients/' must not appear as a path component.
if find "$PAYLOAD" -path '*/clients/*' | grep -q .; then
  echo "FATAL: clients/ content present in payload" >&2; fail=1
fi
[ "$fail" -eq 0 ] || exit 1
say "      assertions passed"

# ---------------------------------------------------------------------------
# MANIFEST + ARCHIVE
#
# Written to temp names first and renamed into place only once the full
# triple (.tar.gz, .MANIFEST.txt, .tar.gz.sha256) exists, so a run interrupted
# between any two of these writes can never leave an orphaned manifest (or any
# other partial member of the triple) at the final, discoverable name.
#
# Publication contract: manifest-last-as-completion-marker. A manifest's
# presence marks a complete triple; consumers must key on the manifest, not
# on the archive or the checksum file, when deciding whether a payload is
# safe to select. The rename order below (archive, then .sha256, then
# .MANIFEST.txt LAST) is what makes that contract true: if a run is
# interrupted after some renames but before all three, the manifest is
# guaranteed to be the one still missing, so its absence alone is sufficient
# to detect an incomplete triple.
# ---------------------------------------------------------------------------
ARCHIVE="$OUT_DIR/antworld-payload-${STAMP}.tar.gz"
MANIFEST="$OUT_DIR/antworld-payload-${STAMP}.MANIFEST.txt"
SUMFILE="$ARCHIVE.sha256"

ARCHIVE_TMP="$ARCHIVE.tmp.$$"
MANIFEST_TMP="$MANIFEST.tmp.$$"
SUMFILE_TMP="$SUMFILE.tmp.$$"
trap 'rm -rf "$STAGE" "$ARCHIVE_TMP" "$MANIFEST_TMP" "$SUMFILE_TMP"' EXIT

{
  echo "# ant-world orwell payload manifest"
  echo "# built:      ${STAMP}"
  echo "# source:     ${REPO_ROOT}"
  echo "# git commit: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "# authority:  destination review D1 allowlist"
  echo "#"
  echo "# sha256  relative-path"
  ( cd "$PAYLOAD" && find . -type f | LC_ALL=C sort | while read -r f; do
      printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "${f#./}"
    done )
} > "$MANIFEST_TMP"

# Deterministic-ish tar: sorted names, numeric owner, no macOS extended attrs.
( cd "$PAYLOAD" && COPYFILE_DISABLE=1 tar \
    --numeric-owner --uid 0 --gid 0 \
    -czf "$ARCHIVE_TMP" . )

shasum -a 256 "$ARCHIVE_TMP" | awk '{print $1}' > "$SUMFILE_TMP"

# All three members exist under temp names now; rename into place in
# manifest-last order so the manifest's presence alone marks a complete,
# consumable triple.
mv -f "$ARCHIVE_TMP" "$ARCHIVE"
mv -f "$SUMFILE_TMP" "$SUMFILE"
mv -f "$MANIFEST_TMP" "$MANIFEST"

say ""
say "payload files : $(grep -vc '^#' "$MANIFEST")"
say "archive       : $ARCHIVE"
say "archive sha256: $(cat "$SUMFILE")"
say "archive size  : $(du -h "$ARCHIVE" | awk '{print $1}')"
say "manifest      : $MANIFEST"
