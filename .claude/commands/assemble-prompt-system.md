---
description: Reconcile prompt packs, run prompts, manifest, and the master run order
mode: PATCH_ALLOWED
---

<objective>
Keep the _dev/prompts/ system coherent so advance-pipeline can rely on a truthful master run order, registered reusable prompt packs, and correctly linked run prompts. This command reconciles existing prompt-system assets; author new prompt packs or master-run-order sections with author-prompt-system first when the underlying work only exists as research or proposed flows.
</objective>

<process>
- Resolve scope from arguments: if empty or 'all', inspect full _dev/prompts/ system; if 'master', reconcile the current master workflow surfaces to latest repo truth instead of preserving stale historical classifications; if a path, inspect that file plus linked surfaces. If prompt-system assets do not exist and only research materials exist, stop and recommend author-prompt-system instead.
- Inventory prompt-system files and classify: reusable prompt packs (claude-prompt-pack-*.md), run prompts (claude-run-*.md), master docs (claude-master-run-order.md), supporting docs/templates (everything else under _dev/prompts/).
- Reconcile reusable prompt packs: confirm each pack has a clear objective, file-read list, implementation flow, validation prompt, and completion-audit prompt; ensure each reusable pack is registered in _dev/prompts/manifest.json.
- Reconcile run prompts: ensure each run prompt points back to a reusable pack or architecture doc; ensure one-shot run prompts are NOT treated as reusable prompt packs in the manifest.
- Reconcile the master run order: ensure every stage or cross-cutting track reference points to an existing prompt pack; ensure newly added foundational packs are inserted into the sequence or listed as cross-cutting infrastructure; ensure stage status notes and defer guidance are still truthful.
- When scope is 'master', update the master surfaces to match the latest active workflow model even if that overwrites older master wording. Do not keep obsolete primary workflows or classifications just because they previously existed.
- If the current prompt-system model declares a single canonical main workflow, ensure the master run order reflects that explicitly and that other prompt packs are classified as supporting, bounded, standalone, or historical rather than also appearing primary.
- Apply required doc updates directly in _dev/prompts/ and related planning docs.
- Capture unmet expectations by writing: assembly report to _dev/reports/analysis/prompt-system-assembly.md and expectation-failure capture to _dev/reports/analysis/prompt-system-assembly.expectation-failures.json with scope, assembled_at, checked_files, and failures array.
- Validate the result: parse _dev/prompts/manifest.json, confirm every prompt-pack path referenced by the master run order exists, run npm run manifest:sync and npm run instructions:validate if command or canonical surfaces changed.
</process>

<success_criteria>
- Prompt-system inventory reconciled against manifest and master run order
- Reusable prompt packs registered correctly
- Run prompts linked correctly and excluded from reusable-pack registration
- Master run order references only real prompt-system files
- Expectation-failure capture written even when empty
- Validation commands run when command/canonical surfaces changed
</success_criteria>

<handoff>
assets_need_authoring: author-prompt-system all
successful_reconciliation: plan-pipeline
unresolved_failures: review-progress _dev/reports/analysis/prompt-system-assembly.md
not_yet_coherent: assemble-prompt-system all
</handoff>
