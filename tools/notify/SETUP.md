# Setting up credentials for `notify` (Twilio SMS/voice)

This tool resolves its own credentials at runtime through
`tools/lib/resolve-credential.cjs` — a 4-source chain, first hit wins:

1. **Environment variable** — set it in your shell or CI config.
2. **macOS Keychain** — seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh <KEYCHAIN_SERVICE> <KEYCHAIN_ACCOUNT>
   ```
3. **1Password** — `op read op://<VAULT>/<ITEM>/<FIELD>`, resolved via a
   service-account token (`OP_SERVICE_ACCOUNT_TOKEN` env var, or a Keychain
   item named `mythos-1p-automation-token`/`mythos`).
4. **Env file fallback** — `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact keys.

## This tool's fields

See `creds.config.json` in this directory for the authoritative field list.
Twilio accepts either of two auth pairs, so every field is individually
optional — `twilio-creds.js`'s `buildAuth()` decides which usable combination
you've actually provided:

- **Account SID + Auth Token** (`TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`) — the
  standard pair, from Twilio Console → Account Info.
- **API Key SID + Secret** (`TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`) —
  create at Twilio Console → Account → API keys & tokens. Works without the
  Account SID; it's discovered automatically via `/Accounts.json` at runtime.
- `TWILIO_FROM_NUMBER` — a Twilio number you own (E.164). If unset, tools
  auto-discover the first capable owned number.
- `TWILIO_OPERATOR_PHONE` — your own personal phone number (E.164), the
  destination for calls/texts. **Never hardcode this** — always resolve it
  through one of the four sources.

Run this to regenerate `env.example` if the config changes:

```
node tools/lib/generate-env-example.cjs tools/notify/creds.config.json --out tools/notify/env.example
```

## 1Password item shape

If using the 1Password source, create one item (default: vault `Automation`,
item `mythos-twilio-api`) with field labels matching one of the candidates in
`creds.config.json` (e.g. `Account SID`, `Auth Token`, `API Key SID`,
`API Key Secret`, `Phone Number`, `Operator Phone`). Field-label matching
tries each candidate in order, so minor label variance is tolerated.

## Verify

```sh
node tools/notify/twilio-call.js --smoke
# or, for a full status report written to tools/notify/twilio-status.md:
node tools/notify/twilio-smoke.js
```

A successful verify reports which fields resolved (PRESENT/MISSING) and which
auth method is usable — never secret values. If nothing resolves, it names
the exact `tools/boot/keychain-store.sh <service> <account>` seed command for
each missing Keychain-backed field.
