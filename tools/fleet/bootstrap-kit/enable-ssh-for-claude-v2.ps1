# enable-ssh-for-claude-v2.ps1
#
# PURPOSE: Enable OpenSSH Server on Windows 11 so Claude (on the Mac) can SSH in.
#
# USAGE:
#   Best: save as enable-ssh.ps1, right-click → "Run with PowerShell (Admin)".
#   Pasting also works — the script is paste-safe (no #Requires line).
#
# IDEMPOTENT: safe to re-run at any time. All steps skip if already complete.
# LOG FILE:   C:\Users\Public\syme-ssh-setup-result.txt  (paste to Claude on failure)
#
# Embedded public key (Claude's Mac ed25519 key, get@example-agency.com):
#   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKPWOll/LIjJywII3MSBeY8vfJI0eXqdKtwFNxeUwJL1 get@example-agency.com

# ── PASTE-SAFE: set execution policy for this process only ─────────────────────
try { Set-ExecutionPolicy -Scope Process Bypass -Force } catch {}

# ── TRANSCRIPT (full log to file for operator to paste to Claude) ──────────────
$LogFile = "C:\Users\Public\syme-ssh-setup-result.txt"
try { Start-Transcript -Path $LogFile -Force } catch {
    Write-Host "[warn] Could not start transcript to $LogFile — continuing without file log." -ForegroundColor Yellow
}

$ErrorActionPreference = "Continue"   # don't auto-throw; we handle errors explicitly

# ── Logging helpers ────────────────────────────────────────────────────────────
function Write-Ok   { param([string]$msg) Write-Host "  [+] $msg" -ForegroundColor Green }
function Write-Skip { param([string]$msg) Write-Host "  [~] skip: $msg" -ForegroundColor Yellow }
function Write-Warn { param([string]$msg) Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-Info { param([string]$msg) Write-Host "  [.] $msg" -ForegroundColor Cyan }
function Write-Fail { param([string]$msg) Write-Host "  [X] $msg" -ForegroundColor Red }
function Write-Banner {
    param([string]$msg, [System.ConsoleColor]$Color = [System.ConsoleColor]::Magenta)
    $line = "=" * ($msg.Length + 10)
    Write-Host ""
    Write-Host $line -ForegroundColor $Color
    Write-Host "     $msg" -ForegroundColor $Color
    Write-Host $line -ForegroundColor $Color
    Write-Host ""
}

Write-Banner "enable-ssh-for-claude-v2.ps1 — $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ── Tracking state ─────────────────────────────────────────────────────────────
$Script:Errors     = [System.Collections.Generic.List[string]]::new()
$Script:Warnings   = [System.Collections.Generic.List[string]]::new()
$Script:InstallMethod = $null   # which method got sshd installed

# ── STEP 1: Elevation check ────────────────────────────────────────────────────
Write-Info "Checking elevation..."
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Fail "Must run as Administrator. Right-click PowerShell → Run as administrator."
    $Script:Errors.Add("Not running as Administrator — all steps skipped.")
    # Jump straight to remediation block
    goto_remediation
    return
}
Write-Ok "Running as Administrator"

# ── Helper: goto_remediation workaround (PS has no goto; use a function) ──────
function goto_remediation { }   # placeholder; remediation block is at the end

# ── STEP 2: OS check ──────────────────────────────────────────────────────────
Write-Info "Checking Windows version..."
try {
    $os    = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $build = [int]$os.BuildNumber
    Write-Ok "OS: $($os.Caption) (build $build)"
    if ($build -lt 22000) {
        $Script:Warnings.Add("OS build $build < 22000. Script targets Windows 11 — proceed with caution.")
        Write-Warn "OS build $build is below Windows 11 (22000). Proceeding anyway."
    }
} catch {
    Write-Warn "Could not read OS version: $_"
}

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: MULTI-METHOD OpenSSH SERVER INSTALL
# Method 1 → FoD (Windows Update)
# Method 2 → winget (Win32-OpenSSH, no WU path)
# Method 3 → GitHub zip download + install-sshd.ps1
# ══════════════════════════════════════════════════════════════════════════════
Write-Info "--- STEP 3: Install OpenSSH Server ---"

# Helper: is sshd installed at all?
function Test-SshdPresent {
    $svc = Get-Service -Name sshd -ErrorAction SilentlyContinue
    if ($svc) { return $true }
    # Also check for sshd.exe directly (winget/zip install may not use FoD service name yet)
    $paths = @(
        "$env:SystemRoot\System32\OpenSSH\sshd.exe",
        "$env:ProgramFiles\OpenSSH\sshd.exe",
        "$env:ProgramFiles\OpenSSH-Win64\sshd.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $true } }
    return $false
}

$sshdAlreadyPresent = Test-SshdPresent
if ($sshdAlreadyPresent) {
    Write-Skip "sshd already present — skipping install methods"
    $Script:InstallMethod = "already-installed"
} else {
    # ── METHOD 1: Features-on-Demand (Windows Update path) ────────────────────
    Write-Info "Method 1: Add-WindowsCapability (FoD / Windows Update)..."
    $m1ok = $false
    try {
        $cap = Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0" -ErrorAction Stop
        if ($cap.RestartNeeded) {
            $Script:Warnings.Add("Method 1 succeeded but RestartNeeded=True. Reboot after this script if sshd won't start.")
            Write-Warn "RestartNeeded=True — a reboot may be required. Script will attempt to continue."
        }
        $m1ok = $true
        Write-Ok "Method 1 succeeded: FoD capability installed."
        $Script:InstallMethod = "Method1-FoD"
    } catch {
        $m1err = "$_"
        Write-Warn "Method 1 FAILED (FoD/Windows Update): $m1err"
        $Script:Errors.Add("Method 1 (FoD) failed: $m1err")
        if ($m1err -match "0x800f0950") {
            Write-Warn "  Error 0x800f0950 = Windows Update source blocked (metered/WSUS/no internet to FoD)."
        }
    }

    # ── METHOD 2: winget (Win32-OpenSSH — no FoD/WU path) ─────────────────────
    if (-not $m1ok) {
        Write-Info "Method 2: winget install Microsoft.OpenSSH.Beta (no Windows Update path)..."
        $m2ok = $false
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if (-not $wingetCmd) {
            Write-Warn "Method 2 SKIPPED: winget not found. Install 'App Installer' from Microsoft Store."
            $Script:Warnings.Add("Method 2 skipped: winget not found.")
        } else {
            try {
                $wingetOut = & winget install --id Microsoft.OpenSSH.Beta `
                    --silent --accept-source-agreements --accept-package-agreements 2>&1
                Write-Info "winget output: $($wingetOut -join '; ')"
                if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189) {
                    # -1978335189 = APPINSTALLER_ERROR_ALREADY_INSTALLED (idempotent)
                    $m2ok = $true
                    Write-Ok "Method 2 succeeded: winget installed Win32-OpenSSH."
                    $Script:InstallMethod = "Method2-winget"
                    # Refresh PATH so ssh/sshd picked up
                    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                                [System.Environment]::GetEnvironmentVariable("Path","User")
                } else {
                    $Script:Errors.Add("Method 2 (winget) exited $LASTEXITCODE. Output: $($wingetOut -join ' | ')")
                    Write-Warn "Method 2 FAILED: winget exit code $LASTEXITCODE"
                }
            } catch {
                $Script:Errors.Add("Method 2 (winget) exception: $_")
                Write-Warn "Method 2 FAILED (exception): $_"
            }
        }

        # ── METHOD 3: GitHub zip download ─────────────────────────────────────
        if (-not $m2ok) {
            Write-Info "Method 3: Download Win32-OpenSSH zip from GitHub..."
            $m3ok = $false

            # Force TLS 1.2 (required for GitHub)
            try { [Net.ServicePointManager]::SecurityProtocol = 'Tls12' } catch {}

            $opensshDir  = "$env:ProgramFiles\OpenSSH"
            $tempZip     = "$env:TEMP\OpenSSH-Win64.zip"
            $tempExtract = "$env:TEMP\OpenSSH-Win64-extract"

            # Try known-good release URL first, then GitHub API for latest
            $zipUrls = @(
                "https://github.com/PowerShell/Win32-OpenSSH/releases/download/v9.5.0.0p1-Beta/OpenSSH-Win64.zip",
                "https://github.com/PowerShell/Win32-OpenSSH/releases/latest/download/OpenSSH-Win64.zip"
            )

            # Also try GitHub API for the very latest release asset
            try {
                Write-Info "  Resolving latest GitHub release via API..."
                $apiUrl = "https://api.github.com/repos/PowerShell/Win32-OpenSSH/releases/latest"
                $headers = @{ "User-Agent" = "enable-ssh-for-claude-v2" }
                $rel = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 15 -ErrorAction Stop
                $asset = $rel.assets | Where-Object { $_.name -eq "OpenSSH-Win64.zip" } | Select-Object -First 1
                if ($asset) {
                    Write-Info "  Latest release asset URL: $($asset.browser_download_url)"
                    # Prepend so latest is tried first
                    $zipUrls = @($asset.browser_download_url) + $zipUrls
                }
            } catch {
                Write-Warn "  GitHub API lookup failed ($_) — using hardcoded URL."
            }

            # Download — try each URL in order
            $downloaded = $false
            foreach ($url in $zipUrls) {
                Write-Info "  Trying download: $url"
                try {
                    Invoke-WebRequest -Uri $url -OutFile $tempZip -TimeoutSec 120 -ErrorAction Stop
                    $downloaded = $true
                    Write-Ok "  Downloaded to $tempZip"
                    break
                } catch {
                    Write-Warn "  Download failed from $url : $_"
                }
            }

            if (-not $downloaded) {
                $Script:Errors.Add("Method 3 (GitHub zip): all download URLs failed — no internet or GitHub blocked.")
                Write-Fail "Method 3 FAILED: could not download OpenSSH zip from GitHub."
            } else {
                try {
                    # Extract
                    if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract }
                    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force -ErrorAction Stop
                    Write-Ok "  Extracted zip."

                    # Find the inner folder (usually OpenSSH-Win64)
                    $innerDir = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
                    if (-not $innerDir) {
                        throw "No subdirectory found after extracting zip."
                    }

                    # Install to Program Files\OpenSSH
                    if (Test-Path $opensshDir) { Remove-Item -Recurse -Force $opensshDir }
                    Copy-Item -Recurse -Force $innerDir.FullName $opensshDir
                    Write-Ok "  Copied to $opensshDir"

                    # Add to system PATH (idempotent)
                    $currentPath = [System.Environment]::GetEnvironmentVariable("Path","Machine")
                    if ($currentPath -notlike "*$opensshDir*") {
                        [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$opensshDir", "Machine")
                        $env:Path = $env:Path + ";$opensshDir"
                        Write-Ok "  Added $opensshDir to system PATH."
                    }

                    # Run the bundled install-sshd.ps1
                    $installScript = Join-Path $opensshDir "install-sshd.ps1"
                    if (-not (Test-Path $installScript)) {
                        throw "install-sshd.ps1 not found in $opensshDir — zip may be malformed."
                    }
                    Write-Info "  Running install-sshd.ps1..."
                    & powershell -ExecutionPolicy Bypass -File $installScript
                    if ($LASTEXITCODE -ne 0) {
                        throw "install-sshd.ps1 exited with code $LASTEXITCODE"
                    }
                    Write-Ok "  install-sshd.ps1 completed."
                    $m3ok = $true
                    $Script:InstallMethod = "Method3-GitHubZip"
                } catch {
                    $Script:Errors.Add("Method 3 (GitHub zip) install step failed: $_")
                    Write-Fail "Method 3 FAILED (install step): $_"
                } finally {
                    # Clean up temp files
                    try { if (Test-Path $tempZip)     { Remove-Item -Force $tempZip     } } catch {}
                    try { if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract } } catch {}
                }
            }

            if (-not $m3ok) {
                $Script:Errors.Add("ALL install methods failed. SSH not installed.")
                Write-Fail "ALL THREE INSTALL METHODS FAILED. See remediation block below."
            }
        }
    }
}

# ── Verify sshd is now present ─────────────────────────────────────────────────
$sshdPresent = Test-SshdPresent
if ($sshdPresent -and $Script:InstallMethod -eq $null) { $Script:InstallMethod = "already-installed" }
if (-not $sshdPresent -and $Script:Errors.Count -gt 0) {
    # Installation truly failed — skip to remediation
    Write-Fail "sshd not present after all install attempts. Jumping to remediation."
} else {

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: sshd service — Automatic startup + Start
# ══════════════════════════════════════════════════════════════════════════════
Write-Info "--- STEP 4: Configure + start sshd service ---"

# For zip installs, sshd may be in PATH but not registered as a service yet
# install-sshd.ps1 should have handled that; just verify/set here
$sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($sshd) {
    try {
        if ($sshd.StartType -ne "Automatic") {
            Set-Service -Name sshd -StartupType Automatic -ErrorAction Stop
            Write-Ok "sshd set to Automatic startup."
        } else {
            Write-Skip "sshd already Automatic."
        }
    } catch { Write-Warn "Could not set sshd startup type: $_" }

    try {
        $sshd.Refresh()
        if ($sshd.Status -ne "Running") {
            Start-Service sshd -ErrorAction Stop
            Start-Sleep -Seconds 2
            Write-Ok "sshd started."
        } else {
            Write-Skip "sshd already running."
        }
    } catch {
        $Script:Errors.Add("sshd start failed: $_")
        Write-Fail "Failed to start sshd: $_"
    }
} else {
    $Script:Warnings.Add("sshd service object not found after install. A reboot may be needed.")
    Write-Warn "sshd service not found. If Method 3 (zip) was used, try rebooting then re-run."
}

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5: Firewall — ensure TCP 22 inbound allowed
# ══════════════════════════════════════════════════════════════════════════════
Write-Info "--- STEP 5: Firewall rule TCP 22 ---"
try {
    $fwRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
    if ($fwRule) {
        if (-not $fwRule.Enabled) {
            Enable-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction Stop
            Write-Ok "Existing OpenSSH firewall rule enabled."
        } else {
            Write-Skip "OpenSSH firewall rule already enabled."
        }
    } else {
        New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" `
            -DisplayName "OpenSSH SSH Server (sshd)" `
            -Enabled True -Direction Inbound -Protocol TCP `
            -Action Allow -LocalPort 22 -ErrorAction Stop | Out-Null
        Write-Ok "Firewall rule created: inbound TCP 22."
    }
} catch {
    $Script:Errors.Add("Firewall rule step failed: $_")
    Write-Fail "Firewall step failed: $_"
}

# ══════════════════════════════════════════════════════════════════════════════
# STEP 6: Write Claude's authorized public key (idempotent, UTF8-no-BOM)
# ══════════════════════════════════════════════════════════════════════════════
Write-Info "--- STEP 6: Write authorized_keys for Claude ---"

$claudePubKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKPWOll/LIjJywII3MSBeY8vfJI0eXqdKtwFNxeUwJL1 get@example-agency.com"

# Determine if the current user is an administrator account
# Admin accounts on Windows require the key in ProgramData\ssh\administrators_authorized_keys
$adminKeyPath  = "$env:ProgramData\ssh\administrators_authorized_keys"
$userKeyDir    = "$env:USERPROFILE\.ssh"
$userKeyPath   = "$userKeyDir\authorized_keys"

function Write-KeyIdempotent {
    param([string]$KeyFile, [string]$Key)
    $dir = Split-Path -Parent $KeyFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    # Check if key already present
    if (Test-Path $KeyFile) {
        $existing = Get-Content $KeyFile -Raw -ErrorAction SilentlyContinue
        if ($existing -and $existing.Contains($Key.Split(" ")[1])) {
            Write-Skip "Claude's key already in $KeyFile"
            return $true
        }
    }
    # Write / append (no BOM, Unix line endings)
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $content   = if ((Test-Path $KeyFile) -and ((Get-Item $KeyFile).Length -gt 0)) {
        (Get-Content $KeyFile -Raw).TrimEnd("`r","`n") + "`n" + $Key + "`n"
    } else { $Key + "`n" }
    [System.IO.File]::WriteAllText($KeyFile, $content, $utf8NoBom)
    Write-Ok "Claude's key written to $KeyFile"
    return $true
}

# Write to admin key file (always, since we're running as admin)
$keyWriteOk = $false
try {
    Write-KeyIdempotent -KeyFile $adminKeyPath -Key $claudePubKey

    # Fix ACL: administrators_authorized_keys must have ONLY Administrators + SYSTEM
    # (OpenSSH enforces this on Windows — wrong perms = key silently ignored)
    Write-Info "  Applying required ACL to administrators_authorized_keys..."
    $acl = Get-Acl $adminKeyPath
    $acl.SetAccessRuleProtection($true, $false)  # disable inheritance, clear inherited
    $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
    $sddl_admins = "Administrators"
    $sddl_system = "SYSTEM"
    foreach ($principal in @($sddl_admins, $sddl_system)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $principal, "FullControl", "Allow")
        $acl.AddAccessRule($rule)
    }
    Set-Acl -Path $adminKeyPath -AclObject $acl -ErrorAction Stop
    Write-Ok "ACL set: only Administrators + SYSTEM have access (OpenSSH requirement)."
    $keyWriteOk = $true
} catch {
    $Script:Errors.Add("Admin key/ACL step failed: $_")
    Write-Fail "Admin key write or ACL failed: $_"
    Write-Warn "Attempting fallback: writing to user authorized_keys..."
    try {
        Write-KeyIdempotent -KeyFile $userKeyPath -Key $claudePubKey
        $keyWriteOk = $true
    } catch {
        $Script:Errors.Add("User key write also failed: $_")
        Write-Fail "User key write failed too: $_"
    }
}

# Also write to user authorized_keys if admin key write succeeded (belt+suspenders)
if ($keyWriteOk) {
    try { Write-KeyIdempotent -KeyFile $userKeyPath -Key $claudePubKey } catch {}
}

# ── Restart sshd to pick up new key ──────────────────────────────────────────
Write-Info "Restarting sshd to pick up key changes..."
try {
    Restart-Service sshd -Force -ErrorAction Stop
    Start-Sleep -Seconds 2
    Write-Ok "sshd restarted."
} catch {
    Write-Warn "Could not restart sshd (may not be running yet): $_"
}

} # end if sshdPresent block

# ══════════════════════════════════════════════════════════════════════════════
# STEP 7: VERIFY
# ══════════════════════════════════════════════════════════════════════════════
Write-Info "--- STEP 7: Verify ---"

$verifyOk = $true
$verifyMessages = [System.Collections.Generic.List[string]]::new()

# Check 1: sshd service running
$sshdSvc = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($sshdSvc -and $sshdSvc.Status -eq "Running") {
    Write-Ok "sshd service: Running"
    $verifyMessages.Add("sshd service: RUNNING")
} else {
    $status = if ($sshdSvc) { $sshdSvc.Status } else { "NOT FOUND" }
    Write-Fail "sshd service: $status"
    $verifyMessages.Add("sshd service: $status  <-- PROBLEM")
    $verifyOk = $false
    $Script:Errors.Add("sshd not running after setup. Status: $status")
}

# Check 2: port 22 listening
$port22 = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
if ($port22) {
    Write-Ok "TCP 22: listening"
    $verifyMessages.Add("TCP 22: LISTENING")
} else {
    Write-Fail "TCP 22: NOT listening"
    $verifyMessages.Add("TCP 22: NOT listening  <-- PROBLEM")
    $verifyOk = $false
    $Script:Errors.Add("Nothing listening on TCP 22 after setup.")
}

# Check 3: key file present
$adminKeyExists = Test-Path "$env:ProgramData\ssh\administrators_authorized_keys"
$userKeyExists  = Test-Path "$env:USERPROFILE\.ssh\authorized_keys"
if ($adminKeyExists -or $userKeyExists) {
    Write-Ok "authorized_keys: present (admin=$adminKeyExists user=$userKeyExists)"
    $verifyMessages.Add("authorized_keys: present")
} else {
    Write-Fail "authorized_keys: NOT found in either location"
    $verifyMessages.Add("authorized_keys: MISSING  <-- PROBLEM")
    $verifyOk = $false
    $Script:Errors.Add("No authorized_keys file found.")
}

# ══════════════════════════════════════════════════════════════════════════════
# FINAL BANNER
# ══════════════════════════════════════════════════════════════════════════════
Write-Host ""
if ($verifyOk -and $Script:Errors.Count -eq 0) {
    Write-Banner "===== SSH READY FOR CLAUDE — tell Claude 'syme ssh is ready' =====" Green
    Write-Host "  Install method: $Script:InstallMethod" -ForegroundColor Green
    $verifyMessages | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
    Write-Host ""
    Write-Host "  From the Mac, connect with:" -ForegroundColor Cyan
    Write-Host "  ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 <username>@<syme-ip>" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Banner "===== SSH SETUP INCOMPLETE — see WHAT TO DO NEXT below =====" Red
    Write-Host "  Install method attempted: $Script:InstallMethod" -ForegroundColor Yellow
    $verifyMessages | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "  Errors recorded:" -ForegroundColor Red
    $Script:Errors | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    if ($Script:Warnings.Count -gt 0) {
        Write-Host "  Warnings:" -ForegroundColor Yellow
        $Script:Warnings | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
    }
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════════════════════
# DURABLE FAILURE REPORTING — remediation ranked most→least common
# ══════════════════════════════════════════════════════════════════════════════
$showRemediation = (-not $verifyOk) -or ($Script:Errors.Count -gt 0) -or ($Script:Warnings.Count -gt 0)

if ($showRemediation) {
    Write-Host ""
    Write-Host "===== WHAT TO DO NEXT (most-common cause first) =====" -ForegroundColor Magenta
    Write-Host ""

    Write-Host "1. OpenSSH FoD install blocked (error 0x800f0950 / Windows Update / WSUS):" -ForegroundColor Cyan
    Write-Host "   - This script already tried winget + GitHub zip as fallbacks." -ForegroundColor White
    Write-Host "   - If those also failed: connect syme to a non-metered internet connection," -ForegroundColor White
    Write-Host "     then re-run this script." -ForegroundColor White
    Write-Host "   - Or run manually in an Admin PowerShell:" -ForegroundColor White
    Write-Host "     DISM /Online /Add-Capability /CapabilityName:OpenSSH.Server~~~~0.0.1.0" -ForegroundColor Yellow
    Write-Host "   - If on a corporate/WSUS network, temporarily bypass WSUS:" -ForegroundColor White
    Write-Host "     reg add HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU /v UseWUServer /t REG_DWORD /d 0 /f" -ForegroundColor Yellow
    Write-Host "     net stop wuauserv & net start wuauserv" -ForegroundColor Yellow
    Write-Host "     (then re-run this script; reverse the reg key when done)" -ForegroundColor White
    Write-Host ""

    Write-Host "2. Script was pasted instead of saved+run (RuntimeException / pipeline error):" -ForegroundColor Cyan
    Write-Host "   - Save this script as enable-ssh.ps1" -ForegroundColor White
    Write-Host "   - Right-click → Run with PowerShell (Admin), OR:" -ForegroundColor White
    Write-Host "     powershell -ExecutionPolicy Bypass -File .\enable-ssh.ps1" -ForegroundColor Yellow
    Write-Host "   - The '#Requires' error and 'An error occurred while creating the pipeline'" -ForegroundColor White
    Write-Host "     messages come from pasting; saving as a file fixes them." -ForegroundColor White
    Write-Host ""

    Write-Host "3. No internet / metered Wi-Fi connection:" -ForegroundColor Cyan
    Write-Host "   - All three install methods need internet (FoD → WU; winget → MS servers;" -ForegroundColor White
    Write-Host "     GitHub zip → github.com). Connect syme to a reliable network and re-run." -ForegroundColor White
    Write-Host "   - Test from PowerShell: Test-Connection github.com -Count 1" -ForegroundColor Yellow
    Write-Host ""

    Write-Host "4. winget missing (older Windows build):" -ForegroundColor Cyan
    Write-Host "   - Install 'App Installer' from the Microsoft Store (search: App Installer)" -ForegroundColor White
    Write-Host "   - Or use the GitHub zip method (Method 3) which does not require winget." -ForegroundColor White
    Write-Host "   - Script already tried GitHub zip as Method 3 automatically." -ForegroundColor White
    Write-Host ""

    Write-Host "5. sshd installed but won't start:" -ForegroundColor Cyan
    Write-Host "   - Check service status: Get-Service sshd" -ForegroundColor Yellow
    Write-Host "   - Try starting: Start-Service sshd" -ForegroundColor Yellow
    Write-Host "   - View error events: Get-WinEvent -LogName Application -MaxEvents 20 | Where ProviderName -eq 'sshd'" -ForegroundColor Yellow
    Write-Host "   - Reboot and re-run this script (it is idempotent)." -ForegroundColor White
    Write-Host ""

    Write-Host "6. Firewall blocking port 22:" -ForegroundColor Cyan
    Write-Host "   - Verify rule: Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'" -ForegroundColor Yellow
    Write-Host "   - Enable if disabled: Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'" -ForegroundColor Yellow
    Write-Host "   - Or check Windows Defender Firewall in Control Panel." -ForegroundColor White
    Write-Host ""

    Write-Host "7. Key / ACL problem (key present but SSH refuses it):" -ForegroundColor Cyan
    Write-Host "   - Admin accounts need key in:" -ForegroundColor White
    Write-Host "     $env:ProgramData\ssh\administrators_authorized_keys" -ForegroundColor Yellow
    Write-Host "   - That file must have ONLY Administrators + SYSTEM (no user/Everyone):" -ForegroundColor White
    Write-Host "     icacls `"$env:ProgramData\ssh\administrators_authorized_keys`" /inheritance:r /grant `"Administrators:F`" /grant `"SYSTEM:F`"" -ForegroundColor Yellow
    Write-Host "   - Standard user accounts: key goes in %USERPROFILE%\.ssh\authorized_keys (normal perms OK)." -ForegroundColor White
    Write-Host ""

    Write-Host "8. Pending reboot required (FoD installed but sshd not found):" -ForegroundColor Cyan
    Write-Host "   - Reboot syme, then re-run this script." -ForegroundColor White
    Write-Host "   - Script is idempotent — it skips completed steps." -ForegroundColor White
    Write-Host ""

    Write-Host "===== END REMEDIATION LIST =====" -ForegroundColor Magenta
    Write-Host ""
}

# ── Log file reminder ──────────────────────────────────────────────────────────
Write-Host "Full log saved to: $LogFile" -ForegroundColor Cyan
Write-Host "Paste it to Claude if anything failed." -ForegroundColor Cyan
Write-Host ""

try { Stop-Transcript } catch {}
