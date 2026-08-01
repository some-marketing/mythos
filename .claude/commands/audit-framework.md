---
description: Validate framework structure and references
mode: REVIEW_ONLY
---

<objective>
Validate a framework's structure, prompt chain, schemas, guardrails, and Claude assets by reading the manifest and dispatching parallel validation subagents, then merge results into a unified audit report.
</objective>

<process>
- Parse arguments for <framework-path>. If missing, prompt the user.
- Read and parse manifest.json from the framework root. Extract the prompt chain, output contract, execution modes, and harness paths. This data is distributed to the parallel subagent groups.
- Spawn 4 parallel framework-auditor subagents (all read-only with Read, Grep, Glob tools): Group 1 validates prompt chain and cross-references (all numbered prompts exist, chain continuity, manifest path references resolve). Group 2 validates schemas and output contract (JSON Schema validity, output_contract_v2 schema_ref resolution, bundle_type required_files). Group 3 validates guardrails coverage (guardrails.md exists, covers all declared execution modes, has required sections). Group 4 validates Claude assets (SKILL.md frontmatter and structure, command .md frontmatter, agent .md frontmatter).
- Wait for all 4 subagent groups to complete.
- Merge and report: collect results from all subagent groups and generate a unified audit report with PASS/FAIL per check, organized by group.
- Report to user: framework identity, per-group check results, issues found, and improvement suggestions.
</process>

<success_criteria>
- Framework manifest read and parsed before validation
- All 4 validation groups executed in parallel
- Prompt chain continuity verified
- Schema validity confirmed
- Guardrails coverage confirmed for all execution modes
- Claude assets validated for proper frontmatter and structure
- Unified audit report produced with per-check PASS/FAIL
</success_criteria>

<handoff>
issues_found: improve-framework <framework-path>
all_checks_pass: No action needed
schema_issues: Fix schemas and re-audit
guardrails_gaps: Update guardrails.md and re-audit
</handoff>
