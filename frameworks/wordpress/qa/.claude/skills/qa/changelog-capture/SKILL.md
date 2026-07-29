---
name: changelog-capture
description: >
  Collects a structured developer changelog describing what changed in the
  codebase so QA/reporting can interpret results correctly and flag regressions
  with confidence. Provides a copy/paste prompt for the developer, ingests
  their response, extracts a verification checklist, and saves the changelog
  to the canonical location and optionally into an existing handoff bundle.
  Use after implementing fixes (before QA rerun), before new testcases after
  updates, or when unsure whether observed behavior is a regression.
---

<objective>
Coordinate collection of a structured changelog from the developer, ingest and
summarize it into a standard format, extract a verification checklist for the
next test run, and persist the changelog to the canonical location. Optionally
copy into an existing handoff bundle so downstream LLMs have change context.

This skill wraps the detailed procedure defined in the source prompt. The
executor MUST read the source prompt file in full before proceeding, then
follow its steps while applying the structure and guardrails encoded here.
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § B — Operating rules (PATCH_ALLOWED mode)
</shared_blocks_references>

<model_recommendation>
sonnet -- Text processing and structured output. No browser interaction or
complex multi-step reasoning required. Sonnet handles prompt formatting,
markdown ingestion, checklist extraction, and file writing efficiently.
</model_recommendation>

<execution_mode>
PATCH_ALLOWED -- This skill writes changelog files to the canonical location
(playwright_phased_runner/changelogs/) and updates LATEST.txt. It may also
write into an existing handoff bundle (raw/dev_changelog.md and
raw/dev_changelog.checklist.json). It does not modify test runs, testcase
configuration, or runner code.
</execution_mode>

<quick_start>
1. [AUTO] Read the source prompt: frameworks/wordpress/qa/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md
2. [USER] Present the dev prompt to the operator (Step 0 + Step 1 from source prompt)
3. [USER] Wait for the dev's changelog response to be pasted back
4. [AUTO] Ingest the response: summarize into "Change context", extract verification checklist
5. [GATE: missing details] If details are missing (no commit range, no diffstat), ask for the missing pieces
6. [AUTO] Save changelog to canonical location: playwright_phased_runner/changelogs/dev_changelog__{date}__{from}__{to}.md
7. [AUTO] Update LATEST.txt with the new filename
8. [AUTO] If a bundle context exists, also save to raw/dev_changelog.md and raw/dev_changelog.checklist.json
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, run these commands to understand the current state:

```bash
# Check for existing changelogs
cd "<PROJECT_ROOT>" && ls playwright_phased_runner/changelogs/ 2>/dev/null || echo "No changelogs directory yet"

# Read current LATEST.txt if it exists
cd "<PROJECT_ROOT>" && cat playwright_phased_runner/changelogs/LATEST.txt 2>/dev/null || echo "No LATEST.txt"

# Check if a handoff bundle exists (for optional bundle save)
cd "<PROJECT_ROOT>" && ls playwright_phased_runner/dev_handoff/ 2>/dev/null || echo "No dev_handoff directory"
```

Also read: frameworks/wordpress/qa/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md (full procedure)
</context>

<inputs>
<required>
No pre-existing inputs are required. The skill collects all data interactively:
- The dev prompt is presented to the operator in Step 1
- The dev's changelog response is pasted back in Step 2
</required>
<optional>
- BUNDLE_DIR: path to an existing DEV_HANDOFF__{developer_name}__payload_reporting__* directory (triggers Step 3b bundle save)
- PROJECT_ROOT: path to project root containing playwright_phased_runner/. Defaults to current working directory.
- DEV_CHANGELOG_FILE: path to an already-written changelog file (skips Steps 0-1, goes directly to ingestion)
</optional>
</inputs>

<outputs>
Canonical changelog (always):
- <PROJECT_ROOT>/playwright_phased_runner/changelogs/dev_changelog__{date}__{from}__{to}.md
- <PROJECT_ROOT>/playwright_phased_runner/changelogs/LATEST.txt (updated with new filename)

Chat output (always):
- Change context summary (short prose summary of what changed)
- Verification checklist (what the next testcase run must verify)

Bundle artifacts (if BUNDLE_DIR provided):
- <BUNDLE_DIR>/raw/dev_changelog.md (copy of canonical changelog)
- <BUNDLE_DIR>/raw/dev_changelog.checklist.json (machine-friendly extracted checklist)
</outputs>

<automated_workflow>
  <step number="1" name="load_source_prompt" type="AUTO">
    Read the full source prompt file:
    ```
    frameworks/wordpress/qa/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md
    ```
    This is the authoritative reference for the detailed procedure. All
    subsequent steps follow from the procedures defined there.
  </step>

  <step number="2" name="check_existing_state" type="AUTO">
    Check for existing changelogs and determine if a bundle context exists:
    - List playwright_phased_runner/changelogs/ for existing changelogs
    - Read LATEST.txt if present
    - If BUNDLE_DIR was provided, verify it exists and read its INDEX.md

    If DEV_CHANGELOG_FILE was provided, skip to step 5 (ingestion).
  </step>

  <step number="3" name="present_dev_prompt" type="USER">
    Tell the operator (Step 0 from source prompt):

    "I need the changelog context for this analysis. Please ask the dev to
    copy/paste the prompt below into their environment (or into their own LLM)
    and paste the output back here."

    Then present the full dev prompt from Step 1 of the source prompt. This
    prompt asks the developer to:
    1) Identify repo + branch + deployment target
    2) Provide exact commit range (FROM_COMMIT, TO_COMMIT)
    3) Paste git log, git diff --name-status, git diff --stat outputs
    4) Answer six behavioral-change questions (form, tracking, payload, CRM,
       env deltas, migrations)
    5) Produce a markdown changelog with Identity, Summary, Behavioral changes,
       Data/mapping changes, Risk areas, Rollback/compat notes, Evidence

    **STOP and wait for user response before proceeding.**
  </step>

  <step number="4" name="validate_response" type="GATE" condition="response incomplete">
    Check the dev's response for completeness. If any of the following are
    missing, ask the operator for the missing pieces explicitly:
    - Commit range (from_commit, to_commit)
    - Diffstat or file list
    - Answers to the behavioral-change questions
    - Identity section with repo, branch, timestamps

    If missing: **STOP and wait for user response before proceeding.**

    If complete: Proceed autonomously to step 5.
  </step>

  <step number="5" name="ingest_and_summarize" type="AUTO">
    Ingest the dev's changelog (Step 2 from source prompt):
    - Summarize into a short "Change context" section (3-6 bullet points)
    - Extract a checklist of what the next testcase run must verify, focused on:
      - Behavior changes (form steps, selectors, conditional logic)
      - Data format / mapping changes (payload fields, CRM schema)
      - Tracking changes (dataLayer, cookies, attribution)
    - Present the Change context and Verification checklist to the operator
  </step>

  <step number="6" name="save_canonical" type="AUTO">
    Save the changelog to the canonical location (Step 3a from source prompt):

    1. Parse the Identity section to extract:
       - generated_at_utc date component (YYYY-MM-DD)
       - from_commit (short hash or tag)
       - to_commit (short hash or tag)

    2. Determine the filename:
       - With commit range: dev_changelog__{date}__{from}__{to}.md
       - Without commit range: dev_changelog__{date}__manual.md

    3. Ensure directory exists:
       ```bash
       cd "<PROJECT_ROOT>" && mkdir -p playwright_phased_runner/changelogs
       ```

    4. Write the changelog file to:
       playwright_phased_runner/changelogs/{filename}

    5. Update LATEST.txt with the filename (one line, filename only).
  </step>

  <step number="7" name="save_to_bundle" type="AUTO" condition="BUNDLE_DIR provided">
    If a bundle context exists (Step 3b from source prompt):

    1. Ensure raw/ directory exists in the bundle:
       ```bash
       mkdir -p <BUNDLE_DIR>/raw
       ```

    2. Copy the changelog to: <BUNDLE_DIR>/raw/dev_changelog.md

    3. Generate a machine-friendly checklist and save to:
       <BUNDLE_DIR>/raw/dev_changelog.checklist.json
       Format: JSON array of objects with keys: area, check, priority

    4. If the bundle has an INDEX.md or INDEX.json, reference the new
       raw/dev_changelog.md and raw/dev_changelog.checklist.json paths
       so downstream LLMs read them first.

    5. If the bundle has an LLM_MANIFEST.json, update:
       - canonical_changelog_path: relative path to the canonical changelog
       - changelog_status: "present"
  </step>

  <step number="8" name="report_and_handoff" type="AUTO">
    Print to the operator:
    - Path to the saved canonical changelog
    - LATEST.txt updated confirmation
    - Change context summary (short)
    - Verification checklist (what to re-verify in the next run)
    - If bundle was updated: paths to raw/dev_changelog.md and raw/dev_changelog.checklist.json
    - Recommended next step: run the testcase to verify changes (use parallel-run or rerun-verify skill)
  </step>
</automated_workflow>

<success_criteria>
- Source prompt was read in full before executing
- Dev prompt was presented verbatim to the operator (or DEV_CHANGELOG_FILE was provided)
- Dev response was validated for completeness (commit range, diffstat, behavioral answers)
- Change context summary produced (concise, 3-6 bullets)
- Verification checklist extracted (behavior, data format, CRM mapping focus)
- Changelog saved to canonical path: playwright_phased_runner/changelogs/dev_changelog__{date}__{from}__{to}.md
- LATEST.txt updated with the new changelog filename
- If bundle context exists: raw/dev_changelog.md and raw/dev_changelog.checklist.json written
- Operator informed of saved paths and recommended next step
- No test runs executed; no testcase configuration or runner code modified
</success_criteria>
