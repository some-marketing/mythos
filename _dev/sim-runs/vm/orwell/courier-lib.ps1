# courier-lib.ps1 -- the courier mount state machine.
#
# Re-review condition: "Courier mounting is an exclusive state machine: the host
# may mount the FAT32 VHDX only after proving the VM is Off and the disk
# detached; it must dismount before attachment or VM start."
#
# Every host-side touch of the courier goes through these functions. They fail
# closed: if the VM's state cannot be proven Off, or the disk cannot be proven
# detached, nothing is mounted.

$script:VMName  = 'ant-world'
$script:Root    = 'D:\HyperV\AntWorld'
$script:Courier = Join-Path $script:Root 'Disks\ant-world-courier.vhdx'

function Assert-VMOff {
  param([string]$Name = $script:VMName)
  $vm = Get-VM -Name $Name -ErrorAction SilentlyContinue
  if (-not $vm) { return $true }           # no VM yet: nothing can be running
  if ($vm.State -ne 'Off') {
    throw "REFUSING: VM '$Name' is '$($vm.State)', not 'Off'. The courier may never be mounted while the guest can touch it."
  }
  $true
}

function Assert-CourierDetached {
  param([string]$Name = $script:VMName, [string]$Path = $script:Courier)
  $vm = Get-VM -Name $Name -ErrorAction SilentlyContinue
  if (-not $vm) { return $true }
  $attached = Get-VMHardDiskDrive -VMName $Name -ErrorAction SilentlyContinue |
              Where-Object { $_.Path -eq $Path }
  if ($attached) {
    throw "REFUSING: courier is still attached to '$Name' at controller $($attached.ControllerNumber)/$($attached.ControllerLocation). Detach it before mounting on the host."
  }
  $true
}

function Detach-Courier {
  param([string]$Name = $script:VMName, [string]$Path = $script:Courier)
  Assert-VMOff -Name $Name | Out-Null
  $d = Get-VMHardDiskDrive -VMName $Name -ErrorAction SilentlyContinue |
       Where-Object { $_.Path -eq $Path }
  if ($d) {
    Remove-VMHardDiskDrive -VMName $Name -ControllerType $d.ControllerType `
      -ControllerNumber $d.ControllerNumber -ControllerLocation $d.ControllerLocation
    "courier detached from $Name"
  } else { "courier already detached" }
}

function Attach-Courier {
  param([string]$Name = $script:VMName, [string]$Path = $script:Courier, [int]$Location = 2)
  Assert-VMOff -Name $Name | Out-Null
  # Must not be mounted on the host at attach time.
  $img = Get-VHD -Path $Path
  if ($img.Attached) { throw "REFUSING: courier is still mounted on the host. Dismount before attaching to the VM." }
  Add-VMHardDiskDrive -VMName $Name -Path $Path -ControllerType SCSI `
    -ControllerNumber 0 -ControllerLocation $Location
  "courier attached to $Name at 0/$Location"
}

function Mount-Courier {
  # Returns the drive letter. Proves VM off AND disk detached first.
  param([string]$Path = $script:Courier, [switch]$ReadOnly)
  Assert-VMOff | Out-Null
  Assert-CourierDetached | Out-Null
  $img = Get-VHD -Path $Path
  if ($img.Attached) { throw "courier already mounted on host" }
  if ($ReadOnly) { $m = Mount-VHD -Path $Path -ReadOnly -PassThru }
  else           { $m = Mount-VHD -Path $Path -PassThru }
  Start-Sleep -Milliseconds 800
  $vol = Get-Disk -Number $m.DiskNumber | Get-Partition |
         Where-Object { $_.DriveLetter } | Select-Object -First 1
  if (-not $vol) { Dismount-VHD -Path $Path; throw "courier mounted but no volume with a drive letter appeared" }

  # MANDATORY integrity check at every host mount (OMEGA breadth-check addition 3).
  # The watchdog's Stop-VM -TurnOff cuts power mid-write, and FAT32 has no
  # journal, so a forced stop can leave the courier structurally inconsistent.
  # Reading results off a corrupt filesystem silently is the failure this closes.
  #
  # NOTE: everything informational here goes through Write-Host deliberately.
  # A PowerShell function returns ALL uncaptured output, so a bare string would
  # be concatenated with the drive letter and the caller would receive an array.
  $chk = & chkdsk.exe "$($vol.DriveLetter):" 2>&1 | Out-String
  if ($chk -match 'found no problems') {
    Write-Host "courier integrity: OK (chkdsk found no problems)"
  } else {
    Write-Host "courier integrity: PROBLEMS REPORTED by chkdsk --"
    Write-Host $chk
    Write-Host "NOTE: repair with chkdsk /F while the VM is off before trusting results."
  }

  $vol.DriveLetter
}

function Dismount-Courier {
  param([string]$Path = $script:Courier)
  $img = Get-VHD -Path $Path -ErrorAction SilentlyContinue
  if ($img -and $img.Attached) { Dismount-VHD -Path $Path; "courier dismounted" }
  else { "courier was not mounted" }
}
