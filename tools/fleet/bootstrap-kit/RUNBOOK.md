# RUNBOOK — Onboarding `syme` into the Mythos Fleet

Node: **syme** — Windows 11 Pro, RTX 5070 Ti 16 GB VRAM, 32 GB RAM.
Kit location: `tools/fleet/bootstrap-kit/` (this directory).

---

> **Recommended entrypoint: `setup-syme.ps1`.** For onboarding `syme`, use the unified one-shot
> launcher instead of the separate phase scripts below:
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\bootstrap-kit\setup-syme.ps1
> ```
>
> It runs OpenSSH → tailnet → kernelize → mind-substrate decrypt → OVH-as-update-source in one
> command, prompts for the kernel password once (typed; no 1Password on the node), and prints the
> single Mac command to authorize syme on the OVH VPS. Operator walkthrough:
> `tools/fleet/bootstrap-kit/START-HERE_syme-setup.md`. Canonical reference: `tools/fleet/KERNELING.md`
> → "Primary Path — `setup-syme.ps1`".
>
> The `bootstrap-syme.ps1` phase-by-phase flow documented below remains valid as the underlying /
> alternative method and for fleet-only use.

---

## What to drop on the thumbdrive

Copy the entire `tools/fleet/bootstrap-kit/` directory onto the drive. That's all you need for a
hands-on setup — the Tailscale join uses an **interactive browser login** by default, so no auth key
file is required.

Optionally, for **unattended / cloud-join** use only:

| File | What it is |
|------|-----------|
| `authkey.txt` | OPTIONAL Tailscale auth key (generate in the Tailscale admin panel → Settings → Keys). Only needed if you run with `-AuthKeyPath`; omit it to use the interactive browser login. |

**The license-key file already on the thumbdrive is left completely untouched.**
`bootstrap-syme.ps1` and `join-tailnet.ps1` do not open, read, copy, move, or reference it.
If you do drop an `authkey.txt`, do NOT place it in the same folder as the license-key file.

---

## One-line launch command

Open **PowerShell as Administrator** on `syme`, `cd` to wherever the kit landed, then:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-syme.ps1
```

By default this uses an **interactive Tailscale browser login** — a login URL appears during the
tailnet phase; sign into the fleet's Tailscale account to authorize the node. No auth key needed.

For **unattended / cloud-join** use only, supply an auth key path:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-syme.ps1 -AuthKeyPath D:\authkey.txt
```

### ConnectivityOnly option

To stop after Tailscale join + context-hub SSH check (skip worker service install):

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-syme.ps1 -ConnectivityOnly
```

Use this when you want to confirm the node is on the tailnet before committing to the full kernel install. Re-run without `-ConnectivityOnly` to complete phases C and D.

---

## Phases and expected reboots

| Phase | What happens | Reboot? |
|-------|-------------|---------|
| **A — OpenSSH Server** | Installs OpenSSH Server capability, enables `sshd` service (auto-start), opens TCP 22 firewall rule. | Only if capability install requires it (unlikely on Win11 Pro; script warns if `sshd` not found). |
| **B — Tailnet** | Installs Tailscale via winget if absent. Runs `tailscale up --hostname=syme` via an **interactive browser login** by default (a login URL appears — sign in to authorize the node); pass `-AuthKeyPath` for an unattended auth-key join instead. Renames Windows computer to `syme` if the name differs. | **YES if computer rename happens.** Script prompts y/N to reboot immediately. After reboot, re-run to continue phases C+D. |
| **C — Kernelize** | Runs `kernelize-worker.ps1 -NodeName syme` (phases 0–7): installs `gh` + Python, clones {OPERATOR_NAME}-s_PC + Mythos, enables RDP, sets up `.venv-fleet`, registers `simpleminions-worker` via NSSM. Phase C requires internet (GitHub + winget). | No, but NSSM service starts immediately. |
| **D — Cloud stack** | Runs `ensure-node-cloud-stack.ps1`. Installs Ollama, Google Drive, iCloud. Sets `OLLAMA_HOST=127.0.0.1:11434` (localhost-only, matching `fleet-hosts.json`). Opens Ollama firewall rule on Private profile only. | No, but a restart of `simpleminions-worker` may be needed if it launches before Ollama is ready. |

**Total expected reboots: 0–1** (only if Windows computer name differs from `syme`).

---

## Verification commands

Run all of these after the bootstrap completes.

### 1. Tailscale membership (on syme)

```powershell
tailscale status
```

Expect `syme` listed as `self`, and the hub VPS (`{TELEMETRY_HOST}`) listed as a peer.

### 2. SSH from the Mac

```bash
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme hostname
```

Expect output: `syme`

The `-o IdentitiesOnly=yes -o IdentityAgent=none` flags bypass the SSH agent (required in sandboxed Claude Code sessions — always use them for remote fleet commands).

### 3. Context-hub git log (from syme, after phase C clones Mythos)

```powershell
cd C:\Mythos
git log --oneline -5
```

Expect the last 5 commits of `recovery/clean-lineage-2026-05-18`.

Or from the Mac, via SSH:

```bash
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme \
  "cd C:\\Mythos && git log --oneline -5"
```

### 4. Orchestrator node heartbeat (from the Mac)

```bash
curl http://localhost:8000/api/nodes | jq '.nodes[] | select(.node_id=="syme")'
```

Expect a JSON object with `node_id: "syme"` and `status: "online"`.

### 5. Ollama local check (on syme)

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

Expect a JSON response listing installed models (may be empty `[]` until models are pulled).

---

## Windows-over-SSH gotchas

These apply whenever you SSH into syme from the Mac or VPS and run PowerShell commands.

**1. Use `-EncodedCommand` for multi-line or special-character PowerShell over SSH:**

```bash
# Encode on Mac:
CMD='Get-Service simpleminions-worker | Select-Object Status,Name'
ENCODED=$(echo -n "$CMD" | iconv -f UTF-8 -t UTF-16LE | base64)
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme \
  "powershell -EncodedCommand $ENCODED"
```

Do NOT use `powershell -Command "..."` for anything non-trivial — quoting collapses in transit.

**2. Long-running processes via CIM `Win32_Process Create` (not `Start-Process`):**

`Start-Process` children die when the SSH session ends. For persistent processes not managed by NSSM:

```powershell
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = 'C:\path\to\program.exe --flag'
}
```

For the fleet worker, NSSM already handles this — the `simpleminions-worker` service survives SSH disconnects by design.

**3. The `sshd` default shell on Windows is `cmd.exe`, not PowerShell:**

Prefix remote commands explicitly:

```bash
ssh taylo@syme "powershell -Command \"Get-Service sshd\""
# or use -EncodedCommand as above
```

---

## Reverting / uninstalling

Each phase is reversible:

| Phase | Reversal |
|-------|---------|
| A — OpenSSH | `Remove-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"` |
| B — Tailscale | `tailscale down && winget uninstall --id Tailscale.Tailscale` |
| C — NSSM service | `nssm stop simpleminions-worker && nssm remove simpleminions-worker confirm` |
| C — Repos | Delete `C:\Mythos` and `C:\{OPERATOR_NAME}-s_PC` |
| D — Ollama | `winget uninstall --id Ollama.Ollama` |

Snapshots recommended: kernelize-worker.ps1 creates a Windows System Restore point is recommended before first run (see KERNELIZE.md in {OPERATOR_NAME}-s_PC for the full unwind paths per phase).

---

## Post-boot: make the VPS the update origin

After Track B completes and the node is on the tailnet, the Mythos clone on the node uses GitHub as its remote (`origin`). The VPS context-hub (`{TELEMETRY_HOST}`, bare remote `~/git/Mythos.git`) is the intended canonical update origin per the Mythos architecture, but it is not wired automatically by `kernelize-worker.ps1`.

This is a small post-boot step — **no kernel repack required**.

**Step 1 — Authorize the node's SSH pubkey on the VPS**

From the node (or via SSH from the Mac into the node, then to the VPS):

```bash
# Get the node's public key
cat C:\Users\taylo\.ssh\id_ed25519.pub   # or wherever ssh-keygen placed it
```

Then on the VPS (SSH as ubuntu@{TELEMETRY_HOST} or via tailnet {TELEMETRY_HOST}):

```bash
echo "<node-pubkey>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**Step 2 — Add the VPS as a git remote**

From the node (PowerShell or Git Bash):

```powershell
cd C:\Mythos
git remote add vps ubuntu@{TELEMETRY_HOST}:git/Mythos.git
```

**Step 3 — Fetch and pull from the VPS**

```powershell
git fetch vps
git pull vps recovery/clean-lineage-2026-05-18
```

Going forward, pull updates from `vps` (not `origin`) to stay in sync with the context-hub canonical branch.

**Cross-reference:** `tools/fleet/KERNELING.md` → "VPS Link — Making the VPS the Update Origin" for fuller context and architecture notes. `tools/vps/README.md` and `_dev/concepts/vps-context-hub.md` for VPS topology.

---

## Assumptions and open items

1. **ssh_user for syme is `taylo`** — same as orwell (both are {OPERATOR_NAME}'s Windows machines). This is an assumption: the actual Windows account name on syme is not confirmed in the repo. Verify before first SSH attempt; if the account name differs, update `fleet-hosts.json` `ssh_user` and use that name in the SSH commands above.

2. **Tailscale hostname resolution** — `ssh taylo@syme` works once Tailscale's MagicDNS propagates (usually within seconds of enrollment). If DNS hasn't caught up, use the tailnet IP instead: `ssh taylo@<syme-tailnet-ip>`.

3. **GitHub authentication (Phase C)** — `kernelize-worker.ps1` Phase 1 uses `gh auth login` via browser flow if no PAT is cached. On a fresh machine with no browser, this requires either: (a) a keyboard/monitor attached during bootstrap, or (b) pre-seeding a GitHub PAT via `gh auth login --with-token`. The headless `op://Employee/Mythos GitHub PAT/credential` path is noted as not yet wired in `README.md`.

4. **Ollama models** — `ensure-node-cloud-stack.ps1` installs Ollama but does not pull any models. Pull models manually after bootstrap: `ollama pull qwen2.5-coder:14b` (match `fleet-hosts.json` `default_model`).

5. **Google Drive / iCloud** — Phase D installs the apps but account sign-in is always manual. The script opens them if `-OpenCloudApps` is passed; not passed by default in this sequencer.
