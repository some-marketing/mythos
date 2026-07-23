<#
Boot the Mythos mirror display stack on a Windows orchestrator.

- Serves C:\Mythos on port 8765 if nothing is already listening.
- Opens the canonical mirror image on Orwell via HTTP.
- Opens the local mirror file on Rupert to avoid Windows os.startfile HTTP service-context issues.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = 'C:\Mythos',
  [string]$HostName = 'rupert',
  [int]$Port = 8765,
  [string[]]$Nodes = @('orwell','rupert')
)

$ErrorActionPreference = 'Stop'
$mirrorRel = '_dev/outputs/mirrors/composite-truth-mirror-1.png'
$mirrorPath = Join-Path $RepoRoot $mirrorRel
if (-not (Test-Path -LiteralPath $mirrorPath)) {
  throw "Mirror image not found: $mirrorPath"
}

function Find-Python {
  $known = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
  )
  foreach ($p in $known) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) { return $py.Source }
  throw 'No Python executable found for static server.'
}

$listener = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
if (-not $listener) {
  $python = Find-Python
  if ((Split-Path -Leaf $python) -ieq 'py.exe') {
    Start-Process -FilePath $python -ArgumentList '-3','-m','http.server',[string]$Port,'--bind','0.0.0.0' -WorkingDirectory $RepoRoot -WindowStyle Hidden | Out-Null
  } else {
    Start-Process -FilePath $python -ArgumentList '-m','http.server',[string]$Port,'--bind','0.0.0.0' -WorkingDirectory $RepoRoot -WindowStyle Hidden | Out-Null
  }
  Start-Sleep -Seconds 1
}

$httpUri = "http://$HostName`:$Port/$($mirrorRel -replace '\\','/')"
$localUri = 'file:///' + ($mirrorPath -replace '\\','/')
$results = @()
foreach ($node in $Nodes) {
  $uri = if ($node -ieq $HostName -or $node -ieq 'rupert') { $localUri } else { $httpUri }
  $task = @{
    task_id = 'boot_mirror_' + $node + '_' + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    task_type = 'tool_call'
    model = 'tool:display'
    prompt = $uri
    metadata = @{ tool_name = 'display'; args = @{ uri = $uri } }
    timeout_seconds = 20
  } | ConvertTo-Json -Depth 6
  try {
    $response = Invoke-RestMethod -Method Post -Uri "http://$node`:8001/api/tasks" -ContentType 'application/json' -Body $task -TimeoutSec 20
    $results += [pscustomobject]@{ node = $node; uri = $uri; status = $response.status; task_id = $response.task_id; error = $response.error }
  } catch {
    $results += [pscustomobject]@{ node = $node; uri = $uri; status = 'failed'; task_id = ''; error = $_.Exception.Message }
  }
}

$results | Format-Table -AutoSize
if ($results | Where-Object { $_.status -ne 'completed' }) { exit 1 }
