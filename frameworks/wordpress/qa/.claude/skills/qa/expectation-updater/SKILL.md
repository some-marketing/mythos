---
name: expectation-updater
description: >
  Updates testcase expectation files (EXPECTED_OUTCOMES.md, expected_payload.json)
  based on a dev changelog. Parses behavioral and data format changes, maps them
  to expectation fields, presents proposed updates for user confirmation, and
  applies approved changes. Use after changelog-capture when testcase expectations
  need to reflect intentional behavioral changes.
---

<objective>
Parse a dev changelog and update testcase expectation files to reflect intentional
behavioral and data format changes. All updates require user confirmation before
applying. This ensures testcase expectations stay synchronized with codebase changes.

This skill wraps the workflow defined in the agent specification. The executor
MUST read the agent definition for detailed workflow steps, then follow the
structure and guardrails encoded here.
</objective>

<source_agent>
frameworks/wordpress/qa/.claude/agents/qa/expectation-updater-agent.md
</source_agent>
<!-- Intentional: this skill wraps an agent definition, not a source prompt. See prompt_to_artifact_mapping in update-framework-artifacts for documentation. -->

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § B — Operating rules (PATCH_ALLOWED mode)
</shared_blocks_references>

<model_recommendation>
sonnet -- Structured text parsing and file updates. No browser interaction or
complex multi-step reasoning required. Sonnet handles changelog parsing, JSON
manipulation, markdown updates, and interactive confirmation efficiently.
</model_recommendation>

<execution_mode>
PATCH_ALLOWED -- This skill updates testcase expectation files:
- {testcase}/EXPECTED_OUTCOMES.md (in place)
- {testcase}/expected_payload.json (in place)

It does NOT modify run artifacts, runner code, or changelogs.
All changes require explicit user confirmation before applying.
</execution_mode>

<quick_start>
1. [AUTO] Read the agent definition: frameworks/wordpress/qa/.claude/agents/qa/expectation-updater-agent.md
2. [USER] Gather inputs: changelog_path, testcase_ids (and optional: project_root). **STOP and wait for user response before proceeding.**
3. [AUTO] Parse changelog for "Behavioral changes" and "Data format / mapping changes"
4. [GATE: unclear mapping] For each testcase: read current expectations, generate proposed updates. If any changelog line doesn't map cleanly to an expectation field, **STOP and wait for user response before proceeding.**
5. [USER] Present each proposed update to user for confirmation (yes/no/modify). **STOP and wait for user response before proceeding.**
6. [AUTO] Apply confirmed updates, preserve file formatting
7. [AUTO] Generate expectation_update_summary.md with all applied/declined changes
8. [AUTO] Return summary to caller
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
# Find the latest changelog
cd "{project_root}" && cat playwright_phased_runner/changelogs/LATEST.txt 2>/dev/null || echo "No LATEST.txt"

# List available testcases
cd "{project_root}" && ls playwright_phased_runner/testcases/ 2>/dev/null || echo "No testcases directory"

# Check a specific testcase's expectation files
cd "{project_root}" && ls playwright_phased_runner/testcases/{testcase_id}/expected_payload.json playwright_phased_runner/testcases/{testcase_id}/EXPECTED_OUTCOMES.md 2>/dev/null
```

Also read: frameworks/wordpress/qa/.claude/agents/qa/expectation-updater-agent.md (full workflow)
</context>

<inputs>
<required>
  <input name="changelog_path">Path to dev changelog file (canonical or bundle copy). If not provided, read from LATEST.txt</input>
  <input name="testcase_ids">Comma-separated list of testcase IDs to update (e.g., full_mapping_t2_happypath,wpforms_88839_vdp_to_vsn_apply)</input>
</required>
<optional>
  <input name="project_root">Path to project root containing playwright_phased_runner/. Required if you are not already working inside the project root.</input>
  <input name="testcase_base_path">Base path to testcases (default: playwright_phased_runner/testcases/)</input>
</optional>
</inputs>

<outputs>
Per-testcase updates (confirmed changes only):
- {testcase}/EXPECTED_OUTCOMES.md — Updated in place
- {testcase}/expected_payload.json — Updated in place

Summary (always):
- expectation_update_summary.md — Returned to caller with all applied/declined changes
</outputs>

<automated_workflow>
  <step id="1" name="parse-changelog" type="AUTO">
    Read the changelog file at changelog_path.
    Extract:
    - "## Behavioral changes" section → list of behavior changes
    - "## Data format / mapping changes" section → list of format changes

    If both sections are empty or absent, return early: "No expectation updates needed"
  </step>

  <step id="2" name="map-changes-to-fields" type="GATE" condition="unclear mapping between changelog line and expectation field">
    [GATE: unclear mapping] If condition TRUE (changelog line doesn't map cleanly), behave as [USER] — ask for guidance. If FALSE, proceed as [AUTO].

    For each behavioral change, identify EXPECTED_OUTCOMES.md mappings:
    - "Field X now populated" → Update "Known empty fields" section
    - "New field Y added" → Add to expected fields list
    - "Validation rule changed" → Update pass/fail criteria
    - "Consent flow updated" → Update consent section

    For each data format change, identify expected_payload.json mappings:
    - "Field X format changed from A to B" → Update field value/comment
    - "New field X added with format Y" → Add field to JSON
    - "Field X removed" → Remove field or mark as deprecated
    - "Field X renamed to Y" → Update key name

    If condition TRUE: STOP and ask user for guidance on unmapped changelog lines.
    **STOP and wait for user response before proceeding.**

    If condition FALSE: All lines mapped cleanly. Proceed automatically.
  </step>

  <step id="3" name="generate-proposed-updates" type="AUTO">
    For each testcase in testcase_ids:
    1. Read current EXPECTED_OUTCOMES.md
    2. Read current expected_payload.json
    3. Generate list of proposed changes with:
       - File being modified
       - Section/field being changed
       - Current value
       - Proposed new value
       - Changelog line that justifies this change
  </step>

  <step id="4" name="confirm-with-user" type="USER">
    Present each proposed change individually to user:

    ```
    ═══════════════════════════════════════════════════════════════════
    PROPOSED UPDATE #N of TOTAL
    ═══════════════════════════════════════════════════════════════════

    Testcase: {testcase_id}
    File:     {file_name}
    Field:    {field_name}

    CURRENT VALUE:
      {current_value}

    PROPOSED VALUE:
      {proposed_value}

    CHANGELOG EVIDENCE:
      {changelog_line}

    ───────────────────────────────────────────────────────────────────
    Apply this update? (yes / no / modify)
    ```

    **STOP and wait for user response before proceeding.**

    User responses:
    - yes: Apply the change as proposed
    - no: Skip this change; record as declined
    - modify: User provides alternative value; apply user's version
  </step>

  <step id="5" name="apply-updates" type="AUTO">
    For each confirmed update:
    1. Read the target file
    2. Apply the change (preserve formatting, JSON indentation, markdown structure)
    3. Write the updated file
    4. Log the change in summary
  </step>

  <step id="6" name="generate-summary" type="AUTO">
    Create expectation_update_summary.md:

    ```markdown
    # Expectation Update Summary

    **Generated:** {timestamp}
    **Changelog:** {changelog_path}
    **Testcases:** {testcase_ids}

    ## Updates Applied

    | Testcase | File | Field/Section | Old Value | New Value |
    |----------|------|---------------|-----------|-----------|

    ## Updates Declined

    | Testcase | File | Field/Section | Proposed Value | Reason |
    |----------|------|---------------|----------------|--------|

    ## No Updates Needed

    (List any testcases where no changes were applicable)
    ```

    Return summary to caller.
  </step>
</automated_workflow>

<rules>
1. **Never auto-apply changes** — Every change requires explicit user confirmation
2. **Preserve file formatting** — Maintain JSON indentation, markdown structure
3. **Document everything** — All applied AND declined changes go in summary
4. **Ask when unclear** — If a changelog line doesn't map cleanly to an expectation field, ask user for guidance
5. **One change at a time** — Present changes individually, not as a batch
6. **Show evidence** — Always cite the changelog line that justifies each change
</rules>

<failure_modes>
| Condition | Action |
|-----------|--------|
| Changelog change doesn't match any expectation file content | Ask user: "This change doesn't map to any existing field. Should I add a new field/section?" |
| Expected file doesn't exist for a testcase | Skip that testcase; note in summary |
| JSON parse error in expected_payload.json | Report error; ask user to fix manually; skip file |
| Multiple fields affected by single changelog line | Present each field change separately |
| User wants to modify a proposed value | Accept user's input; validate JSON if applicable |
| No changelog_path provided and LATEST.txt missing | Ask user for changelog path |
</failure_modes>

<success_criteria>
- Changelog was parsed and all behavioral/format changes extracted
- All applicable testcases were processed
- Each proposed update was presented to user with evidence
- Only user-confirmed changes were applied
- File formatting was preserved (JSON indentation, markdown structure)
- Summary was generated with applied/declined/skipped changes
- No changes were auto-applied without confirmation
</success_criteria>
