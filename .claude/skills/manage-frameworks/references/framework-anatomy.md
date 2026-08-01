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

## Prompt Pack Anatomy

A prompt pack is a reusable prompt system that drives a multi-step implementation or analysis workflow. Prompt packs live under `_dev/prompts/` and are registered in `_dev/prompts/manifest.json`.

Unlike framework prompt chains (which are numbered execution prompts within a framework directory), prompt packs are system-level task systems that orchestrate work across the Mythos repo itself.

### Mandatory Sections

Every prompt pack must include these sections. They are part of operational correctness, not optional style flourishes.

#### Goal
What the pack achieves. State the desired outcome, not just the topic area. Include "Why This Matters" context when the motivation is non-obvious.

#### Claude Optimization Notes
Claude-specific execution posture for the pack:
- Which strategies to favor (e.g., methodology fixes before broad rewrites)
- How narrow the first implementation slice should be
- Subagent usage constraints (read-only inventory vs. write-owning workers)
- Requirement for concrete guidance-surface changes rather than abstract conversation summaries
- Anti-patterns to avoid (e.g., treating a session-review doc as sufficient without converting it into system rules)

#### Multi-Agent Functionality
Explicit agent boundaries:
- What stays in the main thread (synthesis, go/no-go decisions)
- Which prompts may use read-only subagents and for what purpose
- Which prompts may use write-owning workers and with what scope
- Disjoint write-scope expectations between parallel agents
- Validation and completion audit as read-only steps
- Maximum subagent counts and concurrency limits

#### Model Guidance
Constraints by prompt type:
- **Coordinator prompts**: use the strongest implementation-capable Claude path available; keep interaction-model judgment in the main thread
- **Explorer prompts**: read-only and bounded; use Task/Explore style execution only
- **Worker prompts**: implementation-capable with tool access; ownership limited to declared guidance surfaces
- **Validation prompts**: read-only; verify changed surfaces without widening into new implementation
- **Completion audit prompts**: read-only auditor posture; focus on operator clarity, truthfulness, and structural improvement

#### Recommended Near-Term Slice
Value-ordered implementation guidance:
- What to start with and why
- What not to start with and why
- Explicit ranking of implementation slices by value
- Architecture breadth should not be treated as immediate priority by default

#### How To Use This Pack
Execution order for the pack's prompts:
- Numbered steps for the implementation tasks
- Validation and completion audit steps at the end
- Guidance on keeping the first pass bounded

#### Prompts
The pack's concrete prompt definitions, typically including:
- **Coordinator kickoff**: orchestration prompt with acceptance criteria and required execution pattern
- **Explorer prompts**: read-only inventory or gap-analysis prompts (typically 1-2)
- **Worker prompts**: implementation prompts with declared ownership and constraints
- **Validation prompt**: criterion-by-criterion pass/fail verification
- **Completion audit prompt**: evidence-based completion determination (PASS/FAIL, blocker/warning/info findings, COMPLETE/REOPEN/ESCALATE recommendation)

### Prompt Pack vs. Framework Prompt Chain

| Aspect | Prompt Pack | Framework Prompt Chain |
|---|---|---|
| Location | `_dev/prompts/claude-prompt-pack-*.md` | `frameworks/{service}/{name}/prompts/` |
| Scope | System-level Mythos development work | Client-facing task execution |
| Registration | `_dev/prompts/manifest.json` | `frameworks/{service}/{name}/manifest.json` |
| Sequencing | `_dev/prompts/claude-master-run-order.md` | Framework manifest `prompt_chain` array |
| Audience | Mythos operators and developers | Framework executors working on client projects |
