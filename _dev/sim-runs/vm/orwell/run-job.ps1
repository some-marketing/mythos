# run-job.ps1 -- run one bounded experiment in the ant-world guest.
#
# The whole cycle, host-initiated end to end:
#   1. prove VM off, detach courier, mount it on the host
#   2. write the job spec, clear previous output
#   3. dismount, re-attach, start the VM
#   4. host-side watchdog forcibly stops an overrun guest
#   5. guest powers itself off when done
#   6. detach + mount courier, harvest results, verify manifest
#
# There is no channel to the running guest. Cancellation before start is
# honoured via a CANCEL file; once the guest is running the only stop available
# is the absolute one, Stop-VM.

param(
  [Parameter(Mandatory=$true)][string]$RunName,
  # sim   = run the carriage driver (default)
  # turn  = run the attended world driver for one bounded exploratory turn
  # tests = run the engine test suite, for host/guest parity comparison
  [ValidateSet('sim','turn','tests')][string]$Mode = 'sim',
  [string]$DeadlineIso,
  [int]$EpisodeRounds  = 60,
  [int]$MaxEpisodes    = 5,
  [int]$Replicates     = 2,
  [int]$Ticks          = 3000,
  # MODE=turn only. Names a guest-local checkpoint generation directory
  # (gen-<absolute_day>-<run_name>) for the turn driver to continue from. The
  # value is written into job.env verbatim -- this script does not and cannot
  # verify it, because the generation lives inside the guest and there is no
  # channel to the running guest. If it does not validate, the driver halts the
  # turn and returns resume-failed-halt:<stage>:<reason> in STATUS rather than
  # silently starting fresh.
  [string]$ResumeFrom,
  # MODE=turn only. Explicit root seed for the run's RNG lineage. Left empty,
  # the driver draws one from the OS CSPRNG and records it in the checkpoint --
  # never from the wall clock, so no turn's behaviour depends on when it ran.
  [string]$RootSeed,
  [int]$WatchdogMinutes = 60
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$VMName = 'ant-world'
$Root   = 'D:\HyperV\AntWorld'

if (-not $DeadlineIso) {
  # The driver refuses to run unattended without a wall-clock bound; default to
  # the watchdog horizon minus a margin so the guest stops itself first.
  $DeadlineIso = (Get-Date).ToUniversalTime().AddMinutes($WatchdogMinutes - 5).ToString("yyyy-MM-ddTHH:mm:ssZ")
}
if ($Mode -eq 'turn' -and $Ticks -lt 1) { throw 'Ticks must be >= 1 for MODE=turn' }
if ($ResumeFrom -and $Mode -ne 'turn') { throw 'ResumeFrom applies to MODE=turn only' }
if ($RootSeed   -and $Mode -ne 'turn') { throw 'RootSeed applies to MODE=turn only' }
# job.env is sourced by bash in the guest, so a value containing whitespace, a
# newline or a quote would either break the parse or inject a second variable.
# Refuse here rather than shipping a malformed spec into a guest with no channel
# back out of it.
if ($ResumeFrom -and $ResumeFrom -notmatch '^gen-[0-9]+-[A-Za-z0-9._-]+$') {
  throw "REFUSING: ResumeFrom '$ResumeFrom' is not a generation id of the form gen-<absolute_day>-<run_name>"
}
if ($RootSeed -and $RootSeed -notmatch '^[0-9]+$') {
  throw "REFUSING: RootSeed '$RootSeed' is not a non-negative integer"
}
# ---------------------------------------------------------------------------
# PRECONDITION: the golden baseline must exist before any experiment runs.
#
# Without this, a sequence error (running a job before seal-golden) starts a
# guest with no baseline to revert to, so a run that dirties the image leaves
# nothing to restore from. Fail closed on the ordering, the same way the
# create-only provisioner fails closed on clobbering.
# ---------------------------------------------------------------------------
$goldenDir  = Join-Path $Root 'Golden'
$exports    = @(Get-ChildItem -LiteralPath $goldenDir -Directory -ErrorAction SilentlyContinue)
$checkpoints = @(Get-VMSnapshot -VMName $VMName -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -like 'golden-*' })
if ($exports.Count -eq 0 -and $checkpoints.Count -eq 0) {
  throw "REFUSING: no golden baseline exists (no export under $goldenDir and no golden-* checkpoint). Run seal-golden.ps1 first -- an experiment with nothing to revert to is not a bounded experiment."
}
"golden baseline: $($checkpoints.Count) checkpoint(s), $($exports.Count) export(s)"

"run          : $RunName"
"deadline     : $DeadlineIso"
"watchdog     : $WatchdogMinutes minutes"

# --- 1..2 load the job spec -------------------------------------------------
"=== LOAD JOB SPEC ==="
Detach-Courier
$dl = Mount-Courier
try {
  # Clear prior output so results can never be confused between runs -- but
  # preserve the provisioning evidence, which describes the IMAGE rather than
  # any one run. Wiping it made a re-provision unverifiable after the fact.
  $outDir = Join-Path $dl 'out'
  $keep = @{}
  foreach ($f in @('bootstrap.log','BOOTSTRAP-RC','BOOTSTRAP-STARTED','provision-report.txt')) {
    $p = Join-Path $outDir $f
    if (Test-Path $p) { $keep[$f] = Get-Content $p -Raw }
  }
  if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  foreach ($k in $keep.Keys) {
    Set-Content -LiteralPath (Join-Path $outDir $k) -Value $keep[$k] -NoNewline
  }
  if ($keep.Count -gt 0) { "preserved provisioning evidence: $($keep.Keys -join ', ')" }
  $cancelPath = Join-Path $dl 'CANCEL'
  if (Test-Path $cancelPath) { Remove-Item $cancelPath -Force }

  # LF endings: this file is sourced by bash in the guest.
  $job = "RUN_NAME=$RunName`nMODE=$Mode`nDEADLINE_ISO=$DeadlineIso`nEPISODE_ROUNDS=$EpisodeRounds`nMAX_EPISODES=$MaxEpisodes`nREPLICATES=$Replicates`nTICKS=$Ticks`n"
  # Written verbatim, and only when supplied: an empty RESUME_FROM line would
  # be indistinguishable in the guest from an absent one, and the guest reads
  # "absent" as an explicit fresh start, so emitting an empty value would make
  # the spec say less than nothing.
  if ($ResumeFrom) { $job += "RESUME_FROM=$ResumeFrom`n" }
  if ($RootSeed)   { $job += "ROOT_SEED=$RootSeed`n" }
  $jobEnvPath = Join-Path $dl 'job.env'
  [IO.File]::WriteAllText($jobEnvPath, $job, (New-Object Text.UTF8Encoding $false))
  "job.env written:"
  Get-Content $jobEnvPath
} finally { Dismount-Courier }

# --- 3 attach and start -----------------------------------------------------
"=== START GUEST ==="
Attach-Courier
"network adapters (MUST be 0): " + (@(Get-VMNetworkAdapter -VMName $VMName).Count)
if ((@(Get-VMNetworkAdapter -VMName $VMName)).Count -ne 0) { throw "REFUSING to start: VM has a network adapter" }

Start-VM -Name $VMName
$started = Get-Date
"started $($started.ToUniversalTime().ToString('o'))"

# --- 4 watchdog -------------------------------------------------------------
"=== WATCHDOG ==="
$deadline = $started.AddMinutes($WatchdogMinutes)
$forced = $false
while ($true) {
  $vm = Get-VM -Name $VMName
  if ($vm.State -eq 'Off') { "guest powered off cleanly after $([int]((Get-Date)-$started).TotalSeconds)s"; break }
  if ((Get-Date) -gt $deadline) {
    "WATCHDOG EXPIRED after $WatchdogMinutes min -- forcing stop"
    Stop-VM -Name $VMName -TurnOff -Force
    $forced = $true
    break
  }
  Start-Sleep -Seconds 10
}
"forced-stop: $forced"

# --- 5..6 harvest -----------------------------------------------------------
"=== HARVEST ==="
& (Join-Path $PSScriptRoot 'harvest-results.ps1') -RunName $RunName
