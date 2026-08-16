# Claude Prompt Pack: Dev-Only Meta Staged Remediation Framework

Prompt pack for extracting the current `_dev/prompts` orchestration into a deterministic, replayable `meta` framework candidate that remains restricted to development use for now.

Primary source material:
- [`claude-master-run-order.md`](./claude-master-run-order.md)
- [`claude-health-remediation-playbook.md`](./claude-health-remediation-playbook.md)
- [`claude-prompt-pack-semantic-verification.md`](./claude-prompt-pack-semantic-verification.md)
- [`claude-prompt-pack-project-health-alignment.md`](./claude-prompt-pack-project-health-alignment.md)
- [`claude-prompt-pack-candidate-replay-hardening.md`](./claude-prompt-pack-candidate-replay-hardening.md)
- [`claude-prompt-pack-semantic-output-audit.md`](./claude-prompt-pack-semantic-output-audit.md)
- [`frameworks/meta/execution-normalization/manifest.json`](../../frameworks/meta/execution-normalization/manifest.json)
- [`.claude/skills/manage-frameworks/references/framework-anatomy.md`](../../.claude/skills/manage-frameworks/references/framework-anatomy.md)
- [`.claude/skills/manage-frameworks/references/prompt-chain-patterns.md`](../../.claude/skills/manage-frameworks/references/prompt-chain-patterns.md)
- [`guides/framework-promotion.md`](../../guides/framework-promotion.md)

Primary build target:
- `_dev/framework-candidates/meta__staged-remediation/`

---

## Goal

Create a dev-only `meta` framework candidate that can:
- inspect repo state
- identify the next incomplete stage in a staged remediation plan
- execute exactly one bounded stage
- run validations for that stage
- emit deterministic handoff artifacts
- stop with an explicit go/no-go decision for the next stage

This is not a public framework build yet. It is an internal framework candidate for your development workflow.

## Dev-Only Restriction

Treat this work as development-only incubation.

Required restrictions:
- keep the framework under `_dev/framework-candidates/`
- do not register it in `instructions/canonical/system.yaml`
- do not add it under `frameworks/`
- do not wire it into user-facing commands or canonical docs
- do not claim it is production-ready or generally reusable yet

The first milestone is a strong framework candidate, not promotion.

## Verified Preconditions

Verify these before implementing:

1. `tools/codex/prompt-system/claude-master-run-order.md` is the current source of truth for stage ordering.
2. `tools/codex/prompt-system/claude-prompt-pack-semantic-verification.md` remains the first concrete stage to automate.
3. `frameworks/meta/execution-normalization/manifest.json` is the best existing model for a `meta` framework shape.
4. `.claude/skills/manage-frameworks/references/framework-anatomy.md` still reflects the current minimum framework anatomy.

If any of these are false in the active branch:
- stop and narrow the implementation scope
- update the candidate plan before generating framework assets

## Recommended Placement

Use this pack after the current prompt-system design is stable enough to extract.

Default use:
- after the current prompt packs and master run-order have been exercised successfully at least once
- before any attempt to register a general-purpose remediation framework

Reason:
- this work is about converting operator guidance into deterministic framework mechanics
- it should be extracted from proven behavior, not speculative workflow design

## How To Use This Pack

Run this pack as five Claude tasks, in order:

1. Prompt 1: coordinator kickoff
2. Prompt 2: framework contract inventory
3. Prompt 3: stage normalization inventory
4. Prompt 4: candidate skeleton and contract implementation
5. Prompt 5: Stage 1 pilot execution slice

Then run:

6. Prompt 6: validation
7. Prompt 7: completion audit

Do not try to automate all 13 stages in the first pass.

---

## Prompt 1: Coordinator Kickoff

Use this as the initial Claude prompt.

```text
Extract the current staged remediation workflow into a dev-only `meta` framework candidate.

Read these files first:
- `tools/codex/prompt-system/claude-master-run-order.md`
- `tools/codex/prompt-system/claude-health-remediation-playbook.md`
- `tools/codex/prompt-system/claude-prompt-pack-semantic-verification.md`
- `frameworks/meta/execution-normalization/manifest.json`
- `.claude/skills/manage-frameworks/references/framework-anatomy.md`
- `.claude/skills/manage-frameworks/references/prompt-chain-patterns.md`
- `guides/framework-promotion.md`

Goal:
- create a development-only framework candidate under `_dev/framework-candidates/meta__staged-remediation/`
- define a deterministic stage model
- implement only the Stage 1 pilot slice in executable form
- leave later stages as planned structure, not executable scope

Required execution pattern:
1. Read the source files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one for framework anatomy and contract design
   - one for source-stage normalization and artifact design
4. Synthesize their findings in the main thread.
5. Build the dev-only framework candidate in the main thread unless the write surface is cleanly separable.
6. Implement only the Stage 1 pilot prompts, schemas, docs, and state-artifact model.
7. Run validation against the candidate files.
8. Launch one read-only completion-auditor-style Task subagent.
9. Stop after Stage 1 pilot extraction; do not register or promote the framework.

Acceptance criteria:
1. A dev-only framework candidate exists under `_dev/framework-candidates/meta__staged-remediation/`.
2. The candidate includes a valid manifest, prompt chain, guardrails, schemas, docs, and replay-oriented artifact definitions.
3. The framework contract defines explicit stage inputs, outputs, validations, stop conditions, and next-stage decisions.
4. Only Stage 1 is executable in the first pass; later stages are represented as structured planned stages.
5. No edits register the framework in canonical system files or public-facing framework inventory.

Constraints:
- keep this candidate private to dev use
- do not add repo-wide automation hooks yet
- prefer deterministic artifacts over broad orchestration prose
- avoid inventing stages that are not grounded in the current master run-order

Final response must include:
- changed files
- candidate root
- Stage 1 pilot scope implemented
- validations run
- what remains intentionally deferred
```

## Prompt 2: Explorer A - Framework Contract Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Design the smallest correct framework contract for a dev-only `meta` staged-remediation candidate.

Read:
- `frameworks/meta/execution-normalization/manifest.json`
- `.claude/skills/manage-frameworks/references/framework-anatomy.md`
- `.claude/skills/manage-frameworks/references/prompt-chain-patterns.md`
- `guides/framework-promotion.md`

Return exactly these sections:

Findings
- recommended framework shape with file references
- minimum required components for a dev-only candidate

Contract proposal
- recommended `service_category`, `framework_name`, and execution modes
- recommended `input_contract`
- recommended `output_contract`
- recommended prompt-chain pattern for a Stage 1-only pilot

Risks
- any contract choices that would make later promotion harder
- any assumptions that should stay dev-only for now

Do not edit files.
```

## Prompt 3: Explorer B - Source Stage Normalization Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Normalize the current prompt-system orchestration into deterministic stage artifacts that a framework can execute.

Read:
- `tools/codex/prompt-system/claude-master-run-order.md`
- `tools/codex/prompt-system/claude-health-remediation-playbook.md`
- `tools/codex/prompt-system/claude-prompt-pack-semantic-verification.md`
- `tools/codex/prompt-system/claude-prompt-pack-project-health-alignment.md`
- `tools/codex/prompt-system/claude-prompt-pack-candidate-replay-hardening.md`
- `tools/codex/prompt-system/claude-prompt-pack-semantic-output-audit.md`

Return exactly these sections:

Findings
- all existing stages that are concrete enough to encode
- all parts that are still operator-judgment-heavy

Stage model proposal
- recommended Stage 1 boundaries
- exact stage inputs
- exact stage outputs
- exact validations
- stop conditions
- next-stage decision artifact shape

Risks
- any ambiguity that would make Stage 1 non-deterministic
- what should remain planned-only instead of executable in the first candidate

Do not edit files.
```

## Prompt 4: Worker - Candidate Skeleton And Contract

Use this as the main write-owning implementation prompt for the framework skeleton.

```text
Build the dev-only `meta` framework candidate skeleton.

Ownership:
- `_dev/framework-candidates/meta__staged-remediation/**`

You are not alone in the codebase. Do not revert edits made by others.

Task:
- create the candidate root under `_dev/framework-candidates/meta__staged-remediation/`
- add `proposed_framework/manifest.json`
- add `proposed_framework/guardrails.md`
- add `proposed_framework/docs/FRAMEWORK_SCOPE.md`
- add `proposed_framework/docs/STAGE_MODEL.md`
- add `proposed_framework/schemas/` for stage definition and stage-status artifacts
- add any minimal candidate metadata needed to keep the build coherent

Requirements:
- represent this as a dev-only framework candidate
- define a deterministic stage registry
- encode explicit state artifacts for stage execution and stage handoff
- define later stages as structured future stages, not executable prompts yet
- do not edit `frameworks/`
- do not edit `instructions/canonical/system.yaml`

Suggested artifact set:
- `_dev/framework-candidates/meta__staged-remediation/candidate.json`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/manifest.json`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/guardrails.md`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/docs/FRAMEWORK_SCOPE.md`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/docs/STAGE_MODEL.md`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/schemas/stage-definition.schema.json`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/schemas/stage-status.schema.json`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/schemas/next-stage-decision.schema.json`

Final response must include:
- changed files
- final candidate structure
- contract decisions made
- anything the Stage 1 prompt implementation still needs
```

## Prompt 5: Worker - Stage 1 Pilot Execution Slice

Use this after the skeleton exists.

```text
Implement the Stage 1 pilot execution slice for the dev-only staged-remediation framework candidate.

Ownership:
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/prompts/**`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/docs/**`
- `_dev/framework-candidates/meta__staged-remediation/proposed_framework/templates/**`
- `_dev/framework-candidates/meta__staged-remediation/replay_cases/**`

You are not alone in the codebase. Do not revert edits made by others.

Task:
- create only the prompt chain needed for Stage 1 semantic verification remediation
- make the prompts deterministic and artifact-oriented
- define the expected outputs for:
  - stage status
  - validation results
  - completion audit
  - next-stage decision
- add at least one replay-oriented example or fixture shape showing how Stage 1 should run

Requirements:
- Stage 1 must be executable in principle from the framework contract alone
- later stages must remain planned but non-executable in this first pass
- prompts should encode explicit inputs, outputs, success criteria, and stop rules
- preserve the dev-only restriction

Final response must include:
- changed files
- prompt chain created
- Stage 1 artifacts defined
- any remaining gaps before real replay testing
```

## Prompt 6: Validation Prompt

Use this after implementation.

```text
Validate the dev-only staged-remediation framework candidate.

Acceptance criteria:
1. The candidate exists under `_dev/framework-candidates/meta__staged-remediation/`.
2. The candidate has a coherent manifest, guardrails, docs, schemas, and Stage 1 prompt chain.
3. The framework contract defines deterministic stage artifacts and explicit go/no-go logic.
4. Only Stage 1 is executable in this first pass.
5. No canonical registration or public framework promotion changes were made.

Inspect the changed files and run any relevant local validation you can apply to the candidate structure.

Return:
- criterion-by-criterion pass/fail
- command evidence
- structural gaps
- what must happen before real replay/promotion use
```

## Prompt 7: Completion Audit Prompt

Use this as the final read-only audit.

```text
Act as a completion auditor for the dev-only staged-remediation framework candidate extraction.

Acceptance criteria:
1. The current prompt-system orchestration has been converted into a dev-only framework candidate shape.
2. The candidate is deterministic enough to execute Stage 1 with explicit artifacts.
3. Later stages remain intentionally deferred rather than half-implemented.
4. The candidate was not registered or promoted beyond dev-only scope.

Inputs to inspect:
- changed files
- candidate structure
- validation output

Return:
- PASS or FAIL
- blocker, warning, and info findings
- evidence for each finding
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
