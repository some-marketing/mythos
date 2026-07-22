# boot

Credential-seeding and credential-state primitives, used at the start of a
session or before a tool's first run.

## Files

- `keychain-store.sh <service> <account>` — securely store a secret in macOS
  Keychain without exposing it to shell history, tool-call arguments, or a
  conversation log. Reads the secret with `read -s` (never echoed), stores it
  via `security add-generic-password`, then verifies by re-reading and
  length-checking. This is the seeding primitive every tool's SETUP.md points
  at for its Keychain source (see `tools/lib/resolve-credential.cjs`).
- `verify-credentials.cjs` — read-only session-boot report of which AI-CLI
  credential lanes are configured (Codex/ChatGPT auth mode, Gemini API key or
  OAuth cache, direct OpenAI/Anthropic API keys, local Ollama reachability).
  Never writes, never rotates, never prompts, never prints secret material —
  only mode, timestamps, prefix hints, and anomaly names. Ported unchanged;
  extend it yourself when you wire a new lane.

One private-host key-restore script was not ported — it restored a specific
private host's key material and has no generic equivalent in this port.

## Usage

```
tools/boot/keychain-store.sh DART_TOKEN mythos
node tools/boot/verify-credentials.cjs
```
