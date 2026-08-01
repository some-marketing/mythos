# Branch Canonicity

**Ratified:** 2026-05-30 (operator, via `/owl` Phase 0 forensic + codex+gemini convene cross-verification)

## Canonical lineage

`recovery/clean-lineage-2026-05-18` is the **canonical-unified** lineage for Mythos. All hosts (macbook-pro orchestrator, Rupert, Orwell) converge to it.

**Forensic basis** (`_dev/reports/analysis/tri-host-lineage-forensic__20260530T184245Z.md`): the worker lineage `feat/multi-session-coordination` (639 commits, what Rupert/Orwell ran) is a **direct ancestor** of `recovery/clean-lineage` — recovery = feat + 402 commits, worker `daemon.py` byte-identical, zero `fleet/worker` drift. recovery is a clean superset, **not** the "disjoint orphan" a stale commit message feared. Worker convergence is therefore a **fast-forward** (`git merge --ff-only`), never a reset.

## Disposition of other lineages

| Branch | Disposition |
|---|---|
| `recovery/clean-lineage-2026-05-18` (local/vps/localmirror tip verified at `b170b27566a5` on 2026-06-19) | **CANONICAL** |
| `feat/multi-session-coordination` | ancestor of canonical; workers fast-forward off it; archive tag retained |
| `dev/workspace` | superseded; 18 unique-by-SHA commits mostly ephemeral/content-present; archive after attention-concept spot-confirm |
| `origin/main` | thin Dart/Landing-Pad branch; unique functional work **ported** (gmail-inbox-agent, signed Dart webhooks, outbound-gate audit) 2026-05-30; **Email-Labels payloads deferred** (entangled with main's unported `assignee` feature — needs dedicated port); archive after Email-Labels reconciled |
| `archive/pre-remote-rewrite-dev-workspace-2026-04-13` | evidence/archive only; never force-sync hosts to it |

## Preservation

All lineage tips pinned as `preserve/*-20260530T184245Z` tags; local-only tips bundled to `~/dev/Mythos-lineage-preservation-20260530T184245Z/` (recovery-local + main-local, verified). Pushing preserve tags to origin is operator-gated (deferred).

## Worker bootstrap implication

`tools/fleet/kernelize-worker.ps1` and `tools/fleet/NODE_UPDATE_COMMANDS.md` are repointed to `recovery/clean-lineage-2026-05-18` as of the 2026-06-19 canonicalization pass. Worker convergence is fast-forward; never run `git clean` on a worker (host-only untracked state — Orwell `driver-backups/`, `.venv-fleet/` — must survive).
