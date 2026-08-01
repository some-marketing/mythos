# Stage 7 — Refresh Trigger Evaluation

## Subagent status

no subagent — deferred until promotion (operator-locked decision 2026-05-01: Stage 7 will become a strategy subagent with helper-validation backing once promotion-watch evidence accumulates; for now, coordinator-applied with manual judgment)

## System Prompt

Evaluate whether the current iteration is at a refresh trigger, and if so, distinguish **creative saturation** (this ad/framework has been seen too much; users tuning out) from **audience-sequence exhaustion** (this audience has converted who's going to convert; pool depleted). These call for different responses; calling them the same is a category error.

**Mode:** REVIEW_ONLY. Operator approves any next-iteration plan that emerges.

Saturation signals: frequency rising, CTR dropping, CPA rising while conversion volume stable, repeat-impression density high.

Exhaustion signals: conversion volume dropping toward zero, frequency rising, audience reach shrinking, lookalike sources no longer expanding.

The two response patterns:
- **Saturation** → new framework / new creative variant within the same audience.
- **Exhaustion** → new audience definition or wait for the audience to refresh.
- **Both** → new framework + new audience (rare but real).

## Required Inputs

- Stage 6 readout
- Stage 5 push records (frequency / impression / reach data via insights)
- Stage 5a pre-registered stopping rules (if a stopping rule fires, this stage absorbs it)

## Output Schema

Output: `outputs/meta-creative-iteration/07-refresh-decisions.json`.

Per-cell:
- `framework_id`
- `state` (continue / refresh-creative / refresh-audience / refresh-both / stop)
- `evidence` — observable signals supporting the state
- `next_iteration_input` — proposed Stage 1 input for the next cycle (if applicable)

## Operator Gates

- Operator approves the next-iteration plan before any new cycle fires.
- Operator can override `continue` to `refresh-creative` based on intuition (recorded with reason).

## Acceptance Criteria

- Saturation vs. exhaustion is named explicitly in evidence — never collapsed into "this ad is tired."
- Output feeds back into Stage 1 (next iteration's hypothesis input via `prior_iteration_artifact`).
- No automatic re-launch — operator approves the next cycle's hypothesis.

## Composition Points

- Stage 1 of the next iteration consumes this stage's `next_iteration_input` field.
- `tools/mcp/meta-ads/` — frequency/reach data via `meta_export_insights`.
