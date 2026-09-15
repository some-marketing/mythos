| Probe | Discoverable | Authority / result |
|---|---|---|
| Direct skill `go` | **Yes** | Direct project-skill authority: `.agents/skills/go/SKILL.md`. It wraps `/run-plan`, whose canonical authority is `instructions/canonical/commands/run-plan.yaml`; it adds no new gate. |
| Canonical command skill `source-command-ground-in-philosophy` | **Yes** | Canonical authority: `instructions/canonical/commands/ground-in-philosophy.yaml`. Capability tier: **ADVISORY**. |
| Direct skill `ticktock` | **No** | The required `meditate` dependency is absent, so the projector records `ABSENT / dependency_unavailable` and does not expose `.agents/skills/ticktock/SKILL.md`. |
| Alias `/tt` via `ticktock` | **No** | `/tt` resolves to the unavailable `ticktock` target and is recorded `ABSENT / target_unavailable`; no alias body is generated. |
| Framework helper `guild-wordpress-qa-qa-rerun-verify` | **No** | Absent from the runtime catalog; capability/authority: **UNKNOWN**. No staged disk candidate was inspected. |

Fresh read-only `codex exec --ephemeral --sandbox read-only` probe completed; no workflows ran and no files were edited. The runtime emitted unrelated unavailable-local-MCP transport warnings and a skill-context budget warning, so negative discovery results were corroborated against the applied catalog and current projection receipts.
