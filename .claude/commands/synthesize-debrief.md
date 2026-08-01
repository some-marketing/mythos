---
description: Synthesize actor-specific debriefs and lifecycle evidence into one workstream-level closeout truth artifact
mode: PATCH_ALLOWED
---

<objective>
Produce a bounded debrief synthesis for a multi-actor workstream. The synthesis consumes actor debriefs, plan and amendment truth, live signal truth, validation artifacts, and operator gates, then writes JSON and Markdown artifacts that /next-session can preserve without flattening constraints.
</objective>

<process>
- Resolve the target scope from the positional argument. If missing, block with usage guidance.
- Read actor debrief artifacts matching _dev/reports/analysis/debrief-actor__<scope>__<actor-id>__<timestamp>.json.
- Read plan and amendment truth for the scope when a task plan exists. Include plan path, task id, exact next command, amendment ids, plan_still_executable values, and amendment next commands.
- Read live HandoffSignal/1.0 files for the same workflow scope. Treat live blocked signals as blocked truth and live review signals as in_review truth.
- Read validation artifacts for the scope, including review-task-plan, verify-local, Claude/Codex last-message, and bridge-run artifacts when present.
- Extract operator gates from plan required_gates and explicit signal blocked_by values. Preserve them as constraints; do not satisfy them inside this command.
- Write _dev/reports/analysis/debrief-synthesis__<scope>__<timestamp>.json with the DebriefSynthesis/1.0 schema.
- Write _dev/reports/analysis/debrief-synthesis__<scope>__<timestamp>.md as a human-readable rendering of the same fields.
- Report written paths and the recommended next command. Do not execute that command.
</process>

<success_criteria>
- Synthesis JSON and Markdown are written for the requested scope
- Actor debriefs are listed as inputs, not treated as final workstream truth
- Live signals and blocked_by reasons are preserved as constraints
- Operator gates are preserved
- Recommended next command is constrained by live signal or amendment truth when present
- Command performs no plan mutation, signal closure, or follow-on execution
</success_criteria>

<handoff>
synthesis_written: /next-session --system or /next-session --client CODE may consume the synthesis truth
missing_actor_debriefs: Write actor debriefs with /debrief-run --actor <actor> <scope> before relying on synthesis for clear-readiness
live_signals_remain: Route through the live signal's recommended_next_command before claiming clear-readiness
</handoff>
