---
name: canonical-path-authority-gate
description: >
  Activates before any irreversible filesystem relocation (mv/rename/delete of a
  directory that is or contains a repo checkout, working tree, or runtime-authority
  path), AND when authoring/reviewing any hook, launchd plist, or script that
  resolves a repo root (via __dirname, hardcoded absolute, $REPO_ROOT, git
  rev-parse, or env) and then mkdir/writes under it. Triggers on: "rename the
  checkout aside", "relocate", "move the repo", "mv <dir>", path-authority
  transfer, repoint launchd/hooks/settings, or editing files that compute
  PROJECT_ROOT/REPO_ROOT before a mkdir.
status: provisional
graduation_criteria: >
  Promote to `established` only after 3 independent operator-approved firings where
  the gate either (a) caught a real foreign-session/quiescence violation before an
  irreversible move, or (b) caught a stale/hardcoded root that would have
  mkdir-recreated outside the canonical root — with operator confirming in each
  case the catch was correct (no false-positive that blocked a safe move). Minimum
  quality bar: zero instances of the gate being bypassed "to save time" in the
  evidence window. Graduation is explicit operator action; never drafted in.
---

<role>
This skill prevents split-brain from path authority resolved against a stale,
hardcoded, or `__dirname`-relative root instead of one canonical source. It
encodes two near-misses from `repo-recovery-path-authority-s5s6-relocation`
(2026-05-19), unified by one root cause:

1. An irreversible `mv` was about to run while foreign live sessions (a 2nd Claude
   Code session + an IDE) were cwd-rooted under the target — the inventory modeled
   only known writers, not concurrent sessions.
2. Hook writers (`hook-telemetry.cjs`, `posttool-hook-create-task.sh`) `mkdir -p`
   their log dir before writing, so a stale-root resolution silently recreated the
   old path tree instead of failing loud. `mkdir -p` never ENOENTs — fail-closed
   relocation is a fiction for directory-ensure writers.

The failure mode prevented: an irreversible path operation that appears verified
but leaves a silent split-brain because something resolved an old/stale root that
no inventory caught and no error surfaced.
</role>

<process>
When activated, run the applicable branch:

**A. Irreversible relocation branch** (mv/rename/delete of a checkout / worktree /
runtime-authority dir):
1. Resolve the absolute target. Run `lsof +D <target>` AND `lsof <target>` (cwd
   handles) AND a `ps`/cwd sweep for the target literal.
2. Classify every holder: launchd/known-writer (expected, handled by the plan) vs
   FOREIGN (other Claude/Codex sessions, IDEs, shells, editors). OS read-only
   transient indexers (mdworker/Spotlight) are not writers — note, don't block on.
3. If ANY foreign live process holds the target: NAME each (pid, identity, cwd,
   started) and STOP. Do not `mv`/delete under a live foreign process. Surface to
   the operator for explicit clearance; re-run step 1–3 after they clear it; only
   proceed on a clean gate.
4. Verify the executor itself is not rooted under the target (`pwd -P`).
5. Proceed only when the gate is clean; keep the no-erasure discipline (rename
   aside, never delete).

**B. Root-resolution authoring/review branch** (hook/plist/script computing a repo
root then writing):
1. Identify how the root is resolved: `__dirname`-relative, hardcoded absolute,
   `$REPO_ROOT`/`git rev-parse`, or env.
2. Require it to resolve through ONE canonical source (the Mythos guard/env, e.g.
   the SessionStart guard's CANONICAL or a single env var) — not a per-file
   re-derivation.
3. Require the writer to REFUSE to `mkdir`/write if the resolved root is outside
   the canonical root (fail loud — explicit error/exit), instead of `mkdir -p`
   silently recreating a stale tree.
4. Flag any `mkdir -p` / `ensureDir` that runs before a root-validity check as a
   silent-recreation hazard.
</process>

<anti_patterns>
- Do not skip the `lsof` gate "because the plan already inventoried writers" — the
  plan inventories *known* writers; the gate exists for the *unmodeled* ones.
- Do not treat `mkdir -p` success as proof the path is correct — it is the exact
  mechanism that hides a stale root.
- Do not delete a stale-recreated path to "clean up" before the root cause is
  found — deletion masks recurrence (no-erasure).
- Do not auto-clear a foreign session yourself; name it and let the operator
  decide. Do not proceed on an ambiguous "go ahead" past a fence the operator set.
- Do not promote this skill autonomously or relax `status: provisional`.
</anti_patterns>

<success_criteria>
- Before any in-scope irreversible move, an `lsof`/cwd gate ran and is clean of
  foreign processes (or the move was halted with named holders).
- Any in-scope root-resolution writer either resolves through the canonical source
  or is flagged as a silent-recreation hazard with a fail-loud fix recommended.
- No irreversible move proceeded under a live foreign process.
- The skill proposed; it did not install or graduate itself.
</success_criteria>

<notes_for_future_operator>
Anchored on memory `canonical-path-authority-gate` (the evidence trail:
`env-path-hardening` signal + s8 verification + acceptance-ratification artifact
from the 2026-05-19 path-authority relocation). This is the lead deliverable of
the `env-path-hardening` follow-on.

Tuning: the description's relocation triggers are deliberately broad (irreversible
moves are rare and high-cost — false loads are cheap). The root-resolution branch
is the one to tighten if it loads on every hook edit; narrow it to "edits a file
that mkdir/writes under a computed root" if noisy.

Constitutional-surface: graduation to `established` is operator-only, gated on the
`graduation_criteria` evidence. The staging→`.claude/skills/` move is operator-only.
Do not lower the 3-firing bar; an irreversible-operation guard that graduates on
thin evidence is worse than no guard, because it manufactures false confidence —
the precise failure this skill was extracted to prevent.
</notes_for_future_operator>
