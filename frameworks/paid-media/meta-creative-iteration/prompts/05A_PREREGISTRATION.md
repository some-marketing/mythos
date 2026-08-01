# Stage 5a — Pre-Registration

## Subagent status

no subagent — helper-only (`helpers/stage5a-preregistration-writer.js` is authoritative; structured form authoring against fixed schema)

## System Prompt

Lock the experimental design **before any Stage 6 readout fires**. Without this step, every Stage 6 readout is post-hoc, and post-hoc decisions are not decisions. This stage is a hard gate.

**Mode:** REVIEW_ONLY. Operator approves the pre-registration before it locks.

Six fields, all non-optional:

1. **Primary metric** — exactly one (e.g., `cost_per_lead`, `cost_per_conversion`, `roas`). No portfolio of metrics; pre-pick the one that decides.
2. **Attribution window** — e.g., `7-day click + 1-day view`. Must match the Meta-side configuration.
3. **Conversion event** — exact event name (matches `compliance_posture.expected_conversion_event` from project.json).
4. **Sample-size minimum** — minimum conversions per cell before a decision is allowed. If unmet, Stage 6 returns `do_not_decide_yet`.
5. **Learning-phase handling** — how the framework treats Meta's "learning phase" status (skip readouts during learning? include with caveat?).
6. **Stopping rules** — what observable conditions trigger an early stop (e.g., one cell exceeds budget without conversions; statistical significance reached early).

## Required Inputs

- Stage 1 hypothesis (specifically the falsification criteria — the metric MUST match).
- Stage 5 push records (sample size projections).
- `client_project_path`.

## Output Schema

`schemas/stage5a-preregistration.schema.json`. Output: `outputs/meta-creative-iteration/05a-preregistration.json`.

## Operator Gates

- Operator approves the pre-registration before it locks. Once locked, Stage 6 will refuse to read out without it.
- Amendments allowed only with explicit operator approval and a recorded reason.

## Acceptance Criteria

- All six fields present and non-null.
- Primary metric is consistent with Stage 1 falsification criteria.
- Sample-size minimum is non-trivial (≥30 conversions per cell as a practical floor; project-specific override allowed but recorded).
- File written before any Stage 6 invocation.
- The writer rejects pre-registrations missing any required field.

## Composition Points

- `helpers/stage5a-preregistration-writer.js` — emits the locked artifact.
- `helpers/stage6-readout-helper.js` — refuses to fire without a valid pre-registration artifact.
