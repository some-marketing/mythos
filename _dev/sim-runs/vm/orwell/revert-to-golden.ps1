# revert-to-golden.ps1 -- reset the working guest to the pristine baseline.
#
# Reverting DESTROYS guest state. Harvest anything you care about first
# (run-job.ps1 does this automatically at the end of every run).
#
# Two modes:
#   -FromCheckpoint  restore the named production checkpoint (fast, default)
#   -FromExport      rebuild the VM from the hashed offline export (authoritative)
#
# The export is verified against its recorded hashes before it is trusted.

param(
  [switch]$FromExport,
  [string]$SnapshotName,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$VMName = 'ant-world'
$Root   = 'D:\HyperV\AntWorld'
$Golden = Join-Path $Root 'Golden'

if (-not $Yes) {
  "This DESTROYS current guest state in '$VMName'. Re-run with -Yes to proceed."
  exit 1
}

"=== STOP GUEST ==="
$vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
if ($vm -and $vm.State -ne 'Off') { Stop-VM -Name $VMName -TurnOff -Force; "stopped" }
else { "already off" }

Detach-Courier
Dismount-Courier | Out-Null

if (-not $FromExport) {
  "=== REVERT TO CHECKPOINT ==="
  $snaps = Get-VMSnapshot -VMName $VMName | Sort-Object CreationTime -Descending
  if (-not $snaps) { throw "no checkpoints exist; use -FromExport" }
  # CODE REVIEW (PR #12, codex P1 round 5): the default restore target must be
  # a golden-* baseline -- the snapshot list is sorted only by creation time, so
  # any newer manual/operational checkpoint would otherwise be selected and
  # post-experiment guest state restored as if it were the pristine baseline.
  # Mirrors the golden-* filter run-job.ps1 applies when establishing a baseline.
  $target = if ($SnapshotName) { $snaps | Where-Object { $_.Name -eq $SnapshotName } } else { $snaps | Where-Object { $_.Name -like 'golden-*' } | Select-Object -First 1 }
  if (-not $target) {
    if ($SnapshotName) { throw "checkpoint '$SnapshotName' not found" }
    throw "no golden-* checkpoint found; refusing to restore a non-baseline snapshot. Use -SnapshotName to pick explicitly."
  }
  "restoring: $($target.Name) ($($target.CreationTime))"
  Restore-VMSnapshot -VMName $VMName -Name $target.Name -Confirm:$false
}
else {
  "=== REBUILD FROM HASHED EXPORT ==="
  $exportRoot = Get-ChildItem -LiteralPath $Golden -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $exportRoot) { throw "no golden export found under $Golden" }
  $hashFile = Join-Path $Golden "$($exportRoot.Name).sha256"
  if (-not (Test-Path $hashFile)) { throw "no hash file for export $($exportRoot.Name)" }

  "verifying export against $hashFile"
  $bad = 0; $ok = 0
  foreach ($line in (Get-Content $hashFile)) {
    if ($line -match '^#' -or -not $line.Trim()) { continue }
    $parts = $line -split '\s+', 2
    $want = $parts[0]; $rel = $parts[1].Trim()
    $f = Join-Path $exportRoot.FullName $rel
    if (-not (Test-Path -LiteralPath $f)) { "MISSING $rel"; $bad++; continue }
    $got = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
    if ($got -eq $want) { $ok++ } else { "MISMATCH $rel"; $bad++ }
  }
  "export verification: $ok OK, $bad BAD"
  if ($bad -gt 0) { throw "golden export failed hash verification; refusing to restore from it" }

  if (Get-VM -Name $VMName -ErrorAction SilentlyContinue) { Remove-VM -Name $VMName -Force }
  $vmcx = Get-ChildItem -LiteralPath $exportRoot.FullName -Recurse -Filter *.vmcx | Select-Object -First 1
  if (-not $vmcx) { throw "no .vmcx in export" }
  Import-VM -Path $vmcx.FullName -Copy -GenerateNewId | Out-Null
  "imported from export"
}

"=== POST-REVERT VERIFICATION ==="
$vm = Get-VM -Name $VMName
$vm | Select-Object Name, State, ProcessorCount | Format-List | Out-String

# Re-review condition: prove zero adapters on every clone restored from golden.
$na = @(Get-VMNetworkAdapter -VMName $VMName)
if ($na.Count -eq 0) { "PASS: zero network adapters after revert" }
else { $na | Format-Table | Out-String; throw "FAIL: restored VM has network adapters" }

Get-VMHardDiskDrive -VMName $VMName | Select-Object ControllerNumber,ControllerLocation,Path |
  Format-Table -AutoSize | Out-String
"REVERTED. Attach the courier and load a job with run-job.ps1."
