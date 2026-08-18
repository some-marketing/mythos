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

# CODE REVIEW (PR #12, codex P1): $RunName controls $Sterile, which this
# script recursively deletes. A value like '..\..\Golden' would delete the
# baseline without confirmation. Enforce the same single-token grammar as
# run-job.ps1 before constructing or deleting the staging path.
if ($RunName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') {
  throw "RunName [$RunName] contains characters outside [A-Za-z0-9_-]; refusing to construct the sterile staging path"
}
$Root    = 'D:\HyperV\AntWorld'
$Sterile = Join-Path $Root "Staging\Out\$RunName"

# Only these extensions may leave the guest. Anything else is a finding, not a
# file to copy: the simulation emits JSONL, JSON and text, nothing more.
$AllowedExt = @('.jsonl', '.json', '.txt', '.log', '.md', '')

"=== HARVEST $RunName ==="
Detach-Courier
$dl = Mount-Courier -ReadOnly
try {
  $src = "${dl}:\out"
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
  $ok = 0; $bad = 0; $malformed = 0
  $manifestFiles = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($line in (Get-Content $man)) {
    if (-not $line) { continue }
    if ($line -notmatch '^([0-9a-f]{64})\s+\.?[\\/]?(.+)$') { $malformed++; continue }
    $want = $Matches[1]
    $rel  = $Matches[2].Trim() -replace '/', '\'
    # CODE REVIEW (confirmation pass, codex P1): $rel comes from the
    # UNTRUSTED guest. Without this guard a manifest entry containing '..'
    # (e.g. '..\STATUS') resolves and hashes a path OUTSIDE $runDir -- a
    # result directory containing only a manifest could reference a file the
    # guest never wrote, letting $ok go positive while $actualFiles stays
    # empty. Reject any relative path with a '..' segment or an absolute/
    # rooted form before it is ever joined onto $runDir.
    $relSegments = $rel -split '\\'
    if ($rel -match '^[\\/]' -or $rel -match '^[A-Za-z]:' -or ($relSegments | Where-Object { $_ -eq '..' -or $_ -eq '.' })) {
      "MALFORMED (path escape) $rel"; $malformed++; continue
    }
    $f = Join-Path $runDir $rel
    $fResolved = [IO.Path]::GetFullPath($f)
    $runDirResolved = [IO.Path]::GetFullPath($runDir)
    if (-not $fResolved.StartsWith($runDirResolved + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      "MALFORMED (path escape) $rel"; $malformed++; continue
    }
    [void]$manifestFiles.Add($rel.ToLowerInvariant())
    if (-not (Test-Path -LiteralPath $f)) { "MISSING $rel"; $bad++; continue }
    $got = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
    if ($got -eq $want) { $ok++ } else { "MISMATCH $rel"; $bad++ }
  }
  # CODE REVIEW (PR #12, codex P1): malformed lines, an empty manifest, or
  # files the manifest does not list must fail closed -- unverified guest
  # output must not be presented as a harvested run.
  # CODE REVIEW (PR #12, codex P1): the guest's find deliberately excludes
  # RESULT-MANIFEST.txt from the manifest it writes, so the manifest itself
  # must not appear in the coverage set -- otherwise it is always unlisted
  # and every otherwise valid harvest throws at this gate.
  $actualFiles = @(Get-ChildItem -LiteralPath $runDir -Recurse -File | Where-Object { $_.Name -ne 'RESULT-MANIFEST.txt' })
  $unlisted = @($actualFiles | Where-Object { -not $manifestFiles.Contains($_.FullName.Substring($runDir.Length + 1).ToLowerInvariant()) })
  "manifest verification: $ok OK, $bad BAD, $malformed malformed, $($unlisted.Count) unlisted"
  if ($bad -gt 0 -or $malformed -gt 0 -or $ok -eq 0 -or $unlisted.Count -gt 0) {
    throw "result manifest verification failed on the host side (ok=$ok bad=$bad malformed=$malformed unlisted=$($unlisted.Count))"
  }
} else {
  # CODE REVIEW (PR #12, codex P1): without the guest's RESULT-MANIFEST.txt
  # the host cannot verify output integrity; partial unverified output must
  # not be presented as a harvested run. Fail closed.
  throw "no RESULT-MANIFEST.txt in the guest output -- refusing to harvest unverifiable results"
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

# CODE REVIEW (PR #12, codex P1 round 5): the guest records its own outcome in
# out/STATUS (driver/test RC, or a named sentinel such as invalid-ticks /
# halted-exit3), and the guest's finish() exits zero regardless. Without this
# gate a failed engine test or driver would be harvested, manifested, and
# reported as a successful job. Artifacts are preserved above; a missing or
# nonzero guest status must fail the host job after harvest.
$guestStatusPath = Join-Path $Sterile 'STATUS'
if (-not (Test-Path -LiteralPath $guestStatusPath)) {
  throw "no guest STATUS in harvested output -- the run did not report an outcome; refusing to report success"
}
$guestStatus = (Get-Content -LiteralPath $guestStatusPath -Raw).Trim()
if ($guestStatus -ne '0') {
  throw "guest STATUS is '$guestStatus' (expected 0) -- the run did not complete successfully; artifacts preserved but the job must fail"
}
"guest STATUS verified: 0"
