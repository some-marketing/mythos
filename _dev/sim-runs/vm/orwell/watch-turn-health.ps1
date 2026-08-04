# watch-turn-health.ps1 -- early stall detector for ant-world turns.
#
# A healthy turn burns CPU (the sim computes) or ends (guest powers off).
# The observed failure signature (2026-08-04, twice): guest Running with
# sustained 0% CPU and no courier STATUS -- the runner never started. That
# signature is readable within minutes; without this watcher it costs the
# full watchdog hour to notice.
#
# Read-only: samples Get-VM only. Never mutates the VM or the courier.
#
# Exit codes:
#   0 = turn ended (VM reached Off) while watching
#   2 = STALL VERDICT: sustained idle beyond the grace window
#   3 = still healthy/computing when MaxMinutes elapsed (keep waiting)
#
# Usage: psrunfile.sh watch-turn-health.ps1 [-GraceSeconds 180]
#        [-IdleSamplesForStall 8] [-SampleSeconds 15] [-MaxMinutes 20]

param(
  [int]$GraceSeconds        = 180,
  [int]$IdleSamplesForStall = 8,
  [int]$SampleSeconds       = 15,
  [int]$MaxMinutes          = 20,
  [int]$IdleCpuThreshold    = 1
)

$ErrorActionPreference = 'Stop'
$VMName = 'ant-world'

$deadline  = (Get-Date).AddMinutes($MaxMinutes)
$idleRun   = 0
$sampleNum = 0

while ((Get-Date) -lt $deadline) {
  $vm = Get-VM -Name $VMName
  $sampleNum++
  $up = $vm.Uptime.TotalSeconds
  "sample ${sampleNum}: state=$($vm.State) cpu=$($vm.CPUUsage)% uptime=$([math]::Round($up))s idleRun=$idleRun"

  if ($vm.State -eq 'Off') {
    "TURN ENDED: VM is Off (guest completed or was stopped)."
    exit 0
  }

  if ($up -gt $GraceSeconds) {
    if ($vm.CPUUsage -le $IdleCpuThreshold) { $idleRun++ } else { $idleRun = 0 }
    if ($idleRun -ge $IdleSamplesForStall) {
      $idleFor = $idleRun * $SampleSeconds
      "STALL VERDICT: sustained <=$IdleCpuThreshold% CPU for ${idleFor}s past the ${GraceSeconds}s boot grace."
      "Matches the runner-never-started signature (2026-08-04). Recommended: stop the VM and inspect instead of waiting for the watchdog."
      exit 2
    }
  }

  Start-Sleep -Seconds $SampleSeconds
}

"HEALTHY-OR-UNKNOWN: watched $MaxMinutes min without a stall verdict; turn may be legitimately computing."
exit 3
