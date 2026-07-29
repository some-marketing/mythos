---
name: locator-correction
description: >
  Validates and corrects a locator map through live browser walkthrough. Navigates the form
  page by page, documents actual DOM behavior, identifies selector drift, conditional fields,
  popup interstitials, and non-standard widgets, then produces a findings report with corrections.
  Use after initial scaffold, when tests fail due to selector issues, or for periodic maintenance.
---

<objective>
Walk through a form using a live browser to validate every selector in the locator map,
document actual DOM behavior, and produce corrections. This catches issues that static
DOM inspection misses: conditional fields, async transitions, popup interstitials,
non-standard widgets, and framework quirks.

This skill wraps the detailed procedure defined in the source prompt. The executor MUST read
the source prompt file in full before proceeding.
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/02_LOCATORS_AND_CORRECTION.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID)
- 09_SHARED_BLOCKS.md § B — Operating rules (FINDINGS_ONLY mode)
</shared_blocks_references>

<model_recommendation>
opus -- Requires complex browser interaction, DOM analysis, visual reasoning from screenshots,
and nuanced judgment about selector stability. The walkthrough involves multi-step browser
sessions with observation-interaction-transition cycles that benefit from opus-level reasoning.
</model_recommendation>

<execution_mode>
FINDINGS_ONLY -- The walkthrough produces a findings document. Corrections to locator_map.json
and identity.json are applied only after the user reviews findings. The source prompt explicitly
states: "Do NOT modify files directly -- output findings only."
</execution_mode>

<quick_start>
1. [USER] Gather input: testcase_id (and optional: project_root, form_url, focus_pages). **STOP and wait for user response before proceeding.**
2. [AUTO] Read the source prompt: frameworks/wordpress/qa/prompts/02_LOCATORS_AND_CORRECTION.md
3. [AUTO] Load the existing locator_map.json and identity.json for the testcase
4. [AUTO] Navigate to the form URL with browser tools
5. [AUTO] Walk through each page: OBSERVE, INTERACT, TRANSITION (per source prompt)
6. [AUTO] Document findings: selector corrections, missing fields, popup configs, identity fixes
7. [AUTO] Produce findings report (do NOT modify files directly)
8. [USER] Present findings report to user. **STOP and wait for user response before proceeding.**
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, gather testcase state:

```bash
# Read the testcase config to get form URL
cd "{project_root}" && cat playwright_phased_runner/testcases/{testcase_id}/testcase.json 2>/dev/null || echo "testcase.json not found"

# Check current locator map
cd "{project_root}" && cat playwright_phased_runner/testcases/{testcase_id}/locator_map.json 2>/dev/null || echo "locator_map.json not found"

# Check identity values
cd "{project_root}" && cat playwright_phased_runner/testcases/{testcase_id}/identity.json 2>/dev/null || echo "identity.json not found"

# Check for previous run failures (motivation for correction)
cd "{project_root}" && ls playwright_phased_runner/testcases/{testcase_id}/runs/ 2>/dev/null | tail -3 || echo "No runs yet"
```
</context>

<inputs>
  <required>
    <input name="testcase_id" description="The testcase to validate (must already have locator_map.json)" />
  </required>
  <optional>
    <input name="project_root" description="Path to project root containing playwright_phased_runner/testcases/. Defaults to current working directory." />
    <input name="form_url" description="Override the URL in testcase.json (useful for staging environments)" />
    <input name="focus_pages" description="Comma-separated page numbers to focus on (e.g., '3,4,5' to skip early pages)" />
  </optional>
</inputs>

<outputs>
  <output path="(stdout)" description="Findings report with categorized corrections" />
  <output path="playwright_phased_runner/testcases/{testcase_id}/walkthrough_findings/LOCATOR_VALIDATION__*.md" description="Findings document with categorized issues and recommended corrections" />
</outputs>

<automated_workflow>
  <step number="1" type="AUTO" name="load_source_prompt">
    Read the full source prompt file:
    ```
    frameworks/wordpress/qa/prompts/02_LOCATORS_AND_CORRECTION.md
    ```
    This is the authoritative reference. Pay particular attention to the "Walkthrough Prompt"
    section and the "Common Findings and Fixes" catalog.
  </step>

  <step number="2" type="AUTO" name="load_testcase_assets">
    Read the existing testcase files:
    - playwright_phased_runner/testcases/{testcase_id}/testcase.json (to get form URL)
    - playwright_phased_runner/testcases/{testcase_id}/locator_map.json (the map to validate)
    - playwright_phased_runner/testcases/{testcase_id}/identity.json (test values to use during walkthrough)

    If any file is missing, stop and inform the user to run intake-scaffold first.
  </step>

  <step number="3" type="AUTO" name="browser_walkthrough">
    Navigate to the form URL using Playwright MCP browser tools.

    For each page in the locator map, execute the seven-point inspection cycle
    defined in the source prompt's "Walkthrough Prompt" section:

    1. OBSERVE -- Snapshot, list visible fields, note page indicator selector
    2. INTERACT -- Fill each field with identity values, verify acceptance
    3. TRANSITION -- Click Next, document how the page changes (CSS, display, URL, animation)
    4. CONDITIONAL ELEMENTS -- Note fields that appear/disappear based on selections
    5. INTERSTITIALS -- Document popups, modals, overlays between pages
    6. NON-STANDARD WIDGETS -- Identify Choices.js, Select2, date pickers, etc.
    7. HONEYPOTS -- Identify hidden bot-trap fields

    Continue through to submission. Document the submit button, success indicator,
    and error states.
  </step>

  <step number="4" type="AUTO" name="produce_findings">
    Compile findings into a structured report with these categories
    (as specified in the source prompt):

    - CRITICAL ISSUES (will cause runner to fail)
    - PER-PAGE CORRECTIONS (selector fixes, new fields, removed fields)
    - TRANSITION FIXES (visible_when_css corrections)
    - NEW CONFIGURATIONS NEEDED (popup_after_next, conditional fields, depends_on)
    - IDENTITY CORRECTIONS (value format issues, wrong option values)

    Present this report to the user. Do NOT modify files until approved.
  </step>

  <step number="5" type="AUTO" name="validation_checklist">
    Run through the validation checklist from the source prompt:
    - All visible_when_css selectors verified in browser
    - All field css selectors find exactly one element
    - All next_button_css selectors are clickable
    - Identity values match expected formats
    - Conditional fields have depends_on or correct ordering
    - Popup configs have working selectors
    - Honeypot fields excluded or marked skip
  </step>
</automated_workflow>

<success_criteria>
- Every page of the form has been walked through in the live browser
- Findings report produced with categorized issues (or confirmation of no issues)
- All CRITICAL issues identified (selectors that will cause runner failure)
- Popup interstitials documented with container and dismiss button selectors
- Non-standard widgets identified with correct type annotation
- No files modified (FINDINGS_ONLY enforced)
- User informed of next step: apply corrections via implement-fixes (07), then run env A to verify
</success_criteria>
