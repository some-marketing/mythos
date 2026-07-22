# Staging — pre-promotion essences and commands

Staging is where a new skill, command, or agent lives while it's proven but not yet trusted enough to auto-activate. Nothing under here is wired into `.claude/` — it activates only when the operator explicitly invokes it, and it graduates only on explicit operator promotion (see each bundle's `PROMOTION.md`).

## Bundle shape

Every staged bundle follows the same three-piece shape:

- `agents/<name>-agent.md` — the subagent definition, if the skill needs one
- `commands/<name>.md` — the slash-command entry point
- `skills/<name>/SKILL.md` — the full skill body: objective, activation triggers, execution rules, decision logic, success criteria, safety rules
- `skills/<name>/PROMOTION.md` — the exact move commands, the prepared canonical manifest entries, and any dependency gate that must be satisfied before this can go live
- `skills/<name>/verify-*.cjs` — a bounded, read-only verification script for whatever artifact the skill produces, so promotion isn't just vibes

## `finding-repair-loop/`

This bundle is the worked example: a coordinator-facing skill that closes the inner loop of a review cycle. When a distinct-family reviewer (a reviewing mind from outside the authoring lineage — never the same mind that wrote the plan) returns findings, this skill classifies them, folds the foldable ones into the plan text, writes a manifest recording exactly what changed and why, and re-dispatches or escalates. It replaces several turns of manual narration with one bounded, auditable operation.

"Distinct-family reviewer" is the generic stand-in here for whatever your own project's non-self review mechanism is — a different model family, a different vendor, a human. The load-bearing rule is not which reviewer you use, it's that a producer never validates its own acceptance-grade outcome.

Read `skills/finding-repair-loop/SKILL.md` for the full decision tree, then `skills/finding-repair-loop/PROMOTION.md` for what it takes to move this from staged to live.

## What isn't here

A second staged bundle in the source repo this was ported from — a client-facing image-scouting skill — was excluded. It named a client-code argument and a specific paid stock-image workflow, neither of which belongs in a public-destined bench. Its absence is intentional.
