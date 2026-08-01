---
description: Fresh-session handoff wrapper — resolve a plan-id and invoke the orchestrate skill with a synthesized task description
mode: COORDINATOR
---

<objective>
Give the operator a one-shot fresh-session entry point that resolves any task plan (system or client scope), synthesizes a prose task description from the plan artifacts, and hands the work off to the orchestrate skill's native-first execution-shape selection. The wrapper is an ADAPTER — it translates structured plan fields into the verbal task shape the orchestrate skill's rubric-driven activation expects, because the orchestrate skill has no input contract and cannot consume plan JSON directly.
</objective>

<process>
- Resolve the target artifact from the argument via resolveTaskPlanPaths() from tools/planning/lib/resolve-task-plan.js. The resolver returns jsonPath, markdownPath, storageRoot, resolvedFrom (system|client|explicit-path), and clientCode. System-scope plans return clientCode null; client-scope plans return the client code. The wrapper handles both identically — there is no separate code path for system vs client, the difference is only carried through into the synthesized task description.
- If the resolver throws (ambiguous id found in multiple roots) or returns null (not found), stop and report the candidates or the miss. Do not guess which root the operator meant.
- Read both halves of the resolved plan — the JSON for structured fields (task_summary, scope_type, client_code, routing_expectations, bounded_plan) and the markdown for human-readable narrative context. Both feed the adapter.
- Run the ADAPTER — synthesize a prose task description the orchestrate skill can consume. The orchestrate skill's activation block and assess-task-shape step expect a verbal task shape, not a structured plan, so the wrapper must translate. The synthesis includes plan id + scope (system vs client, client_code if client), task summary (verbatim from plan.task_summary), routing expectations (risk_tier, review_lane, review_lane_rationale from plan.routing_expectations — these map directly onto the orchestrate skill's risk and verification rubric questions), bounded plan shape (ordered step ids + descriptions, required_gates, expected_outcomes — these map onto the skill's partitionability and actor-identity rubric questions), risk notes (verbatim from plan.bounded_plan.risk_notes), and the resolved artifact paths (jsonPath, markdownPath) so the skill can re-read on demand. The adapter must not invent context — every synthesized claim traces back to an explicit plan field.
- Before invoking the orchestrate skill, run the permission-envelope preflight (discover -> verify -> fail-fast). Envelope lookup order: plan.permission_envelope, else _dev/policies/envelopes/<task_id>.envelope.json. Invoke via npm run preflight:envelope -- --envelope <path> (or node tools/preflight/envelope-verify.cjs). If the envelope is declared and the verifier reports blockers, stop before writing the adapter artifact and report the precise blocker; do not proceed into downstream skill execution. Authority: _dev/policies/permission-envelope.md.
- Invoke the orchestrate skill via the Skill tool with the synthesized prose as the task description. The skill owns everything downstream — five-question execution-shape rubric, native-command routing, actor-identity list, coordination surface choice, delegation if needed, check-yoself, closeout.
- Execute the shape the skill chose. The orchestrate skill may route into /plan-task, /run-plan, /execute-plan, /dispatch-bridge, worker packets, or a single-threaded pass — the wrapper does not second-guess the choice.
- Report back to the operator with the resolved plan id + scope, the execution shape the skill chose, the native commands it routed through, and the closeout state (cycle-complete, ready-for-review, blocked, or ready-for-clear). Attribute explicitly ("orchestrate skill chose shape X"), do not paraphrase.
</process>

<success_criteria>
- Plan id resolved via resolveTaskPlanPaths() — works on system and client plans identically
- Both plan JSON and plan MD were read before invoking the skill
- A prose task description was synthesized from the plan's structured fields — plan JSON was NOT passed through directly
- The orchestrate skill was invoked with that synthesized description as the task context
- The operator sees which shape the skill chose and which native commands it routed through
- Ambiguous or missing plan ids stop the wrapper cleanly instead of guessing
- The scope_type distinction (system vs client) is preserved in the synthesized description so the skill's routing honors it
</success_criteria>

<handoff>
resolved_system_plan: Invoke orchestrate skill with synthesized task description; skill selects shape and routes
resolved_client_plan: Invoke orchestrate skill with synthesized task description including client_code; skill selects shape and routes
ambiguous_or_missing: Stop and report candidates or miss; ask operator to disambiguate
skill_chose_single_threaded: Execute directly through whatever native command the skill identified
skill_chose_delegated_or_bridge: Follow the skill's packet/bridge construction path; do not improvise
</handoff>
