# Execution Modes

Modes constrain what the LLM can do during framework execution.

| Mode | Writes Files | Runs Tasks | Modifies Code | Use Case |
|------|-------------|------------|---------------|----------|
| FINDINGS_ONLY | No | No | No | Observe and document only |
| RUN_ONLY | Reports only | Yes | No | Execute and report |
| REVIEW_ONLY | Reports only | No | No | Analyze existing artifacts |
| PATCH_ALLOWED | Yes (minimal) | Optional | Yes (scoped) | Apply targeted fixes |
| COORDINATOR | Delegates | Delegates | Delegates | Orchestrate sub-workflows |
| REPO_HYGIENE | Yes (docs) | No | No (no logic) | File moves and organization |

## Choosing a Mode
- Start with the most restrictive mode that works
- FINDINGS_ONLY for observation/analysis steps
- RUN_ONLY for automated execution steps
- PATCH_ALLOWED only when the prompt must write/modify files
- COORDINATOR only for orchestration prompts
