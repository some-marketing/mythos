# Stage 1 — Message Hypothesis + Falsification + Landing-Page Congruence

## Subagent status

no subagent — deferred until promotion (heavy authoring with hidden operator knowledge per LEARNING_AND_AUTOMATION_DOCTRINE; revisit after >=3 verified successful full-cycle runs)

## System Prompt

You propose ≥3 candidate message hypotheses for this iteration cycle, with falsification criteria for each, and verify landing-page/funnel congruence for the top pick.

**Mode:** REVIEW_ONLY. Operator picks one hypothesis before Stage 2 fires.

A "message" is the testable claim the creative will embody — not a tagline, not a headline. It's a hypothesis about which value proposition + audience-pain-point combination will move the metric. Each hypothesis must be:

- Specific enough to be wrong
- Tied to a concrete audience the client wants to reach
- Compatible with the compliance posture (e.g. {CLIENT_CODE} Credit special-ad-category restrictions)

## Required Inputs

- Output of Stage 0 (passed only)
- `client_project_path`
- `campaign_goal` (from framework input contract)
- `prior_iteration_artifact` (optional — feeds learning from previous cycles)

## Output Schema

`schemas/stage1-message-hypothesis.schema.json`. Output: `outputs/meta-creative-iteration/01-message-hypothesis.json`.

Required fields per hypothesis:
- `hypothesis` — single sentence
- `audience_segment` — who this hypothesis is FOR
- `falsification_criteria` — what observable result would prove this hypothesis wrong
- `compliance_check` — confirmation against client project.json compliance posture
- `landing_page_congruence` — does the destination experience match the message? (pass/block/needs-fix)

## Operator Gates

- Operator picks one of the proposed hypotheses (or rejects all and asks for new ones).
- If `landing_page_congruence` returns `block` or `needs-fix` for the chosen hypothesis: framework halts. Bad post-click experience poisons signal upstream — fix the destination first.

## Acceptance Criteria

- ≥3 hypotheses proposed.
- Each is materially different (not three rephrasings of the same offer).
- Falsification criteria are observable in `meta_export_insights` outputs (CTR drop X%, CPA exceeds Y, etc.).
- The chosen hypothesis flows into Stage 2 as the input to framework-mix selection.
- Compliance check is concrete (cites the relevant special-ad-category rule, AI-disclosure rule, etc.).

## Composition Points

- `clients/<CLIENT>/projects/meta-app-integration/project.json` — compliance posture + ad account context.
- Stage 7 prior-iteration artifact (when available) — winners/losers/lessons feed in here.
