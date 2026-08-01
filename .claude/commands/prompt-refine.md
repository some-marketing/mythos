---
description: Rewrite a rough development prompt into an Mythos-aware prompt and route it through native command surfaces
mode: REVIEW_ONLY
---

<objective>
Provide an opt-in prompt-refinement surface for coding, review, debugging, documentation, tooling, repository-maintenance, and Mythos system-work requests. The command improves the operator's rough request by grounding it in current repo authority, then returns the refined prompt plus the exact native next command. It does not execute implementation by default, create a framework, or install a persistent knowledgebase.
</objective>

<process>
- Preserve the operator's rough prompt verbatim as source input.
- Read the closest applicable authority surfaces before refinement: direct conversation instructions, local AGENTS.md or CLAUDE.md guidance, canonical command specs, task plans/signals when referenced, and relevant source files or package/config files.
- Search existing Mythos commands, skills, frameworks, tools, and task plans for overlap before proposing a new mechanism.
- Rewrite the prompt into a concrete Mythos-aware prompt with Current State, Question / Work, Desired State, constraints, owned surfaces, forbidden surfaces, evidence expectations, and verification route.
- Choose the native route that should receive the refined prompt: /plan-task, /run-plan, /orchestrate-loop, /review-task-plan, /capture-task, /new-framework, /extract-skill, or another canonical command. If no native route fits, say so and keep the output as a prompt proposal.
- Do not execute implementation by default. If execution is already approved by a durable plan/signal, route through that native command rather than acting from the refined prompt directly.
- Do not create or trust a persistent derived knowledgebase in v1. If repeated use proves a cache is warranted, require a separate task plan with freshness, authority-order, and privacy gates.
- Never store secrets, PII, .env values, client-specific data, or long source excerpts in prompt-refinement artifacts.
- If the operator asks to promote the skill as a framework, refuse direct promotion and route to /capture-task only after repeated successful runs provide evidence.
</process>

<success_criteria>
- Rough prompt preserved
- Relevant repo authority checked before refinement
- Existing-work overlap checked before new surfaces are proposed
- Refined prompt includes Current State, Question / Work, Desired State, constraints, evidence, and verification expectations
- Native next command selected or uncertainty reported
- No implementation executed by default
- No persistent cache or framework promotion introduced
</success_criteria>

<handoff>
ready_to_plan: /plan-task --scope <system|client> <refined-task>
ready_to_run: /run-plan <approved-plan-id>
needs_orchestration: /orchestrate-loop <target>
needs_plan_review: /review-task-plan <task-id>
repeatable_pattern_observed: /capture-task <source> <project-root> --task-type prompt-refinement
framework_candidate_after_repetition: /scaffold-framework <project-root> <capture-id> --service meta --name prompt-context-refinement
</handoff>
