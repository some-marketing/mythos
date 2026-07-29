---
description: Compile developer handoff bundle with deep payload analysis
argument-hint: <testcase-id> <runset-id>
allowed-tools: Task
---

<objective>
Invoke the framework/compile-dev-bundle skill to perform deep payload analysis and
produce a developer-friendly handoff bundle with canonical payload reports.
</objective>

<context>
This command wraps Prompt 13 (Payload Deep Analysis and {DEVELOPER_NAME} Handoff). It always
creates a NEW handoff bundle directory.

The skill loops over testcase runs to:
- Capture expected payload keys (schema surface area)
- Capture actual Env A processed payload (source of truth)
- Capture CRM export + WPForms export downloads
- Compare expected outcomes vs observed evidence
- Output canonical reports and a dev_handoff bundle

If you need to APPEND runs to an existing bundle instead of creating a new one,
use /framework:append-to-dev-bundle instead.

Supports delegation via subagents for parallel WPForms CSV, CRM CSV, and evidence
scanning when available.

Source prompt: `frameworks/wordpress/qa/prompts/13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/compile-dev-bundle/SKILL.md`
Mode: REVIEW_ONLY
Guardrails: `frameworks/wordpress/qa/guardrails.md#observational-reporting`

Existing bundles:
- If you are in the project root already: `ls -td playwright_phased_runner/dev_handoff/DEV_HANDOFF__*/ 2>/dev/null | head -5`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && ls -td playwright_phased_runner/dev_handoff/DEV_HANDOFF__*/ 2>/dev/null | head -5`

Latest changelog:
- If you are in the project root already: `cat playwright_phased_runner/changelogs/LATEST.txt 2>/dev/null || echo "None"`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && cat playwright_phased_runner/changelogs/LATEST.txt 2>/dev/null || echo "None"`

Recent testcases/runsets:
- If you are in the project root already: `for tc in playwright_phased_runner/testcases/*/; do runset=$(ls -td "$tc/runs"/*/ 2>/dev/null | head -1); [ -n "$runset" ] && echo "$(basename $tc): $(basename $runset)"; done | head -5`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && for tc in playwright_phased_runner/testcases/*/; do runset=$(ls -td "$tc/runs"/*/ 2>/dev/null | head -1); [ -n "$runset" ] && echo "$(basename $tc): $(basename $runset)"; done | head -5`
</context>

<process>
1. Parse $ARGUMENTS to extract:
   - TESTCASE_ID (required)
   - RUNSET_ID (required)

2. If any required argument is missing, prompt the user for it.

3. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/compile-dev-bundle/SKILL.md`
   Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.
   Pass the extracted arguments (testcase-id, runset-id) as context.

4. The skill will:
   a. **Dev changelog intake (Pre-Step):** Ask if the user has a dev changelog file.
      If yes, validate and copy to `playwright_phased_runner/changelogs/` (canonical location),
      update LATEST.txt. If no, check LATEST.txt for a recent changelog to reuse, or
      collect via Prompt 16 if codebase changes occurred. Confirm before proceeding.
   b. Scan run evidence for payload data and export files
   c. Optionally delegate to subagents (WPForms scan, CRM scan, evidence scan)
   d. Build field-by-field comparison tables
   e. Produce canonical reports in reports/ directory (observational, not diagnostic)
   f. Create a new dev_handoff bundle with reports, raw files, and LLM index
      (includes canonical_changelog_path and changelog_status in LLM_MANIFEST.json)
   g. Generate QUESTIONS_FOR_DEVELOPER.md (developer interview template)
</process>

<success_criteria>
- Skill framework/compile-dev-bundle successfully invoked
- Both required arguments parsed and passed correctly
- New handoff bundle created (never appending to existing)
- Canonical payload reports written to reports/ directory
- Bundle contains raw artifacts, reports, and retrieval index
- QUESTIONS_FOR_DEVELOPER.md generated for developer handoff conversation
- Reports follow observational philosophy (no diagnoses, no code suggestions)
</success_criteria>
