# tools/launchd/

Durable, machine-local recurring routines for Mythos via macOS launchd. Survives
reboots and Claude session ends. The repo is the source of truth for plist
content; the installer sync's it to `~/Library/LaunchAgents/`.

## Installed routines

| Plist | Schedule | Wrapper | What it does |
|---|---|---|---|
| `ca.somemarketing.smos.harness-capability-crawler.plist` | Every 15 minutes | `run-harness-capability-crawler.cjs` | Runs report-only harness capability inventory and writes a stable next-actions queue. |
| `ca.somemarketing.smos.harness-sync-crawler.plist` | Every 5 minutes | `run-harness-sync-crawler.cjs` | Applies canonical machine-owned instruction output to drifted harness targets and records a launchd run ledger. |
| `ca.somemarketing.smos.meta-ads-tracker-refresh-{CLIENT_CODE}.plist` | Mondays 09:03 ADT | `run-meta-ads-tracker-refresh.cjs` | Pulls last_7d {CLIENT_CODE} ad insights; commits if changed; emits `ready-for-review` signal on hard stop or non-zero exit. |
| `ca.somemarketing.smos.hygiene-sweep.plist` | Daily 03:30 local | `run-hygiene-sweep.cjs` | Sequences the deterministic cleanup + self-healing routines (rotate-jsonl, artifact-cleanup, homeostasis, reconcile-task-outcomes, reconcile-vault-drift, recover-btw) plus the heartbeat consumer and manifest/schema drift sweep. **Every child runs dry-run/report-only** (grounding A3); exit-code aggregation, runs ledger capped at 200, file kill-switch `_dev/state/hygiene-sweep/disabled`. |

## Usage

```
tools/launchd/install.sh                      # install/reload all plists
tools/launchd/install.sh meta-ads-tracker-refresh-{CLIENT_CODE}   # one specific
tools/launchd/install.sh --status             # are they loaded?
tools/launchd/install.sh --uninstall          # unload + remove all
```

The installer hashes the source vs. the installed copy and skips re-copying when
unchanged. It always reloads the agent so a code change in the wrapper script
takes effect immediately.

## Why .cjs and not .sh

macOS TCC (Transparency, Consent, and Control) blocks `/bin/bash` from reading
files in `~/Documents` when launched by `launchd`. `node` invoked via
`/usr/bin/env node` inherits the Full Disk Access grant from prior tooling
(matches the precedent set by `ca.somemarketing.smos.contextual-sweep.plist`).
All wrappers in this dir use the node entrypoint pattern.

## Manual smoke-test (operator)

After install, fire the agent immediately to confirm the token resolution
path works under launchd's stripped env:

```
launchctl kickstart -k "gui/$(id -u)/ca.somemarketing.smos.meta-ads-tracker-refresh-{CLIENT_CODE}"
sleep 15
tail _dev/state/meta-ads-tracker/refresh.stdout.log
tail _dev/state/meta-ads-tracker/refresh.stderr.log
ls _dev/state/meta-ads-tracker/runs/
cat _dev/state/meta-ads-tracker/runs.jsonl
```

If `runs.jsonl` has no entry after 15s, the job is hung — most likely on
`op read` waiting for an unauthenticated session. Confirm with
`op signin` from your terminal, then re-kickstart.

## Why this lives in-repo

- Plist + wrapper get peer-reviewed alongside the work they automate.
- New laptop = `tools/launchd/install.sh` and you're back to the same routines.
- Uninstall is a single command, not "remember which files I dropped in
  `~/Library/LaunchAgents/` six months ago."
