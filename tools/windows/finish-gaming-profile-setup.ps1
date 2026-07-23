param(
  [string]$SteamPath = "${env:ProgramFiles(x86)}\Steam\steam.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SteamPath)) {
  throw "Steam was not found at: $SteamPath"
}

$pushPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications"
New-Item -Path $pushPath -Force | Out-Null
Set-ItemProperty -Path $pushPath -Name ToastEnabled -Type DWord -Value 0

$explorerPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
New-Item -Path $explorerPath -Force | Out-Null
Set-ItemProperty -Path $explorerPath -Name Start_TrackDocs -Type DWord -Value 0
Set-ItemProperty -Path $explorerPath -Name Start_TrackProgs -Type DWord -Value 0

$contentPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"
New-Item -Path $contentPath -Force | Out-Null
$contentSettings = @(
  "ContentDeliveryAllowed",
  "FeatureManagementEnabled",
  "OemPreInstalledAppsEnabled",
  "PreInstalledAppsEnabled",
  "PreInstalledAppsEverEnabled",
  "SilentInstalledAppsEnabled",
  "SoftLandingEnabled",
  "SubscribedContent-310093Enabled",
  "SubscribedContent-338388Enabled",
  "SubscribedContent-338389Enabled",
  "SubscribedContent-338393Enabled",
  "SubscribedContent-353694Enabled",
  "SubscribedContent-353696Enabled",
  "SystemPaneSuggestionsEnabled"
)
foreach ($name in $contentSettings) {
  Set-ItemProperty -Path $contentPath -Name $name -Type DWord -Value 0
}

$startup = [Environment]::GetFolderPath("Startup")
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell

$startupShortcut = $shell.CreateShortcut((Join-Path $startup "Steam Big Picture.lnk"))
$startupShortcut.TargetPath = $SteamPath
$startupShortcut.Arguments = "-bigpicture"
$startupShortcut.WorkingDirectory = Split-Path -Parent $SteamPath
$startupShortcut.IconLocation = "$SteamPath,0"
$startupShortcut.Save()

$desktopShortcut = $shell.CreateShortcut((Join-Path $desktop "Steam Big Picture.lnk"))
$desktopShortcut.TargetPath = $SteamPath
$desktopShortcut.Arguments = "-bigpicture"
$desktopShortcut.WorkingDirectory = Split-Path -Parent $SteamPath
$desktopShortcut.IconLocation = "$SteamPath,0"
$desktopShortcut.Save()

Start-Process -FilePath $SteamPath -ArgumentList "-bigpicture"

Write-Host "Gaming profile setup complete."
Write-Host "In Steam, enable Settings > Remote Play > Enable Remote Play, then pair Steam Link from Apple TV."
