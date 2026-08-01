# Topology and Path Authority (canonical)

> Canonical source. Regenerated previews (CLAUDE.md / AGENTS.md) read from here.
> Authored 2026-05-19 from the repo-recovery-path-authority-s5s6-relocation
> workstream + env-path-hardening slice. Additive; do not delete without
> operator review and documented rationale.

## Rule TPA-1 — Runtime authority never on an iCloud-synced path

Runtime authority (the launchd agents, Claude harness hooks/settings, `.mcp.json`,
and any binding a scheduled or hook-fired process resolves) MUST NOT resolve to a
path under an iCloud-synced location (`~/Documents`, `~/Desktop`, or any
`com.apple.bird`/`ubiquity`-backed directory). iCloud sync re-materializes,
relocates, and partially evicts inodes underneath live processes — the failure
class that produced the 2026-05 object-graph damage and the post-relocation
silent path resurrection.

**Why:** an iCloud-resident runtime root is non-sovereign — the substrate can
move out from under a running process. Topological sovereignty requires the
runtime root to be on a non-synced local volume.

## Rule TPA-2 — One canonical root source; resolve, validate, fail loud

Any hook/script that computes a repo root and then `mkdir`/writes under it MUST
resolve through the single canonical source (`tools/lib/canonical-root.cjs` for
Node, `tools/lib/repo-root.sh` for shell), never `process.cwd()`, never a
runtime-cwd fallback, never a hardcoded absolute. The resolved root MUST be
anchor-validated (`instructions/canonical/`, `.git`, `package.json`) before any
`mkdir`. An invalid root MUST fail loud (throw / non-zero), never `mkdir -p`
silently — `mkdir -p` never ENOENTs, which is precisely how a stale root
silently resurrects an abandoned path.

## Rule TPA-3 — Pre-rename quiescence gate (no irreversible move under a live process)

Before any irreversible directory relocation (`mv`/rename/delete of a checkout,
worktree, or runtime-authority path), an `lsof +D <target>` (+ cwd sweep) MUST
show zero foreign live processes (other Claude/Codex sessions, IDEs, shells)
rooted under the target. Foreign holders are named and the move halts until the
operator clears them. OS read-only indexers (Spotlight `mdworker`) are noted,
not blocking.

## Enforcement shape (this is not documentation-only)

1. **Plan-artifact precondition.** Any task/prompt plan whose scope includes an
   irreversible directory relocation MUST declare a `relocation_preflight` block
   in its plan JSON: `{ lsof_clean: <bool asserted at execution>, canonical_root_anchors: [...], no_erasure: true }`. A relocation plan lacking this block is
   incomplete; `/run-plan` MUST NOT execute a relocation step from it and MUST
   route back to `/amend-plan` to add the block.
2. **Moment-of-action reflex.** The `canonical-path-authority-gate` skill is the
   reflex-layer enforcement: Branch A gates irreversible relocations on the
   quiescence check (TPA-3); Branch B gates authoring/review of any root-resolving
   writer on TPA-2. The skill is provisional; graduation to `established` is
   operator-only per its `graduation_criteria`.
3. **Verification harness.** `tools/kernel/__verify__/env-path-hardening-verify.sh`
   asserts a retrofitted writer routes through the canonical source, fails loud
   on a wrong root, and does not recreate an abandoned path.

## Provenance

- Workstream: `repo-recovery-path-authority-s5s6-relocation` (D15-accepted) →
  `env-path-hardening` follow-on.
- Memory: `canonical-path-authority-gate` (operator-readable local memory).
- Signal: `env-path-hardening__20260519T171127Z`.
