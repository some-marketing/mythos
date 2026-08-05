# Task Plan — ant-world-mind-learning-path

> Operator: "this train is going lets /go" (2026-08-05T03:10Z) · Scope: system · Risk: medium
> Closes the thinks-but-cannot-learn gap (zero update call sites; 300-tick weights byte-identical)
> Sequenced after mind-repair commits; the pre-stamped Orwell continuity control does NOT wait for this.

## Steps

- **S0** — Learning-signal design memo BEFORE code: recon how hives learn
  (train-tick.js) and the world-mind's verb/outcome surface; 2–3 candidate signals
  (outcome reward / world-level objective / prediction-error), each scored for what
  it optimizes, mirror-gate interpretability (a signal rewarding build-near-features
  would make the mirror measure the reward — the confound to avoid), checkpoint
  footprint, determinism. Recommendation + **G-LEARNING-SIGNAL-DESIGN** codex review
  before any implementation.
- **S1** — Implement the reviewed signal: deterministic under fixed seeds; every new
  mutable state joins the checkpoint generation (inventory dated-addition,
  serialization, config-hash treatment distinguishing shape changes — which
  invalidate — from training-state changes — which must not).
- **S2** — Prove it LEARNS (`WorldMindLearning/1.0`): weights change AND change
  deterministically; RELATIVE liveness criteria calibrated from the repair's probe
  data (replacing the miscalibrated absolute bars); objective metric improves (n=2);
  **mid-learning checkpoint round-trip byte-exact** — the true continuity-of-learning
  proof the convene wanted; frozen-mind control isolating the delta.
- **S3** — Codex trial (**G-MIND-LEARNING-REVIEW**) + debrief. Deploying the learning
  mind is a FRESH operator decision (explicitly outside the continuity-control
  pre-stamp's coverage).

## Amendment r1 (2026-08-05T03:18Z — codex review 20260805T031209Z, NEEDS_AMENDMENT: 4 MAJOR + 2 MINOR, all dispositioned)

- **CheckpointManifest/1.1** (MAJOR 1): shape_hash (dims + encoder count; mismatch =
  refusal) split from training_config_hash (optimizer/hyperparams; mismatch = WARN);
  1.0 manifests readable via legacy-hash fallback; the bump itself on the S3 trial
  surface.
- **world-mind.js:11-13 stale header** (MAJOR 2): fixed in the mind-repair slice
  pre-commit.
- **S0 memo now carries quantified deliverables** (MAJORs 3–4): exact signal
  equation; mirror-safety contract (excluded feature inputs, lag structure, and a
  designed shuffled-features confound test — signal fails if mirror-p "improves"
  under shuffling); noise floor = max L2 across 10 fresh seeds; frozen band =
  entropy min/max over a 300-tick frozen run; "monotone-ish" replaced by a
  3×-band departure rule consistent across seeds.
- **A/A′ compares the full generation** — weights, optimizer, RNG, world state,
  checkpoint bytes (MINOR). **world-train.js decided** as a separate module;
  train-tick.js gains only the call site (MINOR).

## Amendment r2 — memo ADOPTED (2026-08-05T03:49Z; design review 20260805T034254Z: substance passed, candidate (c) supported)

- **Signal**: one-step masked prediction error on a hidden-layer head — the only
  candidate that doesn't grade its own exam (the mind's seed verbs author 87% of the
  mirror detector's features; outcome/homeostasis rewards structurally confounded).
- **Call site**: run-live.js world block (L509–557); train-tick.js untouched.
- **Criteria**: (b″) parameter displacement > 0.05 vs frozen-control-at-0 = PASS
  (measured headroom 0.2146); (b‴) policy-L2 inverted to a contamination alarm
  (>10× floor 0.012275 under (c) = flag + fail pending diagnosis). Constants
  measured, provenance in the memo.
- **Checkpoint**: 1.1 shape_hash covers dims+encoder+head shape;
  training_config_hash covers lr+mask+rule; Wp/bp/prev_features join the
  generation; lazy-prediction invariant asserted; skipped-block resets the carry;
  1.0 manifests report training hash UNKNOWN.
- **Confound test**: deterministic (permutation seeded from turn_id, recorded).

## Amendment s3 (2026-08-05T04:17Z — S3 trial 20260805T041202Z: F1 confirmed from code, ruling encoded)

- **S1b inserted**: the shared world-state writer gains a `hives` summary
  {count, starvation_pressure} from data already in memory (no new reads, no
  membrane impact); encoder coords 4/7 come alive; dead-zero-coordinate assertion
  added; then (b″) is re-measured at the SAME contract-hashed rate — pass as
  specified, or return to the gate with two-dimensional measurements in hand.
- **D1 formalized**: confound verdict binds only when a mirror claim exists
  (p<0.05 AND ≥4 distinct build tiles); literal rule always reported verbatim.
- Nine passing criteria and all checkpoint/determinism contracts retained.

## Boundaries

Local sandbox only; membrane/courier untouched; hive training paths reused, not
redesigned; determinism non-negotiable.
