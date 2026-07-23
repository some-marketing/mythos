# kernelize-worker.ps1 - Kernel a Windows node into the Mythos fleet
#
# Usage (from the node being kerneled, PowerShell as Administrator):
#   .\tools\fleet\kernelize-worker.ps1 -NodeName rupert -OrchestratorHost macbook-pro
#
# Phases (each one verified before continuing):
#   0. Pre-flight    (admin, OS+edition, hostname, network reach)
#   1. Tooling       (gh + real Python via winget; Store-stub-aware)
#   2. Auth + repos  (gh auth status / login; clone {OPERATOR_NAME}-s_PC + Mythos)
#   3. RDP host      (enable Remote Desktop; Tailscale gates exposure)
#   4. venv + deps   (worker minimal requirements; exit-code-checked)
#   5. Yield script  (SC/VR detector for pre-job hook)
#   6. Daemon config (env-var assembly + venv import smoke)
#   7. NSSM service  (install nssm, register simpleminions-worker, start, verify heartbeat)
#
# Why NSSM is load-bearing (not optional): per debrief 2026-04-27 finding 3,
# Start-Process-from-SSH does not detach the worker; the Python child dies when
# the SSH session ends. NSSM service registration is the only way to produce
# a verified-running daemon from a remote-driven kernelize.
#
# Prereqs verified by Phase 0:
#   - Win 11 (build >= 22000) Pro/Enterprise
#   - Run as Administrator
#   - Tailscale up + signed in (orchestrator host pings via tailnet)
#
# Reversibility: snapshot in {OPERATOR_NAME}-s_PC/<node>/state-snapshots/ + Win System
# Restore point recommended before first run. See KERNELIZE.md.

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)] [string]$NodeName,
    [Parameter(Mandatory=$true)] [string]$OrchestratorHost,
    [int]$OrchestratorPort = 8000,
    [string]$Capabilities = "",
    [string]$TaylorsPCPath = "C:\{OPERATOR_NAME}-s_PC",
    [string]$SmosPath = "C:\Mythos",
    [switch]$SkipRDP,
    [switch]$SkipDaemonLaunch,
    [string]$ServiceName = "simpleminions-worker"
)

$ErrorActionPreference = "Stop"

function Write-Phase($n, $msg) { Write-Host "`n=== Phase $n - $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)        { Write-Host "  ok: $msg" -ForegroundColor Green }
function Write-Skip($msg)      { Write-Host "  skip: $msg" -ForegroundColor Yellow }
function Write-Fail($msg)      { Write-Host "  fail: $msg" -ForegroundColor Red; throw $msg }

function Refresh-SessionPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Get-RealPython {
    # Filter out the Microsoft Store App Execution Alias stub at WindowsApps\python.exe
    Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -notmatch '\\WindowsApps\\' } |
        Select-Object -First 1
}

# --- Phase 0: Pre-flight ----------------------------------------------------
Write-Phase 0 "Pre-flight"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Fail "Must run as Administrator"
}
Write-Ok "Running as Administrator"

$build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
$caption = (Get-CimInstance Win32_OperatingSystem).Caption
$editionId = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
if ($build -lt 22000) { Write-Fail "Need Win 11 (build >= 22000), got build $build ($caption)" }
if ($editionId -notmatch "Professional|Enterprise") { Write-Fail "Need Pro or Enterprise edition, got: $editionId" }
Write-Ok "OS: $caption (build $build, edition $editionId)"

$actualHostname = hostname
if ($actualHostname -ne $NodeName) {
    Write-Host "  warn: hostname is '$actualHostname' but -NodeName is '$NodeName'" -ForegroundColor Yellow
}
Write-Ok "Hostname: $actualHostname"

if (-not (Test-Connection -ComputerName github.com -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
    Write-Fail "Cannot reach github.com"
}
Write-Ok "github.com reachable"

if (-not (Test-Connection -ComputerName $OrchestratorHost -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
    Write-Fail "Cannot reach $OrchestratorHost. Is Tailscale up and signed into the same tailnet?"
}
Write-Ok "$OrchestratorHost reachable (Tailscale)"

# --- Phase 1: Tooling --------------------------------------------------------
Write-Phase 1 "Install tooling (gh, real Python)"

Refresh-SessionPath

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    winget install --id GitHub.cli -e --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Write-Fail "winget install GitHub.cli failed (exit $LASTEXITCODE)" }
    Refresh-SessionPath
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Fail "gh installed but not on PATH after refresh" }
    Write-Ok "Installed gh"
} else { Write-Skip "gh already on PATH" }

$PythonExe = (Get-RealPython).Source
if (-not $PythonExe) {
    winget install --id Python.Python.3.12 -e --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Write-Fail "winget install Python.Python.3.12 failed (exit $LASTEXITCODE)" }
    Refresh-SessionPath
    $PythonExe = (Get-RealPython).Source
    if (-not $PythonExe) { Write-Fail "Python installed but no real interpreter on PATH (Store alias still winning?)" }
    Write-Ok "Installed Python at $PythonExe"
} else {
    Write-Skip "Real Python found at $PythonExe"
}

# Verify the resolved Python actually runs (not a stub)
$pyVersion = & $PythonExe -c "import sys; print(sys.version.split()[0])" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Fail "Python smoke test failed: $pyVersion" }
Write-Ok "Python smoke: $pyVersion"

# --- Phase 2: Auth + repos --------------------------------------------------
Write-Phase 2 "GitHub auth + clone repos"

$ghStatus = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  gh not authed; launching browser flow..." -ForegroundColor Yellow
    & gh auth login
    if ($LASTEXITCODE -ne 0) { Write-Fail "gh auth failed" }
}
Write-Ok "gh authed"

if (-not (Test-Path $TaylorsPCPath)) {
    New-Item -ItemType Directory -Path $TaylorsPCPath | Out-Null
    Push-Location $TaylorsPCPath
    & gh repo clone some-marketing/{OPERATOR_NAME}-s_PC .
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "Clone {OPERATOR_NAME}-s_PC failed" }
    Pop-Location
    Write-Ok "Cloned {OPERATOR_NAME}-s_PC to $TaylorsPCPath"
} else {
    Push-Location $TaylorsPCPath
    & git pull --rebase 2>&1 | Out-Null
    Pop-Location
    Write-Skip "{OPERATOR_NAME}-s_PC exists at $TaylorsPCPath (pulled latest)"
}

# Mythos canonical branch ratified in instructions/canonical/branch-canonicity.md.
$SmosBranch = "recovery/clean-lineage-2026-05-18"
if (-not (Test-Path $SmosPath)) {
    New-Item -ItemType Directory -Path $SmosPath | Out-Null
    Push-Location $SmosPath
    & gh repo clone some-marketing/Mythos . -- --branch $SmosBranch
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "Clone Mythos failed" }
    Pop-Location
    Write-Ok "Cloned Mythos to $SmosPath (branch: $SmosBranch)"
} else {
    Push-Location $SmosPath
    & git fetch origin $SmosBranch 2>&1 | Out-Null
    & git checkout $SmosBranch 2>&1 | Out-Null
    & git pull --rebase origin $SmosBranch 2>&1 | Out-Null
    Pop-Location
    Write-Skip "Mythos exists at $SmosPath (checked out $SmosBranch + pulled)"
}

# --- Phase 3: Remote Desktop host ------------------------------------------
Write-Phase 3 "Enable RDP host"

if ($SkipRDP) {
    Write-Skip "RDP setup skipped per -SkipRDP"
} else {
    $rdpDeny = (Get-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections).fDenyTSConnections
    if ($rdpDeny -eq 0) {
        Write-Skip "RDP already enabled"
    } else {
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 0
        Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
        Write-Ok "RDP enabled (firewall rule active; reachable only via Tailscale)"
    }
}

# --- Phase 4: fleet venv + minimal deps ------------------------------------
# venv lives under Mythos/.venv-fleet so fleet code is isolated from any other
# Python work happening in the Mythos repo.
Write-Phase 4 "Set up fleet venv (Mythos/.venv-fleet)"

Push-Location $SmosPath
try {
    if (-not (Test-Path ".venv-fleet")) {
        & $PythonExe -m venv .venv-fleet
        if ($LASTEXITCODE -ne 0) { Write-Fail "python -m venv failed (exit $LASTEXITCODE)" }
        Write-Ok "Created venv at .venv-fleet"
    } else {
        Write-Skip ".venv-fleet exists"
    }
    $VenvPy = Join-Path $SmosPath ".venv-fleet\Scripts\python.exe"
    if (-not (Test-Path $VenvPy)) { Write-Fail "venv Python missing at $VenvPy" }

    & $VenvPy -m pip install --quiet --upgrade pip
    if ($LASTEXITCODE -ne 0) { Write-Fail "pip upgrade failed (exit $LASTEXITCODE)" }

    # Minimal fleet deps from tools/fleet/lib/requirements-fleet.txt
    # (excludes the heavyweight ML packages from simpleminions' requirements.txt)
    $reqPath = Join-Path $SmosPath "tools\fleet\lib\requirements-fleet.txt"
    & $VenvPy -m pip install --quiet -r $reqPath
    if ($LASTEXITCODE -ne 0) { Write-Fail "pip install -r requirements-fleet.txt failed (exit $LASTEXITCODE)" }

    # Smoke: can the venv import what the daemon needs?
    & $VenvPy -c "import fastapi, httpx, uvicorn, pydantic, psutil; print('imports ok')"
    if ($LASTEXITCODE -ne 0) { Write-Fail "venv import smoke failed" }
    Write-Ok "venv import smoke passed"
} finally {
    Pop-Location
}

# --- Phase 5: Yield script --------------------------------------------------
Write-Phase 5 "Write SC/VR yield-check script"

$yieldScript = @'
$blockers = @('StarCitizen', 'StarCitizen_Launcher', 'RSI Launcher', 'vrserver', 'vrcompositor', 'VirtualDesktop.Streamer')
$running = Get-Process -Name $blockers -ErrorAction SilentlyContinue
if ($running) { Write-Output "BUSY: $($running.Name -join ', ')"; exit 1 }
else { Write-Output "IDLE"; exit 0 }
'@
$yieldPath = Join-Path $SmosPath "tools\fleet\check_idle.ps1"
Set-Content -Path $yieldPath -Value $yieldScript -Encoding UTF8
Write-Ok "Wrote $yieldPath"

# --- Phase 6: Daemon config + import smoke ---------------------------------
# IMPORTANT: the worker daemon reads ENV VARS via WorkerConfig.from_env(), NOT
# CLI args. Per Codex review 2026-04-27.
Write-Phase 6 "Daemon config + import smoke"

$VenvPy = Join-Path $SmosPath ".venv-fleet\Scripts\python.exe"
$orchestratorUrl = "http://${OrchestratorHost}:$OrchestratorPort"
$advertiseUrl = "http://${NodeName}:8001"

Write-Host "  Daemon config (env vars):" -ForegroundColor Cyan
Write-Host "    ORCHESTRATOR_URL    = $orchestratorUrl" -ForegroundColor Gray
Write-Host "    WORKER_ID           = $NodeName" -ForegroundColor Gray
Write-Host "    WORKER_ADVERTISE_URL = $advertiseUrl" -ForegroundColor Gray
if ($Capabilities) {
    Write-Host "    (Capabilities '$Capabilities' will be ignored - daemon has no config surface for them yet.)" -ForegroundColor Yellow
}

# Verify the daemon module imports cleanly under the venv before service registration.
Push-Location $SmosPath
try {
    & $VenvPy -c "import importlib; importlib.import_module('tools.fleet.worker'); print('worker module import ok')"
    if ($LASTEXITCODE -ne 0) { Write-Fail "tools.fleet.worker import smoke failed" }
    Write-Ok "Worker module imports cleanly"
} finally {
    Pop-Location
}

# --- Phase 7: NSSM service registration ------------------------------------
# Replaces the prior foreground Start-Process launch which did not survive SSH
# session end on rupert (debrief 2026-04-27 finding 3). NSSM is the durable
# fix and is now treated as required, not deferred.
Write-Phase 7 "Register NSSM service '$ServiceName'"

if ($SkipDaemonLaunch) {
    Write-Skip "Service registration skipped per -SkipDaemonLaunch"
    Write-Host "`nTo register manually after install:" -ForegroundColor Cyan
    Write-Host "  nssm install $ServiceName '$VenvPy' '-m tools.fleet.worker'" -ForegroundColor Gray
    Write-Host "  nssm set $ServiceName AppDirectory '$SmosPath'" -ForegroundColor Gray
    Write-Host "  nssm set $ServiceName AppEnvironmentExtra ORCHESTRATOR_URL=$orchestratorUrl WORKER_ID=$NodeName WORKER_ADVERTISE_URL=$advertiseUrl" -ForegroundColor Gray
    Write-Host "  nssm start $ServiceName" -ForegroundColor Gray
} else {
    Refresh-SessionPath
    if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
        winget install --id NSSM.NSSM -e --silent --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) { Write-Fail "winget install NSSM.NSSM failed (exit $LASTEXITCODE)" }
        Refresh-SessionPath
        if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { Write-Fail "nssm installed but not on PATH after refresh" }
        Write-Ok "Installed NSSM"
    } else {
        Write-Skip "nssm already on PATH"
    }

    $logDir = Join-Path $SmosPath "_dev\logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $stdoutLog = Join-Path $logDir "fleet-worker.stdout.log"
    $stderrLog = Join-Path $logDir "fleet-worker.stderr.log"

    function Invoke-Nssm {
        param([Parameter(Mandatory=$true)][string[]]$Args, [string]$FailMsg)
        & nssm @Args | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail "$FailMsg (nssm exit $LASTEXITCODE; args: $($Args -join ' '))" }
    }

    & sc.exe query $ServiceName | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Skip "Service '$ServiceName' already registered; tearing down for reconfig"
        & nssm stop $ServiceName 2>&1 | Out-Null  # may already be stopped; ignore
        & nssm remove $ServiceName confirm 2>&1 | Out-Null
        # Verify removal before reinstall.
        & sc.exe query $ServiceName | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Fail "nssm remove did not delete service '$ServiceName' (still queryable)" }
        Write-Ok "Removed prior '$ServiceName'"
    }

    & nssm install $ServiceName "$VenvPy" "-m tools.fleet.worker"
    if ($LASTEXITCODE -ne 0) { Write-Fail "nssm install failed (exit $LASTEXITCODE)" }
    Invoke-Nssm -Args @("set", $ServiceName, "AppDirectory", $SmosPath) -FailMsg "nssm set AppDirectory failed"
    Invoke-Nssm -Args @("set", $ServiceName, "AppEnvironmentExtra", "ORCHESTRATOR_URL=$orchestratorUrl", "WORKER_ID=$NodeName", "WORKER_ADVERTISE_URL=$advertiseUrl") -FailMsg "nssm set AppEnvironmentExtra failed"
    Invoke-Nssm -Args @("set", $ServiceName, "AppStdout", $stdoutLog) -FailMsg "nssm set AppStdout failed"
    Invoke-Nssm -Args @("set", $ServiceName, "AppStderr", $stderrLog) -FailMsg "nssm set AppStderr failed"
    Invoke-Nssm -Args @("set", $ServiceName, "AppRotateFiles", "1") -FailMsg "nssm set AppRotateFiles failed"
    Invoke-Nssm -Args @("set", $ServiceName, "AppRotateBytes", "10485760") -FailMsg "nssm set AppRotateBytes failed"
    Invoke-Nssm -Args @("set", $ServiceName, "Start", "SERVICE_AUTO_START") -FailMsg "nssm set Start failed"
    Write-Ok "Service '$ServiceName' configured (logs: $logDir)"

    & nssm start $ServiceName
    if ($LASTEXITCODE -ne 0) { Write-Fail "nssm start $ServiceName failed (exit $LASTEXITCODE)" }
    Write-Ok "Service started"

    # Verify heartbeat reaches orchestrator within a true 30s wall-clock budget.
    $registryUrl = "$orchestratorUrl/api/nodes"
    $deadline = (Get-Date).AddSeconds(30)
    $registered = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-RestMethod -Uri $registryUrl -TimeoutSec 2 -ErrorAction Stop
            if ($resp.nodes | Where-Object { $_.node_id -eq $NodeName }) {
                $registered = $true
                break
            }
        } catch {
            # transient, keep polling
        }
        Start-Sleep -Seconds 1
    }
    if (-not $registered) {
        Write-Host "  service is running but '$NodeName' not visible at $registryUrl within 30s" -ForegroundColor Red
        Write-Host "  check: nssm status $ServiceName ; type '$stderrLog'" -ForegroundColor Yellow
        Write-Fail "Heartbeat verification failed — kerneling did not produce a verified-running daemon"
    }
    Write-Ok "Worker '$NodeName' registered at orchestrator (verified via $registryUrl)"
}

Write-Host "`n=== Kerneling complete ===" -ForegroundColor Green
Write-Host "Verify from orchestrator host (Mac):" -ForegroundColor Cyan
Write-Host "  curl http://localhost:$OrchestratorPort/api/nodes | jq '.nodes[] | select(.node_id==\"$NodeName\")'" -ForegroundColor Gray
Write-Host "Service controls (on $NodeName):" -ForegroundColor Cyan
Write-Host "  nssm status $ServiceName ; nssm restart $ServiceName ; nssm stop $ServiceName" -ForegroundColor Gray
