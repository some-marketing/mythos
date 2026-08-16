#!/usr/bin/env bash
# Deploy the AntSimV2 Unreal project to the orwell host.
#
# Host footprint is exactly D:\UnrealProjects\AntSimV2 (plus reading the
# already-installed engine). Nothing under D:\HyperV is read or written.
#
# AntWorldProjection is a PRESERVED BASELINE as of 2026-08-06 -- nothing may
# write to it again. PROJECT_NAME is overridable for a future rename, but this
# script refuses outright if it resolves to the baseline.
#
#   bash tools/ant-hive-world/unreal-export/ue/deploy.sh            # project + imports
#   bash tools/ant-hive-world/unreal-export/ue/deploy.sh --code-only
#
# Uses the proven psrun.sh transport (_dev/sim-runs/vm/orwell/psrun.sh) for
# remote PowerShell and plain scp for file copy.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
UE_SRC="$REPO_ROOT/tools/ant-hive-world/unreal-export/ue"
EXPORT_SRC="$REPO_ROOT/tools/ant-hive-world/unreal-export"
PSRUN="$REPO_ROOT/_dev/sim-runs/vm/orwell/psrun.sh"
HOST="${ORWELL_HOST:-orwell}"
PROJECT_NAME="${ANT_UE_PROJECT_NAME:-AntSimV2}"
PRESERVED_BASELINE_PROJECT='AntWorldProjection'
if [ "$PROJECT_NAME" = "$PRESERVED_BASELINE_PROJECT" ]; then
  echo "REFUSED: $PRESERVED_BASELINE_PROJECT is a preserved baseline and must never be deployed to again." >&2
  exit 2
fi
DEST_WIN="D:\\UnrealProjects\\$PROJECT_NAME"
DEST_SCP="D:/UnrealProjects/$PROJECT_NAME"

CODE_ONLY=0
[ "${1:-}" = "--code-only" ] && CODE_ONLY=1

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf "%s\n" "\$ErrorActionPreference = 'Stop'" "\$root = '$DEST_WIN'" >"$tmp/mkdirs.ps1"
cat >>"$tmp/mkdirs.ps1" <<'PS'
foreach ($d in @('', 'Config', 'Content\Python', 'Imports', 'Tools', 'Saved')) {
    $p = if ($d) { Join-Path $root $d } else { $root }
    New-Item -ItemType Directory -Force -Path $p | Out-Null
}
"DEPLOY_DIRS_READY=$root"
PS
bash "$PSRUN" "$tmp/mkdirs.ps1" >/dev/null

echo "==> copying project files to $HOST:$DEST_WIN"
scp -q "$UE_SRC/$PROJECT_NAME.uproject"            "$HOST:$DEST_SCP/$PROJECT_NAME.uproject"
scp -q "$UE_SRC/Config/DefaultEngine.ini"          "$HOST:$DEST_SCP/Config/DefaultEngine.ini"
scp -q "$UE_SRC/Config/DefaultGame.ini"            "$HOST:$DEST_SCP/Config/DefaultGame.ini"
scp -q "$UE_SRC/Content/Python/build_world.py"     "$HOST:$DEST_SCP/Content/Python/build_world.py"
scp -q "$UE_SRC/Content/Python/init_unreal.py"     "$HOST:$DEST_SCP/Content/Python/init_unreal.py"
scp -q "$UE_SRC/Tools/BuildLevel.ps1"              "$HOST:$DEST_SCP/Tools/BuildLevel.ps1"

if [ "$CODE_ONLY" -eq 0 ]; then
  echo "==> copying UnrealImport/1.0 files to $DEST_WIN\\Imports"
  for f in "$EXPORT_SRC"/unreal-import__*.json; do
    [ -e "$f" ] || continue
    scp -q "$f" "$HOST:$DEST_SCP/Imports/$(basename "$f")"
  done
  scp -q "$EXPORT_SRC/schema.json" "$HOST:$DEST_SCP/Imports/schema.json"
fi

printf "%s\n" "\$root = '$DEST_WIN'" >"$tmp/verify.ps1"
cat >>"$tmp/verify.ps1" <<'PS'
Get-ChildItem -Path $root -Recurse -File |
    Where-Object { $_.FullName -notlike '*\Saved\*' -and $_.FullName -notlike '*\Intermediate\*' } |
    ForEach-Object { "{0}  {1} bytes" -f $_.FullName.Substring($root.Length + 1), $_.Length }
"DEPLOY_VERIFIED=$root"
PS
bash "$PSRUN" "$tmp/verify.ps1"
