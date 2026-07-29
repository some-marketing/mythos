# wifi-capture

## What this does

When the operator joins a wifi network on this Mac, the network's password
is captured from macOS Keychain into the 1Password vault `Wifi` as a Login
item — automatically, on-device. Password bytes never leave the device and
never transit any LLM tool param.

## Enable

```
bash tools/wifi-capture/install-watcher.sh install
```

Requires an authenticated `op` session (`op whoami` must succeed) with
access to the `Wifi` vault. Operator-gated; no other actor runs this.

## Disable

```
bash tools/wifi-capture/install-watcher.sh uninstall
```

## Status

```
bash tools/wifi-capture/install-watcher.sh status
```

Reports whether the LaunchAgent plist is installed, whether `launchctl` has
it loaded, and whether the watcher process is alive.

## First-run keychain prompt

On the first capture per SSID, macOS prompts for keychain access to read
the saved Wi-Fi password. Click **Always Allow** so subsequent captures
run silently. Denying the prompt makes that SSID's capture exit `3`
(`keychain denied or absent`).

## Where logs live

- `_dev/state/wifi-capture.jsonl` — append-only event log (no passwords).
- `_dev/state/wifi-capture.log` — launchd stdout.
- `_dev/state/wifi-capture.err.log` — launchd stderr.
- `_dev/state/wifi-capture.lock` — single-instance lockfile (auto-removed).

## Constitutional note

Passwords never leave the device. The capture script reads the password
via `security find-generic-password -wa` (local) and writes it via the
local `op` CLI to the `Wifi` vault. No password byte is logged or sent
through any LLM tool param. The watcher does NOT fetch or bake an
`OP_SERVICE_ACCOUNT_TOKEN`; it relies on the operator's local `op`
authentication and fails closed when `op whoami` is unauthenticated.

## Failure modes

- **Vault not shared with current `op` session.** `op vault list` won't
  show `Wifi`; capture exits `2`. Re-share the vault to the signed-in
  account, then re-run install.
- **Keychain prompt denied.** Capture exits `3` for that SSID. Re-trigger
  by reconnecting and choosing **Always Allow**.
- **SSID not in preferred-networks.** `security find-generic-password`
  has no entry; capture exits `3`. Join the network through System
  Settings first so macOS persists it.
- **`op whoami` unauthenticated.** Capture exits `5`. Sign in: `op signin`.
- **Not connected on `en0`.** Capture exits `4`. Set `WIFI_INTERFACE` if
  using a different interface (e.g. USB tethering).

## What's not here

The source this was extracted from had a one-shot `seed-fill.sh` that
back-filled a fixed list of the operator's own real network names into
pre-existing 1Password item ids. That script is inherently non-reusable (it
hardcodes one person's home network names and 1Password item ids) and was
excluded rather than genericized — there's no reusable pattern left once you
remove the real data. The three scripts here (watcher, capture, install) are
the full generic mechanism; nothing about them is bound to any specific
network.
