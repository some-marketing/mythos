# check-provisioning.ps1 -- read what the guest reported during provisioning.
#
# Goes through the courier state machine (courier-lib), so it also exercises the
# mandatory chkdsk integrity check on every host mount.
# Read-only with respect to the courier contents.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

"=== COURIER STATE MACHINE: detach, then mount ==="
Detach-Courier
$dl = Mount-Courier -ReadOnly
try {
  "mounted read-only as ${dl}:"
  "--- courier root ---"
  Get-ChildItem "${dl}:\" | Select-Object Name,
    @{n='KB';e={[math]::Round($_.Length/1KB,1)}} | Format-Table -AutoSize | Out-String

  "--- out/ ---"
  if (Test-Path "${dl}:\out") {
    Get-ChildItem "${dl}:\out" -Recurse | Select-Object FullName,
      @{n='KB';e={[math]::Round($_.Length/1KB,1)}} | Format-Table -AutoSize | Out-String
  } else { "NO out/ DIRECTORY" }

  foreach ($f in @('STATUS','provision-report.txt')) {
    if (Test-Path "${dl}:\out\$f") { "--- $f ---"; Get-Content "${dl}:\out\$f" }
  }

  if (Test-Path "${dl}:\out\bootstrap.log") {
    "--- bootstrap.log (tail 40) ---"
    Get-Content "${dl}:\out\bootstrap.log" -Tail 40
  }

  if (Test-Path "${dl}:\out\membrane-audit.txt") {
    "--- membrane-audit.txt ---"
    Get-Content "${dl}:\out\membrane-audit.txt"
  } else { "(no membrane audit yet -- written on job boots)" }

  if (Test-Path "${dl}:\out\job.log") {
    "--- job.log (tail 30) ---"
    Get-Content "${dl}:\out\job.log" -Tail 30
  }
}
finally { Dismount-Courier }
