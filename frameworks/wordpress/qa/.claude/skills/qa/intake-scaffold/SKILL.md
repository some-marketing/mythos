---
name: intake-scaffold
description: >
  Sets up a new testcase for the Playwright Phased Runner framework. Gathers target form URL and site
  details, generates locator_map.json via DOM inspection, creates identity.json with test data,
  and scaffolds the complete testcase folder structure including testcase.json and EXPECTED_OUTCOMES.md.
  Use when onboarding a new form, adding a new site, or creating a variant testcase.
---

<objective>
Guide the executor through initial testcase setup for the Phased Runner framework.

This skill wraps the detailed procedure defined in the source prompt. The executor MUST read
the source prompt file in full before proceeding, then follow its steps while applying the
structure and guardrails encoded here.
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/01_INTAKE_AND_SCAFFOLD.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID)
- 09_SHARED_BLOCKS.md § B — Operating rules (PATCH_ALLOWED mode)
</shared_blocks_references>

<model_recommendation>
sonnet -- Requires reasoning for config generation and DOM analysis, but does not need the
heavyweight visual reasoning of opus. Sonnet balances speed with accuracy for scaffold work.
</model_recommendation>

<execution_mode>
PATCH_ALLOWED -- This skill creates new files (locator_map.json, identity.json, testcase.json,
EXPECTED_OUTCOMES.md) and may create directories. It does not modify existing test runs.
</execution_mode>

<quick_start>
1. [AUTO] Read the source prompt: frameworks/wordpress/qa/prompts/01_INTAKE_AND_SCAFFOLD.md
2. [USER] Gather required inputs (ask the user for any missing values). **STOP and wait for user response before proceeding.**
3. [AUTO] Navigate to the form URL with browser tools and inspect the DOM
4. [AUTO] Generate locator_map.json from field inspection
5. [AUTO] Create identity.json with test data values
6. [AUTO] Scaffold testcase.json with URLs, auth config, and asset paths
7. [AUTO] Write EXPECTED_OUTCOMES.md documenting success criteria
8. [GATE: validation_available] If framework CLI is available, run validation. Otherwise, manually verify JSON parsing. **STOP and wait for user response before proceeding if validation fails.**
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, run these commands to understand current state:

```bash
# List existing testcases to avoid duplicates
ls "<PROJECT_ROOT>/playwright_phased_runner/testcases/" 2>/dev/null || echo "No testcases directory yet"

# Check if framework CLI is available
node "<PROJECT_ROOT>/framework/runner/cli.js" --help 2>/dev/null | head -5 || echo "CLI not found at expected path"
```
</context>

<inputs>
  <required>
    <input name="form_url" description="Direct URL to the target form" />
    <input name="site_id" description="Short identifier for the site (e.g., clienta, client-xyz)" />
    <input name="testcase_id" description="Descriptive identifier for the testcase (e.g., apply_form_happypath)" />
  </required>
  <optional>
    <input name="project_root" description="Path to project root containing playwright_phased_runner/testcases/. Defaults to current working directory. Required if you are not already working inside the project root." />
    <input name="decorated_url_base" description="Tracking URL pattern for env C (with UTM params)" />
    <input name="form_technology" description="Form platform: WPForms, Gravity Forms, custom React, etc." />
    <input name="is_multipage" description="Whether the form has multiple pages/steps (true/false)" />
    <input name="auth_required" description="Whether env B needs logged-in state (true/false)" />
    <input name="environments" description="Which environments to configure. Default: A, B, C" />
  </optional>
</inputs>

<outputs>
  <output path="playwright_phased_runner/testcases/{testcase_id}/locator_map.json" description="Field selectors mapped from DOM inspection" />
  <output path="playwright_phased_runner/testcases/{testcase_id}/identity.json" description="Test data values keyed to locator map fields" />
  <output path="playwright_phased_runner/testcases/{testcase_id}/testcase.json" description="URLs, auth states, phase config, asset paths" />
  <output path="playwright_phased_runner/testcases/{testcase_id}/EXPECTED_OUTCOMES.md" description="What success looks like for each environment" />
</outputs>

<automated_workflow>
  <step number="1" name="load_source_prompt" type="AUTO">
    Read the full source prompt file:
    ```
    frameworks/wordpress/qa/prompts/01_INTAKE_AND_SCAFFOLD.md
    ```
    This is the authoritative reference for the detailed procedure. All subsequent steps
    follow from the procedures defined there.
  </step>

  <step number="2" name="project_intake" type="USER">
    Gather required inputs from the user. For any value not provided, ask using direct
    questions. Collect at minimum: site_id, form_url, testcase_id.

    Also determine: decorated_url_base, form_technology, is_multipage, auth_required.
    See the "Step 1: Project Intake" table in the source prompt for the full intake list.

    **STOP and wait for user response before proceeding.**
  </step>

  <step number="3" name="generate_locator_map" type="AUTO">
    Navigate to the form URL using browser tools (Playwright MCP).
    Follow the "Step 2: Generate Locator Map" procedure from the source prompt:
    - Map all user-editable fields (key, type, css, required, label_text)
    - For multipage forms: split into pages array with visible_when_css and next_button_css
    - Capture submit button_css, success indicator, and error_selectors
    - Prefer stable selectors: #id > [name="..."] > [data-*] > class-based
    - Exclude hidden/honeypot fields

    Write the result to: playwright_phased_runner/testcases/{testcase_id}/locator_map.json
  </step>

  <step number="4" name="create_identity" type="AUTO">
    Generate identity.json following the "Step 3: Create Identity File" procedure:
    - One entry per field key in locator_map.json
    - Use realistic test data with {TIMESTAMP} placeholder for unique emails
    - Select values must use option value attributes, not display text
    - Phone as digits only

    Write to: playwright_phased_runner/testcases/{testcase_id}/identity.json
  </step>

  <step number="5" name="scaffold_testcase_json" type="AUTO">
    Create testcase.json following the "Step 4: Create Testcase Structure" procedure:
    - Include testcase_id, site, urls (direct + decorated_base)
    - Configure auth_states if env B requires login
    - Set phases array (default: ["P1", "P2", "P3", "P4", "P5"])
    - Set asset paths pointing to locator_map.json and identity.json

    Write to: playwright_phased_runner/testcases/{testcase_id}/testcase.json
  </step>

  <step number="6" name="write_expected_outcomes" type="AUTO">
    Create EXPECTED_OUTCOMES.md documenting:
    - What happens on successful submission (redirect, confirmation, dataLayer events)
    - Tracking expectations (cookies, dataLayer events per phase)
    - Env-specific notes (A vs B vs C differences)

    Write to: playwright_phased_runner/testcases/{testcase_id}/EXPECTED_OUTCOMES.md
  </step>

  <step number="7" name="validate" type="GATE">
    Validate the scaffolded files:
    ```bash
    cd "<PROJECT_ROOT>" && node framework/runner/cli.js validate --testcase {testcase_id}
    ```
    If the CLI validate command is not available, manually verify:
    - All JSON files parse without errors
    - Every required field in locator_map.json has a corresponding identity.json entry
    - All CSS selectors in locator_map.json are syntactically valid

    **STOP and wait for user response before proceeding if validation fails.**
  </step>
</automated_workflow>

<success_criteria>
- playwright_phased_runner/testcases/{testcase_id}/ directory exists with all four files
- locator_map.json is valid JSON with at least one page and one field
- identity.json has a value for every required field key in the locator map
- testcase.json has valid urls.direct and correct asset paths
- EXPECTED_OUTCOMES.md documents success indicators for at least env A
- JSON validation passes (either via CLI or manual parse check)
- User has been informed of next step: run 02_LOCATORS_AND_CORRECTION walkthrough
</success_criteria>
