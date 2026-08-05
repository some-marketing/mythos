# BuildLevel.ps1 -- headless level build for the ant-hive-world projection.
#
# Runs UnrealEditor-Cmd.exe against AntWorldProjection.uproject, executes
# Content/Python/build_world.py against one UnrealImport/1.0 file, and prints
# the evidence markers plus the JSON build report.
#
# Host footprint: reads the installed engine, writes only under
# D:\UnrealProjects\AntWorldProjection. Touches nothing under D:\HyperV.
#
#   powershell -NoProfile -File Tools\BuildLevel.ps1 -Import <path-to.json>
#   powershell -NoProfile -File Tools\BuildLevel.ps1 -Import <...> -NullRHI

[CmdletBinding()]
param(
    [string]$Import = '',
    [string]$ProjectRoot = 'D:\UnrealProjects\AntWorldProjection',
    [string]$EngineRoot = 'C:\Program Files\Epic Games\UE_5.8',
    [switch]$NullRHI,
    [int]$TimeoutSeconds = 1800,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$editor = Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$uproject = Join-Path $ProjectRoot 'AntWorldProjection.uproject'
$script = Join-Path $ProjectRoot 'Content\Python\build_world.py'
$savedDir = Join-Path $ProjectRoot 'Saved'
$report = Join-Path $savedDir 'antworld_build_report.json'
$runLog = Join-Path $savedDir 'antworld_headless.log'

foreach ($p in @($editor, $uproject, $script)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "missing: $p" }
}

# --- best-effort interactive-editor concurrency guard -----------------------
#
# build_world.py destroys every existing level actor (open_blank_level) and
# respawns the whole level from scratch. There is no engine-level lock
# preventing that from running concurrently with an interactive
# UnrealEditor.exe session that has the same project open -- doing so can
# clobber in-progress edits in the open session. This is a best-effort
# heuristic, not a hard guarantee (a session with no visible window, or a
# stale lock file, can still evade it) -- pass -Force once you've confirmed
# by hand that it's safe to proceed anyway.
function Test-InteractiveEditorHoldingProject {
    param([string]$ProjectRoot, [string]$ProjectName)

    # 1) An interactive UnrealEditor.exe (never UnrealEditor-Cmd.exe, which is
    #    what this script itself launches) whose main window title names
    #    this project.
    $editorProcs = Get-Process -Name 'UnrealEditor' -ErrorAction SilentlyContinue
    foreach ($proc in $editorProcs) {
        $title = $proc.MainWindowTitle
        if ($title -and ($title -like "*$ProjectName*")) {
            return "interactive UnrealEditor.exe (pid $($proc.Id)) has a window titled '$title'"
        }
    }
    if ($editorProcs) {
        $first = $editorProcs | Select-Object -First 1
        return "UnrealEditor.exe (pid $($first.Id)) is running but its window title doesn't confirm the project (still loading?) -- treating as a possible concurrent session"
    }

    # 2) Best-effort lock marker: a recently touched *.lock file under
    #    Saved\ (the exact filename Unreal writes while a project is open is
    #    engine-version dependent, so this checks broadly rather than for one
    #    fixed name).
    $savedDir = Join-Path $ProjectRoot 'Saved'
    if (Test-Path -LiteralPath $savedDir) {
        $recentLocks = Get-ChildItem -Path $savedDir -Filter '*.lock' -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-10) }
        if ($recentLocks) {
            $lock = $recentLocks | Select-Object -First 1
            return "recent lock file under $savedDir : $($lock.FullName) (written $($lock.LastWriteTime))"
        }
    }

    return $null
}

$projectName = [System.IO.Path]::GetFileNameWithoutExtension($uproject)
$editorGuardReason = Test-InteractiveEditorHoldingProject -ProjectRoot $ProjectRoot -ProjectName $projectName
if ($editorGuardReason) {
    if (-not $Force) {
        "ANTWORLD_HOST_EDITOR_GUARD=REFUSED: $editorGuardReason -- an interactive editor session appears to hold this project. This script destroys and respawns every level actor; running it against a live editor session can corrupt in-progress edits. Re-run with -Force once you've confirmed by hand that it's safe to proceed."
        exit 4
    }
    "ANTWORLD_HOST_EDITOR_GUARD=OVERRIDDEN ($editorGuardReason) -- -Force passed, proceeding anyway"
}

New-Item -ItemType Directory -Force -Path $savedDir | Out-Null
Remove-Item -LiteralPath $report -ErrorAction SilentlyContinue

if (-not $Import) {
    $candidate = Get-ChildItem -Path (Join-Path $ProjectRoot 'Imports') -Filter '*.json' -ErrorAction SilentlyContinue |
        Sort-Object Name | Select-Object -Last 1
    if (-not $candidate) { throw 'no import file found in Imports\' }
    $Import = $candidate.FullName
}
if (-not (Test-Path -LiteralPath $Import)) { throw "missing import: $Import" }

"ANTWORLD_HOST_IMPORT=$Import"
"ANTWORLD_HOST_ENGINE=$EngineRoot"

$argList = @(
    "`"$uproject`"",
    "-ExecutePythonScript=`"$script $Import`"",
    '-unattended', '-nosplash', '-nop4', '-NoLogTimes', '-stdout',
    '-FullStdOutLogOutput', '-NoSound'
)
if ($NullRHI) { $argList += '-nullrhi' }

$started = Get-Date
$timedOut = $false
$proc = Start-Process -FilePath $editor -ArgumentList $argList -NoNewWindow -PassThru `
    -RedirectStandardOutput $runLog -RedirectStandardError "$runLog.err"
$null = $proc.Handle   # cache the handle so .ExitCode is readable after exit
if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
    $timedOut = $true
    try { $proc.Kill() } catch { }
    "ANTWORLD_HOST_TIMEOUT=$TimeoutSeconds"
}
$proc.WaitForExit()   # flush async state so ExitCode is populated
$elapsed = [int]((Get-Date) - $started).TotalSeconds
"ANTWORLD_HOST_EXITCODE=$($proc.ExitCode)"
"ANTWORLD_HOST_ELAPSED_S=$elapsed"

"---- ANTWORLD markers ----"
Select-String -Path $runLog -Pattern 'ANTWORLD' -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Line }

"---- errors (last 40) ----"
Select-String -Path $runLog -Pattern 'Error:|Fatal|Exception|Traceback' -ErrorAction SilentlyContinue |
    Select-Object -Last 40 | ForEach-Object { $_.Line }
if (Test-Path -LiteralPath "$runLog.err") {
    "---- stderr ----"
    Get-Content -LiteralPath "$runLog.err" -Tail 40
}

"---- report ----"
if (Test-Path -LiteralPath $report) {
    Get-Content -LiteralPath $report -Raw
    "ANTWORLD_HOST_REPORT_PRESENT=True"
} else {
    "ANTWORLD_HOST_REPORT_PRESENT=False"
}

$umap = Join-Path $ProjectRoot 'Content\AntWorld\Maps\AntWorld.umap'
"ANTWORLD_HOST_UMAP=$umap"
"ANTWORLD_HOST_UMAP_PRESENT=" + (Test-Path -LiteralPath $umap)
if (Test-Path -LiteralPath $umap) {
    "ANTWORLD_HOST_UMAP_BYTES=" + (Get-Item -LiteralPath $umap).Length
}

if ($timedOut) {
    # Previously this fell through to an implicit (successful) exit even
    # though the editor process had to be killed mid-run -- a caller relying
    # on the exit code (e.g. watch-imports.js --deploy) would treat a
    # timed-out, killed build as a successful deploy. Make it an explicit,
    # unambiguous failure instead.
    "ANTWORLD_HOST_TIMEOUT_RESULT=TIMEOUT after ${TimeoutSeconds}s -- UnrealEditor-Cmd.exe was killed; treating this run as FAILED regardless of any partial report/umap state above"
    exit 3
}
