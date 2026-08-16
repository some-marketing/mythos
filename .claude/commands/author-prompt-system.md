---
description: Author or update prompt packs and the master run order from _dev research and proposed flows
mode: PATCH_ALLOWED
---

<objective>
Turn prompt-system intent that exists only as _dev research, audits, planning docs, or proposed workflow notes into concrete prompt-system assets under tools/codex/prompt-system/ so later commands can reconcile and execute them deterministically.
</objective>

<process>
- Resolve scope from arguments: if empty or 'all', inspect full _dev/ prompt-system input surface; if 'master', focus on rewriting the current master workflow from latest repo truth rather than preserving stale historical wording; if a path, use that target plus related planning docs.
- Read the relevant _dev inputs: prompt-system sources in tools/codex/prompt-system/, analysis and audit material in _dev/reports/analysis/ and _dev/reports/audit/, planning docs such as whats-next.md and related _dev architecture or consideration notes, and proposed flow docs or design notes.
- Classify what needs to be authored or updated: reusable prompt packs (claude-prompt-pack-*.md), run prompts (claude-run-*.md), master sequencing doc (claude-master-run-order.md), and prompt manifest registration entries in tools/codex/prompt-system/manifest.json.
- Author the missing or stale prompt-system assets directly: derive reusable prompt packs from research/proposed flow inputs, author or update the master run order, keep one-shot run prompts separate from reusable prompt packs, preserve observational evidence-first language when source material includes open questions.
- When scope is 'master', treat the current repo state as authoritative over older master wording: replace stale primary-workflow declarations, rewrite obsolete top-level sequencing, and demote older flows to supporting, bounded, standalone, or historical status instead of preserving them as active by inertia.
- When the current repo state supports one canonical top-level workflow, make that explicit in the master run order and demote other reusable prompt packs to supporting, bounded, or historical status rather than leaving multiple competing 'primary' workflows.
- Capture prompt-authoring gaps by writing: authoring report to _dev/reports/analysis/prompt-system-authoring.md and expectation-failure capture to _dev/reports/analysis/prompt-system-authoring.expectation-failures.json with scope, authored_at, source_inputs, and failures array.
- Run follow-up reconciliation: ensure tools/codex/prompt-system/manifest.json registers each reusable prompt pack, ensure master-run-order references point only to real prompt-system files, run npm run manifest:sync and npm run instructions:validate if command or canonical surfaces changed, recommend assemble-prompt-system if separate cleanup is needed.
</process>

<success_criteria>
- New or updated prompt-system assets are authored from explicit _dev source material
- tools/codex/prompt-system/claude-master-run-order.md reflects the current authored stage flow when in scope
- Reusable prompt packs and run prompts remain correctly separated
- Prompt-authoring expectation-failure capture written even when empty
- Follow-up reconciliation guidance provided
</success_criteria>

<handoff>
successful_authoring: assemble-prompt-system all
source_too_contradictory: review-progress <source-path>
not_yet_reconciled: assemble-prompt-system all
</handoff>
