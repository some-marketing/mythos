# The Spellwright's Bench

This is the bench where a guild writes its own spells before they're bound into the grimoire: prompt packs, the registry that tracks which ones are live, and the master run order that says which one to cast today.

## What lives here

- **`manifest.json`** — the bench inventory. One entry per prompt pack: its id, title, path, purpose, and what evidence it expects back. This is the machinery contract, adapted to list only the packs actually shipped in this bench — not every pack a guild might ever write.
- **`prompt-plan-registry.json`** — the ledger of run-order plans. Reduced here to its schema shape plus one worked example (`master`), so you can see the field contract without inheriting a stack of historical plan entries that mean nothing outside their originating guild.
- **`claude-master-run-order.md`** — a templated master run order. It keeps the real structure (canonical workflow, current-truth section, distinct-family review bridge rule, execution order, stop rules, supporting/historical/standalone pack lists, planning references, success condition) but every guild-specific name has been swapped for a `<placeholder>`. Fill in your own canonical pack, your own evidence docs, your own pack list.
- **The prompt packs themselves** (`claude-*.md`) — worked, reusable prompt-engineering material: how to run a semantic-verification pass, how to close an operational loop, how to wire multi-agent planning and compliance, and so on. These are already generic dev-process material — no client work, no operator identity, no private infrastructure — so they're ported close to verbatim. Read them as *examples of the shape a prompt pack takes*, not as instructions specific to this guild.

## What doesn't live here

Anything that named a real host, a real person, a private canon term, or a client-flavored engagement was excluded rather than sanitized — per the rule that a contaminated source must never be scrubbed into passing. That includes packs about migrating a specific private operational model, and packs about a specific person's private tooling. Their absence is intentional, not an oversight.

## How to use this bench

1. Read `manifest.json` to see what packs exist and what each expects as input/output.
2. Read a pack or two to internalize the shape: objective, execution mode, activation triggers, a decision tree or automated workflow, success criteria, safety rules.
3. Write your own canonical pack for your own guild's actual current work.
4. Register it in `manifest.json` and `prompt-plan-registry.json`.
5. Fill in `claude-master-run-order.md`'s placeholders so it names your real canonical pack and your real evidence.
