---
name: plan-task
description: >
  Plan a bounded operational approach for a real task by comparing it to
  hardened Mythos frameworks. Use when the operator has a new task and wants
  to understand which framework fits, what gaps exist, and what gates apply.
version: 1.0.0
execution_mode: REVIEW_ONLY
trust_tier: report_write_scoped
---

<skill>
<objective>
Take a real incoming task (from Dart, operator, or signal), compare it to hardened Mythos frameworks, and produce a bounded operational plan that identifies what matches existing frameworks, what is a gap, and what gates/checkers apply. This is REVIEW_ONLY — it proposes, it does not execute.
</objective>

<quick_start>
1. Capture task description and context from the operator
2. Run `node tools/planning/assess-similarity.js --task "<description>" [--client CODE] --json`
2b. Run `node tools/planning/check-existing-work.js --task "<description>" --json` — the don't-duplicate + coordinate-with-background-track gate. If `has_overlap` is true, surface the highest-scoring owning plan(s) and recent in-flight signal/dispatch activity, and PREFER `/amend-plan` on the owning plan over authoring a parallel one. Authoring a new plan despite a strong owning match needs an explicit stated reason.
3. **Expand with lived context** — dispatch parallel subagent searches for related completed work, memory feedback, stored credentials/tools, site-specific tooling, recent debrief findings. The similarity engine output is ONE input, not the whole answer. Text-similarity returning low scores is a signal to go broader, not narrower.
4. Review top framework matches AND the lived-context findings with operator
5. Generate bounded plan mapping task steps to framework prompt chain steps
6. **If the task is system-level** (edits skills, frameworks, commands, agents, instructions, planning tools, or harness behavior), run `/ground-in-philosophy` against the plan via the `philosophy-grounding` subagent before writing artifacts
7. If the task came from Dart, draft the linked-task writeback payload
8. Write plan artifact to `_dev/reports/analysis/task-plans/` or `clients/{CODE}/plans/`
9. Present for operator review — approve, modify, or reject. Include grounding report if one was produced.
</quick_start>

<activation>
Use when the operator has a new task and wants to understand:
- Which existing framework(s) are closest
- What parts of the task map to existing prompt chains
- What parts are gaps requiring manual work or new skills
- What trust tier and gates apply
- Whether the outcome should harden a framework
</activation>

<process>
<step name="capture-context">
Gather from the operator:
- Task description (what needs to be done)
- Client code (if applicable)
- Project ID (if applicable)
- Source (dart task, operator request, signal)
- Linked Dart task ID or triage artifact path when applicable
- Any urgency or constraint notes
</step>

<step name="run-similarity">
Execute the similarity engine:
```bash
node tools/planning/assess-similarity.js --task "<description>" [--client CODE] --json
```
Review the output: ranked framework matches with scores, rationale, gaps, applicable modes, `task_patterns`, `pattern_matches`, and `broadening_recommendation`.

**The similarity engine is still bounded evidence.** It scores by description overlap, domain tags, execution modes, and concrete workflow-pattern tags. It cannot see: related completed work, proven patterns from memory, stored credentials, site-specific tooling, debrief findings. The engine output is ONE input to the assessment, not the whole answer. When `broadening_recommendation.triggered` is true, present the scored top matches and broader workflow-pattern matches separately before accepting weak no-match routing. Pattern matches widen inspection; they do not create certainty.
</step>

<step name="check-existing-work">
Detect whether an existing task-plan already OWNS this scope, and whether another actor (especially the background automation track) has recently dispatched or raised signals for it:
```bash
node tools/planning/check-existing-work.js --task "<description>" --json
```
`assess-similarity` answers "which FRAMEWORK fits"; this answers "does a PLAN already exist and is anyone already working it." When `has_overlap` is true, prefer `/amend-plan` on the highest-scoring owning plan and reconcile with any in-flight `recent_activity` dispatches BEFORE authoring a parallel plan — authoring anyway requires an explicit stated reason. This is the mechanical form of the don't-duplicate lesson; a strong owning match that is ignored is exactly how parallel/divergent plans get created.

**`has_overlap` is tri-state:** `true` (overlap — prefer amend), `false` (no keyword overlap — but the keyword check is blind to non-obvious cross-domain links, so still consult the expand-with-lived-context step), and `null` (UNCERTAIN — the plan library could not be scanned; do NOT treat as clear). Honor `warnings[]` (e.g. too-short query). A `null` or short-query result must not be read as a clearance.

**PROBATIONARY (per the Automation Doctrine promotion rule):** this gate's evidence basis is a single observed incident (run-debrief rep-2). For its first ~3 invocations, note whether it added value or fired false positives; evaluate retain/tune/demote at the 3rd. It is advisory by design until repeated-success evidence accrues — do not let it harden into an unquestioned block.
</step>

<step name="expand-with-lived-context">
Dispatch parallel subagent searches to pull in the context the similarity engine cannot see. This step is mandatory — do not skip it even when the engine returns a high-scoring match.

Launch parallel Explore subagents for:
1. **Related completed work** — search `_dev/reports/analysis/task-outcomes/`, `_dev/reports/analysis/run-debrief__*`, and `clients/*/plans/*__plan.json` for tasks that solved an adjacent problem (possibly at a different client). Report the top 3 by structural similarity.
2. **Memory feedback touching the same technical surface** — search `${HOME}/.claude/projects/{PROJECT_SLUG}/memory/` for feedback files whose descriptions match the task domain (WP, GTM, ad platforms, browser automation, etc.). Report which lessons apply.
3. **Stored credentials and tool availability** — check `clients/{CODE}/secrets/`, `_dev/auth/`, and known MCP tools for whether the task already has the access it needs. Report yes/no with path.
4. **Site-specific tooling** — if the task touches a specific site (WP, Shopify, Breakdance, etc.), search `tools/` for existing libraries and scripts that target that surface. Report the proven patterns.
5. **Recent debrief findings from the same domain** — read the most recent 3 run-debrief files under `_dev/reports/analysis/` that touch the same domain. Report the findings that apply.

Do this in ONE message with multiple Task tool calls. Speed matters — the operator is waiting.

After the parallel searches return, synthesize the findings into a "lived context report" that will be presented alongside the similarity engine results. Name explicit connections:
- "This task is structurally the same as [completed task X] at [other client]"
- "Memory feedback [file] applies because [reason]"
- "Credentials exist at [path], no auth gate"
- "Proven pattern [pattern] is available via [tool path]"
- "Recent debrief [file] found [finding] which bears on this"

If the expanded context reveals that the task is actually closer to a different framework match than the engine returned, or that automation is possible where manual work was planned, ADJUST the assessment. The lived context can override the engine.
</step>

<step name="consume-component-matches">
**PROBATIONARY — advisory only** (plan composable-framework-substrate S5; convene 20260611T190347Z; exits probation only by explicit operator decision after 3 composed runs carry debrief evidence).

The similarity output now includes `component_matches`: cross-framework components ranked by idf-weighted fuzzy matching, each carrying basis, transfer distance (use-as-is / moderate-tweak / pattern-only), thin-evidence marker, and lineage.

Rules:
- Present component matches ALONGSIDE the framework matches — never instead of, never suppressing the top whole-framework recommendation. Both granularities are always shown; the operator weighs them.
- A composition (assembling several matched components for a task no single framework covers) is a PROPOSAL in the plan. `use-as-is` labels never self-execute. Thin-evidence matches are presented as pattern-only regardless of label.
- Pull each used component's lineage baggage (parent manifest, guardrails, preconditions, evidence obligations) into the plan — components are retrieval units, not detached authority.
- When a composed run executes, write a composition manifest to `_dev/reports/analysis/compositions/` per `composition-manifest.schema.json`: components+basis, tweaks (ISOLATED — never written back to framework manifests), matcher_misses (components you used that the matcher did not surface), human_glue, omitted_preconditions, outcome — including failed/abandoned runs.
- Surface any probationary composition whose task_shape matches the current task: name it and its probation count in the plan output (active surfacing — passive directories decay).
</step>

<step name="check-external-skills">
If no strong framework match (score below threshold) or significant gaps exist:
1. Read `_dev/research/external-skills/marketingskills-classification.md`
2. Check if any classified framework candidates or components match the task domain
3. If a match exists, read the source SKILL.md under `_dev/research/external-skills/marketingskills/skills/<name>/`
4. Report the external skill as a distillation option alongside framework matches

This enables the operator to choose:
- Use an existing framework (if match is strong)
- Distill an external skill into a new framework first (if no match but skill exists)
- Author from scratch (if neither covers the domain)
</step>

<step name="review-matches">
Present the top 1-3 framework matches. For each:
- Framework ID and description
- Match score and rationale
- What parts of the task are covered
- What parts are gaps
- What execution modes apply

If external skills were found in the prior step, also present:
- External skill name and classification (candidate/component/reference)
- What it covers relative to the task
- Recommended action: distill first, use as reference, or skip

Ask the operator to confirm or redirect the match.
</step>

<step name="generate-plan">
For the confirmed framework match:
1. Map task steps to framework prompt chain steps where possible
2. Mark steps that are gaps (no framework coverage)
3. Include required gates from the matched framework's guardrails
4. Include trust-tier assessment for each step
5. Note any hardening opportunity (should the outcome strengthen the framework?)
6. If the task involves URL replacement or link migration, recommend a full-site crawl (curl + grep across all pages) as a pre-execution step to build a complete inventory — blog posts and inline links are easily missed without this
7. Assign explicit routing expectations for `/run-plan`:
   - `risk_tier`: `low`, `medium`, or `high`
   - `review_lane`: `verify-local`, `codex-bridge`, or `operator-gate`
   - `review_lane_rationale`: why that lane is expected
   - `escalation_triggers`: optional triggers that should force a higher review lane

Use these rules:
- `verify-local` only for low-risk, small, single-surface, repo-local slices with no credential dependency, no browser-auth dependency, no staging/production mutation, and no launch-critical or external-account impact
- `codex-bridge` for cross-surface, launch-critical, staging/production-facing, browser-admin or credential-dependent, or otherwise medium/high-risk slices
- `operator-gate` when human judgment, approval, or inaccessible credentials are the true blocker

For plans that will be operator-facing or client-facing, populate the optional
step-level audience fields when a step needs a different explanation for the
owner versus the executor:

- `domain`: source domain for the step when `framework_step` is not enough to infer it
- `stage` / `stage_title`: visible grouping in step-level diagrams
- `depends_on`: explicit step dependencies when sequence is not strictly linear
- `audiences.owner.what` / `audiences.owner.why`
- `audiences.media_buyer.what` / `audiences.media_buyer.why`

Each `what` and `why` item should use the nested provenance shape:

```json
{
  "text": "This is intended to show the source-plan claim in reader language.",
  "provenance_handle": "bounded_plan.steps.S1.description",
  "source_field": "description",
  "provenance_state": "authored"
}
```

Use observational wording (`intended to`, `the hypothesis is`, `appears to`,
`consistent with`) when explaining causal, evaluative, financial, or approval
claims. Do not add names, numbers, causal claims, or expected outcomes that are
not already present in the source plan. If the fields are missing, the offline
enrichment tool may fill source-derived placeholders, but authored fields are
preferred when the operator will read the plan before approving execution.
</step>

<step name="philosophy-ground-system-level">
**This step fires ONLY for system-level tasks.** A task is system-level if it proposes changes to any of:
- `.claude/skills/`, `.claude/commands/`, `.claude/agents/` (harness behavior)
- `frameworks/*/manifest.json`, `frameworks/*/guardrails.md`, `frameworks/*/prompts/` (framework behavior)
- `instructions/canonical/`, `instructions/README.md` (canonical rules)
- `tools/planning/`, `tools/ai-bridge/`, `tools/research/` (planning tools)
- `CLAUDE.md` files at any level
- Any file under `_dev/concepts/` (doctrine documents)

If the task is purely client work (plans under `clients/*/plans/`, artifacts under `clients/*/projects/`, ad copy, content edits, etc.), skip this step.

For system-level tasks:
1. Invoke the `philosophy-grounding` subagent via the Task tool with subagent_type `philosophy-grounding`
2. Pass the proposed bounded plan as the change under review
3. The subagent reads the reading list (grounding-patterns.md, canonical guardrails, doctrine docs, memory), applies all 16 checks, runs the disconfirmation pass, and returns an alignment report
4. Display the subagent's report IN FULL alongside the bounded plan
5. Do NOT treat the grounding report as a blocker — it surfaces tensions, the operator decides
6. If the verdict is `misaligned` or `needs-adjustment`, name the top adjustments and ask the operator whether to revise the plan before writing artifacts
7. If the verdict is `uncertain`, gather what's needed to resolve and re-run

The philosophy-grounding subagent exists because text-similarity matching cannot see the operator's epistemic framework, and because "does this change honor the philosophy" is a separate question from "does this match a framework." Both must be answered before a system-level plan lands.

### Complexity Concentration Law answer

The canonical guardrails require that a new operator-facing step be offset by removing or automating an equal-frequency step. This step and the preceding `expand-with-lived-context` step jointly satisfy that rule by automating two kinds of work the operator was previously doing manually in conversation:

1. **Manual lived-context gathering.** Before `expand-with-lived-context`, when the similarity engine returned a low-scoring match, the operator had to re-inject context mid-conversation (related completed work, memory feedback, stored credentials, site-specific tooling, recent debrief findings). This was a recurring operator-facing cognitive step that fired on almost every planning task. It is now automated.

2. **Manual ad-hoc grounding checks.** Before `philosophy-ground-system-level`, the operator had to notice when a proposed plan or skill edit drifted from the grounding philosophy and correct the drift mid-conversation. The correction work was carried by the operator, with the system merely receiving the corrections. This is now automated into a read-only subagent that the operator can review rather than produce.

Net effect: the system file structure gains two steps, but the operator's working cognitive load loses two recurring tasks of higher frequency. The Complexity Concentration Law is honored at the operator-cognition level, not at the file-structure level. This is a deliberate trade and is recorded here so future operators can see it was a conscious decision rather than an oversight.

### Probationary period

**This integration is probationary for its first 3 invocations.** During the probation:

- The operator reads each grounding report in full, not just the verdict
- After each invocation, the operator explicitly notes whether the grounding step added value or was ceremony
- At the end of the 3rd invocation, the operator decides durably whether:
  - The step stays integrated into plan-task (promote to permanent)
  - The step becomes manual-only via `/ground-in-philosophy` (demote to on-demand)
  - The step is revised based on lived experience with the reports (iterate)

The probation decision is recorded at `_dev/research/{OPERATOR_NAME}-philosophy/grounding-subagent-probation-decision.md` after the 3rd invocation.

Rationale: the Learning and Automation Doctrine requires that automation be promoted only after repeated trustworthy success. This subagent has zero prior runs. The probationary period is how we honor the doctrine while still getting the subagent into the live path to gather the evidence needed to evaluate it.
</step>

<step name="write-artifacts">
Write the plan to `_dev/reports/analysis/task-plans/{task-id}__plan.json` conforming to the task intake schema at `tools/planning/task-intake.schema.json`.

Also write a human-readable summary to `_dev/reports/analysis/task-plans/{task-id}__plan.md`.

The plan artifacts must include the routing expectations explicitly so `/run-plan` does not need to infer them from scratch.

If the task came from Dart or a linked client-board triage report, include a writeback section that contains:
- the linked task identifier when known
- a 1-3 sentence planning summary suitable for a Dart comment or description update
- the matched framework and why it was chosen
- whether the item should remain a Brief, become subtasks, become an Owner-Summary tree, or stay in clarification
  - Choose **Owner-Summary tree** for multi-person client deliverables: 2+ contributors, or 1 contributor plus a distinct owner/stakeholder audience. This proposes the 3-level `owner_summary` -> `for_grouping` -> implementation workspace that `tools/dart-integration/create-tasks-from-workspace.js` builds (live reference: `clients/{CLIENT_CODE}/projects/homenet-replacement/tasks/`). REVIEW_ONLY — propose the shape only; do not create the tree.
- the exact next command after operator approval
</step>

<step name="present-for-review">
Present the plan to the operator with clear sections:
- Matched framework: which framework and why
- Covered steps: what the framework handles
- Gap steps: what needs manual work or new skills
- Required gates: what must pass before work is accepted
- Expected outcomes: what success looks like
- Hardening opportunity: should the outcome improve the framework?
- Risk notes: what could go wrong
- Review lane: `verify-local`, `codex-bridge`, or `operator-gate`, with rationale

The operator can approve, modify, or reject. Approved plans can be executed via `/run-plan`, which routes task plans and prompt plans to the correct executor.
</step>
</process>

<output_artifacts>
- `_dev/reports/analysis/task-plans/{task-id}__plan.json` — structured plan
- `_dev/reports/analysis/task-plans/{task-id}__plan.md` — human-readable summary
- optional linked-task writeback payload embedded in the plan artifacts when the task originated from Dart
</output_artifacts>

<success_criteria>
- Similarity assessment ran and returned ranked results
- Top match was reviewed with operator
- Plan artifact is valid JSON conforming to task-intake.schema.json
- Covered/gap classification is non-empty for every plan step
- Plan artifact written with covered/gap/gate classification
- Plan artifact includes explicit `risk_tier` and `review_lane` routing expectations
- Operator had opportunity to approve, modify, or reject
</success_criteria>

<boundaries>
- Does NOT execute the plan (that requires explicit operator authorization)
- Does NOT create new frameworks or skills (that is Workstream E)
- Does NOT modify existing framework files
- Does NOT skip the operator review step
</boundaries>
</skill>
