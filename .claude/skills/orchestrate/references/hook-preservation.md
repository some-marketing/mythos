# Hook preservation rules

Native hooks enforce the governance model. The orchestrator must not bypass them for speed, convenience, or to route around a failing check.

## Active hook surfaces

From `.claude/settings.json`:

| Event | Matcher | Purpose | What it protects |
|---|---|---|---|
| `SessionStart` | — | Credential verification via `node tools/boot/verify-credentials.cjs` | Proves live auth and tool readiness before a session proceeds |
| `PreToolUse` | `Agent` | Subagent delegation guardrail reminder | Guardrails.md §6: "No recursive spawning. A subagent must not spawn its own subagents. Only the top-level orchestrator may create subagents." |
| `PreToolUse` | `Bash` | Dangerous command detector (rm -rf, git push --force, DROP TABLE, etc.) | 12 high-risk destructive patterns blocked/warned before execution |
| `PreToolUse` | `Bash` | Git-commit debrief reminder | Rule 8: debrief required before commit. Writes to `_dev/reports/analysis/` or plan artifact |
| `PreToolUse` | `EnterPlanMode` | Routing-document policy reminder | Plans must route through `tools/planning/assess-similarity.js` and `tools/signals/follow-signal.js`, not freestanding stages |
| `PostToolUse` | `Write\|Edit` | Framework manifest sync | Triggers `npm run manifest:sync` when a `/frameworks/` file changes |
| `PostToolUse` | `Write` | `tools/verify/visual-review-gate.cjs` | Blocks Write completion if visual review declared but no screenshot evidence exists |
| `PostToolUse` | `Write\|Edit` | `tools/planning/hooks/post-write-task-plan.cjs` | Warns on mutable fixture sources, wrong handoff verb, or missing pass-ordering evidence on task-plan writes |
| `PostToolUse` | `Write\|Edit` | `tools/planning/hooks/post-write-delegate-check.cjs` | Verifies delegation artifacts and spawn-proof expectations on write/edit completion |
| `Stop` | — | `tools/planning/hooks/stop-suggest-debrief.cjs` | Reminds the operator when planning work in the session lacks a matching debrief closeout |
| `UserPromptSubmit` | — | `tools/planning/hooks/prompt-submit-plan-verb-guard.cjs` | Blocks `/run-plan` vs `/execute-plan` inverse mistakes before execution starts |

## Verification and lifecycle hooks

These are not event-triggered harness hooks, but they enforce governance and must be run (not bypassed) at their designated points:

- **`tools/verify/verify-system.cjs`** — Mythos system integrity (manifest, guardrails presence)
- **`tools/verify/verify-framework.cjs <id>`** — single framework deep validation
- **`tools/verify/verify-guardrails.cjs`** — guardrails section presence and structure
- **`tools/verify/verify-skill.cjs`** — SKILL.md deep validation (contract fields, prompt housing)
- **`tools/verify/verify-run-evidence.cjs`** — test run environment completeness
- **`tools/verify/verify-kernel.cjs`** — kernel manifest paths resolution
- **`tools/framework-lifecycle/hook-runner.js`** — deterministic tail-hook runner for framework lifecycle (post-new, post-scaffold, post-improve, post-promote)

All verify scripts emit `VerificationSignal/1.0` JSON with `gate_decision.proceed` boolean. Cite that signal in closing HandoffSignals.

## Scheduled hook-equivalents (launchd agents)

Only services registered in `tools/launchd/services.json` are portable
authorities. Install one by ID through `tools/launchd/install.sh <service-id>`;
obsolete private board-scanner and landing-pad jobs are intentionally not
shipped and must not be inferred from historical documentation.

Do not block or disable these. If they produce stale signals, run `/normalize-signals` rather than stopping the runner.

## Doctrine

Portable hook doctrine:

> "**hooks may validate, refresh, and report — hooks must not silently promote**"

The inverse is also binding: **orchestrators must not silently bypass**. If a hook blocks an action, diagnose the underlying cause rather than routing around it.

## Anti-patterns (never do these)

- Calling a tool with a wrapper specifically chosen to skip a hook matcher
- Running `git commit` through a path that bypasses the debrief reminder
- Skipping `tools/verify/*.cjs` because "the last run passed"
- Stopping a launchd runner because it produced a noisy log — fix the runner, don't silence it
- Composing a parallel signal format to avoid the governance of HandoffSignal/1.0
- Recursively spawning subagents from within a subagent to parallelize further
- Routing a Write action around the visual-review-gate because screenshots are slow

## When a hook blocks you

1. Read the hook's output — it usually names the missing evidence or unsafe pattern
2. Produce the evidence or fix the pattern
3. Retry through the same native path
4. If the hook is genuinely wrong, file the issue; do not bypass in the meantime

## Named failure mode

From session debrief `_dev/reports/analysis/run-debrief__system-enforcement-parity__2026-04-07.replicate-plan.json`:

> "Break enforcement upgrades into single-surface slices (one schema, one gate, one validator per slice). Each slice touches ≤3 files, runs verify after, then check-yoself reviews the batch. 8 slices, 3 defects caught by review, zero defects escaped."

Tight hook + verify coupling prevents defects from propagating. The orchestrator preserves this coupling by never skipping the verify run between slices.
