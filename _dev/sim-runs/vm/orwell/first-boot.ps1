# first-boot.ps1 -- run the one provisioning boot between provision-vm and seal-golden.
# The guest boots from the CIDATA seed, cloud-init provisions (node from courier,
# job-runner systemd unit, nftables-free by design), then powers itself off.
# This script starts the VM and waits for that self-poweroff, with a hard timeout.
$ErrorActionPreference = 'Stop'
$VMName  = 'ant-world'
$Timeout = (Get-Date).AddMinutes(20)

$vm = Get-VM -Name $VMName
if ($vm.State -ne 'Off') { throw "REFUSING: VM is '$($vm.State)', expected Off before first boot" }
$na = @(Get-VMNetworkAdapter -VMName $VMName)
if ($na.Count -ne 0) { throw "REFUSING: VM has $($na.Count) network adapter(s)" }
"network adapters: 0 (verified pre-boot)"

# The courier MUST be attached: provisioning reads node and the payload from it.
# Diagnostic scripts detach it to read it host-side, and a boot without it fails
# silently -- cloud-init still reaches power_state and powers off, so the guest
# looks like it provisioned when it did nothing. Fail closed instead.
$courierPath = 'D:\HyperV\AntWorld\Disks\ant-world-courier.vhdx'
$attached = Get-VMHardDiskDrive -VMName $VMName | Where-Object { $_.Path -eq $courierPath }
if (-not $attached) {
  throw "REFUSING: courier is not attached to $VMName. Run attach-courier.ps1 first -- a provisioning boot without it fails silently."
}
"courier attached at 0/$($attached.ControllerLocation) (verified pre-boot)"

# The CIDATA seed is the cloud-init datasource. seal-golden detaches it (B4), so
# after a seal a provisioning boot without it does nothing at all while still
# reporting success. refresh-seed.ps1 re-attaches it; this refuses if it did not.
$seedPath = 'D:\HyperV\AntWorld\Disks\ant-world-seed.vhdx'
$seedAttached = Get-VMHardDiskDrive -VMName $VMName | Where-Object { $_.Path -eq $seedPath }
if (-not $seedAttached) {
  throw "REFUSING: CIDATA seed is not attached to $VMName. Without it cloud-init has no datasource, so provisioning silently does nothing. Run refresh-seed.ps1 first."
}
"CIDATA seed attached at 0/$($seedAttached.ControllerLocation) (verified pre-boot)"

# Clear any leftover job spec before a provisioning boot. The guest also
# consumes job.env on read, but a guest provisioned from an older image may not,
# and a provisioning boot should never execute an experiment as a side effect.
. (Join-Path $PSScriptRoot 'courier-lib.ps1')
Detach-Courier | Out-Null
$dl = Mount-Courier
try {
  foreach ($f in @('job.env','CANCEL')) {
    if (Test-Path "${dl}:\$f") { Remove-Item "${dl}:\$f" -Force; "cleared stale ${f} from courier" }
  }
  # CODE REVIEW (PR #12, codex P1 round 7): a previous successful provisioning
  # leaves BOOTSTRAP-RC and provision-report.txt on the courier. On a refresh
  # boot where cloud-init fails to rerun (or bootstrap fails before writing
  # them), the stale receipts would satisfy the post-boot verification and let
  # a broken image be sealed. Delete them so only freshly generated evidence
  # can pass.
  foreach ($f in @('BOOTSTRAP-RC','provision-report.txt')) {
    if (Test-Path "${dl}:\out\$f") { Remove-Item "${dl}:\out\$f" -Force; "cleared stale ${f} from courier out/" }
  }
} finally { Dismount-Courier | Out-Null }
Attach-Courier | Out-Null

"=== FIRST BOOT (provisioning; guest powers itself off when done) ==="
Start-VM -Name $VMName
while ((Get-VM -Name $VMName).State -ne 'Off') {
  if ((Get-Date) -gt $Timeout) {
    Stop-VM -Name $VMName -TurnOff -Force
    throw "TIMEOUT: provisioning boot exceeded 20 minutes; VM force-stopped. Inspect before retrying."
  }
  Start-Sleep -Seconds 15
}
"PROVISIONING BOOT COMPLETE: VM is Off"
$na2 = @(Get-VMNetworkAdapter -VMName $VMName)
"network adapters after boot: $($na2.Count) (must be 0)"
if ($na2.Count -ne 0) { throw "FAIL: adapter appeared during provisioning" }

# CODE REVIEW (PR #12, codex P1 round 5): cloud-init's power_state powers the
# guest off unconditionally, so VM Off alone does NOT prove provisioning
# succeeded -- a failed payload extraction or runtime install still ends Off.
# Require the guest's own BOOTSTRAP-RC == 0 and the provision report before
# declaring provisioning complete, else seal-golden.ps1 could preserve a
# broken baseline as golden.
Detach-Courier
$dl = Mount-Courier -ReadOnly
try {
  if (-not (Test-Path "${dl}:\out\BOOTSTRAP-RC")) {
    throw "FAIL: no BOOTSTRAP-RC on courier -- provisioning did not report a result; refusing to treat boot as complete"
  }
  $bootRc = (Get-Content "${dl}:\out\BOOTSTRAP-RC" -Raw).Trim()
  if ($bootRc -ne '0') {
    throw "FAIL: bootstrap exit code '$bootRc' (expected 0) -- provisioning failed; do NOT seal a broken baseline"
  }
  if (-not (Test-Path "${dl}:\out\provision-report.txt")) {
    throw "FAIL: provision-report.txt missing -- provisioning evidence incomplete"
  }
  "bootstrap verified: BOOTSTRAP-RC=0, provision-report.txt present"
} finally { Dismount-Courier }
