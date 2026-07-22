# Scaffold Framework Workflow

## Steps

1. **[USER] Select captures** — Provide a project root plus one or more normalized capture IDs.
2. **[AUTO] Validate captures** — Confirm each capture is marked `ready_for_scaffold`.
3. **[AUTO] Extract stable structure** — Aggregate repeated steps, decision hints, and variable inputs across the captures.
4. **[AUTO] Create candidate root** — Scaffold `framework_candidates/<service>__<framework>/`.
5. **[AUTO] Copy sanitized evidence** — Copy only normalized capture artifacts into `evidence/`.
6. **[AUTO] Generate `proposed_framework/`** — Write a draft manifest, prompt chain, schemas, guardrails, templates, and local `.claude/` assets.
7. **[AUTO] Seed replay cases** — Create an example replay case and candidate metadata.

## Output

- Framework candidate under `framework_candidates/`
- Draft `proposed_framework/`
- Initial `candidate.json`
