# Mythos — an Adventurer's Guild for AI Coding Agents

Mythos is an LLM operating system for reusable work frameworks, dressed as a Guild System. It is the same idea as any workflow-framework library — a filesystem workspace where an AI coding agent (Claude Code, Cursor, Codex, OpenCode, or any harness that can read a folder and follow structured instructions) loads reusable task templates and runs them with explicit guardrails — but every noun and verb in the surface vocabulary comes from a fixed, dual-canon fantasy lexicon: **Dungeons & Dragons** and **He Who Fights With Monsters (HWFWM)**.

That's not decoration for its own sake. A guild metaphor happens to describe this kind of system unusually well: a guildhall holds proven procedures (grimoires), members take on bounded jobs (quests) under a charter (a quest charter), someone checks the work before it counts (a trial), and members advance by demonstrated capability, not by claim (rank). The lexicon is a lens, never the mechanism — see [`docs/LEXICON.md`](docs/LEXICON.md) for the full design law on that point.

## The World, in Plain Software Terms

| Mythic term | Plain meaning |
|---|---|
| **Grimoire** | A framework — a reusable workflow template (prompts, schemas, guardrails, tools) |
| **Patron** | A client — the party a piece of work is done for |
| **Contract** / **Campaign** | A project — a specific engagement linking a patron to a grimoire |
| **Quest** | A task — one bounded unit of work |
| **Quest charter** | A task plan — the bounded scope and approach for a quest before it runs |
| **Trial** | A review — an adversarial check of finished work |
| **The Adjudicator** | The reviewer role — checks a trial; never the same mind that did the work |
| **The Guildmaster** | The orchestrator — routes work, never executes it directly |
| **Familiar** | A subagent — a dispatched mind doing bounded work |
| **Essence** | A skill — a packaged, reusable capability an agent can draw on |
| **Spoils** | A capture — successful ad-hoc work saved for later promotion into a grimoire |

Every mythic term is immediately followed by its plain-software meaning the first time it's used in any Mythos document — end-user legibility beats immersion, always.

## The Rank Ladder

Grimoires (frameworks) carry an honest maturity rank based on real use, not aspiration:

- **Iron** — candidate: structurally complete, little or no run evidence yet
- **Bronze** — registered: has run, limited repetitions
- **Silver** — hardened: multi-run production use with verified evidence
- **Gold** — replay-verified: proven safe to repeat unattended
- **Diamond** — reserved for the highest demonstrated tier

Above Diamond, the ladder splits into two apexes — and neither outranks the other:

- **Divine** — world-anchored mastery. A grimoire so deeply fitted to one patron's ecosystem (one domain, one world) that it reaches a level of fluency a generic template never could. Tethered, by design.
- **Transcendent** — untethered generalization. A grimoire refined until every patron-specific detail has been stripped out, leaving a fully client-agnostic template that works anywhere.

Both are endings. One goes deep into a single world; the other goes wide across every world. Neither is the "better" outcome — they're different answers to "what does mastery look like for this piece of work."

## Quick Command Tour

A dozen of the best commands to know, generic authority in parentheses:

- `/cast-grimoire` — run a grimoire's full prompt chain against a contract (`run-framework`)
- `/plan-quest` — draft a bounded quest charter before doing the work (`plan-task`)
- `/embark` — accept and execute an approved quest charter (`run-plan`)
- `/trial-quest` — put a quest charter through adversarial review before it runs (`review-task-plan`)
- `/chronicle` — write the end-of-session record: what happened, what's next (`debrief-run`)
- `/scry` — check guild-wide status: what's proven, what's blocked, what's next (`system-status`)
- `/enroll-patron` — register a new patron/client (`new-client`)
- `/open-contract` — start a new contract/campaign linking a patron to a grimoire (`new-project`)
- `/forge-grimoire` — build a brand-new grimoire from scratch (`new-framework`)
- `/rank-up` — promote a proven grimoire candidate to the next rank (`promote-framework`)
- `/conclave` — convene multiple minds for a trial when one isn't enough (`convene-review`)
- `/gauntlet` — the full high-rigor review protocol for load-bearing work (`evidence-loop`)

The complete command-to-authority mapping — including every short form and cross-alias from both source canons — lives in [`docs/LEXICON.md`](docs/LEXICON.md).

## Getting Started

New to command lines entirely? Start with [`QUICKSTART.md`](QUICKSTART.md) — it assumes nothing and gets you to your first quest.

## License

Apache-2.0. See `LICENSE` in the repository root.
