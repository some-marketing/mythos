# provision-vm.ps1 -- build the ant-world guest on orwell.
#
# Governing decision: the switch-contradiction re-review approved Option B --
# the VM has ZERO network adapters and all data moves on a FAT32 courier disk
# that only the host mounts, and only while the VM is off.
#
# Run via: psrunfile.sh provision-vm.ps1
#
# ASCII ONLY. PowerShell 5.1 reads a BOM-less file as Windows-1252, so a UTF-8
# em-dash arrives as mojibake containing a smart quote -- which PowerShell
# honours as a string delimiter, unbalancing the entire script. psrunfile.sh
# refuses to upload a .ps1 containing non-ASCII for this reason.

# This script CREATES ONLY. It contains no VM-removal or force-stop path by
# design: destroy is a separate, explicitly invoked concern (teardown-vm.ps1),
# so a routine provisioning run can never delete an existing guest as a side
# effect. If artifacts already exist, this refuses and tells you to tear down.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$VMName      = 'ant-world'
$Root        = 'D:\HyperV\AntWorld'
$ExpectedVol = '\\?\Volume{3b68a963-02cd-4f8e-897a-2b799d9283ec}\'
$Variant     = 'genericcloud'

function Section($s) { ""; "=== $s ==="; }

# ---------------------------------------------------------------------------
# GUARD 1 -- pin the destination by volume unique id, not drive letter.
# Re-review condition: fail closed if D: is not the volume we validated.
# ---------------------------------------------------------------------------
Section "GUARD: volume identity"
$vol = Get-Volume -DriveLetter D -ErrorAction Stop
if ($vol.UniqueId -ne $ExpectedVol) {
  throw "REFUSING: D: is volume $($vol.UniqueId), expected $ExpectedVol. The drive letter has been reassigned or the volume replaced."
}
"volume OK: $($vol.UniqueId)  label=$($vol.FileSystemLabel)"

# ---------------------------------------------------------------------------
# GUARD 2 -- never operate inside a legacy tree.
# ---------------------------------------------------------------------------
Section "GUARD: legacy-tree containment"
foreach ($legacy in @('C:\SM_OS','D:\SM_OS','C:\SM_OS-agent-worktree','C:\smos')) {
  if ($Root.ToLower().StartsWith($legacy.ToLower() + '\') -or $Root.ToLower() -eq $legacy.ToLower()) {
    throw "REFUSING: $Root is inside legacy tree $legacy"
  }
}
"containment OK: $Root is outside all four legacy trees"

# ---------------------------------------------------------------------------
Section "PRECONDITION: nothing to clobber"
$existing = Get-VM -Name $VMName -ErrorAction SilentlyContinue
if ($existing) { throw "VM '$VMName' already exists (state $($existing.State)). Run teardown-vm.ps1 first; this script never removes a guest." }
"no existing VM"
foreach ($n in @("$VMName-os.vhdx","$VMName-seed.vhdx","$VMName-courier.vhdx")) {
  $p = Join-Path $Root "Disks\$n"
  if (Test-Path -LiteralPath $p) { throw "disk already exists: $p. Run teardown-vm.ps1 first." }
}
"no existing disks"

# ---------------------------------------------------------------------------
Section "DISK 1 -- OS disk from the converted base image"
$base = Join-Path $Root "Disks\antworld-$Variant-base.vhdx"
if (-not (Test-Path -LiteralPath $base)) { throw "base image missing: $base (run convert-image.ps1)" }
$osDisk = Join-Path $Root "Disks\$VMName-os.vhdx"
Copy-Item -LiteralPath $base -Destination $osDisk
"os disk: $osDisk"
Get-VHD -Path $osDisk | Select-Object VhdFormat,VhdType,
  @{n='SizeGB';e={[math]::Round($_.Size/1GB,2)}} | Format-List | Out-String

# ---------------------------------------------------------------------------
Section "DISK 2 -- CIDATA cloud-init seed (mutable; detached before golden)"
$seed = Join-Path $Root "Disks\$VMName-seed.vhdx"
New-VHD -Path $seed -SizeBytes 64MB -Dynamic | Out-Null
$m = Mount-VHD -Path $seed -PassThru
try {
  Initialize-Disk -Number $m.DiskNumber -PartitionStyle MBR -Confirm:$false | Out-Null
  $part = New-Partition -DiskNumber $m.DiskNumber -UseMaximumSize -AssignDriveLetter
  Format-Volume -DriveLetter $part.DriveLetter -FileSystem FAT32 `
    -NewFileSystemLabel CIDATA -Force -Confirm:$false | Out-Null
  $dl = $part.DriveLetter
  # Copy the three NoCloud files verbatim. They were authored with LF endings
  # and uploaded by scp; Copy-Item preserves bytes, so the embedded shell
  # scripts are not CRLF-corrupted.
  foreach ($f in @('user-data','meta-data','network-config')) {
    $src = Join-Path $Root "Staging\In\cloud-init\$f"
    if (-not (Test-Path -LiteralPath $src)) { throw "missing seed file: $src" }
    Copy-Item -LiteralPath $src -Destination "${dl}:\$f" -Force
  }
  "seed files: " + ((Get-ChildItem "${dl}:\" | Select-Object -ExpandProperty Name) -join ', ')
  # Prove no CR bytes survived into user-data.
  $bytes = [IO.File]::ReadAllBytes("${dl}:\user-data")
  $cr = ($bytes | Where-Object { $_ -eq 13 }).Count
  "CR bytes in user-data: $cr (must be 0)"
  if ($cr -ne 0) { throw "user-data contains CR bytes; embedded shell would break" }
} finally { Dismount-VHD -Path $seed }

# ---------------------------------------------------------------------------
Section "DISK 3 -- ANTWORLD courier (fixed capacity, FAT32)"
$courier = Join-Path $Root "Disks\$VMName-courier.vhdx"
# Fixed capacity, per the re-review condition. 512MB comfortably holds the
# node tarball, the payload, and results, while capping what can ever cross.
New-VHD -Path $courier -SizeBytes 512MB -Dynamic | Out-Null
$m = Mount-VHD -Path $courier -PassThru
try {
  Initialize-Disk -Number $m.DiskNumber -PartitionStyle MBR -Confirm:$false | Out-Null
  $part = New-Partition -DiskNumber $m.DiskNumber -UseMaximumSize -AssignDriveLetter
  Format-Volume -DriveLetter $part.DriveLetter -FileSystem FAT32 `
    -NewFileSystemLabel ANTWORLD -Force -Confirm:$false | Out-Null
  $dl = $part.DriveLetter

  # Provisioning cargo: node runtime + payload + manifests.
  $node = Get-ChildItem (Join-Path $Root 'Downloads\node-*-linux-x64.tar.xz') | Select-Object -First 1
  if (-not $node) { throw "node tarball missing from Downloads" }
  Copy-Item -LiteralPath $node.FullName -Destination "${dl}:\" -Force
  $nodeHash = (Get-FileHash -LiteralPath $node.FullName -Algorithm SHA256).Hash.ToLower()
  Set-Content -LiteralPath "${dl}:\node.sha256" -Value "$nodeHash  $($node.Name)" -NoNewline

  # Newest by name: the stamp is UTC ISO-basic, so lexical order is chronological.
  # Explicitly sorted rather than taking whatever the filesystem returns first --
  # a stale payload silently winning here would be near-impossible to spot later.
  $payAll = @(Get-ChildItem (Join-Path $Root 'Staging\In\antworld-payload-*.tar.gz') | Sort-Object Name -Descending)
  if ($payAll.Count -eq 0) { throw "payload archive missing from Staging\In" }
  if ($payAll.Count -gt 1) {
    # NOTE: do not write "; using" inside an expandable string -- PowerShell 5.1
    # mis-parses it as a `using` statement and the whole script fails to tokenize.
    "WARNING: $($payAll.Count) payloads staged. Taking the newest, ignoring:"
    $payAll | Select-Object -Skip 1 | ForEach-Object { "  ignored: $($_.Name)" }
  }
  $pay = $payAll[0]
  "using payload: $($pay.Name)"
  Copy-Item -LiteralPath $pay.FullName -Destination "${dl}:\" -Force
  $paySum = "$($pay.FullName).sha256"
  if (Test-Path -LiteralPath $paySum) {
    Copy-Item -LiteralPath $paySum -Destination "${dl}:\$($pay.Name).sha256" -Force
  }
  # CODE REVIEW (PR #12, codex P2): the manifest must pair with the selected
  # payload -- an independent first filesystem result could copy an older
  # manifest beside the newest archive and make bootstrap verification fail.
  # CODE REVIEW (PR #12, codex P2): the manifest is REQUIRED, not optional.
  # The guest bootstrap only verifies PAYLOAD-MANIFEST.txt when it exists, so
  # a misstaged provisioning path that omitted it could let first-boot.ps1
  # accept and seal an image whose per-file allowlist was never verified.
  $manName = $pay.Name -replace '\.tar\.gz$', '.MANIFEST.txt'
  $manPath = Join-Path $Root "Staging\In\$manName"
  if (-not (Test-Path -LiteralPath $manPath)) { throw "payload manifest missing: $manPath (the selected payload's per-file allowlist must be verified during provisioning)" }
  Copy-Item -LiteralPath $manPath -Destination "${dl}:\PAYLOAD-MANIFEST.txt" -Force

  New-Item -ItemType Directory -Path "${dl}:\out" -Force | Out-Null
  "courier contents:"
  Get-ChildItem "${dl}:\" | Select-Object Name,
    @{n='MB';e={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize | Out-String
} finally { Dismount-VHD -Path $courier }

# ---------------------------------------------------------------------------
Section "CREATE VM (Generation 2, zero network adapters)"
# -NoVHD then attach explicitly, so no adapter is implied by a template.
$vm = New-VM -Name $VMName -Generation 2 -MemoryStartupBytes 8GB `
        -Path (Join-Path $Root 'VMs') -NoVHD
Set-VM -Name $VMName -ProcessorCount 4 -StaticMemory
Set-VM -Name $VMName -AutomaticCheckpointsEnabled $false
Set-VM -Name $VMName -CheckpointType Production

# THE load-bearing control: remove every network adapter. New-VM attaches one
# by default (disconnected); a disconnected adapter is not good enough per the
# re-review -- there must be zero adapters.
Get-VMNetworkAdapter -VMName $VMName | Remove-VMNetworkAdapter
"network adapters after removal: " + (@(Get-VMNetworkAdapter -VMName $VMName).Count)

Add-VMHardDiskDrive -VMName $VMName -Path $osDisk      -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 0
Add-VMHardDiskDrive -VMName $VMName -Path $seed        -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 1
Add-VMHardDiskDrive -VMName $VMName -Path $courier     -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 2

# Debian is signed by the Microsoft UEFI CA, not the Windows template.
Set-VMFirmware -VMName $VMName -EnableSecureBoot On `
  -SecureBootTemplate MicrosoftUEFICertificateAuthority
$osDrive = Get-VMHardDiskDrive -VMName $VMName -ControllerLocation 0
Set-VMFirmware -VMName $VMName -FirstBootDevice $osDrive

# ---------------------------------------------------------------------------
Section "INTEGRATION SERVICES -- disable every file-transfer channel"
# Guest Service Interface is Copy-VMFile: an out-of-band host->guest write path.
Disable-VMIntegrationService -VMName $VMName -Name 'Guest Service Interface'
# Heartbeat, Shutdown and Time Synchronization are permitted by the original
# checklist: they are not file-transfer channels, and Shutdown is how the host
# stops the guest cleanly.
Get-VMIntegrationService -VMName $VMName |
  Select-Object Name, Enabled | Format-Table -AutoSize | Out-String

# Enhanced Session Mode for Linux guests rides on HvSocket; VMBus disables it.
Set-VM -Name $VMName -EnhancedSessionTransportType VMBus
"EnhancedSessionTransportType: " + (Get-VM -Name $VMName).EnhancedSessionTransportType

# ---------------------------------------------------------------------------
Section "PRE-BOOT VERIFICATION"
$vm = Get-VM -Name $VMName
$vm | Select-Object Name,State,Generation,ProcessorCount,
  @{n='MemGB';e={[math]::Round($_.MemoryStartup/1GB,1)}},
  CheckpointType,AutomaticCheckpointsEnabled | Format-List | Out-String

"--- network adapters (MUST be empty) ---"
$na = @(Get-VMNetworkAdapter -VMName $VMName)
if ($na.Count -eq 0) { "PASS: zero network adapters" } else { $na | Format-Table | Out-String; throw "FAIL: VM has network adapters" }

"--- virtual switches on host (none should have been created for this testbed) ---"
Get-VMSwitch | Select-Object Name,SwitchType | Format-Table -AutoSize | Out-String

"--- attached disks ---"
Get-VMHardDiskDrive -VMName $VMName |
  Select-Object ControllerType,ControllerNumber,ControllerLocation,Path |
  Format-Table -AutoSize | Out-String

"--- firmware ---"
Get-VMFirmware -VMName $VMName | Select-Object SecureBoot,SecureBootTemplate | Format-List | Out-String

"PROVISIONED (not yet started): $VMName"
