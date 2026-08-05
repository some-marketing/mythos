---
name: commit-to-remote-as-we-grow
description: "Operator 2026-08-05 — committing to the remote is a STANDING operation as work accumulates, not an end-of-session act; the clean-branch snapshot pattern is the vehicle"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a3e83da-becd-4845-b2de-1be1dca94142
  modified: 2026-08-05T05:19:27.398Z
---

Operator direction 2026-08-05T05:20Z: "and as always we commit this to the remote
as we grow. that's a standing operation now."

**Why:** Work that lives only locally is one crash from gone and invisible to
review; the remote is where growth becomes durable and shared. The night of
2026-08-04/05 proved the rhythm: local scoped commits per slice + snapshot pushes
to the clean branch (cherry-picks fail across the trunk divergence; final-state
checkout snapshots work).

**How to apply:** At every natural slice boundary (a gate cleared, a skill
authored, a matrix updated, a memory batch): commit locally with scoped paths on
the session branch AND snapshot to the clean remote branch
(feat/go-skill-orwell-boot-fix-20260804 until PR #13 merges; then its successor)
via the proven worktree pattern (custody rules: never touch the main worktree's
foreign files; secrets-scan before push; verify ls-remote sha). Don't batch a
whole night — grow the remote as the work grows. See
[[go-is-the-standing-posture]].
