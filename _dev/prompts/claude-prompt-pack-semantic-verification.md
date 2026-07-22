# Claude Prompt Pack: Semantic Verification And Framework Coverage

Prompt pack for fixing the verifier blind spots around prompt-chain resolution and incomplete framework coverage.

Primary target files:
- [`tools/verify/verify-framework.cjs`](../../tools/verify/verify-framework.cjs)
- [`package.json`](../../package.json)
- [`frameworks/wordpress/design-research/manifest.json`](../../frameworks/wordpress/design-research/manifest.json)
- [`frameworks/wordpress/qa/manifest.json`](../../frameworks/wordpress/qa/manifest.json)
- relevant tests under [`tests/instructions/`](../../tests/instructions/)

## Prompt 1: Coordinator Kickoff

Use this as the initial Claude prompt.

```text
Fix the semantic verification gaps in Mythos.

Read these files first:
- `_dev/prompts/claude-health-remediation-playbook.md`
- `tools/verify/verify-framework.cjs`
- `package.json`
- `frameworks/wordpress/design-research/manifest.json`
- `frameworks/wordpress/qa/manifest.json`
- `tests/instructions/framework-manifest-schema.test.js`

Goal:
- make framework verification fail when manifest prompt_chain entries do not resolve to real prompt files
- make the main verification workflow cover all registered frameworks, not just a hardcoded subset
- add tests that prove the new behavior

Known repo facts you must account for:
- `wordpress/design-research` currently references non-existent prompts
- `wordpress/qa` currently references a stale prompt id in its manifest
- `verify:all` only covers part of the registered framework inventory

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only Task subagents in parallel:
   - one to inventory verifier logic gaps
   - one to inventory framework manifest mismatches and coverage gaps
4. Synthesize their findings.
5. Implement the fixes in the main thread unless the test write surface is cleanly separable.
6. Add or update tests.
7. Run validation.
8. Launch one read-only completion-auditor-style Task subagent.
9. Reopen only blocker items if needed.

Acceptance criteria:
1. `verify-framework` fails if any `prompt_chain` entry references a non-existent prompt file.
2. The verification workflow covers every framework registered in `instructions/canonical/system.yaml`.
3. Tests exist for the new semantic prompt resolution behavior.
4. Current manifest drift is either fixed or explicitly surfaced by validation.
5. No framework-specific rules are hardcoded into the verifier.

Constraints:
- keep changes targeted
- preserve current signal format unless a change is clearly necessary
- avoid broad refactors unrelated to verifier correctness

Final response must include:
- changed files
- validations run
- whether existing manifest drift was fixed or intentionally surfaced
- residual risks
```

## Prompt 2: Explorer A - Verifier Logic Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Audit the current framework verifier for semantic blind spots.

Read:
- `tools/verify/verify-framework.cjs`
- `tools/verify/lib/checks.cjs`
- `tests/instructions/framework-manifest-schema.test.js`

Return exactly these sections:

Findings
- concrete verifier gaps with file and line references

Implementation notes
- smallest safe change to detect unresolved `prompt_chain` prompt ids
- whether the check belongs in verifier logic, schema, tests, or all three

Risks
- any likely false positives
- any current framework patterns that the new rule must tolerate

Do not edit files.
```

## Prompt 3: Explorer B - Framework Coverage Inventory

Use this in a read-only Task subagent.

```text
You are a read-only Task subagent.

Purpose:
Inventory framework coverage gaps in the current verification entrypoints.

Read:
- `package.json`
- `instructions/canonical/system.yaml`
- `frameworks/wordpress/design-research/manifest.json`
- `frameworks/wordpress/qa/manifest.json`

Return exactly these sections:

Findings
- all mismatches between registered frameworks and `verify:all` coverage
- all currently visible prompt-chain reference mismatches

Implementation notes
- safest way to derive framework ids from the canonical registry
- whether any manifests need direct cleanup

Risks
- ordering assumptions
- any impact on CI time or developer ergonomics

Do not edit files.
```

## Prompt 4: Optional Worker - Tests Only

Use only if you split write ownership cleanly.

```text
You are a write-owning Task subagent.

Ownership:
- `tests/instructions/*`
- other new verifier tests only if required

You are not alone in the codebase. Do not revert edits by others.

Task:
- add tests for unresolved `prompt_chain` references
- add tests or assertions that prevent partial framework coverage in the main verification flow

Constraints:
- do not edit production code outside your ownership
- keep test fixtures minimal
- align with existing test style

Return:
- changed files
- what behavior the new tests prove
- any remaining gaps the coordinator must finish in the main thread
```

## Prompt 5: Validation Prompt

Use this after implementation.

```text
Validate the semantic verification remediation.

Acceptance criteria:
1. `verify-framework` now fails on unresolved prompt-chain references.
2. `verify:all` covers all canonically registered frameworks.
3. Tests cover both behaviors.
4. No framework-specific hardcoding was introduced.

Run the relevant validation commands and inspect changed files.

Return:
- criterion-by-criterion pass/fail
- command evidence
- any remaining drift still present in manifests
```

## Prompt 6: Completion Audit Prompt

Use this as the final read-only audit.

```text
Act as a completion auditor for the semantic verification remediation.

Acceptance criteria:
1. Semantic prompt-chain resolution is mechanically checked.
2. The main verification path covers the full registered framework set.
3. Tests prove the new behavior.
4. The implementation remains framework-agnostic.

Inputs to inspect:
- changed files
- test output
- verifier output

Return:
- PASS or FAIL
- blocker, warning, and info findings
- evidence for each finding
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
