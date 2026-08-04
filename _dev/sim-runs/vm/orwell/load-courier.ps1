# load-courier.ps1 -- stage the newest allowlisted payload onto the courier.
#
# The VM must be Off. This is the only host-side hop from D:\HyperV\AntWorld\Staging\In
# to the FAT32 courier used by the guest. It preserves the pinned Node runtime,
# replaces only payload/manifests, and clears stale job/output state.
#
# -ExpectedSha256 is mandatory: the caller must state which payload it intends
# to load. The prior sibling-.sha256 check only proves the staged archive is
# internally consistent with its own checksum file -- it cannot detect that
# the intended NEW archive never arrived and the newest file in Staging\In is
# stale. Verifying against the caller's expected hash closes that gap; the
# sibling-.sha256 check is retained below as a secondary integrity check.
param(
  [Parameter(Mandatory = $true)][string]$ExpectedSha256,
  [string]$ExpectedName
)

# Validate the shape of -ExpectedSha256 before touching the VM or courier at
# all: a malformed hash (truncated paste, wrong arg, stray whitespace beyond
# a simple trim) should fail immediately and specifically, not surface later
# as a confusing hash-mismatch against whatever archive happens to be staged.
if ($ExpectedSha256.Trim() -notmatch '^[0-9a-fA-F]{64}$') {
  throw "REFUSING: -ExpectedSha256 '$ExpectedSha256' is not a 64-character hex sha256 digest."
}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$ExpectedSha256 = $ExpectedSha256.Trim().ToLower()

$VMName = 'ant-world'
$Root = 'D:\HyperV\AntWorld'
$In = Join-Path $Root 'Staging\In'

$vm = Get-VM -Name $VMName
if ($vm.State -ne 'Off') { throw "REFUSING: VM is '$($vm.State)'; courier may only be loaded while Off" }
if (@(Get-VMNetworkAdapter -VMName $VMName).Count -ne 0) { throw 'REFUSING: VM has a network adapter' }

$payloads = @(Get-ChildItem -LiteralPath $In -Filter 'antworld-payload-*.tar.gz' | Sort-Object Name -Descending)
if ($payloads.Count -eq 0) { throw "no payload archive under $In" }
$payload = $payloads[0]
"selected archive: $($payload.Name)  size=$([math]::Round($payload.Length/1MB,2))MB  mtime=$($payload.LastWriteTimeUtc.ToString('o'))"

if ($ExpectedName -and $payload.Name -ne $ExpectedName) {
  throw "REFUSING: newest archive in ${In} is '$($payload.Name)', expected '$ExpectedName'"
}

$sumPath = "$($payload.FullName).sha256"
$manifest = Join-Path $In "$([IO.Path]::GetFileNameWithoutExtension([IO.Path]::GetFileNameWithoutExtension($payload.Name))).MANIFEST.txt"
if (-not (Test-Path -LiteralPath $sumPath)) { throw "checksum missing: $sumPath" }
if (-not (Test-Path -LiteralPath $manifest)) { throw "manifest missing: $manifest" }
$actual = (Get-FileHash -LiteralPath $payload.FullName -Algorithm SHA256).Hash.ToLower()

# PRIMARY check: does the newest staged archive match what the caller intended
# to load? This is the check that catches a NEW archive that never arrived --
# the newest file present is simply the last one that did.
if ($actual -ne $ExpectedSha256) {
  throw "REFUSING: newest archive in ${In} ('$($payload.Name)', sha256=$actual) does not match -ExpectedSha256 ($ExpectedSha256). The intended payload may not have arrived; check the inbound-push.sh transfer before retrying."
}

# SECONDARY check: sibling .sha256 self-consistency (unchanged from before).
$expected = (Get-Content -LiteralPath $sumPath -Raw).Trim().Split()[0].ToLower()
if ($expected -ne $actual) { throw "staging hash mismatch: expected $expected actual $actual" }
"staging payload verified: $($payload.Name) sha256=$actual (matches -ExpectedSha256 and sibling .sha256)"

Detach-Courier
$dl = Mount-Courier
try {
  if ($dl -notmatch '^[A-Za-z]:\\$') {
    throw "REFUSING: Mount-Courier returned '$dl', not a rooted drive path (expected e.g. 'F:\'). Refusing to write against an unverified path."
  }
  if (-not (Test-Path -LiteralPath $dl)) {
    throw "REFUSING: mounted courier path '$dl' does not exist on disk."
  }
  $old = @(Get-ChildItem -LiteralPath $dl -Filter 'antworld-payload-*' -Force -ErrorAction SilentlyContinue)
  foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force }
  foreach ($f in @('PAYLOAD-MANIFEST.txt','job.env','job.env.consumed','CANCEL')) {
    $p = Join-Path $dl $f
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
  }
  $out = Join-Path $dl 'out'
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
  New-Item -ItemType Directory -Path $out -Force | Out-Null
  Copy-Item -LiteralPath $payload.FullName -Destination $dl -Force
  Copy-Item -LiteralPath $sumPath -Destination (Join-Path $dl ($payload.Name + '.sha256')) -Force
  Copy-Item -LiteralPath $manifest -Destination (Join-Path $dl 'PAYLOAD-MANIFEST.txt') -Force
  $remoteHash = (Get-FileHash -LiteralPath (Join-Path $dl $payload.Name) -Algorithm SHA256).Hash.ToLower()
  if ($remoteHash -ne $actual) { throw "courier hash mismatch: expected $actual actual $remoteHash" }
  "courier payload verified: $remoteHash"
} finally { Dismount-Courier }
Attach-Courier
"COURIER LOADED: $($payload.Name); VM remains Off"
