# .claude/CLAUDE.md

> AUTO-GENERATED PREVIEW FILE. Canonical source: `instructions/canonical/*`.

## Scope
Mythos project-level behavioral policy.

## Safety
- Never expose PII, credentials, API keys, or .env values
- Never write client-specific data into frameworks
- Never skip declared execution mode constraints
- Never run destructive operations without explicit confirmation
- Use observational reporting: observations and hypotheses, not diagnoses
- Contribution workflow: always work on a feature branch and open a pull request — never commit or push directly to `main`

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

## Orchestration Policy
- Completion auditing: required_for_substantial_changes
- Max reopen cycles: 2
- Audit exemptions: FINDINGS_ONLY, REVIEW_ONLY, REPO_HYGIENE
- Evidence required: changed_files, test_results, acceptance_criteria
