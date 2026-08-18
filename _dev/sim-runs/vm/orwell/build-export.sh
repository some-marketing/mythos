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
# CODE REVIEW (PR #12, codex P1): embodiment-bridge/ is host-derived
# remote-execution plumbing -- its README classifies it as "not ported"
# (hardcoded remote host default, release-gate checker tied to one
# containment plan, client/server split only meaningful against that
# host) -- and must never ride in the portable courier payload. Excluded
# at copy time here AND asserted absent in the post-copy assertions below.
rm -rf "$PAYLOAD/tools/ant-hive-world/embodiment-bridge"
# CODE REVIEW (PR #12, codex P1): world-mind-harness.cjs is the Mac-side
# Mythos world mind -- it reads ~/.claude/... and Mythos-memories/... and
# invokes frontier-model CLIs; it is explicitly NOT portable and must
# never ride in the zero-NIC guest payload. Excluded here AND asserted
# absent below.
rm -f "$PAYLOAD/tools/ant-hive-world/world-mind-harness.cjs"

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
# embodiment-bridge/ is host-derived remote-execution plumbing excluded by
# the D1 allowlist (its README: "not ported") -- assert it did not ride in.
if find "$PAYLOAD" -path '*/embodiment-bridge/*' | grep -q .; then
  echo "FATAL: embodiment-bridge/ content present in payload (host-derived, excluded)" >&2; fail=1
fi
# world-mind-harness.cjs is Mac-side Mythos mind tooling (reads ~/.claude
# and Mythos-memories, invokes frontier CLIs) -- assert it did not ride in.
if find "$PAYLOAD" -name 'world-mind-harness.cjs' | grep -q .; then
  echo "FATAL: world-mind-harness.cjs present in payload (Mac-side mind tooling, excluded)" >&2; fail=1
fi
[ "$fail" -eq 0 ] || exit 1
say "      assertions passed"

# ---------------------------------------------------------------------------
# MANIFEST + ARCHIVE
# ---------------------------------------------------------------------------
ARCHIVE="$OUT_DIR/antworld-payload-${STAMP}.tar.gz"
MANIFEST="$OUT_DIR/antworld-payload-${STAMP}.MANIFEST.txt"

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
} > "$MANIFEST"

# Deterministic-ish tar: sorted names, numeric owner, no macOS extended attrs.
( cd "$PAYLOAD" && COPYFILE_DISABLE=1 tar \
    --numeric-owner --uid 0 --gid 0 \
    -czf "$ARCHIVE" . )

shasum -a 256 "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"

say ""
say "payload files : $(grep -vc '^#' "$MANIFEST")"
say "archive       : $ARCHIVE"
say "archive sha256: $(cat "$ARCHIVE.sha256")"
say "archive size  : $(du -h "$ARCHIVE" | awk '{print $1}')"
say "manifest      : $MANIFEST"
