# verify-membrane.ps1 -- prove the reverse membrane AND the pre-start
# cancellation mechanism in a single boot, before the golden image is sealed.
#
# Writes a CANCEL marker and NO job spec, then boots. The guest is expected to:
#   - emit its reverse-membrane audit (it does this on every boot, before work)
#   - honour the CANCEL marker and run nothing
#   - power itself off
#
# This is the honest test of B5: the courier switch is a PRE-START cancellation,
# and this proves it cancels a queued run rather than claiming it can interrupt
# a running one.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$VMName = 'ant-world'

"=== LOAD CANCEL MARKER (no job spec) ==="
Detach-Courier
$dl = Mount-Courier
try {
  $outDir = Join-Path $dl 'out'
  if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  $jobEnvPath = Join-Path $dl 'job.env'
  if (Test-Path $jobEnvPath) { Remove-Item $jobEnvPath -Force }
  [IO.File]::WriteAllText((Join-Path $dl 'CANCEL'), "cancelled by verify-membrane.ps1`n", (New-Object Text.UTF8Encoding $false))
  "CANCEL written; no job.env present"
} finally { Dismount-Courier }

Attach-Courier
$na = @(Get-VMNetworkAdapter -VMName $VMName)
if ($na.Count -ne 0) { throw "REFUSING to boot: VM has network adapters" }
"network adapters pre-boot: 0"

"=== BOOT ==="
Start-VM -Name $VMName
$t0 = Get-Date
while ((Get-VM -Name $VMName).State -ne 'Off') {
  if (((Get-Date)-$t0).TotalSeconds -gt 600) { Stop-VM -Name $VMName -TurnOff -Force; throw "TIMEOUT waiting for self-poweroff" }
  Start-Sleep -Seconds 10
}
"guest powered itself off after $([int]((Get-Date)-$t0).TotalSeconds)s"
"network adapters post-boot: " + (@(Get-VMNetworkAdapter -VMName $VMName)).Count

"=== READ RESULTS ==="
Detach-Courier
$dl = Mount-Courier -ReadOnly
try {
  $statusPath = Join-Path $dl 'out\STATUS'
  if (Test-Path $statusPath) { "STATUS: " + (Get-Content $statusPath -Raw).Trim() }
  $membraneAudit = Join-Path $dl 'out\membrane-audit.txt'
  if (Test-Path $membraneAudit) {
    "--- MEMBRANE AUDIT ---"
    Get-Content $membraneAudit
  } else { "FAIL: no membrane audit produced" }
  $jobLog = Join-Path $dl 'out\job.log'
  if (Test-Path $jobLog) { "--- job.log ---"; Get-Content $jobLog }
} finally { Dismount-Courier }
