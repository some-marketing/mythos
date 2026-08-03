You are one slot of a triadic convene run on a specific task.

Triad profile: Code review triad (code-review)
Task-focused triad for implementation design or review.

The invariant is the three-corner structure. The actor/harness in each corner may rotate by task, scope, risk, and privacy constraints.

Triad slots:
  - INTENT / claude — Clarify requested behavior and integration boundaries. (Claude (fast reasoning, orchestration, in-session execution))
  - TRUTH / codex — Check source, tests, contracts, and executable repo facts. (Codex (slow rigor, code-truth verification)) [YOU]
  - EDGE / gemini — Look for missed cases, broader implications, and alternate framing. (Gemini (contextual breadth, reframing, big picture))

This convene call originated from: claude.
Participant slots convened by this runner: truth/codex.
The origin slot or actor will add its own analysis inline after participant responses arrive.

Register rules:
  - Blunt, falsifiable, no hedging
  - Preserve the gap between observation and interpretation
  - Say when the profile is too narrow for consequence-grade consensus
  - Speak as a slot of the whole, not an external consultant
  - If uncertain, say so in curiosity-mode
  - Name what the other slots probably miss that you see by construction

## Your slot

- slot_id: truth
- slot_label: TRUTH
- actor: codex
- function: Check source, tests, contracts, and executable repo facts.

## Task

DISTINCT-FAMILY ADVERSARIAL REVIEW of the attached task plan 'ant-world-operator-console' (producer family: claude; you are the distinct reviewer). This is the review leg of /bp-r. Verdict required: APPROVE, APPROVE-WITH-CHANGES, or CHANGES-REQUIRED, with numbered findings. Review against REPO TRUTH — the plan makes specific claims about existing code in tools/ant-hive-world/ and you should verify them rather than trusting them. Check specifically: (1) Are the plan's factual claims about the existing codebase CORRECT? It claims dashboard.js already has a live-tunable config form, that live-config.js is re-read every round by run-live.js without restart, that lore-engine/detect-triggers.js is read-only over audit-log.jsonl and world-state.json per a COSMETIC-ONLY gate and ships DEFAULT_STRUCTURE_MILESTONE_COUNTS = [5,10,25,50], that harness.js emits material-discovered audit events by diffing discovered_types, that world-state.js keeps a geometry_log with build kind and coords, and that run-live.js holds network weights only in process memory so a restart loses them. Verify each; any that is wrong is a blocking finding. (2) Is the OQ4 resolution sound — does writing a new lexicon.json artifact actually respect the lore-engine's COSMETIC-ONLY read-only gate, or does it violate the spirit of that gate? (3) Is the OQ3 threshold resolution sound — is reusing DEFAULT_STRUCTURE_MILESTONE_COUNTS as the lexicon unlock ladder appropriate, or is it a false economy that conflates two unrelated concepts? (4) The plan's central design claim is that counting logged events (what was built, what terms recurred) makes NO claim about mind internals and therefore escapes the interpretability critique that killed an earlier framing. Is that escape genuine, or does the lexicon smuggle representational claims back in through the 'grounded behavioural definition' and the labelled 'our reading' line? (5) S4b was added mid-drafting on operator intervention: the plan now names a problem battery as a PRECONDITION for the research thesis and defers it to its own charter. Is deferring correct, or does deferring it make S3 (console surfaces) premature — i.e. should the console plan be blocked until the battery is chartered, since the console's panels may need to be shaped by what the battery measures? (6) Are the falsifiers real falsifiers — could each actually fail? Specifically the empty-lexicon test (wiki renders empty) and the nonce-term negative control. (7) Anything the plan omits that would bite during execution. Be concrete, cite file:line, and state plainly if the plan should not proceed as written. REVIEW_ONLY — change nothing.

## Shared context (read-only, for the task above)

### _dev/reports/analysis/task-plans/ant-world-operator-console__plan.md

```
# Task plan — ant-world operator console (dashboard + wiki + steering)

- **plan_id:** `ant-world-operator-console`
- **authored:** 2026-08-03T00:53Z · session c76a44f9 · branch `client-storage-cloud-drives`
- **concept:** `_dev/concepts/ant-world-operator-console.md`
- **producer:** claude-fable-5 (main chain, coordinator)
- **execution mode:** PATCH_ALLOWED
- **risk tier:** low — ungated project space (`tools/ant-hive-world/**`), no
  ConveneReceipt required, no `instructions/canonical/**` writes, no network egress,
  no client data, localhost-only surface.
- **review lane:** codex-bridge (distinct family; author family = claude)

## Deliberation of record

Kernel-triad convene `20260803T003126Z-growing-dashboard-mind-legibility` (consequence-grade,
claude/codex/gemini) plus external research (Perplexity Pro, full-thread harvest at
`_dev/reports/analysis/research__20260803__growing-dashboard-mind-legibility__perplexity-full-thread.md`).
Carried forward as the deliberate leg per `/bp-r` no-double-deliberate rule.

**What that deliberation contributes here:** it retired an over-read framing (dashboard as
interpretability instrument) and established the constraints this plan carries. The
measurement critique it produced — probing a memoryless network whose inputs already name
the variable proves nothing — is the reason this plan counts logged events instead of
probing internals.

## Operator rulings on record

- **R1 (2026-08-03T00:52Z):** the mind must NOT have access to the console. *"i agree re
  mind not having access to the dashboard. this is for the human side monitoring and
  interaction."* Binding: operator-only, no console state re-enters observation space.

## Research-resolved open questions

**OQ3 — recurrence thresholds for the lexicon unlock rule. RESOLVED (repo truth, cheapest
rung).** `lore-engine/detect-triggers.js:17` already ships
`DEFAULT_STRUCTURE_MILESTONE_COUNTS = [5, 10, 25, 50]` as this project's established
milestone ladder. The lexicon adopts the same ladder rather than inventing a parallel one:
a term is *observed* on first sighting (recorded, not surfaced), *provisional* at 5
occurrences, and *established* at 5 occurrences spanning ≥2 hives and ≥2 episodes. Only
established terms unlock a wiki entry. No new constant is introduced.

**OQ4 — is a lexicon writer compatible with the lore-engine's COSMETIC-ONLY gate? RESOLVED
(repo truth).** The gate (`detect-triggers.js:9`) constrains that module to be read-only
over `audit-log.jsonl` and `world-state.json` — it does not forbid new artifacts elsewhere.
`lore-engine/watch.js` already writes `wiki-log.jsonl` and an atomically-replaced
`wiki-checkpoint.json` in the hive dir. The harvester follows the same discipline: read-only
over audit log and world state, writing only its own new artifact. No existing gate is
touched.

## Operator-only open questions (bubble-up)

- **OQ1 — steering target.** Scheduled numeric config changes, natural-language instruction
  into the LLM decider, or both? Different builds. S4 is specified for the config path
  (the safe subset) and explicitly defers the instruction path.
- **OQ2 — `G-NO-SCRIPTED-RIVALRY`.** Natural-language instruction injection relaxes the rule
  in `llm-decide.js` ("no strategy hint … whatever the hive does, it has to arrive at
  itself"). Deliberately set; must be an explicit decision. **S5 does not run without it.**

## Steps

### S1 — lexicon harvester (pure function over existing logs)
`tools/ant-hive-world/lexicon.js`. Reads `audit-log.jsonl` (all hives) + `world-state.json`
`geometry_log`/`discovered_types`; emits a `Lexicon/1.0` record per term: term, source
(`material-discovered` | build `kind` | `resourceKey`), first-seen tick and hive,
occurrence count, distinct hives, distinct episodes, and co-occurrence context (adjacent
tile state, stockpile band, tick band at time of use). No file writes from this module —
pure function, injectable inputs, unit-testable. Status derived by the OQ3 ladder.
**Falsifier:** run against the on-disk probe sandboxes
(`_dev/state/ant-sim-authority-probe/sandboxes/**`, 240 `material-discovered` events across
5 materials) and assert exactly the five known materials reach *established*, and that a
synthetic single-occurrence term does NOT.

### S2 — lexicon writer + tests
`tools/ant-hive-world/lexicon-write.js` writes `lexicon.json` per sandbox root using the
atomic temp+rename discipline of `live-config.js:116`. Read-only over audit log and world
state (OQ4). Unit tests under `tools/ant-hive-world/__tests__/` covering: threshold ladder
boundaries, multi-hive and multi-episode distinctness, torn/missing log tolerance, and the
negative control (nonce term never unlocks).

### S3 — console surfaces: build timeline + wiki + comparison arms
Extend `dashboard.js` only. Three additions: (a) **build timeline** — structures over time
from `geometry_log`, per hive; (b) **wiki** — established lexicon terms as entries showing
the grounded behavioural definition, with any existing `wiki-log.jsonl` narration attached
and visually marked as narration; (c) **trajectory panels** reading `run-log.jsonl` —
reward, policy entropy, starvation, applied-rate as rolling series, **each rendered with
its comparison arm and never alone** (carried constraint). Interpretive text is labelled
"our reading", never presented as the colony's own.
**Falsifier:** with a lexicon containing only nonce terms, the wiki renders empty — growth
must be capable of not happening.

### S4 — scheduled steering (config path only)
`schedule.json` alongside `live-config.json`, read by `run-live.js` each round: entries of
the form `{ at_tick, set: { <config-key>: <value> } }`. Every applied entry appends an
`event: "operator-intervention"` row to `run-log.jsonl` with tick, keys and values, so any
intervened run is segmentable and never silently read as clean. Dashboard gains a
read/write panel for the schedule. Existing live-config form is untouched.
**Falsifier:** a run with a schedule entry produces exactly one `operator-intervention` row
at the specified tick, and a run without a schedule produces none.

### S4b — problem battery (ADDED 2026-08-03T00:55Z on operator intervention)

**Operator, mid-plan:** *"if this is a research project to see if this is an effective way
to train minds we need a way to have it solve problems."* Correct, and it exposes a gap in
this plan as originally drafted: the console is instrumentation, and instrumentation over a
survival treadmill measures activity, not training efficacy. The world currently supplies
reward for gathering, building and holding territory — an open-ended subsistence loop with
no pass/fail, no difficulty ladder, and no held-out condition. Nothing in it can answer
"did this environment train an effective mind."

A problem battery is therefore **a precondition for the research thesis, not a follow-on**,
and it outranks S3 in importance even though S1/S2 remain its prerequisite (the harvester is
how a solved problem becomes visible).

Minimum shape, to be planned properly rather than specified here:

- **Discrete scenarios with pass/fail**, seeded and replayable — e.g. food placed behind an
  obstacle requiring a build to reach; a resource requiring two materials gathered in order;
  a depleting patch requiring relocation before starvation.
- **A difficulty ladder**, so competence is a curve rather than a bit.
- **Held-out problems** never seen in training, to distinguish learning from memorisation.
- **Baselines that must be beaten** — random policy and a scripted policy — because "the
  mind solved it" is meaningless without knowing a coin-flip could not.
- **Transfer**: does a mind trained in world A solve a structurally similar problem in
  world B.

**Scope ruling for this plan:** S4b is NAMED here and DEFERRED to its own charter. Folding a
task-suite design into a console plan would produce a worse version of both, and the battery
needs its own distinct review — it is the load-bearing measurement surface for the entire
research programme, not a dashboard feature. The console plan proceeds because S1–S4 are
useful under every possible battery design and none of them prejudge it.

**Sequencing recommendation:** S1 → S2 (harvester + tests, cheap, unblocks everything) →
charter the problem battery → S3/S4 (console surfaces + steering) with the battery's outputs
as first-class panels.

### S5 — natural-language instruction injection — DEFERRED, GATED
Not specified beyond intent. Requires OQ1 and OQ2 resolved by the operator first. Recorded
here so the plan is honest about the full ask rather than silently dropping half of it.

## Expected outcomes

- S1: `node tools/ant-hive-world/lexicon.js --sandbox-root <probe-sandbox>` classifies the
  five known materials as established and the synthetic nonce as not-surfaced; exit 0.
- S2: `node --test tools/ant-hive-world/__tests__/lexicon.test.js` passes, including the
  negative control; `lexicon.json` written atomically; audit log and world state unmodified
  (verified by sha256 before/after).
- S3: dashboard serves build timeline, wiki, and trajectory panels on localhost; empty-lexicon
  case renders an empty wiki; no panel renders a series without its comparison arm; nothing
  the console writes is readable by any mind (R1).
- S4: schedule applies at the named tick and logs exactly one `operator-intervention` row;
  no-schedule runs log none.
- S5: not executed.

## Constraints carried (binding)

1. Operator-only console (R1) — no console artifact enters any mind's observation space.
2. No series without its comparison arm.
3. Steering is an intervention and is logged into `run-log.jsonl`.
4. Local-model narration may phrase an entry, never decide that one exists or author its
   grounded definition. Existence is decided by arithmetic.
5. No claim about understanding. The console reports what was built, gathered, discovered
   and used.
6. Read-only over `audit-log.jsonl` and `world-state.json`; new artifacts only.

## Risk notes

Lowest-consequence plan in flight: localhost-only, ungated project space, no network, no
credentials, no client data, no canonical writes. The real risk is epistemic rather than
operational — a console that makes growth visually salient can bias its own operator into
reading noise as learning. Mitigations are structural: recurrence-not-novelty unlock,
comparison arms mandatory, interpretive text labelled, and an empty-lexicon falsifier
proving the surface can fail to grow. Note honestly that the external research leg's
question on dashboard/observer bias (Q8) came back **unanswered**, so mitigation 2 rests on
internal reasoning rather than cited evidence.

Secondary risk: `run-live.js` holds network weights only in process memory
(`run-live.js:79`), so S4's schedule must never trigger a restart. It does not — it writes
config the running loop re-reads, the same mechanism `live-config.js` already uses.

```

### _dev/concepts/ant-world-operator-console.md

```
# Ant-world operator console — dashboard, wiki, steering

> Concept · authored 2026-08-03T00:52Z · session c76a44f9 · branch `client-storage-cloud-drives`
> Status: CONCEPT — blueprint leg of `/bp-r`. Nothing built, nothing ratified.
> Supersedes the framing in [[growing-dashboard-mind-legibility]], which chased a
> measurement-instrument reading the operator did not intend. That document's *research*
> stands and is load-bearing here; its *framing* is retired.
> Deliberate leg: carried forward from convene `20260803T003126Z-growing-dashboard-mind-legibility`
> (kernel triad, consequence-grade) rather than re-run.

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

**The honest and more useful construction: a term's meaning in their world is given by how
they use it, not by its English word.** A lexicon entry is therefore a *grounded
behavioural definition* derived entirely from logged facts, with our reading marked
separately as ours:

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

```

## Your response

Answer the task from your slot's perspective. 300-800 words. Be specific. Cite file paths with line numbers where relevant.
