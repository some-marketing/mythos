# harvest-results.ps1 -- OUTBOUND HOP 1: courier -> sterile staging on orwell.
#
# Re-review condition: "Treat all guest output as untrusted: copy it into
# sterile staging, reject unexpected files/types, and never execute directly
# from the courier."
#
# Accordingly this script copies nothing it cannot classify, refuses anything
# that is not a plain data file, and verifies the guest-written manifest before
# declaring the harvest good.

param(
  [Parameter(Mandatory=$true)][string]$RunName
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$Root    = 'D:\HyperV\AntWorld'
$Sterile = Join-Path $Root "Staging\Out\$RunName"

# Only these extensions may leave the guest. Anything else is a finding, not a
# file to copy: the simulation emits JSONL, JSON and text, nothing more.
$AllowedExt = @('.jsonl', '.json', '.txt', '.log', '.md', '')

"=== HARVEST $RunName ==="
Detach-Courier
$dl = Mount-Courier -ReadOnly
try {
  $src = Join-Path $dl 'out'
  if (-not (Test-Path $src)) { throw "no out/ directory on courier" }

  if (Test-Path "$src\STATUS") { "guest STATUS: " + (Get-Content "$src\STATUS" -Raw).Trim() }

  "--- inspecting guest output before copying ---"
  $items = Get-ChildItem -LiteralPath $src -Recurse -Force
  $rejected = @()
  foreach ($i in $items) {
    if ($i.PSIsContainer) { continue }
    $ext = $i.Extension.ToLower()
    if ($AllowedExt -notcontains $ext) { $rejected += $i.FullName; continue }
    # Reparse points / links must never cross.
    if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { $rejected += $i.FullName }
  }
  if ($rejected.Count -gt 0) {
    "REJECTED (not copied):"
    $rejected | ForEach-Object { "  $_" }
    throw "guest output contains $($rejected.Count) unexpected file(s); harvest refused"
  }
  "all $(@($items | Where-Object { -not $_.PSIsContainer }).Count) output files are of accepted types"

  if (Test-Path $Sterile) { Remove-Item $Sterile -Recurse -Force }
  New-Item -ItemType Directory -Path $Sterile -Force | Out-Null
  Copy-Item -Path "$src\*" -Destination $Sterile -Recurse -Force
  "copied to sterile staging: $Sterile"
}
finally { Dismount-Courier }

# --- verify the guest-written manifest on the host side ---------------------
"=== VERIFY GUEST MANIFEST (host side of the boundary) ==="
$runDir = Join-Path $Sterile $RunName
$man    = Join-Path $runDir 'RESULT-MANIFEST.txt'
if (Test-Path $man) {
  $ok = 0; $bad = 0
  foreach ($line in (Get-Content $man)) {
    if ($line -notmatch '^([0-9a-f]{64})\s+\.?[\\/]?(.+)$') { continue }
    $want = $Matches[1]
    $rel  = $Matches[2].Trim() -replace '/', '\'
    $f    = Join-Path $runDir $rel
    if (-not (Test-Path -LiteralPath $f)) { "MISSING $rel"; $bad++; continue }
    $got = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
    if ($got -eq $want) { $ok++ } else { "MISMATCH $rel"; $bad++ }
  }
  "manifest verification: $ok OK, $bad BAD"
  if ($bad -gt 0) { throw "result manifest verification failed on the host side" }
} else {
  "WARNING: no RESULT-MANIFEST.txt -- cannot verify guest output integrity"
}

# --- host-side manifest for the next hop ------------------------------------
$outMan = Join-Path $Sterile 'HARVEST-MANIFEST.txt'
"# harvested $(Get-Date -Format o) from courier, run $RunName" | Set-Content -LiteralPath $outMan
Get-ChildItem -LiteralPath $Sterile -Recurse -File |
  Where-Object { $_.Name -ne 'HARVEST-MANIFEST.txt' } |
  Sort-Object FullName | ForEach-Object {
    $h = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
    $rel = $_.FullName.Substring($Sterile.Length + 1)
    "$h  $rel"
  } | Add-Content -LiteralPath $outMan

"harvest manifest: $outMan"
Get-ChildItem -LiteralPath $Sterile -Recurse -File |
  Select-Object FullName, Length | Format-Table -AutoSize | Out-String
