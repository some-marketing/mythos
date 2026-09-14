---
name: cross-ai-handoff
description: >
  Conversational pipeline for packaging project context, sending it to Gemini via
  browser automation, validating the response, and previewing the result inline.
  Uses `npm run ai:pipeline` for the end-to-end flow, `npm run ai:preview` for
  visual feedback, and `npm run ai:package` for post-approval deliverable
  generation. Browser mode (Playwright driving gemini.google.com) is the current
  delivery mechanism; API mode is planned.
---
<skill>

<objective>
Orchestrate the Gemini cross-AI handoff workflow as a conversation. The user
pastes element HTML from DevTools and describes what they want. Claude runs the
pipeline, injects the result into the live page for a visual preview, and shows
before/after screenshots -- all without the user leaving the chat.

The conversation IS the orchestrator. The user provides context (URL, HTML,
intent), Claude runs scripts and shows results, and the user approves or
requests changes.

Source of truth: `tools/ai-bridge/` scripts, invoked via npm run scripts.
</objective>

<source_prompt>None -- standalone pipeline orchestration.</source_prompt>

<prompt_type>Playbook</prompt_type>

<execution_mode>
PATCH_ALLOWED -- Runs pipeline scripts that write evidence, prompts, and response
artifacts to a handoff directory. After extraction, injects proposed HTML into
the live page via Playwright to capture before/after screenshots for in-chat
visual feedback. Browser interaction with gemini.google.com is automated via
Playwright; the user approves results by viewing screenshots in the conversation.
</execution_mode>

<model_recommendation>
sonnet -- Lightweight orchestration. The pipeline scripts handle evidence capture,
prompt assembly, browser interaction, and validation. Claude's role is invoking
the scripts with correct arguments, showing screenshots, and interpreting output.
</model_recommendation>

<quick_start>
**Step 1: User provides URL + pastes element HTML into chat**

The user copies the target element's outerHTML from Chrome DevTools and pastes
it into the conversation, along with the page URL.

**Step 2: Save HTML, gather evidence, then overwrite with user's paste**
```bash
# Save the user's pasted HTML to a temp file
cat > /tmp/element-paste.html << 'HTMLEOF'
<USER_PASTED_HTML_HERE>
HTMLEOF

# Run evidence-gather for screenshots, then overwrite element.html with paste
npm run ai:pipeline -- \
  --url "${URL}" \
  --selector "${SELECTOR}" \
  --objective "${OBJECTIVE}" \
  --handoff-dir ${HANDOFF_DIR} \
  --element-html /tmp/element-paste.html
```

The `--element-html` flag tells the pipeline to:
- Still use `--selector` to find and screenshot the element on the live page
- Overwrite `evidence/element.html` with the user's pasted HTML instead of
  the auto-captured outerHTML

**Step 3: Show screenshot, confirm intent**

Claude reads the element screenshot from `${HANDOFF_DIR}/screenshots/element.png`
and shows it to the user. If the user hasn't already described what they want,
Claude asks.

**Step 4: Pipeline runs (prompt, send, validate, extract)**

The pipeline continues through all steps automatically.

**Step 5: Preview injection**
```bash
npm run ai:preview -- \
  --url "${URL}" \
  --selector "${SELECTOR}" \
  --html ${HANDOFF_DIR}/proposed-element.html \
  --output-dir ${HANDOFF_DIR}/screenshots
```

This injects the proposed HTML into the live page and captures before/after
screenshots without the user needing to open DevTools.

**Step 6: Show after screenshot, ask for approval**

Claude shows the after screenshot. User approves, requests changes (-> visual-refine),
or rejects.

**Step 7: Package deliverables (on approval)**
```bash
npm run ai:package -- \
  --html ${HANDOFF_DIR}/proposed-element.html \
  --output-dir ${PROJECT}/mockups/ \
  --client ${CLIENT} --page ${PAGE} --state ${STATE}
```
</quick_start>

<execution_rules>
  <rule id="conversation-is-orchestrator">The chat conversation drives the flow. Claude runs commands and shows results; the user makes decisions.</rule>
  <rule id="user-pastes-html">The user controls what element HTML goes in by pasting from DevTools. The `--element-html` flag is the mechanism that feeds the user's paste into the pipeline.</rule>
  <rule id="preview-not-devtools">Use `npm run ai:preview` to inject proposed HTML and capture before/after screenshots. The user does NOT need to open DevTools to preview -- screenshots are shown in the conversation.</rule>
  <rule id="browser-mode-current">Current delivery: Playwright drives gemini.google.com using the user's Chrome profile. API mode is planned but not yet available.</rule>
  <rule id="no-auto-retry">Automated retry is NOT yet implemented. The human decides whether to accept, refine, or reject. Each iteration is a deliberate choice.</rule>
  <rule id="approval-gate">The pipeline stops after extract + preview. The user MUST approve before packaging. This gate is non-negotiable.</rule>
  <rule id="no-credentials">NEVER include credentials, API keys, tokens, or sensitive data in prompts or handoff artifacts.</rule>
  <rule id="boundary-enforcement">Validated responses MUST pass all error-level checks before preview. Warnings are reported but do not block.</rule>
  <rule id="sequential-ids">Handoff IDs are sequential: 001, 002, 003... with a short descriptive slug.</rule>
  <rule id="revision-tracking">Revision tracking: `original.html` saves the first input, each Gemini output saves as `revision-N.html`. `proposed-element.html` always points to the latest.</rule>
  <rule id="audit-trail">The pipeline produces a complete artifact trail in the handoff directory: evidence/, prompt, response, validation, revisions/, and proposed HTML.</rule>
</execution_rules>

<context>
Pipeline scripts (all invocable via npm run):
- `ai:pipeline` -- Full orchestrator (gather, prompt, send, validate, extract)
- `ai:preview` -- Inject proposed HTML into live page, capture before/after screenshots
- `ai:package` -- Post-approval: convert approved HTML into CSS packet, clean HTML, fullpage mockup
- `ai:evidence:gather` -- Step 1 standalone: capture screenshots, HTML, styles
- `ai:prompt:build` -- Step 2 standalone: build Trifecta prompt from evidence
- `ai:gemini:browser` -- Step 3 standalone: send prompt to Gemini via browser
- `ai:validate` -- Step 4 standalone: validate response against inline-style rules

Handoff directory structure (created by pipeline):
```
_handoffs/<id>_<slug>/
  screenshots/element.png           # Element screenshot (from evidence-gather)
  screenshots/fullpage.png          # Full-page context screenshot
  screenshots/before.png            # Before injection (from ai:preview)
  screenshots/after.png             # After injection (from ai:preview)
  screenshots/before-fullpage.png   # Before injection full-page
  screenshots/after-fullpage.png    # After injection full-page
  evidence/element.html             # Element HTML (user paste via --element-html)
  evidence/computed-styles.json     # Computed styles
  evidence/manifest.json            # Evidence file manifest
  revisions/original.html           # First element HTML input
  revisions/revision-1.html         # Gemini's first output
  revisions/revision-2.html         # Gemini's second output (iterates on revision-1)
  prompt.md                         # Trifecta prompt sent to Gemini
  prompt-meta.json                  # Prompt generation metadata
  response.json                     # Raw Gemini response
  validation.json                   # Validation check results
  proposed-element.html             # Latest revision (always current)
```

Validation checks (from `npm run ai:validate`):
| # | Check | Severity | Rule |
|---|-------|----------|------|
| 1 | has_html | error | Response contains HTML |
| 2 | has_code_blocks | error | Response has code blocks |
| 3 | inline_styles | error | HTML contains style="" attributes |
| 4 | no_style_blocks | error | No `<style>` blocks |
| 5 | no_scripts | error | No `<script>`, onclick, etc. |
| 6 | no_external_classes | warning | No class="" on non-root elements |
| 7 | content_preserved | warning | >50% word overlap with original |
| 8 | reasonable_size | warning | Response < 10x original size |
</context>

<automated_workflow>
  <step id="1" name="user-provides-context" type="USER">
    The user provides:
    1. The staging URL
    2. Pastes the target element's outerHTML from Chrome DevTools
    3. Describes what needs to change (or Claude asks after seeing the element)

    **Wait for the user to provide URL + HTML paste.**
  </step>

  <step id="2" name="gather-and-screenshot" type="AUTO">
    [AUTO] Save the user's pasted HTML and run the pipeline with --element-html:

    ```bash
    # Save user's pasted HTML
    cat > /tmp/element-paste.html << 'HTMLEOF'
    ${USER_PASTED_HTML}
    HTMLEOF

    # Run pipeline -- gather evidence + overwrite element.html with paste
    npm run ai:pipeline -- \
      --url "${URL}" \
      --selector "${SELECTOR}" \
      --objective "${OBJECTIVE}" \
      --handoff-dir ${HANDOFF_DIR} \
      --element-html /tmp/element-paste.html \
      [--spec ${SPEC}] \
      [--brand-tokens ${BRAND_TOKENS}] \
      [--target-id ${TARGET_ID}] \
      [--target-classes ${TARGET_CLASSES}] \
      [--constraints "constraint1" "constraint2"]
    ```

    The pipeline runs all 5 steps: gather, prompt, send, validate, extract.
  </step>

  <step id="3" name="preview-injection" type="AUTO">
    [AUTO] After extraction, inject the proposed HTML into the live page:

    ```bash
    npm run ai:preview -- \
      --url "${URL}" \
      --selector "${SELECTOR}" \
      --html ${HANDOFF_DIR}/proposed-element.html \
      --output-dir ${HANDOFF_DIR}/screenshots
    ```

    This captures:
    - `before.png` / `before-fullpage.png` -- element and page before injection
    - `after.png` / `after-fullpage.png` -- element and page after injection
  </step>

  <step id="4" name="show-result" type="USER">
    [USER] Show the after screenshot to the user:

    "Here's what Gemini produced. Validation: [pass/fail summary]

    [Show screenshots/after.png]

    Options:
    - **Approve** -- proceed to packaging
    - **Refine** -- describe what to change (transitions to visual-refine)
    - **Reject** -- discard and start over"

    **STOP and wait for response.**
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

  <step id="6" name="verify" type="AUTO">
    [AUTO] Run applicable verification:
    - If target is a mockup: run verify_mockups.cjs
    - If target has a spec: run spec-sync check
    - Report results and list all files created/modified
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="URL">Staging site URL containing the target element</input>
    <input name="ELEMENT_HTML">User-pasted outerHTML from Chrome DevTools (pasted into chat)</input>
    <input name="OBJECTIVE">Description of what to fix or build (stated in chat or asked by Claude)</input>
  </required>
  <optional>
    <input name="SELECTOR">CSS selector for the target element (Claude can derive from pasted HTML)</input>
    <input name="HANDOFF_DIR">Working directory for artifacts (default: _handoffs/<id>_<slug>)</input>
    <input name="SPEC">Path to spec document for prompt context</input>
    <input name="BRAND_TOKENS">Path to brand token JSON file</input>
    <input name="TARGET_ID">Element ID to preserve in output</input>
    <input name="TARGET_CLASSES">Element classes to preserve in output</input>
    <input name="CONSTRAINTS">Additional constraints passed to prompt builder</input>
    <input name="SITE_CHROME">Path to site chrome JSON for fullpage wrapping</input>
  </optional>
</inputs>

<outputs>
  <output name="evidence">Screenshots, HTML, computed styles in `<handoff-dir>/evidence/`</output>
  <output name="prompt">Trifecta prompt at `<handoff-dir>/prompt.md`</output>
  <output name="response">Gemini response at `<handoff-dir>/response.json`</output>
  <output name="validation">Check results at `<handoff-dir>/validation.json`</output>
  <output name="proposed">Extracted HTML at `<handoff-dir>/proposed-element.html`</output>
  <output name="revisions">Revision history in `<handoff-dir>/revisions/`</output>
  <output name="preview-screenshots">Before/after screenshots in `<handoff-dir>/screenshots/`</output>
  <output name="deliverables">CSS packet, clean HTML, fullpage mockup in project mockups directory</output>
</outputs>

<success_criteria>
- Pipeline runs all 5 steps without error
- All error-level validation checks pass
- Preview injection produces before/after screenshots shown in-chat
- User approves the result from conversation screenshots (no DevTools required)
- Packaging produces all 3 deliverable files
- No credentials, tokens, or PII in any handoff artifacts
- Complete artifact trail in handoff directory including revisions/
</success_criteria>

<design_decisions>
These design choices are intentional and should be preserved:

- **Conversation as orchestrator**: There is no separate workflow engine. The chat
  drives the flow: user provides context, Claude runs commands, shows screenshots,
  user decides. This keeps the human in control without requiring DevTools expertise.
- **User-pasted HTML via --element-html**: The user controls what HTML goes into the
  pipeline by pasting from DevTools. The `--element-html` flag overwrites the
  auto-captured outerHTML with the user's paste. This ensures the pipeline works
  with exactly what the user sees.
- **Preview injection replaces DevTools preview**: `npm run ai:preview` injects
  proposed HTML into the live page and captures before/after screenshots. The user
  sees results in the conversation, not by manually editing HTML in DevTools.
- **Trifecta prompt pattern**: Visual evidence + raw code + singular objective. This
  structure produces the best results from Gemini for CSS/HTML tasks.
- **Format forcing**: The prompt explicitly demands inline-styled HTML with no
  explanations. This eliminates conversational filler and produces pasteable output.
- **Inline styles as intermediate format**: Gemini outputs inline `style=""` attributes.
  Inline styles are immediately usable. The packaging step converts to proper CSS.
- **Browser mode over API**: Uses the user's existing Chrome profile and Google session.
  No API key setup required. API mode is planned for stability but browser mode is
  the working reality.
- **Human approval gate**: The pipeline deliberately stops after extraction + preview.
  Automated retry is NOT yet implemented -- the human decides on every iteration.
- **Revision tracking**: `original.html` is saved, each Gemini output is saved as
  `revision-N.html`. This enables the visual-refine skill to feed previous output
  back to Gemini automatically.
</design_decisions>

<safety_rules>
- Never include credentials, API keys, session tokens, or PII in prompts or handoff artifacts
- Never skip the approval gate -- user must see preview screenshots before packaging
- Never auto-execute code received from Gemini
- Never auto-retry -- automated retry is not yet implemented; the human decides
- Always write artifacts to handoff directories, never to framework source files
- Browser automation only navigates to gemini.google.com and the staging URL (for screenshots)
</safety_rules>
</skill>
