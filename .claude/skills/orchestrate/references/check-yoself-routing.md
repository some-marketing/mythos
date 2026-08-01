# check-yoself routing

**Loaded by:** `.claude/skills/orchestrate/SKILL.md` (lazy reference)
**Authoritative rules:** `instructions/canonical/guardrails.md` Discipline #1 (Cross-Verification Law) and #2 (Cost-Effective Intellect Calls)

## Purpose

Every orchestration cycle ends with a mandatory check-yoself step. The check must be performed by a **different intelligence** than whoever produced the output being checked. This file is the routing contract: given a producer lane, which available verifier lane to pick.

This file also honors the Cost-Effective Intellect Calls discipline by preferring the smallest/cheapest verifier that can do the check honestly.

## The three-tier adapter architecture

Mythos reaches intelligence through three tiers. Each tier is a different substrate. The kernel sits above all three and routes by task + availability + cost + cross-verification distinctness.

### Tier 1 — Local (free, fast, private)

Models running on the operator's own hardware.

- **Adapter on disk:** `tools/ai-bridge/adapters/ollama.js`
- **Typical models** (vary by operator):
  - Qwen family — mechanical tasks, syntax checks, first-pass filters
  - Gemma 4 — quality checks, short reasoning
  - Llama 3.x, phi-4, MLX-native models — task-dependent
- **Use for:** mechanical verification, schema/syntax checks, filtering, any task that does not need frontier capability
- **Privacy:** runs entirely local, no data leaves the machine
- **Cost model:** free after model download; constrained by host RAM and thermal budget

### Tier 2 — Subscription web-UI (affordable, frontier-capable)

Frontier models reached through the operator's active web/app subscriptions, driven via the Chrome browser MCP.

- **Adapter on disk:** NOT YET BUILT as of 2026-04-14. Chrome MCP exists; no browser-adapter bridge in `tools/ai-bridge/adapters/` yet. This is a pending slice.
- **Subscriptions reachable via browser automation:**
  - ChatGPT Plus ($20/mo) / ChatGPT Pro ($200/mo) — GPT-5, o1 Pro, deep research, Codex-tier reasoning
  - Gemini Advanced ($20/mo) / Google AI Ultra ($250-290/mo) — Gemini 3.x Pro, Veo, NotebookLM, Deep Research
  - Claude Pro ($20/mo) / Claude Max ($100-200/mo) — Sonnet/Opus frontier tier
- **Liberation floor:** $60/mo total for the entry tier of all three. Mythos MUST remain reachable from this tier.
- **Use for:** frontier creative work, deep reasoning, cross-verification of frontier outputs, any task requiring best-of-provider where the operator has not bought API credits on top
- **Cost model:** flat subscription, no per-token cost, no rate surprises for the operator
- **Cost of building:** real — web UIs change, sessions drift, anti-bot measures exist. But forced to exist by the liberation floor.

### Tier 3 — API (premium, programmatic, fastest)

Direct provider APIs via pay-per-token credits.

- **Adapter on disk:** `tools/ai-bridge/adapters/openai-compatible.js` (works with OpenAI, OpenRouter, any OpenAI-compatible endpoint). Also `tools/ai-bridge/adapters/gemini-api.js` for Google AI Studio direct.
- **Providers:**
  - OpenAI API — GPT-5, o1, o4 families. NOTE: OpenAI API billing is separate from ChatGPT subscriptions.
  - Google AI Studio / Vertex AI — Gemini 3.x family. NOTE: likely bundled into Google AI Ultra subscription at no additional cost (verify per-operator).
  - Anthropic API — Claude Sonnet/Opus. NOTE: Claude Code runs natively on Claude Max subscription, so the API adapter is only needed for non-Code use.
  - OpenRouter — single-key gateway covering all three providers (optional convenience layer).
- **Use for:** high-volume batches, fast programmatic calls, situations where web UI latency is unacceptable, operators with explicit API credit budgets

## The routing principle

Given a task T and a set of available verifier lanes L:

1. **Identify the task type.** Use the intellect matrix from memory (`project_brain_metaphor_model_rotation.md`):
   - Mechanical / syntax → Qwen or Gemma (Tier 1)
   - Quality / short reasoning → Gemma, Sonnet (Tier 1 or 2)
   - Architectural / big-picture → Sonnet, Opus, GPT-5 (Tier 2 or 3)
   - Decision / rigor / audit → Codex, o1 Pro (Tier 2 via Codex CLI bridge, or Tier 3)
   - Creative / reframe / breadth → Gemini 3.x Pro (Tier 2 or 3)
   - Pure reasoning / math → o-series (Tier 2 or 3)

2. **Rank available lanes for T** by capability × speed × cost × distinctness-from-producer.

3. **Pick the cheapest lane that meets capability.** Start with Tier 1. Escalate to Tier 2 only if Tier 1 cannot honestly do the task at quality. Escalate to Tier 3 only if Tier 2 is unavailable or latency-critical.

4. **For check-yoself specifically:** the verifier lane must be the MOST DIFFERENT available lane from the producer. Different provider if possible. Different substrate (local vs cloud) if possible. Different model family if possible.

## What counts as a "different intelligence"

A lane is DIFFERENT from another if at least one of the following holds:

- Different model provider (Anthropic vs OpenAI vs Google) — strongest distinctness
- Different substrate (local Ollama vs cloud API vs browser-driven web UI)
- Different model family within provider (Claude Opus vs Claude Sonnet is weak distinctness; Claude vs GPT is strong)
- Different subscription account (another operator's subscription is not this operator's subscription)

A lane is NOT different if:

- Same session, same model, same context window (self-review — the failure mode)
- A subagent spawned from the same parent Claude session (still the same Claude, same weights, same posture; the subagent mechanism does not satisfy the law)
- Re-reading own output with different framing or at a later time (still the same model)

Subagents of the SAME provider are a grey zone. A `skill-auditor` subagent is still Claude. It is useful for structural audit but DOES NOT satisfy cross-verification by itself. Pair it with a different-provider check when the stakes warrant.

## The truthful-block rule

If NO different-intelligence lane is available when check-yoself is required, the orchestrator MUST block truthfully rather than self-verify.

Concretely: write a `HandoffSignal/1.0` with:

- `lifecycle_state: blocked`
- `blocked_by: "no available cross-verification lane for check-yoself"`
- `recommended_next_actor: operator`
- `recommended_next_command`: the adapter-wiring or credential step the operator needs to take to unblock

The operator can then either wire an adapter, reload credentials, or explicitly accept the risk of un-checked output (in writing, in the signal) before the loop closes.

**Self-review is not a fallback. Self-review is the failure mode.** See `feedback_cross_verification_law.md` and the session debrief where the drift was named.

## Current availability (snapshot 2026-04-14)

Adapters that actually resolve as of this writing:

| Tier | Lane | Status | Notes |
|---|---|---|---|
| 1 | Ollama local | Working | Qwen and Gemma 4 31B benchmarked; see `project_local_model_verification.md`, `project_gemma4_benchmark.md` |
| 2 | ChatGPT Plus/Pro browser | NOT BUILT | Chrome MCP available, browser adapter not yet written |
| 2 | Gemini Advanced / AI Ultra browser | NOT BUILT | Same — browser adapter pending |
| 2 | Claude Pro/Max browser | NATIVE | This session runs on Claude Max via Claude Code. No browser adapter needed for Claude lane. |
| 2.5 | Codex CLI bridge | Working | `tools/signals/run-codex-bridge.js` + codex-bridge machinery. Runs Codex CLI out-of-process. De facto cross-verification lane today. |
| 3 | OpenAI API | Unverified | `openai-compatible.js` adapter exists; no verified working key for OpenAI direct as of this snapshot |
| 3 | Google AI Studio API | Unverified | `gemini-api.js` adapter exists; likely bundled into Google AI Ultra subscription (verify at `aistudio.google.com`) |
| 3 | Anthropic API | Not needed for Claude Code sessions | Claude Code covers this natively |
| 3 | OpenRouter | Broken | `OPENROUTER_API_KEY` present but returns `401 User not found`; account issue. |

Which means **today**, the cross-verification lanes that actually resolve are:

1. **Tier 1 local Ollama** (Qwen, Gemma 4)
2. **Codex CLI bridge** (out-of-process, Codex as verifier)

Every other lane requires either an adapter build (Tier 2 browser) or a credential check (Tier 3 API). The `check-yoself` routing logic must therefore default to "try Tier 1 first, fall back to Codex bridge, then truthfully block" until the Tier 2 adapters exist and Tier 3 credentials are verified.

## Distribution note

The three-tier picture exists because Mythos must work for operators at different spend levels:

- **Free tier operator:** Tier 1 only (local models). No cross-verification across providers; check-yoself routes to a DIFFERENT local model family (Qwen producer → Gemma verifier, or vice versa). Weaker distinctness but still non-trivial.
- **$60/mo operator:** Tier 2 subscription web-UI for all three providers via Chrome MCP. Full three-brain cross-verification. The liberation floor.
- **$200+/mo operator:** mix of Tier 2 and Tier 3, optimized for speed. Full three-brain plus programmatic speed.
- **Premium operator:** all three tiers active. Kernel picks the cheapest distinct lane for every verification, scales to high-throughput cycles.

Mythos MUST be functional at every tier. The liberation floor ($60/mo) is not aspirational — it is the contract. Every architectural decision that adds a requirement above the floor is a contract violation and must be called out.

## Cross-references

- **Canonical rules:** `instructions/canonical/guardrails.md` — Discipline #1 (Cross-Verification Law), #2 (Cost-Effective Intellect Calls), #4 (Delegation Spawn Verification), #7 (Brain-Metaphor Model Rotation)
- **Memory:** `feedback_cross_verification_law.md`, `feedback_cost_effective_intellect_calls.md`, `project_brain_metaphor_model_rotation.md`, `project_local_model_verification.md`, `project_gemma4_benchmark.md`, `project_bridge_depth_profiles.md`
- **Adapters on disk:** `tools/ai-bridge/adapters/ollama.js`, `tools/ai-bridge/adapters/openai-compatible.js`, `tools/ai-bridge/adapters/gemini-api.js`
- **Codex bridge machinery:** `tools/signals/run-codex-bridge.js`, `tools/signals/lib/codex-bridge.js`, `tools/signals/watch-codex-bridge.js`
- **Pending slice:** browser-adapter bridge for Tier 2 — this is a prerequisite for distribution at the $60/mo liberation floor
