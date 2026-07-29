# Claude Prompt Pack: Source Material QA And Promotion

Prompt pack for introducing a staged QA system that evaluates when `_dev` documents are mature enough to become prompt packs, system rules, or other durable operating guidance.

Primary source material:
- [`_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`](../concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md)
- [`_dev/MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md`](../MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md)
- [`_dev/SOURCE_MATERIAL_QA_AND_PROMOTION_IMPLEMENTATION_PLAN.md`](../SOURCE_MATERIAL_QA_AND_PROMOTION_IMPLEMENTATION_PLAN.md)
- [`_dev/concepts/multi-step-orchestration-abstraction.md`](../concepts/multi-step-orchestration-abstraction.md)
- [`_dev/concepts/cross-ai-dispatch-design-brief.md`](../concepts/cross-ai-dispatch-design-brief.md)

Primary target files:
- prompt authoring guidance
- prompt/system-rule promotion guidance
- future source-material QA registry or validation surfaces
- operator-facing planning docs as needed

## Goal

Add a trustworthy path from exploratory source documents to promotable prompt/system-rule inputs.

Desired outcome:
- source-doc readiness is reviewed explicitly
- promotion uses provenance and conflict capture, not intuition alone
- prompt-led QA exists immediately
- structural/code validation can grow later without outrunning the evidence

## Why This Matters

The current prompt system already validates generated assets reasonably well.

What is less explicit is whether the upstream source documents are mature enough to deserve promotion into:
- prompt packs
- system rules
- operator guidance
- durable planning lanes

This pack addresses that missing control layer.

## Claude Optimization Notes

Optimize this pack for Claude by:
- starting with source-quality review prompts before adding automation
- keeping the first slice limited to curated promotion candidates
- using concrete source citations and status calls rather than abstract quality language
- preserving uncertainty where evidence is thin
- requiring explicit distinction between structural checks and human judgment

Avoid Claude anti-patterns:
- acting as though promotion timing can already be automated confidently
- trying to retrofit every `_dev` document in one pass
- converting exploratory notes into system rules without provenance and conflict capture

## Multi-Agent Functionality

- Main Claude thread owns the status model, promotion boundaries, and rollout sequencing.
- Use at most 2 read-only subagents for source-contract inventory and authoring-flow inventory.
- Use one write-owning worker slice at a time.
- Validation and completion audit remain read-only.
- Do not run parallel write workers across multiple planning/guidance surfaces in the first slice.

## Model Guidance

- Coordinator kickoff:
  - use the strongest implementation-capable Claude path available
  - keep promotion-boundary decisions in the main thread
- Explorer prompts:
  - use read-only Task/Explore style execution only
  - keep them bounded to source-readiness and authoring-flow analysis
- Worker prompts:
  - use an implementation-capable Claude path with tool access
  - keep the first write slice narrow and planning-focused
- Validation prompt:
  - use a read-only validation posture
  - verify that the staged QA design is internally coherent and not over-automated
- Completion audit prompt:
  - use a read-only auditor posture
  - focus on truthfulness, value-first rollout, and clear promotion boundaries

## How To Use This Pack

Run this pack in four implementation tasks:

1. source-status ladder and minimum contract
2. prompt-led QA flow
3. curated promotion-candidate pilot
4. structural validation roadmap

Then run:

5. validation
6. completion audit

Keep the first pass planning-heavy. Do not start by implementing a repo-wide validator.

## Value Prioritization

Treat these as the highest-value aspects first:
- a source-status ladder
- prompt-led QA prompts
- a minimum source-document contract

Treat these as later-value aspects:
- registry/schema formalization
- structural/code validation
- promotion controls that act automatically

The pack should improve source quality now while keeping automation proportional to the evidence.

## Recommended Near-Term Slice

If this pack is used soon, start with:
1. defining the source-status ladder
2. defining the minimum source-document contract
3. adding prompt-led QA prompts for promotion readiness
4. piloting the system on a curated source set only

Why this first:
- it improves prompt/system-rule promotion quality immediately
- it creates a real QA loop before code-heavy validation exists
- it avoids locking the repo into a premature automation model

Do not start with:
- repo-wide source-doc retrofits
- automatic promotion timing decisions
- heavy validation code before the pilot examples prove the contract

---

## Prompt 1: Coordinator Kickoff

```text
Design the first bounded source-material QA and promotion-readiness system for Mythos.

Read these files first:
- `_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`
- `_dev/MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md`
- `_dev/SOURCE_MATERIAL_QA_AND_PROMOTION_IMPLEMENTATION_PLAN.md`
- `_dev/concepts/multi-step-orchestration-abstraction.md`
- `_dev/concepts/cross-ai-dispatch-design-brief.md`
- `.claude/commands/author-prompt-system.md`
- `.claude/commands/assemble-prompt-system.md`
- `instructions/canonical/guardrails.md`

Goal:
- define when a source doc is only exploratory versus ready to become a prompt pack or system rule
- introduce QA immediately through prompts
- keep automation incremental and evidence-based
- avoid pretending promotion timing is fully solved

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for source-contract/evidence inventory
   - one for authoring-flow/promotion-boundary inventory
4. Synthesize findings in the main thread.
5. Implement exactly one bounded first slice.
6. Add or update planning guidance and prompt-system surfaces.
7. Run lightweight validation or consistency checks.
8. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. A source-status ladder exists.
2. A minimum source-document contract exists.
3. Prompt-led QA is defined as the first validation layer.
4. The first slice is explicitly limited to curated promotion candidates.
5. The design distinguishes structural validation from human judgment.

Final response must include:
- changed files
- source-status ladder defined
- QA flow added
- what remains intentionally manual
- what later validation/code work was deferred
```

## Prompt 2: Explorer A - Source Contract Inventory

```text
You are a read-only Task subagent.

Purpose:
Identify what evidence/provenance rules already exist in Mythos and what is missing for source-material promotion.

Read:
- `_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`
- `_dev/SOURCE_MATERIAL_QA_AND_PROMOTION_IMPLEMENTATION_PLAN.md`
- `.claude/commands/author-prompt-system.md`
- `.claude/commands/assemble-prompt-system.md`
- `instructions/canonical/guardrails.md`

Return exactly these sections:

Findings
- current source-readiness signals with file references
- missing source-contract elements with file references

Implementation notes
- smallest high-value source-contract additions
- what should remain human judgment for now

Risks
- premature schema lock-in
- over-automation risks
- promoting weak source material

Do not edit files.
```

## Prompt 3: Explorer B - Promotion Boundary Inventory

```text
You are a read-only Task subagent.

Purpose:
Analyze where source materials currently become prompt packs or system rules without an explicit readiness check.

Read:
- `_dev/MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md`
- `_dev/SOURCE_MATERIAL_QA_AND_PROMOTION_IMPLEMENTATION_PLAN.md`
- `_dev/prompts/claude-master-run-order.md`
- `.claude/commands/author-prompt-system.md`
- `.claude/commands/assemble-prompt-system.md`
- representative `_dev/prompts/` packs that were authored from planning docs

Return exactly these sections:

Findings
- current promotion boundaries with file references
- where readiness checks are implicit rather than explicit

Implementation notes
- best first promotion-readiness guidance
- best first curated pilot set

Risks
- slowing prompt authoring too much
- false confidence from shallow QA
- treating every planning doc as promotion-candidate material

Do not edit files.
```

## Prompt 4: Worker - First Source-Material QA Slice

```text
Implement the first bounded slice of source-material QA and promotion readiness in Mythos.

Ownership:
- planning docs for source-material QA
- prompt authoring and promotion guidance
- prompt-system planning surfaces if needed

You are not alone in the codebase. Do not revert edits by others.

Task:
- define the source-status ladder
- define the minimum source-document contract
- add prompt-led QA guidance
- keep validation automation as roadmap work unless a tiny structural check is obviously safe
- keep the rollout limited to curated promotion candidates

Constraints:
- do not retrofit the whole repo
- do not implement heavy code validation in the first slice
- do not pretend promotion decisions can already be made automatically

Final response must include:
- changed files
- first source-material QA slice implemented
- what validation exists now versus later
- remaining follow-up work
```

## Prompt 5: Validation Prompt

```text
Validate the first source-material QA and promotion-readiness slice.

Check:
1. The source-status ladder is explicit.
2. The minimum source contract is explicit.
3. The pack requires prompt-led QA now.
4. The pack keeps heavy automation deferred.
5. The rollout is limited to a curated pilot set rather than repo-wide retrofit.

Return:
- Findings
- Residual risks
- Recommendation

Do not edit files.
```

## Prompt 6: Completion Audit Prompt

```text
You are a read-only completion auditor.

Audit whether the first source-material QA slice is actually complete.

Verify:
1. The work adds a real source-readiness model rather than vague quality language.
2. The work distinguishes prompt-led QA, structural validation, and later code-heavy validation.
3. Promotion timing remains partially human because repo evidence is still limited.
4. The near-term slice is value-first and operationally usable.

Return:
- Blockers
- Warnings
- Info
- Completion verdict

Do not edit files.
```
