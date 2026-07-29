# Dreaming System Integration — Guardrails

## Privacy Floor

- **Never ingest PII, credentials, or client data.** The build script must maintain a `FORBIDDEN_PATHS` list. No `clients/`, no `.env`, no operator-private philosophy surfaces.
- **Validate at build time.** The build script must check every file path against the forbidden list before reading. Reject, don't silently skip.
- **No PII in entity state.** The entity persistence writer must validate `state_json` and `event_json` against PII markers before write. Reject writes containing email, password, API keys, tokens, credentials, SSN, credit card, phone, address, GPS/location, or client identifiers.

## Advisory Surface

- **Dreams must not block session boot.** The dream rebuild script must never throw or exit non-zero in a way that halts session startup. Catch all errors, emit a diagnostic line, and continue.
- **Timeout guard.** Set a timeout (10s recommended) on the session hook invocation. If the rebuild exceeds the timeout, the hook infrastructure should kill it and continue.
- **Dreams are informational, not prescriptive.** The engine surfaces associations — it does not prescribe actions, dispatch tasks, or make decisions.

## Determinism

- **Same input → same output.** The scoring function must be fully deterministic. No random seeds, no LLM calls, no external API dependencies.
- **Explainable output.** Every association in the dream report must include its basis: which shared terms, wikilinks, directional links, or tags produced the score.
- **Cross-platform, stdlib-only.** The build script and entity writer must use only Node.js standard library. No npm install, no native bindings, no platform-specific APIs beyond what stdlib provides.

## Schema Coexistence

- **Entity tables must not couple to concept tables.** The `agents`, `agent_state`, and `agent_history` tables share the same SQLite file for convenience but must have zero foreign-key references to `memories`, `concepts`, or `associations`.
- **Separate writer patterns.** Entity persistence uses incremental append/upsert. Concept dreaming uses scratch rebuild. Do not mix these patterns in a single script.

## Scheduling Non-Overlap

- **Verify no conflicts before installing.** Check all existing scheduled jobs before adding the dream rebuild job. If any job has overlapping timing or resource contention, resolve before installing.
- **Log to a known path.** Stdout and stderr from the scheduled job must go to a version-controlled or documented log path so the operator can inspect.
