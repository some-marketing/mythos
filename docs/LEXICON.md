# The Mythos Lexicon

The full canon: world nouns, the complete command mapping, the rank ladder, reserved vocabulary, and the design law that keeps the whole thing from turning into make-believe.

## Design Law

Mythic names are **aliases**. Authority always belongs to the resolved generic command — the plain-software id every mythic name points to (`resolves_to` in [`instructions/canonical/command-aliases.yaml`](../instructions/canonical/command-aliases.yaml)). Nothing about *what a command does* changes because it has a fantasy name; the mythic layer is a narrative lens over a fixed mechanical surface, never load-bearing mechanics in its own right.

Practically, that means:
- If a mythic name and its generic id ever disagree about behavior, the generic id wins — the alias is wrong, not the mechanism.
- Every mythic term is explained in plain software terms on first use in any document. Immersion never comes at the cost of a reader understanding what's actually happening.
- A missing or wrong alias is a routing bug, not a lore inconsistency — it gets fixed the same way any other config typo does.

## World Nouns

| Mythic term | Plain meaning |
|---|---|
| Grimoire | Framework — a reusable workflow template |
| Patron | Client |
| Contract / Campaign | Project — a specific engagement linking a patron to a grimoire |
| Quest | Task |
| Quest charter | Task plan |
| Trial | Review |
| The Adjudicator | The reviewer role — never the mind that produced the work under review |
| The Guildmaster | The orchestrator — routes work, does not execute it |
| Familiar | Subagent |
| Essence | Skill |
| Spoils | Capture — successful ad-hoc work saved for later promotion |
| Mimic | Mock |
| Saving throw | Test / gate |
| Stat block | Manifest |
| Homebrew | User-created content (D&D canon) — a grimoire, tool, or doc you built yourself, as opposed to one the guild shipped |
| The Mirror (soul-mirror) | Your external user kernel — identity, principles, and preferences layered over the Core |
| The Core | The System kernel — immutable safety rules plus the guild's own doctrine |
| True name | A thing's canonical, guild-given name — the `resolves_to` authority every alias points to |
| Called name | Your own personal name for a thing, defined in your Mirror's alias overlay — never replaces a true name, only adds a second way to say it |

## Rank Ladder

Framework maturity, from unproven to fully hardened:

| Rank | Meaning |
|---|---|
| Iron | Candidate — structurally complete, little or no run evidence |
| Bronze | Registered — has run, limited repetitions |
| Silver | Hardened — multi-run production use with verified evidence |
| Gold | Replay-verified — proven safe to repeat unattended |
| Diamond | Reserved — the highest demonstrated single-track tier |

### The Dual Apex

Above Diamond the ladder forks into two endings, and this is doctrine, not a placeholder for "pick one later":

- **Divine** — world-anchored mastery. A grimoire so tightly fitted to one patron's ecosystem — one domain, one world — that it reaches a level of fluency a generalized template structurally cannot. Tethered by design; its power comes *from* that tether.
- **Transcendent** — untethered generalization. A grimoire refined until every patron-specific detail is stripped away, leaving a fully client-agnostic template that works in any world.

Neither apex outranks the other. They are different answers to "what does mastery look like here," not two rungs of the same ladder. A grimoire can pursue one, the other, or neither — but it cannot be graded as deficient for lacking the one it didn't pursue.

## Command Mapping

Generic (authority) → primary mythic name → short form → cross-alias from the other canon. A blank cell means none exists.

| Generic (authority) | Primary mythic | Short | Cross-alias |
|---|---|---|---|
| system-status | guild-ledger | scry | aura |
| orchestrate-loop | guildmaster-loop | gm | — |
| deliberate | commune | — | — |
| convene-review | conclave | — | — |
| blueprint | charter-quest | — | post-contract |
| concept-init | inscribe-lore | — | — |
| plan-task | plan-quest | — | draft-contract |
| review-task-plan | trial-quest | — | save-throw |
| run-plan | embark | — | accept-contract |
| evidence-loop | gauntlet | — | — |
| route / help-me-route | site | — | augur; consult-oracle (long form) |
| debrief-run | chronicle | chron | — |
| run-framework | cast-grimoire | cast | invoke |
| list-frameworks | bookshelf | — | spellbook |
| new-framework | forge-grimoire | — | — |
| scaffold-framework | scribe-grimoire | — | — |
| audit-framework | appraise-grimoire | — | identify |
| improve-framework | empower-grimoire | — | cultivate |
| promote-framework | rank-up | — | level-up |
| publish-framework | enshrine-grimoire | — | — |
| replay-framework | rehearse-grimoire | — | — |
| candidate-status | initiate-status | — | — |
| sync-manifest | attune-codex | attune | — |
| capture-task | claim-spoils | — | loot |
| normalize-capture | refine-spoils | — | — |
| capture-status | spoils-ledger | — | — |
| extract-skill | awaken-essence | — | feat |
| new-client | enroll-patron | — | — |
| new-project | open-contract | — | campaign |
| project-status | contract-ledger | — | — |

The complete, machine-readable version of this table (with `resolves_to` and `status` for every entry, including compatibility aliases) lives in [`instructions/canonical/command-aliases.yaml`](../instructions/canonical/command-aliases.yaml).

## Homebrew and the Mirror

Two more pieces of vocabulary cover the user side of Mythos — see
[`../docs/USER-SPACE-GUIDE.md`](USER-SPACE-GUIDE.md) for the full picture.

**Homebrew** is D&D canon for player-created content — anything you built yourself
rather than anything the guild shipped. Three reserved namespaces hold it
(`frameworks/homebrew/`, `tools/homebrew/`, `docs/homebrew/`), and none of them are ever
touched by a System update. A homebrew grimoire climbs the same rank ladder as any
other, starting at Iron.

**The Mirror** (soul-mirror) is your external, personal counterpart to the Core. It lives entirely outside this
repository at `$MYTHOS_HOME` (default `~/.mythos/`) and holds your identity, your working
principles, a small set of allowlisted preferences, and your own alias overlay. A
`SessionStart` hook reads it and hands the AI a labeled, advisory-only summary; the
Mirror can inform how a session talks to you, but it can never grant authority, choose
commands, mutate files, or override the Core. Absent a Mirror, a session runs exactly as
it would without one.

Your Mirror's alias overlay lets you define **called names** — your own personal names
for things — layered over the guild's **true names** (the canonical `resolves_to`
authorities recorded in the Command Mapping above). A called name is additive, never a
replacement: the guild always still recognizes the true name, and a called name that
happens to collide with someone else's true name in a different domain is legal — a
personal name for a tool and a canonical name for a command are different lookups
entirely.

## Reserved Vocabulary

The following terms are **reserved and excluded from this export** — they name session-lifecycle machinery (boot, shutdown, cross-session handoff, repo hygiene, daily status) that has not shipped publicly. They are recorded here only so a future port doesn't collide with them by accident:

- `dawn-rites` — boot
- `rest` — shutdown
- `break-camp` — cross-session
- `pass-the-torch` — next-session handoff
- `sweep-the-hall` — clean-house
- `quest-board` — whats-next

None of these names resolve to anything in this repository. Do not add commands under them without first confirming they're still reserved.
