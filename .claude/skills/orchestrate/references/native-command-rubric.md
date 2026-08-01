# Native-command-first decision rubric

The orchestrator routes through native commands BEFORE inventing ad-hoc flows. This reference names each command, what it owns, and when to invoke.

## The canonical chain

```
/plan-task  →  /run-plan  →  /execute-plan  →  /review-progress  →  /debrief-run  →  /normalize-signals
                                     ↓                ↓
                                /amend-plan     /follow-signal (autonomy gate)
```

- **/plan-task** — starts the loop. Produces a bounded task plan with `risk_tier` and `review_lane`.
- **/run-plan** — primary executor-router. Resolves the plan artifact and routes to the correct execution pathway (verify-local, codex-bridge, or operator-gate). May write a HandoffSignal/1.0.
- **/execute-plan** — strict executor for compatible prompt plans. Runs one stage at a time using the seven-step orchestration pattern. Writes a HandoffSignal/1.0 after every stage for Codex review.
- **/follow-signal** — autonomy gate. Resolves exactly one authority surface (signal or approved task plan) and authorizes the next command verbatim. Zero substitution.
- **/review-progress** — evidence-first assessment of mid-run output quality. Identifies blocker-level misses and drift.
- **/amend-plan** — records material divergence between plan assumptions and execution reality. Preserves the original plan as baseline.
- **/debrief-run** — evaluates completed execution slices, produces improve-plan and replicate-plan. Mandatory closeout evidence before declaring `complete`.
- **/normalize-signals** — audits the live signal surface for staleness, duplicates, and broken artifact references. Closes closable signals.

## When to invoke each

| Situation | Command |
|---|---|
| Operator hands you a new task description | `/plan-task` |
| A plan artifact already exists and needs execution | `/run-plan <plan-id>` |
| You are mid-execution on a multi-stage prompt plan | `/execute-plan <stage-id>` |
| A HandoffSignal is live and you need to know the next command | `/follow-signal <signal-scope|--file path> --execute` |
| Midway through a slice, you need to check whether progress is real | `/review-progress` |
| Execution reality has diverged from plan assumptions | `/amend-plan` |
| A slice is finished and you want to close it truthfully | `/debrief-run` |
| Live signal surface has accumulated stale or duplicate entries | `/normalize-signals` |

## The command-first decision tree

Before hand-rolling any orchestration behavior, ask in order:

1. **Is there a native command for this action?** If yes, invoke it.
2. **Is there a native skill that owns the lane?** See `native-skill-composition.md`. If yes, defer to or compose with it.
3. **Is there a native signal/bridge flow that already handles the handoff?** If yes, route through it.
4. **Is there a native hook that enforces the gate?** See `hook-preservation.md`. Do not bypass.
5. **Only after 1–4 are exhausted**, reach for worker packets or ad-hoc bridge prompts.

## Anti-patterns

- Writing a HandoffSignal by hand when `/run-plan` or `/execute-plan` would produce one as a side effect
- Declaring a slice `complete` without running `/debrief-run`
- Acting on a stale signal without running `/follow-signal` first
- Carrying scope divergence silently instead of running `/amend-plan`
- Accumulating live signals instead of periodically running `/normalize-signals`
- Dispatching a delegated worker when `/execute-plan` would run the same stage natively

## Spec references

All canonical command specs live under `instructions/canonical/commands/`:
- `instructions/canonical/commands/plan-task.yaml`
- `instructions/canonical/commands/run-plan.yaml`
- `instructions/canonical/commands/execute-plan.yaml`
- `instructions/canonical/commands/follow-signal.yaml`
- `instructions/canonical/commands/review-progress.yaml`
- `instructions/canonical/commands/amend-plan.yaml`
- `instructions/canonical/commands/debrief-run.yaml`
- `instructions/canonical/commands/normalize-signals.yaml`

Read the spec before invoking a command for the first time. Route expectations and closeout states live in the spec, not in memory.
