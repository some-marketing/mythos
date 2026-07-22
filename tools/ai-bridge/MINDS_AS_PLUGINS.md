# Minds as Plugins — the portability contract

> Design constraint (binding): anyone with any kind of model, subscription,
> harness, or API key can use this system.

## The contract

A **mind** is anything that can answer a dispatch. Every mind reduces to:

```json
{
  "id": "openrouter:anthropic/claude-sonnet-4",
  "invoke": "ai-bridge provider + model id (or CLI command for harness minds)",
  "auth_env_var": "OPENROUTER_API_KEY (resolved env -> keychain -> 1Password -> env-file; the KEY never leaves the local process)",
  "cost_model": "per-token | subscription | free-local",
  "capability_tags": ["bounded_patch", "structured_review"]
}
```

Three shapes, one contract:
- **API key** → an ai-bridge provider (`openrouter`, `openai-compatible`,
  `gemini-api`). Dynamic model ids (`openrouter:<vendor>/<model>`) require
  zero code.
- **Subscription CLI** → a harness actor (a Claude/Codex/Gemini/etc CLI —
  see `tools/autonomy/lib/actor-registry.cjs` for the actor identity
  registry this port's `lib/actor-router.js` resolves against).
- **Local binary** → the `ollama` provider; verify local reachability with
  `adapters/ollama.js`'s `checkHealth()` before routing work to it.

## Where a new mind plugs in

1. Reachability: ai-bridge `listProviders()` (`lib/dispatchers.js`) — nothing
   else needs to know how it's invoked.
2. Evidence: capability tags on mind-id strings; an unbenchmarked mind starts
   as pure exploration and earns routing weight through lived, debriefed,
   distinct-verdict evidence like every other actor.
3. Routing: `lib/routing-policy.js`'s fallback tables are mind-agnostic —
   they route by workflow type and provider capability, not by which vendor
   happens to be behind the provider.

## Graceful degradation to one mind (binding)

The system must work for someone with a single model:
- multi-voice review degrades to a declared single-voice sample when only one
  mind is configured — that sample is recorded with its provenance and never
  counted as a distinct-intelligence verdict;
- the escalation ladder (`lib/escalation-policy.js`) collapses to fewer
  tiers; high-risk work still routes to whatever the top tier is, which may
  be the operator themselves;
- more minds buy more capability and stronger evidence — they are never a
  requirement to run.

## Secrets rule (constitutional)

Credential bytes never appear in Claude-visible parameters, matrix data,
dispatch artifacts, or logs. Resolution happens inside local processes
through `tools/lib/resolve-credential.cjs`'s 4-source chain (environment
variable → macOS Keychain → 1Password → env-file fallback).
