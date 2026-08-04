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
  [int]$WatchdogMinutes = 60
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# CODE REVIEW (PR #12, codex P2): $RunName is interpolated unquoted into
# job.env, which the guest sources as root -- whitespace, quotes, newlines, or
# shell metacharacters would be parsed as commands. Restrict it to a safe
# token grammar before it reaches the environment file.
if ($RunName -notmatch '^[A-Za-z0-9][A-Za-z0-9 _-]*$') {
  throw 'RunName [$RunName] contains characters outside [A-Za-z0-9 _-]; refusing to write job.env (it is sourced by Bash as root)'
}
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$VMName = 'ant-world'
$Root   = 'D:\HyperV\AntWorld'

if (-not $DeadlineIso) {
  # The driver refuses to run unattended without a wall-clock bound; default to
  # the watchdog horizon minus a margin so the guest stops itself first.
  $DeadlineIso = (Get-Date).ToUniversalTime().AddMinutes($WatchdogMinutes - 5).ToString("yyyy-MM-ddTHH:mm:ssZ")
}
if ($Mode -eq 'turn' -and $Ticks -lt 1) { throw 'Ticks must be >= 1 for MODE=turn' }
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
  $keep = @{}
  foreach ($f in @('bootstrap.log','BOOTSTRAP-RC','BOOTSTRAP-STARTED','provision-report.txt')) {
    if (Test-Path "${dl}:\out\$f") { $keep[$f] = Get-Content "${dl}:\out\$f" -Raw }
  }
  if (Test-Path "${dl}:\out") { Remove-Item "${dl}:\out" -Recurse -Force }
  New-Item -ItemType Directory -Path "${dl}:\out" -Force | Out-Null
  foreach ($k in $keep.Keys) {
    Set-Content -LiteralPath "${dl}:\out\$k" -Value $keep[$k] -NoNewline
  }
  if ($keep.Count -gt 0) { "preserved provisioning evidence: $($keep.Keys -join ', ')" }
  if (Test-Path "${dl}:\CANCEL") { Remove-Item "${dl}:\CANCEL" -Force }

  # LF endings: this file is sourced by bash in the guest.
  $job = "RUN_NAME=$RunName`nMODE=$Mode`nDEADLINE_ISO=$DeadlineIso`nEPISODE_ROUNDS=$EpisodeRounds`nMAX_EPISODES=$MaxEpisodes`nREPLICATES=$Replicates`nTICKS=$Ticks`n"
  [IO.File]::WriteAllText("${dl}:\job.env", $job, (New-Object Text.UTF8Encoding $false))
  "job.env written:"
  Get-Content "${dl}:\job.env"
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
