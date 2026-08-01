---
description: Scan, sanitize, and export a framework to the public repo in one guided command
mode: PATCH_ALLOWED
---

<objective>
Take a framework the user has added to the system and make it safely publishable in one motion: scan for publish-blockers (credentials, secrets, absolute paths, client data, operator names/hosts), auto-scrub the safe class, wire it into the export map, and export it through the hardened export-public pipeline with a clean-clone smoke — reporting a clear PUBLISH-READY or BLOCKED verdict. This composes with tools/export-public and tools/publish-framework; it does not hand-edit the public repo.
</objective>

<process>
- Resolve the framework path from arguments (e.g. `frameworks/wordpress/seo-audit`). If absent, ask which framework to publish.
- Run a DRY report first: `npm run publish-framework -- <framework-path>`. This writes nothing and is always safe.
- Read the report. If any `needs-human` findings exist, STOP and surface them to the user with file:line — these are credentials, secrets, or operator names/hosts that must be resolved by a human, never auto-altered. Do not proceed to --apply until they are gone.
- If the report flags `mock-candidate` files (real env/credential/state), help the user create a sanitized `<name>.example` and configure it as a mock in the export map, rather than shipping the real file.
- When the dry report is clean of `needs-human` items, run `npm run publish-framework -- <framework-path> --apply` to auto-scrub absolute paths, wire the export map, run the hardened export, and smoke-test the clean clone.
- Report the final verdict (PUBLISH-READY / BLOCKED) and the report artifact path. On PUBLISH-READY, the framework is exported and receipted; the public repo commit/push is a separate deliberate step.
</process>

<success_criteria>
- Dry report run before any --apply
- Every needs-human finding surfaced to the operator, never auto-resolved
- Framework wired into the export map idempotently (no duplicate unit)
- Export ran through tools/export-public (atomic + receipted) and the clean-clone smoke passed
- Final verdict and report artifact reported
</success_criteria>

<handoff>
publish_ready: review the export receipt, then commit + push the public repo
blocked_needs_human: resolve the listed credential/secret/name findings, then re-run
mock_candidate_found: author a sanitized .example and register it as a mock in the export map, then re-run
</handoff>
