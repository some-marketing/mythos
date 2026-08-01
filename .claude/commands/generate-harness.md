---
description: Generate framework-local .claude harness trees for frameworks that are missing their skills, commands, and agents surface, or refresh that surface after material framework changes.
mode: PATCH_ALLOWED
---

<objective>
Create or refresh the per-framework Claude harness surface from framework truth so promoted or materially changed frameworks have the expected .claude/skills/, .claude/commands/, and .claude/agents/ trees on disk.
</objective>

<process>
- Parse flags and require an explicit target selector: --all or --framework <id>. Accept optional --dry-run.
- Resolve target frameworks from frameworks/*/* or from the single framework specified by --framework <id>.
- For each target framework, read manifest.json and guardrails.md to confirm the framework is structurally valid and to derive the expected harness paths.
- Identify frameworks that do not yet have a complete .claude harness tree, or treat the selected framework as a refresh target when its manifest or prompt chain changed materially.
- Generate the framework-local .claude surface under the manifest-declared skills_path, commands_path, and agents_path, producing the missing skills, commands, and agents directories and files for the framework.
- If --dry-run is present, report the planned writes and exit without mutating the working tree.
- Review the generated tree and follow with /sync-manifest when the project-level asset index must be refreshed to match the new on-disk harness assets.
</process>

<success_criteria>
- An explicit target selector (--all or --framework <id>) is used, with --dry-run honored when present.
- Each target framework is resolved from frameworks/{service}/{framework}/ and validated against manifest.json and guardrails.md before generation.
- The framework-local .claude/skills/, .claude/commands/, and .claude/agents/ surfaces are generated or refreshed from framework truth under the manifest-declared paths.
- Dry-run output truthfully reports planned writes without modifying the working tree.
- The generated harness tree is ready for follow-up audit or manifest sync via the declared handoff commands.
</success_criteria>

<handoff>
single_framework_generated: /audit-framework frameworks/{service}/{framework}
all_targets_generated: /sync-manifest
dry_run_reviewed: Re-run /generate-harness without --dry-run after confirming the target set
</handoff>
