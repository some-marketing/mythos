# ant-hive-world

A small, from-scratch multi-agent simulation engine: independent "hive" minds
compete and cooperate over a shared, resource-scarce environment, learning
purely from the simulation's own outcomes -- no pretrained model, no
hand-authored strategy, no persisted weights between runs.

This directory is a generic-engine extraction from a larger private project.
Everything here is simulation-engine and agent-orchestration code: world
state, a decision loop, a from-scratch reinforcement-learning network, a
live dashboard, and an optional narrative/wiki layer. World-specific lore,
character identities, and narrative canon from the source project have been
stripped -- what ships here is the mechanism, not the story.

## What shipped (a working engine)

- **`world-state.js`** -- the shared environment both hive-minds read and
  write: a finite, contestable resource pool, discrete depletable food
  sources, pheromone trails (stigmergic signal field), and simple
  population-level predator/prey ecosystem dynamics. Tear-free atomic writes
  (temp file + rename) so a crash mid-write never corrupts the shared state
  for the next reader.
- **`harness.js`** -- one isolated sandbox per hive (own state file + audit
  log) plus read/write access to the one shared world-state file. A single
  `tick()` function: sense -> decide -> apply -> log. The decision function
  (`decideFn`) is fully pluggable -- swap in an LLM call, a scripted stub, or
  a learned network without touching this loop.
- **`untrained-network.js`** -- a genuinely untrained, from-scratch
  feedforward network (tiny: 9 inputs, 8 hidden units, 5 outputs) with a
  REINFORCE-style policy-gradient update. No deep-learning framework
  dependency -- the state/action space is small enough that a fully
  hand-written, fully inspectable forward pass + gradient update is more
  honest and auditable than pulling in a large ML library at this scale.
- **`train-tick.js`** -- composes decide -> apply -> upkeep-decay ->
  reward -> learn into one training tick. Includes a decaying
  entropy-bonus schedule and a reactive entropy controller: both exist to
  counteract policy collapse (a network locking onto one action and never
  exploring again), a real failure mode this project hit and fixed.
  Both mechanisms are fully inert by default (opt-in via config) so the
  base training loop is unaffected unless explicitly enabled.
- **`run-live.js`** -- an attended run driver: sets up N hives, gives each a
  fresh network, and drives ticks to a durable JSONL run log. `--arm` records
  experimental-arm membership and defaults to `uninstructed`.
- **`event-schema.js`** / **`EVENT-SCHEMA.md`** -- the versioned contract for
  audit, geometry, and run-log rows: process-stable run/episode/arm identity,
  a tick on every event, and embedded state-at-time-of-use. Historical rows
  remain readable and are classified as `pre-contract`.
- **`dashboard.js`** -- a zero-dependency local HTTP dashboard (plain HTML +
  polling JS, nothing leaves localhost) showing live resource/territory/
  population state and exposing every tunable simulation constant as a form
  the operator can edit while the sim is running, without restarting the
  process (a restart would lose the network's learned weights, which live
  only in process memory by design -- see below).
- **`live-config.js`** -- the plain-JSON, atomically-written config file
  behind the dashboard's live-tunable variables.
- **`generate-blank-hive-seed.js`** / **`validate-hive-mind.js`** /
  **`schema/hive-mind.schema.json`** -- a minimal schema and validator for a
  hive-mind's state document, plus a generator that produces a genuinely
  blank seed (empty resources/territory/dispatch-state) so a fresh hive
  never starts with pre-loaded instinct or behavior.
- **`llm-decide.js`** -- an alternative decision function: dispatches the
  hive's current sense-state to a local LLM (via Ollama) with a
  no-pre-loaded-strategy system prompt, and enforces the harness's closed
  verb set regardless of what the model returns. Useful as a second,
  interchangeable `decideFn` to compare against the learned network.
- **`lore-engine/`** -- an optional, fully decoupled narrative layer.
  `detect-triggers.js` is a pure, read-only function that turns new
  audit-log events into narratable trigger events (discoveries, structures
  built, territory claims, population booms/crashes) -- no file I/O, no
  model calls, trivially unit-testable. `generate-entry.js` turns a
  routine-tier trigger into a short wiki entry via a local-model dispatch
  (pluggable `dispatchFn`, defaults to a local Ollama call). `watch.js` is a
  standalone poller (its own interval, its own process) that never touches
  or slows the simulation itself, with retry/failure handling and a
  crash-safe PID lock so two watcher instances can't race each other.
- **`embodiment/`** -- a minimal, self-contained MuJoCo physics smoke test
  (a placeholder body falling onto a ground plane, logged and verified
  against deterministic settling-time/no-penetration/no-NaN invariants).
  Included as a clean example of a scripted physics-simulation verification
  pattern; has no dependency on anything else in this directory.

## The "fresh minds" pattern (worth calling out)

This project enforces a specific, deliberate discipline: **every run
creates a genuinely fresh mind. Nothing is ever persisted or loaded from a
previous run.**

Concretely:

- `createNetwork(seed)` in `untrained-network.js` always initializes small,
  near-uniform random weights from a seed. There is no `loadNetwork()`,
  no checkpoint file, no saved-weights path anywhere in this codebase.
- `run-live.js` derives its seeds from `Date.now()` by default (offset per
  hive so the two minds are never identical to each other), and documents
  explicitly why: an earlier version of this file hardcoded fixed seeds,
  which meant "starting fresh" silently replayed the exact same initial
  weights every time -- not a new mind at all. That was treated as a bug
  and fixed; reproducible fixed seeds are still supported, but only via an
  explicit `--seed-a`/`--seed-b` override, never as the default.
- Per-hive entropy-controller state (`{ active, prev_post_update_entropy }`
  in `run-live.js`) is created fresh at process start and passed explicitly
  through the call chain -- never a module-level global (which could leak
  state between hives) and never written to disk.
- `normalizeResource()` in `untrained-network.js` is called out in its own
  comments as "fresh-minds compliant": a pure, stateless function of its
  input with no cross-tick or cross-run memory.

If you're adapting this engine for your own multi-agent simulation, this is
the one architectural principle worth preserving deliberately: a mind that
"learns" only within the lifetime of one run, seeded fresh every time,
is a fundamentally different (and more honest) claim than a mind that
carries pretrained knowledge or a persisted training history into a run
that's supposed to demonstrate learning from scratch. Baking in a
`--seed` override for debugging is fine; defaulting to a fixed seed is not.

## What was excluded, and why

- **World-canon content**: hive/colony narrative identity, any
  world-specific lore terminology, and specific example data referencing
  the source project's own sibling simulations have been removed or
  genericized in code comments. The lore-engine's prompt template
  (`lore-engine/generate-entry.js`) is intentionally generic ("an ant
  colony simulation's browsable wiki") rather than tied to any specific
  fictional setting.
- **`embodiment-bridge/`** (ported, sanitized): the source project's
  containment/remote-execution bridge for running the physics simulation
  on a separate machine. Ported with the private-infrastructure specifics
  stripped: the remote hostname, the operator username/path, the pinned
  image digest, and the containment-plan amendment IDs are replaced by
  environment-driven configuration (ANT_HIVE_EMBODIMENT_HOST,
  ANT_HIVE_EMBODIMENT_IMAGE_DIGEST, ANT_HIVE_EMBODIMENT_STAGE_DIR) with
  generic fallbacks, so the mechanism ships while the actual simulation's
  private specifics stay local. `embodiment/` (the local physics smoke test
  the bridge would eventually run remotely) remains fully portable and is
  included; only the operator-held host configuration is kept out of the
  tree.
- **A subset of `untrained-network.test.cjs`'s regression tests** (10 tests)
  still asserts specific checksum-verified fixture data embedded in
  private planning documents that recorded one historical
  policy-collapse investigation (an "entropy collapse" incident and its
  fix). Those fixtures are not portable -- they live in planning artifacts
  outside this export, so those tests report missing-fixture failures here.
  The remaining tests (all self-contained: network
  init, forward pass, `decide`/`trainStep` mechanics, the entropy-bonus
  schedule and reactive-controller inertness/hysteresis contracts, and the
  general non-fixture collapse/recovery regression tests defined directly
  in the test file) were kept and pass unmodified.
- Dev-history comments referencing the source project's internal planning
  IDs, amendment timestamps, and "operator (date): '<quote>'" annotations
  were left in place where they don't name a real person or reference
  private infrastructure -- they're accurate design-rationale history, not
  canon or PII, and removing them would have discarded real engineering
  context for no compliance benefit.

## Tests

`__tests__/` (13 files; 138 self-contained tests pass, while the 10 historical
fixture-dependent tests described above report their missing inputs):
harness/tick mechanics, world-state resource/territory/pheromone/ecosystem/
material dynamics, the untrained network's init/decide/train contracts, the
event and hive-state schema validators, the lore-engine's
trigger-detection/generation/watch loop
(with a mocked local-model dispatch, no network calls in tests), the
dashboard's snapshot/wiki-read endpoints, and a 3-item isolation checklist
(separate sandboxes, no reach-outside-this-directory requires, fault
containment on a torn per-hive write).

Run with: `node --test __tests__/*.cjs` from this directory.
