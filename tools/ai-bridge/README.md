# AI Bridge — generic multi-provider dispatch core

A provider-agnostic dispatch layer for sending workflow-typed prompts (design,
research, analysis, classification, drafting, verification) to whichever LLM
provider is configured, and getting back a normalized result — regardless of
whether that provider is a local model, a cloud API, or a subscription CLI
harness.

This is the "minds as plugins" contract: see `MINDS_AS_PLUGINS.md` for the
portability rule this whole layer is built to satisfy — anyone with any kind
of model, subscription, harness, or API key should be able to plug into the
same dispatch surface with zero code changes for API-key providers.

## What's in this port

This slice ships the generic dispatch core plus four working provider
adapters. It does **not** ship the browser-automation dispatchers (Gemini
browser, Perplexity browser, etc.) from the private original — those are
out of scope for a public, credential-portable core and depend on
browser-session mechanics this port doesn't include. Everything here talks
to a provider over HTTP (local or cloud), never a headless browser.

### Adapters (`adapters/`)

| Adapter | Provider | Credential | Notes |
|---|---|---|---|
| `ollama.js` | Local Ollama server | none | `http://localhost:11434` by default (`OLLAMA_BASE_URL` to override). Also exposes a standalone `verify()` helper for local-model verification review. |
| `openai-compatible.js` | Any OpenAI-wire-compatible chat-completions endpoint | `OPENAI_API_KEY` (optional) | Defaults to `api.openai.com`; point `OPENAI_COMPAT_BASE_URL` / `OPENAI_BASE_URL` at any compatible gateway. |
| `openrouter.js` | OpenRouter | `OPENROUTER_API_KEY` (optional) | Thin preset over `openai-compatible.js` with OpenRouter's base URL — reaches any `openrouter:<vendor>/<model>` mind through one key. |
| `gemini-api.js` | Google Gemini REST API | `GEMINI_API_KEY` (optional) | Text/image prompts, including inline image output saving for image-capable Gemini models. Also runnable as a CLI (`node adapters/gemini-api.js --prompt ... --output ...`). |

Every credential above resolves through the shared BYO-credential resolver —
`tools/lib/resolve-credential.cjs` — via this tool's `creds.config.json`. See
`SETUP.md` for the exact resolution chain and seeding instructions. All three
keys are optional: this dispatch core is designed to keep working with zero,
one, or all three providers configured (plus Ollama, which needs no key at
all), degrading gracefully rather than requiring any one of them.

### Dispatch core (`lib/`)

| File | Purpose |
|---|---|
| `dispatch-contract.js` | The stable `DispatchRequest` / `DispatchResult` shapes every provider dispatcher accepts and returns. |
| `dispatchers.js` | Provider registry — `getDispatcher(provider)` resolves a dispatcher, lazily wiring the generic adapters (`ollama`, `openai-compatible`, `openrouter`) through the model registry. |
| `model-registry.js` | Resolves a concrete model id for a workflow type from run-override → project default → client default → global default → workflow default → fallback, checking each candidate against live provider inventory. |
| `model-runtime.js` | `invokeGenericModel()` — wires model selection + adapter invocation + (optional) lane enforcement into one call. `verifyArtifact()` builds on it for the verification workflow. |
| `provider-contract.js` | Normalized runtime shapes (`ModelDescriptor`, `ModelRequest`, `ModelResult`, `ModelSelection`) every generic adapter constructs and returns. |
| `routing-policy.js` | Workflow classification (local/cloud eligibility, privacy sensitivity, minimum capability) and the provider fallback table; `resolveRoute()` is the entry point. |
| `actor-router.js` | Enriches a route resolution with canonical actor identity (via `tools/autonomy/lib/actor-registry.cjs`) for harness-CLI actors (claude, codex, …), and resolves a distinct validator for a given producer. |
| `escalation-policy.js` | Confidence/risk-class rules for whether a local verifier's result can be accepted or must escalate to frontier review. |
| `verification-contract.js` | The structured `VerificationResult` shape (`verdict`, `confidence`, `findings`, `needs_escalation`, `escalation_triggers`) any verifier — local or cloud — must return. |
| `routing-artifact.js` | Durable, auditable JSON records of a routing decision (selected provider, fallback chain considered, constraints applied) — records the decision, does not execute a dispatch. |
| `validate-dispatch.js` | Provider-neutral checks on a `DispatchResult` (response exists, is parseable, matches expected artifact shape). |
| `model-interaction-ledger.js` | Append-only JSONL ledger of model interactions (`_dev/logs/model-interactions.jsonl`) for later scoring/audit. |
| `response-parser.js` | Extracts fenced code blocks (and unfenced HTML) from a text response — used by `adapters/gemini-api.js`. |

## Usage sketch

```js
const { getDispatcher } = require('./lib/dispatchers');
const { createDispatchRequest } = require('./lib/dispatch-contract');

const dispatcher = getDispatcher('openai-compatible'); // or 'ollama' / 'openrouter'
const request = createDispatchRequest({
  provider: 'openai-compatible',
  workflow_type: 'analysis',
  prompt: 'Review this diff for correctness.',
  context: {}
});

const result = await dispatcher.dispatch(request);
console.log(result.status, result.response);
```

Or run the Gemini REST adapter directly from the CLI:

```bash
node tools/ai-bridge/adapters/gemini-api.js \
  --prompt path/to/prompt.md \
  --output path/to/response.json \
  [--images path/to/img1.png,path/to/img2.png] \
  [--model gemini-2.5-flash]
```

## Extending: adding a new provider

1. Add the provider name to `VALID_PROVIDERS` in `lib/dispatch-contract.js`.
2. Either add it to the generic runtime (if it's OpenAI-wire-compatible — see
   `lib/model-runtime.js`'s `getGenericProviderAdapters()`) or create a
   dedicated dispatcher module and register its path in
   `lib/dispatchers.js`'s `DISPATCHER_MODULES`.
3. If it needs a credential, add it to `creds.config.json` and resolve it via
   `tools/lib/resolve-credential.cjs` — never invent a separate resolution
   path.
4. Add it to `PROVIDER_CAPABILITIES` and the relevant workflow entries in
   `ROUTING_TABLE` (`lib/routing-policy.js`) so routing can find it.

## What was deliberately left out of this port

- Browser-driven dispatchers (Gemini browser, Perplexity browser) and their
  session-management tooling — out of scope for a credential-portable public
  core; see `SESSIONS.md` for why this port doesn't need any of that.
- Cost-aware tiebreaking and granted-capability enforcement that the private
  original wired to an actor-promotion tier ledger and a provider-cost
  pricing ledger — neither ledger is part of this export slice, so that
  machinery isn't half-wired in here. `routing-policy.js` ships the complete,
  self-contained routing core (`resolveRoute`, `PROVIDER_CAPABILITIES`,
  `ROUTING_TABLE`) that the dispatcher and actor-router actually need.
- Client-work-adjacent utilities that happened to live alongside the dispatch
  core in the private tree (a WordPress page-builder styling helper, a Chrome
  profile resolver for browser automation, plan-audience linting scripts) —
  none of them are part of the generic dispatch contract.
