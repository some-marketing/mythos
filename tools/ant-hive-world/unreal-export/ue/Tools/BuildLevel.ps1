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
    [int]$TimeoutSeconds = 1800
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
$proc = Start-Process -FilePath $editor -ArgumentList $argList -NoNewWindow -PassThru `
    -RedirectStandardOutput $runLog -RedirectStandardError "$runLog.err"
$null = $proc.Handle   # cache the handle so .ExitCode is readable after exit
if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
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
