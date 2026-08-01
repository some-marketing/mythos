# Audit Framework Workflow

## Steps

### Step 1: Manifest Load (Orchestrator)

1. **[AUTO] Read manifest.json** — Parse and validate structure. Extract the framework root path, prompt chain, output contract, execution modes, and harness paths. This data is distributed to the parallel subagent groups below.

### Step 2: Parallel Validation (4 Subagent Groups)

Spawn 4 `framework-auditor` subagents simultaneously with `mode: "auto"`. Each receives the parsed manifest and the framework root path. All are read-only (Read, Grep, Glob only).

**Group 1 — Prompt Chain & Cross-References:**
- Verify all numbered prompts in `prompt_chain` exist as files under `prompts/`
- Verify prompt chain continuity (output of prompt N feeds input of prompt N+1)
- Cross-reference check: verify all manifest path references (`skills_path`, `commands_path`, `agents_path`, `harness_paths`) resolve to actual directories or files

**Group 2 — Schemas & Output Contract:**
- Validate all referenced schemas parse as valid JSON Schema
- If manifest has `output_contract_v2`:
  - Verify `schemas/output/` directory exists
  - Verify each `schema_ref` in `output_contract_v2` resolves to an existing file
  - Verify each `bundle_type` has non-empty `required_files`
- If manifest only has `output_contract` (v1): emit info finding noting typed contract is available

**Group 3 — Guardrails Coverage:**
- Verify `guardrails.md` exists in the framework root
- Verify guardrails covers all declared `execution_modes` from the manifest
- Check for required sections: Core Rules, Execution Modes

**Group 4 — Claude Assets (Skills, Commands, Agents):**
- Validate all SKILL.md files have proper YAML frontmatter and XML structure
- Validate all command .md files have `description` in YAML frontmatter
- Validate all agent .md files have `name`, `description`, `tools` in YAML frontmatter

### Step 3: Report (Orchestrator)

3. **[AUTO] Merge and report** — Collect results from all 4 subagent groups. Generate unified audit report with PASS/FAIL per check, preserving the same output format as before.

## Subagent Orchestration

| Subagent | Scope | Agent | Mode | Tools |
|---|---|---|---|---|
| Group 1 | Prompt chain + cross-refs | `framework-auditor` | `auto` | Read, Grep, Glob |
| Group 2 | Schemas + output contract | `framework-auditor` | `auto` | Read, Grep, Glob |
| Group 3 | Guardrails coverage | `framework-auditor` | `auto` | Read, Grep, Glob |
| Group 4 | Skills + commands + agents | `framework-auditor` | `auto` | Read, Grep, Glob |

All subagents are read-only. No write risk. The orchestrator reads the manifest once and dispatches relevant sections to each group. The orchestrator merges results after all groups complete.

## Output
Audit report with:
- Framework: {service}/{name}
- Checks: [list of PASS/FAIL per group, per check]
- Issues: [list of problems found]
- Suggestions: [list of improvements]
