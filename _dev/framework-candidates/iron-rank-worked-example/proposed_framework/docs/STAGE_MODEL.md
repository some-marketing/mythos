# Stage Model

## Execution Rule

This framework executes exactly one stage per run.

The stage model is intentionally aligned with [`_dev/concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md`](../../../../concepts/LEARNING_AND_AUTOMATION_DOCTRINE.md):
- stage prompts carry the reasoning burden first
- validations and audits determine whether a stage truly succeeded
- only repeated proven mechanics should later move into code automation

Each stage must declare:
- `stage_id`
- purpose
- allowed write scope
- validation commands
- exit criteria
- stop conditions
- next-stage behavior

## Stage Registry

| Stage | Title | Executable Now | Notes |
|---:|---|---|---|
| 1 | Semantic verification and framework coverage | yes | First pilot slice |
| 2 | AI bridge stabilization and housekeeping | no | Planned only |
| 3 | Core deterministic workflow scripts | no | Planned only |
| 4 | Thin orchestrator pipeline | no | Planned only |
| 5 | Real-world trial and operator feedback | no | Planned only |
| 6 | Packaging and deliverables | no | Planned only |
| 7 | Skill integration | no | Planned only |
| 8 | Project/runtime health alignment | no | Planned only |
| 9 | Semantic output audit hardening | no | Planned only |
| 10 | Candidate replay hardening | no | Planned only |
| 11 | Subagent autonomy and template efficiency | no | Planned only |
| 12 | Multi-turn / retry logic | no | Planned only |
| 13 | Framework registration | no | Planned only |

## Stage 1 Contract

Stage 1 is successful only if:
- unresolved `prompt_chain` references fail verification
- the main verification workflow covers all registered frameworks
- targeted tests exist for the new behavior
- current manifest drift is fixed or intentionally surfaced by validation

Stage 1 stop conditions:
- canonical framework inventory cannot be derived safely
- verifier logic change would require framework-specific hardcoding
- test coverage cannot demonstrate the new behavior

Stage 1 next-stage rule:
- advance only if all Stage 1 exit criteria are met and no blocker remains
