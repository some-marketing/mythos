# 04: Experiment Design

## Objective
Design A/B test proposals for the highest-value recommendations and test ideas. Each experiment includes a hypothesis, variant descriptions, success metrics, and duration estimate.

## Mode
REVIEW_ONLY

## Inputs
- `outputs/page-cro/intake-summary.md` from Prompt 01
- `outputs/page-cro/conversion-analysis.md` from Prompt 02
- `outputs/page-cro/recommendations.md` from Prompt 03
- Current conversion rate and traffic volume (from intake, if available)

## Steps

1. [AUTO] **Select experiments** from Prompt 03 outputs:
   - All items from the Test Ideas section
   - High-Impact Changes that warrant validation before full implementation
   - Copy alternative sets with the strongest strategic differentiation
   - Prioritize by: expected impact x feasibility x measurement clarity

2. [AUTO] **Design each experiment** with the following structure:

   **Experiment title**: Descriptive name (e.g., "Homepage Headline: Outcome-Focused vs. Feature-Focused")

   **Hypothesis**: "If we [change], then [metric] will [direction] because [reasoning based on observation from Prompt 02]"

   **Control**: Current state — describe what exists today with specific text/element reference

   **Variant(s)**: 1-2 variants maximum per experiment
   - Describe the specific change
   - Explain the strategic reasoning for this variant
   - Note any implementation considerations

   **Primary metric**: The single metric that determines success (e.g., CTA click-through rate, form completion rate, page-to-signup conversion rate)

   **Secondary metrics**: 2-3 supporting metrics to monitor for unintended effects (e.g., bounce rate, time on page, downstream conversion)

   **Guardrail metrics**: Metrics that must NOT degrade (e.g., revenue per visitor, customer quality scores)

   **Traffic allocation**: Recommended split (typically 50/50 for single variant, 33/33/33 for two variants)

   **Estimated duration**: Based on:
   - Current traffic volume (if known) or assumed minimum
   - Required sample size for statistical significance (95% confidence, 80% power)
   - Minimum detectable effect (typically 10-20% relative improvement)
   - If traffic data unavailable, state assumptions and provide duration range

   **Risk assessment**: What could go wrong and mitigation approach

3. [AUTO] **Build experiment prioritization** — rank experiments by:
   - Expected impact (based on observation severity from Prompt 02)
   - Implementation effort (low/medium/high)
   - Measurement clarity (how clean is the primary metric)
   - Risk level (revenue impact if variant underperforms)

4. [AUTO] **Build experiment sequencing recommendation**:
   - Which experiments can run in parallel (non-overlapping page sections)
   - Which must run sequentially (same element, dependent changes)
   - Suggested testing roadmap with timeline
   - Note: recommend running no more than 2-3 concurrent experiments per page to avoid interaction effects

5. [GATE] Present experiment plan to operator for review:
   - Total experiment count
   - Estimated total testing timeline
   - Highest-priority experiment to run first
   - Any experiments that require tools or platforms not currently available

6. [AUTO] Write experiment designs to `outputs/page-cro/experiment-design.md`.

## Outputs
- `outputs/page-cro/experiment-design.md` containing:
  - Individual experiment designs with all required fields
  - Prioritized experiment ranking
  - Sequencing recommendation with timeline
  - Implementation notes (tooling requirements, technical dependencies)

## Success Criteria
- [ ] Every experiment has a clear hypothesis linking back to a Prompt 02 observation
- [ ] Every experiment defines a primary metric, secondary metrics, and guardrail metrics
- [ ] Duration estimates state assumptions about traffic and minimum detectable effect
- [ ] Experiments are prioritized and sequenced, not just listed
- [ ] No more than 2-3 concurrent experiments recommended per page
- [ ] Risk assessment included for experiments affecting revenue-sensitive elements
- [ ] No new analysis introduced — this prompt designs experiments from existing recommendations
- [ ] Operator has reviewed the experiment plan

## Guardrails
- Reference: framework guardrails at `guardrails.md`
- Mode-specific: design and synthesize only; no site interaction or new data collection
- Never guarantee specific conversion lift from any experiment
- Duration estimates must include statistical rigor assumptions (confidence level, power, MDE)
- Always include guardrail metrics — an experiment that improves clicks but degrades revenue is not a success
- If traffic volume is unknown, provide duration ranges with stated assumptions rather than guessing
- Flag experiments that require engineering resources beyond content/copy changes
- Never recommend experiments on pages with fewer than 1,000 monthly visitors without noting the extended timeline and reduced statistical power
