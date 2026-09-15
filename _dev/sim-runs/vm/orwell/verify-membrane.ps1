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
  if (Test-Path "${dl}:\out")    { Remove-Item "${dl}:\out" -Recurse -Force }
  New-Item -ItemType Directory -Path "${dl}:\out" -Force | Out-Null
  if (Test-Path "${dl}:\job.env") { Remove-Item "${dl}:\job.env" -Force }
  [IO.File]::WriteAllText("${dl}:\CANCEL", "cancelled by verify-membrane.ps1`n", (New-Object Text.UTF8Encoding $false))
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
  # CODE REVIEW (PR #12, codex P1 round 7): a guest that powers off without
  # running the job service (courier-mount or service-start failure) produces
  # no evidence at all; the previous code only printed FAIL and still exited
  # 0. Throw unless the cancellation status AND the membrane audit are both
  # present and valid -- otherwise automation treats the reverse-membrane and
  # cancellation test as proven when neither occurred.
  if (-not (Test-Path "${dl}:\out\STATUS")) {
    throw "FAIL: no guest STATUS -- the job service never reported a cancellation"
  }
  $guestStatus = (Get-Content "${dl}:\out\STATUS" -Raw).Trim()
  if ($guestStatus -ne 'cancelled-before-start') {
    throw "FAIL: guest STATUS is '$guestStatus' (expected 'cancelled-before-start') -- cancellation was not honoured"
  }
  "STATUS: $guestStatus"
  if (Test-Path "${dl}:\out\membrane-audit.txt") {
    "--- MEMBRANE AUDIT ---"
    Get-Content "${dl}:\out\membrane-audit.txt"
  } else { throw "FAIL: no membrane audit produced -- reverse-membrane evidence is missing" }
  if (Test-Path "${dl}:\out\job.log") { "--- job.log ---"; Get-Content "${dl}:\out\job.log" }
} finally { Dismount-Courier }
