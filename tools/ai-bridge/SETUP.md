# Setting up credentials for `ai-bridge`

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

See `creds.config.json` for the authoritative field list. All three fields
are optional — this is a "minds as plugins" dispatch core (see
`MINDS_AS_PLUGINS.md`): it must keep working with zero, one, or all three
providers configured, degrading gracefully rather than requiring any one key.

- `OPENROUTER_API_KEY` — enables `adapters/openrouter.js`, which reaches any
  `openrouter:<vendor>/<model>` mind (Claude, GPT, Gemini, Llama, and anything
  else OpenRouter hosts) through one key.
- `OPENAI_API_KEY` — enables `adapters/openai-compatible.js` against
  `api.openai.com` by default, or any OpenAI-wire-compatible gateway you point
  it at via `OPENAI_COMPAT_BASE_URL` / `OPENAI_BASE_URL` (a self-hosted
  gateway may need no key at all).
- `GEMINI_API_KEY` — enables `adapters/gemini-api.js` (Gemini REST, text and
  image prompts).
- `adapters/ollama.js` needs no credential — it talks to a local
  `http://localhost:11434` (override via `OLLAMA_BASE_URL`) Ollama server.

Regenerate `env.example` if `creds.config.json` changes:

```
node tools/lib/generate-env-example.cjs tools/ai-bridge/creds.config.json --out tools/ai-bridge/env.example
```

## Verify

```
node -e "
const { createOllamaAdapter } = require('./tools/ai-bridge/adapters/ollama');
const { createOpenAICompatibleAdapter, resolveApiKey: openaiKey } = require('./tools/ai-bridge/adapters/openai-compatible');
const { createOpenRouterAdapter, resolveApiKey: openrouterKey } = require('./tools/ai-bridge/adapters/openrouter');
console.log('ollama: local, no credential needed');
console.log('openai-compatible key resolved:', Boolean(openaiKey()));
console.log('openrouter key resolved:', Boolean(openrouterKey()));
"
```

A successful resolve prints `true`/`false` for whether each provider's key
was found — never the secret value itself. `createOllamaAdapter().checkHealth()`
and the other adapters' `checkHealth()` methods report reachability without
printing any secret. If a Keychain- or 1Password-declared field is
unresolved, `tools/lib/resolve-credential.cjs` throws a `CredentialError`
whose message includes the exact `tools/boot/keychain-store.sh <service>
<account>` seed command to run — but note every field here is declared
`required: false`, so a missing key degrades the corresponding adapter
instead of throwing.
