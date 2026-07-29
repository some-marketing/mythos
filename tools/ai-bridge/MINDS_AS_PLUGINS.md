# Minds as Plugins — the portability contract

> S5 of adaptive-mind-router. Operator constraint (2026-06-11, binding):
> "anyone with any kind of model or any subscription or harness or api key can use this system."

## The contract

A **mind** is anything that can answer a dispatch. Every mind reduces to:

```json
{
  "id": "openrouter:anthropic/claude-sonnet-4",
  "invoke": "ai-bridge provider + model id (or CLI command for harness minds)",
  "auth_env_var": "OPENROUTER_API_KEY (resolved op→env→file; the KEY never leaves the local process)",
  "cost_model": "per-token | subscription | free-local",
  "capability_tags": ["bounded_patch", "structured_review"]
}
```

Three shapes, one contract:
- **API key** → ai-bridge provider (`openrouter`, `openai-compatible`, `gemini-api`). Dynamic model
  ids (`openrouter:<vendor>/<model>`) require zero code.
- **Subscription CLI** → harness actor (claude, codex, gemini, opencode, cursor — the actor
  registry + instruction adapters already generate per-harness surfaces).
- **Local binary** → `ollama` provider; entrance exam = `tools/local-model-verify` before any
  routed work.

## Where a new mind plugs in

1. Reachability: ai-bridge `listProviders()` / actor registry — nothing else needs to know how it's invoked.
2. Evidence: the tier ledger + matrix key on mind-id strings; an unbenchmarked mind starts as
   pure exploration (`benchmark-priors.json` seeds nothing it can't defend) and earns cells
   through lived, debriefed, distinct-verdict evidence like every other actor.
3. Routing (shadow now): tier-routing + matrix recommendations are mind-agnostic.

## Graceful degradation to one mind (binding)

The system must work for someone with a single model:
- convene degrades to **declared single-voice** (the degradation-marking machinery already exists);
- distinct-intelligence evidence bars are **marked unmet, not faked** — single-voice samples are
  recorded with their provenance and never count as distinct verdicts (G3);
- the repair ladder collapses to fewer tiers; protected classes still skip to the top tier, which
  may be the operator themselves;
- more minds buy more capability and stronger evidence — they are never a requirement to run.

## Secrets rule (constitutional)

Credential bytes never appear in Claude-visible parameters, matrix data, dispatch artifacts, or
logs. Resolution happens inside local processes (1Password CLI → env var → legacy auth file).
