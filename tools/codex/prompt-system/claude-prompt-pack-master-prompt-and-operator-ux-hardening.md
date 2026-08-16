# Claude Prompt Pack: Master Prompt And Operator UX Hardening

Prompt pack for converting session-level interaction lessons into durable improvements to Mythos prompt structure, command flow, and operator UX.

Primary source material:
- [`_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`](../concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md)
- [`_dev/MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md`](../MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md)
- [`tools/codex/prompt-system/claude-master-run-order.md`](./claude-master-run-order.md)

Primary target files:
- prompt authoring guidance
- prompt-system command docs
- framework/prompt creation references
- master-run-order and related operator-facing planning surfaces as needed

## Goal

Improve Mythos so future prompt packs, command flows, and operator-facing guidance reflect the real interaction lessons from this session rather than repeating the same ambiguities.

Desired outcome:
- prompt packs inherit explicit operational structure by default
- operator command transitions are easier to understand
- harness-truth language is clearer
- value-first sequencing is reflected in prompt-system guidance
- major integrated sequences end with a formal debrief/validation/clear-readiness closeout

## Why This Matters

The session showed that the hardest problems were not just implementation gaps.

They were also:
- command-intent ambiguity
- harness-truth mismatch
- missing prompt-pack execution standards
- architecture breadth outrunning immediate value

These are master-prompt and operator-UX issues, not isolated file issues.

The session also clarified that major integrated work needs a better ending state:
- debrief first
- reflection when warranted
- validation before clear
- explicit `clear` recommendation only when the sequence is truly safe to clear

## Claude Optimization Notes

Optimize this pack for Claude by:
- favoring methodology and operator-UX fixes before broad prompt rewrites
- keeping the first implementation slice narrow and high-leverage
- using read-only subagents only for bounded inventory and gap analysis
- requiring concrete changes to guidance surfaces, not abstract conversation summaries
- forcing validation/review of changed prompt-system surfaces before completion claims

Avoid Claude anti-patterns:
- treating a session-review doc as sufficient without converting it into system rules
- rewriting the full master prompt in one pass
- improving wording without fixing command-flow ambiguity underneath

## Multi-Agent Functionality

- Main Claude thread owns synthesis, command-flow judgment, and go/no-go decisions.
- Use at most 2 read-only subagents for inventory or operator-UX impact analysis.
- Use one write-owning worker slice at a time.
- Validation and completion audit remain read-only.
- If multiple write slices are needed, leave later slices as explicit follow-up work.

## Model Guidance

- Coordinator kickoff:
  - use the strongest implementation-capable Claude path available
  - keep interaction-model judgment in the main thread
- Explorer prompts:
  - use read-only Task/Explore style execution only
  - keep them bounded to inventory and interaction-gap analysis
- Worker prompts:
  - use an implementation-capable Claude path with tool access
  - keep ownership limited to the declared guidance surfaces
- Validation prompt:
  - use a read-only validation posture
  - verify the changed prompt/guidance surfaces rather than widening into new implementation
- Completion audit prompt:
  - use a read-only auditor posture
  - focus on operator clarity, harness truthfulness, and structural improvement

## How To Use This Pack

Run this pack in four implementation tasks:

1. prompt-pack structural standard hardening
2. command-flow UX clarification
3. harness-truth and adapter-language hardening
4. master-prompt flow alignment and sequence closeout hardening

Then run:

5. validation
6. completion audit

Keep the first pass bounded. Do not start with a broad top-to-bottom prompt rewrite.

## Recommended Near-Term Slice

If this pack is used soon, start with:
1. making prompt-pack structural sections part of formal creation methodology
2. clarifying review vs author vs assemble vs plan vs advance in operator-facing guidance
3. tightening harness-truth language where command behavior differs by adapter
4. adding the debrief -> reflection -> validation -> clear-readiness closeout rule for major integrated sequences

Why this first:
- it improves the operator experience immediately
- it prevents the same confusion from recurring in future prompt packs
- it grounds master-prompt improvements in concrete workflow surfaces
- it prevents premature context clearing after larger cross-system implementations

Do not start with:
- a full master-prompt rewrite before methodology changes land
- cosmetic prompt wording cleanup without command-flow clarification
- speculative GPT redesign disconnected from actual prompt-system surfaces

---

## Prompt 1: Coordinator Kickoff

```text
Harden the Mythos master prompt flow and operator UX using the lessons captured from the session interaction review.

Read these files first:
- `_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`
- `_dev/MASTER_PROMPT_AND_OPERATOR_UX_IMPLEMENTATION_PLAN.md`
- `tools/codex/prompt-system/claude-master-run-order.md`
- `.claude/commands/author-prompt-system.md`
- `.claude/commands/assemble-prompt-system.md`
- `.claude/commands/plan-pipeline.md`
- `.claude/commands/review-progress.md`
- `.claude/skills/manage-frameworks/references/framework-anatomy.md`
- `.claude/skills/manage-frameworks/references/prompt-chain-patterns.md`

Goal:
- turn the session lessons into durable prompt-system and operator-UX rules
- improve methodology before broad prompt rewriting
- keep harness-truth and command-intent boundaries explicit
- add a durable closeout rule for major integrated implementation sequences

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for prompt-pack/methodology inventory
   - one for command-flow/operator-UX inventory
4. Synthesize findings in the main thread.
5. Implement exactly one bounded first slice.
6. Add or update validation/review artifacts where practical.
7. Run relevant validation or structural checks.
8. Launch one read-only completion-auditor-style Task subagent.

Acceptance criteria:
1. Session lessons are converted into prompt-system rules, not left as a standalone memo.
2. Prompt-pack structure improves for future authoring.
3. Operator command flow becomes clearer.
4. Harness-truth language is more explicit where needed.
5. Major integrated sequences have a truthful debrief/validation/clear-readiness closeout rule.
6. The first pass stays bounded and high-value.

Final response must include:
- changed files
- which interaction lessons became system rules
- validations/reviews run
- whether closeout behavior changed
- what remains deferred
```

## Prompt 2: Explorer A - Methodology Inventory

```text
You are a read-only Task subagent.

Purpose:
Identify where the framework/prompt creation methodology already supports the needed interaction lessons and where it still relies on convention instead of explicit standards.

Read:
- `_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`
- `.claude/skills/manage-frameworks/workflows/create-framework.md`
- `.claude/skills/manage-frameworks/references/framework-anatomy.md`
- `.claude/skills/manage-frameworks/references/prompt-chain-patterns.md`
- representative prompt packs under `tools/codex/prompt-system/`

Return exactly these sections:

Findings
- what standards already exist with file references
- what is still implicit or inconsistent

Implementation notes
- smallest high-value methodology upgrades
- where prompt-pack structural standards should live

Risks
- over-standardization risks
- standards that may be too Claude-specific

Do not edit files.
```

## Prompt 3: Explorer B - Operator UX Inventory

```text
You are a read-only Task subagent.

Purpose:
Analyze where operator-facing command flow is still ambiguous and where harness-truth language needs hardening.

Read:
- `_dev/concepts/SESSION_INTERACTION_AND_SYSTEMIZATION_REVIEW__2026-03-27.md`
- `tools/codex/prompt-system/claude-master-run-order.md`
- `.claude/commands/review-progress.md`
- `.claude/commands/author-prompt-system.md`
- `.claude/commands/assemble-prompt-system.md`
- `.claude/commands/plan-pipeline.md`
- `AGENTS.md`

Return exactly these sections:

Findings
- current UX ambiguities with file references
- current harness-truth ambiguities with file references

Implementation notes
- best first command-flow clarifications
- best first master-prompt flow clarifications

Risks
- adding too many near-neighbor commands
- hiding important decision boundaries through over-automation

Do not edit files.
```

## Prompt 4: Worker - First UX Hardening Slice

```text
Implement the first bounded slice of master-prompt and operator-UX hardening in Mythos.

Ownership:
- prompt authoring guidance
- framework/prompt creation references
- operator-facing prompt-system command docs
- master-run-order or related planning surfaces if required

You are not alone in the codebase. Do not revert edits by others.

Task:
- convert the highest-value session lessons into durable guidance
- improve prompt-pack structure and operator clarity
- keep the first slice narrow and validated

Constraints:
- do not rewrite the entire prompt system in one pass
- do not widen scope into unrelated architecture work
- prefer methodology and guidance fixes over cosmetic phrasing changes

Final response must include:
- changed files
- first UX-hardening slice implemented
- validation/review changes made
- remaining follow-up work
```

## Prompt 5: Validation Prompt

```text
Validate the first master-prompt and operator-UX hardening slice.

Acceptance criteria:
1. Session lessons were converted into system guidance.
2. Prompt-pack structural standards improved.
3. Operator command flow is clearer.
4. Harness-truth language is more explicit where needed.
5. The first slice stayed bounded and high-value.

Run relevant validation or structural checks and inspect changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- remaining UX risks
```

## Prompt 6: Completion Audit Prompt

```text
Act as a completion auditor for the master-prompt and operator-UX hardening work.

Acceptance criteria:
1. The system absorbed real session lessons rather than leaving them as a memo.
2. Prompt creation methodology is stronger.
3. Operator-facing command flow is clearer and more truthful.
4. The work improved structure, not just wording.

Return:
- PASS or FAIL
- blocker, warning, and info findings
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
