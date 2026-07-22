# Framework Anatomy

A framework is a reusable, organization-agnostic task template.

## Required Components

### manifest.json
The framework's identity and contracts:
- `service_category` — Agency vertical (wordpress, analytics, advertising, seo)
- `framework_name` — Descriptive name
- `version` — Semantic version
- `prompt_count` — Number of prompts in the chain
- `input_contract` — What the framework needs to run
- `output_contract` — What the framework produces
- `execution_modes` — Which modes are used
- `mcp_requirements` — External tool dependencies

### prompts/
Numbered prompt files (01_, 02_, ...) forming an execution chain. Each prompt has:
- Clear objective
- Defined inputs and outputs
- Execution mode declaration
- Success criteria

### guardrails.md
Framework-specific execution constraints extending system guardrails.

### schemas/
JSON Schema files validating inputs and outputs.

## Optional Components

### docs/
Framework documentation for users and developers.

### templates/
Starter files for new projects using this framework.

### runner/
Execution engine code (test runner, build scripts, etc.).

### .claude/
Claude Code integration: skills/, commands/, agents/

---

Framework prompt chains (the numbered execution prompts inside a framework's `prompts/` directory, registered in that framework's `manifest.json` via the `prompt_chain` array) are the only prompt-sequencing mechanism in this repository. There is no separate system-level prompt authoring surface — every reusable multi-step workflow is authored as a framework, following the anatomy above.
