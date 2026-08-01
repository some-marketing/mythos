# .claude/CLAUDE.md

> AUTO-GENERATED PREVIEW FILE. Canonical source: `instructions/canonical/*`.

## Scope
Mythos project-level behavioral policy.

## Safety
- Never expose PII, credentials, API keys, or .env values
- Never treat private local substrates as default frontier-model context; route private surface access through substrate-specific allowance, query bounds, redaction, and receipt rules in instructions/canonical/private-surface-introspection-rule.yaml
- Disclose the model/mind for every subagent and bridge dispatch at dispatch time, and tier the dispatched mind to the work altitude per instructions/canonical/dispatch-routing-rule.yaml; same-model Claude subagents are parallel contexts, not distinct intelligence
- Never write client-specific data into frameworks
- Never skip declared execution mode constraints
- Never run destructive operations without explicit confirmation
- Use observational reporting: observations and hypotheses, not diagnoses
- When a role term such as operator, user, agent, or reviewer could refer to more than one actor, name the actor explicitly (for example: human, Codex agent, Claude agent). If the intended actor is ambiguous, ask instead of assuming.

## Modes
| Mode | Can Write | Can Execute | Description |
|---|---|---|---|
| FINDINGS_ONLY | false | false | Observe and report only |
| RUN_ONLY | reports_only | true | Execute runs without applying fixes |
| REVIEW_ONLY | analysis_only | false | Analyze existing outputs |
| PATCH_ALLOWED | scoped | true | Apply minimal targeted changes |
| COORDINATOR | delegated | delegated | Orchestrate sub-workflows |
| REPO_HYGIENE | docs_cleanup | false | Navigation and cleanup only |

## Agents
- `framework-auditor`: Read-only structure and policy validation
- `framework-executor`: Prompt execution with mode enforcement
- `output-reviewer`: Output quality validation
- `completion-auditor`: Evidence-based completion verification against acceptance criteria
- `extract-skill-agent`: Conversation workflow analysis and skill artifact generation
- `lifecycle-auditor`: Lifecycle hook execution verification and drift detection
- `capture-normalizer`: Lightweight capture bundle normalization for parallel batch processing
- `signal-normalizer`: Bounded signal-surface maintenance: closing stale, consumed, or duplicate coordination signals

## Orchestration Policy
- Completion auditing: required_for_substantial_changes
- Max reopen cycles: 2
- Audit exemptions: FINDINGS_ONLY, REVIEW_ONLY, REPO_HYGIENE
- Evidence required: changed_files, test_results, acceptance_criteria
