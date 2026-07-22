---
description: Run navigation cleanup and deprecation pass (REPO_HYGIENE)
allowed-tools: Task
---

<objective>
Invoke the framework/navigation-cleanup skill to reduce duplicate docs, archive legacy
material, update references, and enforce .gitignore rules. This is a REPO_HYGIENE
operation -- no runner/test logic changes.

No arguments required -- the skill reads the cleanup plan and executes automatically.
</objective>

<context>
This command wraps Prompt 15 (Navigation Cleanup and Deprecation). It operates in
REPO_HYGIENE mode -- no runner logic changes are permitted.

Source prompt: `frameworks/wordpress/qa/prompts/15_NAVIGATION_CLEANUP_AND_DEPRECATION.md`
Skill definition: `frameworks/wordpress/qa/.claude/skills/qa/navigation-cleanup/SKILL.md`
Mode: REPO_HYGIENE -- no runner logic changes permitted.

The skill consolidates duplicate documentation, archives legacy material behind stubs,
updates cross-references to canonical paths, and enforces .gitignore rules for PII and
export files.
</context>

<process>
1. **Confirmation gate**: Display the scope of cleanup operations. Ask user to confirm before proceeding.

2. Read the skill definition: `frameworks/wordpress/qa/.claude/skills/qa/navigation-cleanup/SKILL.md`
   Follow the skill's `<quick_start>` and `<automated_workflow>` sections exactly.

3. The skill will:
   a. Read framework/docs/NAVIGATION_CLEANUP_PLAN_AND_POLICY.md
   b. Perform preflight checks (verify expected files and directories exist)
   c. Archive duplicate documents, leaving redirect stubs at original locations
   d. Update cross-references to point to canonical paths
   e. Enforce .gitignore rules for PII and export files
   f. Produce a change report summarizing all modifications

4. Present the change report to the user.
</process>

<success_criteria>
- Skill framework/navigation-cleanup successfully invoked
- Duplicate docs archived with redirect stubs at original locations
- References updated to canonical paths
- .gitignore rules enforced for PII/exports
- Change report produced and presented to user
- No runner logic modified
</success_criteria>
