---
description: Scaffold a framework candidate from captures
mode: PATCH_ALLOWED
---

<objective>
Generate a framework candidate with a draft proposed_framework/ directory from one or more normalized capture bundles, running auto-normalization for any un-normalized captures, then validate the scaffolded candidate with parallel audits.
</objective>

<process>
- Parse arguments for project root, capture IDs (comma-separated), service category (--service), and framework name (--name). If required arguments are missing, prompt the user.
- Validate and auto-normalize captures: for each capture ID, check if already normalized (CAPTURE_META.json with normalized or ready_for_scaffold flags). For un-normalized captures, spawn parallel capture-normalizer subagents (one per capture). If any normalization fails, report which captures failed with their specific missing fields and stop.
- Prior-art lookup: before extracting structure, check for external skill material that matches the target domain. Read _dev/research/external-skills/marketingskills-classification.md for skills classified as framework candidates or components matching the service category or domain. If a match exists, read the source SKILL.md and references/ under _dev/research/external-skills/marketingskills/skills/<name>/ and use it alongside capture data to inform the scaffold. Record what prior art was consulted and whether the scaffold distills from an external skill, composes from existing patterns, or is authored purely from captures.
- Extract stable structure: aggregate repeated steps, decision hints, and variable inputs across all normalized captures to identify the common workflow pattern. Cross-reference with any external skill material identified in the prior-art lookup.
- Create the candidate root directory: scaffold framework_candidates/<service>__<framework>/ with the standard candidate directory structure.
- Copy sanitized evidence: copy only normalized capture artifacts into the candidate evidence/ directory, stripping any client-specific data.
- Generate proposed_framework/: write a draft manifest.json, prompt chain files, JSON schemas (input and output), guardrails.md, templates, and local .claude/ assets (skills, commands, agents). If distilled from an external skill, include a distilled_from field in manifest.json with source, skill name, version, and license. If external skills were consulted, include a related_external_skills array.
- Seed replay cases: create an example replay case with case.json and candidate metadata (candidate.json).
- Run post-scaffold lifecycle hooks: execute npm run lifecycle:hooks -- --profile post-scaffold --candidate-root <candidate-root>. These hooks run system verification and generate a next-actions artifact. If any hook fails, report the failure and stop.
- Launch parallel validation: spawn two framework-auditor subagents simultaneously -- one to audit the proposed_framework/ structure and one to check replay-readiness of seeded cases.
- Present consolidated readiness report: merge results from both validation subagents showing structure audit pass/fail, replay readiness counts, promotion blockers, and overall ready-to-promote status.
- Gate: present the readiness report and ask the user whether to proceed with promotion, fix issues first, or defer.
</process>

<success_criteria>
- All captures normalized before scaffolding proceeds
- Framework candidate directory created under framework_candidates/
- Draft proposed_framework/ generated with manifest, prompts, schemas, and guardrails
- Replay cases seeded with valid case.json
- Post-scaffold lifecycle hooks executed successfully
- Parallel validation (structure audit + replay readiness) completed
- Consolidated readiness report presented to user
</success_criteria>

<handoff>
ready_to_promote: promote-framework <candidate-root>
issues_found: Fix issues and re-run scaffold or validation
check_status: candidate-status <candidate-root>
replay_needed: replay-framework <candidate-root>
</handoff>
