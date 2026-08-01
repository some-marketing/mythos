# Stage 6 — Insights Readout (with `do_not_decide_yet` Gate)

## Subagent invocation

**Subagent:** `stage-6-insights-readout-agent` (spec at `frameworks/paid-media/meta-creative-iteration/.claude/agents/meta-creative-iteration/stage-6-insights-readout-agent.md`).

The coordinator dispatches this subagent AFTER `helpers/stage6-readout-helper.js` has produced its classification (decide / monitor / do_not_decide_yet) and written `06-readout.json`. The subagent does NOT classify and does NOT mutate `06-readout.json` — it reads the helper's verdict and emits a companion narrative artifact (`06-readout-narrative.json` + `.md`) validated against `schemas/stage6-readout-narrative.schema.json`. Modeled-reporting caveat is mandatory in every readout.

## System Prompt

Pull insights via `meta_export_insights`, join by `framework_id` from the local store (Stage 5 records), compare against the Stage 5a pre-registered thresholds, and return one of three states: `decide`, `monitor`, `do_not_decide_yet`.

**Mode:** FINDINGS_ONLY. Read-only.

The readout distinguishes **observed result** from **interpretation**. Numbers are not conclusions. The state is the conclusion.

`do_not_decide_yet` returns when:
- Sample-size minimum (Stage 5a field 4) is not met across one or more cells.
- Learning phase is incomplete and pre-registration excludes learning-phase data.
- Attribution window has not closed for the most recent conversions.
- Any of the pre-registered stopping rules have NOT fired AND data remains insufficient for a decision.

`monitor` returns when sufficient data exists but neither a clear decide signal nor a stopping rule has triggered — keep watching.

`decide` returns when pre-registered thresholds are met for primary metric, sample-size minimum, and attribution-window closure.

**Caveat baked in:** Meta's reporting is increasingly modeled/obfuscated. Framework-class attribution is for OUR learning, not for claims about the platform's optimization geometry. The output records this caveat in every readout.

## Required Inputs

- Stage 5a pre-registration artifact (must exist and be valid; otherwise Stage 6 refuses to fire).
- Stage 5 push records (the local `framework_id` map).
- Recent `meta_export_insights` output for the relevant ad account / date range.

## Output Schema

`schemas/stage6-readout.schema.json`. Output: `outputs/meta-creative-iteration/06-readout.json`.

Record per-cell:
- `framework_id`
- `observed_metric_value` (raw)
- `sample_size`
- `attribution_window_status` (open / closed)
- `state` (decide / monitor / do_not_decide_yet)
- `interpretation_note` (what the result MIGHT mean — not a claim)

## Operator Gates

- None internal. Stage 7 runs after this; operator decides whether to act on a `decide` state at Stage 7.

## Acceptance Criteria

- Output ALWAYS includes the modeled-reporting caveat.
- `do_not_decide_yet` is the default when uncertainty exists; never a forced decide.
- No post-hoc metric selection — uses the pre-registered metric only.
- Sample-size miss returns `do_not_decide_yet` regardless of how favorable observed numbers look.

## Composition Points

- `tools/mcp/meta-ads/` — `meta_export_insights` is the data source.
- `helpers/stage6-readout-helper.js` — implements the three-state classification and the pre-registration gate.
