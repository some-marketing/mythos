<# 
.SYNOPSIS
  Ensure a Windows Mythos fleet node has the cloud sync + Ollama desktop stack.

.DESCRIPTION
  Intended for nodes such as Orwell and Rupert. Run from an elevated
  PowerShell session on the node.

  The script is idempotent:
    - installs Ollama, Google Drive, and iCloud with winget when missing
    - sets OLLAMA_HOST so Ollama listens beyond localhost
    - opens a Private-profile firewall rule for TCP 11434
    - starts Ollama in the active user session

  Google Drive and iCloud still require human account sign-in. This script
  installs the applications and opens them when requested; it does not store
  account credentials.
#>

[CmdletBinding()]
param(
    [string]$OllamaHost = "0.0.0.0:11434",
    [switch]$SkipGoogleDrive,
    [switch]$SkipICloud,
    [switch]$OpenCloudApps,
    [switch]$NoRestartHint
)

$ErrorActionPreference = "Stop"

function Write-Phase {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this script from an elevated PowerShell session."
    }
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WingetPackage {
    param(
        [string]$Id,
        [string]$Name
    )

    Write-Phase "Checking $Name"
    $listOutput = & winget list --id $Id --exact --source winget 2>$null
    if ($LASTEXITCODE -eq 0 -and ($listOutput -join "`n") -match [regex]::Escape($Id)) {
        Write-Ok "$Name already installed"
        return
    }

    Write-Host "Installing $Name ($Id)..." -ForegroundColor Gray
    & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget install failed for $Name ($Id), exit $LASTEXITCODE"
    }
    Write-Ok "$Name installed"
}

function Set-OllamaHost {
    param([string]$Value)

    Write-Phase "Configuring Ollama host"
    [Environment]::SetEnvironmentVariable("OLLAMA_HOST", $Value, "Machine")
    [Environment]::SetEnvironmentVariable("OLLAMA_HOST", $Value, "User")
    $env:OLLAMA_HOST = $Value
    Write-Ok "OLLAMA_HOST set to $Value for Machine and User scopes"
}

function Ensure-OllamaFirewall {
    Write-Phase "Configuring Windows firewall for Ollama"
    $ruleName = "Mythos Ollama API 11434"
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
        Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Profile Private -Direction Inbound -Action Allow | Out-Null
        Write-Ok "Firewall rule already exists and is enabled"
        return
    }

    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 11434 `
        -Profile Private | Out-Null
    Write-Ok "Firewall rule added for TCP 11434 on Private networks"
}

function Find-OllamaExe {
    $command = Get-Command ollama -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Start-Ollama {
    Write-Phase "Starting Ollama"
    $ollamaExe = Find-OllamaExe
    if (-not $ollamaExe) {
        throw "Could not find ollama.exe after install."
    }

    $listening = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        Write-Ok "Ollama already listening on TCP 11434"
        return
    }

    Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4

    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
        $count = @($response.models).Count
        Write-Ok "Ollama reachable locally; models: $count"
    } catch {
        Write-Warn "Ollama did not answer locally yet. A sign-in/restart may be needed. Detail: $($_.Exception.Message)"
    }
}

function Open-CloudApp {
    param(
        [string]$Name,
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if (Test-Path $candidate) {
            Write-Host "Opening $Name..." -ForegroundColor Gray
            Start-Process $candidate
            return
        }
    }
    Write-Warn "Could not locate $Name executable to open it automatically"
}

Assert-Admin

if (-not (Test-Command "winget")) {
    throw "winget is required but was not found."
}

Install-WingetPackage -Id "Ollama.Ollama" -Name "Ollama"
if (-not $SkipGoogleDrive) {
    Install-WingetPackage -Id "Google.GoogleDrive" -Name "Google Drive"
}
if (-not $SkipICloud) {
    Install-WingetPackage -Id "Apple.iCloud" -Name "iCloud"
}

Set-OllamaHost -Value $OllamaHost
Ensure-OllamaFirewall
Start-Ollama

if ($OpenCloudApps) {
    if (-not $SkipGoogleDrive) {
        Open-CloudApp -Name "Google Drive" -Candidates @(
            "$env:ProgramFiles\Google\Drive File Stream\GoogleDriveFS.exe",
            "${env:ProgramFiles(x86)}\Google\Drive File Stream\GoogleDriveFS.exe"
        )
    }
    if (-not $SkipICloud) {
        Start-Process "shell:AppsFolder\AppleInc.iCloud_nzyj5cx40ttqa!iCloud" -ErrorAction SilentlyContinue
    }
}

Write-Phase "Verification"
try {
    $local = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
    Write-Ok "Local Ollama API reachable; models: $(@($local.models).Count)"
} catch {
    Write-Warn "Local Ollama API check failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Next checks from the orchestrator host:" -ForegroundColor Cyan
Write-Host "  curl http://$env:COMPUTERNAME`:11434/api/tags"
Write-Host "  curl http://$env:COMPUTERNAME`:8001/api/health"

if (-not $NoRestartHint) {
    Write-Host ""
    Write-Warn "If the fleet worker still reports Ollama unreachable, restart the simpleminions-worker service or reboot the node so the service inherits OLLAMA_HOST."
}
