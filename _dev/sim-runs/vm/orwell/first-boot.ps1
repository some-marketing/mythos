# first-boot.ps1 -- run the one provisioning boot between provision-vm and seal-golden.
# The guest boots from the CIDATA seed, cloud-init provisions (node from courier,
# job-runner systemd unit, nftables-free by design), then powers itself off.
# This script starts the VM and waits for that self-poweroff, with a hard timeout.
#
# -ExpectedSha256 is mandatory: this is the last host-side chance to catch a
# stale courier payload before an up-to-20-minute boot is spent provisioning
# from it. Verified during the existing pre-boot courier touch below.
param(
  [Parameter(Mandatory = $true)][string]$ExpectedSha256
)

# Validate the shape of -ExpectedSha256 before touching the VM or courier at
# all: this is the last host-side gate before a 20-minute boot, so a
# malformed hash must fail immediately and specifically here rather than
# surface later as a confusing hash-mismatch against whatever the courier
# happens to hold.
if ($ExpectedSha256.Trim() -notmatch '^[0-9a-fA-F]{64}$') {
  throw "REFUSING: -ExpectedSha256 '$ExpectedSha256' is not a 64-character hex sha256 digest."
}

$ErrorActionPreference = 'Stop'
$VMName  = 'ant-world'
$Timeout = (Get-Date).AddMinutes(20)
$ExpectedSha256 = $ExpectedSha256.Trim().ToLower()

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
#
# The same touch also asserts the payload actually on the courier is the one
# the caller intended to provision from -- fail closed here, before the boot,
# rather than discover after a 20-minute timeout that a stale archive was used.
. (Join-Path $PSScriptRoot 'courier-lib.ps1')
Detach-Courier | Out-Null
$dl = Mount-Courier
try {
  if ($dl -notmatch '^[A-Za-z]:\\$') {
    throw "REFUSING: Mount-Courier returned '$dl', not a rooted drive path (expected e.g. 'F:\'). Refusing to touch an unverified path."
  }
  if (-not (Test-Path -LiteralPath $dl)) {
    throw "REFUSING: mounted courier path '$dl' does not exist on disk."
  }
  foreach ($f in @('job.env','CANCEL')) {
    $p = Join-Path $dl $f
    if (Test-Path $p) { Remove-Item $p -Force; "cleared stale ${f} from courier" }
  }

  $courierPayloads = @(Get-ChildItem -LiteralPath $dl -Filter 'antworld-payload-*.tar.gz' -Force -ErrorAction SilentlyContinue)
  if ($courierPayloads.Count -eq 0) { throw "REFUSING: no payload archive found on courier; run load-courier.ps1 first" }
  if ($courierPayloads.Count -gt 1) { throw "REFUSING: multiple payload archives found on courier ($($courierPayloads.Name -join ', ')); load-courier.ps1 should leave exactly one" }
  $courierPayload = $courierPayloads[0]
  $courierHash = (Get-FileHash -LiteralPath $courierPayload.FullName -Algorithm SHA256).Hash.ToLower()
  "courier payload: $($courierPayload.Name) sha256=$courierHash"
  if ($courierHash -ne $ExpectedSha256) {
    throw "REFUSING: courier payload '$($courierPayload.Name)' (sha256=$courierHash) does not match -ExpectedSha256 ($ExpectedSha256). The courier may hold a stale archive -- run load-courier.ps1 with the same -ExpectedSha256 before retrying first-boot."
  }
  "courier payload verified against -ExpectedSha256 (pre-boot)"
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
