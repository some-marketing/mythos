$blockers = @('StarCitizen', 'StarCitizen_Launcher', 'RSI Launcher', 'vrserver', 'vrcompositor', 'VirtualDesktop.Streamer')
$running = Get-Process -Name $blockers -ErrorAction SilentlyContinue
if ($running) { Write-Output "BUSY: $($running.Name -join ', ')"; exit 1 }
else { Write-Output "IDLE"; exit 0 }
