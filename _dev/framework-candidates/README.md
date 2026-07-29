# Framework Candidates — the forge floor

This is where a rough working pattern gets hammered into a candidate grimoire before it's ready to `/rank-up` into `frameworks/`.

## `iron-rank-worked-example/`

This is the canonical worked example of what `/scribe-grimoire` produces and `/rank-up` consumes — an Iron-rank candidate, in the flesh, so you can see the shape before you scaffold your own.

It carries:
- `candidate.json` — candidate metadata: id, service category, framework name, status, source captures, blocking issues, replay summary. This is the file `/rank-up` reads to decide whether a candidate is promotion-ready.
- `evidence/source-material.json` — the inventory of source material the candidate was extracted from, so a reviewer can trace the candidate back to what it's modeling.
- `proposed_framework/` — the draft framework assets themselves: `guardrails.md`, `manifest.json`, `docs/`, `prompts/`, `schemas/`, `templates/`. This is what gets promoted verbatim into `frameworks/<category>/<name>/` on a successful `/rank-up`.
- `replay_cases/` — example replay-oriented inputs, so the candidate's executable stage(s) can be run against a known case before promotion.

It is intentionally partial: only its first stage is modeled as executable. That's the honest state a real Iron-rank candidate is usually in — later stages planned and documented, not yet proven. Don't read the partial-completeness as a mistake; read it as what an in-progress candidate actually looks like.

## Using this exemplar

1. Read `iron-rank-worked-example/README.md` and `candidate.json` first — they tell you what's real and what's still aspirational in this candidate.
2. Compare its directory shape against whatever `/scribe-grimoire` scaffolds for you. They should match.
3. When your own candidate reaches the same maturity (an executable stage, real replay cases, honest `blocking_issues`), it's ready for a `/rank-up` review — not before.
