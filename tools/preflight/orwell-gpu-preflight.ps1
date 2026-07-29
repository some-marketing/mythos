# Orwell GPU preflight / swap readiness check.
# Run from an elevated PowerShell prompt.

$ErrorActionPreference = "Stop"

$OutputDir = "C:\Mythos\_dev\outputs\orwell-gpu-preflight"
$ReadyPath = Join-Path $OutputDir "READY_FOR_SWAP.md"
$JsonPath = Join-Path $OutputDir "preflight.json"
$TranscriptPath = Join-Path $OutputDir "preflight-transcript.txt"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Try-Command {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @()
  )
  try {
    $output = & $FilePath @Arguments 2>&1
    return @{
      ok = $true
      output = ($output | Out-String).Trim()
    }
  } catch {
    return @{
      ok = $false
      output = $_.Exception.Message
    }
  }
}

Start-Transcript -Path $TranscriptPath -Force | Out-Null

$isAdmin = Test-IsAdmin
$timestamp = (Get-Date).ToString("o")
$hostname = $env:COMPUTERNAME

$gpu = Get-CimInstance Win32_VideoController |
  Select-Object Name,AdapterCompatibility,AdapterRAM,DriverVersion,DriverDate,VideoProcessor,CurrentHorizontalResolution,CurrentVerticalResolution

$computer = Get-CimInstance Win32_ComputerSystem |
  Select-Object Manufacturer,Model,TotalPhysicalMemory,SystemType

$bios = Get-CimInstance Win32_BIOS |
  Select-Object Manufacturer,SMBIOSBIOSVersion,ReleaseDate,SerialNumber

$os = Get-CimInstance Win32_OperatingSystem |
  Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime

$volumes = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
  Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace

$physicalDisks = Get-CimInstance Win32_DiskDrive |
  Select-Object Model,InterfaceType,MediaType,Size,SerialNumber

$nvidiaSmi = Try-Command -FilePath "nvidia-smi"
$pnputilDisplay = Try-Command -FilePath "pnputil.exe" -Arguments @("/enum-devices", "/class", "Display")
$bitlocker = Try-Command -FilePath "manage-bde.exe" -Arguments @("-status")

$result = [ordered]@{
  schema = "OrwellGpuPreflight/1.0"
  timestamp = $timestamp
  host = $hostname
  admin = $isAdmin
  output_dir = $OutputDir
  computer = $computer
  bios = $bios
  os = $os
  gpu = $gpu
  logical_disks = $volumes
  physical_disks = $physicalDisks
  nvidia_smi = $nvidiaSmi
  pnputil_display = $pnputilDisplay
  bitlocker_status = $bitlocker
}

$result | ConvertTo-Json -Depth 8 | Set-Content -Path $JsonPath -Encoding UTF8

$ready = @()
$ready += "# READY FOR SWAP"
$ready += ""
$ready += "- host: $hostname"
$ready += "- timestamp: $timestamp"
$ready += "- elevated: $isAdmin"
$ready += "- preflight_json: $JsonPath"
$ready += "- transcript: $TranscriptPath"
$ready += ""
$ready += "## GPU"
foreach ($entry in $gpu) {
  $ramGb = if ($entry.AdapterRAM) { [math]::Round($entry.AdapterRAM / 1GB, 2) } else { $null }
  $ready += "- $($entry.Name) | driver $($entry.DriverVersion) | adapter_ram_gb $ramGb"
}
$ready += ""
$ready += "## Disks"
foreach ($disk in $physicalDisks) {
  $sizeGb = if ($disk.Size) { [math]::Round($disk.Size / 1GB, 2) } else { $null }
  $ready += "- $($disk.Model) | $($disk.InterfaceType) | $sizeGb GB"
}
$ready += ""
$ready += "## Volumes"
foreach ($vol in $volumes) {
  $sizeGb = if ($vol.Size) { [math]::Round($vol.Size / 1GB, 2) } else { $null }
  $freeGb = if ($vol.FreeSpace) { [math]::Round($vol.FreeSpace / 1GB, 2) } else { $null }
  $ready += "- $($vol.DeviceID) | $($vol.VolumeName) | free $freeGb GB / total $sizeGb GB"
}
$ready += ""
$ready += "The preflight completed and this marker was written by an elevated PowerShell session."

$ready | Set-Content -Path $ReadyPath -Encoding UTF8

Stop-Transcript | Out-Null

Write-Host "READY marker written:" -ForegroundColor Green
Write-Host $ReadyPath -ForegroundColor Green
