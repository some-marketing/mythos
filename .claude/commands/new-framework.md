---
description: Create framework from intake or example
mode: PATCH_ALLOWED
---

<objective>
Create a new Mythos framework from scratch or from an example by collecting intake information, designing the prompt chain, scaffolding the full directory structure, generating all required files, and running post-creation validation and lifecycle hooks.
</objective>

<process>
- Parse arguments for framework path or name. If missing, prompt the user for framework purpose, service category, and scope.
- Prior-art lookup: before designing the framework, check three sources in order: (a) scan frameworks/ for existing frameworks with overlapping scope or reusable patterns, (b) read _dev/research/external-skills/marketingskills-classification.md for external skills classified as framework candidates, components, or reference material that match the target domain, (c) if a matching external skill exists, read its source SKILL.md and references/ under _dev/research/external-skills/marketingskills/skills/<name>/ to assess whether to distill from it, compose from existing components, or author from scratch. Record the prior-art decision (distilled, composed, or authored-from-scratch) with rationale.
- Design prompt chain: define the sequence of prompts needed for the framework workflow, including input/output contracts between steps.
- Create canonical spec: add instructions/canonical/frameworks/{service}/{name}.yaml with framework metadata.
- Create framework directory: scaffold frameworks/{service}/{name}/ from the framework template (frameworks/_template/skeleton/).
- Write manifest.json: define input/output contracts, execution config, prompt chain references, execution modes, and harness paths. If distilled from an external skill, include a distilled_from field with source, skill name, version, and license. If composed from existing patterns, include a related_external_skills array listing skills consulted.
- Generate prompt files: write numbered prompt files under prompts/ following the chain design.
- Create schemas: define JSON schemas for inputs (schemas/) and outputs (schemas/output/). If the framework produces bundles, create a bundle schema.
- Write guardrails: define framework-specific execution constraints in guardrails.md covering all declared execution modes.
- Create Claude integration layer: set up skills, commands, and agents under the framework's .claude/ directory.
- Generate harness files: run npm run instructions:generate to produce harness-specific instruction files.
- Sync manifest: run npm run manifest:sync to register the new framework in .claude/project-claude.yml.
- Validate: run audit-framework on the new framework, npm run instructions:validate, and npm run manifest:check. Gate on all files existing.
- Run completion audit: invoke the completion-auditor subagent with acceptance criteria (full directory scaffolded, canonical spec created, instruction files regenerated, manifest synced). If blocker-level findings, fix and re-run (maximum 2 reopen cycles).
- Run post-new lifecycle hooks: execute npm run lifecycle:hooks -- --profile post-new --framework-id <service/framework>. If any hook fails, report the failure and stop.
</process>

<success_criteria>
- Framework directory created with all required files under frameworks/{service}/{name}/
- manifest.json, guardrails.md, and prompt chain initialized
- Input and output schemas created
- Framework registered canonically in system.yaml
- Harness instruction files generated and validated
- Manifest synced and validated
- Completion audit passed or blockers resolved within 2 reopen cycles
- Post-new lifecycle hooks executed successfully
</success_criteria>

<handoff>
framework_created: audit-framework <framework-path> for verification
validation_failures: Fix failures and re-run validation
lifecycle_hook_failure: Fix hook issue and re-run lifecycle hooks
</handoff>
