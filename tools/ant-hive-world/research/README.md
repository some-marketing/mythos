# Research goals for simulation runs

This opt-in workflow starts with RG-01: compare random, frozen-neural and food-seeking policies under the same bounded conditions. It does not demonstrate learning. RG-02 (continuity), RG-03 (held-out learning), RG-04 (cue interventions) and RG-05 (retention and cost) are prerequisite cards and cannot execute yet.

The existing frozen-colony benchmark remains a **drift** check. Research is a separate **comparative** benchmark. Passing the former cannot establish competence or satisfy a research goal.

## Prepare and inspect

Prepare against a valid, future, immutable charter. No simulation runs during preparation:

```sh
node tools/ticktock/research-prepare.cjs <future-charter.json> rg01-development --seeds=1701,2701,3701 --rounds=300 --max-wall-ms=300000
node tools/ticktock/research-readiness.cjs <future-charter.json> _dev/sim-runs/research/_drafts/rg01-development.json
```

One round is one action and upkeep per declared hive, followed by one untrained world-mind action. The decision ceiling applies to each arm/seed; ticks are rounds per arm/seed. At most 20 seeds and 8 hives are accepted. `max_ticks` counts complete rounds per arm/seed (300 in the prepared draft), while `max_decisions` counts hive actions per arm/seed (600 for two hives). These are different units. `max_wall_ms` is a whole-batch wall ceiling, with the remaining budget passed to each arm. Evidence retains hive-level pre-action, action and post-upkeep accounting. Utility is the equal-hive average fraction of decisions with positive food after upkeep. The primary contrast is greedy-food minus random, per seed and mean; a positive value is diagnostic headroom, without a significance or generalization claim.

Initialization, adaptive-component inventory, configuration, sources and scorer hashes are frozen in the experiment. Separate policy and environment streams are declared by `rg01-split-v1`; they are not claimed identical to live randomness. Changing any frozen criterion requires a new batch and a prospective `supersedes` value, not an overwrite.

## Use through /tt

`/tt` and `/ticktock` resolve to the same command. Examples:

```text
/tt --research-spec _dev/sim-runs/research/_drafts/rg01-development.json
/ticktock --research-spec _dev/sim-runs/research/_drafts/rg01-development.json
```

The owning command/skill determines its argument handling. Its executable ORIENT path is:

```sh
node tools/ticktock/cycle-driver.cjs benchmark <future-charter.json> _dev/sim-runs/research/_benchmark/<charter-hash>/0/<unique-check-id>.json 0 _dev/sim-runs/research/_benchmark/<charter-hash>/0/signals --research-spec _dev/sim-runs/research/_drafts/rg01-development.json
```

For selected research, replace `<charter-hash>` with the unchanged charter hash and use a fresh `<unique-check-id>` for every benchmark or phase call. Diagnostic output is confined to `_dev/sim-runs/research/_benchmark/<charter-hash>/<cycle>/<unique-check-id>.json` and refuses overwrite. The signals directory must be exactly the same cycle directory plus `/signals`; delegate commands derive it if omitted. Admission rejects outside paths before any benchmark or signal effect. Successful drift verification precedes any selected-cycle receipt. Selection creates an immutable receipt at `_dev/sim-runs/research/_selections/<charter_hash>/<cycle_index>.json`. Every later phase checks this independent index. Omitting the selector after binding, changing its path/bytes, or changing any pinned identity refuses. An originally unassigned cycle remains ordinary developmental exploration.

After existing phase and authorization gates have been met, the research route uses:

```sh
node tools/ticktock/research-run.cjs <future-charter.json> 0 --benchmark-out _dev/sim-runs/research/_benchmark/<charter-hash>/0/<unique-check-id>.json --signals-dir _dev/sim-runs/research/_benchmark/<charter-hash>/0/signals --research-spec _dev/sim-runs/research/_drafts/rg01-development.json --authorized
node tools/ticktock/cycle-driver.cjs research-observe <future-charter.json> 0 --benchmark-out _dev/sim-runs/research/_benchmark/<charter-hash>/0/<unique-check-id>.json --signals-dir _dev/sim-runs/research/_benchmark/<charter-hash>/0/signals --research-spec _dev/sim-runs/research/_drafts/rg01-development.json
node tools/ticktock/research-debrief.cjs <future-charter.json> 0 --benchmark-out _dev/sim-runs/research/_benchmark/<charter-hash>/0/<unique-check-id>.json --signals-dir _dev/sim-runs/research/_benchmark/<charter-hash>/0/signals --research-spec _dev/sim-runs/research/_drafts/rg01-development.json
```

Run and debrief CLIs delegate to the owning cycle-driver, which performs fresh fingerprint checks. `--quick` debrief writes `not_evaluated`. Results distinguish validity, completion and diagnostic benefit; no result automatically promotes a goal or rewrites a charter. Valid null outcomes can complete. Invalid/incomplete evidence cannot demonstrate benefit.

## Readiness evidence

A supported goal flag does not mean ready. Readiness requires `_dev/sim-runs/research/_capabilities/rg01.json` with:

- `schema: ResearchCapability/1.0`, `source_identities_sha256` (canonical object hash of current source identities).
- `evidence: {path, sha256}` referencing a parsed `ResearchVerification/1.0` JSON report, `status: pass`, the same source hash, and true `checks.adapter_equivalence`, `accounting`, `isolation`, `reproducibility` from actual tests.
- `review: {path, sha256}` referencing a parsed `ResearchImplementationReview/1.0` JSON report, `status: pass`, the same source hash, and different actual `producer_family` and `reviewer_family` values.

These receipts record actual verification and independent review. Test fixtures label synthetic authorization/review evidence and keep it in temporary roots; it is never production evidence. Missing, changed or failing evidence reports `not_ready` and the precise gap. A later source change invalidates readiness and preparation.

## Filesystem and capability limits

Only `_dev/sim-runs/research/<batch>/<arm>/<seed>/` holds simulation output. Exclusive creation refuses existing batches, overwrite and resume. Path traversal, symlink parents, arbitrary output/status/checkpoint roots and undeclared fields are refused. Interruption and runtime failures preserve incomplete batch evidence. Module APIs accept isolated `repoRoot` only for fixtures; CLIs do not expose a root override.

Enforcement applies when the integrated commands are invoked. The `/ticktock` skill requires them; no global hook forces a model to invoke them, and direct `run-live` remains outside this research route.

Tests exercise tiny temporary fixtures. They are implementation checks, not scientific results. The preparation example uses three seeds and 300 rounds. Installation prepares and launches no batch.

`valid_inconclusive` is reserved in the shared result schema for later goals. RG-01 uses its fixed prospective rule: a valid positive mean is diagnostic benefit demonstrated; a valid nonpositive mean is benefit not demonstrated. This implementation does not change that rule after seeing outcomes.

The default preparation budget is 300000 ms for the entire batch. Set `--max-wall-ms=<integer>` prospectively (1–3600000 ms); a small ceiling can deliberately produce incomplete evidence. Revised drafts use a new batch ID and `--supersedes=<prior-batch-id>` while preserving the old specification.

## Public engine baseline

This integration uses the shipped public engine: food gather quantity is 1, upkeep and ecology retain public defaults, and the world mind has no learning path. Its existing environmental actions still run after each round; the research driver does not add a hive summary or a prediction head. Verifier, sweeper, planner, dream, and neuromodulator components are absent in this baseline. The component inventory records these limits. Frozen hive equivalence uses the public `trainTick` option `{freeze: true}`.

Private-development experiment specifications and capability receipts cannot be reused here: source inventories and configuration identities differ. Prepare and verify new local evidence against this checkout. No research result or ready capability receipt is shipped.
