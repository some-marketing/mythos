# refresh-seed.ps1 -- re-provision the guest in place, without destroying it.
#
# cloud-init re-runs its per-instance modules (write_files, runcmd) when the
# instance-id changes. Rewriting the CIDATA seed with a bumped instance-id
# therefore regenerates the guest's installed runner and re-runs bootstrap on the
# next boot, with no teardown and no VM deletion.
#
# This is also the golden-regeneration path in miniature: the whole guest
# configuration is reconstructed from version-controlled cloud-init plus the
# courier payload, so nothing about the guest is hand-made.
#
# Requires: VM Off. Run first-boot.ps1 afterwards to apply.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$VMName = 'ant-world'
$Root   = 'D:\HyperV\AntWorld'
$Seed   = Join-Path $Root 'Disks\ant-world-seed.vhdx'

$vm = Get-VM -Name $VMName
if ($vm.State -ne 'Off') { throw "REFUSING: VM is '$($vm.State)', must be Off to rewrite the seed" }
"VM state: Off"

$img = Get-VHD -Path $Seed
if ($img.Attached) {
  # The seed is attached to a powered-off VM; Hyper-V does not hold the file
  # open in that state, but mount explicitly rather than assume.
  "seed is attached to the (off) VM; mounting host-side"
}

$instanceId = "antworld-orwell-" + (Get-Date -Format 'yyyyMMddTHHmmssZ')
"new instance-id: $instanceId  (this is what forces cloud-init to re-run)"

$m = Mount-VHD -Path $Seed -PassThru
try {
  Start-Sleep -Milliseconds 800
  $vol = Get-Disk -Number $m.DiskNumber | Get-Partition |
         Where-Object { $_.DriveLetter } | Select-Object -First 1
  if (-not $vol) { throw "seed mounted but no lettered volume appeared" }
  $dl = $vol.DriveLetter
  "mounted seed as ${dl}:  label=" + (Get-Volume -DriveLetter $dl).FileSystemLabel

  # user-data and network-config come verbatim from staging (LF preserved).
  foreach ($f in @('user-data','network-config')) {
    $src = Join-Path $Root "Staging\In\cloud-init\$f"
    if (-not (Test-Path -LiteralPath $src)) { throw "missing staged seed file: $src" }
    Copy-Item -LiteralPath $src -Destination "${dl}:\$f" -Force
  }

  # meta-data is rewritten with the bumped instance-id, LF endings.
  $meta = "instance-id: $instanceId`nlocal-hostname: antworld`n"
  [IO.File]::WriteAllText("${dl}:\meta-data", $meta, (New-Object Text.UTF8Encoding $false))

  # Prove no CR bytes: user-data embeds shell that CRLF would break.
  foreach ($f in @('user-data','meta-data')) {
    $bytes = [IO.File]::ReadAllBytes("${dl}:\$f")
    $cr = ($bytes | Where-Object { $_ -eq 13 }).Count
    "CR bytes in ${f}: $cr"
    if ($cr -ne 0) { throw "$f contains CR bytes" }
  }

  "seed contents:"
  Get-ChildItem "${dl}:\" | Select-Object Name, Length | Format-Table -AutoSize | Out-String
  "membrane audit present in user-data: " + [bool](Select-String -Path "${dl}:\user-data" -Pattern 'reverse-membrane audit' -Quiet)
  "fleet halt mirror present in user-data: " + [bool](Select-String -Path "${dl}:\user-data" -Pattern 'ALL-SIMS' -Quiet)
}
finally {
  Dismount-VHD -Path $Seed
  "seed dismounted"
}

# RE-ATTACH THE SEED.
# seal-golden.ps1 detaches it deliberately (condition B4: the mutable seed must
# not become a second courier). After a seal, the guest therefore has no NoCloud
# datasource at all -- so cloud-init does not re-run, the boot silently does
# nothing, and a "successful" provisioning boot leaves the old runner in place.
# That cost a full debugging cycle. Re-attach it here so regeneration works
# after a seal, and let seal-golden take it away again.
$attached = Get-VMHardDiskDrive -VMName $VMName | Where-Object { $_.Path -eq $Seed }
if ($attached) {
  "seed already attached at 0/$($attached.ControllerLocation)"
} else {
  Add-VMHardDiskDrive -VMName $VMName -Path $Seed -ControllerType SCSI `
    -ControllerNumber 0 -ControllerLocation 1
  "seed RE-ATTACHED at 0/1 (it had been detached, most likely by seal-golden)"
}

Get-VMHardDiskDrive -VMName $VMName |
  Select-Object ControllerNumber, ControllerLocation, Path | Format-Table -AutoSize | Out-String

"SEED REFRESHED. Run first-boot.ps1 to apply (cloud-init will re-run on boot)."
