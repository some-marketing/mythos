# 03: Strategy Proposal

## Objective
Propose a complete editing strategy in 4–8 sentences based on the material and operator direction, then wait for explicit operator confirmation before any cuts are executed.

## Mode
FINDINGS_ONLY

## Inputs
- `<edit_dir>/takes_packed.md` from Prompt 01
- Editorial brief from Prompt 02 (operator direction)

## Steps

1. [AUTO] Synthesize the material observations and operator direction into a concrete editing strategy. Cover in 4–8 sentences:
   - **Shape**: Structural archetype (tech launch, tutorial, interview, montage, travel, documentary, music, or custom)
   - **Take choices**: Which takes for which beats, chronological ordering
   - **Cut direction**: What stays, what goes, pacing choices, padding values
   - **Animation plan**: What overlays, where, how many
   - **Grade direction**: Preset or custom filter chain, per-segment decisions
   - **Subtitle style**: Chunking (2-word/3-word/sentence), case, placement
   - **Length estimate**: Expected final runtime
   - If a `delivery_spec` is supplied, honor its AR / safe-zones / caption-style / encoding; cite its source.

2. [AUTO] Present the strategy clearly. Include:
   - The proposed structural archetype and why it fits the material
   - A rough beat-by-beat outline with source clips
   - Estimated runtime
   - Any open decisions the operator should weigh in on

3. **[GATE] Wait for operator confirmation.**
   - The operator must explicitly approve the strategy in plain English before Prompt 04 executes any cuts.
   - If the operator requests changes: revise the strategy and re-present.
   - This gate is non-negotiable (Rule 11).

## Outputs
- Strategy proposal in chat (structural archetype, beat outline, length estimate, open decisions)
- No file writes at this stage — strategy is conversational
- Confirmation recorded before advancing

## Success Criteria
- [ ] Strategy covers all six dimensions (shape, takes, cuts, animation, grade, subtitles)
- [ ] Length estimate provided
- [ ] Open decisions surfaced for operator input
- [ ] **[GATE] Operator explicitly confirmed the strategy**
- [ ] Confirmation recorded before Prompt 04 begins

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Rule 11 (strategy confirmation): this [GATE] is non-negotiable — do not proceed without explicit operator approval
- Mode-specific: FINDINGS_ONLY — propose, do not execute
- Strategy must be in plain English, not technical ffmpeg parameters
- If the operator is silent, wait — do not assume approval