# join-tailnet.ps1 - Idempotent Tailscale enrollment for a new Windows fleet node
#
# Usage (PowerShell as Administrator, from the thumbdrive or kit directory):
#   .\join-tailnet.ps1                              # DEFAULT: interactive browser login
#   .\join-tailnet.ps1 -AuthKeyPath D:\authkey.txt  # OPTIONAL: unattended auth-key join
#
# Enrollment modes:
#   - DEFAULT (interactive browser login): if no auth key is supplied, runs
#     `tailscale up --hostname=syme`. Tailscale opens a browser / prints a login URL;
#     the operator signs into their Tailscale account to authorize this device.
#     authkey.txt is NOT required — its absence is normal, not an error.
#   - OPTIONAL (unattended auth-key): if -AuthKey or -AuthKeyPath supplies a key that
#     exists, runs `tailscale up --auth-key=<key> --hostname=syme`. This path is for
#     future unattended / fleet cloud-join automation.
#
# Security rules (HARD — do not modify):
#   - The Tailscale auth key is NEVER hardcoded, echoed, logged, or committed.
#   - When provided, the key is read from a file (or -AuthKey value) the operator
#     supplies at runtime.
#   - The key is passed directly to tailscale CLI; it is never stored in a variable
#     that gets printed, nor written to any log or transcript.
#
# What this script does:
#   1. Verifies it is running as Administrator.
#   2. Installs Tailscale via winget if absent (idempotent check first).
#   3. Determines mode: auth-key (if supplied + present) else interactive browser login.
#   4. Runs `tailscale up` accordingly with --hostname=syme.
#   5. Renames the Windows computer to `syme` if it differs (flags reboot needed).
#   6. Verifies tailnet membership via `tailscale status` and pings the hub VPS.

[CmdletBinding()]
param(
    # OPTIONAL unattended auth-key. If neither -AuthKey nor an existing -AuthKeyPath is
    # supplied, the script defaults to interactive browser login (no authkey.txt needed).
    [string]$AuthKey     = "",
    [string]$AuthKeyPath = "",
    [string]$Hostname    = "syme",
    [string]$HubTailnetIP = "{TELEMETRY_HOST}"
)

$ErrorActionPreference = "Stop"

function Write-Phase($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  ok: $msg" -ForegroundColor Green }
function Write-Skip($msg)  { Write-Host "  skip: $msg" -ForegroundColor Yellow }
function Write-Warn($msg)  { Write-Host "  warn: $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "  fail: $msg" -ForegroundColor Red; throw $msg }

function Refresh-SessionPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# --- Admin gate ----------------------------------------------------------------
Write-Phase "Pre-flight"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Fail "Must run as Administrator"
}
Write-Ok "Running as Administrator"

# --- Mode resolution: auth-key (optional) vs interactive browser login (default) ---
# An auth key is OPTIONAL. If -AuthKey is given, or -AuthKeyPath points at an existing
# non-empty file, use unattended auth-key join. Otherwise default to interactive
# browser login. The ABSENCE of an auth key / authkey.txt is normal, not an error.
$authKeyRaw = $null
$useAuthKey = $false

if (-not [string]::IsNullOrWhiteSpace($AuthKey)) {
    # Direct key value passed (e.g., from cloud-join automation). Never echoed.
    $authKeyRaw = $AuthKey.Trim()
    if ([string]::IsNullOrWhiteSpace($authKeyRaw)) {
        Write-Fail "-AuthKey was supplied but is empty/whitespace."
    }
    $useAuthKey = $true
    Write-Ok "Auth key supplied via -AuthKey (contents not echoed) — unattended mode"
} elseif (-not [string]::IsNullOrWhiteSpace($AuthKeyPath)) {
    # A path was explicitly supplied. Resolve and require it to exist + be non-empty.
    $resolvedKeyPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($AuthKeyPath)
    if (-not (Test-Path $resolvedKeyPath)) {
        Write-Fail "-AuthKeyPath '$resolvedKeyPath' was supplied but no file exists there. Omit -AuthKeyPath to use interactive browser login."
    }
    # Read key into a local; never print it.
    $authKeyRaw = (Get-Content -Path $resolvedKeyPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($authKeyRaw)) {
        Write-Fail "Auth key file '$resolvedKeyPath' is empty."
    }
    $useAuthKey = $true
    Write-Ok "Auth key file present and non-empty (contents not echoed) — unattended mode"
    # Wipe the path variable so it doesn't linger in verbose traces
    Remove-Variable resolvedKeyPath
} else {
    Write-Ok "No auth key supplied — using interactive Tailscale browser login (default)"
}

# --- Install Tailscale ---------------------------------------------------------
Write-Phase "Tailscale installation"

Refresh-SessionPath

$tailscaleInstalled = $false
$listOutput = & winget list --id Tailscale.Tailscale --exact --source winget 2>$null
if ($LASTEXITCODE -eq 0 -and ($listOutput -join "`n") -match "Tailscale") {
    Write-Skip "Tailscale already installed (winget list confirms)"
    $tailscaleInstalled = $true
} elseif (Get-Command tailscale -ErrorAction SilentlyContinue) {
    Write-Skip "tailscale already on PATH"
    $tailscaleInstalled = $true
}

if (-not $tailscaleInstalled) {
    Write-Host "  Installing Tailscale via winget..." -ForegroundColor Gray
    & winget install --id Tailscale.Tailscale --exact --source winget `
        --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) { Write-Fail "winget install Tailscale failed (exit $LASTEXITCODE)" }
    Refresh-SessionPath
    if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
        # Tailscale may be in a non-PATH location; search common install dirs
        $candidates = @(
            "$env:ProgramFiles\Tailscale\tailscale.exe",
            "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe",
            "$env:LOCALAPPDATA\Tailscale\tailscale.exe"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) {
                $env:Path = "$env:Path;$(Split-Path $c)"
                break
            }
        }
    }
    if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
        Write-Fail "tailscale installed but not findable on PATH or common locations. Restart the shell and re-run."
    }
    Write-Ok "Tailscale installed"
} else {
    Write-Ok "Tailscale present"
}

# --- Tailscale up --------------------------------------------------------------
Write-Phase "Tailnet enrollment"

# Check if already enrolled to same tailnet (avoid redundant key spend)
$tsStatus = & tailscale status --json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($tsStatus -and $tsStatus.BackendState -eq "Running") {
    Write-Skip "Tailscale already running (BackendState=Running); skipping 'tailscale up' to avoid re-auth"
    Write-Ok "Current tailnet hostname: $($tsStatus.Self.HostName)"
} elseif ($useAuthKey) {
    # OPTIONAL unattended path: pass the key via --auth-key; never echo $authKeyRaw.
    Write-Host "  Running 'tailscale up' with supplied auth key (key not echoed)..." -ForegroundColor Gray
    & tailscale up --auth-key=$authKeyRaw --hostname=$Hostname --accept-routes --accept-dns
    # Zero the in-memory copy immediately after use
    $authKeyRaw = "CLEARED"
    Remove-Variable authKeyRaw -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { Write-Fail "'tailscale up' (auth-key) failed (exit $LASTEXITCODE)" }
    Write-Ok "tailscale up completed (unattended auth-key)"
} else {
    # DEFAULT interactive path: Tailscale opens a browser / prints a login URL.
    Write-Host ""  -ForegroundColor White
    Write-Host "  >>> A browser/login URL will appear — sign into Tailscale to authorize syme." -ForegroundColor Yellow
    Write-Host "  (Just like the GitHub step: complete the Tailscale login in your browser.)" -ForegroundColor Yellow
    Write-Host "  Running 'tailscale up' (interactive browser login)..." -ForegroundColor Gray
    # tailscale prints the login URL to stdout; surface it to the operator.
    & tailscale up --hostname=$Hostname --accept-routes --accept-dns 2>&1 |
        ForEach-Object {
            Write-Host "  $_" -ForegroundColor Gray
            if ($_ -match "https://login\.tailscale\.com\S*") {
                Write-Host "  LOGIN URL: $($Matches[0])" -ForegroundColor Cyan
            }
        }
    if ($LASTEXITCODE -ne 0) { Write-Fail "'tailscale up' (interactive) failed (exit $LASTEXITCODE). Complete the browser login, then re-run." }
    Write-Ok "tailscale up completed (interactive browser login)"
}

# Clear key variable unconditionally (idempotent if already cleared above)
$authKeyRaw = $null
Remove-Variable authKeyRaw -ErrorAction SilentlyContinue

# --- Verify membership ---------------------------------------------------------
Write-Phase "Verify tailnet membership"

$statusOutput = & tailscale status 2>&1
Write-Host $statusOutput -ForegroundColor Gray
Write-Ok "tailscale status printed above"

# Ping the hub VPS
Write-Host "  Pinging hub VPS at $HubTailnetIP..." -ForegroundColor Gray
$pingOk = $false
for ($i = 0; $i -lt 6; $i++) {
    $pingResult = & tailscale ping --c 1 $HubTailnetIP 2>&1
    if ($pingResult -match "pong|ms$") {
        $pingOk = $true
        break
    }
    Start-Sleep -Seconds 3
}
if ($pingOk) {
    Write-Ok "Hub VPS $HubTailnetIP reachable via tailnet"
} else {
    Write-Warn "Hub VPS $HubTailnetIP ping did not return a pong within ~18s. Check: tailscale status; the VPS tailscale may need a moment to register the new peer. Re-run verification manually: tailscale ping $HubTailnetIP"
}

# --- Hostname rename -----------------------------------------------------------
Write-Phase "Hostname check"

$currentName = $env:COMPUTERNAME
if ($currentName -ieq $Hostname) {
    Write-Ok "Windows computer name already '$Hostname'"
} else {
    Write-Warn "Windows computer name is '$currentName' but target hostname is '$Hostname'."
    Write-Host "  Renaming computer to '$Hostname' (requires reboot to take effect)..." -ForegroundColor Gray
    Rename-Computer -NewName $Hostname -Force -ErrorAction Stop
    Write-Warn "Computer rename staged. A REBOOT IS REQUIRED before the name takes effect in DNS/Tailscale FQDN."
    Write-Host ""
    Write-Host "  After reboot, re-run bootstrap-syme.ps1 to continue with remaining phases." -ForegroundColor Cyan
    $global:RebootRequired = $true
}

Write-Host ""
Write-Host "=== join-tailnet complete ===" -ForegroundColor Green
