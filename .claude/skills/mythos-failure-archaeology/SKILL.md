---
name: mythos-failure-archaeology
description: Settled battles of the Mythos repo — resolved failures as symptom → root cause → standing rule, so no session re-fights them. Read BEFORE repair work, plan amendments, incident response, or when a proposed fix resembles a past failure (relocating directories, converging worker branches, committing a dirty tree, pausing client campaigns, uploading to live hosts, spawning nested CLIs, citing review evidence, executing handoffs).
---

# Mythos Failure Archaeology

These failures are SETTLED. Do not re-investigate, re-litigate, or "fix" them again. If your plan touches one of these areas, apply the standing rule; if it contradicts one, stop and cite this file to the operator.

## 1. iCloud runtime root destroyed the repo (2026-05)
- **Symptom:** object-graph corruption forcing the full "Mythos-recovered" rebuild; later, relocated paths silently resurrected by `mkdir -p`.
- **Root cause:** runtime authority (launchd agents, hooks, .mcp.json) lived on an iCloud-synced path; sync evicted/re-materialized inodes under live processes. Second bite: scripts resolved repo roots via cwd/hardcoded paths and recreated abandoned directories.
- **Standing rule (TPA-1/2/3):** never place runtime authority on a synced path; all root-resolving writers go through `tools/lib/canonical-root.cjs` / `tools/lib/repo-root.sh` with anchor validation, fail-loud; run an `lsof +D <target>` quiescence gate before any irreversible directory move. Canonical: `instructions/canonical/topology-and-path-authority.md`. Enforcement: skill `canonical-path-authority-gate`, verifier `tools/kernel/__verify__/env-path-hardening-verify.sh`. Before any repo/directory relocation, invoke the `canonical-path-authority-gate` skill — do not restate its checks here.

## 2. "Disjoint orphan" branch panic — proven false, do not re-fight
- **Symptom:** a stale commit message claimed the recovery branch was disjoint from the worker lineage; sessions proposed resets.
- **Root cause:** stale message, not stale history. Tri-host forensic (convene run `_dev/reports/analysis/convene-runs/20260530T184245Z-tri-host-lineage-and-parity/`, commits 7eb7a439d, 7e668778c) proved `recovery/clean-lineage-2026-05-18` is a clean superset of `feat/multi-session-coordination`.
- **Standing rule:** worker convergence is `git merge --ff-only`, never a reset; never run `git clean` on a worker — host-only untracked state (Orwell `driver-backups/`, `.venv-fleet/`) must survive. Ratified: `instructions/canonical/branch-canonicity.md`.

## 3. Silent-orphan memory writes (cwd-pocket bug)
- **Symptom:** sessions launched outside the Mythos cwd wrote memory to the wrong per-project pocket, silently, since at least mid-April 2026.
- **Root cause:** memory location keyed off launch cwd; no guard detected "write landed in wrong filesystem location."
- **Standing rule:** canonical memory lives in the repo (topological sovereignty), guarded at boot by `~/.claude/hooks/mythos-session-start-guard.cjs`. Never trust harness memory pockets as authority. Debriefs: `_dev/reports/debriefs/20260513-memory-architecture-cwd-pocket.md`, `_dev/reports/debriefs/20260514T1330__topological-sovereignty-memory-session__debrief.md`.

## 4. The 454-file custody violation
- **Symptom:** a /new-session run proposed committing 454 dirty files that were three other live actors' in-flight work.
- **Root cause:** structural — `/new-session` and `/clean-house` specs had no custody predicate, so faithful spec execution violated custody.
- **Standing rule:** global dirty worktree state is context, not ownership. Enforced mechanically by the PreToolUse gate `tools/kernel/hooks/pretool-git-custody-gate.cjs` + session write-ledger (commit b170b2756). Full provenance: `Mythos-memories/concepts/actor-custody-commit-gate/concept.md`; memory `Mythos-memories/memory/feedback_clean-house-respects-actor-custody.md`. For hygiene commits, route through the `clean-house` skill.

## 5. {CLIENT_CODE} PMax pause walkback (client money)
- **Symptom:** a campaign paused off a stale coarse "0.15% lead-grade" report turned out to be the account's biggest lead line (~55 leads/mo, ~$93 CPA); reversed within the hour only because a convene cross-verified it.
- **Root cause:** PMax local-action noise sits in `all_conversions`, not `conversions`; two internal artifacts disagreed and nobody read live ground truth.
- **Standing rule:** verify by conversion-action before pausing (`Mythos-memories/memory/reference_verify-campaign-by-conversion-action-before-pausing.md`); owner-money changes require cross-verification before "done"; when two internal artifacts disagree on a client-facing number, read live ground truth. Debrief: `_dev/reports/debriefs/session-debrief__owl-{CLIENT_CODE}-convene-pmax-walkback__20260603.md`, commit 7df5b4e3c.

## 6. Live SQLite corrupted twice by non-atomic FTP upload
- **Symptom:** live {CLIENT_CODE} portal DB truncated 45KB → 16KB, twice, by a direct provisioning PUT hitting a transient FTPS 426 (the host has a ~25KB FTPS upload wall).
- **Root cause:** direct PUT onto a live file with no retry, verify, or atomic swap.
- **Standing rule:** never PUT directly onto a live file. Upload to a temp name → re-download and byte-verify → server-side atomic rename, over SFTP not FTPS. Reference implementation: `clients/{CLIENT_CODE}/projects/ads-approval-portal/deploy/`; commits 0734c2f47 (incident), 79949e888 (handoff), 4ae65b47f (atomic SFTP fix).

## 7. pi host crashes from `spawnSync`
- **Symptom:** pi extensions spawning nested CLIs synchronously froze the event loop 30–300s and crashed the host.
- **Standing rule:** never block a harness event loop with sync child processes. Use the async runner with bounded output and SIGTERM→SIGKILL process-group escalation: `.pi/extensions/lib/async-spawn.ts`. Debrief: `_dev/reports/debriefs/session-debrief__discord-bridge-and-pi-extension-crashfix__20260605.md`; crash transcript `_dev/reports/bugs/pi-crash-2026-06-06.md`.

## 8. Fabricated testimonial attributions in client-facing copy
- **Symptom:** models (Claude and external) invented plausibility-shaped quotes with named sources in client copy; a memory rule alone did not stop it.
- **Standing rule:** lint authored client-facing content with `node tools/lint/fabricated-attributions.cjs <file>` — invoke the `lint-attributions` skill; do not restate its process here. Context: `_dev/reports/debriefs/debrief__20260615T183703Z__clean-house-and-attribution-snippet-investigation-BACKFILL.md`.

## 9. Handoff drift — executing plans against stale claimed state
- **Symptom:** blind execution of handoffs/plans re-ran shipped work or cascaded errors from vanished state.
- **Root cause:** handoffs are ledgers of state at authoring time, not of state now.
- **Standing rule:** before executing any handoff, resumption, or plan reference, run the `state-reconciliation-preamble` skill (branch check, commit reachability, already-shipped detection, dirty-tree categorization, pending-work ledger). Do not restate its steps — invoke it.

## 10. Hollow completion — fake review evidence
- **Symptom:** convenes cited as plan-review evidence were skeletons or keyword-padded fakes; Codex demonstrated a filler-fake bypass on first pass.
- **Standing rule:** convene syntheses must pass the REJECT_HOLLOW_COMPLETION validator (`tools/kernel/lib/validate-convene-synthesis.cjs`), fail-closed on unreadable (commit 53217df62). Kin rules — guardrails 8 and 9 in `instructions/canonical/guardrails.md`: debrief before moving on; checkpoint pursued goals before context loss; never convert an incomplete goal into a completed narrative just to close context.

## Known-stale citation
`instructions/canonical/branch-canonicity.md` cites `_dev/reports/analysis/tri-host-lineage-forensic__20260530T184245Z.md`, which does not exist at that path; the forensic material lives in the convene run directory cited in battle 2. Do not go hunting for the missing file.
