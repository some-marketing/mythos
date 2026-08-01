# Native-skill / native-system composition rules

The orchestrator composes with existing repo-local skills. It does NOT replace them. This reference maps each adjacent skill to a composition handle.

## Composition table

| Skill | Owns | Orchestration handle |
|---|---|---|
| `plan-task` | Task assessment, framework similarity, bounded plan generation with routing metadata (`risk_tier`, `review_lane`) | **defer-to** — invoke `/plan-task` when routing new work; do not duplicate planning logic |
| `execute-framework` | Prompt chain execution with guardrail enforcement, gate handling, output validation | **compose-with** — call `execute-framework` to run declared framework work; this is a direct dependency |
| `clean-house` | Repo hygiene: grouped commits, scoped commit proposals, stale-artifact detection, clean tree enforcement | **defer-to** — invoke `/clean-house` post-execution; do not duplicate hygiene logic |
| `extract-skill` | Conversation-to-skill extraction: analyzes past work, generates new SKILL.md + commands + agents | **not-overlapping** — operates on past work; orchestration is forward-looking. Compose only when the orchestrated run should be captured as a new skill |
| `manage-frameworks` | Full framework lifecycle: capture, normalize, scaffold, replay, promote, audit, improve | **defer-to** — route framework evolution tasks to `/manage-frameworks`; do not duplicate |
| `manage-clients` | Client registry and project scaffolding | **not-overlapping** — static metadata, separate lane |
| `ad-copy-development` | Meta ad copy lifecycle | **not-overlapping** — vertical domain skill |

## The gap the orchestrate skill fills

`plan-task` produces the score. The frameworks produce the work. `clean-house` closes the tree. But nothing owns the dynamic conductor between planning and execution:

1. **Execution routing** — taking an approved plan's `risk_tier` and `review_lane` and dispatching to the right executor (native command, subagent, operator-manual, etc.)
2. **Precondition enforcement** — verifying credentials, environment state, auth before handoff
3. **Execution monitoring & gate handling** — watching for gate conditions, pausing for operator input, resuming
4. **Outcome capture** — collecting execution outputs and routing to hardening/normalization lanes
5. **Post-execution sequencing** — routing to `/clean-house`, `/debrief-run`, and optional `extract-skill` / `improve-framework`

This is the lane the orchestrate skill owns. Everything else is already owned.

## Composition rules

- **Never duplicate** — if a skill owns a lane, defer or compose. Check this table before writing new process logic.
- **Invoke via the Skill tool** — when composing with another skill, use the `Skill` tool directly rather than re-implementing the skill's behavior.
- **Do not pull a skill's internals into your prompt** — treat each skill as a black box addressed by name.
- **Do not bypass a skill for speed** — if a skill owns the lane and is slow, the fix is to improve the skill, not to route around it.

## Anti-patterns

- Re-implementing similarity scoring instead of calling `/plan-task`
- Running framework prompts by hand instead of `execute-framework`
- Writing custom commit grouping instead of `/clean-house`
- Inventing a "lessons log" instead of `/debrief-run`
- Rolling a new signal format instead of reusing HandoffSignal/1.0
- Composing with a skill's internals rather than its public interface

## When a skill is missing

If orchestration reveals a lane that no skill owns AND the same lane will be needed again:
1. Complete the current orchestration loop first
2. Capture the pattern via `capture-task` or direct debrief notes
3. Propose a new skill via `extract-skill`
4. Do NOT author a skill mid-orchestration — that is scope widening
