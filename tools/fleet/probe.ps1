# fleet-probe.ps1 — Mythos Fleet Discovery Probe
# Deployed to each Windows host. Returns JSON snapshot of hardware + Ollama state.
# Usage: powershell -File C:\smos\fleet-probe.ps1
# Output: JSON to stdout

$ErrorActionPreference = "Stop"
$result = @{
    hostname = $env:COMPUTERNAME
    probed_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    status = "ok"
}

# ── CPU ──────────────────────────────────────────────────────────────────────
try {
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $result.cpu = @{
        name = ($cpu.Name -replace '\s+', ' ').Trim()
        cores = $cpu.NumberOfCores
        threads = $cpu.NumberOfLogicalProcessors
    }
} catch { $result.cpu = $null }

# ── RAM ──────────────────────────────────────────────────────────────────────
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $result.ram = @{
        total_gb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
        free_gb  = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    }
} catch { $result.ram = $null }

# ── GPU ──────────────────────────────────────────────────────────────────────
try {
    $nvidia = nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader 2>$null
    if ($nvidia -and $nvidia.Trim()) {
        $parts = ($nvidia -split ',\s*').Trim()
        $result.gpu = @{
            name = $parts[0]
            vram_total_mb = [int]($parts[1] -replace ' MiB','')
            vram_free_mb = [int]($parts[2] -replace ' MiB','')
            driver = $parts[3]
        }
    } else {
        # Fallback: WMI for non-NVIDIA or if nvidia-smi missing
        $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.AdapterRAM -gt 1GB } | Select-Object -First 1
        if ($gpu) {
            $result.gpu = @{
                name = $gpu.Name
                vram_total_mb = [math]::Round($gpu.AdapterRAM / 1MB)
                vram_free_mb = $null
                driver = $gpu.DriverVersion
            }
        } else { $result.gpu = $null }
    }
} catch { $result.gpu = $null }

# ── Disks ────────────────────────────────────────────────────────────────────
try {
    $disks = @{}
    Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -gt 0 } | ForEach-Object {
        $disks[($_.Name + ":")] = @{
            total_gb = [math]::Round(($_.Used + $_.Free) / 1GB, 1)
            free_gb  = [math]::Round($_.Free / 1GB, 1)
        }
    }
    $result.disks = $disks
} catch { $result.disks = @{} }

# ── Ollama ───────────────────────────────────────────────────────────────────
try {
    $ollama = @{}
    
    # Models
    $modelsRaw = ollama list 2>$null
    $models = @()
    if ($modelsRaw) {
        ($modelsRaw -split "`n" | Select-Object -Skip 1) | ForEach-Object {
            $name = ($_ -split '\s+')[0]
            if ($name) { $models += $name }
        }
    }
    $ollama.models = $models
    
    # Active pulls / running models
    $psRaw = ollama ps 2>$null
    $active = @()
    if ($psRaw) {
        ($psRaw -split "`n" | Select-Object -Skip 1) | ForEach-Object {
            $name = ($_ -split '\s+')[0]
            if ($name) { $active += $name }
        }
    }
    $ollama.active = $active
    
    # Models dir
    $modelsDir = $env:OLLAMA_MODELS
    if (-not $modelsDir) { $modelsDir = "$env:USERPROFILE\.ollama\models" }
    $ollama.models_dir = $modelsDir
    
    # Service status
    $svc = Get-Service -Name "Ollama" -ErrorAction SilentlyContinue
    $ollama.service = if ($svc) { $svc.Status.ToString() } else { "not installed" }
    
    $result.ollama = $ollama
} catch { $result.ollama = $null }

# ── Uptime ───────────────────────────────────────────────────────────────────
try {
    $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    $uptime = (Get-Date) - $boot
    $result.uptime_hours = [math]::Round($uptime.TotalHours, 1)
} catch { $result.uptime_hours = $null }

# ── Output ───────────────────────────────────────────────────────────────────
$result | ConvertTo-Json -Depth 4