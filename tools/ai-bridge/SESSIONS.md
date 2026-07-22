# Sessions — why this port doesn't need any

The private original of this tool also shipped a set of browser-automation
dispatchers (a Playwright-driven Gemini browser session, a Perplexity browser
session, and related session-persistence tooling: one-time login scripts,
`storage_state.json` files saved outside the repo, session-health checks,
and refresh-on-expiry handling).

None of that shipped in this port. Every adapter here (`adapters/ollama.js`,
`adapters/openai-compatible.js`, `adapters/openrouter.js`,
`adapters/gemini-api.js`) talks to its provider over a stateless HTTP request
using a resolved API key (or no credential at all, for local Ollama) — there
is no browser, no cookie jar, and no login flow to keep alive across runs.

If you want to add a browser-driven provider to this dispatch core later:

- Keep session state **outside the repo**, at a stable, absolute,
  per-user path (the private original used `~/.mythos/browser_profiles/<provider>/storage_state.json`
  — pick an equivalent path under your own home directory, not inside this
  tree, so it survives `git clean` and repo moves).
- Give it a one-time interactive login script and a headless session-check
  script, following the same shape as the API adapters here: a
  `getInfo()` / `checkHealth()` / `listModels()` / `invoke()` surface so it
  can register as a dispatcher in `lib/dispatchers.js` like any other
  provider.
- Never persist raw credentials (passwords, API keys) alongside the session
  file — the session file *is* the credential once logged in, so treat it
  with the same care as a bearer token.

For the credential-bearing (non-browser) providers this port ships, see
`SETUP.md` for the resolution chain and `creds.config.json` for the field
list.
