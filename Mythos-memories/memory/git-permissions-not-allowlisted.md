---
name: git-permissions-not-allowlisted
description: Commits get denied by the auto-mode classifier because no git allow rules exist; the fix belongs in settings.local.json and only the operator can write it
metadata: 
  node_type: memory
  type: project
  originSessionId: 21036d30-763d-41c3-9072-a07a093e0dd5
  modified: 2026-07-30T14:57:16.659Z
---

`.claude/settings.local.json` allows `Bash(node *)` but no git rules, so every `git add`/`git commit` is judged by the auto-mode classifier and denied unpredictably — this is why commits kept needing operator `!` commands on 2026-07-30. Two related walls: `.claude/settings.json` is governance-gated (the PreToolUse hook demands a live ConveneReceipt/1.0), and the classifier blocks the assistant from editing its own permission files at all — correctly, since that would be self-granted escalation.

**Why:** permission changes must originate with the operator, and the project settings file is a doctrine surface.

**How to apply:** don't try to work around either wall. Hand the operator the exact `settings.local.json` content to apply via a `!` heredoc. Allowlist specific safe verbs (`git add`, `git commit`, `git status`, `git diff`, `git log`, `git show`) — never `git *`, which would sweep in `push`/`reset`/`checkout`; put those destructive verbs in `ask`. Note also that a subagent DID successfully write `settings.json`, so the convene gate appears to exempt subagents — a governance hole worth reporting rather than exploiting. Separately, auto-commit is off by operator directive (`_dev/state/kill-switches/auto-commit.off`) pending branch-canonicity S5; that switch, not permissions, is why sessions start with large dirty trees. Related: [[custody-grants-burn-on-classifier-denial]].
