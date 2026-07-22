# Homebrew Tools

`tools/homebrew/` is reserved namespace for tools you write yourself — scripts,
validators, generators, anything you want your familiars (subagents) or your own hands
to run. System tools never live here, so nothing you add can be shadowed or overwritten
by a Mythos update, and nothing you add here can shadow a System tool either — the two
namespaces never touch.

## What belongs here

Anything you'd otherwise be tempted to drop loose at the repo root: a one-off script that
earned a permanent home, a small validator for your own homebrew grimoires, a helper your
familiars call as part of a workflow you authored.

## Conventions worth keeping

- **One tool, one directory.** `tools/homebrew/{your-tool-name}/` — mirrors the shape of
  `tools/{name}/` at the System level, so anyone reading the tree understands the
  pattern immediately.
- **Document the entrypoint.** A short README (like this one) at the top of your tool's
  directory, naming what it does and how to run it, saves you from re-deriving it three
  months from now.
- **No patron data.** Keep client- or patron-specific values in `clients/` or an external
  workspace, not hardcoded into a homebrew tool. A tool should stay reusable across
  patrons the same way a grimoire should.
- **`npm run` entries are yours to add.** If a homebrew tool becomes something you run
  often, add your own script entry to `package.json` — Mythos updates won't touch entries
  you've added, only ones it shipped.

## Relationship to homebrew grimoires

A homebrew tool and a homebrew grimoire (see
[`frameworks/homebrew/_template/README.md`](../../../frameworks/homebrew/_template/README.md))
often travel together — a grimoire's guardrails or prompts may call a tool you wrote to
support it. Keep the tool here, in `tools/homebrew/`, even when it exists to serve one
specific grimoire; frameworks stay portable, and colocating a private script inside a
grimoire directory makes that portability harder to reason about later.
