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
  "mounted read-only as $dl"
  "--- courier root ---"
  Get-ChildItem $dl | Select-Object Name,
    @{n='KB';e={[math]::Round($_.Length/1KB,1)}} | Format-Table -AutoSize | Out-String

  "--- payload archive ---"
  $payloads = @(Get-ChildItem -LiteralPath $dl -Filter 'antworld-payload-*.tar.gz' -Force -ErrorAction SilentlyContinue)
  if ($payloads.Count -eq 0) {
    "NO PAYLOAD ARCHIVE ON COURIER"
  } else {
    foreach ($p in $payloads) {
      $h = (Get-FileHash -LiteralPath $p.FullName -Algorithm SHA256).Hash.ToLower()
      "$($p.Name)  sha256=$h  size=$([math]::Round($p.Length/1MB,2))MB  mtime=$($p.LastWriteTimeUtc.ToString('o'))"
    }
    if ($payloads.Count -gt 1) { "WARNING: more than one payload archive present on courier" }
  }

  "--- out/ ---"
  $outDir = Join-Path $dl 'out'
  if (Test-Path $outDir) {
    Get-ChildItem $outDir -Recurse | Select-Object FullName,
      @{n='KB';e={[math]::Round($_.Length/1KB,1)}} | Format-Table -AutoSize | Out-String
  } else { "NO out/ DIRECTORY" }

  foreach ($f in @('STATUS','provision-report.txt')) {
    $p = Join-Path $dl "out\$f"
    if (Test-Path $p) { "--- $f ---"; Get-Content $p }
  }

  $bootstrapLog = Join-Path $dl 'out\bootstrap.log'
  if (Test-Path $bootstrapLog) {
    "--- bootstrap.log (tail 40) ---"
    Get-Content $bootstrapLog -Tail 40
  }

  $membraneAudit = Join-Path $dl 'out\membrane-audit.txt'
  if (Test-Path $membraneAudit) {
    "--- membrane-audit.txt ---"
    Get-Content $membraneAudit
  } else { "(no membrane audit yet -- written on job boots)" }

  $jobLog = Join-Path $dl 'out\job.log'
  if (Test-Path $jobLog) {
    "--- job.log (tail 30) ---"
    Get-Content $jobLog -Tail 30
  }
}
finally { Dismount-Courier }
