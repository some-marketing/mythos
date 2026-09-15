# teardown-vm.ps1 -- DESTRUCTIVE. Removes the working guest and its disks.
#
# Deliberately separated from provision-vm.ps1 so that provisioning can never
# delete an existing guest as a side effect. Nothing here runs unless you invoke
# this script by name and pass -Yes.
#
# The GOLDEN export and its hashes are NOT touched. Neither is anything under
# Staging or Downloads. This removes the working VM only.

param(
  [switch]$Yes,
  [switch]$IncludeGolden
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$VMName = 'ant-world'
$Root   = 'D:\HyperV\AntWorld'

if (-not $Yes) {
  "DESTRUCTIVE: this removes VM '$VMName' and its OS/seed/courier disks."
  "Harvest any results first -- reverting or tearing down destroys guest state."
  "Re-run with -Yes to proceed."
  exit 1
}

"=== VOLUME GUARD ==="
$vol = Get-Volume -DriveLetter D -ErrorAction Stop
if ($vol.UniqueId -ne '\\?\Volume{3b68a963-02cd-4f8e-897a-2b799d9283ec}\') {
  throw "REFUSING: D: is not the expected volume; will not delete anything."
}
"volume OK"

"=== STOP AND REMOVE VM ==="
$vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
if ($vm) {
  if ($vm.State -ne 'Off') { Stop-VM -Name $VMName -TurnOff -Force; "stopped" }
  Remove-VM -Name $VMName -Force
  "removed VM $VMName"
} else { "no VM to remove" }

"=== DISMOUNT ANY HOST-MOUNTED DISKS ==="
foreach ($n in @("$VMName-os.vhdx","$VMName-seed.vhdx","$VMName-courier.vhdx")) {
  $p = Join-Path $Root "Disks\$n"
  if (Test-Path -LiteralPath $p) {
    $img = Get-VHD -Path $p -ErrorAction SilentlyContinue
    if ($img -and $img.Attached) { Dismount-VHD -Path $p; "dismounted $n" }
  }
}

"=== REMOVE DISKS ==="
foreach ($n in @("$VMName-os.vhdx","$VMName-seed.vhdx","$VMName-courier.vhdx")) {
  $p = Join-Path $Root "Disks\$n"
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; "removed $n" }
  else { "absent $n" }
}

if ($IncludeGolden) {
  "=== REMOVE GOLDEN (explicitly requested) ==="
  $g = Join-Path $Root 'Golden'
  Get-ChildItem -LiteralPath $g -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.PSIsContainer) { Get-ChildItem $_.FullName -Recurse -File | ForEach-Object { $_.IsReadOnly = $false } }
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
    "removed $($_.Name)"
  }
} else {
  "=== GOLDEN PRESERVED (pass -IncludeGolden to remove it too) ==="
  Get-ChildItem -LiteralPath (Join-Path $Root 'Golden') -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name
}

"=== FINAL STATE ==="
"VMs: " + (@(Get-VM).Count)
Get-ChildItem -LiteralPath (Join-Path $Root 'Disks') -ErrorAction SilentlyContinue |
  Select-Object Name | Format-Table -AutoSize | Out-String
"teardown complete"
