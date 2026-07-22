---
description: "Integrate a deterministic dreaming engine — 7-stage prompt chain"
argument-hint: "<corpus-config-path>"
allowed-tools: Read, Write, Edit, Bash, Grep
---

## Objective

Run the full dreaming system integration framework: assess the knowledge corpus, build the deterministic associative engine, wire it into session lifecycle, surface non-obvious dream associations, schedule periodic rebuilds, and add entity persistence for simulated entities.

## Process

1. Read the input configuration file at `$ARGUMENTS` (or use defaults).
2. Invoke the framework skill at `@frameworks/meta/dreaming-system/.claude/skills/dreaming-system/integrate/SKILL.md`.
3. Execute the 7-stage prompt chain in strict order.
4. Verify each stage against its gates before proceeding.
5. Produce the consolidated verification evidence artifact.

## Success Criteria

- [ ] All 7 prompt stages executed
- [ ] All stage gates pass
- [ ] Verification evidence written to `reports/dreaming-system/archive/<name>/verify-evidence.json`
