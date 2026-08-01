---
description: Resolve and verify the exact next command authorized by a live signal or approved task plan
mode: COORDINATOR
---

<objective>
Provide the autonomy gate for Mythos by resolving exactly one authority surface, validating that it is safe and unambiguous, returning the exact authorized next command, and blocking truthfully when authority is stale, invalid, ambiguous, or not yet provable.
</objective>

<process>
- Resolve exactly one authority surface using this order: explicit signal file, explicit signal scope, explicit task plan, explicit actor-targeted live signal.
- If resolution leaves zero or more than one candidate, stop in blocked state and report the exact ambiguity or missing authority.
- For coordination signals, validate schema, lifecycle state, artifact references, signal uniqueness, timestamp, actor targeting, and that recommended_next_command is an exact slash command.
- Treat live blocked signals as authoritative blocked state, not as executable authorization.
- For task plans, validate the task-intake schema, matching markdown summary, and exact derived /run-plan command. If durable approval cannot be proven from repo truth, block instead of guessing that the plan is approved.
- When --execute is requested and authority resolves to allowed, upgrade status to 'executed'. The Claude agent should then run the exact_command from the decision artifact without substitution.
- Write durable decision artifacts under _dev/reports/analysis/ for every invocation: one JSON artifact and one markdown summary.
- When --allow-override provides a non-empty reason on a blocked decision, upgrade to 'override-allowed' (or 'override-executed' with --execute). Record the override reason and original blocked state in the decision artifact. Override decisions must never masquerade as signal-authorized.
</process>

<success_criteria>
- Exactly one authority surface is selected or the command blocks truthfully
- Allowed output preserves the exact authorized command with no substitution
- Blocked output names the invalid or ambiguous artifact and, when possible, the exact recovery command
- Execution occurs only when status is 'executed' or 'override-executed'; missing approval metadata is never hidden
- Durable decision artifacts are written for every run
</success_criteria>

<handoff>
allowed_signal_authority: run the exact slash command returned by the decision artifact
duplicate_live_signals: normalize-signals <signal-scope>
task_plan_missing_approval_proof: review-task-plan <task-id>
no_authority_surface: mythos-status
</handoff>
