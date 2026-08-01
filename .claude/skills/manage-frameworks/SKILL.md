---
name: manage-frameworks
description: >
  Manages the full lifecycle of Mythos frameworks. Use when creating, auditing,
  improving, scaffolding, or listing frameworks.
version: 1.0.0
---

<skill>
<objective>
Manage the full lifecycle of Mythos frameworks: capture successful work, normalize it, scaffold framework candidates, replay them, promote validated candidates, create new frameworks from scratch or examples, audit existing frameworks for structural completeness and quality, improve frameworks based on execution feedback, and list all registered frameworks.
</objective>

<quick_start>
1. Choose a workflow: capture | normalize | scaffold-candidate | replay | promote | create | audit | improve | list
2. For capture: `/capture-task --from /path/to/work --into /path/to/workspace/project --task-type intake-summary`
3. For normalize: `/normalize-capture /path/to/project/captures/<capture_id>`
4. For scaffold: `/scaffold-framework /path/to/project <capture-id> --service analytics --name summary-pipeline`
5. For replay: `/replay-framework /path/to/project/framework_candidates/<service>__<name>`
6. For promote: `/promote-framework /path/to/project/framework_candidates/<service>__<name>`
7. For create: `/new-framework` — walks through 10-step framework creation
8. For audit: `/audit-framework wordpress/qa` — validates structure and prompt chain
9. For improve: `/improve-framework wordpress/qa` — reviews outputs and identifies gaps
10. For list: `/list-frameworks` — scans and displays all frameworks
</quick_start>

<commands>
| Command | Workflow | Description |
|---------|----------|-------------|
| `/new-framework` | create-framework | Create a new framework from scratch |
| `/capture-task` | capture-task | Import successful work into a normalized capture bundle |
| `/normalize-capture` | normalize-capture | Validate and normalize a capture bundle |
| `/capture-status` | capture-status | Report capture readiness and missing fields |
| `/audit-framework` | audit-framework | Validate framework structure and completeness |
| `/improve-framework` | improve-framework | Improve framework based on execution outputs |
| `/list-frameworks` | (inline) | Scan and list all registered frameworks (handled by `.claude/commands/list-frameworks.md`) |
| `/scaffold-framework` | scaffold-framework | Generate a framework candidate from normalized captures |
| `/candidate-status` | candidate-status | Show replay summary, readiness, and promotion blockers |
| `/replay-framework` | replay-framework | Run replay-readiness checks for a framework candidate |
| `/promote-framework` | promote-framework | Promote a validated framework candidate into Mythos |
</commands>

<workflows>
- `workflows/capture-task.md` — Import successful work from anywhere into a capture bundle
- `workflows/normalize-capture.md` — Check whether a capture is scaffold-ready
- `workflows/capture-status.md` — Report capture completeness and blockers
- `workflows/scaffold-framework.md` — Generate a framework candidate from one or more captures
- `workflows/candidate-status.md` — Report candidate maturity and promotion blockers
- `workflows/replay-framework.md` — Run replay-readiness checks for candidate replay cases
- `workflows/promote-framework.md` — Copy a validated candidate into `frameworks/` and register it canonically
- `workflows/create-framework.md` — 10-step framework creation process
- `workflows/audit-framework.md` — Structural validation and completeness check
- `workflows/improve-framework.md` — Review outputs and identify improvements
- `workflows/scaffold-from-example.md` — Reverse-engineer a task into a framework from successful work
- `workflows/maintain-guides.md` — Keep workflow guides in sync with framework changes
</workflows>

<references>
- `references/framework-anatomy.md` — What a framework contains and why
- `references/prompt-chain-patterns.md` — Sequential, branching, parallel patterns
- `references/execution-modes.md` — Mode definitions and constraints
</references>

<templates>
- `templates/manifest-template.json` — Blank manifest
- `templates/prompt-template.md` — Prompt file structure
- `templates/guardrails-template.md` — Guardrails skeleton
</templates>

<success_criteria>
- Successful work can be imported from anywhere on disk into a normalized capture bundle
- Only normalized captures feed framework candidate scaffolding
- Candidate status reflects replay readiness and promotion blockers accurately
- Promotion only occurs after sanitization, replay, and canonical registration succeed
- Created framework has valid manifest.json with all required fields
- All prompts in the chain exist and reference correct inputs/outputs
- guardrails.md covers all declared execution modes
- Skills, commands, and agents exist with proper YAML frontmatter
- Audit produces zero critical findings on the framework
- No client-specific or business-specific data in framework files
- WORKFLOW_GUIDE.template.md reflects current command list and argument signatures
- Completion auditor confirms no blocker-level findings for substantial workflows (create, improve, promote)
</success_criteria>
</skill>
