# NOW / codex response

- slot_id: now
- actor: codex
- pinned_model: none
- status: success
- duration_ms: 102512
- exit_code: 0
- error: none

---

**NOW verdict: approved-with-changes.** The Phase A / follow-on split is sound, but the charter currently contains one false safety rule and two sequencing/output gaps.

**Observation:** G1 accurately preserves the Stage-1 correction. The write ledger is post-write and fail-open (`tools/kernel/hooks/posttool-write-ledger.cjs:4-6,83-93`). The custody gate covers `git add`/`git commit`, passes unknown paths by default, and only blocks proven foreign custody (`tools/kernel/hooks/pretool-git-custody-gate.cjs:3-17,1030-1042,1198-1203`). Active-session membership is heartbeat/TTL-derived (`sessions/lib/active-session-registry.js:627-641`), boundary writes replace the normalized per-scope marker (`sessions/lib/boundary-markers.cjs:62-79`), and plan-run-gate explicitly declares `run_authorization_only` (`tools/planning/lib/plan-run-gate.js:92-103`). No drift there.

**Required change 1 — fix G2’s trigger.** “FINDINGS_ONLY/REVIEW_ONLY/RUN_ONLY are safe in a shared tree” is false in this repository. The declared table permits RUN_ONLY report writes (`AGENTS.md:85-92`), while actual framework prompts allow FINDINGS_ONLY to write `verification_output/` (`frameworks/deliverables/scope-verification/prompts/01_ANALYZE.md:4-7`) and REVIEW_ONLY to write design artifacts (`frameworks/meta/execution-normalization/prompts/02_NORMALIZED_EXECUTION_MODEL_DESIGN.md:3-5`). The rule must be:

`effective repository write-set × overlapping working surface`, not `mode label × overlap`.

Mode can seed the write-set estimate, but declared outputs and delegated child writes control. Dirty-file count remains evidence, never the trigger.

**Required change 2 — define and reserve Phase A’s own outputs.** The charter has no `scope_identity.owned_artifacts`, even though comparable plans enumerate them. G5 points at the existing concept, but that document explicitly says “This is not itself the SOP” (`_dev/concepts/concurrent-growth-non-collision-sop.md:98-104`). Name a distinct Phase A specification artifact, add the plan/review artifacts to `owned_artifacts`, and require a preflight confirming no live overlapping working surface. Execution must occur on a feature branch and through a PR, consistent with repository policy. Otherwise the anti-collision plan demonstrates the exact defect it describes.

**Required change 3 — reorder the decision gate.** G4 currently asks the operator to choose based on producer-authored G2/G3 before G6 independently reviews them. Sequence should be G1 → G2/G3/G5 → G6 → OD1/G4. A producer must not effectively establish the adequacy premise presented to the operator.

**Required change 4 — strengthen acceptance criteria.** Add criteria that:

- the specification names exact claim-key normalization, prefix-overlap semantics, expiry/heartbeat behavior, atomic acquisition primitive, stale-claim recovery, and rollback;
- “preserve both byte versions” includes capturing the pre-image before mutation—after overwrite is too late;
- Phase A produces no mechanically authoritative or enforcement-complete SOP claim;
- OD1 records a bounded follow-on disposition, owner, and trigger/date—not “defer until an actual collision,” which makes damage the activation criterion.

`risk_tier: medium` and `big:false` are correct only with those boundaries. No protected or canonical path is mutated, and the output remains non-authoritative. The prior triad is useful evidence but does not itself justify non-BIG classification; mutation scope does.

Deferring the hook is correct. Phase A should build no kernel mechanism, but it must deliver a usable interim manual preflight/worktree procedure and an implementation-grade reservation specification. The likely ALPHA miss is mode-label optimism; the likely OMEGA miss is that “preserve both versions” is impossible unless the mechanism captures bytes before mutation.

