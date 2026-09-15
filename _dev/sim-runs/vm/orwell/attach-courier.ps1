# attach-courier.ps1 -- re-attach the courier to the guest (VM must be Off).
# Thin wrapper over the state machine, for diagnostic flows that mounted the
# courier host-side and need to hand it back to the guest.
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

Dismount-Courier
Attach-Courier
"--- disks now attached ---"
Get-VMHardDiskDrive -VMName 'ant-world' |
  Select-Object ControllerNumber, ControllerLocation, Path | Format-Table -AutoSize | Out-String
