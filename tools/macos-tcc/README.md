# macOS TCC signed-launcher pattern

A pattern for giving a background node job its own macOS TCC (Transparency,
Consent, and Control) identity, so it can use AppleEvents (Reminders,
Contacts, other apps) from a launchd agent without triggering a consent
prompt every run — background agents can't show consent prompts at all, so
the grant has to be primed once, interactively, against a signed identity
that stays stable across restarts.

## The pieces

- **`build-and-sign.sh`** — templates and code-signs a minimal `.app`
  wrapper around any node entrypoint. `AppTemplate.app/` is the starting
  skeleton it copies and stamps; the actual launcher script gets written
  fresh for your entrypoint and your `IDENTITY`.
- **`AppTemplate.app/`** — the template skeleton (`Info.plist` with
  placeholder `JOBNAME`/bundle-id fields, a placeholder launcher stub).
  `build-and-sign.sh` overwrites the launcher and stamps the plist per job.
- **`repoint-plists.sh`** — applies a directory of staged LaunchAgent plists
  (one per job, pointing at the built `.app` launcher instead of a shared
  node binary) with backup + transactional bootout/bootstrap.
- **`verify-permissions.sh`** — scans your installed LaunchAgents and
  reports which ones are still pointed at an unstable binary (a Homebrew
  path, `/usr/bin/env node`, or anything not matching your signed anchor).
- **`prime-permissions.md`** — the by-hand operator runbook tying the
  above together.

## Using this for your own jobs

1. Set `BUNDLE_ID_PREFIX` to something you own (e.g. `com.yourname.mythos`)
   and a code-signing `IDENTITY` you've created in Keychain Access (a
   self-signed certificate works for local-only use; no Apple Developer
   Program membership required for this pattern).
2. `build-and-sign.sh --job <name> --script /absolute/path/to/entry.cjs`
3. Follow `prime-permissions.md` to grant TCC and wire the LaunchAgent plist
   at the built `.app`.
4. Add more jobs the same way; `repoint-plists.sh` and
   `verify-permissions.sh` both work across your whole job set once you
   point `BUNDLE_ID_PREFIX` at your own prefix.

## What was excluded from this port

The source directory also had several real, already-built and signed `.app`
bundles wired to specific jobs (a contacts sync, a specific automated crawl
job, and others) plus their staged/backed-up LaunchAgent plists. None of
that ported: the built bundles carry one operator's actual code-signing
identity and bundle-id history, and the staged plists named real job
identifiers tied to that operator's own automation roster — none of it is
a reusable pattern once you strip the specifics, it's just their config.
What's reusable is the mechanism above, which is what shipped.
