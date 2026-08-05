# seal-golden.ps1 -- seal the golden baseline after provisioning.
#
# Re-review conditions honoured here:
#   - "Detach the mutable CIDATA seed after provisioning and before creating the
#      golden baseline. It must not become an undeclared second courier."
#   - "No runtime package installation may be required. All required binaries
#      and services must exist before the NIC-free golden image is sealed."
#   - zero network adapters re-proved at seal time.
#
# The golden image is never run. Experiments run on a clone restored from it.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$VMName = 'ant-world'
$Root   = 'D:\HyperV\AntWorld'
$Seed   = Join-Path $Root 'Disks\ant-world-seed.vhdx'
$Golden = Join-Path $Root 'Golden'

"=== PRECONDITIONS ==="
$vm = Get-VM -Name $VMName
if ($vm.State -ne 'Off') { throw "REFUSING: VM is '$($vm.State)', must be Off to seal" }
"VM state: Off"

$na = @(Get-VMNetworkAdapter -VMName $VMName)
if ($na.Count -ne 0) { throw "REFUSING: VM has $($na.Count) network adapter(s); golden must be NIC-free" }
"network adapters: 0"

"=== DETACH MUTABLE SEED ==="
$seedDrive = Get-VMHardDiskDrive -VMName $VMName | Where-Object { $_.Path -eq $Seed }
if ($seedDrive) {
  Remove-VMHardDiskDrive -VMName $VMName -ControllerType $seedDrive.ControllerType `
    -ControllerNumber $seedDrive.ControllerNumber -ControllerLocation $seedDrive.ControllerLocation
  "CIDATA seed detached"
} else { "CIDATA seed already detached" }

"=== DETACH COURIER (it is not part of the baseline) ==="
Detach-Courier

"=== REMAINING DISKS (should be the OS disk only) ==="
Get-VMHardDiskDrive -VMName $VMName |
  Select-Object ControllerNumber, ControllerLocation, Path | Format-Table -AutoSize | Out-String

"=== PRODUCTION CHECKPOINT ==="
$snapName = "golden-$(Get-Date -Format 'yyyyMMddTHHmmssZ')"
Set-VM -Name $VMName -CheckpointType Production
Checkpoint-VM -Name $VMName -SnapshotName $snapName
Get-VMSnapshot -VMName $VMName | Select-Object Name, SnapshotType, CreationTime |
  Format-Table -AutoSize | Out-String

"=== OFFLINE EXPORT ==="
$exportDir = Join-Path $Golden $snapName
if (Test-Path $exportDir) { Remove-Item $exportDir -Recurse -Force }
New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
Export-VM -Name $VMName -Path $exportDir
"exported to $exportDir"

"=== HASH THE EXPORT ==="
$hashFile = Join-Path $Golden "$snapName.sha256"
"# golden baseline hashes -- $snapName -- $(Get-Date -Format o)" | Set-Content -LiteralPath $hashFile
Get-ChildItem -LiteralPath $exportDir -Recurse -File | Sort-Object FullName | ForEach-Object {
  $h = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
  "$h  $($_.FullName.Substring($exportDir.Length + 1))"
} | Add-Content -LiteralPath $hashFile
"hashes written: $hashFile"
Get-Content -LiteralPath $hashFile | Select-Object -First 10

"=== PROTECT ==="
# Make the export read-only so an accidental run or edit is harder.
Get-ChildItem -LiteralPath $exportDir -Recurse -File | ForEach-Object { $_.IsReadOnly = $true }
"export marked read-only"

"GOLDEN SEALED: $snapName"
"Never start this export. Restore or re-clone from it before each experiment family."
