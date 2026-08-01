# Ad Creative Guardrails

Framework-specific execution constraints. Extends system guardrails at `Mythos/.claude/guardrails.md`.

---

## Execution Modes Used

- **FINDINGS_ONLY**: For intake, brand context gathering, and competitive ad review. Read and analyze only — no creative output.
- **REVIEW_ONLY**: For reviewing generated creative against brand guidelines, platform specs, and testing plans.

## Safety Rules

### Platform Policy Compliance
- Ad copy must comply with platform advertising policies — no misleading claims, no prohibited content, no unapproved superlatives
- Include proper disclaimers where required by industry or platform (finance, health, alcohol, gambling)
- Never use clickbait that the landing page cannot deliver on
- Flag any copy that could be rejected during platform ad review and provide a compliant alternative

### Performance Language
- Never guarantee performance metrics — "this headline will convert" is prohibited
- Use hypothesis framing instead: "this headline tests the [principle] hypothesis"
- Performance predictions must be qualified: "based on [principle/pattern], this variation may outperform" not "this will outperform"
- Historical performance data is observation, not prediction — "this angle showed X% CTR" not "this angle gets X% CTR"

### Platform-Specific Constraints
- All copy variations must respect platform character limits (Google RSA headlines: 30 chars, Meta primary text: 125 visible, LinkedIn intro: 150 recommended)
- Every piece of copy must include a character count
- Flag anything over the platform limit and provide a trimmed alternative
- RSA headlines must make sense independently and in any combination — no headlines that depend on other headlines for meaning

### Human Voice (REQUIRED — supersedes the old "brand voice optional" rule)
Ratified from the `ad-creative-human-voice` convene (2026-06-19, kernel triad: claude/codex/gemini; synthesis in `_dev/reports/analysis/convene-runs/20260619T170544Z-ad-creative-human-voice/synthesis.md`). The defect this fixes is structural: generating from brand *adjectives* + a SaaS example library + high volume collapses copy to the AI centroid. Copy must read like a named person at the client would actually say it.

**1. Generate from an exemplar, not adjectives.** `brand_voice` must be a real human **exemplar** to imitate (1–3 actual lines from the owner/operator/script), plus the transform rule: *"write as this named speaker would say it, to this buyer, in this buying moment."* Adjectives ("friendly, direct") are notes only.
  - **Soft gate (not hard block):** polished/final client-facing copy requires a real exemplar. If none exists, fall back to the curated **voice-archetype library** (`assets/voice-archetypes.md`, real human samples — e.g. "Plain-Spoken Neighbor") with a LOUD warning that a default voice is in use. **Never** fall back to bare adjectives, and **never** let "voice gap acknowledged" pass as success.

**2. Pre-write message-architecture gate (before any copy).** For each ad, declare: *named speaker · audience moment · ONE claim · ONE offer/proof · ONE action · forbidden extras.* One ad = one message; do NOT stack offers (also serves Andromeda creative diversity — separate clean ads beat one crammed ad).
  - **Compliance carve-out:** the one-message rule applies to the *creative hook*, NOT required legal boilerplate. Mandatory disclaimers (OAC, offer end dates, finance terms) are exempt and must remain.

**3. Volume discipline.** Fewer, sharper, exemplar-anchored. Cap at ~2 high-quality options per angle; iterate against the exemplar rather than bulk-generating (bulk forces centroid-padding).

**4. Anti-AI-tells lint (advisory, severity-tiered) — `helpers/copy-voice-lint.js`.**
  - **Hard-fail only on objective, non-stylistic items:** >1 primary offer in one ad, missing required disclaimer, over character limit, banned non-spoken connective, unsupported/superlative claim.
  - **Banned non-spoken connectives (high-value core):** "Meet the…", "Discover", "Elevate", "Unlock", "Nestled", "in today's fast-paced", "Pair it with", "Look no further", sentence-opener "Plus,".
  - **Warn-only (never auto-fail — over-blocking kills punchy retail copy):** em-dash density, triadic comma lists, uniform sentence rhythm, speakability (target grade 5–7; flag sentences >15 words). A warn requires a human rationale or rewrite, not automatic rejection.

**5. Read-aloud gate (named + falsifiable).** Before operator review: *"Could [named speaker] say this to [this buyer] in one breath?"* If it sounds like a brochure, rewrite.

**6. Local-register primer.** For local/community clients, write as a plain-spoken local business owner speaking to a neighbour — directness, price/financing specifics, regional phrasing, a real ask; avoid high-gloss marketing adjectives.

- Never override explicit brand constraints (forbidden words, required terminology, tone directives).

### Creative Testing
- Creative testing recommendations must include a hypothesis and a success metric
- Never recommend testing more than one variable per test cycle
- Minimum impression thresholds must be stated before declaring a winner (recommend 1,000+ impressions per variation)
- Iteration logs must document what was learned, not just what was produced

### Competitor and Trademark Usage
- No competitor trademark usage in ad copy without explicit operator confirmation
- Competitor analysis is permitted in FINDINGS_ONLY mode for research purposes
- Comparison claims ("unlike X, we do Y") require operator approval before inclusion in deliverables

### Meta video creative
- For Meta video briefs, all perishable specs — resolutions, durations, safe-zone percentages, CPM/CPA deltas, hook/hold/CTR/play-rate thresholds, algorithm names, named practitioners — are CITED from the dated canonical reference `frameworks/_shared/reference/meta-video-creative-2025-2026.md`, never inlined into framework or output files. If that reference's `valid_through` has passed, treat every number as advisory and flag for refresh before asserting it as current fact.
- The default video doctrine is hook-first with no opening logo card. **OEM / regulated exception:** for OEM clients (Ford / Mazda) or regulated offers, brand standards or financial disclaimers may MANDATE early/explicit branding or a disclaimer frame. When intake declares such a mandate, it OVERRIDES the no-opening-logo rule — encode the required branding/disclaimer placement in the brief and flag it per client.
- Video benchmarks are stated as targets, never guarantees (consistent with the Performance Language rules above).

### Data Protection
- Never store ad account credentials, API keys, or platform tokens in framework artifacts
- Performance data included in reports must be aggregated — no individual user data
- Audit artifacts go to the project's `outputs/ad-creative/` directory only

---

## Amendment A — Gemini Flash Visual-Error Cross-Check (2026-06-23)

**Operator directive 2026-06-23.** Before any visual defect is flagged, reported to the designer, or acted upon in a static-image creative review, the Gemini Flash cross-check must have run and its verdict must exist.

**Required artifact, not a hard runtime gate (advisory-default).** The check must have *run* — a `creative-text-verify` verdict JSON must exist before a visual-defect claim is flagged or acted on. **The verdict is evidence, not authority:** a `FAIL` verdict is grounds to flag, a `PASS` is grounds not to, but neither overrides operator judgement and this requirement does NOT hard-block the review pipeline. Surfacing a defect claim with no verdict present is an advisory violation (the author should run the check first), not a blocked action.

### Rule

> **Suspected visual defect → run `creative-text-verify` (Gemini Flash) so a verdict exists → use that verdict as evidence when flagging.
> No verdict → do not assert the defect as fact; run the check first (advisory).
> If Gemini disagrees or is uncertain (`DISAGREE` verdict): surface both reads, state confidence levels, do NOT assert a defect.**

### How to run

```sh
node tools/ai-bridge/creative-text-verify.js \
  --images <path-to-creative.png> \
  --expect "dealer=<Dealer Name>;est=<Year>" \
  --claim "<specific visual claim to verify>" \
  --output _dev/reports/analysis/creative-verify/<slug>-verdict.json
```

Underlying engine: `tools/ai-bridge/adapters/gemini-api.js` (model: `gemini-2.5-flash`).
Memory rule: `feedback_visual-error-claims-need-gemini-flash-verify`.

### Verdict outcomes

| Verdict    | Action |
|------------|--------|
| `PASS`     | Suspected defect is not confirmed — do not flag. |
| `FAIL`     | Defect confirmed — flag with the verdict JSON as evidence. |
| `DISAGREE` | Gemini uncertain — surface both reads with confidence context; do NOT assert a defect without operator decision. |

### Philosophy / operator gates

This amendment changes the review disposition (defect → flag) into a verify-first disposition (defect → verify-then-flag) without adding a hard runtime gate — the verdict is a required artifact and evidence, surfaced advisory at authoring time. Any hardening of this rule into a real blocking gate on downstream system behaviors (Delesign submission gates, automated QA scoring) requires `/ground-in-philosophy` grounding + explicit operator approval before going live, and is subject to the bidirectional down-rung path in `_dev/concepts/lesson-enforcement-ladder.md`. This amendment itself is scoped to review-step behavior only.

---

## Amendment B — Confirmed-Terms Binding Preflight (2026-07-06)

**Framework fix for an observed defect.** Ad copy was authored against a source-of-truth "confirmed terms" doc that (a) silently **DROPPED** a confirmed element (a free test-drive mechanic inspection never made it into the copy), and (b) carried a fact **LABELLED "confirmed" that was actually unconfirmed** (a promo code presented as settled with no client source behind it). Both shipped because nothing bound the copy back to a *provenance-checked* terms ledger. This amendment makes the framework prevent both.

**Scope (honest wiring status).** The provenance ledger is captured at intake (`01`) and is the source of truth for the whole chain. **Executable enforcement currently lives only in prompt `03` (full ad units):** it runs the real pre-authoring integrity/pending-fact check and the post-assembly omission diff via `helpers/confirmed-terms-preflight.js`. The other copy-authoring steps are NOT yet wired to the executable check:

- Prompt `02` (headlines) — **note-only.** It carries a binding *note* (any headline surfacing an offer term must trace to a `confirmed` ledger row) but does not itself run the preflight/omission diff. TODO: wire prompt 02 to run the helper against the headline set where headlines can carry load-bearing offer terms.
- Prompt `05` (Meta video brief) — **not yet wired.** No preflight/omission check is invoked. TODO: wire prompt 05 to run the helper against any on-screen/spoken offer terms in the brief.

Do not read this amendment as framework-wide executable enforcement — the guarantee is only as strong as the wired path (prompt 03) until the TODOs above land. The intent applies to every step that surfaces an offer term, price, promo code, guarantee, mechanic, date, or claim; the *mechanical* coverage does not yet.

**Disposition — advisory-default (consistent with Amendment A).** The preflight must have *run* and its result must *exist* as evidence before copy is accepted at the operator gate. The verdict is **evidence, not authority**: a hard-fail is grounds to stop and fix, not an automated block on downstream systems. Hardening any part of this into a real blocking gate (e.g. Delesign submission, automated QA scoring) requires `/ground-in-philosophy` + explicit operator approval, per `_dev/concepts/lesson-enforcement-ladder.md`.

### The confirmed-terms ledger (source of truth)

Before copy is authored, offer terms/facts are captured as a **ledger** — one row per fact — in the intake output. Each row carries:

| Field | Meaning |
|---|---|
| `id` | short stable handle (e.g. `free-test-mechanic`, `promo-SAVE500`) |
| `statement` | the fact as it would be claimed |
| `status` | `confirmed` or `pending` — **never assume; default `pending`** |
| `provenance` | citation of the **client source** that confirms it (email/call/quote + date). Empty ⇒ not confirmed |
| `disposition` | `must-appear` \| `optional` \| `context-only` |
| `anchors` | the load-bearing tokens that must literally appear in copy for the term to count as present (e.g. `["free","mechanic"]`, `["SAVE500"]`) |

### The four rules

1. **Provenance binding.** Every fact used as settled must trace to a cited client source. A fact **without provenance may not be treated as confirmed** — set `status: pending`. Pending facts are not baked into copy as settled claims. *(Prevents inventing/assuming terms.)*
2. **Confirmed-label integrity.** A ledger (or any doc) that claims **CONFIRMED** must not carry unconfirmed facts. The preflight flags every `status: confirmed` row whose `provenance` is empty. *(This is the promo-code failure mode — "confirmed" with nothing behind it.)*
3. **Omission diff.** Produced copy is diffed against the ledger: every `confirmed` + `must-appear` term whose anchors are **absent** from the load-bearing copy is flagged as a silent drop before the draft is accepted. *(This is the free-test-mechanic failure mode.)*
4. **Pending-fact handling.** A `pending` fact may appear in copy **only** as a clearly-optional, footnoted, omit-at-build element — never as a load-bearing claim. The preflight flags any pending anchor found in the load-bearing body.

### Rule → observed failure (rationale)

| Rule | The failure it prevents |
|---|---|
| Provenance binding | An unconfirmed fact silently promoted to "settled" and written as fact. |
| Confirmed-label integrity | The **promo code** carried a `confirmed` label with no client source behind it. |
| Omission diff | The **free test-drive mechanic inspection** — a confirmed element — was silently dropped from the copy. |
| Pending-fact handling | A not-yet-confirmed term hardened into a load-bearing claim instead of an omit-at-build footnote. |

### How to run

The mechanical half is a framework-local helper (advisory, mirrors `copy-voice-lint.js`):

```sh
node helpers/confirmed-terms-preflight.js \
  --ledger outputs/ad-creative/confirmed-terms-ledger.json \
  --copy <load-bearing copy body file or --copy-text "..."> \
  [--footnotes <optional/footnote zone file or --footnotes-text "...">] \
  [--json]
```

The helper checks rules 2–4 mechanically (rule 1 — that provenance is *captured* — is enforced at intake authoring). It is a **keyword/anchor proxy, not semantic**: anchor matching is **word-boundary** literal matching (not raw substring), so a short/common anchor like `free` is not falsely satisfied by `freelance`, and `$500` is not satisfied by `$5000` (offer symbols like `$`/`%` are handled). A synonym or paraphrase that drops the literal anchor reads as an omission (a safe false *positive* — flags for a human), and provenance strings are checked for *presence*, not *truth*. Anchor choice and provenance truth remain author/operator judgement.

The helper also **hard-fails on an unusable ledger** so that a bad input never looks clean: a malformed ledger (`malformed-ledger`), an empty ledger (`empty-ledger`, waivable with `--allow-empty-ledger` when a creative genuinely carries no offer terms), or a `confirmed` + `must-appear` term with **no anchors** (`confirmed-term-unanchored` — the omission check would otherwise be structurally absent while the verdict still read `pass`).

### Verdict outcomes

| Verdict | Action |
|---|---|
| `pass` (no hard-fails) | Ledger integrity holds and no confirmed term was dropped — copy may proceed to the operator gate with the verdict attached as evidence. |
| `confirmed-without-provenance` | Stop: either cite the client source or downgrade the row to `pending` and re-run. |
| `confirmed-term-omitted` | Stop: a confirmed must-appear term is missing from the copy — restore it or, with operator sign-off, re-classify its disposition. |
| `pending-fact-load-bearing` | Stop: move the pending fact to an omit-at-build footnote, or obtain provenance and re-classify to `confirmed`. |
| `confirmed-term-unanchored` | Stop: a confirmed must-appear term has no anchors, so its omission cannot be verified — add the load-bearing anchors and re-run. |
| `malformed-ledger` / `empty-ledger` | Stop: the ledger is not a usable term list (wrong shape, or zero terms) — supply a valid ledger, or pass `--allow-empty-ledger` only if this creative truly carries no offer terms. |

### Philosophy / operator gates

The ledger and its provenance are the author's/operator's assertions — the tool verifies *structure and presence*, never the truth of a cited source or the semantic completeness of paraphrased copy. It changes the disposition from "author copy → hope terms match" to "bind copy to a provenance-checked ledger → verify → then accept," without adding a hard runtime gate. See the down-rung path in `_dev/concepts/lesson-enforcement-ladder.md` before hardening.

---

## Checklist
- [ ] Platform(s) confirmed and character limits documented
- [ ] Human voice: real exemplar captured (or voice-archetype fallback used WITH a loud warning) — never bare adjectives, never "gap acknowledged = pass"
- [ ] Message-architecture gate run per ad (named speaker · one claim · one offer · one action); one message per ad; legal boilerplate carve-out preserved
- [ ] copy-voice-lint run: zero hard-fails (>1 offer, missing disclaimer, over-limit, banned connective, unsupported claim); warns triaged
- [ ] Read-aloud gate passed: "could [named speaker] say this to [this buyer] in one breath?"
- [ ] All copy includes character counts and respects platform limits
- [ ] No guaranteed performance claims in any deliverable
- [ ] Testing recommendations include hypothesis and success metric
- [ ] No competitor trademarks used without operator confirmation
- [ ] All creative uses observational language for performance expectations
- [ ] Meta video briefs cite the canonical reference for all perishable specs (no inlined numbers) and flag any OEM/regulated early-branding or disclaimer exception
- [ ] Any visual-defect claim carries a `creative-text-verify` verdict JSON (the check ran; verdict is evidence, not a hard gate) — no verdict ⇒ do not assert the defect as fact
- [ ] Confirmed-terms ledger captured at intake: every offer term/fact has `status` + `provenance` (no-source ⇒ `pending`, never assumed confirmed)
- [ ] Confirmed-terms preflight run before copy is accepted: `confirmed-terms-preflight.js` verdict exists (evidence, not a hard gate) — zero hard-fails, or each hard-fail resolved/operator-signed
- [ ] Omission diff clean: every `confirmed` + `must-appear` term appears in the load-bearing copy (no silent drops)
- [ ] Pending facts appear only as clearly-optional, footnoted, omit-at-build elements — never as load-bearing claims
