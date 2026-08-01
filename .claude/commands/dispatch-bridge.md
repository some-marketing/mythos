---
description: Create a first-class HandoffSignal/1.0 handoff for a distinct target actor and optionally launch the managed bridge runner immediately.
mode: COORDINATOR
---

<objective>
Provide the canonical actor-bridge dispatch surface: validate a distinct source/target handoff, write the prompt and signal artifacts, close any superseded live signals at the same scope, and optionally invoke the target lane's signal-aware runner so the bridge moves beyond handoff preparation when capability exists.
</objective>

<process>
- Normalize source, target, task summary, command, context list, and requested scope; reject unsupported targets, empty inputs, same-source-and-target dispatches, and commands that do not start with '/' (unless target is a freeform target).
- Derive the stable signal scope when --scope is omitted, choose the target runner by actor id, and resolve all context artifacts relative to the project root with outside-root paths blocked.
- Close any prior live signals at the resolved scope before writing the new handoff so the live signal surface stays unique per scope.
- Write the dispatch prompt body to _dev/reports/analysis/dispatch-bridge-prompt__<scope-safe>.md. For freeform targets with omitted commands, normalize the command to 'freeform' in the prompt and signal.
- Create a HandoffSignal/1.0 artifact that names the target actor, exact command, prompt artifact, decision-context artifacts, task summary, local_task_state=pending_bridge, and dispatch runner id.
- Validate the signal structurally before publishing it to _dev/reports/signals/dispatch-bridge__<timestamp>__<scope-safe>.signal.json.
- Write durable JSON and markdown dispatch-result artifacts under _dev/reports/analysis/dispatch-bridge__<timestamp>__<scope-safe>.*.
- When --run-now is present and the target runner exists, invoke the signal-aware runner with --file <signal-name> --json, capture its result as dispatch_result, and update the dispatch_status truthfully.
- Emit bridge-dispatched telemetry with target, scope, and signal_path so bridge launch is visible in the shared hook telemetry stream.
</process>

<success_criteria>
- The handoff is represented by a truthful HandoffSignal/1.0 plus a dispatch prompt artifact with no command substitution.
- The dispatch result captures whether the handoff is pending_bridge, pending_manual_runner, or an executed/blocked runner outcome rather than implying success.
- The live signal surface remains unique at the resolved scope because superseded signals are closed first.
- Operator ceremony is not added when dispatch is mechanically determined and safe; --run-now exists to advance the bridge automatically when the runner is available.
- Telemetry and durable artifacts provide enough evidence to audit who dispatched what, to whom, under which scope, and with which exact command.
</success_criteria>
