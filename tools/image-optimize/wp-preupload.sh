#!/usr/bin/env bash
# tools/image-optimize/wp-preupload.sh
#
# Slice S4 thin wrapper for the WordPress local pre-upload optimization path.
# Runs the tiered optimizer locally then the shared deploy preflight, wiring in a
# framework manifest's per-framework caps override (ADJ#4). NO server-side
# optimization plugin — optimize locally, deploy ONLY derivatives. See
# WORDPRESS-PREUPLOAD.md. Posture is RECOMMENDED (preflight WARN mode) until
# slice S5 promotes the framework gate recommended -> required.
#
# Usage:
#   tools/image-optimize/wp-preupload.sh \
#     --src <local-assets-dir> \
#     --out <deploy-local-dir> \
#     [--tier hero|content|thumb]            (default: content) \
#     [--framework-manifest <path>]          (default: livecanvas-rebuild) \
#     [--mode warn|enforce]                  (default: warn) \
#     [--allowlist <path>]
#
# This wrapper does NOT deploy. After it passes, deploy ONLY the derivatives via
# WP-CLI / rsync / SFTP (see WORDPRESS-PREUPLOAD.md step 3).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

SRC=""
OUT=""
TIER="content"
FRAMEWORK_MANIFEST="$REPO_ROOT/frameworks/wordpress/livecanvas-rebuild/manifest.json"
MODE="warn"
ALLOWLIST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --tier) TIER="$2"; shift 2 ;;
    --framework-manifest) FRAMEWORK_MANIFEST="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --allowlist) ALLOWLIST="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "wp-preupload: unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$SRC" ] || [ -z "$OUT" ]; then
  echo "wp-preupload: --src and --out are required (see --help)" >&2
  exit 1
fi

echo "== wp-preupload: optimize (tier=$TIER) =="
OPT_ARGS=(optimize-tiered --src "$SRC" --tier "$TIER" --out "$OUT")
[ -n "$ALLOWLIST" ] && OPT_ARGS+=(--allowlist "$ALLOWLIST")
node "$HERE/cli.cjs" "${OPT_ARGS[@]}"

echo "== wp-preupload: preflight (mode=$MODE) =="
PRE_ARGS=(--dir "$OUT" --framework-manifest "$FRAMEWORK_MANIFEST" --mode "$MODE")
[ -n "$ALLOWLIST" ] && PRE_ARGS+=(--allowlist "$ALLOWLIST")
node "$HERE/preflight.cjs" "${PRE_ARGS[@]}"

echo "== wp-preupload: done. Deploy ONLY derivatives (WP-CLI / rsync / SFTP). =="
