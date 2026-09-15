# load-courier.ps1 -- stage the newest allowlisted payload onto the courier.
#
# The VM must be Off. This is the only host-side hop from D:\HyperV\AntWorld\Staging\In
# to the FAT32 courier used by the guest. It preserves the pinned Node runtime,
# replaces only payload/manifests, and clears stale job/output state.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'courier-lib.ps1')

$VMName = 'ant-world'
$Root = 'D:\HyperV\AntWorld'
$In = Join-Path $Root 'Staging\In'

$vm = Get-VM -Name $VMName
if ($vm.State -ne 'Off') { throw "REFUSING: VM is '$($vm.State)'; courier may only be loaded while Off" }
if (@(Get-VMNetworkAdapter -VMName $VMName).Count -ne 0) { throw 'REFUSING: VM has a network adapter' }

$payloads = @(Get-ChildItem -LiteralPath $In -Filter 'antworld-payload-*.tar.gz' | Sort-Object Name -Descending)
if ($payloads.Count -eq 0) { throw "no payload archive under $In" }
$payload = $payloads[0]
$sumPath = "$($payload.FullName).sha256"
$manifest = Join-Path $In "$([IO.Path]::GetFileNameWithoutExtension([IO.Path]::GetFileNameWithoutExtension($payload.Name))).MANIFEST.txt"
if (-not (Test-Path -LiteralPath $sumPath)) { throw "checksum missing: $sumPath" }
if (-not (Test-Path -LiteralPath $manifest)) { throw "manifest missing: $manifest" }
$expected = (Get-Content -LiteralPath $sumPath -Raw).Trim().Split()[0].ToLower()
$actual = (Get-FileHash -LiteralPath $payload.FullName -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { throw "staging hash mismatch: expected $expected actual $actual" }
"staging payload verified: $($payload.Name) sha256=$actual"

Detach-Courier
$dl = Mount-Courier
try {
  # CODE REVIEW (PR #12, codex P1): Mount-Courier returns only the drive
  # letter (e.g. `E`), so bare `$dl` addresses a RELATIVE path named `E`
  # instead of the mounted FAT32 root -- the refresh would copy/verify
  # outside the courier while the guest is reattached with stale cargo.
  # Every sibling script uses the drive-root form `${dl}:\`; do the same.
  $dlRoot = "${dl}:\"
  $old = @(Get-ChildItem -LiteralPath $dlRoot -Filter 'antworld-payload-*' -Force -ErrorAction SilentlyContinue)
  foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force }
  foreach ($f in @('PAYLOAD-MANIFEST.txt','job.env','job.env.consumed','CANCEL')) {
    $p = Join-Path $dlRoot $f
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
  }
  $out = Join-Path $dlRoot 'out'
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
  New-Item -ItemType Directory -Path $out -Force | Out-Null
  Copy-Item -LiteralPath $payload.FullName -Destination $dlRoot -Force
  Copy-Item -LiteralPath $sumPath -Destination (Join-Path $dlRoot ($payload.Name + '.sha256')) -Force
  Copy-Item -LiteralPath $manifest -Destination (Join-Path $dlRoot 'PAYLOAD-MANIFEST.txt') -Force
  $remoteHash = (Get-FileHash -LiteralPath (Join-Path $dlRoot $payload.Name) -Algorithm SHA256).Hash.ToLower()
  if ($remoteHash -ne $actual) { throw "courier hash mismatch: expected $actual actual $remoteHash" }
  "courier payload verified: $remoteHash"
} finally { Dismount-Courier }
Attach-Courier
"COURIER LOADED: $($payload.Name); VM remains Off"
