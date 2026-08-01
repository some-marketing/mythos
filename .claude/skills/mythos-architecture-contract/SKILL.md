---
name: mythos-architecture-contract
description: Load-bearing invariants of the Mythos repo that a change must not break — canonical path authority, generator-managed instruction files, actor continuity, tool-path-immutable state files, canonical memory, branch canonicity, execution modes. Activate BEFORE any structural change, file move/rename/delete, edit to instruction or config surfaces (CLAUDE.md, AGENTS.md, .claude/, instructions/), state-file writes under _dev/state/, or authoring hooks/scripts that resolve a repo root.
---

# Mythos Architecture Contract

Every claim below cites its source file. When in doubt, open the citation — it wins over this summary.

## 1. Instruction files are generated. Never hand-edit them.

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `INSTRUCTIONS.md`, `OPENCODE.md`, `.claude/CLAUDE.md`, and everything under `instructions/generated/` carry AUTO-GENERATED headers (see `CLAUDE.md:3`). Canonical source is `instructions/canonical/*`. Hand edits are destroyed on regeneration and flagged as parity drift (`instructions/canonical/system.yaml` → `policy.parity: "strict"`, line 262; bare `system.yaml` below means this file).

Runbook: edit the canonical file under `instructions/canonical/`, then

```bash
npm run instructions:regen && npm run instructions:validate
```

(`package.json` scripts; `instructions:check` runs both.) Validate must end with "no parity/drift errors for managed targets."

## 2. One canonical root; resolve it, validate it, fail loud.

Canonical root is `{MYTHOS_ROOT}` (env override `MYTHOS_ROOT`). Rule TPA-2 (`instructions/canonical/topology-and-path-authority.md:22-31`): any hook/script that computes a root and then mkdir/writes MUST use `tools/lib/canonical-root.cjs` (Node: `resolveCanonicalRoot({ mode: 'hard' })`, throws `ECANONROOT`) or `tools/lib/repo-root.sh` (shell), never `process.cwd()`, never a hardcoded absolute. Root must contain all anchors: `instructions/canonical/`, `.git`, `package.json`. `mkdir -p` never ENOENTs — a stale root silently resurrects an abandoned path (the 2026-05 damage class).

```bash
source tools/lib/repo-root.sh && ROOT="$(repo_root hard)" || exit 3
```

## 3. Runtime authority never on an iCloud-synced path.

Rule TPA-1 (`topology-and-path-authority.md:8-20`): launchd agents, Claude hooks/settings, `.mcp.json`, and anything a scheduled process resolves must not point under `~/Documents`, `~/Desktop`, or any ubiquity-backed directory. iCloud relocates inodes under live processes.

## 4. No irreversible relocation without a quiescence gate.

Rule TPA-3 (`topology-and-path-authority.md:33-56`): before mv/rename/delete of a checkout or runtime-authority path, `lsof +D <target>` must show zero foreign live processes, and the plan must carry a `relocation_preflight` block or `/run-plan` refuses it. Do not restate the procedure here — invoke the **`canonical-path-authority-gate`** project skill; verification harness is `tools/kernel/__verify__/env-path-hardening-verify.sh`.

## 5. Three state files are tool-path immutable (the NOW falsifier set).

`tools/kernel/guard-now-write.cjs` (PreToolUse-shaped guard, exit 2 = refusal) protects exactly:

- `_dev/state/session-present.json`
- `_dev/state/session-drift-log.json`
- `_dev/state/intellect-quarantine.json`

Bash-path writes are physically possible but detected by `tools/kernel/doctrine-reflex.cjs` as `verdict=stall` via missing `writer_attestation` (`doctrine-reflex.cjs:291-298`). Never route around the guard. Negative-case test:

```bash
node --test tools/kernel/__tests__/now-readonly.test.js
```

## 6. Canonical memory is written only through the writer script.

`PROJECT_MEMORY.json` invariant (verbatim): "No harness cache may accept a write that canonical (write-canonical-entry.js) cannot receipt. On CANONICAL_UNREACHABLE the adapter refuses the write and enters FINDINGS_ONLY, emitting an observable signal." Store of truth is `_dev/state/kernel-memory/entries/` + `_dev/state/memory-ledger.jsonl`; harness memory pockets are caches.

```bash
node tools/memory/write-canonical-entry.js --help
```

## 7. Actors cross sessions only through durable artifacts.

Actor Continuity Contract (`CLAUDE.md` "Actor Continuity Contract" section; canonical in `instructions/canonical/harness-runtime-contract.md`): every invocation carries Current State / Question-Work / Desired State; returns carry evidence sufficient for resumption. Harness memory conflicting with durable task artifacts loses unless the human operator resolves it. For handoffs/resumption, invoke the **`state-reconciliation-preamble`** project skill instead of improvising.

## 8. A producer cannot validate its own acceptance-grade outcome.

`system.yaml` `governance_policy.distinct_intelligence_validation`: distinctness requires different `actor_id` AND different `harness_id`; same-model Claude subagents are parallel contexts, not distinct review (`harness-runtime-contract.md:54`). Acceptance-grade events: `outcome_delta.completed`, `bridge_feedback_received`, `actor_promotion`, `framework_hardening`. Disclose the model for every dispatch and tier it to work altitude per `instructions/canonical/dispatch-routing-rule.yaml` (kernel-class); harness registry authority is `tools/signals/lib/target-command-policy.cjs`.

## 9. Execution modes are hard constraints; adapters narrow, never widen.

`system.yaml` `execution_modes`: FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED, COORDINATOR, REPO_HYGIENE. "Never skip declared execution mode constraints" is in `instructions/canonical/kernel/safety.yaml` (marked `"immutable": true`). Capability claims follow evidence tiers (`harness-runtime-contract.md:60-65`): BLOCKING needs an enforcing file plus a passing negative-case test; generated instruction text is never enough; UNKNOWN cannot be promoted.

## 10. Canonical branch is `recovery/clean-lineage-2026-05-18`.

`instructions/canonical/branch-canonicity.md` + `system.yaml` `branching` (line 183): origin/main is historical/noncanonical. Worker convergence is fast-forward only (`git merge --ff-only`), never reset; never `git clean` on a worker node; `preserve/*` tags and archive lineages must not be erased. For commit grouping and hygiene, invoke the **`clean-house`** project skill.

## Preflight checklist before a structural change

```bash
git branch --show-current                      # must be recovery/clean-lineage-2026-05-18
npm run instructions:validate                  # clean parity before AND after
node --test tools/kernel/__tests__/now-readonly.test.js
```

Then ask: does my diff touch a generated file (§1)? resolve a root (§2)? move a directory (§4 → canonical-path-authority-gate)? write `_dev/state/` (§5-6)? claim its own acceptance (§8)? If yes to any, apply that section before proceeding.
