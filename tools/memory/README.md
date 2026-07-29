# tools/memory

Memory substrate for Mythos. Multiple writers and resolvers; this README indexes
them and names which is canonical at which layer.

## Canonical memory writer (Topological Sovereignty layer)

**Anchor concept:** `_dev/concepts/topological-sovereignty-memory/concept.md`
**Convene synthesis:** `_dev/reports/analysis/convene-runs/20260514T132856Z-topological-sovereignty-memory-canonical/synthesis.md`

### Invariant (load-bearing)

> **No harness-specific cache may accept a write that canonical memory cannot receipt.**

Cache write blocks until canonical write returns a receipt. This is the rule
that makes the memory topology hold — without it, prettier paths reproduce the
orphan bug surfaced in convene 20260513T202937Z.

### Writer

`tools/memory/write-canonical-entry.js`

```bash
node tools/memory/write-canonical-entry.js \
  --type feedback \
  --title "Short title" \
  --anchor-ref "concept:topological-sovereignty-memory" \
  --source-artifact "chat:2026-05-14" \
  --body "Body text. Markdown permitted." \
  --actor claude
```

On success it emits a single-line receipt JSON on stdout:

```json
{"ok":true,"id":"<canonical-id>","path":"_dev/state/kernel-memory/entries/<id>.json","content_hash":"<sha256>","ledger_event_id":"<event-id>","created_ts":"<iso>"}
```

The writer:

1. **Preflights canonical reachability** — entries dir + ledger writable + ledger writer present. If any check fails, exit code `3` and error `CANONICAL_UNREACHABLE`. No disk touch.
2. **Atomically writes the entry** (`tmp → fsync → rename`) to `_dev/state/kernel-memory/entries/<id>.json`.
3. **Appends a paired ledger event** by shelling out to `tools/memory/append-ledger-entry.js`. Ledger logic is not duplicated.
4. **Unlinks the entry if the ledger append fails.** No orphan entries are possible.
5. **Binds the ledger `event_id` back into the entry** so the receipt is durable on disk, not just in stdout.

### Schema

`tools/memory/schemas/canonical-entry.schema.json`

Required fields: `id, schema_version, type, title, body, anchor_ref, source_artifact, created_ts, content_hash`.
`content_hash` is `sha256(body)` — the integrity anchor every adapter verifies against.

### Two hash domains on this substrate

The canonical writer and the legacy harness-pocket appender hash different
domains. Readers and reconcilers MUST branch on the file surface.

| Surface | `content_hash` formula | Why |
|---|---|---|
| Canonical entry (`_dev/state/kernel-memory/entries/<id>.json`) | `sha256(body)` — body field used **raw** | Canonical entries are typed JSON; the `body` is the entire memory payload, no frontmatter wrapper. |
| Legacy harness pocket (`~/.claude/projects/<cwd-key>/memory/<file>.md`) | `sha256(body)` **after** YAML frontmatter stripping | Pocket files are markdown with YAML frontmatter; only the body should anchor drift detection. See `stripFrontmatter()` in `append-ledger-entry.js`. |

In the ledger, branch on `memory_file` path shape:
- starts with `_dev/state/kernel-memory/entries/` → canonical (raw-body hash)
- otherwise → legacy pocket (frontmatter-stripped hash)

This is documented in `_dev/state/memory-ledger.README.md` as the
`memory_file` contract.

### Smoke test

`tools/memory/test-write-canonical-entry.sh`

Falsifiable. Tests:
- happy path (entry exists, content_hash matches, ledger references entry, receipt binds back)
- canonical unreachable (entries dir absent → exit 3, no writes)
- blocked ledger (read-only ledger → refusal, no orphan)

Run it after touching the writer or the ledger appender.

### What harness adapters must do

Out of scope this slice. The contract every harness adapter (Claude pocket,
Codex, Pi) must honor is in the concept doc:

- Adapters declare role: `source`, `cache+native-hint`, `explicit-read+hook-emulated`, `unavailable`.
- Only the canonical writer is `source`.
- Cache writes block until this writer returns a receipt.
- On `CANONICAL_UNREACHABLE`, the adapter enters `FINDINGS_ONLY` mode — read-only, no orphan writes.

A subsequent slice authors `PROJECT_MEMORY.json` (harness_id manifest) and the
session-start trial-balance hook.

---

## Other writers and resolvers in this directory

| File | Role |
|---|---|
| `append-ledger-entry.js` | Validated appender for `_dev/state/memory-ledger.jsonl`. The canonical writer composes over this. |
| `memory-vault.js` | Multi-source resolver: env override → local plaintext shadow → 1Password vault. Read path for Cowork/sandbox sessions that cannot reach `op`. |
| `remember-via-vault.sh` | Dual-write helper: writes a memory file AND posts it to 1Password "Sam's Memories". On-device only. |
| `remember-via-vault.dr.sh` | Disaster-recovery variant of the above, parked. Master-password fallback path; not the default. |
| `vault-bootstrap.sh` | One-time setup for the AI-private 1Password account. |
| `migrate-orchestrator-memory.sh` | Migration script (in flight). |
| `contextual-sweep.js` + `contextual-inject*.cjs` | Tier-0 contextual hint surface (separate concern from canonical memory). |
| `install-sweeper.sh` | Installs the contextual sweep launchd plist. |
| `schemas/canonical-entry.schema.json` | Schema for entries under `_dev/state/kernel-memory/entries/`. |

## Layering

```
canonical (source of truth)
   _dev/state/kernel-memory/entries/<id>.json     <- write-canonical-entry.js
   _dev/state/memory-ledger.jsonl                 <- append-ledger-entry.js
   _dev/state/kernel-memory/MEMORY.md             <- (index; surface only)
        ▲
        │  receipt-bound
        │
cache / projection (regenerable)
   ~/.claude/projects/<cwd-key>/memory/           <- Claude harness pocket
   1Password "Sam's Memories" vault               <- private substrate participant
```

When a harness writes, the cache write must not return success to the caller
until the canonical receipt returns. When canonical is unreachable, the
harness enters `FINDINGS_ONLY` mode rather than degrading silently.
