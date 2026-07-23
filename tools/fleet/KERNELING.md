# KERNELING — Every Way We Kernel a Host

This document is the canonical process reference for Mythos host-kerneling.
It covers what the kernel is, the primary one-shot launcher for an Orwell-class node,
the two separate underlying tracks for applying the kernel, and the end-to-end runbook
(parameterized by hostname).

**Cross-links:**
- `tools/fleet/bootstrap-kit/setup-syme.ps1` — primary one-shot launcher (Orwell-class node)
- `tools/fleet/bootstrap-kit/START-HERE_syme-setup.md` — operator walkthrough for the one-shot launcher
- `tools/fleet/bootstrap-kit/RUNBOOK.md` — syme step-by-step onboarding
- `tools/fleet/README.md` — fleet scripts overview
- `tools/vps/README.md` — VPS context-hub documentation
- `_dev/concepts/vps-context-hub.md` — VPS context-hub concept
- `_dev/concepts/cloud-join-node-provisioning/` — cloud join + provisioning doctrine

---

## What Is the Kernel?

**THE KERNEL** = `the_kernel.tar.gz.gpg`

A symmetric-GPG-encrypted tar archive carrying the **MIND substrate**:

| Payload path (inside the archive) | What it is |
|-----------------------------------|------------|
| `Mythos/_dev/research/{OPERATOR_NAME}-philosophy/` | Operator epistemic framework and philosophy substrate |
| `claude-memory/MEMORY.md` | Claude harness long-term memory |

**Encryption:** symmetric GPG, passphrase at `op://Personal/the_kernel/password` (1Password vault).
The passphrase is pulled at runtime via `op read` and piped directly into gpg stdin.
It is NEVER written to disk.

**Integrity:** `the_kernel.tar.gz.gpg.sha256` — SHA-256 checksum verified before decrypt.

**Current archive date:** 2026-04-26 (the archive on the thumbdrive).

---

## Primary Path — `setup-syme.ps1` (one-shot launcher)

For an **Orwell-class Windows node** (e.g., `syme`), the recommended entrypoint is the unified
launcher **`tools/fleet/bootstrap-kit/setup-syme.ps1`**. It runs all phases of both tracks below in
one command, with a **typed kernel password** (no 1Password install on the node) and **OVH-as-update-source**
wiring built in.

🖥️ On the node, in an Administrator PowerShell, from the drive's `bootstrap-kit` directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-kit\setup-syme.ps1
```

Phases (in order — order matters; the repo must exist before the mind substrate lands in it):

| Phase | What happens |
|-------|-------------|
| **0** | Preflight (admin, OS, network, kernel bundle on drive) + kernel passphrase captured ONCE as a SecureString (typed, hidden, never written to disk) |
| **1** | Enable OpenSSH Server + firewall rule |
| **2** | Join Tailscale tailnet (calls `join-tailnet.ps1`) — **interactive Tailscale browser login pops here by default; no auth key needed.** Pass `-AuthKeyPath` for optional unattended join |
| **3** | Install deps + clone repo to `C:\Mythos` + register `simpleminions-worker` NSSM service (calls `kernelize-worker.ps1`) — **GitHub browser login pops here** |
| **4** | Decrypt + install the mind substrate (`{OPERATOR_NAME}-philosophy/` + `MEMORY.md`) into the clone — **UTF-8/no-BOM passphrase pipe; the old "Bad session key" UTF-16 bug is fixed, so Git Bash is NOT required** |
| **5** | Add the OVH `vps` git remote + generate syme's SSH keypair; prints syme's **public** key and the exact **Mac** command to authorize it on the VPS |

Key behaviors:

- **Typed password:** the kernel passphrase is read at the prompt (`op://Personal/the_kernel/password`
  in 1Password on the **Mac**; the operator pastes it). The node never needs `op`.
- **Tailscale browser login (default):** Phase 2 runs an interactive `tailscale up --hostname=<node>`;
  Tailscale prints a login URL / opens a browser and the operator authorizes the device against the
  fleet's Tailscale account. No `authkey.txt` on the drive. For unattended / cloud-join automation,
  pass `-AuthKeyPath <path>` to use an auth key instead.
- **`-ConnectivityOnly`:** stop after Phase 2 (tailnet enrolled + VPS reachability check); skips 3–5.
- **`-MemoryTargetPath`:** override the Claude project memory target for `MEMORY.md`. If empty, the
  path is derived from `-SmosPath` (default `C:\Mythos`) via Claude Code's slug convention
  (replace every non-alphanumeric char with `-`): `C:\Mythos` → `C--mythos` →
  `$HOME\.claude\projects\C--mythos\memory\MEMORY.md`.
- **OVH as update source:** after the run, the operator runs ONE command **on the Mac** —
  `ssh ubuntu@{TELEMETRY_HOST} "echo '<syme-pubkey>' >> ~/.ssh/authorized_keys"` — to turn on OVH pulls.
  Until then syme is fully installed (code from the GitHub clone) but `git pull vps ...` is refused.
  Thereafter: `git -C C:\Mythos pull vps recovery/clean-lineage-2026-05-18`.
- **Idempotent:** safe to re-run; each phase skips if already done. A 0–1 reboot may occur if Windows
  renames the computer to the node name — re-run the same command to continue.

Operator walkthrough: `tools/fleet/bootstrap-kit/START-HERE_syme-setup.md`.

`setup-syme.ps1` **supersedes** the separate `install_the_kernel` + `bootstrap-syme` steps for syme.
The two-track description below is the **underlying / alternative method** — still valid for
fleet-only or non-Orwell-class use, and useful for understanding what the launcher does internally.

---

## Two Separate Tracks (underlying / alternative method)

Kerneling a host involves two independent tracks that must BOTH complete.
They can be run in either order, but Track A has no network dependency and should usually run first.

```
Track A — Mind substrate install   (the kernel file itself)
Track B — Fleet node enrollment    (tailnet + worker service + Ollama)
```

---

## Track A — Mind Substrate (install_the_kernel)

Installs `{OPERATOR_NAME}-philosophy/` and `MEMORY.md` into the local Mythos checkout and Claude memory path.

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| 1Password desktop app installed and signed in | CLI integration must be enabled |
| `op` CLI authenticated (`op whoami` must succeed) | Used to pull passphrase at runtime |
| `gpg` installed | Homebrew `gnupg` on Mac; Gpg4win on Windows |
| `tar` and `rsync` (Mac) / `tar` (Windows) | Standard on macOS; Git Bash provides `tar` on Windows |
| Mythos repo cloned locally | Path confirmed to exist before install proceeds |
| Thumbdrive mounted with `the_kernel.tar.gz.gpg` and `.sha256` | Same directory as the installer script |

### macOS — `install_the_kernel.command`

```bash
# Double-click in Finder, or from Terminal:
bash /Volumes/BIOS/install_the_kernel.command
# Or from the repo copy (after bootstrap-kit is on the drive):
bash tools/fleet/bootstrap-kit/install_the_kernel.command
```

What it does:
1. Verifies `the_kernel.tar.gz.gpg` and `.sha256` are present
2. Checks required commands (`shasum`, `gpg`, `tar`, `rsync`, `op`)
3. Prompts for confirmation
4. Verifies 1Password CLI is signed in
5. SHA-256 verifies the encrypted bundle
6. Prompts for Mythos repo path (default: `/Users/admin/Documents/GitHub/Mythos`)
7. Prompts for Claude memory path (default: `~/.claude/projects/.../memory/MEMORY.md`)
8. Creates a `mktemp` work directory, decrypts via `op read ... | gpg --passphrase-fd 0`
9. Extracts tar, validates both payload paths exist
10. `rsync`s `{OPERATOR_NAME}-philosophy/` into the Mythos repo
11. `rsync`s `MEMORY.md` into the Claude memory path
12. Cleans up plaintext temp directory on exit (trap)

### Windows — `install_the_kernel.ps1`

```powershell
# From PowerShell as Administrator, with thumbdrive at D:\:
powershell -ExecutionPolicy Bypass -File D:\install_the_kernel.ps1
# Or from the repo copy:
powershell -ExecutionPolicy Bypass -File tools\fleet\bootstrap-kit\install_the_kernel.ps1
```

What it does: same logical sequence as the macOS version, adapted for PowerShell.
Uses `Get-FileHash` for SHA-256, `Copy-Item` instead of rsync, `[System.IO.Path]::GetTempPath()` for work dir.

### Environment variable overrides (both platforms)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SMOS_KERNEL_BUNDLE_NAME` | `the_kernel.tar.gz.gpg` | Override bundle filename |
| `SMOS_KERNEL_PASSPHRASE_REF` | `op://Personal/the_kernel/password` | Override 1Password reference |
| `SMOS_KERNEL_TARGET` | macOS default path | Override Mythos repo path |
| `SMOS_KERNEL_MEMORY_TARGET` | (Windows only) Claude memory path | Override memory file path |

---

## Track B — Fleet Node Enrollment (bootstrap-kit)

Enrolls the host into the Mythos fleet: SSH server, Tailscale tailnet, worker daemon, Ollama.

Full step-by-step: `tools/fleet/bootstrap-kit/RUNBOOK.md`

### Phase summary

| Phase | Script | What happens |
|-------|--------|-------------|
| **A — OpenSSH** | `bootstrap-syme.ps1` Phase A | Installs OpenSSH Server, enables `sshd`, opens TCP 22 |
| **B — Tailnet** | `bootstrap-syme.ps1` → `join-tailnet.ps1` | Installs Tailscale, runs `tailscale up --hostname=<node>` via interactive browser login by default (auth key optional via `-AuthKeyPath`), renames computer |
| **C — Kernelize** | `kernelize-worker.ps1 -NodeName <node>` | Phases 0–7: gh + Python, clone repos (GitHub), .venv-fleet, RDP, `simpleminions-worker` NSSM service |
| **D — Ollama** | `ensure-node-cloud-stack.ps1` | Ollama, Google Drive, iCloud; sets `OLLAMA_HOST=127.0.0.1:11434` |

**Note on `-ConnectivityOnly`:** pass this flag to `bootstrap-syme.ps1` to stop after Phase B (tailnet + VPS-reachability check) without running Phases C and D. Useful to confirm network membership before committing to the full install.

### What goes on the thumbdrive for Track B

```
bootstrap-syme.ps1        (from bootstrap-kit/)
join-tailnet.ps1          (from bootstrap-kit/)
kernelize-worker.ps1      (from tools/fleet/ — copy to drive root or bootstrap-kit/)
authkey.txt               [OPTIONAL — only for unattended join; omit for interactive browser login]
```

By default the tailnet join uses an **interactive Tailscale browser login**, so `authkey.txt` is NOT
required on the drive. Supply one (and pass `-AuthKeyPath`) only for unattended / cloud-join use; it
is not in the repo (one-time secret).

---

## VPS Link — Making the VPS the Update Origin

Once the node is on the tailnet, it can reach the VPS context-hub:

- Tailnet IP: `{TELEMETRY_HOST}`
- Public IP: `{VPS_HOST}`
- Bare remote path: `~/git/Mythos.git`
- Branch: `recovery/clean-lineage-2026-05-18`

**CURRENT REALITY:** Phase C of `kernelize-worker.ps1` clones Mythos from **GitHub** (`gh repo clone some-marketing/Mythos`), not from the VPS. The VPS is reachable on the tailnet once Phase B completes, but it is not yet wired as the update origin by the bootstrap scripts.

**The encrypted kernel + bootstrap kit ARE sufficient to link the box to the VPS** — no kernel repack is needed. The VPS-as-update-origin wiring is a small post-boot step:

See `tools/fleet/bootstrap-kit/RUNBOOK.md` → "Post-boot: make the VPS the update origin" for the exact commands.

The short version:
1. Authorize the node's SSH pubkey on the VPS `~/.ssh/authorized_keys`
2. `git remote add vps ubuntu@{TELEMETRY_HOST}:git/Mythos.git`
3. `git fetch vps && git pull vps recovery/clean-lineage-2026-05-18`

---

## End-to-End Runbook — Orwell-class Node (parameterize by `<NODE>`)

Replace `<NODE>` with the actual hostname (e.g., `syme`, `orwell`, `rupert`).

### Before you leave the Mac

- [ ] (Optional, unattended only) Generate a Tailscale auth key (admin → Settings → Keys) and place it on the thumbdrive; pass `-AuthKeyPath`. For a hands-on setup, SKIP this — the interactive browser login authorizes the node during the run.
- [ ] Confirm `the_kernel.tar.gz.gpg` and `.sha256` are on the thumbdrive
- [ ] Copy `tools/fleet/bootstrap-kit/` contents to the thumbdrive (or use the drive's existing `bootstrap-kit/`)
- [ ] Copy `tools/fleet/kernelize-worker.ps1` to the thumbdrive bootstrap-kit dir
- [ ] Copy `tools/fleet/bootstrap-kit/install_the_kernel.ps1` to the thumbdrive root (alongside the .gpg file)

### On the new Windows node

**Step 1 — Track A: Mind substrate**

```powershell
# Clone Mythos first (needed for the target path), or skip until Phase C completes
# and run Track A after Phase C.
# From the thumbdrive root:
powershell -ExecutionPolicy Bypass -File .\install_the_kernel.ps1
```

If the Mythos repo doesn't exist yet, run Track A AFTER Phase C of Track B (Phase C clones the repo to `C:\Mythos`). Come back and run this step then.

**Step 2 — Track B, Phases A+B: SSH + Tailnet**

```powershell
# From PowerShell as Administrator, from the bootstrap-kit dir.
# DEFAULT: interactive Tailscale browser login (a login URL appears — sign in to authorize the node):
powershell -ExecutionPolicy Bypass -File .\bootstrap-syme.ps1
# OPTIONAL unattended: supply an auth key instead of the browser login:
powershell -ExecutionPolicy Bypass -File .\bootstrap-syme.ps1 -AuthKeyPath .\authkey.txt
```

- A Tailscale login URL appears during the tailnet phase (default) — sign in to authorize `<NODE>`.
- If the computer name is not already `<NODE>`, the script will rename and prompt for a reboot.
- After reboot, re-run the same command to continue.
- To stop after tailnet and verify connectivity before proceeding: add `-ConnectivityOnly`.

**Step 3 — Track B, Phase C: Kernelize**

```powershell
# Runs from the repo or from the drive; requires internet (GitHub + winget):
powershell -ExecutionPolicy Bypass -File .\kernelize-worker.ps1 -NodeName <NODE> -OrchestratorHost macbook-pro
```

Phases 0–7 complete. `simpleminions-worker` NSSM service starts.

**Step 4 — Track B, Phase D: Cloud stack**

```powershell
powershell -ExecutionPolicy Bypass -File tools\fleet\ensure-node-cloud-stack.ps1
```

Installs Ollama. Pull models manually after: `ollama pull qwen2.5-coder:14b`

**Step 5 — Track A (if deferred): Mind substrate**

If you couldn't run Track A before Phase C (no repo yet), run it now:

```powershell
powershell -ExecutionPolicy Bypass -File D:\install_the_kernel.ps1
# Point at C:\Mythos when prompted for the repo path
```

**Step 6 — Post-boot: VPS as update origin**

See `tools/fleet/bootstrap-kit/RUNBOOK.md` → "Post-boot: make the VPS the update origin".

### Verify from the Mac

```bash
# SSH reachability
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@<NODE> hostname

# Tailscale membership
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@<NODE> \
  "tailscale status"

# Worker service status
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@<NODE> \
  "powershell -Command \"Get-Service simpleminions-worker | Select-Object Status,Name\""

# Orchestrator node registration
curl http://localhost:8000/api/nodes | jq '.nodes[] | select(.node_id=="<NODE>")'

# Mythos git log from the node
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@<NODE> \
  "cd C:\\Mythos && git log --oneline -5"
```

---

## Known Issues and Replicability Gaps

### 1. Windows PowerShell 5 — UTF-16 passphrase pipe bug (install_the_kernel.ps1)

**Symptom:** `gpg` returns "Bad session key" on Windows PowerShell 5.
**Cause:** PowerShell 5 encodes piped strings as UTF-16LE; gpg's `--passphrase-fd 0` reader expects UTF-8.
**Workaround (Rupert):** Run the decrypt/extract steps through Git Bash instead of native PowerShell 5.
**Permanent fix (not yet applied to `install_the_kernel.ps1`):** Upgrade to PowerShell 7 (`pwsh`), which pipes UTF-8 by default; OR write the passphrase to a temp file and pass `--passphrase-file` instead of `--passphrase-fd 0`.
**Status:** Fix deferred for the standalone `install_the_kernel.ps1` script — it is NOT modified.
**Already fixed in `setup-syme.ps1`:** the primary launcher sets `StandardInputEncoding` to UTF-8
with no BOM when piping the passphrase to gpg, so its Phase 4 decrypt does NOT hit this bug. Git Bash
is not required when using `setup-syme.ps1`.

### 2. No documented kernel PACK/BUILD script (replicability gap)

`the_kernel.tar.gz.gpg` is built manually and out-of-band. There is no repo-tracked script for:
- What files to include (`{OPERATOR_NAME}-philosophy/` + `claude-memory/MEMORY.md`)
- How to pack: `tar -czf the_kernel.tar.gz Mythos/_dev/research/{OPERATOR_NAME}-philosophy claude-memory/MEMORY.md`
- How to encrypt: `gpg --symmetric --batch --yes --pinentry-mode loopback --passphrase-fd 0 the_kernel.tar.gz`
- How to generate the checksum: `shasum -a 256 the_kernel.tar.gz.gpg > the_kernel.tar.gz.gpg.sha256`
- How to update the archive when either payload changes

**This is a replicability gap.** A `pack_kernel.command` / `pack_kernel.ps1` build script should be created and version-controlled in `tools/fleet/bootstrap-kit/`. Until then, the above manual steps are the documented build process.

### 3. KERNELIZE.md doctrine lives in a separate private repo

`{OPERATOR_NAME}-s_PC/KERNELIZE.md` is the canonical Phases-0-7 kerneling doctrine, but it lives in the `{OPERATOR_NAME}-s_PC` private repo, not in Mythos. This means Mythos operators who don't have that repo can't read the full unwind/reversal instructions. The runbook in `tools/fleet/bootstrap-kit/RUNBOOK.md` provides partial reversal steps, but is not a full substitute.

### 4. Tailscale enrollment defaults to interactive browser login (auth key optional)

The tailnet join now defaults to an **interactive Tailscale browser login** (`tailscale up
--hostname=<node>`), so no `authkey.txt` is required on the drive — its absence is normal. An auth
key remains an OPTIONAL path for unattended / cloud-join automation: supply the key on the drive and
pass `-AuthKeyPath`. The auth key is not stored in the repo (one-time-use secret).

### 5. Phase C clones from GitHub, not the VPS

`kernelize-worker.ps1` clones Mythos from GitHub, not the VPS context-hub. This means a fresh node gets its initial code from GitHub. Switching to VPS-as-primary-origin is a manual post-boot step (see above and RUNBOOK.md). No kernel repack is needed to fix this; it is a post-boot wiring task.

---

## Security Notes

- The passphrase is NEVER written to disk at any point during install
- The plaintext `the_kernel.tar.gz` is created in a temp directory and shredded on exit (bash: `trap cleanup EXIT`; PowerShell: `finally { Remove-WorkDir }`)
- `mslicense.txt` on the thumbdrive is NOT read, referenced, or touched by any of these scripts
- `the_kernel.tar.gz.gpg` on the thumbdrive is read only for decrypt; it is not copied or modified
