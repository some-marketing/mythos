---
description: Group dirty files by workstream, propose scoped commits, clean stale artifacts
mode: REPO_HYGIENE
---

<objective>
Restore the working tree to a clean, trustworthy state by grouping uncommitted changes into scoped commits and removing confirmed-stale artifacts. This is repo hygiene — not a code review.
</objective>

<process>
- Run git status on the current branch. Collect all modified, added, deleted, and untracked files.
- CUSTODY SCOPING (mandatory before any commit proposal): Resolve the invoking session's custody set — the union of (a) the active session's write-ledger at _dev/state/active-sessions/<session_id>/write_log.json and (b) owned_artifacts listed in the active plan's scope_identity. Partition dirty files into three buckets: OWN (path appears in the custody set), FOREIGN (dirty but not in custody set and clearly owned by another workstream or session), UNKNOWN (no custody record). Expose FOREIGN files as out_of_custody_dirty — list them with their git status code but NEVER propose them for commit. UNKNOWN files may be surfaced for operator decision with an explicit note that custody is unconfirmed. Per orchestrate-loop invariant: 'global dirty worktree state is context, not ownership.' The git-custody gate (tools/hooks/pretool-git-custody-gate.cjs) is the mechanical backstop at commit time; this step is the proposer-side guard. If no session_id is resolvable, skip custody scoping, note the gap, and surface ALL dirty files to the operator as UNKNOWN (do not auto-propose any group).
- Group OWN (and operator-confirmed UNKNOWN) files by workstream using path prefixes: clients/{CODE}/ for client workstreams, .claude/commands/ .claude/skills/ .claude/agents/ for Mythos command infrastructure, .claude/settings.json .claude/project-claude.yml for Mythos config, frameworks/ for framework changes, _dev/reports/ _dev/logs/ for analysis and logging, _dev/concepts/ for concept documents, instructions/ for instruction changes, tools/ for tooling changes, and everything else as ungrouped for human review.
- For each group, produce a one-line summary of what changed and why, inferred from diffs.
- Identify stale artifacts: files marked as deleted in git status, signals/reports referencing completed or superseded work, artifacts that contradict current repo state.
- Present the proposed commit plan to the operator: one commit per workstream group, each with a clear commit message, stale deletions listed separately. Include a separate out_of_custody_dirty section listing FOREIGN files — these are surfaced as context only and must not appear in the commit plan.
- After operator approval, execute: stage and commit each group separately using git add with specific files (never git add -A), commit messages following repo convention, then run git status to verify clean state. For session handoff, closeout, debrief, lifecycle, or other cross-session provenance commits, include a `Host: <hostname -s>` trailer in the commit body.
- Report final state.
</process>

<success_criteria>
- git status shows a clean working tree or only files the operator explicitly deferred
- Each commit is scoped to one workstream
- No stale artifacts remain without explicit operator deferral
- No credentials, .env files, or sensitive data committed
</success_criteria>
