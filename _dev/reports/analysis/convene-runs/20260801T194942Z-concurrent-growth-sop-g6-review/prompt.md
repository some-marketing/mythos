You are one slot of a triadic convene run on a specific task.

Triad profile: Kernel triad (kernel)
Default three-lobe kernel triad: fast lobe, slow lobe, contextual breadth lobe.

The invariant is the three-corner structure. The actor/harness in each corner may rotate by task, scope, risk, and privacy constraints.

Triad slots:
  - ALPHA / claude — Intent, memory, originating principle, and fast orchestration. (Claude (fast reasoning, orchestration, in-session execution))
  - NOW / codex — Repo truth, executable constraints, implementation reality, and falsification. (Codex (slow rigor, code-truth verification)) [YOU]
  - OMEGA / gemini — Breadth, consequence, future-facing context, and community impact. (Gemini (contextual breadth, reframing, big picture))

This convene call originated from: alpha.
Participant slots convened by this runner: now/codex.
The origin slot or actor will add its own analysis inline after participant responses arrive.

Register rules:
  - Blunt, falsifiable, no hedging
  - Preserve the gap between observation and interpretation
  - Say when the profile is too narrow for consequence-grade consensus
  - Speak as a slot of the whole, not an external consultant
  - If uncertain, say so in curiosity-mode
  - Name what the other slots probably miss that you see by construction

## Your slot

- slot_id: now
- slot_label: NOW
- actor: codex
- function: Repo truth, executable constraints, implementation reality, and falsification.

## Task

G6: final distinct-family review of executed steps G1 (inventory), G2 (corrected isolation trigger), G3 (reservation spec), G5 (residence + manual checklist), all attached, against the charter's acceptance criteria. You gave the charter-level review that required these 4 changes -- verify they were actually implemented correctly, not just claimed: (1) does G2's rule genuinely use effective-write-set x overlap rather than mode-label, with accurate citations; (2) does G3 name all 6 required fields (claim-key normalization, prefix-overlap, expiry/heartbeat, atomic acquisition, stale-claim recovery, rollback) and correctly require pre-image capture; (3) does G5 actually deliver a usable manual procedure, not just point at a future spec; (4) does anything here overclaim mechanical authority it doesn't have. Give a clear final verdict: complete/mergeable, complete-with-minor-notes, or blocking.

## Shared context (read-only, for the task above)

### _dev/concepts/concurrent-growth-non-collision-sop/g1-inventory.md

```
# G1 — Inventory: liveness, custody, scope-boundary, approval-binding (four separate concerns)

**Plan:** concurrent-growth-non-collision-sop
**Step:** G1 (REVIEW_ONLY)
**Date:** 2026-08-01
**Citations verified by Codex during charter-level review** (`_dev/reports/analysis/convene-runs/20260801T190259Z-concurrent-growth-sop-charter-review/now__codex.md`); restated here as the inventory artifact.

Per the Stage-1 deliberation, these are four *separate* concerns and must not be collapsed into one mechanism.

## 1. Liveness — active-session registry
`sessions/lib/active-session-registry.js:627-641`. Session membership is heartbeat/TTL-derived. Answers "is this session probably still running," not "does this session own this artifact." Malformed/stale entries are excluded, not authoritative.

## 2. Custody (write-tracking) — post-write ledger
`tools/kernel/hooks/posttool-write-ledger.cjs:4-6,83-93`. Fires PostToolUse (after a write already happened), fail-open. Records what was written, does not prevent a second concurrent write to the same path before this ledger runs.

## 3. Custody (commit-time enforcement) — git-custody gate
`tools/kernel/hooks/pretool-git-custody-gate.cjs:3-17,1030-1042,1198-1203`. Intercepts `git add`/`git commit` specifically — not ordinary artifact writes. Blocks proven foreign custody; passes unknown custody by default. This is the mechanism that fired during the world-minds workstream's canonical-write attempts, but it only guards the git-staging boundary, not the filesystem-write boundary.

## 4. Scope-boundary — boundary markers
`sessions/lib/boundary-markers.cjs:62-79`. `writeMarker()` unconditionally renames onto the same normalized per-scope path. Solves cross-scope clobbering (two unrelated workstreams don't overwrite each other's handoff). Does NOT solve same-scope concurrent writes — two sessions both writing to the *same* scope's marker still race.

## 5. Approval-binding — plan-run-gate hashing
`tools/planning/lib/plan-run-gate.js:92-103`. Binds run authorization to exact plan bytes (`hashPlanPair()`), rejecting drift between what was reviewed and what executes. Declared authority is explicitly `run_authorization_only` — a real design precedent for "bind to exact bytes, reject silent drift," but not a general artifact-write collision mechanism. Worth reusing the *pattern* (hash-bind), not assuming it *already covers* concurrent writes.

## The gap these five leave open

None of the five is a **pre-write reservation**: a check, before a write happens, of whether another live session has already claimed an overlapping write-set. Liveness (1) tells you who's alive; custody (2, 3) tells you what happened after the fact or gates git specifically; scope-boundary (4) prevents cross-scope collision but not same-scope; approval-binding (5) prevents *drift* between review and execution, not concurrent *writes* by different actors. This is the mechanism gap G3 specifies (not builds).

```

### _dev/concepts/concurrent-growth-non-collision-sop/g2-isolation-trigger.md

```
# G2 — Isolation trigger (corrected)

**Plan:** concurrent-growth-non-collision-sop
**Step:** G2 (PATCH_ALLOWED, documentation)
**Date:** 2026-08-01
**Correction note:** the first draft of this rule said "write-mode (PATCH_ALLOWED/COORDINATOR) × shared-surface-overlap" — i.e., only certain execution modes need isolation. Charter-level Codex review found this **false in this repository**: `FINDINGS_ONLY` writes to `verification_output/` (`frameworks/deliverables/scope-verification/prompts/01_ANALYZE.md:4-7`), `REVIEW_ONLY` writes design artifacts (`frameworks/meta/execution-normalization/prompts/02_NORMALIZED_EXECUTION_MODEL_DESIGN.md:3-5`), and `RUN_ONLY` writes reports (`AGENTS.md:85-92`) — despite their names suggesting they don't write. Mode label alone cannot be the trigger.

## Corrected rule

> **Isolation is required when: effective repository write-set × overlapping working surface.**
>
> Not mode-label × overlap. Not dirty-file count.

- **Effective write-set**: the actual set of paths a session (or its delegated children) will write, estimated from declared outputs (task-plan `owned_artifacts`, framework prompt output contracts) — mode can *seed* this estimate (a mode's typical write scope is a starting guess), but declared outputs and delegated child writes are what actually control.
- **Overlapping working surface**: another live session (per the active-session registry) has a working surface — its own declared or observed write-set — that intersects this session's effective write-set.
- **Dirty-file count is evidence, never the trigger.** A large dirty tree from unrelated concurrent work says nothing about whether *this* session's specific writes will collide with anything.

## Worked validation (retroactive) — this session's own case

The world-minds-tick-turn-operator-boundary delivery (PR #4) needed isolation not because its mode was PATCH_ALLOWED in the abstract, but because its effective write-set (`_dev/concepts/world-minds-tick-turn-operator-boundary/`, `_dev/reports/analysis/task-plans/world-minds-*`, several `_dev/reports/analysis/convene-runs/*` directories) was being delivered into a shared checkout whose active branch (`client-storage-cloud-drives`) carried 2,864 dirty files from unrelated work — and switching that shared checkout's branch could have disrupted a concurrent session's live view, independent of whether the new write-set itself overlapped anything. The rule as corrected here would flag this case correctly: the risk wasn't write-set overlap with another session's *files*, it was branch-switch disruption to another session's *shared working directory state* — a related but distinct trigger condition worth naming separately (see Non-goals below).

This plan's own execution (the file you're reading) did NOT require isolation for the write itself — `_dev/concepts/concurrent-growth-non-collision-sop/` is a uniquely-named new path with no overlap against any declared working surface — but delivery still routes through a feature-branch + PR per `scope_identity.execution_surface`, for the same branch-switch-disruption reason, not because the write itself needed reserving.

## Non-goals of this rule

- Does not cover the branch-switch-disruption case as a first-class trigger (see worked validation above) — that is a related but distinct condition (shared-checkout-state disruption vs. write-set overlap) that G3's specification should account for separately, not conflate with write-set overlap.
- Does not itself implement any check — this is documentation. G3 specifies the mechanism; whether it gets built is OD1 (deferred, per operator decision, pending an observed collision).

```

### _dev/concepts/concurrent-growth-non-collision-sop/g3-reservation-spec.md

```
# G3 — Pre-write reservation contract (specification only — not built)

**Plan:** concurrent-growth-non-collision-sop
**Step:** G3 (PATCH_ALLOWED, documentation)
**Date:** 2026-08-01
**Status: SPECIFICATION ONLY.** This document makes no mechanically-authoritative or enforcement-complete claim. No hook, script, or gate implementing this exists. Building it is OD1 — deferred pending an observed collision (see `_dev/reports/analysis/task-plans/concurrent-growth-non-collision-sop__plan.json`).

## Why this is needed (per G1)

None of the five existing mechanisms (liveness, post-write ledger, git-custody gate, boundary markers, plan-run-gate hashing) checks, *before* a write happens, whether another live session has already claimed an overlapping write-set. Two sessions can currently write the same file before any existing mechanism reacts.

## The contract

1. **Declare target set.** Before writing, the actor states the exact path(s) or path-prefix(es) it intends to write.
2. **Claim-key normalization.** Paths are normalized (resolved, case-consistent, trailing-slash-consistent) before comparison, so `_dev/concepts/foo` and `_dev/concepts/foo/` are recognized as the same claim key.
3. **Prefix-overlap semantics.** A claim on a directory prefix (e.g. `_dev/concepts/foo/`) conflicts with any claim on a path under that prefix, not just an exact-path match.
4. **Detect overlapping live claims.** Check active claims from other sessions (keyed by session/run id) against the normalized target set for prefix or exact overlap.
5. **Acquire exclusive reservation.** If no overlap, atomically create a claim record (the specific primitive — e.g. `open(O_CREAT|O_EXCL)`, matching the pattern already used by the custody-grant transactional-consumption mechanism — is an implementation decision for the deferred build, not fixed here).
6. **Expiry / heartbeat.** A claim without a refreshing heartbeat within a defined window is stale and eligible for reclaim — mirroring the active-session registry's existing TTL semantics (G1 item 1), not inventing a new liveness model.
7. **Write atomically.** Perform the write (temp-then-rename, or equivalent atomic primitive appropriate to the artifact type).
8. **Record hash.** Post-write, record the resulting content hash (extends the existing post-write ledger pattern, G1 item 2).
9. **Release or transfer custody.** On completion, release the claim (or transfer it, for a handoff case) — explicit, not implicit expiry, for the normal-completion path.
10. **Stale-claim recovery.** A claim whose owning session is confirmed dead (not just TTL-stale) is recoverable via an explicit, auditable path — not silent reclaim, mirroring the custody-grant quarantine-release precedent (never fully automatic for anything resembling an override).
11. **Rollback.** If the write fails after claim acquisition but before completion, the claim releases and no partial artifact is left in a state that looks complete.

## Escalation matrix

| Situation | Response |
|---|---|
| Proven prospective overlap (another live claim covers this target) | **Hard block**, absent an explicit custody grant transferring the claim |
| Unknown custody, read-only or unique-creation | **Warn**, proceed |
| Unknown custody, mutation of an existing artifact | **Fail closed** |
| Detected actual collision (two writes landed) | **Stop.** Preserve the **pre-image** (captured *before* mutation — capturing only after overwrite is too late; the original bytes are already gone by then) alongside the post-image and both hashes. Mark `needs_context`. Require operator-selected reconciliation. **Never silently merge.** |

## Explicitly out of scope for this specification

- The atomic acquisition primitive's exact implementation.
- Where claim records live (filesystem, a lightweight local store, or reuse of `_dev/state/active-sessions/`).
- Whether this becomes a `PreToolUse` hook, a library function growth-commands call explicitly, or both.
- Any actual code. This document is a decision table for a future BIG-classified charter to implement against, per OD1.

```

### _dev/concepts/concurrent-growth-non-collision-sop/g5-residence-and-manual-checklist.md

```
# G5 — SOP residence + interim manual procedure

**Plan:** concurrent-growth-non-collision-sop
**Step:** G5 (PATCH_ALLOWED, documentation)
**Date:** 2026-08-01

## Residence

This SOP's working artifacts (G1–G3, this document) are staged under `_dev/concepts/concurrent-growth-non-collision-sop/`. Promotion to a canonical governance surface (e.g. `instructions/canonical/governance/concurrent-growth-sop.md`, per the Stage-1 deliberation's suggestion) is a **separate, explicitly ConveneReceipt-gated step** — not performed by this plan. `instructions/canonical/**` writes require a live ConveneReceipt/1.0, which this plan does not hold and does not attempt to obtain.

## Interim manual procedure (usable now, no mechanism required)

Since the pre-write reservation mechanism (G3) is deferred pending an observed collision (OD1), the following is the actual, immediately usable procedure until then:

1. **Before a write with a non-trivial effective write-set** (per G2's corrected trigger — judge by what you're actually about to write, not your execution mode's label): check `_dev/state/active-sessions/` for entries with a working surface that overlaps your intended write-set.
2. **If overlap is found or the shared checkout's active branch carries unrelated dirty work you don't own:** do not switch the shared checkout's branch. Use `EnterWorktree` to create an isolated worktree on a fresh branch, do the work there, and deliver via `git push` + PR from that worktree — exactly as this session did for PR #4.
3. **If no overlap and the write-set is a small number of uniquely-named new paths:** writing directly in the shared checkout is acceptable; delivery still routes through a feature branch + PR (never a direct commit to a shared branch), per repository contribution policy.
4. **On completion:** use `ExitWorktree` with `keep` if the branch has been pushed (nothing is lost by leaving the local worktree), or `remove` only after confirming the work is pushed or intentionally discarded.
5. **If you discover you already collided with another session's write** (same file, unexpected content): stop, do not overwrite further, and surface it to the operator rather than reconciling silently — this is the `needs_context` behavior G3's escalation matrix specifies for the future mechanized version, but it applies as a manual discipline right now.

This procedure is retroactively validated by this session's own two deliveries (PR #4, and this plan's own writes) — both followed exactly this shape before this document existed to name it.

```

### _dev/reports/analysis/task-plans/concurrent-growth-non-collision-sop__plan.json

```
{
  "schema": "TaskPlan/1.0",
  "task_id": "concurrent-growth-non-collision-sop",
  "title": "Concurrent-growth non-collision SOP — audit + decision table (Phase A); pre-write reservation mechanism deferred to a BIG follow-on",
  "task_summary": "The operator, after watching a full /bp-r delivery chain (world-minds-tick-turn-operator-boundary, PR #4) require ad hoc worktree isolation to avoid disrupting a concurrent session, asked for a standing SOP so the system can keep growing (concepts/plans/charters produced by multiple sessions/actors) without sessions clobbering each other's work. A kernel-triad deliberation (Codex + Gemini) corrected the initial audit-and-name framing: current custody is post-write only (posttool-write-ledger.cjs records after the fact; the git-custody gate intercepts git add/commit, not ordinary artifact writes, and passes unknown custody by default), so a real mechanism gap exists, not just an unnamed pattern. This charter scopes Phase A only: audit existing machinery, document the corrected isolation-trigger rule (write-mode x shared-surface-overlap, not dirty-file count), and specify (not build) the pre-write reservation decision table. Building the actual pre-write reservation hook is named as an explicit, separate, BIG-classified follow-on requiring its own operator gate before touching tools/kernel/hooks/** (L1 protected surface).",
  "scope_type": "system",
  "scope_justification": "Phase A is documentation + specification only -- no tools/kernel/hooks/** changes, no instructions/canonical/** changes in this plan. If G4 (see below) or the operator later decides to build the reservation hook, that is out of this plan's scope and requires a fresh BIG-classified charter with kernel-triad convene per the custody-grant-transactional-consumption plan's own precedent (L1 protected surface, always-on infrastructure).",
  "storage_root": "_dev/reports/analysis/task-plans",
  "origin_client_code": null,
  "origin_project_id": null,
  "client_code": null,
  "project_id": null,
  "source": "operator",
  "requested_by": "operator, session 7c99c7c3 2026-08-01: /aside during world-minds-tick-turn-operator-boundary workstream, classified 'concept' by the aside agent, routed to /bp-r per operator instruction ('if the verdict is concept it should trigger the /bp-r flow')",
  "timestamp": "2026-08-01T19:02:00Z",
  "amended": null,
  "concept_ref": "_dev/concepts/concurrent-growth-non-collision-sop.md",
  "predecessor_plan": null,
  "scope_identity": {
    "owned_artifacts": [
      "_dev/concepts/concurrent-growth-non-collision-sop.md",
      "_dev/concepts/concurrent-growth-non-collision-sop/",
      "_dev/reports/analysis/task-plans/concurrent-growth-non-collision-sop__plan.json",
      "_dev/reports/analysis/task-plans/concurrent-growth-non-collision-sop__plan.md",
      "_dev/reports/analysis/convene-runs/20260801T185941Z-concurrent-growth-non-collision-sop-deliberate/",
      "_dev/reports/analysis/convene-runs/20260801T190259Z-concurrent-growth-sop-charter-review/"
    ],
    "preflight_required": "Before any G2/G3/G5 write, confirm no live entry in _dev/state/active-sessions/ has a working_surface overlapping these owned_artifacts paths. If one exists, use an isolated git worktree (EnterWorktree) rather than writing in the shared checkout.",
    "execution_surface": "feature-branch + PR, never a direct commit to main, per repository contribution policy -- an anti-collision plan that violates this demonstrates the exact defect it describes"
  },
  "description": "G1 inventories the real state of every non-collision mechanism named in the concept and the Stage-1 deliberation, with file:line citations: active-session registry (liveness, not custody), boundary markers (scope-clobber, not same-scope concurrent write), the git-custody gate (git add/commit interception, unknown-custody-passes-by-default), the post-write ledger, and plan-run-gate hashing (run_authorization_only, not general collision control). G2 documents the corrected isolation-trigger rule as a decision table: write-mode (PATCH_ALLOWED/COORDINATOR) intersected with shared-surface-overlap requires isolation; FINDINGS_ONLY/REVIEW_ONLY/RUN_ONLY are safe in a shared tree regardless of dirty-file count. G3 documents the full pre-write reservation CONTRACT (declare target set, detect overlapping live claims, acquire exclusive reservation, write atomically, record hash, release/transfer) and the tiered escalation matrix (proven overlap -> hard block; unknown custody -> warn on read/unique-create, fail-closed on mutating an existing artifact; detected actual collision -> stop, preserve both byte versions + hashes, mark needs_context, require operator-selected reconciliation) as a SPECIFICATION, not an implementation. G4 is an explicit decision gate on whether Phase A's documentation is sufficient near-term (relying on existing partial machinery + operator awareness) or whether the reservation hook must be built immediately -- this is an operator call given L1 protected-surface stakes, not something this plan decides unilaterally. G5 records where the SOP resides (draft at instructions/canonical/governance/concurrent-growth-sop.md per Gemini's proposal, but written to _dev/concepts/ first in this plan since instructions/canonical/** is ConveneReceipt-gated -- promotion to canonical is itself a separate gated step). G6 is distinct-family review of G1-G5.",
  "similarity_assessment": {
    "top_framework": "meta/execution-normalization",
    "match_score": 12,
    "match_rationale": "No registered framework or existing plan covers cross-session artifact-write collision prevention as a general SOP. Related but non-overlapping existing plans: custody-grant-transactional-consumption (fixes one specific PreToolUse/PostToolUse transactionality bug in git-custody grants, not general artifact-write reservation) and context-budget-custody-scoped-dirty-signal (scopes a context-budget proxy signal to session custody, unrelated to write collision).",
    "gaps": [
      "pre-write reservation contract specification",
      "isolation-trigger decision table (write-mode x shared-surface-overlap)",
      "tiered collision-escalation matrix",
      "liveness-vs-custody-authority separation documentation"
    ],
    "applicable_modes": [
      "REVIEW_ONLY",
      "PATCH_ALLOWED"
    ],
    "trust_tier": "no-match"
  },
  "operator_ratifications": [],
  "routing_expectations": {
    "risk_tier": "medium",
    "big": false,
    "big_rationale": "Phase A is documentation/specification only -- no L1 protected-path changes (tools/kernel/hooks/**), no always-on infrastructure, no instructions/canonical/** edits. The BIG bar applies to the deferred pre-write-reservation-hook follow-on, explicitly named and NOT executed by this plan. This charter's own deliberate leg already ran as a consequence-grade kernel-triad convene (_dev/reports/analysis/convene-runs/20260801T185941Z-concurrent-growth-non-collision-sop-deliberate/), satisfying the BIG review requirement for the ideas even though the charter itself stays medium/non-BIG in scope.",
    "review_lane": "independent-review",
    "execution_route": "/trial-quest concurrent-growth-non-collision-sop, then /run-plan concurrent-growth-non-collision-sop if approved",
    "review_lane_note": "Deliberate leg already satisfied via kernel-triad convene (Codex + Gemini, both independently corrected the origin framing). Charter itself still needs its own distinct-family (Codex) review before execution, per plan-quest normal gate."
  },
  "acceptance_criteria": [
    "G1 inventory correctly distinguishes liveness (active-session registry) from custody (post-write ledger, git-custody gate) from scope-boundary (boundary markers) from approval-binding (plan-run-gate hashing) -- must NOT collapse these into one mechanism, per Codex's explicit correction",
    "G2's isolation-trigger decision table uses EFFECTIVE REPOSITORY WRITE-SET x overlapping-working-surface as the trigger (NOT mode-label x overlap -- charter-level review found FINDINGS_ONLY/REVIEW_ONLY/RUN_ONLY all write in practice per named framework prompt citations), explicitly rejecting dirty-file-count as the trigger",
    "G3's pre-write reservation contract names exact claim-key normalization, prefix-overlap semantics, expiry/heartbeat behavior, atomic acquisition primitive, stale-claim recovery, and rollback -- and explicitly states it makes no mechanically-authoritative or enforcement-complete claim",
    "G3's escalation matrix states 'preserve both versions' requires capturing the PRE-IMAGE before mutation (capturing after overwrite is stated as impossible/too late)",
    "G3/G5 -- no tools/kernel/hooks/** file is created or modified by this plan",
    "G4's decision (build reservation hook now vs defer) is recorded as OD1 with an explicit OWNER and TRIGGER/DATE, not an open-ended 'defer until collision observed' that makes damage the activation criterion",
    "G4 runs AFTER G6 (independent review precedes the operator decision gate, not after) -- the producer must not establish the adequacy premise the operator is asked to approve",
    "G5 delivers a usable interim MANUAL preflight/worktree procedure in addition to the future specification -- Phase A is not purely deferred documentation",
    "G5 records SOP residence and explicitly notes the instructions/canonical/** promotion step is separate and ConveneReceipt-gated",
    "G6 distinct-family (Codex) review completed before this plan is marked complete/merged",
    "scope_identity.preflight_required was actually checked before any write in this plan's own execution, and execution occurred on a feature branch via PR, not a direct commit",
    "No instructions/canonical/** or tools/kernel/hooks/** files are touched anywhere in this plan's execution"
  ],
  "bounded_plan": {
    "steps": [
      {
        "step_id": "G1",
        "description": "Inventory real state of existing non-collision machinery with file:line citations: active-session registry liveness semantics (sessions/lib/active-session-registry.js), post-write custody ledger (tools/kernel/hooks/posttool-write-ledger.cjs), git-custody gate scope (tools/kernel/hooks/pretool-git-custody-gate.cjs -- git add/commit only, unknown-custody-passes-by-default), boundary markers (sessions/lib/boundary-markers.cjs -- scope-clobber only), plan-run-gate hashing (tools/planning/lib/plan-run-gate.js -- run_authorization_only). Explicitly distinguish liveness vs custody vs scope-boundary vs approval-binding as four separate concerns, not one mechanism.",
        "stage": "research",
        "domain": "planning",
        "mode": "REVIEW_ONLY",
        "is_gap": true
      },
      {
        "step_id": "G2",
        "description": "Document the CORRECTED isolation-trigger decision table (fixed per charter-level Codex review: 'mode label x overlap' is FALSE in this repo -- FINDINGS_ONLY writes verification_output/ per frameworks/deliverables/scope-verification/prompts/01_ANALYZE.md:4-7, REVIEW_ONLY writes design artifacts per frameworks/meta/execution-normalization/prompts/02_NORMALIZED_EXECUTION_MODEL_DESIGN.md:3-5, RUN_ONLY writes reports per AGENTS.md:85-92). Corrected rule: `effective repository write-set x overlapping working surface`, NOT mode-label x overlap. Mode may seed the write-set estimate, but declared outputs and delegated child writes control. Dirty-file count remains evidence, never the trigger. Test against this session's own retroactive case (world-minds-tick-turn-operator-boundary delivery, PR #4) as validation.",
        "stage": "implement",
        "domain": "documentation",
        "mode": "PATCH_ALLOWED",
        "depends_on": ["G1"],
        "is_gap": true
      },
      {
        "step_id": "G3",
        "description": "Specify (not implement) the pre-write reservation contract and tiered escalation matrix, strengthened per charter-level review: the specification must name exact claim-key normalization, prefix-overlap semantics, expiry/heartbeat behavior, the atomic acquisition primitive, stale-claim recovery, and rollback. 'Preserve both byte versions' on detected collision means capturing the PRE-IMAGE before mutation -- capturing after overwrite is too late and must be stated as impossible without that. Escalation matrix: proven overlap -> hard block; unknown custody -> warn on read/unique-create, fail-closed on mutating existing artifact; detected collision -> stop, preserve pre-image + post-image + hashes, mark needs_context, require operator-selected reconciliation, never silently merge. Written as documentation/specification only -- explicitly states it makes no mechanically-authoritative or enforcement-complete claim.",
        "stage": "implement",
        "domain": "documentation",
        "mode": "PATCH_ALLOWED",
        "depends_on": ["G1"],
        "is_gap": true
      },
      {
        "step_id": "G5",
        "description": "Record SOP residence: staged at _dev/concepts/concurrent-growth-non-collision-sop.md for this plan; note that promotion to instructions/canonical/governance/ (or equivalent) is a separate, explicitly ConveneReceipt-gated step, not performed by this plan. Also deliver an interim MANUAL preflight/worktree procedure (per charter-level review: Phase A builds no kernel mechanism, but must still leave a usable manual procedure, not just a future specification) -- a short checklist: before a PATCH_ALLOWED/COORDINATOR write, check _dev/state/active-sessions/ for overlapping working_surface; if found, use EnterWorktree rather than switching the shared checkout's branch.",
        "stage": "implement",
        "domain": "documentation",
        "mode": "PATCH_ALLOWED",
        "depends_on": ["G1"],
        "is_gap": false
      },
      {
        "step_id": "G6",
        "description": "Distinct-family (Codex) review of G1-G3, G5 output: verify all citations are real and correctly classified, verify no canonical/kernel-hook files were touched, verify the isolation-trigger decision table and escalation matrix are internally consistent and match the Stage-1 deliberation's corrected framing. Runs BEFORE the operator decision gate (G4/OD1) per charter-level review correction: a producer must not effectively establish the adequacy premise presented to the operator by having G4 ask the operator to decide based on producer-authored G2/G3 before independent review has checked them.",
        "stage": "review",
        "domain": "review",
        "mode": "REVIEW_ONLY",
        "depends_on": ["G2", "G3", "G5"],
        "is_gap": false
      },
      {
        "step_id": "G4",
        "description": "Explicit decision gate (runs AFTER G6, per charter-level review correction): given L1 protected-surface stakes (any real reservation mechanism touches tools/kernel/hooks/**), record whether the operator wants the reservation hook built now (as a fresh BIG-classified charter with its own kernel-triad convene) or deferred. OD1 must record a bounded disposition with an OWNER and an explicit TRIGGER/DATE -- not 'defer until an actual collision is observed,' which makes damage the activation criterion. This plan does not build the hook either way -- it only records the decision.",
        "stage": "review",
        "domain": "planning",
        "mode": "REVIEW_ONLY",
        "depends_on": ["G6"],
        "is_gap": true
      }
    ]
  },
  "operator_decisions_pending": [
    {
      "id": "OD1",
      "question": "Per G4: build the pre-write reservation hook now (fresh BIG-classified charter, kernel-triad convene, touches tools/kernel/hooks/**), or defer until an actual collision is observed?",
      "why_operator_only": "L1 protected-surface, always-on-infrastructure decision -- exactly the kind of judgment/scope call that must bubble up per orchestrate-loop's bubble-up criteria."
    }
  ],
  "distinct_reviews": [
    {
      "reviewer": "codex (GPT-5.5, distinct family)",
      "date": "2026-08-01T19:02:59Z",
      "verdict": "approved-with-changes",
      "artifact": "_dev/reports/analysis/convene-runs/20260801T190259Z-concurrent-growth-sop-charter-review/now__codex.md",
      "disposition": "4 required changes folded 2026-08-01T19:08Z: (1) G2's trigger corrected from mode-label x overlap to effective-write-set x overlap, with citations showing FINDINGS_ONLY/REVIEW_ONLY/RUN_ONLY all write in practice in this repo; (2) added scope_identity.owned_artifacts, preflight_required, and execution_surface (feature-branch+PR) so this anti-collision plan does not itself demonstrate the defect it describes; (3) reordered G4 (operator decision gate) to depend on G6 (independent review) instead of the reverse, so a producer-authored G2/G3 is reviewed before the operator is asked to decide on it; (4) strengthened acceptance criteria: named reservation-contract fields (claim-key normalization, prefix-overlap, expiry/heartbeat, atomic acquisition, stale-claim recovery, rollback), pre-image-before-mutation requirement for 'preserve both versions', explicit no-mechanical-authority claim for the specification, and OD1 requiring an owner+trigger/date rather than open-ended deferral."
    }
  ],
  "distinct_reviews_pending": null
}

```

## Your response

Answer the task from your slot's perspective. 300-800 words. Be specific. Cite file paths with line numbers where relevant.
