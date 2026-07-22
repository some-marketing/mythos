---
name: navigation-cleanup
description: >
  Repository hygiene pass — reduces duplicate docs, archives legacy material,
  leaves deprecation stubs, updates references, and enforces safe ignore rules
  for exports/PII. Use when the repository has accumulated duplicate or outdated
  documentation that hinders navigation.
---

<objective>
Make the repository easier to navigate by reducing duplicate docs/prompt sets, moving legacy material into clearly labeled archives, leaving deprecation stubs for older paths, updating references to point to canonical locations, and enforcing safe ignore rules for exports/PII. No runner or test logic is modified.
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/15_NAVIGATION_CLEANUP_AND_DEPRECATION.md
</source_prompt>

<prompt_type>Atomic</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § B — Operating rules (REPO_HYGIENE mode)
</shared_blocks_references>

<model_recommendation>
sonnet — straightforward file operations (move, stub, update references). No browser interaction or complex reasoning required.
</model_recommendation>

<execution_mode>
PATCH_ALLOWED — creates, moves, and stubs files but does not change runner logic or test execution code.
</execution_mode>

<quick_start>
Invoke to clean up repository navigation and reduce documentation clutter.
Fully automated: archives duplicates, leaves deprecation stubs, updates references.
Requires clean git state and policy doc at framework/docs/NAVIGATION_CLEANUP_PLAN_AND_POLICY.md.

Full procedure: frameworks/wordpress/qa/prompts/15_NAVIGATION_CLEANUP_AND_DEPRECATION.md
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
This skill encodes Prompt 15 of the Playwright Phased Runner framework. It is a repo-hygiene workflow that operates exclusively on documentation, navigation aids, and file organization. It never touches runner logic, test definitions, or evidence artifacts. The goal is to make the repository approachable for new contributors and reduce confusion caused by duplicated or outdated material.

Key constraints inherited from the source prompt:
- Do not change runner/test logic.
- Do not delete artifacts outright; prefer move then stub.
- Do not add or commit PII.
- Keep changes reviewable: small, well-scoped commits.
</context>

<inputs>
  <required>
    <input name="POLICY_DOCUMENT">Path to framework/docs/NAVIGATION_CLEANUP_PLAN_AND_POLICY.md — defines the full cleanup plan, archive conventions, stub format, and reference update rules</input>
    <input name="REPOSITORY_ROOT">The working directory of the repo to clean up. Must be a git repository with no uncommitted changes at the start</input>
  </required>
</inputs>

<outputs>
- **Archived material:** Legacy or duplicate docs moved into clearly labeled `_archive/` directories with datestamped names.
- **Deprecation stubs:** Short markdown files left at old paths pointing to the canonical location.
- **Updated references:** All internal cross-references (READMEs, indexes, CLAUDE.md, manifest files) updated to point to canonical locations.
- **Root README update:** Simplified navigation section reflecting the cleaned structure.
- **Safe ignore rules:** `.gitignore` entries added for export files and PII-bearing artifacts (CSVs, credentials, etc.) if not already present.
- **Change report:** A short summary document listing what was moved, stubbed, updated, and ignored — written to `framework/docs/NAVIGATION_CLEANUP_REPORT.md`.
- **Updated indexes:** Any `INDEX.md` or `INDEX.json` files refreshed to reflect new paths.
</outputs>

<automated_workflow>

<step name="preflight" type="AUTO">
1. Confirm the working directory is a git repository.
2. Verify there are no uncommitted changes (`git status --porcelain` should be empty).
3. Note the current branch name for commit context.
4. Read the policy document at `framework/docs/NAVIGATION_CLEANUP_PLAN_AND_POLICY.md`.
5. If the policy document is missing, STOP and report — the policy is the single source of truth for this workflow.
</step>

<step name="inventory" type="AUTO">
1. Walk the repository tree and build an inventory of:
   - Duplicate doc trees (same content in multiple locations).
   - Legacy paths referenced by the policy document.
   - Top-level files that should be nested deeper.
   - Stale cross-references in READMEs, CLAUDE.md, and index files.
   - Export/PII files that should be gitignored.
2. Record the inventory for use in subsequent steps.
</step>

<step name="root-readme-update" type="AUTO">
1. Update the root README (if present) to reflect the intended simplified navigation structure defined in the policy.
2. Remove references to paths that will be archived or deprecated in later steps.
3. Add references to canonical locations.
4. Commit: "docs: update root README navigation to canonical paths"
</step>

<step name="deprecate-duplicate-doc-trees" type="AUTO">
1. For each duplicate doc tree identified in the inventory:
   a. Create an `_archive/` directory at the appropriate level if it does not exist.
   b. Move the duplicate material into `_archive/` with a datestamped folder name (e.g., `_archive/2026-01-28__old_docs/`).
   c. Leave a deprecation stub at the original path with contents:
      ```
      # [Original Title] — DEPRECATED
      This document has moved to: [canonical path]
      Archived on: [date]
      ```
2. Commit per logical group: "docs: archive duplicate [name], leave deprecation stub"
</step>

<step name="unify-handoff-conventions" type="AUTO">
1. Ensure all handoff-related docs follow the naming and location conventions defined in the policy.
2. If any handoff bundles or references use non-canonical paths, update them.
3. Verify `LLM_MANIFEST.json` references (if present) point to valid paths.
4. Commit: "docs: unify handoff path conventions"
</step>

<step name="reduce-top-level-clutter" type="AUTO">
1. Move top-level files identified in the inventory into their canonical subdirectories as defined by the policy.
2. Leave deprecation stubs at the old top-level locations.
3. Commit: "docs: reduce top-level clutter, move [files] to [destinations]"
</step>

<step name="update-references" type="AUTO">
1. Search all markdown files, JSON manifests, and CLAUDE.md for references to moved/archived paths.
2. Update each reference to point to the canonical location.
3. Pay special attention to:
   - `.claude/CLAUDE.md` (project instructions)
   - `frameworks/wordpress/qa/prompts/README.md`
   - Any `INDEX.md` or `INDEX.json` files
   - `LLM_MANIFEST.json` files in handoff bundles
4. Commit: "docs: update internal references to canonical paths"
</step>

<step name="enforce-ignore-rules" type="AUTO">
1. Review `.gitignore` for coverage of:
   - CSV export files (WPForms, CRM exports)
   - Credential or token files
   - PII-bearing artifacts
   - Large binary evidence files (if policy specifies)
2. Add missing ignore rules as defined by the policy.
3. Commit: "chore: add gitignore rules for exports and PII artifacts"
</step>

<step name="generate-change-report" type="AUTO">
1. Produce `framework/docs/NAVIGATION_CLEANUP_REPORT.md` containing:
   - Date of cleanup pass.
   - Summary of archived material (old path -> archive path).
   - Summary of deprecation stubs created (path -> points to).
   - Summary of reference updates (file -> what changed).
   - Summary of ignore rules added.
   - Any items from the policy that were skipped and why.
2. Commit: "docs: add navigation cleanup report"
</step>

<step name="final-verification" type="AUTO">
1. Run `git log --oneline` to confirm all commits are clean and well-scoped.
2. Verify no PII was added to any commit.
3. Verify no runner or test logic files were modified (only docs, READMEs, indexes, gitignore).
4. Confirm all deprecation stubs are valid markdown with correct target paths.
5. Report completion with a summary of commits made.
</step>

</automated_workflow>

<success_criteria>
- The policy document was read and followed as the single source of truth.
- No runner or test logic files were modified.
- No artifacts were deleted outright — all removals used move-then-stub.
- No PII was added or committed.
- All commits are small and well-scoped with descriptive messages.
- Deprecation stubs exist at every moved path, pointing to the canonical location.
- All internal cross-references updated to canonical paths.
- `.gitignore` covers export/PII files as defined by the policy.
- `framework/docs/NAVIGATION_CLEANUP_REPORT.md` exists and summarizes all changes.
- Updated indexes and READMEs reflect the cleaned structure.
</success_criteria>
