# console-capture.ps1 -- the only observation channel into a NIC-less guest.
#
# Boots the VM and captures Hyper-V console thumbnails at intervals, saving them
# as PNG. There is no network, no SSH and no serial console into this guest, so
# when provisioning fails silently the framebuffer is the only evidence there is.
#
# Also records how long the guest stays Running, which alone distinguishes
# "never booted" from "booted and failed late".

param(
  [int]$Seconds = 180,
  [int]$IntervalSeconds = 15,
  [switch]$ForceStop
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$VMName = 'ant-world'
$OutDir = 'D:\HyperV\AntWorld\Logs\console'
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
Get-ChildItem -LiteralPath $OutDir -Filter *.png | Remove-Item -Force -ErrorAction SilentlyContinue

# --- thumbnail plumbing (WMI; returns RGB565 pixels) ------------------------
$vmms = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_VirtualSystemManagementService
$vm   = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$VMName'"
$settings = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_VirtualSystemSettingData |
            Where-Object { $_.VirtualSystemType -match 'Realized|Recorded' } | Select-Object -First 1

function Save-Thumb($tag, $w, $h) {
  try {
    $r = Invoke-CimMethod -InputObject $vmms -MethodName GetVirtualSystemThumbnailImage -Arguments @{
      TargetSystem = $settings; WidthPixels = [uint16]$w; HeightPixels = [uint16]$h }
    if ($r.ReturnValue -ne 0 -or -not $r.ImageData) { return "no image (rv=$($r.ReturnValue))" }
    $bytes = $r.ImageData
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format16bppRgb565)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
    $bmp.UnlockBits($data)
    $p = Join-Path $OutDir "$tag.png"
    $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return $p
  } catch { return "thumb error: $($_.Exception.Message)" }
}

Add-Type -AssemblyName System.Drawing

# --- boot and observe -------------------------------------------------------
$cur = Get-VM -Name $VMName
# CODE REVIEW (confirmation pass, codex P1): an unconditional hard power-off
# here turned an observational command into an implicit reset -- console
# capture invoked while an experiment or provisioning boot was in flight
# silently killed it and risked leaving the FAT32 courier structurally
# inconsistent (see courier-lib.ps1's chkdsk gate). Refuse a running VM
# unless the caller explicitly opts into the destructive stop.
if ($cur.State -ne 'Off') {
  if (-not $ForceStop) {
    throw "REFUSING: VM '$VMName' is '$($cur.State)', not 'Off'. Console capture on a running guest would force-stop an in-flight run. Re-run with -ForceStop to do that deliberately."
  }
  Stop-VM -Name $VMName -TurnOff -Force; Start-Sleep -Seconds 3
}

$naCount = @(Get-VMNetworkAdapter -VMName $VMName).Count
"network adapters: $naCount"
# CODE REVIEW (confirmation pass, codex P1): this used to only print the
# adapter count and then boot anyway, bypassing the zero-NIC membrane that
# first-boot.ps1, run-job.ps1 and verify-membrane.ps1 all enforce before
# every other boot. A diagnostic capture must not be the one path that skips
# the membrane check.
if ($naCount -ne 0) { throw "REFUSING to boot: VM has $naCount network adapter(s); the zero-NIC membrane must hold before every boot, including diagnostic console captures" }

$t0 = Get-Date
Start-VM -Name $VMName
"started $($t0.ToUniversalTime().ToString('o'))"

$deadline = $t0.AddSeconds($Seconds)
$offAt = $null
while ((Get-Date) -lt $deadline) {
  $s = (Get-VM -Name $VMName).State
  $el = [int]((Get-Date) - $t0).TotalSeconds
  if ($s -eq 'Off') { $offAt = $el; "t=${el}s state=Off  (guest powered itself off)"; break }
  $res = Save-Thumb ("t{0:d4}" -f $el) 1024 768
  "t=${el}s state=$s  thumb=$res"
  Start-Sleep -Seconds $IntervalSeconds
}

if (-not $offAt) {
  "still Running after $Seconds s; capturing a final frame then leaving it running"
  Save-Thumb "final" 1024 768
} else {
  "guest ran for $offAt seconds total"
}

"=== captured frames ==="
Get-ChildItem -LiteralPath $OutDir -Filter *.png | Select-Object Name, Length | Format-Table -AutoSize | Out-String
