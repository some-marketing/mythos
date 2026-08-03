# Ant-world operator console — dashboard, wiki, steering

> Concept · authored 2026-08-03T00:52Z · session c76a44f9 · branch `client-storage-cloud-drives`
> Status: CONCEPT — blueprint leg of `/bp-r`. Nothing built, nothing ratified.
> Supersedes the framing in [[growing-dashboard-mind-legibility]], which chased a
> measurement-instrument reading the operator did not intend. That document's *research*
> stands and is load-bearing here; its *framing* is retired.
> Deliberate leg: carried forward from convene `20260803T003126Z-growing-dashboard-mind-legibility`
> (kernel triad, consequence-grade) rather than re-run.
>
> **CONTRACT NOTICE (2026-08-03, after codex PR review).** The surface described here is a
> **behavioural/event index that reports correlations**. It makes NO claim about what any
> mind represents, means, or understands. Where the words *meaning*, *definition*,
> *lexicon*, *understanding*, or *their language* appear below, they describe either the
> operator's original request or a retired framing — they are never the contract. Any
> workflow loading this concept should take the correlation contract, not the prose around
> it. (This notice exists because correction C3 in the plan claimed those words had been
> struck from the concept when they had only been struck from the plan — corrections do not
> propagate themselves.)

## What the operator actually asked for

Three things in one surface, stated plainly:

1. **A dashboard** showing what the ants are building in the engine, growing in detail as
   they discover more of the world — "like a real-time strategy game that progresses
   through epochs, where more resources open up as you go."
2. **A wiki knowledge base** of everything they have come up with, expressed in our best
   translated terms, mapping their understanding of the world onto ours.
3. **A steering mechanism** — the ability to add instructions or prompts at intervals.

The purpose is legibility and control: *"it's largely so i can see what's happening. i need
a way to interpret the progress."* This is an operator console, NOT an interpretability
instrument. It makes no claim about what any mind internally represents.

## The substrate already exists

This is not a from-scratch build. Verified in-repo 2026-08-03T00:50Z:

- `tools/ant-hive-world/dashboard.js` (476 lines) — localhost console, polls world state,
  renders per-colony resources/territory/metrics, hosts the lore-engine wiki panel, and
  already carries a **live-tunable variable form** writing `live-config.json`.
- `tools/ant-hive-world/live-config.js` — ~20 operator-tunable knobs, re-read fresh every
  round by `run-live.js:140` so no restart is needed (restart would lose in-memory weights).
- `tools/ant-hive-world/lore-engine/` — `detect-triggers.js` already tracks
  `discovered_subjects` per hive; `generate-entry.js` narrates to `wiki-log.jsonl` via
  local Ollama. Read-only over the audit log by design (COSMETIC-ONLY gate).
- `audit-log.jsonl` — append-only, the only genuinely append-only event source in the
  project. Already carries `tick`, `territory-contested`, `build-insufficient-materials`,
  and **`material-discovered`**.
- `world-state.js` — `geometry_log` records every structure with its `kind` and coords;
  `discovered_types` is the world's own progression state.
- `run-log.jsonl` — per-tick per-hive action, applied, starved, reward, policy entropy,
  forced-exploration flag, stockpile.

**The epoch mechanism the operator described is already firing.** `harness.js:185-201`
diffs `discovered_types` before and after each world advance and emits one
`material-discovered` audit event per newly-discovered material. Existing probe run data
contains 240 such events across five materials — clay, water, ore, fiber, mud, 48 each.

## The load-bearing correction: what "their language" can honestly mean

The operator asked for "a lexicon of language so that we can convert the language as they
understand it into English." Taken literally this is not yet constructible, and building it
literally would manufacture a false impression of discovery:

- The **neural policy** (`untrained-network.js`) has a closed five-verb action space and
  emits no free strings. It has no language to translate.
- The **material names** — clay, water, ore, fiber, mud — are authored by us in
  `applyMaterialDynamics`. They are our vocabulary, not coined by any mind.
- The **LLM decider** (`llm-decide.js`, deepseek-r1 via local Ollama) does emit free
  strings — `kind` on a build, `resourceKey` on a gather — but it is an English-speaking
  model. A token-to-English gloss would be translating our own vocabulary back to
  ourselves and presenting it as their understanding.

**The honest and more useful construction: record what a label CO-OCCURS WITH, and make no
claim about what it means.** An index entry is therefore a *correlation record* derived
entirely from logged facts, with our reading marked separately as ours and carrying no
authority:

> **SUPERSEDED FRAMING, RETAINED FOR PROVENANCE.** This section originally said a term's
> *meaning* is given by how they use it, and called the entry a *grounded behavioural
> definition*. Codex review (2026-08-03, PR #6) established that this re-imports the
> representational claim the concept was written to avoid: counting events claims nothing,
> but calling the counts a "meaning" or a "definition" does. The surface is a
> **behavioural/event index reporting correlations**. The words *meaning*, *definition*,
> *understanding*, *lexicon*, and *their language* carry no authority anywhere in this
> document — where they survive below, they are describing the operator's original request
> or the retired framing, never the contract.

> **spire** — first built tick 1,204 by hive-0. Built 47 times across 3 episodes. 89% on
> tiles adjacent to a depleted food source. Never built while stockpile > 12.
> *Our reading (not theirs): a marker at exhausted foraging sites.*

Every clause above is a count over `audit-log.jsonl` and `geometry_log`. The only
interpretive sentence is explicitly labelled. This construction:

- makes **no claim about internals**, so it survives every objection raised by the
  kernel-triad convene and the external research (probing a memoryless net whose inputs
  already name the variable proves nothing — that critique simply does not apply to
  counting logged events);
- gives the RTS-epoch progression a mechanical unlock rule: an entry earns its place when
  it crosses a **recurrence threshold** (used N times, by M hives, across K episodes). A
  term used once is a nonce, not a concept;
- supplies the anti-flattery guard the research demanded, in its cheapest honest form —
  recurrence, not novelty, is what unlocks. A dashboard that grows on first sighting would
  flatter; one that requires recurrence across independent episodes cannot.

## Carried constraints (from convene + research, all still binding)

- **The mind must not read the console.** All three convene voices converged; a readable
  dashboard re-enters the observation space and re-raises every carriage confound. The
  console is operator-only.
- **Never show a series without its comparison arm.** The documented failure is an observer
  reading noise as learning from a lone number.
- **Steering is an intervention and must be logged.** Any run where the operator injects
  config changes or instructions must record that into `run-log.jsonl` so results can be
  segmented; an intervened run is not a clean experiment.
- **Generative machinery may render, never adjudicate.** Local-model narration (the
  existing lore-engine) may phrase an entry; it must never decide that an entry exists,
  invent counts, or author the grounded definition. Existence is decided by the harvester's
  arithmetic.
- **No claims about understanding.** The console reports what was built, gathered,
  discovered and used. It does not assert that any mind understands anything.

## Open questions

- **OQ1 (operator-only).** Which decider does the steering leg target — scheduled numeric
  config changes, natural-language instruction into the LLM decider, or both? These are
  different builds.
- **OQ2 (operator-only).** Natural-language instruction injection relaxes
  `G-NO-SCRIPTED-RIVALRY`, the rule written into `llm-decide.js` stating no strategy hint,
  no pre-loaded instinct, "whatever the hive does, it has to arrive at itself." That rule
  was set deliberately; relaxing it must be a decision, not a side effect.
- **OQ3 (research-resolved, see plan).** Recurrence thresholds for the unlock rule.
- **OQ4 (research-resolved, see plan).** Whether the lore-engine's COSMETIC-ONLY read-only
  gate is compatible with the harvester writing a lexicon artifact.
