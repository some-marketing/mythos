# Mythos: Hello Dolly Automation Script
#
# This script automates the manifestation of the 'Recursive Command Mirror'.
# It handles session-jumping to bypass Session 0 isolation on Windows.

$MirrorImagePath = "C:\Users\taylo\Pictures\composite-truth-mirror.png"
$PsExecPath = "C:\Users\taylo\Downloads\PSTools\PsExec64.exe"

# 1. Detect Active Interactive Session
Write-Host "Detecting active interactive session..." -ForegroundColor Cyan
$sessionInfo = quser | Select-String "Active"
if ($sessionInfo -match "\s+(\d+)\s+Active") {
    $sessionId = $matches[1]
    Write-Host "Detected active session: $sessionId" -ForegroundColor Green
} else {
    Write-Host "No active session detected. Falling back to session 5." -ForegroundColor Yellow
    $sessionId = 5
}

# 2. Check for image
if (-not (Test-Path $MirrorImagePath)) {
    Write-Host "Error: Mirror image not found at $MirrorImagePath" -ForegroundColor Red
    exit 1
}

# 3. Trigger Manifestation via PsExec
Write-Host "Manifesting the Mirror in session $sessionId..." -ForegroundColor Magenta
& $PsExecPath /accepteula -i $sessionId -d explorer.exe $MirrorImagePath

Write-Host "Hello Dolly! Manifestation complete." -ForegroundColor Green
