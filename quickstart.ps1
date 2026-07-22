# quickstart.ps1 — one-command setup for Mythos (Windows PowerShell)
#
# Run this from the repo root:
#     powershell -ExecutionPolicy Bypass -File .\quickstart.ps1
#
# It wraps the normal setup flow (npm install + npm run setup) so a beginner can
# get going with a single command. It never installs Node.js for you — if Node is
# missing it points you at the official download and stops. Safe to run again.

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host 'Setting up Mythos...'
Write-Host ''

# Must be run from the repo root (where package.json lives).
if (-not (Test-Path 'package.json')) {
    Write-Host "I can't find package.json in this folder, so I'm probably not in the project root."
    Write-Host "Open the repo folder first, then re-run me. For example:"
    Write-Host ''
    Write-Host '    cd learning-language-models'
    Write-Host '    powershell -ExecutionPolicy Bypass -File .\quickstart.ps1'
    Write-Host ''
    exit 1
}

# 1. Node.js — required. We check, we do NOT install it for you.
$nodeVersion = $null
try {
    $nodeVersion = (& node --version) 2>$null
} catch {
    $nodeVersion = $null
}

if (-not $nodeVersion) {
    Write-Host "Node.js isn't installed yet (or isn't on your PATH)."
    Write-Host ''
    Write-Host '  1. Go to https://nodejs.org'
    Write-Host '  2. Download the version labelled LTS (the stable one).'
    Write-Host '  3. Run the installer with all the default options.'
    Write-Host '  4. Restart this window and run me again.'
    Write-Host ''
    Write-Host "That's the only thing you need to install by hand. Once Node is there, this script handles the rest."
    exit 1
}
Write-Host "  Found Node.js $nodeVersion"

# 2. npm — ships with Node, but confirm it's reachable.
$npmVersion = $null
try {
    $npmVersion = (& npm --version) 2>$null
} catch {
    $npmVersion = $null
}

if (-not $npmVersion) {
    Write-Host "Node.js is here, but npm isn't reachable. npm normally installs alongside Node.js."
    Write-Host "Try reinstalling Node.js from https://nodejs.org (LTS), then run me again."
    exit 1
}
Write-Host "  Found npm $npmVersion"
Write-Host ''

# 3. Install dependencies.
Write-Host 'Installing dependencies (npm install)...'
& npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "npm install ran into a problem (exit code $LASTEXITCODE)."
    Write-Host "Scroll up for the details. You can copy the red text and ask your AI assistant what it means, then run me again."
    exit 1
}
Write-Host ''

# 4. Run the friendly first-run setup check.
Write-Host 'Running the setup check (npm run setup)...'
& npm run setup
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "Setup finished with items to resolve (exit code $LASTEXITCODE)."
    Write-Host "Read the notes above — they tell you exactly what to fix. Then run me again."
    exit 1
}

# 5. Done — point them at the next step.
Write-Host ''
Write-Host "You're set up. Here's your first run:"
Write-Host ''
Write-Host '  1. Open this folder in your AI coding assistant (Claude Code, Cursor, Codex, OpenCode).'
Write-Host '  2. Read the "Your first quest" section in QUICKSTART.md, then just ask'
Write-Host '     the assistant in plain English to cast a Silver-rank (or higher) grimoire for you.'
Write-Host '  3. When you want to know why a SECOND, different mind should review the work,'
Write-Host '     read docs/GUILD-CHARTER.md.'
Write-Host ''
Write-Host 'Welcome aboard.'
exit 0
