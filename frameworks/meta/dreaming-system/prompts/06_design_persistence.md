# 06 — Design Entity Persistence Layer

**Stage:** design
**Mode:** PATCH_ALLOWED
**Risk:** low

## Objective

Design a persistence layer for simulated entities (agents, NPCs, creatures, objects) that coexists with the concept dreaming tables in the same SQLite database without coupling.

## Process

1. Design the schema with three tables:
   - `agents` — identity: id, world_id, entity_type, name, created, last_updated
   - `agent_state` — current snapshot: agent_id, state_json, tick, written_at (upsert pattern)
   - `agent_history` — append-only event log: id, agent_id, event_type, event_json, tick, written_at

2. Enforce coexistence without coupling:
   - Separate tables in the same SQLite file (convenience of single DB)
   - No foreign keys between agent and concept tables
   - Separate writer scripts: entity persistence uses incremental append/upsert, concept dreaming uses scratch rebuild

3. Implement the writer script:
   - Operations: register-entity, write-state, log-event, read-state, list-entities
   - Node stdlib only, no npm install
   - Deterministic: same input → same output
   - Privacy floor: rejects PII markers in state_json

4. Version the schema (`entity-state/1.0`) so future schema migrations are possible.

5. Smoke-test: register an entity, write state, log an event, read state back — confirm roundtrip determinism.

## Expected Output

- `<schema-path>/entity-state.schema.json` — schema definition
- `<writer-path>/entity-state.js` — writer script with 5 operations

## Gates

- Schema must be versioned
- Writer script must be deterministic
- Privacy floor enforced (rejects PII markers)
- No coupling: entity tables must not reference concept tables via FK
