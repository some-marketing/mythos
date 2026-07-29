# Start Here — Setting up `syme`

This drive has everything you need to bring `syme` online as a fully kerneled Mythos fleet node.

Setup is now **ONE command**. The old two-track flow (separate mind-substrate install + fleet
enrollment) has been folded into a single launcher, `setup-syme.ps1`. You run it once, it prompts
you for the kernel password one time, and it does everything end to end.

> **No secret to drop before you start.** Tailscale enrollment uses an **interactive browser login**
> by default — during the run a Tailscale login URL appears and you sign in (just like the GitHub
> step). The kernel password is **typed when prompted** — it is never written to the drive and
> 1Password is NOT installed on syme.
>
> *Unattended/fleet alternative:* pass a Tailscale auth key via `-AuthKeyPath` (e.g.
> `.\setup-syme.ps1 -AuthKeyPath D:\authkey.txt`). That path is for the future cloud-join automation
> and is **not** needed for a hands-on syme setup.

---

## THE ONE COMMAND

🖥️ On `syme`, in an **Administrator PowerShell**, from the `bootstrap-kit` directory on the drive:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-kit\setup-syme.ps1
```

(If your PowerShell is already inside `bootstrap-kit\`, run `.\setup-syme.ps1` instead. To target a
specific drive letter explicitly: `.\setup-syme.ps1 -DrivePath D:\`.)

It prompts for the **kernel password once**, then does all of this in order:

1. Enables OpenSSH Server (so the Mac can reach syme).
2. Joins the Tailscale tailnet.
3. Installs all dependencies + clones the Mythos repo from GitHub to `C:\Mythos`.
4. Decrypts + installs the **mind substrate** (`{OPERATOR_NAME}-philosophy/` + `MEMORY.md`) into the clone.
5. Wires the OVH VPS as the Mythos update source and prints the one command to authorize syme.

---

## Before you start (one-time)

### On `syme` 🖥️

1. **Finish Windows 11 OOBE** and get syme onto the LAN / Wi-Fi before running anything.

2. **Note the Windows username you create during OOBE — it becomes the `ssh_user`.**
   The scripts and `fleet-hosts.json` assume **`taylo`**. If you pick a different name, you will
   update `fleet-hosts.json` in the verify step.

   That's it for syme prereqs. You do **not** need 1Password, Git Bash, or GPG installed by hand —
   `setup-syme.ps1` installs everything it needs and types the password into GPG itself.

### On the Mac 💻 (do this before sitting down at syme)

3. **Have the kernel password ready.** It lives in your 1Password as the **`the_kernel`** item.
   You'll paste it when `setup-syme.ps1` prompts (input is hidden). No 1Password install on syme.

   That's it — there is **no Tailscale auth key to mint**. During the run a Tailscale browser login
   appears on syme and you sign into your Tailscale account to authorize the device.

   > *Unattended/fleet alternative (optional):* if you're provisioning a box hands-off, mint a
   > reusable auth key at https://login.tailscale.com/admin/settings/keys, save it somewhere on the
   > drive, and run with `-AuthKeyPath <path>`. That path exists for the future cloud-join automation
   > and is **not** needed for a normal hands-on syme setup.

---

## During the run, expect

- **A Tailscale browser login** during the tailnet-join phase — a login URL appears; sign into your
  Tailscale account to authorize syme (same idea as the GitHub step).
- **A GitHub browser login popup** during the clone/dependency phase — sign in with the GitHub
  account that has access to the `some-marketing` org repos.
- **The kernel-password prompt** (hidden input) — paste the `the_kernel` password from 1Password.
- **Time:** roughly 30–60 minutes at the keyboard, depending on download speeds.
- **Reboots: 0–1.** Only if Windows has to rename the computer to `syme`. If it does, the script
  prompts you to reboot, then you re-run the same one command and it picks up where it left off.

### Want to verify connectivity first?

Add `-ConnectivityOnly` to stop after the tailnet join + VPS reachability check, skipping the
install phases:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-kit\setup-syme.ps1 -ConnectivityOnly
```

Re-run without the flag when you're ready for the full install.

---

## After the run

When `setup-syme.ps1` finishes it prints **syme's SSH public key** and the **exact command to run
💻 ON THE MAC** to authorize syme on the OVH VPS. It looks like:

```bash
ssh ubuntu@{TELEMETRY_HOST} "echo '<syme-pubkey>' >> ~/.ssh/authorized_keys"
```

Run that one command on the Mac. **That is what turns on OVH pulls.**

> Until that Mac command runs, syme is still **fully installed** — its code came from the GitHub
> clone, and the mind substrate is in place. Only the OVH pulls won't work yet (the VPS hasn't
> authorized syme's key).

After authorizing, pull future Mythos updates from the OVH cloud server on syme:

```powershell
git -C C:\Mythos pull vps recovery/clean-lineage-2026-05-18
```

GitHub `origin` remains the fallback:
`git -C C:\Mythos pull origin recovery/clean-lineage-2026-05-18`

---

## Verify (💻 from the Mac)

### SSH reachability

```bash
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme hostname
```

Expected output: `syme`

The `-o IdentitiesOnly=yes -o IdentityAgent=none` flags bypass the SSH agent — always use them for
fleet commands from Claude Code sessions.

> ⚠️ If the Windows username on syme isn't `taylo`, replace `taylo` with your actual username **and**
> update `fleet-hosts.json` → `hosts.syme.ssh_user` to match. Then retry.

### Tailscale membership

```bash
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme \
  "powershell -Command \"tailscale status\""
```

Expected: `syme` listed as `self`; the VPS (`{TELEMETRY_HOST}`) listed as a peer. If MagicDNS hasn't
propagated yet, use the tailnet IP: `ssh taylo@<syme-tailnet-ip>`.

### Orchestrator node registration

```bash
curl http://localhost:8000/api/nodes | jq '.nodes[] | select(.node_id=="syme")'
```

Expected: a JSON object with `node_id: "syme"` and `status: "online"`.

### Mythos git log on syme

```bash
ssh -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/id_ed25519 taylo@syme \
  "cd C:\\Mythos && git log --oneline -5"
```

Expected: the last 5 commits of branch `recovery/clean-lineage-2026-05-18`.

---

## A note on the MEMORY.md slug

`setup-syme.ps1` auto-derives the Claude project memory path from syme's repo path by replacing every
non-alphanumeric character with `-`:

```
C:\Mythos  ->  slug = C--mythos  ->  $HOME\.claude\projects\C--mythos\memory\MEMORY.md
```

If syme's actual Claude project slug differs (check after first launching Claude Code there:
`ls $HOME\.claude\projects`), either move `MEMORY.md` into the matching folder, or re-run with the
override:

```powershell
.\setup-syme.ps1 -MemoryTargetPath "C:\Users\<you>\.claude\projects\<slug>\memory\MEMORY.md"
```

---

## If something goes wrong

### "Bad session key" during decrypt

You shouldn't see this anymore — `setup-syme.ps1` sends the password to GPG as UTF-8 with no BOM,
which is the fix for the old PowerShell 5 UTF-16 passphrase bug. **Git Bash is no longer required.**
If you somehow still hit it, confirm you pasted the correct `the_kernel` password.

### The Tailscale browser login didn't appear / the join hung

The default join is interactive — Tailscale prints a login URL during the tailnet phase.
1. Look for the `LOGIN URL: https://login.tailscale.com/...` line in the script output and open it
   in a browser on syme (or any browser, then approve the device).
2. Sign into the **same Tailscale account** the fleet uses and authorize syme.
3. If you closed it or it timed out, re-run `setup-syme.ps1` (it's idempotent and re-prompts the login).

*Unattended alternative:* if you supplied `-AuthKeyPath` and see "auth key expired" / "invalid auth
key", the key was expired or already used — mint a new reusable key at
https://login.tailscale.com/admin/settings/keys, update the file, and re-run. For a hands-on setup,
just omit `-AuthKeyPath` and use the browser login.

### SSH refused from the Mac

Check in order:
1. Is `sshd` running on syme? (`Get-Service sshd` in PowerShell on syme)
2. Is the Windows username actually `taylo`? If not, update the SSH command and `fleet-hosts.json`.
3. Is syme on the tailnet? (`tailscale status` on syme)
4. Is MagicDNS resolving? Try `ssh taylo@<tailnet-ip>` instead of `ssh taylo@syme`.

### GitHub auth loop during the clone

If the browser flow loops or fails, on syme run `gh auth login`, choose
**GitHub.com → HTTPS → Browser**, complete it, then re-run `setup-syme.ps1` (it's idempotent and
skips finished phases).

### OVH pull fails

Almost always means syme's key isn't authorized on the VPS yet. Re-run the **Mac** command the script
printed (`ssh ubuntu@{TELEMETRY_HOST} "echo '<pubkey>' >> ~/.ssh/authorized_keys"`). Until then,
`git -C C:\Mythos pull origin recovery/clean-lineage-2026-05-18` (GitHub fallback) still works.

---

## Relationship to the old two-step flow

`setup-syme.ps1` **supersedes** the old two-step process for syme — you no longer run
`install_the_kernel` (mind substrate) and `bootstrap-syme` (fleet enrollment) separately.

The older `install_the_kernel.*` and `bootstrap-syme.ps1` scripts remain on the drive and in the repo
**for reference and for fleet-only / non-Orwell-class use**. For onboarding `syme`, use the one
command above. The canonical process reference is `tools/fleet/KERNELING.md`.

---

## When you're done

A fully kerneled `syme` looks like this:

- ✓ On the tailnet as `syme` (visible in Tailscale admin, reachable by hostname)
- ✓ SSH-reachable from the Mac: `ssh taylo@syme hostname` → `syme`
- ✓ `simpleminions-worker` service Running (auto-starts on boot)
- ✓ Mythos repo at `C:\Mythos` on branch `recovery/clean-lineage-2026-05-18`
- ✓ `{OPERATOR_NAME}-philosophy/` and `MEMORY.md` installed (mind substrate)
- ✓ OVH `vps` remote wired; syme's key authorized so `git pull vps ...` works
- ✓ Registered in orchestrator `/api/nodes` as `status: online`

**Setting up another box?** Use this same drive and repeat the one command — the Tailscale browser
login authorizes each new box interactively (no per-box auth key to generate). For hands-off fleet
provisioning, pass `-AuthKeyPath` instead. The canonical process reference is
`tools/fleet/KERNELING.md` in the Mythos repo.

---

*Repo copy: `tools/fleet/bootstrap-kit/START-HERE_syme-setup.md` · Updated 2026-06-22*
