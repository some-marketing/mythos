# macOS TCC Permission Priming Runbook

The by-hand operator steps to grant TCC (Full Disk Access, Automation/
AppleEvents) permissions to background automation jobs. Background launchd
agents cannot trigger consent prompts — these grants must be primed once per
host, in an interactive GUI session.

## Overview

Node-based LaunchAgents commonly need two classes of macOS permission:

| Tier | Grant             | Grantee                       | When needed                              |
|------|-------------------|--------------------------------|-------------------------------------------|
| 1    | Full Disk Access  | your node binary (e.g. `/usr/local/bin/node`) | Jobs that read protected directories |
| 2    | Automation (TCC)  | `{BUNDLE_ID_PREFIX}.<job>.app` | Jobs using AppleEvents to Reminders/Contacts/etc. |

Tier 1 grants Full Disk Access to the shared node interpreter every job
runs under — simple, but broad: every job that shares that interpreter gets
the grant, whether it needs it or not. Tier 2 builds each AppleEvents-using
job its own signed `.app` wrapper (via `build-and-sign.sh`) so its
Automation grant is scoped to that one job, not the whole interpreter.

## Tier 1: Grant Full Disk Access to your node binary

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click the **+** button
3. Navigate to your node binary (use **⌘⇧G** in the Open dialog, type the
   directory, then select `node`)
4. Enable the toggle
5. Quit any running node processes and let launchd re-launch them

**Verification:** after granting, run `tools/macos-tcc/verify-permissions.sh --verbose` and confirm no WARN/FAIL entries for Tier-1 jobs.

**Revisit trigger:** once every AppleEvents-using job is running via a
signed `.app` wrapper (Tier 2), revisit whether Full Disk Access on the
shared node interpreter is still needed for the remaining Tier-1 jobs. If
none of them touch protected paths, narrow or remove that grant.

## Tier 2: Grant Automation to signed `.app` bundles

For each AppleEvents-using job:

1. Build the `.app` bundle (if not already built):
   ```
   BUNDLE_ID_PREFIX=com.example.mythos \
     tools/macos-tcc/build-and-sign.sh --job <jobname> --script /absolute/path/to/entrypoint.cjs
   ```

2. Run the `.app` bundle once interactively (double-click in Finder, or):
   ```
   open tools/macos-tcc/<jobname>.app
   ```
   macOS will show a consent prompt for whatever it uses (Reminders,
   Contacts, etc.) — **Allow**.

3. Confirm the grant in **System Settings → Privacy & Security → Automation**
   and the relevant app-specific permission section (Reminders / Contacts /
   etc.).

4. Point your job's LaunchAgent plist at the `.app` launcher instead of the
   shared node binary directly (`ProgramArguments` should reference
   `<jobname>.app/Contents/MacOS/launcher`), then reload it. If you're
   managing multiple staged plists, `repoint-plists.sh` automates the
   backup + bootout + install + bootstrap sequence — point
   `BUNDLE_ID_PREFIX` at your own prefix and it'll find them under
   `plist-staged/`.

5. Verify the agent reloaded:
   ```
   launchctl print gui/$(id -u)/{BUNDLE_ID_PREFIX}.<jobname>
   ```
   Look for a PID and `last exit code = 0` on the next scheduled run.

Repeat per job.

## Keeping the signed anchor stable

`verify-permissions.sh` checks that every job's `ProgramArguments[0]` still
points at a stable, Developer-ID-signed binary (not an ad-hoc-signed or
Homebrew-managed one, which can change identity on update and silently drop
your TCC grants). Set `EXPECTED_TEAM` to your own Developer ID Team
Identifier (find it via `codesign -dv /path/to/your/node`) before running it
— there's no safe generic default, since that identifier is yours alone.

If you ever move your node interpreter to a new signed anchor (e.g.
upgrading to a new major version installed from a fresh signed package),
re-run `verify-permissions.sh` afterward — TCC tracks grants by code
identity, not path alone, so a changed binary needs its grants re-primed
even at the same file path.

## Troubleshooting

| Symptom                        | Likely cause                        | Fix                                      |
|---------------------------------|--------------------------------------|--------------------------------------------|
| AppleEvents error `-1712`      | TCC Automation not granted          | Run the Tier-2 prime steps above          |
| AppleEvents error `-1743`      | TCC Automation denied               | Revoke + re-grant in System Settings      |
| Unexpected firewall/permission prompt on job start | FDA or a previous grant decayed | Re-grant FDA; check if the node path changed |
| `verify-permissions.sh` WARN   | Job still using `/usr/bin/env node` | Repoint that job's plist at your signed anchor |
