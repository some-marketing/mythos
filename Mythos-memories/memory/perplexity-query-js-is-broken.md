---
name: perplexity-query-js-is-broken
description: "tools/ai-bridge/perplexity-api/query.js hangs because it shells out to `bunx pplx`; the API key is valid — call the endpoint directly"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7c7d1278-0292-4071-932f-f733e234aa05
  modified: 2026-07-31T01:48:21.470Z
---

`tools/ai-bridge/perplexity-api/query.js` does **not** call the Perplexity API. It shells out to a third-party CLI via `bunx pplx`, and that indirection hangs indefinitely — observed twice on 2026-07-29 (19 minutes and 7 minutes, zero output, no error), including on a one-line prompt with the cheapest model, so it is not prompt size or model choice.

**The credential is fine.** `op item get smos-perplexity-key --vault Automation --fields label=credential` resolves without prompting, and a direct `curl` to `https://api.perplexity.ai/chat/completions` with that key returned HTTP 200 with a valid answer.

**Workaround until fixed:** resolve the key with `op`, then POST directly to `https://api.perplexity.ai/chat/completions` with `{"model":"sonar-pro","messages":[{"role":"user","content":"..."}]}`. Build the body with a JSON writer rather than shell interpolation — research prompts contain quotes and newlines that break heredocs.

**UPDATE 2026-07-30: the Pro browser path is now the WORKING rung.** Operator logged in (session saved at `~/.Mythos/browser_profiles/perplexity/storage_state.json`) and the driver was repaired + smoke-verified (mythos commit 84c19bd00): real-keystroke typing (Lexical ignores DOM injection), cookie-modal dismissal, the `{CLIENT_CODE}` placeholder bug, and a main-region extraction fallback. Use `node tools/ai-bridge/perplexity-browser.js --prompt <file> --output <json>`. Re-run `perplexity-auth.js` only when the session expires.

**API-key caveat (2026-07-30):** the mythos `.env` has `PERPLEXITY_API_KEY=` EMPTY, and `run-with-op.sh` could not resolve a usable field from the 1Password item on this host — the earlier "credential is fine" claim was observed via direct `op` + curl on 2026-07-29 and may need `PPLXOP_FIELD` set to the right field label. `tools/perplexity/cli.js` (direct HTTPS, no bunx) is the right API-path entrypoint once a key is in env.

**Real fix for query.js:** replace the `bunx pplx` indirection with a direct HTTPS request (or just use `tools/perplexity/cli.js`).

Used by the middle leg of [[loop-123-perplexity-321]].
