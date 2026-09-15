$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# Convert a raw cloud disk image to a Gen2-compatible dynamic VHDX using only
# native Windows facilities (orwell has no qemu-img).
#
#   disk.raw  --append 512-byte VHD footer-->  fixed .vhd  --Convert-VHD-->  .vhdx
#
# A fixed VHD is exactly the raw payload followed by a 512-byte footer, so step
# one is an append, not a re-encode.

$dl     = 'D:\HyperV\AntWorld\Downloads'
$disks  = 'D:\HyperV\AntWorld\Disks'
$variant = if ($args.Count -ge 1) { $args[0] } else { 'genericcloud' }

$tarball = Join-Path $dl "debian-13-$variant-amd64.tar.xz"
if (-not (Test-Path -LiteralPath $tarball)) { throw "missing $tarball" }

$work = Join-Path $dl "extract-$variant"
New-Item -ItemType Directory -Path $work -Force | Out-Null

"=== EXTRACT $variant ==="
Push-Location $work
try {
  if (-not (Test-Path -LiteralPath (Join-Path $work 'disk.raw'))) {
    tar.exe -xf $tarball
  }
} finally { Pop-Location }
$raw = Join-Path $work 'disk.raw'
$rawLen = (Get-Item -LiteralPath $raw).Length
"disk.raw = $rawLen bytes ($([math]::Round($rawLen/1GB,3)) GB)"
if ($rawLen % 512 -ne 0) { throw "raw size is not a multiple of 512" }

# ---------------------------------------------------------------------------
# Build the 512-byte fixed-VHD footer (all fields big-endian per the VHD spec).
# ---------------------------------------------------------------------------
function ConvertTo-BE([byte[]]$b) { if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($b) }; $b }

$footer = New-Object byte[] 512

[Text.Encoding]::ASCII.GetBytes('conectix').CopyTo($footer, 0x00)
(ConvertTo-BE ([BitConverter]::GetBytes([uint32]2))).CopyTo($footer, 0x08)           # features
(ConvertTo-BE ([BitConverter]::GetBytes([uint32]0x00010000))).CopyTo($footer, 0x0C)  # format version
# Data offset for a fixed disk is 0xFFFFFFFFFFFFFFFF. Written byte-wise because
# PowerShell 5.1 parses that literal as Int64 -1 and refuses the uint64 cast.
for ($i = 0x10; $i -lt 0x18; $i++) { $footer[$i] = 0xFF }

$epoch = [DateTime]::SpecifyKind([DateTime]'2000-01-01', 'Utc')
$ts    = [uint32]([DateTime]::UtcNow - $epoch).TotalSeconds
(ConvertTo-BE ([BitConverter]::GetBytes($ts))).CopyTo($footer, 0x18)
[Text.Encoding]::ASCII.GetBytes('win ').CopyTo($footer, 0x1C)                        # creator app
(ConvertTo-BE ([BitConverter]::GetBytes([uint32]0x00010000))).CopyTo($footer, 0x20)  # creator version
[Text.Encoding]::ASCII.GetBytes('Wi2k').CopyTo($footer, 0x24)                        # creator host OS
(ConvertTo-BE ([BitConverter]::GetBytes([uint64]$rawLen))).CopyTo($footer, 0x28)     # original size
(ConvertTo-BE ([BitConverter]::GetBytes([uint64]$rawLen))).CopyTo($footer, 0x30)     # current size

# CHS geometry, per the algorithm in the VHD specification.
# NOTE: PowerShell's [int64] cast ROUNDS (banker's rounding) rather than
# truncating, which silently produces the wrong cylinder count. Every division
# here must go through [math]::Floor.
function Idiv([double]$a, [double]$b) { [int64][math]::Floor($a / $b) }

$totalSectors = Idiv $rawLen 512
if ($totalSectors -gt 65535 * 16 * 255) { $totalSectors = 65535 * 16 * 255 }
if ($totalSectors -ge 65535 * 16 * 63) {
  $spt = 255; $heads = 16; $cth = Idiv $totalSectors $spt
} else {
  $spt = 17
  $cth = Idiv $totalSectors $spt
  $heads = Idiv ($cth + 1023) 1024
  if ($heads -lt 4) { $heads = 4 }
  if ($cth -ge ($heads * 1024) -or $heads -gt 16) { $spt = 31; $heads = 16; $cth = Idiv $totalSectors $spt }
  if ($cth -ge ($heads * 1024))                   { $spt = 63; $heads = 16; $cth = Idiv $totalSectors $spt }
}
$cyl = Idiv $cth $heads
"geometry: C=$cyl H=$heads S=$spt (totalSectors=$totalSectors)"
(ConvertTo-BE ([BitConverter]::GetBytes([uint16]$cyl))).CopyTo($footer, 0x38)
$footer[0x3A] = [byte]$heads
$footer[0x3B] = [byte]$spt
(ConvertTo-BE ([BitConverter]::GetBytes([uint32]2))).CopyTo($footer, 0x3C)           # disk type 2 = fixed
# checksum field at 0x40 stays zero while summing
([guid]::NewGuid().ToByteArray()).CopyTo($footer, 0x44)                              # unique id
$footer[0x54] = 0                                                                    # saved state

$sum = [int64]0
foreach ($b in $footer) { $sum += $b }
# Ones' complement, masked to 32 bits: -bnot yields a negative signed value that
# will not cast to uint32 directly on PowerShell 5.1.
$chk = [uint32]((-bnot $sum) -band 0xFFFFFFFFL)
(ConvertTo-BE ([BitConverter]::GetBytes($chk))).CopyTo($footer, 0x40)
"footer checksum = 0x{0:X8}" -f $chk

# ---------------------------------------------------------------------------
# Write raw + footer to a .vhd
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Path $disks -Force | Out-Null
$vhd  = Join-Path $disks "debian-13-$variant-amd64.vhd"
$vhdx = Join-Path $disks "antworld-$variant-base.vhdx"
foreach ($p in @($vhd,$vhdx)) { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } }

"=== WRITE FIXED VHD ==="
Copy-Item -LiteralPath $raw -Destination $vhd -Force
$fs = [IO.File]::Open($vhd, 'Append', 'Write')
try { $fs.Write($footer, 0, 512) } finally { $fs.Close() }
$vhdLen = (Get-Item -LiteralPath $vhd).Length
"vhd = $vhdLen bytes (raw + $($vhdLen - $rawLen) footer bytes)"

"=== CONVERT TO DYNAMIC VHDX ==="
Convert-VHD -Path $vhd -DestinationPath $vhdx -VHDType Dynamic
Remove-Item -LiteralPath $vhd -Force
Get-VHD -Path $vhdx | Select-Object Path,VhdFormat,VhdType,
  @{n='SizeGB';e={[math]::Round($_.Size/1GB,2)}},
  @{n='FileGB';e={[math]::Round($_.FileSize/1GB,3)}} | Format-List | Out-String

"=== RESIZE TO 20GB ==="
Resize-VHD -Path $vhdx -SizeBytes 20GB
Get-VHD -Path $vhdx | Select-Object @{n='SizeGB';e={[math]::Round($_.Size/1GB,2)}},
  @{n='FileGB';e={[math]::Round($_.FileSize/1GB,3)}} | Format-List | Out-String

"=== VERIFY: mount read-only and inspect the partition table ==="
$m = Mount-VHD -Path $vhdx -ReadOnly -PassThru
try {
  $dn = $m.DiskNumber
  "mounted as disk $dn"
  Get-Disk -Number $dn | Select-Object Number,PartitionStyle,
    @{n='SizeGB';e={[math]::Round($_.Size/1GB,2)}} | Format-Table -AutoSize | Out-String
  Get-Partition -DiskNumber $dn |
    Select-Object PartitionNumber,Type,GptType,
      @{n='SizeMB';e={[math]::Round($_.Size/1MB,1)}} | Format-Table -AutoSize | Out-String
} finally {
  Dismount-VHD -Path $vhdx
  "dismounted"
}
"DONE: $vhdx"
