---
description: Run a multi-source outward-inward Mythos improvement loop
argument-hint: <source-1> <source-2> [source-N...] --purpose "..."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

> Canonical contract: `instructions/canonical/commands/outward-inward.yaml`. This command is a thin entry point; `.claude/skills/outward-inward-loop/SKILL.md` supplies phase guidance without widening canonical authority or write gates.

Run `.claude/skills/outward-inward-loop/SKILL.md` with two or more source arguments and an explicit purpose. Default to `FINDINGS_ONLY`; require an explicit `PATCH_ALLOWED` choice before changing repository files.
