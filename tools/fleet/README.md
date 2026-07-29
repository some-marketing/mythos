# tools/fleet

Fleet management tooling for the Mythos distributed kernel.

## Scripts

### Node update / repair command

When Orwell, Rupert, or another Windows fleet node needs the current worker code,
mirror broadcast support, Ollama reachability repair, and Google Drive/iCloud,
use:

```powershell
cd C:\Mythos
git fetch origin
git switch recovery/clean-lineage-2026-05-18
git pull --ff-only
powershell -ExecutionPolicy Bypass -File tools\fleet\ensure-node-cloud-stack.ps1 -OpenCloudApps
Restart-Service simpleminions-worker
```

Full runbook: `tools/fleet/NODE_UPDATE_COMMANDS.md`.

### `kernelize-worker.ps1`

PowerShell script that runs Phases 0–7 of `KERNELIZE.md` (the per-host kerneling doctrine in the {OPERATOR_NAME}-s_PC repo) in one command.

**Run from the node being kerneled, PowerShell as Administrator:**

```powershell
cd <path-to-Mythos-repo>
.\tools\fleet\kernelize-worker.ps1 `
    -NodeName rupert `
    -OrchestratorHost macbook-pro
```

**Required parameters:**

| Param | Meaning |
|-------|---------|
| `-NodeName` | Hostname this node should register as (rupert / orwell / etc.) |
| `-OrchestratorHost` | Tailnet hostname of the orchestrator (currently `macbook-pro`) |

**Optional:**

| Param | Default | Notes |
|-------|---------|-------|
| `-OrchestratorPort` | `8000` | Orchestrator HTTP port |
| `-Capabilities` | `""` | Reserved for future use; currently logged but not consumed (the daemon has no config surface for capability tags yet) |
| `-TaylorsPCPath` | `C:\{OPERATOR_NAME}-s_PC` | Where to clone {OPERATOR_NAME}-s_PC |
| `-SmosPath` | `C:\Mythos` | Where to clone Mythos (pinned to `recovery/clean-lineage-2026-05-18`) |
| `-ServiceName` | `simpleminions-worker` | NSSM service name |
| `-SkipRDP` | (off) | Skip enabling RDP host (e.g., if a different remote-access path is preferred) |
| `-SkipDaemonLaunch` | (off) | Set up everything but don't register/start the NSSM service (useful for debugging) |

**Prerequisites the script does NOT install:**

- Windows 11 Pro (script verifies, won't proceed without it)
- Tailscale up + signed in to the same tailnet as the orchestrator (script verifies network reach)
- Run-as-Administrator (script verifies)

**What the script does:**

1. **Phase 0 — Pre-flight.** Admin check, OS version check, hostname display, github.com + orchestrator reachability.
2. **Phase 1 — Tooling.** Installs `gh` and Python 3.12 via winget if missing.
3. **Phase 2 — Auth + repos.** Authenticates `gh` (browser flow if no PAT), clones {OPERATOR_NAME}-s_PC and Mythos (pinned to `recovery/clean-lineage-2026-05-18`) to stable paths (or pulls latest if already present).
4. **Phase 3 — RDP host.** Enables Remote Desktop and opens the firewall rule. Tailscale gates public exposure.
5. **Phase 4 — venv + deps.** Creates `.venv-fleet`, installs `tools/fleet/lib/requirements-fleet.txt`.
6. **Phase 5 — Yield script.** Writes `check_idle.ps1` that detects Star Citizen / RSI Launcher / VR runtimes.
7. **Phase 6 — Daemon config + import smoke.** Computes daemon env vars, verifies `tools.fleet.worker` imports cleanly under the venv.
8. **Phase 7 — NSSM service.** Installs NSSM via winget if missing, registers `simpleminions-worker` as a Windows auto-start service with env vars + log rotation, starts it, and polls the orchestrator's `/api/nodes` for up to 30s to confirm registration.

**Post-run verification (from orchestrator host):**

```bash
curl http://localhost:8000/api/nodes | jq '.nodes[] | select(.node_id=="rupert")'
```

Should return the registered node with capabilities and `status: online`.

**Reversibility:**

Every step is reversible — see `KERNELIZE.md` in the {OPERATOR_NAME}-s_PC repo for unwind paths per phase.

**What's NOT yet automated:**

- Wiring `check_idle.ps1` into the worker daemon's pre-job hook (requires a `--pre-job-script` flag in `tools/fleet/worker/daemon.py` that doesn't exist yet — deferred slice)
- Headless `gh auth` via 1Password CLI (the script falls back to browser flow; once `op://Employee/Mythos GitHub PAT/credential` is populated, an env-var path can be added)

**Doctrine reference:**

This script is the mechanical instantiation of the doctrine in:
- `{OPERATOR_NAME}-s_PC/KERNELIZE.md` — the per-host kerneling phases
- `{OPERATOR_NAME}-s_PC/NODE_BOOTSTRAP.md` — the fleet identity + per-node bootstrap protocol
- `Mythos/_dev/concepts/recursive-submind-template/concept.md` — the recursive-submind boot doctrine this enacts at the worker tier

The script is the leaf-mechanical L2 implementation of an L0/L1 doctrine. Per the tier table in the recursive-submind concept, the script does not perform the full three-anchor read; it executes a bounded, code-defined work order.
