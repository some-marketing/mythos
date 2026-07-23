# setup-syme.ps1 — Unified end-to-end launcher for onboarding 'syme' into the Mythos fleet.
#
# Usage (Admin PowerShell, from the thumbdrive bootstrap-kit dir or any location):
#   .\setup-syme.ps1
#   .\setup-syme.ps1 -DrivePath D:\ -ConnectivityOnly
#   .\setup-syme.ps1 -NodeName syme -DrivePath E:\
#
# Phases (in order — order matters; repo must exist before mind substrate lands in it):
#   0  Preflight + passphrase capture
#   1  Enable OpenSSH Server + firewall rule
#   2  Join Tailscale tailnet (calls join-tailnet.ps1)
#   3  Install deps + clone repo + register worker service (calls kernelize-worker.ps1)
#   4  Install encrypted mind substrate into the cloned repo (FIXED decrypt — no UTF-16 bug)
#   5  Wire OVH VPS as update origin + SSH key handshake
#
# Security contract:
#   - Passphrase is captured as SecureString and converted to plaintext ONLY at the
#     moment gpg's StandardInput needs it. It is zeroed and the SecureString disposed
#     immediately after. It is NEVER echoed, logged, written to disk, or held in a
#     catch/finally path.
#   - Private SSH key is NEVER printed. Only the public key + the authorization command
#     is printed for the operator to run on the Mac.
#   - Tailscale enrollment defaults to an INTERACTIVE browser login (no auth key on the
#     drive). authkey.txt is OPTIONAL — if supplied via -AuthKeyPath it is read at
#     runtime only and never echoed; its absence is normal.
#   - No secret is hardcoded anywhere.
#
# Idempotent: safe to re-run. Each phase is guarded with skip-if-done logic.
# Supersedes install_the_kernel.ps1 for the syme onboarding workflow.

[CmdletBinding()]
param(
    # Root of the drive containing the_kernel.tar.gz.gpg (+ .sha256) and the bootstrap-kit scripts.
    # Defaults to the drive root containing this script (e.g., D:\ if script is at D:\bootstrap-kit\).
    [string]$DrivePath = "",

    # OPTIONAL Tailscale auth key path for UNATTENDED enrollment (future cloud-join automation).
    # If omitted (the default), Phase 2 uses an INTERACTIVE Tailscale browser login — no authkey.txt needed.
    [string]$AuthKeyPath = "",

    # Stop after Phase 2 (tailnet enrolled + VPS reachability check). Skips 3-5.
    [switch]$ConnectivityOnly,

    # Node name for Tailscale hostname + NSSM service registration.
    [string]$NodeName = "syme",

    # Mythos clone target on this machine.
    [string]$SmosPath = "C:\Mythos",

    # {OPERATOR_NAME}-s_PC clone target on this machine.
    [string]$TaylorsPCPath = "C:\{OPERATOR_NAME}-s_PC",

    # Orchestrator (Mac) tailnet hostname for kernelize-worker.ps1 connectivity check.
    [string]$OrchestratorHost = "macbook-pro",

    # Orchestrator HTTP port.
    [int]$OrchestratorPort = 8000,

    # NSSM service name.
    [string]$ServiceName = "simpleminions-worker",

    # Tailnet IP of the hub VPS.
    [string]$HubTailnetIP = "{TELEMETRY_HOST}",

    # OVH VPS SSH user.
    [string]$VpsUser = "ubuntu",

    # Override the Claude project memory target path for MEMORY.md.
    # If empty, the path is derived automatically from $SmosPath using Claude Code's slug convention
    # (replace every non-alphanumeric character with '-').
    # Example: C:\Mythos  ->  slug = C--mythos  ->  $HOME\.claude\projects\C--mythos\memory\MEMORY.md
    # To override: -MemoryTargetPath "C:\Users\you\.claude\projects\<slug>\memory\MEMORY.md"
    [string]$MemoryTargetPath = ""
)

$ErrorActionPreference = "Stop"

# ── Resolve drive path ──────────────────────────────────────────────────────────
# Default: the parent of the directory containing this script (e.g., if script is
# at D:\bootstrap-kit\setup-syme.ps1, drive root = D:\).
if ([string]::IsNullOrWhiteSpace($DrivePath)) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $DrivePath = Split-Path -Parent $ScriptDir
    if ([string]::IsNullOrWhiteSpace($DrivePath) -or -not (Test-Path $DrivePath)) {
        # Fallback: use the script dir itself as the drive path
        $DrivePath = $ScriptDir
    }
}
$DrivePath = $DrivePath.TrimEnd("\", "/")

# ── Logging helpers ─────────────────────────────────────────────────────────────
function Write-Banner {
    param([string]$msg)
    $line = "=" * ($msg.Length + 10)
    Write-Host "" -ForegroundColor White
    Write-Host $line -ForegroundColor Magenta
    Write-Host "     $msg" -ForegroundColor Magenta
    Write-Host $line -ForegroundColor Magenta
}

function Write-Phase {
    param([string]$n, [string]$msg)
    Write-Host "" -ForegroundColor White
    Write-Host ">>> Phase $n — $msg" -ForegroundColor Cyan
}

function Write-Ok   { param([string]$msg); Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Skip { param([string]$msg); Write-Host "  → skip: $msg" -ForegroundColor Yellow }
function Write-Warn { param([string]$msg); Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$msg); Write-Host "  ✗ $msg" -ForegroundColor Red; throw $msg }
function Write-Note { param([string]$msg); Write-Host "  NOTE: $msg" -ForegroundColor Cyan }

function Refresh-SessionPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ── Secure wipe helper ──────────────────────────────────────────────────────────
# Overwrites a file N times before deletion to reduce recovery risk.
function Remove-SecureFile {
    param([string]$Path, [int]$Passes = 3)
    if (-not (Test-Path $Path)) { return }
    try {
        $len = (Get-Item $Path).Length
        $buf = [byte[]]::new([Math]::Max($len, 1))
        for ($i = 0; $i -lt $Passes; $i++) {
            (New-Object System.Random).NextBytes($buf)
            [System.IO.File]::WriteAllBytes($Path, $buf)
        }
    } catch {
        # Best-effort; wipe failure is non-fatal but logged
        Write-Warn "Secure overwrite of '$Path' encountered: $_"
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $Path
    }
}

function Remove-TempDir {
    param([string]$Dir)
    if ([string]::IsNullOrWhiteSpace($Dir) -or -not (Test-Path $Dir)) { return }
    # Overwrite any .tar or extracted files before removal
    Get-ChildItem -Path $Dir -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-SecureFile -Path $_.FullName }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Dir
}

# ── Header ──────────────────────────────────────────────────────────────────────
Write-Banner "Mythos setup-syme.ps1 — unified fleet onboarding"
Write-Host "  Date:             $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "  NodeName:         $NodeName" -ForegroundColor Gray
Write-Host "  DrivePath:        $DrivePath" -ForegroundColor Gray
Write-Host "  SmosPath:         $SmosPath" -ForegroundColor Gray
Write-Host "  Mode:             $(if ($ConnectivityOnly) { 'CONNECTIVITY ONLY (phases 0-2)' } else { 'FULL (phases 0-5)' })" -ForegroundColor Gray

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 0 — Preflight + passphrase capture
# ───────────────────────────────────────────────────────────────────────────────
Write-Phase "0" "Preflight + passphrase capture"

# 0a. Admin check
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Fail "Must run as Administrator. Right-click PowerShell → Run as administrator."
}
Write-Ok "Running as Administrator"

# 0b. Windows 11 check
$build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
$caption = (Get-CimInstance Win32_OperatingSystem).Caption
if ($build -lt 22000) {
    Write-Fail "Windows 11 (build >= 22000) required. Got: $caption (build $build)"
}
Write-Ok "OS: $caption (build $build)"

# 0c. Network reachability — basic connectivity before doing anything
Write-Host "  Checking network reachability to github.com..." -ForegroundColor Gray
if (-not (Test-Connection -ComputerName "github.com" -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
    Write-Fail "Cannot reach github.com. Ensure network is connected before running setup."
}
Write-Ok "Network: github.com reachable"

# 0d. Verify kernel bundle files exist on the drive
$KernelBundle  = Join-Path $DrivePath "the_kernel.tar.gz.gpg"
$KernelChecksum = Join-Path $DrivePath "the_kernel.tar.gz.gpg.sha256"

if (-not (Test-Path $KernelBundle)) {
    Write-Fail "Kernel bundle not found at '$KernelBundle'. Ensure the drive is mounted and -DrivePath is correct."
}
if (-not (Test-Path $KernelChecksum)) {
    Write-Fail "Kernel checksum not found at '$KernelChecksum'. Both .gpg and .sha256 must be present on the drive."
}
Write-Ok "Kernel bundle and checksum found on drive"

# 0e. Passphrase capture — ONCE, up front, as SecureString
# *** LINE 155 (approximately): passphrase captured here ***
Write-Host "" -ForegroundColor White
Write-Host "  Enter the kernel passphrase (input is hidden):" -ForegroundColor Cyan
Write-Host "  (This is the symmetric GPG passphrase for the_kernel.tar.gz.gpg)" -ForegroundColor Gray
$KernelPassSS = Read-Host -AsSecureString "  Kernel passphrase"   # <── PASSPHRASE CAPTURED (SecureString)

if ($KernelPassSS -eq $null -or $KernelPassSS.Length -eq 0) {
    Write-Fail "Passphrase cannot be empty."
}
Write-Ok "Passphrase captured as SecureString (not echoed, not stored as plaintext)"

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Enable OpenSSH Server
# ───────────────────────────────────────────────────────────────────────────────
Write-Phase "1" "Enable OpenSSH Server + firewall rule"

$sshCapability = Get-WindowsCapability -Online -Name "OpenSSH.Server*" -ErrorAction SilentlyContinue
if ($sshCapability -and $sshCapability.State -eq "Installed") {
    Write-Skip "OpenSSH Server capability already installed"
} else {
    Write-Host "  Installing OpenSSH.Server capability..." -ForegroundColor Gray
    Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"
    Write-Ok "OpenSSH Server capability installed"
}

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

$sshListening = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
if ($sshListening) {
    Write-Ok "sshd confirmed listening on TCP 22"
} else {
    Write-Warn "sshd not yet listening on TCP 22 — a reboot may be needed. Continuing."
}

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Join Tailscale tailnet
# ───────────────────────────────────────────────────────────────────────────────
Write-Phase "2" "Join Tailscale tailnet (join-tailnet.ps1)"

# Resolve join-tailnet.ps1: prefer same dir as this script (bootstrap-kit on drive).
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$JoinScript   = Join-Path $ScriptDir "join-tailnet.ps1"

if (-not (Test-Path $JoinScript)) {
    Write-Fail "join-tailnet.ps1 not found at '$JoinScript'. Ensure the full bootstrap-kit is present."
}
Write-Ok "join-tailnet.ps1 found at $JoinScript"

# Default: interactive Tailscale browser login (no auth key on the drive).
# Optional: pass -AuthKeyPath through ONLY if the operator supplied one for unattended use.
if (-not [string]::IsNullOrWhiteSpace($AuthKeyPath)) {
    if (-not (Test-Path $AuthKeyPath)) {
        Write-Fail "-AuthKeyPath '$AuthKeyPath' supplied but no file exists there. Omit -AuthKeyPath to use interactive browser login."
    }
    Write-Note "Unattended mode: using auth key at $AuthKeyPath (contents not echoed)."
    & $JoinScript -AuthKeyPath $AuthKeyPath -Hostname $NodeName -HubTailnetIP $HubTailnetIP
} else {
    Write-Note "A Tailscale browser login will appear — sign in to authorize syme (no auth key needed)."
    & $JoinScript -Hostname $NodeName -HubTailnetIP $HubTailnetIP
}
if ($LASTEXITCODE -ne 0) {
    Write-Fail "join-tailnet.ps1 exited with code $LASTEXITCODE"
}
Write-Ok "Tailnet enrollment phase complete"

# Handle reboot-required flag set by join-tailnet.ps1
if ($global:RebootRequired) {
    Write-Host "" -ForegroundColor White
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "  REBOOT REQUIRED — computer was renamed to '$NodeName'." -ForegroundColor Yellow
    Write-Host "  After reboot, re-run setup-syme.ps1 to continue with" -ForegroundColor Yellow
    Write-Host "  phases 3-5 (kernelize + mind substrate + VPS wiring)." -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "" -ForegroundColor White
    Write-Host "Reboot now? (y/N): " -NoNewline -ForegroundColor Cyan
    $rebootChoice = Read-Host
    if ($rebootChoice -match "^[Yy]") {
        Restart-Computer -Force
    }
    exit 0
}

# -ConnectivityOnly: verify VPS reachability then stop
if ($ConnectivityOnly) {
    Write-Phase "2+" "Context-hub reachability check (ConnectivityOnly mode)"
    Write-Host "  Testing SSH to VPS ($HubTailnetIP)..." -ForegroundColor Gray
    $sshCheck = & ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 `
                      "${VpsUser}@${HubTailnetIP}" "echo CONTEXT-HUB-OK" 2>&1
    if ($sshCheck -match "CONTEXT-HUB-OK") {
        Write-Ok "VPS SSH reachable (${VpsUser}@${HubTailnetIP})"
    } else {
        Write-Warn "VPS SSH returned: $sshCheck"
        Write-Warn "Authorize syme's SSH pubkey on the VPS to enable pulls (see Phase 5 output when you run full mode)."
    }
    Write-Host "" -ForegroundColor White
    Write-Host "=== ConnectivityOnly complete — phases 3-5 skipped ===" -ForegroundColor Green
    Write-Host "Re-run without -ConnectivityOnly for the full kernel install." -ForegroundColor Cyan
    exit 0
}

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 3 — Install deps + clone repo + register worker service
# ───────────────────────────────────────────────────────────────────────────────
Write-Phase "3" "Kernelize: deps + repo clone + NSSM service (kernelize-worker.ps1)"

# Resolve kernelize-worker.ps1: prefer repo copy once it exists, then kit copy.
$KernelizeInRepo = Join-Path $SmosPath "tools\fleet\kernelize-worker.ps1"
$KernelizeInKit  = Join-Path (Split-Path $ScriptDir -Parent) "kernelize-worker.ps1"
$KernelizeInKitAlt = Join-Path $ScriptDir "kernelize-worker.ps1"

$KernelizeScript = $null
if (Test-Path $KernelizeInRepo)   { $KernelizeScript = $KernelizeInRepo }
elseif (Test-Path $KernelizeInKit) { $KernelizeScript = $KernelizeInKit }
elseif (Test-Path $KernelizeInKitAlt) { $KernelizeScript = $KernelizeInKitAlt }
else {
    Write-Fail "kernelize-worker.ps1 not found at '$KernelizeInRepo', '$KernelizeInKit', or '$KernelizeInKitAlt'. Copy kernelize-worker.ps1 to the drive's bootstrap-kit dir or ensure the Mythos repo is cloned."
}

Write-Host "  Using kernelize script: $KernelizeScript" -ForegroundColor Gray
Write-Host "" -ForegroundColor White
Write-Host "  *** GitHub login will pop up now — this is expected. ***" -ForegroundColor Yellow
Write-Host "  Complete the browser-based GitHub authentication to allow the repo clone." -ForegroundColor Yellow
Write-Host "" -ForegroundColor White

& $KernelizeScript `
    -NodeName         $NodeName `
    -OrchestratorHost $OrchestratorHost `
    -OrchestratorPort $OrchestratorPort `
    -TaylorsPCPath    $TaylorsPCPath `
    -SmosPath         $SmosPath `
    -ServiceName      $ServiceName

if ($LASTEXITCODE -ne 0) {
    Write-Fail "kernelize-worker.ps1 exited with code $LASTEXITCODE"
}
Write-Ok "Kernelize phase complete — Mythos cloned to $SmosPath, NSSM service registered"

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 4 — Install encrypted mind substrate into the cloned repo
# ───────────────────────────────────────────────────────────────────────────────
Write-Phase "4" "Install encrypted mind substrate (FIXED decrypt)"

# 4a. Verify the cloned repo exists (Phase 3 must have succeeded)
if (-not (Test-Path $SmosPath)) {
    Write-Fail "Mythos repo not found at '$SmosPath'. Phase 3 must complete before Phase 4."
}

# 4b. SHA-256 integrity check BEFORE attempting any decrypt
Write-Host "  Verifying SHA-256 of kernel bundle..." -ForegroundColor Gray
$ExpectedHash = ((Get-Content $KernelChecksum -TotalCount 1) -split "\s+")[0].Trim().ToLowerInvariant()
$ActualHash   = (Get-FileHash -Algorithm SHA256 $KernelBundle).Hash.ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($ExpectedHash) -or $ExpectedHash -ne $ActualHash) {
    Write-Fail "SHA-256 mismatch on '$KernelBundle'. Expected: $ExpectedHash  Got: $ActualHash  Abort — bundle may be corrupted or tampered."
}
Write-Ok "SHA-256 verified: $ExpectedHash"

# 4c. Ensure gpg is available (install Gpg4win via winget if absent)
#     Filter out Windows Store App Execution Alias stubs (same pattern as kernelize-worker.ps1).
Refresh-SessionPath
function Get-RealGpg {
    Get-Command gpg.exe -CommandType Application -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -notmatch '\\WindowsApps\\' } |
        Select-Object -First 1
}

$GpgCmd = (Get-RealGpg)
if (-not $GpgCmd) {
    Write-Host "  gpg not found; installing Gpg4win via winget..." -ForegroundColor Gray
    & winget install --id GnuPG.Gpg4win -e --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "winget install Gpg4win failed (exit $LASTEXITCODE). Install manually from https://gpg4win.org then re-run."
    }
    Refresh-SessionPath
    $GpgCmd = (Get-RealGpg)
    if (-not $GpgCmd) {
        # Search common install paths
        $gpgCandidates = @(
            "$env:ProgramFiles\GnuPG\bin\gpg.exe",
            "$env:ProgramFiles\Gpg4win\bin\gpg.exe",
            "${env:ProgramFiles(x86)}\GnuPG\bin\gpg.exe",
            "${env:ProgramFiles(x86)}\Gpg4win\bin\gpg.exe"
        )
        foreach ($c in $gpgCandidates) {
            if (Test-Path $c) {
                $env:Path = "$env:Path;$(Split-Path $c)"
                $GpgCmd = Get-Command $c -ErrorAction SilentlyContinue
                break
            }
        }
    }
    if (-not $GpgCmd) {
        Write-Fail "gpg installed but not findable. Restart shell and re-run, or add GnuPG bin dir to PATH."
    }
    Write-Ok "Installed Gpg4win; gpg at $($GpgCmd.Source)"
} else {
    Write-Skip "gpg already available at $($GpgCmd.Source)"
}
$GpgExe = $GpgCmd.Source

# 4d. Ensure tar.exe (Windows bsdtar) is available
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    Write-Fail "tar.exe not found. Windows 10/11 ships with bsdtar — if missing, reinstall Windows feature 'MSIX Packaging Tool' or install Git for Windows which bundles tar."
}
Write-Ok "tar.exe available"

# 4e. Set up temp work directory
$TempWorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("smos-kernel-" + [System.Guid]::NewGuid().ToString("N"))
$TempTar     = Join-Path $TempWorkDir "the_kernel.tar.gz"
$TempExtract = Join-Path $TempWorkDir "extract"
New-Item -ItemType Directory -Force -Path $TempWorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempExtract  | Out-Null

# 4f. Decrypt — passphrase plaintext lifetime is bounded to this block.
#     *** PASSPHRASE CONVERTED TO PLAINTEXT HERE (see line reference below) ***
#     StandardInputEncoding = UTF-8 NO-BOM — this is the fix for the "Bad session key" bug.
Write-Host "  Decrypting kernel bundle (passphrase sent via stdin, UTF-8, no BOM)..." -ForegroundColor Gray

$DecryptOk = $false
$BstrPtr   = [IntPtr]::Zero
try {
    # Build gpg process info
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName               = $GpgExe
    $psi.Arguments              = "--batch --yes --pinentry-mode loopback --passphrase-fd 0 --decrypt --output `"$TempTar`" `"$KernelBundle`""
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    # *** StandardInputEncoding SET HERE — UTF-8, NO BOM ***
    # This is the fix for the UTF-16LE passphrase pipe bug present in install_the_kernel.ps1.
    $psi.StandardInputEncoding  = [System.Text.UTF8Encoding]::new($false)  # <── UTF-8 NO-BOM fix

    $proc = [System.Diagnostics.Process]::Start($psi)

    # Convert SecureString → plaintext ONLY now, write immediately, zero immediately.
    # *** PASSPHRASE CONVERTED TO PLAINTEXT HERE ***
    $BstrPtr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($KernelPassSS)
    $plainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($BstrPtr)  # <── PLAINTEXT EXISTS

    $proc.StandardInput.WriteLine($plainPass)    # write to gpg stdin
    $proc.StandardInput.Flush()
    $proc.StandardInput.Close()

    # *** PASSPHRASE ZEROED IMMEDIATELY ***
    $plainPass = $null                                                                  # <── ZEROED
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BstrPtr)                  # <── BSTR ZEROED
    $BstrPtr = [IntPtr]::Zero
    [GC]::Collect()  # encourage GC to clear the string allocation

    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    $proc.WaitForExit()
    $gpgStdout = $stdoutTask.Result
    $gpgStderr = $stderrTask.Result
    $gpgExit   = $proc.ExitCode

    if ($gpgExit -ne 0) {
        # Do NOT echo $gpgStderr verbatim — it could theoretically contain passphrase echo.
        # Log only exit code and line count to avoid any theoretical passphrase-echo leak path.
        $gpgStderrLines = ($gpgStderr -split "`n").Count
        Write-Host "  gpg exit=$gpgExit, stderr lines=$gpgStderrLines" -ForegroundColor Red
        Write-Fail "gpg decrypt failed (exit $gpgExit). Check passphrase and ensure the bundle is not corrupted."
    }

    $DecryptOk = $true
    Write-Ok "Kernel bundle decrypted to temp path"

} catch {
    # Ensure plaintext is cleared even if an exception occurs mid-block
    if ($BstrPtr -ne [IntPtr]::Zero) {
        try { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BstrPtr) } catch {}
        $BstrPtr = [IntPtr]::Zero
    }
    # Do NOT include $_ in the error if it might contain passphrase content.
    # Re-throw a sanitized message.
    Write-Fail "Decrypt phase failed. See output above. (Exception type: $($_.GetType().Name))"
} finally {
    # Belt-and-suspenders: ensure BSTR is zeroed in all code paths
    if ($BstrPtr -ne [IntPtr]::Zero) {
        try { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BstrPtr) } catch {}
        $BstrPtr = [IntPtr]::Zero
    }
    # Dispose the SecureString — it is no longer needed after this phase
    if ($KernelPassSS -ne $null) {
        $KernelPassSS.Dispose()
        $KernelPassSS = $null
    }
}

if (-not $DecryptOk) {
    Remove-TempDir -Dir $TempWorkDir
    Write-Fail "Decrypt did not complete successfully."
}

# 4g–4k wrapped in try/finally so the decrypted temp dir is wiped on ALL exit paths
# including any Write-Fail throws inside validation or copy steps.
# Remove-TempDir is already idempotent (guards with Test-Path).
try {

    # 4g. Extract tar
    Write-Host "  Extracting decrypted tar archive..." -ForegroundColor Gray
    & tar.exe -xzf "$TempTar" -C "$TempExtract"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "tar extraction failed (exit $LASTEXITCODE)."
    }
    Write-Ok "Archive extracted to temp dir"

    # 4h. Validate expected payload paths match what the existing installer uses
    $ExtractedPhilosophy = Join-Path $TempExtract "Mythos\_dev\research\{OPERATOR_NAME}-philosophy"
    $ExtractedMemory     = Join-Path $TempExtract "claude-memory\MEMORY.md"

    if (-not (Test-Path $ExtractedPhilosophy)) {
        Write-Fail "Extracted bundle missing: Mythos/_dev/research/{OPERATOR_NAME}-philosophy — bundle may be outdated or corrupted."
    }
    if (-not (Test-Path $ExtractedMemory)) {
        Write-Fail "Extracted bundle missing: claude-memory/MEMORY.md — bundle may be outdated or corrupted."
    }
    Write-Ok "Both payload paths verified in extract"

    # 4i. Install payload 1 — {OPERATOR_NAME}-philosophy → cloned Mythos repo
    #     Same target as install_the_kernel.ps1: $SmosPath\_dev\research\{OPERATOR_NAME}-philosophy\
    $TargetResearch    = Join-Path $SmosPath "_dev\research"
    $TargetPhilosophy  = Join-Path $TargetResearch "{OPERATOR_NAME}-philosophy"

    New-Item -ItemType Directory -Force -Path $TargetResearch | Out-Null
    if (Test-Path $TargetPhilosophy) {
        Remove-Item -Recurse -Force $TargetPhilosophy
        Write-Ok "Removed existing {OPERATOR_NAME}-philosophy (will overwrite)"
    }
    Copy-Item -Recurse -Force $ExtractedPhilosophy $TargetPhilosophy
    Write-Ok "Installed: $TargetPhilosophy"

    # 4j. Install payload 2 — MEMORY.md → Claude project memory path
    #     The Claude Code project slug is derived by replacing every non-alphanumeric character
    #     in the repo path with '-'. This matches the observed Claude Code slugification:
    #       /Users/admin/dev/Mythos-recovered  ->  -Users-admin-dev-mythos-recovered
    #       C:\Mythos                          ->  C--mythos
    #     The operator may override via -MemoryTargetPath if the slug differs on this machine.
    if (-not [string]::IsNullOrWhiteSpace($MemoryTargetPath)) {
        $TargetMemory = $MemoryTargetPath
    } else {
        $slug         = ($SmosPath -replace '[^a-zA-Z0-9]', '-')
        $TargetMemory = Join-Path $HOME ".claude\projects\$slug\memory\MEMORY.md"
    }
    $TargetMemoryDir = Split-Path -Parent $TargetMemory

    Write-Host "  MEMORY.md target: $TargetMemory" -ForegroundColor Gray
    Write-Note "If syme's Claude project slug differs (run 'ls `$HOME\.claude\projects' after first launching Claude Code here), move MEMORY.md into the matching folder, or re-run with -MemoryTargetPath."

    New-Item -ItemType Directory -Force -Path $TargetMemoryDir | Out-Null
    Copy-Item -Force $ExtractedMemory $TargetMemory
    Write-Ok "Installed: $TargetMemory"

} finally {
    # 4k. Secure removal of temp plaintext material — runs on success AND on any throw.
    Write-Host "  Securely wiping temp plaintext files..." -ForegroundColor Gray
    Remove-TempDir -Dir $TempWorkDir
    Write-Ok "Temp tar and extract dir securely removed"
}

Write-Ok "Phase 4 complete — mind substrate installed"

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 5 — Wire OVH as update source + SSH key handshake
# ───────────────────────────────────────────────────────────────────────────────
Write-Phase "5" "Wire OVH VPS as update origin + SSH key handshake"

# 5a. Add VPS remote (idempotent)
Write-Host "  Adding 'vps' git remote pointing to OVH context-hub..." -ForegroundColor Gray
Push-Location $SmosPath
try {
    $existingRemotes = & git remote 2>&1
    if ($existingRemotes -contains "vps") {
        $existingVpsUrl = (& git remote get-url vps 2>&1).Trim()
        $wantedVpsUrl   = "${VpsUser}@${HubTailnetIP}:git/Mythos.git"
        if ($existingVpsUrl -eq $wantedVpsUrl) {
            Write-Skip "'vps' remote already set to $wantedVpsUrl"
        } else {
            & git remote set-url vps $wantedVpsUrl
            Write-Ok "'vps' remote URL updated to $wantedVpsUrl"
        }
    } else {
        & git remote add vps "${VpsUser}@${HubTailnetIP}:git/Mythos.git"
        if ($LASTEXITCODE -ne 0) { Write-Fail "git remote add vps failed (exit $LASTEXITCODE)" }
        Write-Ok "'vps' remote added: ${VpsUser}@${HubTailnetIP}:git/Mythos.git"
    }
    Write-Ok "'origin' (GitHub) remains the working fallback"
} finally {
    Pop-Location
}

# 5b. Ensure syme has an SSH keypair for VPS access (keyless, matching Orwell fleet pattern)
$SshKeyPath = Join-Path $HOME ".ssh\id_ed25519"
$SshPubPath = "$SshKeyPath.pub"

if (Test-Path $SshKeyPath) {
    Write-Skip "SSH keypair already exists at $SshKeyPath"
} else {
    Write-Host "  Generating SSH keypair for VPS access (keyless, ed25519)..." -ForegroundColor Gray
    $SshDir = Split-Path -Parent $SshKeyPath
    if (-not (Test-Path $SshDir)) { New-Item -ItemType Directory -Force -Path $SshDir | Out-Null }

    # Use ssh-keygen; -N "" = no passphrase (matching Orwell pattern)
    & ssh-keygen -t ed25519 -N "" -f "$SshKeyPath" -q
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "ssh-keygen failed (exit $LASTEXITCODE). Ensure ssh-keygen is on PATH (OpenSSH must have been installed in Phase 1)."
    }
    Write-Ok "SSH keypair generated at $SshKeyPath (private key NOT printed)"
}

# 5c. Read public key (safe to print)
if (-not (Test-Path $SshPubPath)) {
    Write-Fail "SSH public key not found at '$SshPubPath' even after keygen. Check permissions."
}
$SymePubKey = (Get-Content $SshPubPath -Raw).Trim()

# 5d. Print the authorization instructions for the operator (💻 = run on Mac)
Write-Host "" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "  ACTION REQUIRED — Run this ONE command on the Mac (💻) to" -ForegroundColor Yellow
Write-Host "  authorize syme's SSH key on the OVH VPS:" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "" -ForegroundColor White
Write-Host "  ssh ${VpsUser}@${HubTailnetIP} ""echo '$SymePubKey' >> ~/.ssh/authorized_keys""" -ForegroundColor Cyan
Write-Host "" -ForegroundColor White
Write-Host "  After that, to pull future Mythos updates from OVH on syme:" -ForegroundColor Gray
Write-Host "  git -C $SmosPath pull vps recovery/clean-lineage-2026-05-18" -ForegroundColor Cyan
Write-Host "" -ForegroundColor White
Write-Note "Until that Mac command runs, OVH pulls will be refused (host key not authorized)."
Write-Note "syme is FULLY INSTALLED from the GitHub clone. OVH wiring is optional for updates."
Write-Note "GitHub 'origin' remains the fallback: git -C $SmosPath pull origin recovery/clean-lineage-2026-05-18"
Write-Host "" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Yellow

Write-Ok "Phase 5 complete — VPS remote wired, SSH pubkey printed for operator"

# ───────────────────────────────────────────────────────────────────────────────
# COMPLETE
# ───────────────────────────────────────────────────────────────────────────────
Write-Banner "setup-syme.ps1 complete — syme is in the fleet"
Write-Host "" -ForegroundColor White
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  ✓ Phase 0  Preflight passed; kernel bundle verified on drive"        -ForegroundColor Green
Write-Host "  ✓ Phase 1  OpenSSH Server enabled, sshd running"                     -ForegroundColor Green
Write-Host "  ✓ Phase 2  Tailscale tailnet enrolled (hostname: $NodeName)"          -ForegroundColor Green
Write-Host "  ✓ Phase 3  Deps installed, Mythos cloned, NSSM worker service active"  -ForegroundColor Green
Write-Host "  ✓ Phase 4  Mind substrate installed ({OPERATOR_NAME}-philosophy + MEMORY.md)"  -ForegroundColor Green
Write-Host "  ✓ Phase 5  VPS remote added; SSH pubkey printed for authorization"    -ForegroundColor Green
Write-Host "" -ForegroundColor White
Write-Host "Verify from the Mac orchestrator (💻):" -ForegroundColor Cyan
Write-Host "  ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme hostname" -ForegroundColor Gray
Write-Host "  curl http://localhost:$OrchestratorPort/api/nodes | jq '.nodes[] | select(.node_id==""$NodeName"")'" -ForegroundColor Gray
Write-Host "" -ForegroundColor White
Write-Host "Service controls (on syme):" -ForegroundColor Cyan
Write-Host "  nssm status $ServiceName" -ForegroundColor Gray
Write-Host "  nssm restart $ServiceName" -ForegroundColor Gray
Write-Host "  nssm stop $ServiceName" -ForegroundColor Gray
