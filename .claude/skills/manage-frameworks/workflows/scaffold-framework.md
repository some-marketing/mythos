# Scaffold Framework Workflow

## Steps

1. **[USER] Select captures** — Provide a project root plus one or more capture IDs. Captures may be normalized or un-normalized.

### Auto-Normalization (Parallel)

2. **[AUTO] Validate and auto-normalize captures** — For each capture ID provided:
   a. Check if the capture is already normalized (`CAPTURE_META.json` with `normalized: true` or `ready_for_scaffold: true`)
   b. For any un-normalized captures, spawn parallel `capture-normalizer` subagents (one per capture, `mode: "auto"`)
   c. Each subagent runs: `npm run workspace:capture:normalize -- --capture <capture-root>`
   d. Wait for all normalizer subagents to complete
   e. If any normalization fails, report which captures failed and their specific missing fields. Stop and ask the user to fix them.
   f. If all pass, proceed to scaffolding.

| Subagent | Agent | Mode | Tools | Scope |
|---|---|---|---|---|
| Per-capture normalizer | `capture-normalizer` | `auto` | Read, Bash, Grep, Glob | One capture bundle |

### Prior-Art Lookup

3. **[AUTO] Check external skill sources** — Before extracting structure:
   a. Read `_dev/research/external-skills/marketingskills-classification.md` for skills matching the target service category or domain
   b. If a match exists, read the source SKILL.md and `references/` under `_dev/research/external-skills/marketingskills/skills/<name>/`
   c. Use matching external skills alongside capture data to inform the scaffold
   d. Record what was consulted and whether the scaffold distills, composes, or is purely from captures

### Scaffolding

4. **[AUTO] Extract stable structure** — Aggregate repeated steps, decision hints, and variable inputs across the captures. Cross-reference with any external skill material from step 3.
5. **[AUTO] Create candidate root** — Scaffold `framework_candidates/<service>__<framework>/`.
6. **[AUTO] Copy sanitized evidence** — Copy only normalized capture artifacts into `evidence/`.
7. **[AUTO] Generate `proposed_framework/`** — Write a draft manifest, prompt chain, schemas, guardrails, templates, and local `.claude/` assets. If distilled from an external skill, include `distilled_from` in manifest.json. If external skills were consulted, include `related_external_skills`.
8. **[AUTO] Seed replay cases** — Create an example replay case and candidate metadata.

## Post-Workflow Hooks

9. **[AUTO] Run lifecycle hooks** — Execute the `post-scaffold` hook chain:
    ```
    npm run lifecycle:hooks -- --profile post-scaffold --candidate-root <candidate-root>
    ```
    This runs deterministic tail work: system verification and next-actions artifact generation. If any hook fails, report the failure and stop. Do not silently skip hook failures.

    These hooks do NOT promote the candidate. Promotion requires explicit user action.

### Post-Scaffold Parallel Validation

10. **[AUTO] Launch parallel validation** — After scaffolding and lifecycle hooks complete, spawn two subagents simultaneously:

   | Subagent | Agent | Mode | Tools | Scope |
   |---|---|---|---|---|
   | Structure audit | `framework-auditor` | `auto` | Read, Grep, Glob | Audit `proposed_framework/` structure |
   | Replay readiness | `framework-auditor` | `auto` | Read, Grep, Glob | Run replay-readiness checks on seeded cases |

   - Subagent 1 audits the proposed framework structure (manifest, prompts, schemas, guardrails, Claude assets)
   - Subagent 2 checks replay-readiness of the seeded replay cases (case.json validity, input substance, structural completeness)

11. **[AUTO] Present consolidated readiness report** — Merge results from both validation subagents:
    - Structure audit: PASS/FAIL with specific findings
    - Replay readiness: N/M cases ready, with specific blockers
    - Promotion blockers: consolidated list
    - Ready to promote: YES/NO

12. **[GATE: user decides] Promotion decision** — Present the readiness report and ask the user whether to proceed with promotion. Do not auto-promote. The user may choose to:
    - Promote now (invoke promote-framework workflow)
    - Fix issues first and re-run validation
    - Defer promotion

## Output

- Framework candidate under `framework_candidates/`
- Draft `proposed_framework/`
- Initial `candidate.json`
- Lifecycle hook artifacts in `_dev/reports/lifecycle/`
- Consolidated readiness report (structure audit + replay readiness)
