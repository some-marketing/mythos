---
description: Append runs to existing developer handoff bundle
argument-hint: <bundle-path> <testcase-id> <runset-id>
allowed-tools: Task
---

<objective>
Invoke the framework/append-to-dev-bundle skill to append one or more testcase runs into
an existing payload-reporting handoff bundle, updating bundle indexes and the lean
For_Recipient.md summary.
</objective>

<context>
This command wraps Prompt 14 (Append Payload Reporting to Existing Handoff). Use
when you already have a DEV_HANDOFF__{developer_name}__payload_reporting__ bundle and want to
add more runs without creating a new bundle.

Guardrails enforced by the skill:
- No code changes
- Raw artifacts (payload JSON, CSV exports, evidence) are copied, never rewritten
- Existing run folders are not overwritten unless explicitly requested
- Reporting stays concise and scannable, preferring paths over embedded logs

Source prompt: `frameworks/wordpress/qa/prompts/14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/append-to-dev-bundle/SKILL.md`
Mode: REVIEW_ONLY
Guardrails: `frameworks/wordpress/qa/guardrails.md#observational-reporting`

Existing bundles:
- If you are in the project root already: `ls -td playwright_phased_runner/dev_handoff/DEV_HANDOFF__*/ 2>/dev/null | head -5`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && ls -td playwright_phased_runner/dev_handoff/DEV_HANDOFF__*/ 2>/dev/null | head -5`

Recent testcases/runsets:
- If you are in the project root already: `for tc in playwright_phased_runner/testcases/*/; do runset=$(ls -td "$tc/runs"/*/ 2>/dev/null | head -1); [ -n "$runset" ] && echo "$(basename $tc): $(basename $runset)"; done | head -5`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && for tc in playwright_phased_runner/testcases/*/; do runset=$(ls -td "$tc/runs"/*/ 2>/dev/null | head -1); [ -n "$runset" ] && echo "$(basename $tc): $(basename $runset)"; done | head -5`
</context>

<process>
1. Parse $ARGUMENTS to extract:
   - BUNDLE_PATH (required) -- path to existing dev_handoff bundle directory
   - TESTCASE_ID (required)
   - RUNSET_ID (required)

2. If any required argument is missing, prompt the user for it.

3. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/append-to-dev-bundle/SKILL.md`
   Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.

4. The skill will:
   a. Validate the existing bundle path
   b. **Dev changelog intake (Step 0a):** Check if bundle has raw/dev_changelog.md.
      If absent or outdated, ask if user has a changelog file; validate, copy to
      `playwright_phased_runner/changelogs/` (canonical location), update LATEST.txt,
      and copy into bundle. Or collect via Prompt 16 if changes occurred.
   c. Check overwrite policy (default: no overwrite)
   d. Run intake loop for the specified testcase run
   e. Copy raw artifacts into the bundle evidence directory
   f. Generate per-run reports (observational, not diagnostic)
   g. Update the bundle index, For_Recipient.md summary, and LLM_MANIFEST.json
      (includes canonical_changelog_path and changelog_status)
   h. Generate QUESTIONS_FOR_DEVELOPER.md (developer interview template)
</process>

<success_criteria>
- Skill definition at `frameworks/wordpress/qa/.claude/skills/qa/append-to-dev-bundle/SKILL.md` successfully read
- All three required arguments (BUNDLE_PATH, TESTCASE_ID, RUNSET_ID) parsed correctly
- Existing bundle validated before modification
- New run data appended without overwriting existing entries
- Bundle index and For_Recipient.md updated to reflect appended runs
- QUESTIONS_FOR_DEVELOPER.md generated for developer handoff conversation
</success_criteria>
