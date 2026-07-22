# VPS hardening runbook

A repeatable checklist + script for bringing a fresh Ubuntu VPS from
provider-default to a hardened baseline: key-only SSH, a firewall, brute-force
banning, unattended security updates, and swap. Written generically — swap in
your own host, and replace every `{VPS_HOST}` below with your real IP or
hostname.

## Pre-hardening inventory

Before running anything, capture a read-only baseline over SSH so you know
what you're changing:

- OS / kernel version, uptime, disk, memory
- Listening ports (`ss -tlnp` or equivalent)
- Whether passwordless sudo is enabled for your login user
- ufw / fail2ban / unattended-upgrades install state
- sshd's current `PasswordAuthentication` / `PermitRootLogin` settings
- Pending reboot flag / pending apt updates

## Key seeding (no password ever hits your shell history)

1. Resolve the VPS password from wherever you store it (password manager,
   secrets vault) — never type it directly into a terminal.
2. Use an `SSH_ASKPASS` shim that prints the resolved password from an env
   var, so `ssh-copy-id` never sees it on the command line:
   ```bash
   export SSH_ASKPASS_REQUIRE=force
   export SSH_ASKPASS=/path/to/askpass-shim.sh   # prints $VPS_SSHPW
   ssh-copy-id -o IdentitiesOnly=yes -o NumberOfPasswordPrompts=1 you@{VPS_HOST}
   ```
3. Verify keyless login before touching anything else:
   ```bash
   ssh -o BatchMode=yes you@{VPS_HOST} 'echo KEYLESS-OK'
   ```

**Gotcha:** if the provider forces a password change on first login (PAM
`chage`), a non-interactive `ssh-copy-id` will fail with "Password change
required but no TTY available." An `expect`-driven session can complete the
forced change, but raise `expect`'s `match_max` (default 2000 bytes) well
above the box's MOTD size (`match_max 1000000`), or the password prompt will
fall outside the match buffer and the script will hang.

## Run the baseline script

```bash
scp harden-baseline.sh you@{VPS_HOST}:~/
ssh you@{VPS_HOST} 'bash harden-baseline.sh'
```

`harden-baseline.sh` is idempotent (safe to re-run) and covers: system
update, unattended-upgrades, ufw (default-deny-incoming, SSH allowed first),
fail2ban with an sshd jail, and 2G of swap. Docker install is included but
commented out — uncomment if you need it.

It deliberately does **not** touch SSH password auth or root login — that's
a separate, higher-risk step (see below) done with a live session held open
as a safety net.

## Locking down SSH password auth (the protection ritual)

This is the step that can lock you out if done wrong, so it's a distinct
ritual, not part of the baseline script:

1. Open a persistent `ControlMaster` SSH session and keep it open.
2. Write an sshd drop-in disabling password auth and root login. **Ordering
   matters**: sshd config is first-match-wins, and Ubuntu cloud images ship
   `/etc/ssh/sshd_config.d/50-cloud-init.conf` with
   `PasswordAuthentication yes` already set. A drop-in named `90-*.conf`
   would silently lose to that file — name yours `00-hardening.conf` so it
   sorts first:
   ```bash
   sudo tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<'EOF'
   PasswordAuthentication no
   PermitRootLogin no
   EOF
   sudo sshd -t && sudo systemctl reload ssh   # reload, not restart
   ```
3. From a **second**, fresh terminal, verify key-only login still works
   before closing the first (master) session:
   ```bash
   ssh -o BatchMode=yes you@{VPS_HOST} 'echo SECOND-CONNECTION-KEYLESS-OK'
   ```
4. Only close the first session once the second connection confirms. If it
   fails, you still have the open master session to revert the drop-in.

## Verifying the end state

```bash
ssh you@{VPS_HOST} 'sudo ufw status verbose'
ssh you@{VPS_HOST} 'sudo fail2ban-client status sshd'
ssh you@{VPS_HOST} 'sudo sshd -T | grep -iE "passwordauthentication|permitrootlogin"'
ssh -o PreferredAuthentications=password you@{VPS_HOST}   # should be refused
```

## What this runbook deliberately leaves to you

- Choosing whether to move SSH off port 22 (breaks known_hosts/tooling
  defaults for modest gain against an already-fail2ban'd, key-only host —
  decide per your own risk tolerance).
- Any provider-panel-only options (a cloud firewall in front of the VPS,
  snapshot/backup add-ons) — those aren't scriptable and are worth doing
  once the box holds anything you'd miss.
- A monitoring agent, if you want one — not opinionated here.
