# tools/notify — Twilio Calling

Multi-provider notify surface. Current provider: **Twilio**.

## Files

| File | Purpose |
|------|---------|
| `twilio-creds.js` | Runtime credential resolver, delegating to `tools/lib/resolve-credential.cjs` |
| `twilio-api.js` | Thin HTTPS wrapper for Twilio REST API |
| `twilio-call.js` | **Main CLI** — smoke, announce, converse |
| `twilio-webhook-server.js` | Express-compatible webhook server for `<Gather>` loops (your own host) |
| `twilio-function-handler.js` | Twilio Serverless Function equivalent (no server needed) |
| `twilio-smoke.js` | Credential + account + numbers audit; writes `twilio-status.md` |
| `twilio-sms.js` | Send an SMS notification to the operator |
| `twilio-inbox.js` | Poll for inbound SMS replies |
| `voice-brain.cjs` | Local-Ollama conversational brain for the voice bridge |
| `notification-hook.sh` | Claude Code Notification-event bridge (desk banner only) |
| `operator-ping.sh` | One reusable "come check on this" signal (desk + optional phone) |

## Credential Setup

See `SETUP.md` in this directory for the full setup flow. Credentials resolve
through `tools/lib/resolve-credential.cjs`'s 4-source chain (env → macOS
Keychain → 1Password → env-file) — see `creds.config.json` for the exact
field list and `env.example` for the environment-variable form.

Env overrides (all optional):
```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_API_KEY_SID
TWILIO_API_KEY_SECRET
TWILIO_FROM_NUMBER
TWILIO_OPERATOR_PHONE
```

## Usage

### Smoke test (no call placed)

```sh
node tools/notify/twilio-call.js --smoke
# or for full status report:
node tools/notify/twilio-smoke.js
```

### Announce call (one-way TTS)

```sh
node tools/notify/twilio-call.js --say "Hello from Mythos. This is a test."
```

### Conversational call — single gather (no server needed)

```sh
node tools/notify/twilio-call.js \
  --converse \
  --say "Mythos here. What would you like to do?"
```

The operator can speak; Twilio transcribes it and the call ends. This mode
does **not** loop the spoken input back to a brain — it's a one-gather test
of the speech path.

### Conversational call — full loop via your own webhook host

```sh
# 1. On your own host:
scp tools/notify/twilio-webhook-server.js <user>@<your-host>:~/twilio-webhook/
ssh <user>@<your-host> "cd ~/twilio-webhook && npm install express 2>/dev/null; \
  PORT=3100 node twilio-webhook-server.js &"

# 2. Place call pointing to your host:
node tools/notify/twilio-call.js \
  --converse \
  --say "Mythos here. What would you like to do?" \
  --webhook-url http://<your-host>:3100/gather
```

### Conversational call — via Twilio Serverless Function (no server needed)

1. Copy `twilio-function-handler.js` into Twilio Console → Functions → Services
2. Deploy. Note the function URL (e.g. `https://your-service-xxxx.twil.io/gather`)
3. Call with `--webhook-url`:

```sh
node tools/notify/twilio-call.js \
  --converse \
  --say "Mythos here. What would you like to do?" \
  --webhook-url https://your-service-xxxx.twil.io/gather
```

## Conversation Loop Architecture

```
twilio-call.js         Twilio REST API       Operator's Phone
     │                       │                      │
     │  POST /Calls.json      │                      │
     │  Twiml=<Gather...>    │                      │
     │──────────────────────>│  Rings operator      │
     │                       │─────────────────────>│
     │                       │  Operator speaks     │
     │                       │<─────────────────────│
     │              POST /gather (SpeechResult)      │
     │                       │──────────────────────>webhook-server / Twilio Function
     │                       │                              │
     │                       │  TwiML <Gather><Say>  │
     │                       │<─────────────────────        │
     │                       │  Speaks response     │
     │                       │─────────────────────>│
     │                       │  (loop until goodbye)│
```

## Multi-Provider Interface

This module implements the generic `notify/call` surface:

```js
// Future: notify/call.js dispatcher
// provider=twilio → tools/notify/twilio-call.js
// provider=vonage → tools/notify/vonage-call.js (not yet implemented)
```

Call signature convention: `--to <E.164> --say <text> [--converse] [--webhook-url <url>]`

## Security

- Operator phone number is **never hardcoded** in any file
- Credentials are resolved at runtime only, via `tools/lib/resolve-credential.cjs`;
  never written to disk, never echoed
- Secrets are passed to child processes via env, never argv
- Twilio signature validation available via `--validate-sig` on webhook server

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `No usable Twilio credentials found` | credentials not resolvable from any of the 4 sources | Check `SETUP.md` / `env.example`; verify labels match `creds.config.json` if using 1Password |
| `HTTP 401` from Twilio | Wrong Account SID / Auth Token | Verify in Twilio Console → Account Info |
| `No voice-capable Twilio number` | No numbers purchased | Buy a number at console.twilio.com |
| `op` command hangs | 1Password desktop app not running / biometric needed | Open 1Password app, re-authenticate, or use a service-account token |
| Webhook 403 | Twilio signature mismatch | Ensure `--webhook-url` matches the exact public URL Twilio sees |
