# Promotion record — finding-repair-loop

Status: STAGED. The operator is the ratification gate. Nothing here has been
registered in canonical surfaces. Move the artifacts below to live paths and
add the prepared manifest entries ONLY on operator approval.

## Staged artifacts (proposal location)

- Skill:        `_dev/staging/skills/finding-repair-loop/SKILL.md`
- Command:      `_dev/staging/commands/finding-repair-loop.md`
- Agent:        `_dev/staging/agents/finding-repair-loop-agent.md`
- Verification: `_dev/staging/skills/finding-repair-loop/verify-finding-repair-loop.cjs`

## Promotion moves (operator-run)

1. `mv _dev/staging/skills/finding-repair-loop .claude/skills/finding-repair-loop`
2. `mv _dev/staging/commands/finding-repair-loop.md .claude/commands/finding-repair-loop.md`
3. `mv _dev/staging/agents/finding-repair-loop-agent.md .claude/agents/finding-repair-loop-agent.md`
4. Optionally relocate `verify-finding-repair-loop.cjs` into `tools/verify/` (rewire any
   self-contained signal emit to your project's shared signal helper, if you have one).
5. Remove the `status: STAGED` frontmatter lines from SKILL.md, command, and agent.
6. Add the prepared manifest entries below.
7. Run your project's skill-verification check against the promoted SKILL.md, then
   whatever manifest-sync / manifest-check commands your project uses.

## Prepared canonical manifest entries (do NOT add until promoted)

`instructions/canonical/system.yaml` -> `operations[]`:

```json
{
  "id": "finding-repair-loop",
  "description": "Close one distinct-family review iteration on a task plan: classify findings, fold repairs into the paired plan JSON+MD, write a PlanRepair manifest, and re-dispatch or escalate",
  "mode": "PATCH_ALLOWED"
}
```

`instructions/canonical/system.yaml` -> `agents[]`:

```json
{
  "id": "finding-repair-loop-agent",
  "purpose": "Coordinator subagent that executes a single distinct-family review/repair iteration without per-iteration operator narration"
}
```

A canonical command spec at `instructions/canonical/commands/finding-repair-loop.yaml`
should be authored on promotion (the Claude command .md is an adapter output of that
spec per system.yaml command_specs policy). Until then the staged command .md stands alone.

## Dependency gate

This skill assumes your project already has:
- a paired plan JSON+MD authoring convention (see `.claude/commands/repair-plan.md`'s
  PlanRepair schema for the shape this skill writes)
- a state marker surface at `_dev/state/plan-task-review-state/<task-id>.json`
- a bridge-dispatch mechanism to hand a scope off to a distinct-family reviewer and
  get a reviewer-run artifact back

If any of those don't exist yet, run `/plan-task` to build them before promoting this
skill — it has nothing to close the loop on without them.
