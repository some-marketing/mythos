# Mind & Harness Capabilities Matrix

> Living artifact (operator directive 2026-08-05T05:15Z). Every dispatch outcome
> updates it; rotation choices cite it. Minds and harnesses tracked SEPARATELY —
> reasoning quality is a mind property; transport, tools, quoting, and context
> limits are harness properties. Never lock in; test as we learn and grow.

## Seed evidence — the 2026-08-04/05 marathon (honest baseline: near-zero rotation)

### Minds

| Mind | Role tonight | Observed strengths | Observed gaps / unknowns |
|---|---|---|---|
| codex GPT-5.5 | ALL 15 distinct trials (plans + code) | Relentless finding quality: 40+ real findings, zero fabrications observed; caught cross-artifact drift (JSON/MD parity), spec ambiguity (parameter-set boundary), statistical over-claims, its own prior findings' closure; reads actual code before ruling | Monoculture risk: its blind spots are now OUR blind spots — unmeasured; occasionally altitude-confuses plan-time vs run-time (goal-round r2) |
| Claude opus (workers) | All frontier builds (5 major slices) | Discovery-grade diagnosis (inert weights, dead coordinates, one-boot-lag); refuses to tune-to-pass; honest verified/unverified labeling | Never reviewed anything (untested as reviewer); self-report calibration unmeasured against other builders |
| Claude sonnet (workers) | All bounded builds/fixes/git | Reliable spec execution; good deviation disclosure | Untested at frontier tasks tonight |
| Claude haiku | 2 mechanical fixes | Exact-spec application, fast | Untested beyond mechanical |
| hermes (frontier via OpenRouter) | 1 skill review (/go) | Found real spec holes (undefined acceptance-grade, prophecy trigger, boundary loophole) — quality comparable to codex on that artifact | n=1; untested on code/plans |
| gemini | 1 research leg | — | Infra failure (web-search 500s ×3) — no quality data at all; RETRY EARLY in rotation |
| DeepSeek | 1 intended dispatch | Correct failure-class instinct on the courier mystery (called "two storage views") | Openrouter silently substituted `auto` — the observation is NOT attributable to DeepSeek; codewhale lane untested by us tonight (it ran PR #12 independently — 11+ review rounds solo, strong circumstantial evidence) |

### Harnesses

| Harness | Tonight's evidence | Notes |
|---|---|---|
| codex CLI (managed bridge) | 15/15 runs completed; JSON framing wrapper error is cosmetic (results always landed) | Solid. `/review-task-plan` only registered command used — widen? |
| gemini CLI | Web-search 500s killed the run | Distinguish CLI-vs-API path in next trial |
| openrouter (freeform) | Completed, but SILENTLY substituted `openrouter/auto` for a pinned model | Model-pinning must be verified in the response metadata every time |
| hermes CLI | Clean interactive + resume (session recall worked) | Multi-provider: also a rotation gateway |
| pi | UNTESTED — operator: gateway to ALL OpenRouter models per invocation | Use to trial arbitrary models into rotation |
| codewhale TUI | Not dispatched by us; independently ran PR #12 (11+ codex-review rounds) | PRIMARY DeepSeek lane (operator). dispatch-bridge CLI validator doesn't accept it yet — tooling follow-up |
| opencode / opencode-local | Untested tonight | Local lane reserved for PII/credential payloads (standing rule) |

## Rotation policy (operator-ratified)

1. **Frontier tier owns planning-tier judgment** — reviews, design gates, synthesis.
   Frontier rotation: codex GPT-5.5, DeepSeek (via CODEWHALE primary; openrouter
   pinned-model fallback; pi for arbitrary models), gemini, hermes-frontier,
   Claude frontier. PRC rule: DeepSeek = non-sensitive payloads only.
2. **Scoped/bounded work rotates deliberately** where verification can hold the
   lane accountable; every dispatch records mind + harness + outcome here.
3. **Harnesses rotate too** — transport reliability, quoting, context, tool access
   are measured properties, not assumptions.
4. **Distinct-family review law is untouched** — rotation widens it, never weakens.
5. **Next concrete trials queued:** (a) DeepSeek-via-codewhale as reviewer on the
   goal-round S2 trial or its successor; (b) gemini retry (API path) on the next
   research leg; (c) pi trialing a model outside the current roster on a bounded
   review; (d) hermes on a code review (n=2 for its column); (e) an opus-reviews /
   codex-builds inversion on one low-risk slice to measure the family swap.
