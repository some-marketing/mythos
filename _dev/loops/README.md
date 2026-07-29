# Loop Charters — doctrine

A loop charter is a durable definition for a self-improving work loop over one bounded
domain (one patron's work, one grimoire, one system surface). It is the *definition*,
not the driver: you write the charter once, then drive it by repeatedly invoking
`/guildmaster-loop` (orchestrate-loop) against it — once per iteration, whether that
repetition is paced by hand or by your own scheduler. A charter with no driver behind
it is just documentation; the loop only exists while something is actually running it.

Plain-software gloss: a loop charter is a config file for a recurring agent task —
it names the goal, the state sources, the gates, and the stop condition, and a separate
scheduler/orchestrator reads it and executes.

## The five load-bearing properties every charter must have

### 1. Durable-artifact state rebuild — never chat memory

Every iteration starts by rebuilding "what's true now" from files on disk: an external
tracker (if you use one), live handoff signals under `_dev/reports/signals/`, git
history, and any domain-specific state (a milestone queue, a descriptor set, a review
signal surface). A loop that trusts its own chat memory across iterations will
confidently repeat work it already did, or skip work it never actually finished. If the
charter's state sources aren't reconstructible from durable artifacts, the charter is
not ready to run unattended.

### 2. The cycle contract: deliberate → convene → synthesize → orchestrate

Each iteration cascades a bounded unit of work through the same fixed shape: reason
about the work (deliberate), bring in other minds if the decision warrants it
(convene), merge the perspectives into one decision (synthesize), then route the actual
execution through the orchestration loop (`/guildmaster-loop`) rather than improvising
ad hoc delegation. The charter names *when* each of these legs fires — not every
iteration needs a full convene, but the charter should say what triggers one.

### 3. Gates — protected-path declarations

A charter must name, explicitly, which surfaces it may touch autonomously and which
surfaces require the operator. The two failure modes this guards against: a loop that
quietly widens its own authority over time, and a loop that stalls on every trivial
decision because nothing was ever pre-cleared. Typical gate classes:

- **Autonomous** — low-risk, reversible, within the charter's declared domain.
- **Governance-gated** — touches the loop's own rules, a shared system surface, or
  anything defining what counts as "safe" for this loop.
- **Operator-gated** — money, irreversible action, external publish, credentials, or
  anything genuinely requiring human judgment.

A charter that cannot say which class a given change falls into should treat that
change as the higher class by default (ambiguity escalates, it never de-escalates).

### 4. Adversarial review — a producer never validates its own trial

Whatever mind or worker produces an iteration's output is not the mind that grades it.
At minimum, a distinct model or a human reviews acceptance-grade output before it
counts as done. This is the same rule the Core states generally
(`../../instructions/canonical/kernel/doctrine.md`) — a loop charter doesn't get an
exception just because it's automated.

### 5. Amendment / evidence ledger

Loops evolve. When a charter's own rules change — a gate gets tightened, a scope
boundary moves, an autonomy layer gets reclassified — that change is itself a durable,
dated edit to the charter file (or a linked amendment record), never a silent behavior
drift. Likewise, every iteration's outcome (what ran, what was produced, what was
graded, what got escalated) belongs in a durable evidence trail — a chronicle
(`/chronicle`), a signal, or equivalent — not only in the charter author's memory of
having run it.

## Writing a new charter

Start from `_template.md`. Read `homebrew-grimoire-improve-loop.md` for one fully
worked, fictional example of all five properties applied to a concrete (invented)
domain. A charter that skips any of the five properties above is not ready to drive
unattended — it needs an operator in the loop until it has them.

## Relationship to other policies

- `../policies/plan-contract.md` — the charter's individual bounded units, when they
  become quest charters (task plans), follow this contract.
- `../policies/command-follow-through-policy.md` — governs which of a loop's own
  follow-up actions may auto-run vs. must surface for operator judgment.
