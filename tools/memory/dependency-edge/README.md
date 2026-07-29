# MemoryDependencyEdge/1.0 writer (standalone, read-only)

Plan: `memory-dependency-edge-writer-mvp`. Concept: `_dev/concepts/memory-dependency-edge.md`.
Membrane: `_dev/concepts/hwfwm-cosmos-memory-membrane.md`.

This tool makes **"what stands on this memory?"** computable. It reads existing
repo artifacts (read-only), infers `MemoryDependencyEdge/1.0` records, and writes
them to `_dev/state/memory-edges/edges.jsonl`. It records **objective dependency
state only** — which memory is cited by which plan / lesson / span / archival
commit. It makes **no archival decision, no deletion, and encodes no
continuity / soul / awakening semantics** (membrane PRIME LAW: objective state only).

## Run

```
node tools/memory/dependency-edge/write-edges.js          # rewrite edges.jsonl
node tools/memory/dependency-edge/query-edges.js --what-stands-on <memory_key>
node tools/memory/dependency-edge/query-edges.js --is-keystone <memory_key>
node --test tools/memory/dependency-edge/__tests__/write-edges.test.js   # coverage + falsifier
```

## S1 — Verify & observe (findings)

### Schema fields confirmed
`MemoryDependencyEdge/1.0` (from the concept's Edge Schema block) carries:
`schema, edge_id, source{kind,id}, target{kind,id}, relationship, direction,
keystone_*, witness_state, written/generated metadata`. This MVP refines the
concept's boolean `is_keystone_candidate` into the three-value `keystone_status`
(`detected | not_detected | classification_uncertain`) per plan ADJ#2, and adds
`criteria_version` + `generated_at` per ADJ#4. (Refinement to feed back to the concept.)

### No writer exists
`grep -rl MemoryDependencyEdge tools/ _dev/` returns only concept docs and session
turn-logs — no writer/exporter. Confirmed before building.

### No autonomic consumer of the output
`grep -rn memory-edges tools/ .claude/` and a scan of all launchd plists return
**zero** consumers of `_dev/state/memory-edges/`. The new JSONL cannot be silently
consumed by a Tier-2/background process before a separate live-wiring plan is approved.

### Read-only inference SOURCES inventoried
| Source | Field/pattern read | Edge produced |
|---|---|---|
| `Mythos-memories/memory/*.md` + `MEMORY.md` index | filename slug = `memory_key`; the live-memory universe | orphan `not_detected` edges |
| `_dev/reports/analysis/task-plans/*__plan.json` | `grounded_in[]`, `composes_with[]` | `referenced_by_plan` |
| `_dev/concepts/*.md` | frontmatter `grounded_in:` paths + inline slug citations | `referenced_by_plan` (target = concept `plan_id` or slug) |
| `_dev/reports/analysis/run-debrief__*.md` | inline `memory/<slug>` / `Mythos-memories/memory/<slug>` mentions | `anchors_lesson` |
| `_dev/reports/analysis/convene-runs/*/manifest.json` | `context_files[]` memory paths | `grounds_span` (target = run dir) |
| git log (`memory: …archive…` commits) | commit subject + changed memory-note files | `gates_archival_of` (target = commit anchor) |

### Hand-trace (observe-before-encode) — validated the mechanism would detect known deps
1. `reference_remote-ssh-node-kerneling-playbook` → `run-debrief__syme-kerneling__2026-06-24`
   (debrief line 28 names `memory/reference_remote-ssh-node-kerneling-playbook.md`) → **anchors_lesson, detected**.
2. `feedback_falsifier-must-be-operational` → plan `auto-rest-mechanical-triggers`
   (`composes_with` line 199 names `memory feedback_falsifier-must-be-operational`) → **referenced_by_plan, detected**.
3. `feedback_context-purity-is-correctness` → span `20260531T071527Z-dialectic-over-fear`
   (convene manifest `context_files` lists the memory path) → **grounds_span, detected**.
4. `project_fable-outside-kernel-and-sam-aggregate` → commit `71ca613a4`
   (`memory: archive outside-kernel fable transcript` touched the memory note) → **gates_archival_of, detected** (non-obvious: commit subject does not contain the slug).
5. `reference_excel-online-playwright-navigation` → only in `MEMORY.md`, no referencing artifact → **orphan, not_detected**.

## Frozen inference mechanism — `criteria_version = "v1"`

Five general rules (see the comment block in `lib/edge-schema.js` for the
authoritative spec). The mechanism was frozen as v1 **before** scoring against the
held-out falsifier baseline; rules are general parsers of declared fields and
documented patterns, **not** hardcoded to the baseline's specific edges.

Two rules catch **non-obvious** (non-direct-keyword) dependencies:
- **Ambiguity rule:** a memory slug referenced only via a same-named `_dev/concepts/<slug>.md`
  path (not the memory path) while a memory of that slug also exists → `classification_uncertain`
  / `inferred` (cannot confirm the memory surface, vs the concept doc, is the keystone).
- **Absence rule:** an artifact names `memory/<slug>` but `<slug>` is absent from the
  live memory surface → `classification_uncertain` / `inferred`.
- **Archival-commit rule:** links a memory to an archival commit anchor where the commit
  subject does **not** contain the memory slug literally (resolved via git changed-files).

## Witness-state semantics (this writer)
- `witnessed` — declared in a structured field (`grounded_in`/`composes_with`/manifest
  `context_files`) or an explicit inline path/slug citation; or a git-verifiable commit anchor.
- `inferred` — derived from an ambiguous or absent reference (ambiguity/absence rules).
- `sentinel` — reserved for the non-operative FORGOTTEN marker; never emitted by this writer.
- `structurally_unwitnessable`, `legacy_absent` — defined in the enum for forward use; not emitted by v1.

## FORGOTTEN
`FORGOTTEN_SENTINEL` is a **non-operative documented constant** in `lib/edge-schema.js`.
It is never written to an edge, gates nothing, and triggers nothing. Terminal-unavailability
schema/trigger is explicitly deferred to a separate operator-gated plan.

## Hard boundaries honored
Read-only over all sources. No writes outside `tools/memory/dependency-edge/` and
`_dev/state/memory-edges/edges.jsonl`. No touch to `emit-span.cjs`, the visibility-contract
test, the `/remember` path, `memory-vault.js`, `append-ledger-entry.js`, the canonical-entry
schema, `memory-ledger.jsonl`, the promotion gate, or `instructions/canonical/`. Re-run
**replaces** the full JSONL (no stale accumulation).
