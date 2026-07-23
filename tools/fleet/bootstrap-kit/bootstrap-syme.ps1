# bootstrap-syme.ps1 - Top-level sequencer for onboarding 'syme' into the Mythos fleet
#
# Usage (PowerShell as Administrator, from the thumbdrive or kit directory):
#   .\bootstrap-syme.ps1
#   .\bootstrap-syme.ps1 -ConnectivityOnly
#   .\bootstrap-syme.ps1 -AuthKeyPath D:\authkey.txt
#
# Phases executed in order:
#   A. OpenSSH Server  - Enable OpenSSH Server + firewall rule (previously manual)
#   B. Tailnet         - Call join-tailnet.ps1 (idempotent enrollment)
#   C. Kernelize       - Call kernelize-worker.ps1 -NodeName syme (phases 0-7)
#   D. Cloud stack     - Call ensure-node-cloud-stack.ps1 (Ollama + cloud drives)
#
# -ConnectivityOnly stops after phase B (Tailnet joined + context-hub confirmed),
# skipping the worker-service registration phases C and D. Use this when you only
# want to get the node on the tailnet and confirm VPS access before the full
# kernel install.
#
# All phases are idempotent and safe to re-run. The script does NOT push, commit,
# or communicate with the network except through Tailscale, GitHub (in phase C),
# and the Ollama/winget installers.
#
# Tailnet enrollment defaults to an INTERACTIVE Tailscale browser login (a login URL
# appears during phase B — sign in to authorize the node). authkey.txt is OPTIONAL:
# pass -AuthKeyPath only for unattended / cloud-join use. When provided, the key is read
# at runtime by join-tailnet.ps1 and never echoed or logged. The license-key file
# already on the thumbdrive is left completely untouched — this script does not
# open, copy, move, or reference it.

[CmdletBinding()]
param(
    # OPTIONAL Tailscale auth-key file for unattended enrollment. If empty (the default),
    # join-tailnet.ps1 uses an interactive browser login — no authkey.txt required.
    [string]$AuthKeyPath = "",

    # Stop after phase B (Tailnet join + context-hub check). Skips phases C and D.
    [switch]$ConnectivityOnly,

    # Tailnet IP of the hub VPS (forwarded to join-tailnet.ps1 for ping verification).
    [string]$HubTailnetIP = "{TELEMETRY_HOST}",

    # Orchestrator tailnet hostname (the Mac running the Mythos orchestrator).
    [string]$OrchestratorHost = "macbook-pro",

    # Orchestrator HTTP port (fleet API).
    [int]$OrchestratorPort = 8000,

    # Mythos repo path on this node (kernelize-worker.ps1 clones here).
    [string]$SmosPath = "C:\Mythos",

    # {OPERATOR_NAME}-s_PC repo path on this node.
    [string]$TaylorsPCPath = "C:\{OPERATOR_NAME}-s_PC",

    # NSSM service name.
    [string]$ServiceName = "simpleminions-worker"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Banner($msg) {
    $line = "=" * ($msg.Length + 10)
    Write-Host ""
    Write-Host $line -ForegroundColor Magenta
    Write-Host "     $msg" -ForegroundColor Magenta
    Write-Host $line -ForegroundColor Magenta
}

function Write-Phase($label, $msg) {
    Write-Host ""
    Write-Host ">>> Phase $label — $msg" -ForegroundColor Cyan
}

function Write-Ok($msg)   { Write-Host "  ok: $msg" -ForegroundColor Green }
function Write-Skip($msg) { Write-Host "  skip: $msg" -ForegroundColor Yellow }
function Write-Warn($msg) { Write-Host "  warn: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  fail: $msg" -ForegroundColor Red; throw $msg }

# -------------------------------------------------------------------------------
Write-Banner "Mythos Fleet Bootstrap — syme"
Write-Host "  Date:         $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "  ScriptDir:    $ScriptDir" -ForegroundColor Gray
Write-Host "  Tailnet auth: $(if ([string]::IsNullOrWhiteSpace($AuthKeyPath)) { 'interactive browser login (default)' } else { "auth key: $AuthKeyPath" })" -ForegroundColor Gray
Write-Host "  Mode:         $(if ($ConnectivityOnly) { 'CONNECTIVITY ONLY (phases A+B)' } else { 'FULL (phases A+B+C+D)' })" -ForegroundColor Gray

# Admin gate (all subsequent phase scripts also check, but fail fast here)
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Fail "Must run as Administrator. Right-click PowerShell → Run as administrator."
}
Write-Ok "Running as Administrator"

# -------------------------------------------------------------------------------
# Phase A: OpenSSH Server
# -------------------------------------------------------------------------------
Write-Phase "A" "Enable OpenSSH Server + firewall rule"

$sshCapability = Get-WindowsCapability -Online -Name "OpenSSH.Server*" -ErrorAction SilentlyContinue
if ($sshCapability -and $sshCapability.State -eq "Installed") {
    Write-Skip "OpenSSH Server capability already installed"
} else {
    Write-Host "  Installing OpenSSH.Server capability..." -ForegroundColor Gray
    Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"
    Write-Ok "OpenSSH Server capability installed"
}

# Enable and start sshd service
$sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($sshd) {
    if ($sshd.StartType -ne "Automatic") {
        Set-Service -Name sshd -StartupType Automatic
        Write-Ok "sshd set to Automatic startup"
    } else {
        Write-Skip "sshd already set to Automatic startup"
    }
    if ($sshd.Status -ne "Running") {
        Start-Service sshd
        Write-Ok "sshd started"
    } else {
        Write-Skip "sshd already running"
    }
} else {
    Write-Fail "sshd service not found after capability install. A reboot may be required — reboot and re-run."
}

# Firewall rule for SSH (22/tcp)
$sshFwRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
if ($sshFwRule) {
    if (-not $sshFwRule.Enabled) {
        Enable-NetFirewallRule -Name "OpenSSH-Server-In-TCP"
        Write-Ok "OpenSSH firewall rule enabled"
    } else {
        Write-Skip "OpenSSH firewall rule already enabled"
    }
} else {
    New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" `
        -DisplayName "OpenSSH SSH Server (sshd)" `
        -Enabled True -Direction Inbound -Protocol TCP `
        -Action Allow -LocalPort 22 | Out-Null
    Write-Ok "OpenSSH firewall rule created (TCP 22, inbound)"
}

# Verify SSH is listening
$sshListening = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
if ($sshListening) {
    Write-Ok "sshd confirmed listening on TCP 22"
} else {
    Write-Warn "sshd not yet listening on TCP 22 — a reboot may be needed. Continuing anyway."
}

# -------------------------------------------------------------------------------
# Phase B: Tailnet enrollment
# -------------------------------------------------------------------------------
Write-Phase "B" "Join Tailscale tailnet (join-tailnet.ps1)"

$joinScript = Join-Path $ScriptDir "join-tailnet.ps1"
if (-not (Test-Path $joinScript)) {
    Write-Fail "join-tailnet.ps1 not found at '$joinScript'. Ensure the full bootstrap-kit is present."
}

& $joinScript -AuthKeyPath $AuthKeyPath -Hostname "syme" -HubTailnetIP $HubTailnetIP
if ($LASTEXITCODE -ne 0) {
    Write-Fail "join-tailnet.ps1 exited with code $LASTEXITCODE"
}
Write-Ok "Tailnet enrollment phase complete"

# If a computer rename was staged, the node needs a reboot before phases C and D.
if ($global:RebootRequired) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "  REBOOT REQUIRED — computer was renamed to 'syme'." -ForegroundColor Yellow
    Write-Host "  After reboot, re-run bootstrap-syme.ps1 to continue with" -ForegroundColor Yellow
    Write-Host "  phases C and D (kernelize + cloud stack)." -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Reboot now? (y/N): " -NoNewline -ForegroundColor Cyan
    $rebootChoice = Read-Host
    if ($rebootChoice -match "^[Yy]") {
        Restart-Computer -Force
    }
    exit 0
}

# -ConnectivityOnly: stop here after a quick context-hub check
if ($ConnectivityOnly) {
    Write-Phase "B+" "Context-hub reachability check (ConnectivityOnly mode)"
    Write-Host "  Testing SSH reachability to hub VPS ($HubTailnetIP)..." -ForegroundColor Gray
    $sshCheck = & ssh -o BatchMode=yes -o StrictHostKeyChecking=no `
                      -o ConnectTimeout=10 `
                      ubuntu@$HubTailnetIP "echo CONTEXT-HUB-OK" 2>&1
    if ($sshCheck -match "CONTEXT-HUB-OK") {
        Write-Ok "Context-hub SSH reachable (ubuntu@$HubTailnetIP)"
    } else {
        Write-Warn "Context-hub SSH check returned: $sshCheck"
        Write-Warn "Ensure the Mac's id_ed25519.pub is seeded to the VPS authorized_keys, and that the tailnet is up."
    }

    Write-Host ""
    Write-Host "=== ConnectivityOnly complete — phases C and D skipped ===" -ForegroundColor Green
    Write-Host "To run the full kernel install, re-run without -ConnectivityOnly." -ForegroundColor Cyan
    exit 0
}

# -------------------------------------------------------------------------------
# Phase C: Kernelize (call existing kernelize-worker.ps1)
# -------------------------------------------------------------------------------
Write-Phase "C" "Kernelize worker (kernelize-worker.ps1 -NodeName syme)"

# Resolve the kernelize script. Prefer the Mythos repo path once cloned; fall back
# to a copy relative to the kit for a fully offline first-run scenario.
$kernelizeScript = $null
$kernelizeInRepo  = Join-Path $SmosPath "tools\fleet\kernelize-worker.ps1"
$kernelizeInKit   = Join-Path (Split-Path $ScriptDir -Parent) "kernelize-worker.ps1"

if (Test-Path $kernelizeInRepo) {
    $kernelizeScript = $kernelizeInRepo
} elseif (Test-Path $kernelizeInKit) {
    $kernelizeScript = $kernelizeInKit
} else {
    Write-Fail "kernelize-worker.ps1 not found at '$kernelizeInRepo' or '$kernelizeInKit'. Clone Mythos first (phase C requires network)."
}

Write-Host "  Using kernelize script: $kernelizeScript" -ForegroundColor Gray

& $kernelizeScript `
    -NodeName        "syme" `
    -OrchestratorHost $OrchestratorHost `
    -OrchestratorPort $OrchestratorPort `
    -TaylorsPCPath   $TaylorsPCPath `
    -SmosPath        $SmosPath `
    -ServiceName     $ServiceName

if ($LASTEXITCODE -ne 0) {
    Write-Fail "kernelize-worker.ps1 exited with code $LASTEXITCODE"
}
Write-Ok "Kernelize phase complete"

# -------------------------------------------------------------------------------
# Phase D: Cloud stack (Ollama + cloud drives)
# -------------------------------------------------------------------------------
Write-Phase "D" "Ensure node cloud stack (ensure-node-cloud-stack.ps1)"

# ensure-node-cloud-stack.ps1 lives in the Mythos repo (was cloned in phase C)
$cloudScript = Join-Path $SmosPath "tools\fleet\ensure-node-cloud-stack.ps1"
if (-not (Test-Path $cloudScript)) {
    Write-Fail "ensure-node-cloud-stack.ps1 not found at '$cloudScript'. Ensure the Mythos clone succeeded in phase C."
}

# syme: Ollama is localhost-only (matches orwell pattern from fleet-hosts.json).
# Pass 127.0.0.1 so the firewall rule is NOT opened for external network traffic.
& $cloudScript -OllamaHost "127.0.0.1:11434"
if ($LASTEXITCODE -ne 0) {
    Write-Fail "ensure-node-cloud-stack.ps1 exited with code $LASTEXITCODE"
}
Write-Ok "Cloud stack phase complete"

# -------------------------------------------------------------------------------
Write-Banner "Bootstrap complete — syme is in the fleet"
Write-Host ""
Write-Host "Verify from the Mac orchestrator:" -ForegroundColor Cyan
Write-Host "  ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme hostname" -ForegroundColor Gray
Write-Host "  curl http://localhost:$OrchestratorPort/api/nodes | jq '.nodes[] | select(.node_id==""syme"")'" -ForegroundColor Gray
Write-Host ""
Write-Host "Service controls (on syme):" -ForegroundColor Cyan
Write-Host "  nssm status $ServiceName" -ForegroundColor Gray
Write-Host "  nssm restart $ServiceName" -ForegroundColor Gray
Write-Host "  nssm stop $ServiceName" -ForegroundColor Gray
