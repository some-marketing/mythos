# Task plan — ant-world operator console (dashboard + wiki + steering)

> **REVIEW VERDICT 2026-08-03T00:57Z: CHANGES-REQUIRED** (codex, distinct family).
> Review: `convene-runs/20260803T005456Z-ant-world-operator-console-plan-review/truth__codex.md`.
> State marker: `_dev/state/plan-task-review-state/ant-world-operator-console.json`.
> **This plan MUST NOT execute as written.** The body below is preserved as the reviewed
> artifact; the corrections that supersede it are in *Post-review corrections* at the end.
> Headline: the event schema cannot support what S1 promises, the OQ3 threshold resolution
> is wrong, and the console steps are blocked behind a schema contract that does not exist.

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

---

## Post-review corrections (2026-08-03T00:58Z, folding codex CHANGES-REQUIRED)

The review is accepted in full. Five findings are structural and one is a factual error in
this document. Corrections below SUPERSEDE the step definitions above.

### C1 — the event schema is the real first step (supersedes S1 as drafted)

**Finding F1, blocking.** `material-discovered` and geometry rows carry wall-clock
timestamps but no tick (`harness.js:193,201`; `harness.js:125`), and audit tick rows omit
stockpile and build geometry (`harness.js:194`). The showcased index record — "89% adjacent
to a depleted food source, never while stockpile > 12" — is **not constructible from the
declared inputs**. That was the plan's flagship example and it was unbuildable.

**Finding F6** compounds it: `run-log.jsonl` has no run ID, episode ID, or comparison-arm
identity (`run-live.js:144`), and S1's "distinct episodes" silently relied on
directory-name inference rather than a repository contract.

**Correction:** a new **S0 — event-schema contract** precedes everything: tick on every
event, durable run and episode identity, comparison-arm identity, and either
state-at-time-of-use recorded on the event or a defined join key into `run-log.jsonl`.
Historical adjacency remains unrecoverable for existing runs — the probe sandboxes cannot
be retrofitted, so S0's outputs apply to future runs only, and any claim about existing data
must be limited to what those logs actually contain.

### C2 — the recurrence threshold is unjustified and its falsifier was invalid

**Finding F4.** `DEFAULT_STRUCTURE_MILESTONE_COUNTS = [5,10,25,50]` governs structure
*narration* milestones (`detect-triggers.js:90`), not evidence of semantic stability;
reusing 5 supplies no empirical justification. Worse, `material-discovered` is a **passive
environmental event** attributed to whichever hive happened to advance the world
(`harness.js:175`) — so the probe's 48-per-material repetitions measure **fixture
repetition, not use by minds**, and S1's "the five known materials reach established"
falsifier proved nothing.

**Correction:** OQ3 is REOPENED and reclassified **operator/convene**, not
research-resolved. Passive environmental discoveries and mind-authored terms must be counted
in separate classes and never mixed. No threshold is adopted until justified.

### C3 — rename the surface: behavioural/event index, not lexicon of meanings

**Finding F5.** Counting events claims nothing about internals; calling those counts a
term's *meaning*, *their use*, or a *grounded behavioural definition* re-imports exactly the
claim the earlier framing was retired for. And `chamber` is hard-coded by us
(`untrained-network.js:222`), as are the material names — authored labels do not become
colony representations by being counted.

**Correction:** the artifact is a **behavioural/event index** reporting **correlations**.
The words *meaning*, *definition*, *understanding*, *lexicon* and *their language* are
struck from the surface and from the concept. The operator's translation goal survives only
in the honest form: *here is what co-occurs with this label*, never *here is what they mean
by it*.

### C4 — S3 and S4 are blocked, not merely sequenced after, the battery

**Finding F6.** Deferring the problem battery to its own charter is endorsed, but the
console's trajectory panels and steering segmentation depend on schemas the battery must
define. Building them first would bake in the wrong shape.

**Correction:** S3 and S4 are BLOCKED on both S0 (schema contract) and the battery charter.
Revised order: **S0 → battery charter → S1/S2 (index + tests) → S3/S4**.

### C5 — real falsifier replaces the implementation checks

**Finding F7.** The empty-wiki and single-nonce tests are implementation checks: an empty
wiki can fail from a rendering bug, and a one-occurrence nonce is guaranteed to sit below
any threshold. The genuine negative control is **a meaningless nonce deliberately repeated
five times across two hives and two episodes** — which the proposed arithmetic would
*incorrectly establish*. Adopted as the binding falsifier; the index must reject it, and if
it cannot, the recurrence construct is refuted rather than the implementation being buggy.

### C6 — factual correction: the console is not localhost-only

**Finding F8.** `dashboard.js:472` calls `server.listen(PORT)` without binding loopback, so
the existing dashboard is reachable on the host's other interfaces. The plan's
"localhost-only" risk claim was **false as written**. Binding to `127.0.0.1` is added to S3
as a correctness fix, and — since operator ruling R1 makes the console operator-only — this
is a containment fix, not a nicety.

### C7 — a code-review profile cannot ratify the research construct

The reviewer stated its own scope limit: sufficient to reject the plan as executable, too
narrow for consequence-grade consensus on whether recurrence is a defensible research
construct. **Before any recurrence threshold is adopted, that question goes to a
consequence-grade convene**, not to another code review.

### Also confirmed correct by review (no change needed)

The live-config form and POST endpoint (`dashboard.js:261,433`), per-round config re-read
(`run-live.js:134`), weights held only in process memory (`run-live.js:79,96`), read-only
trigger detection exporting `[5,10,25,50]` (`detect-triggers.js:5,17`), the
`discovered_types` diff, and OQ4's compatibility with the COSMETIC-ONLY gate (sound
mechanically and in spirit). One overstatement corrected: `appendGeometry` stores arbitrary
entries without validating `kind` or `coords` (`world-state.js:148`), and `llm-decide`
validates only that a verb exists (`llm-decide.js:39`) — so build `kind` strings are
unvalidated free text, which the index must treat as untrusted input.
