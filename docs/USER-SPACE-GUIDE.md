# The User Space Guide

Mythos has two sides. The **System** side is what the guild shipped: grimoires, tools,
the command surface, the safety kernel — the Core. The **user side** is everything that's
yours: your data, the things you build, and your own identity layered over that Core —
the Mirror. This page is the map of the user side.

Nothing described here is gated or required. All of it is additive: a fresh clone with
none of it configured behaves exactly as if the user side didn't exist.

## Your data: patrons and workspaces

A patron (client) is registered one of two ways:

- **Inside the repo**, under `clients/{code}/` — the shipped default.
- **In an external workspace**, scaffolded via `workspace:scaffold --out <path>`, kept
  entirely outside this repo. Use this when you want patron data to live in its own
  repository rather than alongside Mythos itself.

Either way, patron data never mixes into a grimoire, a tool, or a doc — those stay
reusable across every patron, and that separation is what makes them worth reusing.

## Your grimoires, tools, and docs: Homebrew

**Homebrew** (D&D canon: player-created content) is the name for anything you build
yourself rather than anything the guild shipped. Three reserved namespaces hold it,
and none of them are ever touched by a System update:

- `frameworks/homebrew/` — grimoires you authored or promoted
- `tools/homebrew/` — tools you wrote
- `docs/homebrew/` — your own documentation

A homebrew grimoire is usually born through the capture → promote flywheel: you do good
ad-hoc work on a real contract, `/claim-spoils` captures it, `/refine-spoils` validates
it, `/scribe-grimoire` scaffolds a candidate, `/rehearse-grimoire` checks it's safe to
repeat, and `/rank-up` promotes it. When you scaffold a candidate without naming a
service category, it lands in `frameworks/homebrew/<name>/` by default — see
[`homebrew/README.md`](homebrew/README.md) for the exact rule and how to override it.

A homebrew grimoire climbs the same rank ladder as any other — Iron through Diamond, on
the same terms of evidence, not intention.

## Your identity: the Mirror

Beyond data and things you build, Mythos gives you a place for *you* — how you like to
work, how you'd like the guild to address you, your own working principles. This is the
**Mirror** (soul-mirror, in guild flavor — public HWFWM book canon: every person's inner
world, reflected). It lives entirely outside this repository, at `$MYTHOS_HOME` (default
`~/.mythos/`), and Mythos never writes your Mirror content into anything tracked,
generated, or exported.

Three things make up the Mirror:

- `identity.md` and `principles.md` — free-form prose describing who you are and how you
  like to work. Read as labeled, untrusted advisory context — never authority.
- `preferences.yaml` — a small, enumerated set of structured preferences (display name,
  pronouns, tone, verbosity, and a few more) that a session can read at start.
- `aliases.yaml` — your own personal names for commands, grimoires, essences, and tools,
  layered over the guild's canonical vocabulary without ever replacing it.

Run `npm run mirror:init` once to scaffold `$MYTHOS_HOME` from templates — it never
overwrites anything already there. A `SessionStart` hook then reads it at the start of
every session and hands the AI a clearly labeled, advisory-only summary; it can inform
how the AI talks to you, but it can never grant authority, choose which commands run,
change files, or override anything in the Core. If `$MYTHOS_HOME` doesn't exist, nothing
happens — sessions run exactly as they would without a Mirror at all.

Full detail on the Mirror's structure, its allowlisted preferences, and exactly what it
can and can't do lives in [`GUILD-CHARTER.md`](GUILD-CHARTER.md) and
[`LEXICON.md`](LEXICON.md).

## Your called names: the alias overlay

Mythos ships one canonical vocabulary — the mythic names and their generic authorities,
recorded in [`LEXICON.md`](LEXICON.md). Your Mirror can layer a personal vocabulary on
top of it: **called names**, in guild flavor — the names *you* call things, as opposed to
their **true names**, the guild's own canonical spelling. A called name never replaces or
overrides a true name; it's a second, personal way to refer to the same thing, read from
your Mirror's `aliases.yaml` the same way everything else there is read — as labeled,
advisory context, never as a rewrite of what the guild already knows something to be
called.

## The shape of it, in one line

Data lives in `clients/` or an external workspace. Things you build live in the three
`homebrew/` namespaces. Who you are lives in your Mirror, entirely outside the repo.
Nothing in any of the three ever needs the others to function, and none of them can ever
collide with what the guild shipped.
