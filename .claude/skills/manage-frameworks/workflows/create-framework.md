# Create Framework Workflow

## Steps

1. **[USER] Intake** — Collect framework purpose, service category, and scope
2. **[AUTO] Prior-art lookup** — Before designing, check three sources in order:
   a. Scan `frameworks/` for existing frameworks with overlapping scope or reusable patterns
   b. Read `_dev/research/external-skills/marketingskills-classification.md` for external skills matching the target domain
   c. If a match exists, read the source SKILL.md and `references/` under `_dev/research/external-skills/marketingskills/skills/<name>/`
   d. Decide: **distill** from external skill, **compose** from existing patterns, or **author from scratch**
   e. Record the decision and rationale in the framework's manifest.json (`distilled_from` or `related_external_skills` field)
3. **[AUTO] Research** — Scan existing frameworks for prompt chain designs and schema conventions to reuse
3. **[AUTO] Design prompt chain** — Define the sequence of prompts needed
4. **[AUTO] Create canonical spec** — Add `instructions/canonical/frameworks/{service}/{name}.yaml`
5. **[AUTO] Create directory** — Scaffold `frameworks/{service}/{name}/` from template
6. **[AUTO] Write manifest.json** — Define input/output contracts and execution config
7. **[AUTO] Generate prompts** — Write numbered prompt files following chain design
8. **[AUTO] Create schemas** — Define JSON schemas for inputs AND outputs.
   - Input schemas in schemas/
   - Output schemas in schemas/output/
   - If the framework produces bundles, create a bundle schema
9. **[AUTO] Write guardrails** — Define framework-specific execution constraints
10. **[AUTO] Create skills/commands/agents** — Wire up the Claude Code integration layer
11. **[AUTO] Generate harness files** — Run `npm run instructions:generate`
12. **[AUTO] Sync manifest** — Run `npm run manifest:sync` to register the new framework in `.claude/project-claude.yml`
13. **[GATE: all files exist] Validate** — Run audit-framework, `npm run instructions:validate`, and `npm run manifest:check`

## Completion Audit

14. **[AUTO] Run completion audit** — Invoke the `completion-auditor` subagent with:
    - **acceptance_criteria**: Full directory scaffolded under `frameworks/`, canonical spec created, instruction files regenerated, manifest synced
    - **changed_files**: All files created during framework creation
    - **non_goals**: Client-specific customization (framework must remain generic)
    - **validation_results**: Output of `npm run instructions:validate`, `npm run manifest:check`, and `npm run manifest:validate` from step 13 (full stdout/stderr, not just pass/fail)
15. **[GATE: blockers found] Reopen** — If the completion audit returns blocker-level findings, fix only the specific unmet items and re-run (maximum 2 reopen cycles). If blockers persist, escalate to user.

## Post-Workflow Hooks

16. **[AUTO] Run lifecycle hooks** — Execute the `post-new` hook chain:
    ```
    npm run lifecycle:hooks -- --profile post-new --framework-id <service/framework>
    ```
    This runs deterministic tail work: instruction regeneration, manifest sync, validation, framework verification, system verification, and next-actions artifact generation. If any hook fails, report the failure and stop. Do not silently skip hook failures.

## References
- Framework anatomy: `references/framework-anatomy.md`
- Prompt patterns: `references/prompt-chain-patterns.md`
- Template: `frameworks/_template/skeleton/`
