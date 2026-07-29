# Golden Set — Mythos system-knowledge benchmark

Canonical Mythos-doctrine prompts with expected verdicts. Used to test
whether a local model has acquired enough system-context to be a useful
**lower-tier actor** — one that can be trusted with bounded, low-stakes work
without a frontier model re-checking every step.

The golden set tests **correct reasoning about the shipped doctrine**, not
exact-string-match. A model passes a prompt when its response *demonstrates*
the named concept; it fails when the response misses the concept, or names a
disqualifying alternative.

## Prompt schema

Each entry in `prompts.json` is one object with these fields:

- `id` — stable slug (e.g. `familiar-contract`)
- `prompt` — the exact text sent to the model
- `expected_topic` — substring(s) that must appear in the response (any one match counts)
- `acceptable_response_shape` — short list of substring fragments that, taken together, indicate the response covers the right shape (≥50% must appear for a pass; <50% but ≥1 = partial)
- `disqualifying_patterns` — substrings that, if present, force a fail regardless of other matches (these encode the concept's anti-patterns)

## Verdict logic

For each prompt:

- **fail** — any `disqualifying_patterns` substring appears in the response
- **fail** — none of the `expected_topic` substrings appear
- **pass** — `expected_topic` matches AND ≥50% of `acceptable_response_shape` fragments appear AND no disqualifying pattern
- **partial** — `expected_topic` matches but <50% of shape fragments appear

## Source concepts

The prompts pull from these shipped public doctrine surfaces — keep them in
sync if the concepts drift:

- `docs/GUILD-CHARTER.md` — the familiar dispatch contract, producers-never-judge-own-trials, role ownership, cross-session durable artifacts
- `docs/LEXICON.md` — world nouns, the rank ladder and dual apex, the mythic-names-are-aliases design law, Homebrew and the Mirror
- `instructions/canonical/guardrails.md` — execution modes, observational reporting, forbidden report labels

## Growing the set

Add prompts when a new piece of shipped doctrine lands, or when a benchmark
run surfaces a knowledge gap that no existing prompt would have caught.
Don't tune prompts to make a specific model pass — the set is the doctrine's
fixed point, models are the variables.
