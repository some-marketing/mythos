# Homebrew

**Homebrew** (D&D canon: player-created content, not published in the core rulebooks) is
Mythos's word for anything you made yourself, rather than anything the guild shipped.
Three reserved namespaces make up the homebrew lane, and none of them are ever touched by
a System grimoire, tool, or update:

| Namespace | What lives there |
|---|---|
| `frameworks/homebrew/` | Grimoires (frameworks) you authored or promoted yourself |
| `tools/homebrew/` | Tools you wrote yourself |
| `docs/homebrew/` | Your own documentation — this directory |

Each namespace ships with a `_template/` and a README (this one, plus one inside each of
the other two) so the pattern is obvious the first time you look.

## Where your data lives

Homebrew is about things you *build* — grimoires, tools, docs. Your *data* — patron
records, contract history, project outputs — lives somewhere else entirely:

- **Patrons (clients)** register under `clients/{code}/` inside the repo, or
- live in an **external workspace** scaffolded via `workspace:scaffold --out <path>`,
  kept entirely outside this repo.

Neither path ever mixes patron data into a homebrew grimoire or tool. A grimoire should
stay reusable across every patron who runs it, homebrew or not — that's what keeps the
capture → promote flywheel (below) worth running a second time.

## How a homebrew grimoire is born — the capture → promote flywheel

1. **Claim spoils** (`capture-task`) — import successful ad-hoc work from a real contract
   into a normalized bundle.
2. **Refine spoils** (`normalize-capture`) — validate the bundle.
3. **Scribe a grimoire** (`scaffold-framework`) — draft a framework candidate (Iron rank)
   from one or more refined bundles.
4. **Rehearse** (`replay-framework`) — check the candidate is safe to run again,
   unattended, with the same good outcome.
5. **Rank up** (`promote-framework`) — promote a validated, replay-checked candidate into
   a registered grimoire.

## The homebrew default (config-driven)

When a candidate is scaffolded without an explicit service category, it lands in
`frameworks/homebrew/<name>/` by default — you don't have to remember to ask for it.
This default is read from a small piece of local configuration at candidate-creation
time, not hardcoded: naming a service category explicitly always overrides it, and a
repository that never sets the config behaves exactly as it always has (no service
category preference, byte-identical to a repo without this feature at all). The
mechanism that reads this default lives in the workspace tooling itself
(`tools/workspace/`) — this page only describes the behavior a user sees.

Once a candidate is promoted, its service category is fixed. Promotion validates the
category a candidate already carries rather than silently rewriting it, so a candidate
you deliberately scaffolded under a shared, non-homebrew category stays there through
promotion — the default only ever applies at the moment of creation.

## Rank still applies

A homebrew grimoire climbs the same rank ladder as any other — Iron, Bronze, Silver,
Gold — on the same terms of evidence, not intention. See
[`../LEXICON.md`](../LEXICON.md#rank-ladder) for the full ladder and the dual apex above
Diamond.

## See also

- [`frameworks/homebrew/_template/README.md`](../../frameworks/homebrew/_template/README.md) — anatomy of a homebrew grimoire
- [`tools/homebrew/_template/README.md`](../../tools/homebrew/_template/README.md) — conventions for homebrew tools
- [`../USER-SPACE-GUIDE.md`](../USER-SPACE-GUIDE.md) — the full picture: your data, your homebrew, your Mirror
