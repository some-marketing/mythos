# Framework Prompts

These are the **canonical prompts** for the Playwright Phased Runner framework. Use these prompts to guide agents (or humans) through the test lifecycle.

---

## Prompt Index

| # | Prompt | Type | Mode | Purpose |
|---|--------|------|------|---------|
| 01 | [Intake and Scaffold](./01_INTAKE_AND_SCAFFOLD.md) | Atomic | PATCH_ALLOWED | Set up a new testcase |
| 02 | [Locators and Correction](./02_LOCATORS_AND_CORRECTION.md) | Atomic | PATCH_ALLOWED | Validate and fix locator map via browser walkthrough |
| 03 | [Report and Dev Handoff](./03_REPORT_AND_DEV_HANDOFF.md) | Atomic | — | Analyze results, create handoffs |
| 04 | [Parallel Run Manager](./04_PARALLEL_RUN_MANAGER.md) | **Playbook** | RUN_ONLY | Orchestrate A/B/C parallel runs + triage |
| 05 | [MCP Walkthrough (Findings Only)](./05_MCP_WALKTHROUGH_FINDINGS_ONLY.md) | Atomic | FINDINGS_ONLY | Observe UI/DOM issues (no fixes) |
| 06 | [Iterate Until Pass](./06_ITERATE_UNTIL_PASS.md) | **Playbook** | COORDINATOR | Orchestrate run → fix → rerun loop |
| 07 | [Implement Fixes](./07_IMPLEMENT_FIXES.md) | Atomic | PATCH_ALLOWED | Apply minimal repo changes |
| 08 | [Re-run Verification](./08_RERUN_VERIFY.md) | Atomic | RUN_ONLY | Rerun failing envs in fresh runset |
| 09 | [Shared Blocks](./09_SHARED_BLOCKS.md) | **Reference** | — | Shared rules, templates, interview gates |
| 10 | [Deep Pipeline Analysis](./10_DEEP_PIPELINE_ANALYSIS.md) | Atomic | REVIEW_ONLY | Trace identity → WPForms → CRM |
| 11 | [Cross-run Anomaly Index](./11_CROSS_RUN_ANOMALY_INDEX.md) | Atomic | REVIEW_ONLY | Trend/regression view across runsets |
| 12 | [Dev Packet Generator](./12_DEV_PACKET_GENERATOR.md) | Atomic | REVIEW_ONLY | High-signal developer packet |
| 13 | [Payload Analysis + {DEVELOPER_NAME} Handoff](./13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md) | **Playbook** | REVIEW_ONLY | Payload comparison + new handoff bundle |
| 14 | [Append Payload Reporting](./14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md) | **Playbook** | REVIEW_ONLY | Append runs to existing handoff bundle |
| 15 | [Navigation Cleanup + Deprecation](./15_NAVIGATION_CLEANUP_AND_DEPRECATION.md) | Atomic | REPO_HYGIENE | Archive/deprecate duplicates, fix links |
| 16 | [Changelog Capture](./16_CHANGELOG_CAPTURE_FROM_DEV.md) | Atomic | PATCH_ALLOWED | Collect dev changelog for QA context |

---

## Prompt Types

- **Atomic**: Self-contained, focused task with detailed instructions. Contains its own step-by-step procedure.
- **Playbook**: Orchestrator that references canonical sub-prompts. Thin by design — delegates work to atomic prompts. Includes delegation plan, acceptance criteria, and failure modes.
- **Reference**: Shared definitions and templates referenced by other prompts. Not directly executable.

---

## Shared Blocks (09)

All prompts reference `09_SHARED_BLOCKS.md` for:
- **§ A** — Standard input names
- **§ B** — Operating rules and execution modes
- **§ C** — Report templates
- **§ D** — Naming conventions
- **§ E** — Observational reporting philosophy
- **§ F** — Stakeholder Interview Gate (triggers when discrepancies exist)
- **§ G** — Subagent delegation language
- **§ H** — Reporting requirements interview
- **§ I** — Per-run intake items (for payload analysis)

---

## Workflow

```
Setup Phase:
01 INTAKE → 02 LOCATOR CORRECTION

Execution Phase:
04 PARALLEL RUN (A/B/C) → 03 REPORT & HANDOFF

Iteration Phase (for failures):
06 ITERATE UNTIL PASS (coordinator)
  ├── 04 PARALLEL RUN ──→ Stakeholder Gate (§F) if ambiguous
  ├── 05 MCP WALKTHROUGH (diagnose)
  ├── 07 IMPLEMENT FIXES (patch)
  └── 08 RERUN VERIFY (verify)

Analysis Phase (as needed):
├── 10 DEEP PIPELINE ANALYSIS (exports)
├── 11 CROSS-RUN ANOMALY INDEX (trends)
├── 12 DEV PACKET GENERATOR (handoff)
├── 13 PAYLOAD ANALYSIS + HANDOFF ──→ Stakeholder Gate (§F)
├── 14 APPEND PAYLOAD REPORTING ──→ Stakeholder Gate (§F)
├── 15 NAVIGATION CLEANUP (repo hygiene)
└── 16 CHANGELOG CAPTURE (dev context)

Reference:
09 SHARED BLOCKS (rules, templates, gates)
```

---

## Subagent Delegation

Playbook prompts support optional subagent delegation per `09_SHARED_BLOCKS.md` § G:
- If subagents are available, delegate sub-tasks in parallel
- If subagents are NOT available, the playbook is executable sequentially
- Subagents follow the same guardrails as the parent prompt

Standard subagent roles (§ G): Cookies Scan, dataLayer Scan, Console/Network Scan, Exports/Payload Compare, Cross-env Synthesis, Evidence Scan.

---

## Stakeholder Interview Gate

Playbooks and analysis prompts include a **Stakeholder Interview Gate** (defined in `09_SHARED_BLOCKS.md` § F) that triggers when discrepancies exist between expected and observed behavior. The gate:
1. Pauses execution to gather context
2. Presents observations and asks clarifying questions
3. Records answers to `stakeholder_answers.md`
4. Uses answers to classify items as NOTE (expected), ISSUE (unexpected), or UNKNOWN (unavailable)

Prompts with this gate: **03**, **06**, **13**, **14**.

---

## Prompt Design Principles

1. **Framework-generic** — No project-specific language or assumptions
2. **Agent-ready** — Can be given directly to a browser-capable agent
3. **Agent-platform agnostic** — Works with MCP, browser DevTools, or manual processes
4. **Structured output** — Define expected formats for reproducibility
5. **Progressive** — Each prompt builds on the previous stage
6. **Self-contained** — Atomic prompts include enough context to execute independently
7. **Thin playbooks** — Playbooks reference canonical sub-prompts instead of embedding them
8. **Evidence-driven** — Every claim backed by file path
9. **Observational** — Describe observations and hypotheses, not diagnoses

---

## Deprecated Prompts

Previous prompt locations are deprecated. Use these canonical versions instead:

| Deprecated Location | Replaced By |
|---------------------|-------------|
| `docs/AGENT_ASSIST_LOCATOR_PROMPT.md` | 01_INTAKE_AND_SCAFFOLD.md |
| `docs/template_prompts/*` | `framework/prompts/_archive/legacy_template_prompts/` (archived) |
| `template_repo/prompts/*` | These canonical prompts |
| `BROWSER_AGENT_AUTOMATION_INTAKE_PROMPT.md` | 01_INTAKE_AND_SCAFFOLD.md |

---

## Contributing

When updating prompts:

1. Keep prompts framework-generic (no client names, no site-specific URLs)
2. Classify as Atomic, Playbook, or Reference
3. Atomic prompts: include detailed instructions with explicit Inputs/Outputs/Guardrails
4. Playbook prompts: keep thin — reference sub-prompts, define delegation + acceptance criteria
5. Reference `09_SHARED_BLOCKS.md` for shared rules instead of duplicating content
6. Test with actual agent execution
7. Update this README if adding new prompts
