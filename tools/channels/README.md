# Channels — iMessage ingestion + outbound drafting

Local macOS automation for a one-way iMessage ingestion bridge (read incoming
texts, forward matching ones to a Dart-style intake board) plus a
human-approval-gated outbound drafting flow. Nothing here sends a message
without an explicit approval step; the ingestion side is verbatim-forward
only and never auto-executes or auto-claims anything.

## Contact allowlist sync

- `lib/contacts-reader.js` — reads members of a named macOS Contacts group (default `"Dart Inbox"`) via `osascript`, no third-party dependency.
- `lib/nanp-normalize.js` — normalizes phone numbers to E.164 NANP format; passes emails through lowercased.
- `sync-contacts-allowlist.js` — source of truth is your Contacts group; syncs into an access allowlist and an ingestion-config contact list, touching only the entries it manages (anything you added by hand stays untouched). Refuses to run if the Contacts group is empty (anti-wipe guard).

```bash
node sync-contacts-allowlist.js --dry-run
node sync-contacts-allowlist.js
node sync-contacts-allowlist.js --group "My Allowlist Group" --json
```

This writes `~/.claude/channels/imessage/access.json` and `_dev/config/text-ingestion.json`. **No real allowlist or contact data ships in this repo** — see `access.example.json` and `text-ingestion.example.json` for the documented shapes; copy them to the real paths (or let `sync-contacts-allowlist.js` create them from your own Contacts group) before running anything live.

## Ingestion watcher

- `lib/text-ingestion-state.js` — loads/validates `_dev/config/text-ingestion.json`, persists per-contact watermarks in `_dev/state/text-ingestion.state.json`. Enforces the safety invariant that `safety.outbound_messaging` must be `"NEVER"` — this module refuses to load a config that isn't read-only.
- `watch-text-ingestion.js` — the watcher itself: polls for new matching messages, forwards to your Dart-style intake board with a hinted intake-schema block.

## Outbound drafting

- `outbound/draft.cjs` / `outbound/send.cjs` / `outbound/lib/config.cjs` / `outbound/lib/audit.cjs` / `outbound/lib/audit-emit.cjs` / `outbound/cli.sh` — a draft → human-approve → send pipeline. `lib/config.cjs` hard-refuses to load if `safety.ai_can_approve` or `safety.ai_can_send` is anything other than `false` — approval and sending are human-gated by construction, not just by convention.

Config lives at `_dev/config/outbound-imessage.json` (not shipped — no schema example included in this pass since it wasn't audited as part of this port; follow `outbound/lib/config.cjs`'s `load()` for the exact required shape: `schema: "OutboundIMessage/1.0"`, a `safety` block, and `recipient_allowlist`).

## Setup

Copy `env.example` to `.env` if you want to override `INBOX_DARTBOARD`. No credentials are required — this is local macOS automation, not an API integration.
