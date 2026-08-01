---
description: Spin up a new public export target (themed or plain re-skin) from Mythos via the export-public pipeline
argument-hint: <target-name> [--repo <path>] [--remote <url>] [--theme "<direction>"]
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

<objective>
Create a new public export target: parameterized export map + denylist, staged surface,
composed-tree semantic gate, distinct-family review ladder, and an applied, live-verified
target repo — ending at operator gates (commit in target, push, visibility flip).
</objective>

<process>
1. Parse $ARGUMENTS for target name, repo path, remote URL, and optional theme direction.
2. Confirm the operator rulings up front: framework scope (which shipped set), vocabulary
   sources, and what stays private. Do not proceed on assumptions.
3. Read and follow the skill workflow:

@.claude/skills/new-export-target/SKILL.md

4. Route reviews through /dispatch-bridge → codex /review-progress with a written brief;
   repair via owning workers; re-review to CLEAR_FOR_APPLY (producer≠validator).
5. Stop at the operator gates: target-repo commit (custody gate is not repo-aware),
   push, public flip. Report evidence, never claim past a gate.
</process>

<success_criteria>
- Composed-tree gate CLEAR on all dimensions; distinct-family review CLEAR_FOR_APPLY
- Target repo installs, generates, validates, and passes setup smoke live
- Zero private tokens (precise-token membrane) in the applied tree
- Operator gates presented with truthful evidence
</success_criteria>
