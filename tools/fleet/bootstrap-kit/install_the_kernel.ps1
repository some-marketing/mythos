# =============================================================================
# PROVENANCE: copied verbatim from thumbdrive /Volumes/BIOS/install_the_kernel.ps1
# Canonical repo home: tools/fleet/bootstrap-kit/install_the_kernel.ps1
# Date imported: 2026-06-22
#
# KNOWN BUG — UTF-16 passphrase pipe on Windows PowerShell 5 (do NOT fix here):
#   Line: $Passphrase | & gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 ...
#   In Windows PowerShell 5, piping a string to an external process encodes it
#   as UTF-16LE, which gpg's --passphrase-fd reader rejects → "Bad session key".
#   WORKAROUND (Rupert): run the decrypt/extract steps through Git Bash instead
#   of native PowerShell 5.
#   PERMANENT FIX (not yet applied): upgrade to PowerShell 7 (pwsh), which pipes
#   UTF-8 by default, OR write the passphrase to a temp file and pass
#   --passphrase-file instead of --passphrase-fd 0.
#   A separate gated step will apply the fix. Do NOT alter the decrypt logic here.
# =============================================================================
param(
  [string]$BundleName = $env:SMOS_KERNEL_BUNDLE_NAME,
  [string]$PassphraseRef = $env:SMOS_KERNEL_PASSPHRASE_REF,
  [string]$TargetSmos = $env:SMOS_KERNEL_TARGET,
  [string]$TargetMemory = $env:SMOS_KERNEL_MEMORY_TARGET
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BundleName)) {
  $BundleName = "the_kernel.tar.gz.gpg"
}
if ([string]::IsNullOrWhiteSpace($PassphraseRef)) {
  $PassphraseRef = "op://Personal/the_kernel/password"
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundlePath = Join-Path $ScriptDir $BundleName
$ChecksumPath = Join-Path $ScriptDir "$BundleName.sha256"
$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("smos-kernel-install-" + [System.Guid]::NewGuid().ToString("N"))

function Fail($Message) {
  Write-Error $Message
  exit 1
}

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "Missing required command: $Name"
  }
}

function Remove-WorkDir {
  if (Test-Path $WorkDir) {
    Remove-Item -Recurse -Force $WorkDir
  }
}

try {
  Write-Host ""
  Write-Host "Mythos Kernel Installer"
  Write-Host "======================"
  Write-Host ""
  Write-Host "This installs the encrypted Mythos kernel bundle onto this machine."
  Write-Host "It works on Windows PowerShell and PowerShell Core when dependencies are installed."
  Write-Host "It does not store the passphrase on this flash drive."
  Write-Host ""

  if (-not (Test-Path $BundlePath)) { Fail "Encrypted bundle not found: $BundlePath" }
  if (-not (Test-Path $ChecksumPath)) { Fail "Checksum file not found: $ChecksumPath" }

  Require-Command "op"
  Require-Command "gpg"
  Require-Command "tar"

  Write-Host "Bundle:   $BundlePath"
  Write-Host "Checksum: $ChecksumPath"
  Write-Host "Password: $PassphraseRef"
  Write-Host ""

  $Confirm = Read-Host "Install the Mythos kernel on this machine? [y/N]"
  if ($Confirm -notmatch "^(y|yes)$") {
    Write-Host "Install cancelled."
    exit 0
  }

  & op whoami *> $null
  if ($LASTEXITCODE -ne 0) {
    Fail "1Password CLI is not signed in. Install/sign into the 1Password desktop app, enable CLI integration, run 'op signin' and confirm 'op whoami' works, then run this installer again."
  }

  $ExpectedHash = ((Get-Content $ChecksumPath -TotalCount 1) -split "\s+")[0].Trim().ToLowerInvariant()
  $ActualHash = (Get-FileHash -Algorithm SHA256 $BundlePath).Hash.ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($ExpectedHash) -or $ExpectedHash -ne $ActualHash) {
    Fail "Checksum verification failed."
  }
  Write-Host "Checksum verification passed."
  Write-Host ""

  if ([string]::IsNullOrWhiteSpace($TargetSmos)) {
    $TargetSmos = Read-Host "Mythos repo path"
  }
  if ([string]::IsNullOrWhiteSpace($TargetSmos)) {
    Fail "Mythos repo path is required."
  }
  $TargetSmos = $TargetSmos.TrimEnd("\", "/")
  if (-not (Test-Path $TargetSmos)) {
    Fail "Target Mythos directory does not exist: $TargetSmos"
  }

  if ([string]::IsNullOrWhiteSpace($TargetMemory)) {
    $DefaultMemory = Join-Path $HOME ".claude\projects\-Users-admin-Documents-GitHub-mythos\memory\MEMORY.md"
    $MemoryInput = Read-Host "Claude memory file path [$DefaultMemory]"
    if ([string]::IsNullOrWhiteSpace($MemoryInput)) {
      $TargetMemory = $DefaultMemory
    } else {
      $TargetMemory = $MemoryInput
    }
  }

  Write-Host ""
  Write-Host "Install target:"
  Write-Host "- Kernel directory: $TargetSmos\_dev\research\{OPERATOR_NAME}-philosophy\"
  Write-Host "- Memory file:      $TargetMemory"
  Write-Host ""

  $FinalConfirm = Read-Host "Proceed with install to these paths? [y/N]"
  if ($FinalConfirm -notmatch "^(y|yes)$") {
    Write-Host "Install cancelled."
    exit 0
  }

  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $ArchivePath = Join-Path $WorkDir "the_kernel.tar.gz"
  $ExtractDir = Join-Path $WorkDir "extract"
  New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null

  $Passphrase = & op read $PassphraseRef
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($Passphrase)) {
    Fail "Unable to read passphrase from 1Password reference: $PassphraseRef"
  }

  $Passphrase | & gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --decrypt --output $ArchivePath $BundlePath
  if ($LASTEXITCODE -ne 0) {
    Fail "gpg decrypt failed."
  }

  & tar -xzf $ArchivePath -C $ExtractDir
  if ($LASTEXITCODE -ne 0) {
    Fail "tar extraction failed."
  }

  $ExtractedKernel = Join-Path $ExtractDir "Mythos\_dev\research\{OPERATOR_NAME}-philosophy"
  $ExtractedMemory = Join-Path $ExtractDir "claude-memory\MEMORY.md"
  if (-not (Test-Path $ExtractedKernel)) {
    Fail "Extracted bundle is missing Mythos/_dev/research/{OPERATOR_NAME}-philosophy"
  }
  if (-not (Test-Path $ExtractedMemory)) {
    Fail "Extracted bundle is missing claude-memory/MEMORY.md"
  }

  $TargetResearch = Join-Path $TargetSmos "_dev\research"
  $TargetKernel = Join-Path $TargetResearch "{OPERATOR_NAME}-philosophy"
  New-Item -ItemType Directory -Force -Path $TargetResearch | Out-Null
  if (Test-Path $TargetKernel) {
    Remove-Item -Recurse -Force $TargetKernel
  }
  Copy-Item -Recurse -Force $ExtractedKernel $TargetKernel

  $TargetMemoryDir = Split-Path -Parent $TargetMemory
  New-Item -ItemType Directory -Force -Path $TargetMemoryDir | Out-Null
  Copy-Item -Force $ExtractedMemory $TargetMemory

  Write-Host ""
  Write-Host "Install complete."
  Write-Host "Plaintext temporary files were removed from the temp directory."
  Write-Host "You can now start an Mythos session from: $TargetSmos"
} finally {
  Remove-WorkDir
}
