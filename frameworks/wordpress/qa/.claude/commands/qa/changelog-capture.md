---
description: Capture structured dev changelog for QA context
argument-hint: "[bundle-path]"
allowed-tools: Task
---

<objective>
Invoke the framework/changelog-capture skill to collect a structured changelog from
the developer, save it to the canonical changelog location, and optionally copy it
into an existing handoff bundle.
</objective>

<context>
This command wraps Prompt 16 (Changelog Capture from Dev). It operates as a standalone
changelog collection workflow that can be used independently or as a precursor to
payload analysis and reporting commands.

Source prompt: `frameworks/wordpress/qa/prompts/16_CHANGELOG_CAPTURE_FROM_DEV.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/changelog-capture/SKILL.md`
Mode: PATCH_ALLOWED
Guardrails: `frameworks/wordpress/qa/guardrails.md#file-modification-rules`

The skill collects a structured changelog with required sections covering what changed,
why, and what QA should verify. The changelog is saved to the canonical cross-testcase
location at `playwright_phased_runner/changelogs/` and optionally into an existing
handoff bundle's `raw/dev_changelog.md`.

Canonical changelog location: `playwright_phased_runner/changelogs/`

Latest changelog:
- If you are in the project root already: `cat playwright_phased_runner/changelogs/LATEST.txt 2>/dev/null || echo "None"`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && cat playwright_phased_runner/changelogs/LATEST.txt 2>/dev/null || echo "None"`

Recent commits (run from the *target codebase*, not Mythos):
- `cd "<CODEBASE_ROOT>" && git log --oneline -5`

Existing bundles:
- If you are in the project root already: `ls -td playwright_phased_runner/dev_handoff/DEV_HANDOFF__*/ 2>/dev/null | head -3`
- If you are running from elsewhere: `cd "<PROJECT_ROOT>" && ls -td playwright_phased_runner/dev_handoff/DEV_HANDOFF__*/ 2>/dev/null | head -3`
</context>

<process>
1. Parse $ARGUMENTS to extract:
   - BUNDLE_PATH (optional) -- path to an existing dev_handoff bundle directory

2. If no arguments are provided, the skill will save the changelog to the canonical
   location only (no bundle copy).

3. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/changelog-capture/SKILL.md`
   Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly,
   passing bundle-path (if provided) as context.

4. The skill will:
   a. Provide a copy/paste prompt template for the developer to fill out
   b. Ingest the developer's structured response
   c. Validate that all required sections are present:
      - Identity (date, commit range, developer)
      - Summary of changes
      - Behavioral changes
      - Data/mapping changes
      - Risk areas
      - Evidence (logs, tests, manual verification)
   d. Save the changelog to `playwright_phased_runner/changelogs/` using canonical
      naming: `dev_changelog__{YYYY-MM-DD}__{from}__{to}.md`
   e. Update `playwright_phased_runner/changelogs/LATEST.txt` to point to the
      new changelog
   f. If BUNDLE_PATH was provided, copy the changelog into the bundle at
      `raw/dev_changelog.md`
   g. Extract a verification checklist from the changelog for QA consumption

5. Display the saved changelog path and verification checklist to the user.
</process>

<success_criteria>
- Skill framework/changelog-capture successfully invoked
- Dev changelog collected with all required sections (Identity, Summary, Behavioral
  changes, Data/mapping changes, Risk areas, Evidence)
- Changelog saved to canonical location at playwright_phased_runner/changelogs/
  with proper naming convention
- LATEST.txt updated to point to the new changelog
- If bundle-path provided, changelog copied to bundle raw/dev_changelog.md
- Verification checklist extracted and displayed to user
</success_criteria>
