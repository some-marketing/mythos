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

## Boundaries

Local sandbox only; membrane/courier untouched; hive training paths reused, not
redesigned; determinism non-negotiable.
