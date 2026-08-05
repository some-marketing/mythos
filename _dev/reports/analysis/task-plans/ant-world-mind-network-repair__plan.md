# Task Plan — ant-world-mind-network-repair

> Operator: "well we gotta fix it" (2026-08-05T02:47Z) · Scope: system · Risk: medium
> Sequenced AFTER the checkpoint-loader slice commits (shared world-mind.js; evidence integrity)

## The bug (measured, from the checkpoint-loader S3 discovery)

`createWorldMind` → `createNetwork` sizes `W1` as `[8][9]` using the hive network's
`INPUT_SIZE` (9), while `encodeWorldState` emits 8 features. `input[8]` is undefined
→ every hidden pre-activation is NaN → `relu(NaN)=0` → logits collapse to
zero-initialized `b2` → **uniform [0.2×5] policy for every seed and every world
state** (seeds 1 and 999,999 measured identical). The world-mind has never produced
a decision that wasn't a dice roll. Explains r6's uniform world-verb distribution.

## Steps

- **S0** — Single-source the dimension: network input dims derive from the encoder's
  own feature count; construction-time assertion (encoder count === W1 columns,
  throw) makes the bug class unreintroducible.
- **S1** — Prove the mind is alive: NaN-free forward over 1000 states; policy varies
  by seed AND by state; if a weight-update path exists, prove weights change across a
  run — if none exists, REPORT it as the named successor gap (thinks-but-cannot-learn).
- **S2** — New honest baseline (300 ticks, n=2; expect non-uniform verb distribution)
  replacing r6/r7 as the regression standard, plus proof that a pre-repair checkpoint
  REFUSES to load post-repair (architecture-hash stage) — the forward-compat design
  exercised for real.
- **S3** — Codex trial (**G-MIND-REPAIR-REVIEW**) + debrief; only then does the
  payload rebuild enter the owning plan's G-REMOTE-MUTATION packet, and the Orwell
  continuity control runs with a thinking mind.

## Amendment r1 (2026-08-05T02:54Z — codex review 20260805T024845Z, diagnosis independently reproduced by the reviewer)

- **S1 bounded criteria**: 1000-state seeded fixture; zero NaN/Inf; seed sensitivity =
  L2 > 0.01 on ≥90% of states (seeds 1 vs 999999); state sensitivity = ≥100 distinct
  policy vectors at 1e-9 tolerance; non-degeneracy = mean entropy in
  (0.1, ln(5)−0.05); weight-update proven by pre/post checksums or the
  thinks-but-cannot-learn gap reported.
- **S2 exact evidence contract**: `MindRepairEvidence/1.0` with fixture, liveness,
  weight_update, baseline (chi-square vs uniform, p<0.001 standard — not sampled
  counts), checkpoint_invalidation (pre/post arch hashes + refusal transcript), and
  overall_verdict fields.
- **state-inventory.md:97 stale row** ([8][8] claim) refreshed with a dated
  correction, never a silent edit. Thresholds are coordinator defaults,
  operator-overridable.

## Boundaries

Local sandbox only; no VM/courier contact; old checkpoints refuse cleanly by design;
escalate if the fix demands encoder redesign rather than dimension rebinding.
