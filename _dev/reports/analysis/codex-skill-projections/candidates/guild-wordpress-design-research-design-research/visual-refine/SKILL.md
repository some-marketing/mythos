---
name: visual-refine
description: >
  Iterative CSS/HTML visual refinement loop within the conversation. When the user
  wants changes after seeing a preview, Claude re-runs the pipeline with
  `--skip-to send` -- the revision system automatically feeds Gemini's previous
  output as the new input. Uses `npm run ai:pipeline`, `npm run ai:preview`, and
  `npm run ai:package`. Browser mode is current; API mode is planned. Automated
  retry is NOT yet implemented -- the human decides on every iteration.
---
<skill>

<objective>
Facilitate iterative CSS/HTML visual refinement through re-runs of the Gemini
pipeline within the conversation. When the user sees a preview (from
cross-ai-handoff or a previous refinement) and wants changes, this skill handles
the iteration loop:

1. User describes what to change
2. Claude re-runs the pipeline with `--skip-to send`
3. The revision system feeds Gemini's PREVIOUS output as the "current HTML"
4. Claude validates, runs preview injection, shows the result
5. Repeat until approved, then package deliverables

The user never needs to touch files or DevTools. Everything happens in the
conversation: describe changes, see screenshots, approve or iterate.

Source of truth: `tools/ai-bridge/` scripts + revision tracking in pipeline.js.
</objective>

<source_prompt>None -- derived from pipeline scripts + conversational iteration pattern.</source_prompt>

<prompt_type>Playbook</prompt_type>

<execution_mode>
PATCH_ALLOWED -- Re-runs pipeline steps to iterate on visual results. Injects
proposed HTML into the live page for before/after screenshot previews. On
approval, packages deliverables (CSS packet, clean HTML, fullpage mockup).
Browser interaction via Playwright for both Gemini and preview screenshots.
</execution_mode>

<model_recommendation>
opus -- Needs to interpret visual feedback from screenshots, formulate better
objectives for retry, understand CSS rendering implications, and validate brand
token preservation.
</model_recommendation>

<quick_start>
**The iteration loop:**

When the user wants changes after seeing a preview, re-run from `send`:
```bash
npm run ai:pipeline -- \
  --url "${URL}" \
  --selector "${SELECTOR}" \
  --objective "${ADJUSTED_OBJECTIVE}" \
  --handoff-dir ${HANDOFF_DIR} \
  --skip-to send \
  [--constraints "new constraint 1" "new constraint 2"]
```

Key: `--skip-to send` causes the revision system to automatically use the
latest `revision-N.html` as the "current HTML" in the prompt. Gemini iterates
on its own previous output, not the original.

Then preview:
```bash
npm run ai:preview -- \
  --url "${URL}" \
  --selector "${SELECTOR}" \
  --html ${HANDOFF_DIR}/proposed-element.html \
  --output-dir ${HANDOFF_DIR}/screenshots
```

Show the after screenshot. Repeat until approved.

On approval, package:
```bash
npm run ai:package -- \
  --html ${HANDOFF_DIR}/proposed-element.html \
  --output-dir ${PROJECT}/mockups/ \
  --client ${CLIENT} --page ${PAGE} --state ${STATE}
```
</quick_start>

<execution_rules>
  <rule id="inherits-base">All rules from cross-ai-handoff/SKILL.md apply, including the approval gate and revision tracking.</rule>
  <rule id="conversation-loop">The conversation IS the iteration loop. User describes changes, Claude runs pipeline + preview, shows screenshot, user decides. No manual file handling required.</rule>
  <rule id="skip-to-send">Use `--skip-to send` for refinement iterations. This re-uses existing evidence and lets the revision system feed the previous Gemini output as input.</rule>
  <rule id="revision-chain">Each iteration feeds the PREVIOUS Gemini output back, not the original. Revisions are tracked as revision-1.html, revision-2.html, etc. The pipeline handles this automatically.</rule>
  <rule id="preview-every-iteration">Run `npm run ai:preview` after every successful extraction. The user sees results as screenshots in the conversation, not in DevTools.</rule>
  <rule id="human-decides-retry">The human decides whether to retry, accept, or reject. Claude does NOT auto-retry. Automated retry logic is planned but not yet implemented.</rule>
  <rule id="no-auto-retry">Do NOT implement or invoke automated retry logic. It does not exist yet. Each iteration is a deliberate user decision.</rule>
  <rule id="token-preservation">Imported CSS MUST preserve CSS custom properties. Hardcoded hex values replacing var() references are a validation failure.</rule>
  <rule id="naming-preservation">Imported CSS MUST preserve the existing class naming convention (BEM, scoped selectors).</rule>
  <rule id="package-on-approval">After the user approves, run `npm run ai:package` to generate the CSS packet, clean HTML, and fullpage mockup.</rule>
</execution_rules>

<context>
Base pattern: `frameworks/wordpress/design-research/.claude/skills/design-research/cross-ai-handoff/SKILL.md`

Pipeline scripts (all invocable via npm run):
- `ai:pipeline` -- Full orchestrator; with `--skip-to send` re-uses evidence and feeds revision chain
- `ai:preview` -- Inject proposed HTML into live page, capture before/after screenshots
- `ai:package` -- Post-approval: convert approved HTML into CSS packet, clean HTML, fullpage mockup
- `ai:validate` -- Standalone validation check (useful for diagnosing failures)

Revision tracking (managed by pipeline.js):
```
_handoffs/<id>_<slug>/revisions/
  original.html      -- The first element HTML (user paste or evidence-gather capture)
  revision-1.html    -- Gemini's first output
  revision-2.html    -- Gemini's second output (fed revision-1 as input)
  revision-3.html    -- Gemini's third output (fed revision-2 as input)
  ...
```
On `--skip-to send`, the pipeline automatically reads the latest revision-N.html
and uses it as the "current HTML" in the prompt. `proposed-element.html` always
contains the latest revision.

Preview screenshots (from ai:preview):
```
_handoffs/<id>_<slug>/screenshots/
  before.png           -- Element before injection
  after.png            -- Element after injection
  before-fullpage.png  -- Full page before injection
  after-fullpage.png   -- Full page after injection
```

When to re-gather vs re-send:
- **Re-send only** (`--skip-to send`): Same element, adjusted objective/constraints.
  This is the normal refinement case.
- **Re-gather + re-send** (no `--skip-to`): Element changed on the staging site,
  or targeting a different element entirely.

Validation checks that may trigger a retry:
| # | Check | Severity | What it means when it fails |
|---|-------|----------|----------------------------|
| 1 | has_html | error | Gemini returned prose, not code. Retry with stronger format forcing. |
| 2 | has_code_blocks | error | Response lacks fenced code blocks. Retry with explicit output format. |
| 3 | inline_styles | error | HTML missing style="" attributes. Objective may need to stress inline styles. |
| 4 | no_style_blocks | error | Contains `<style>` tags. Add constraint: "no style blocks, inline only". |
| 5 | no_scripts | error | Contains scripts/handlers. Add constraint: "no JavaScript". |
| 6 | no_external_classes | warning | Uses class="" on child elements. May be acceptable; user decides. |
| 7 | content_preserved | warning | Lost >50% of original text. Check if objective was too destructive. |
| 8 | reasonable_size | warning | Output >10x input size. Gemini may have over-generated. |
</context>

<automated_workflow>
  <step id="1" name="user-requests-change" type="USER">
    The user sees a preview screenshot (from cross-ai-handoff or a previous
    refinement iteration) and describes what to change.

    Examples:
    - "The spacing between the cards is too tight"
    - "Make the header font larger and change the badge color to match the brand"
    - "The layout breaks -- the sidebar should be on the right"

    **Wait for the user to describe what needs to change.**
  </step>

  <step id="2" name="re-run-pipeline" type="AUTO">
    [AUTO] Re-run the pipeline with `--skip-to send`:

    ```bash
    npm run ai:pipeline -- \
      --url "${URL}" \
      --selector "${SELECTOR}" \
      --objective "${ADJUSTED_OBJECTIVE}" \
      --handoff-dir ${HANDOFF_DIR} \
      --skip-to send \
      [--constraints "new constraint 1" "new constraint 2"]
    ```

    The revision system automatically:
    - Reads the latest `revision-N.html` from the revisions directory
    - Uses it as the "current HTML" in the new prompt
    - Saves Gemini's new output as `revision-(N+1).html`
    - Updates `proposed-element.html` to point to the latest

    Review the validation results.
  </step>

  <step id="3" name="preview-injection" type="AUTO">
    [AUTO] Run preview injection to show the result:

    ```bash
    npm run ai:preview -- \
      --url "${URL}" \
      --selector "${SELECTOR}" \
      --html ${HANDOFF_DIR}/proposed-element.html \
      --output-dir ${HANDOFF_DIR}/screenshots
    ```

    Captures before/after screenshots.
  </step>

  <step id="4" name="show-result" type="USER">
    [USER] Show the after screenshot to the user:

    "Revision ${N} complete. Validation: [pass/fail summary]

    [Show screenshots/after.png]

    Options:
    - **Approve** -- package deliverables
    - **Refine further** -- describe what else to change
    - **Reject** -- discard this iteration"

    **STOP and wait for response.**

    If **refine further**: go back to step 1.
    If **approve**: proceed to step 5.
  </step>

  <step id="5" name="package-deliverables" type="AUTO">
    [AUTO] After approval, run packaging:

    ```bash
    npm run ai:package -- \
      --html ${HANDOFF_DIR}/proposed-element.html \
      --output-dir ${PROJECT}/mockups/ \
      --client ${CLIENT} --page ${PAGE} --state ${STATE} \
      [--site-chrome ${SITE_CHROME}]
    ```

    This produces three deliverables:
    - `{CLIENT}_MOCKUP_{PAGE}_{STATE}.css` -- CSS packet (inline styles extracted to rules)
    - `{CLIENT}_MOCKUP_{PAGE}_{STATE}.html` -- Clean HTML with class references
    - `{CLIENT}_MOCKUP_{PAGE}_{STATE}_FULLPAGE.html` -- Self-contained fullpage mockup
  </step>

  <step id="6" name="report" type="USER">
    [USER] Present the final results:

    "Refinement complete after ${N} iterations:
    - Revisions: original -> revision-1 -> ... -> revision-${N}
    - Final validation: [pass/fail per check]
    - Deliverables: [list files]
    - Files in handoff directory: [list]

    Would you like to refine another element or continue to the next task?"

    **STOP and wait.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="HANDOFF_DIR">Path to the existing handoff directory from the initial pipeline run</input>
    <input name="CHANGE_DESCRIPTION">What the user wants to change (described in conversation)</input>
  </required>
  <optional>
    <input name="URL">Staging URL (inherited from cross-ai-handoff; needed for preview injection)</input>
    <input name="SELECTOR">CSS selector (inherited from cross-ai-handoff; needed for preview injection)</input>
    <input name="ADDITIONAL_CONSTRAINTS">Extra constraints to add for the iteration</input>
    <input name="SPEC_PATH">Path to spec document (for post-approval spec sync)</input>
    <input name="BRAND_TOKENS">Path to brand token JSON file</input>
    <input name="SITE_CHROME">Path to site chrome JSON for fullpage wrapping</input>
  </optional>
</inputs>

<outputs>
  <output name="updated-response">New Gemini response at `<handoff-dir>/response.json`</output>
  <output name="updated-validation">New validation results at `<handoff-dir>/validation.json`</output>
  <output name="new-revision">New revision at `<handoff-dir>/revisions/revision-N.html`</output>
  <output name="updated-proposed">Latest HTML at `<handoff-dir>/proposed-element.html`</output>
  <output name="preview-screenshots">Before/after screenshots at `<handoff-dir>/screenshots/`</output>
  <output name="deliverables">CSS packet, clean HTML, fullpage mockup in project mockups directory (after approval)</output>
</outputs>

<success_criteria>
- Each iteration uses --skip-to send (avoids redundant evidence gathering)
- Revision chain is maintained: each iteration feeds previous output, not original
- Preview injection runs after every extraction, with screenshots shown in-chat
- User sees results without opening DevTools or editing files
- All error-level validation checks pass before showing preview
- On approval, packaging produces all 3 deliverable files
- Complete revision trail in handoff directory
</success_criteria>

<design_decisions>
These design choices are intentional and should be preserved:

- **Conversation as iteration loop**: The user describes changes in natural language,
  Claude runs the pipeline and shows screenshots. No file management, no DevTools,
  no manual steps beyond typing what to change and approving the result.
- **Revision chain, not fresh starts**: Each `--skip-to send` automatically feeds
  Gemini's PREVIOUS output as the current HTML. This means Gemini iterates on its
  own work, producing incremental refinements rather than starting from scratch.
- **Preview injection for visual feedback**: `npm run ai:preview` injects the
  proposed HTML into the live page and captures screenshots. The user sees the
  result in context without leaving the chat.
- **Human-in-the-loop retries**: The user decides whether to retry, accept, or
  reject. There is no automated retry loop. Automated retry logic (e.g., the
  3-Turn Rule) is documented in the AI Bridge design doc but NOT yet implemented.
- **Validation as diagnosis tool**: When validation fails, the check results
  inform what to adjust in the next objective. Each check maps to a specific
  prompt adjustment (documented in the context table).
- **Package only on approval**: Deliverables are generated only when the user
  explicitly approves. No intermediate packaging during the iteration loop.
</design_decisions>

<safety_rules>
- Never auto-retry without user approval -- each iteration is a deliberate human decision
- Never auto-apply Gemini responses -- user must see preview screenshots and approve
- Never include credentials or PII in handoff artifacts
- Never modify framework source files; only write to project directories
- Always validate that imported CSS preserves declared brand tokens
- Browser automation only navigates to gemini.google.com and the staging URL
</safety_rules>
</skill>
