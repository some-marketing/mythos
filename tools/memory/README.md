# Memory (scaffold)

A file + sqlite backed memory substrate: durable canonical entries, a
searchable local database built from them plus your concept surface, and a
lightweight semantic-anchor query over an external notes vault if you have
one. Point every piece at your own store — nothing here assumes a specific
person's paths, vault, or identity.

## What's here

- `write-canonical-entry.js` — writes one canonical memory entry to
  `_dev/state/kernel-memory/entries/` and appends a paired event to the
  memory ledger. Refuses to write if the canonical layer is unreachable — no
  partial writes, no orphan entries. Depends on `tools/workspace/lib/args.js`
  for CLI argument parsing (ships alongside this in the full tree).
- `build-memory-db.js` — rebuilds a local-only sqlite database (falls back
  to JSONL if no `sqlite3` binary is found) from canonical entries plus your
  `_dev/concepts/` surface, and writes a "dream report" — an associative
  recombination pass surfacing loosely-related concept pairs. Fully
  regenerable; nothing here is a source of truth in itself.
- `semantic-query.cjs` — anchor-based semantic retrieval (not free-text
  query embedding — see the file header for why that's an honest limitation)
  over a Smart Connections-style embedding store, if you keep your notes in
  an Obsidian vault with that plugin. Point it at your own vault via
  `MYTHOS_MEMORY_MIRROR_DIR` (defaults to `memory-mirror/` under the repo
  root if unset).
- `contextual-inject.cjs` — a SessionStart-style hint surfacer: reads recent
  git history and the memory ledger to suggest what a fresh session might
  want to know, without an LLM call.
- `lib/resolve-sqlite3.cjs` — locates a `sqlite3` binary (env override
  `MYTHOS_SQLITE3`, common install paths, then gives up gracefully).
- `schemas/` — `canonical-entry.schema.json`, `agent-state.schema.json`,
  `session-note.schema.json`, `adapter-role.schema.json`. These define the
  actual data shapes the tools above read and write.

## What isn't here, and why

The source repo this was extracted from also had a **personal 1Password
vault layer** — a writer script and a bootstrap script that mirror memory
entries into one specific person's own 1Password "Employee" vault. That
layer is bound entirely to one person's private vault; there's no version of
it that generalizes to "your own vault" without becoming a different, much
simpler thing (an env-var-driven credential resolver, which `tools/lib/`
already provides for other tools in this tree). It was ripped out entirely,
not genericized — if you want a personal-vault mirror of your own memory,
build it against your own 1Password/Keychain setup using the same
credential-resolution pattern as any other tool in this repo.

## Using this

```bash
# Write a memory entry
node tools/memory/write-canonical-entry.js --type project --title "..." \
  --anchor-ref "commit:<sha>" --source-artifact "chat:2026-01-01" --body "..."

# Rebuild the local database + dream report
node tools/memory/build-memory-db.js

# Query your notes vault by anchor (if you keep one)
MYTHOS_MEMORY_MIRROR_DIR=/path/to/your/notes node tools/memory/semantic-query.cjs --anchor some-note.md
```
