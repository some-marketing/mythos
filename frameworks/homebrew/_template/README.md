# Homebrew Grimoire Template

**Homebrew** (D&D canon: player-created content, not published by the core rulebooks) is
this guild's word for a grimoire (framework) you authored yourself, as opposed to one
that shipped with Mythos. `frameworks/homebrew/` is reserved namespace for exactly that —
System grimoires never register here, so anything you build under this service category
can never collide with an update to the shipped set.

## How a homebrew grimoire is born

You don't usually write a homebrew grimoire from a blank page. The normal path is the
capture → promote flywheel:

1. You do good ad-hoc work on a real contract (project).
2. `/claim-spoils` (capture-task) imports it into a normalized bundle.
3. `/refine-spoils` (normalize-capture) validates the bundle.
4. `/scribe-grimoire` (scaffold-framework) drafts a framework candidate (Iron rank) from
   one or more refined bundles.
5. `/rank-up` (promote-framework) promotes a validated, replay-checked candidate into a
   registered framework.

When you scaffold a candidate without naming a shared service category, it defaults into
`frameworks/homebrew/<name>/` — see [`docs/homebrew/README.md`](../../../docs/homebrew/README.md)
for the exact default rule and how to override it.

## Anatomy (same shape as any grimoire)

A homebrew grimoire follows the same anatomy as a System one — nothing about the
mechanics changes because it lives in a different service category:

```
homebrew/{your-grimoire-name}/
├── manifest.json          # Metadata, input/output contracts, execution config
├── docs/                  # Grimoire documentation
├── prompts/               # Numbered prompt chain (01_, 02_, ...)
├── schemas/                # JSON schemas for inputs/outputs
├── guardrails.md           # Grimoire-specific execution constraints
├── templates/               # Starter files for new projects (optional)
└── .claude/
    ├── skills/{name}/      # Essence (skill) definitions
    ├── commands/{name}/    # Slash command wrappers
    └── agents/{name}/      # Familiar (subagent) configurations
```

## Rank starts at Iron

Every homebrew grimoire starts at **Iron** (candidate — structurally complete, no run
evidence yet) the moment it's promoted, exactly like any other grimoire. It climbs the
same rank ladder — Bronze, Silver, Gold — on the same terms: evidence, not intention. See
[`docs/LEXICON.md`](../../../docs/LEXICON.md) for the full ladder.

## What never lives here

`frameworks/homebrew/` is yours. It is never touched by a Mythos update, and Mythos never
writes into it on your behalf outside of the promotion step you triggered. Keep client- or
patron-specific data in `clients/` or an external workspace, not inside a homebrew
grimoire itself — a grimoire should stay reusable across patrons, homebrew or not.
