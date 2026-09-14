| Probe | Discoverable | Authority / result |
|---|---|---|
| Direct skill `go` | **Yes** | Direct project-skill authority: `.agents/skills/go/SKILL.md`. It wraps `/run-plan`, whose canonical authority is `instructions/canonical/commands/run-plan.yaml`; it adds no new gate. |
| Canonical command skill `source-command-ground-in-philosophy` | **Yes** | Canonical authority: `instructions/canonical/commands/ground-in-philosophy.yaml`. Capability tier: **ADVISORY**. |
| Alias `/tt` via `ticktock` | **Yes, declared** | The exposed `ticktock` skill explicitly declares `/tt`. **No independent behavioral authority:** `/tt` resolves to `ticktock`; the registry/canonical resolution remains authoritative. |
| Framework helper `guild-wordpress-qa-qa-rerun-verify` | **No** | Absent from the runtime catalog; capability/authority: **UNKNOWN**. No staged disk candidate was inspected. |

Read-only probe completed; no workflows ran and no files were edited.
