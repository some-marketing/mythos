---
name: never-checkout-a-file-you-didnt-verify-clean
description: "git checkout -- <path> destroys uncommitted work irrecoverably; a custody warning means the file is MORE likely to hold another session's edits, not less"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c7d1278-0292-4071-932f-f733e234aa05
  modified: 2026-07-29T16:21:45.850Z
---

**On 2026-07-29 I destroyed another session's uncommitted work** by running `git checkout -- <paths>` to undo my own edits, without first checking whether those files were already dirty when I found them. They were. Session `ecf746ea` had uncommitted edits to `sdag-portal-dealer-loop-v2__plan.json/.md`, listed as `M` in the session-start git status. My revert discarded them.

**Uncommitted working-tree changes are not recoverable.** They never enter git's object store, so there are no dangling blobs — `git fsck --lost-found` returns nothing relevant. This is unlike a bad commit, which is always recoverable.

**The trigger was a custody-gate block, and I drew the wrong inference from it.** The gate refused my commit because the file belonged to another session. I treated that as "this isn't mine, tidy it away." The correct inference is the opposite: **a file owned by another session is MORE likely to be carrying that session's uncommitted work, not less.** A custody warning is a reason to leave the file completely alone, not a reason to reset it.

This also violated the invariant this same session had been quoting all day — *global dirty worktree state is context, not ownership*. I treated foreign dirty state as mine to clean.

**How to apply:**
1. Before ANY `git checkout --`, `git restore`, `git stash`, or `git reset` touching a path: run `git status --short -- <path>`. If it is dirty and you did not make all of that dirt yourself this session, STOP.
2. To undo only your own edits to a file that was already dirty, you cannot use checkout. Re-edit the specific lines back, or leave the change in place and explain it.
3. When a custody gate blocks a commit, the remedy is to surface it and request `smos-custody-grant` — never to revert, clean, or "tidy" the foreign path.
4. If you do destroy something: say so immediately, in plain terms, before continuing. Check `git fsck --lost-found` but do not expect recovery.

Related: [[autonomy-moves-through-gates-not-around-them]] — a gate firing is information about the world, not an obstacle to route around.
