$ErrorActionPreference = "Stop"

if ($env:USERNAME -ne "Gaming") {
  exit 0
}

$markerDir = Join-Path $env:LOCALAPPDATA "GamingSetup"
$markerFile = Join-Path $markerDir "bootstrap-complete.txt"
$setupScript = Join-Path $env:PUBLIC "Desktop\Finish Gaming Profile Setup.ps1"
$nextSteps = Join-Path $env:PUBLIC "Desktop\Gaming Setup - Next Steps.txt"
$steamPath = "${env:ProgramFiles(x86)}\Steam\steam.exe"
$onePasswordUri = "onepassword:"

New-Item -Path $markerDir -ItemType Directory -Force | Out-Null

if (-not (Test-Path -LiteralPath $markerFile)) {
  if (Test-Path -LiteralPath $setupScript) {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setupScript
  }

  @(
    "Gaming login bootstrap completed.",
    "CompletedAt=$((Get-Date).ToString('o'))",
    "User=$env:USERNAME"
  ) | Set-Content -LiteralPath $markerFile -Encoding UTF8
}

if (Test-Path -LiteralPath $nextSteps) {
  Start-Process notepad.exe -ArgumentList "`"$nextSteps`""
}

Start-Process $onePasswordUri

if (Test-Path -LiteralPath $steamPath) {
  Start-Process -FilePath $steamPath -ArgumentList "-bigpicture"
}
