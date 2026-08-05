#!/usr/bin/env bash
# Deploy the AntWorldProjection Unreal project to the orwell host.
#
# Host footprint is exactly D:\UnrealProjects\AntWorldProjection (plus reading
# the already-installed engine). Nothing under D:\HyperV is read or written.
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
DEST_WIN='D:\UnrealProjects\AntWorldProjection'
DEST_SCP='D:/UnrealProjects/AntWorldProjection'

CODE_ONLY=0
[ "${1:-}" = "--code-only" ] && CODE_ONLY=1

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/mkdirs.ps1" <<'PS'
$ErrorActionPreference = 'Stop'
$root = 'D:\UnrealProjects\AntWorldProjection'
foreach ($d in @('', 'Config', 'Content\Python', 'Imports', 'Tools', 'Saved')) {
    $p = if ($d) { Join-Path $root $d } else { $root }
    New-Item -ItemType Directory -Force -Path $p | Out-Null
}
"DEPLOY_DIRS_READY=$root"
PS
bash "$PSRUN" "$tmp/mkdirs.ps1" >/dev/null

echo "==> copying project files to $HOST:$DEST_WIN"
scp -q "$UE_SRC/AntWorldProjection.uproject"      "$HOST:$DEST_SCP/AntWorldProjection.uproject"
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

cat >"$tmp/verify.ps1" <<'PS'
$root = 'D:\UnrealProjects\AntWorldProjection'
Get-ChildItem -Path $root -Recurse -File |
    Where-Object { $_.FullName -notlike '*\Saved\*' -and $_.FullName -notlike '*\Intermediate\*' } |
    ForEach-Object { "{0}  {1} bytes" -f $_.FullName.Substring($root.Length + 1), $_.Length }
"DEPLOY_VERIFIED=$root"
PS
bash "$PSRUN" "$tmp/verify.ps1"
