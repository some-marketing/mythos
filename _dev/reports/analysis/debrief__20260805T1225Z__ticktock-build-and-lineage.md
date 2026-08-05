# Debrief — /tt build, three review spines, and a lineage discovery

> Scope: system · 2026-08-05T12:25Z · Session 2a3e83da (Fable 5)
> Continues the 14h arc debriefed at 06:45Z; this covers 06:45Z → 12:25Z.

## What was pursued

Finish the liveness-gate plan through review, build `/ticktock` S0–S2, eliminate
the remaining unattended-run blockers, and get the work to the remote. The
operator's standing ask — `/tt 20` overnight — was the target the whole session
pointed at.

## What landed (all committed)

| Commit | What |
|---|---|
| `7c01b15b2` | credential resolver + preflight gate; remote-mutation checker 38→46; liveness & ticktock plan amendments |
| `11bc2230d` | untrack `.cache` (565 MB of model weights) |
| `57694ed44` | `/tt` S0+S1 — charter/journal/benchmark spine, 3 review defects repaired |
| `e6f80e9af` | torn-tail halt, append serialization, recursive dependency scan |
| `00f44e8d8` | lock owner validation, dynamic import census, hard-gate unlocked append |
| `9efa1ad30` | S2 — the skill, nine phases, honest preflight that refuses |
| `c743fa782` | (on clean lineage) cycle-1 artifacts carried over |

**PR #14** open against `main` from `feat/unattended-readiness-and-liveness-plan`.

## The lesson worth keeping: prose is not mechanism, and it recurs

The constitution's law — *guarantees live in mechanism, not prose* — broke **five
separate times** tonight, each time in a different disguise, each caught only by a
distinct-family reviewer:

1. **The liveness gate's `live` flag** computed from `dead_zero` alone, so evidence
   could report LIVE after a constant-or-duplicate check failed.
2. **The `INSUFFICIENT` category** — introduced *by the fix for (1)*, declared
   failing in prose, omitted from the boolean. The repair reproduced the defect it
   was written to close.
3. **The collinear allowlist** "gated by S3 review" — a promise, on a BLOCKING gate.
4. **The dependency census** claiming to cover computed imports it could not see.
5. **`pretooluse-live`** labeled BLOCKING while being a paragraph in a markdown file
   — and it is the property gating *unattended* operation.

**The generalizable countermeasure**, now encoded in the ticktock skill: a gate that
plausibly might apply but does not **must say so with its reason**. A silent
omission and a considered exclusion are indistinguishable to a reader, and that
indistinguishability is the vector. Applied as a nine-phase sweep, it found five
more instances of a defect reported as one.

**Second-order lesson**: the fix for a review finding is where the next finding
hides. Every repair round this session introduced at least one new defect, caught
only because the repair was itself reviewed. Producer-never-validates-own-trial is
not ceremony — the producer's fix is exactly as unverified as the original work.

## Falsified claims (mine, corrected)

- **Crash-window argument.** I accepted "append-then-anchor leaves the journal ahead,
  truncation leaves it behind, so they're distinguishable." Codex showed it holds
  *only* under a single-writer assumption nothing enforced. Now enforced by an
  O_EXCL lock, and the argument restated conditionally.
- **Corruption counts.** I wrote "20 chain errors, 10 duplicate indexes" into a
  commit message as though contractual. Three runs gave 8/4, 10/4, 10/5. Corruption
  reproduces; magnitude does not. Corrected in code, since the commit is immutable.
- **"The clean lineage has the things that matter."** Based on six files the handoff
  named. A full comparison found **658 source files** only on the fat branch,
  including `instructions/canonical/kernel/constitution.md`. My recommendation to
  abandon the branch was wrong and was withdrawn.

## The lineage discovery (the session's biggest structural finding)

`feat/harness-parity-constitution` **cannot be pushed to GitHub** — its history
tracks 264 blobs >10MB, 4.33 GB, and pushes fail HTTP 500. It is a **pre-surgery
lineage**: the 2026-08-04 trunk-canonicity surgery purged model caches and added
`.cache/` to `.gitignore`, but this branch never received it.

Critically, **the two lineages have no common ancestor** — the surgery rewrote
history from scratch, so the purged trunk is a separate repository that happens to
contain similar files. Consequences:

- `git merge` refuses outright; forcing an empty base produced an incoherent state
  (both `sm-os-remember` and `mythos-remember` present, constitution still absent).
  The worktree was reset; nothing was committed from that attempt.
- Neither branch is a superset: this one has the constitution and 658 source files;
  the clean one has the SM_OS→Mythos rename, `parity.yml`, and 283 files including
  192 under `instructions/canonical`.
- **There is no git operation that merges them.** Every differing file is a
  judgment call — new work, deliberately-dropped work, or half of a rename. The
  `sm-os-remember` / `mythos-remember` pair proves it: mechanically two unrelated
  files, only judgment says one supersedes the other.

**This needs its own `/plan-task` and its own review.** It was explicitly not
improvised. Full branch is backed up to `localmirror`
(the `localmirror` git remote — verified to resolve to an external volume with
ample free space; resolve its path locally with `git remote -v`, it is
deliberately not written here).

## Forbidden repeat actions

- **Do NOT tree-replay the fat branch onto the clean lineage.** It would silently
  revert the naming finalization and delete 1,135 files.
- **Do NOT `git merge --allow-unrelated-histories`** without a plan — observed to
  produce an incoherent half-state.
- **Do NOT run `git gc`** at current free space (2.8 GB); it needs room to write a
  new pack and the store is 13 GB.
- **Do NOT hand-write `.claude/commands/tt.md`.** The registry is the authority;
  a hand-made alias file forges provenance.
- **Do NOT `git add` broadly.** 3,984 dirty files belong to other sessions.

## Open gates (operator)

1. **Register G-REMOTE-MUTATION** — `/convene` + ConveneReceipt covering
   `tools/kernel/`. Until a live harness denial is observed and recorded,
   `/tt` refuses every remote-capable form.
2. **Land the `/tt` alias** — staged at `_dev/staged/ticktock-alias/`; needs the
   same perimeter gate for `instructions/canonical/command-aliases.yaml`.
3. **Disk** — 2.8 GB free of 460 GB. `.git` is 13 GB, `.cache` 3.5 GB (untracked,
   safe to clear, operator's data).
4. **The lineage port** — needs a plan.
5. **Two blocking gates shell out with no timeout** (`stamp-plan.js:363` Keychain
   read; `pretool-git-custody-gate.cjs:448-456,500-501`). An auth prompt there hangs
   an unattended run. Inside the convene perimeter.

## Plan/skill divergence to repair

`ticktock-skill__plan.md:154` and its `required_gates` entry still call
`pretooluse-live` "BLOCKING by design"; the skill now honestly says
`ADVISORY (module)`. The skill is right. Deliberately not edited by the
implementing worker — a producer quietly amending a reviewed plan to match its own
implementation is the failure this project exists to prevent.

## Evidence

184 tests passing across the ticktock spine (106 journal-anchor, 69 drift-notice,
9 hive-freeze), plus 11 manifest/preflight and 46 remote-mutation checker. Every
count re-run independently by the coordinator before commit, not taken from worker
self-reports. `/tt 20` verified to parse as 20 generations, remote-capable, exit 1.
