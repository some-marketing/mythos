---
description: Compatibility cross-alias for /guild-ledger
allowed-tools: [Read, Glob, Grep]
---

<objective>
Run `/guild-ledger`. `aura` is a cross-alias (an aura-read of the guild's state); the full command body lives under the primary mythic name.
</objective>

<process>
1. Follow `.claude/commands/guild-ledger.md`.
</process>

<success_criteria>
- `/aura` resolves to the same behavior as `/guild-ledger`
</success_criteria>
