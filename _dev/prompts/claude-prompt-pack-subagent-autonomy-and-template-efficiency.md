# Claude Prompt Pack: Subagent Autonomy & Template Efficiency

Implementation proposal for two complementary optimizations: expanding autonomous subagent usage to reduce interactive friction, and introducing coded templates to reduce Claude token consumption on predictable boilerplate.

Primary target files:
- [`.claude/guardrails.md`](../../.claude/guardrails.md) (subagent autonomy policy — partially complete)
- [`.claude/skills/execute-framework/workflows/execute.md`](../../.claude/skills/execute-framework/workflows/execute.md) (auto mode — partially complete)
- [`.claude/skills/execute-framework/workflows/review.md`](../../.claude/skills/execute-framework/workflows/review.md) (auto mode — partially complete)
- [`tools/workspace/scaffold-candidate.js`](../../tools/workspace/scaffold-candidate.js) (template extraction target)
- [`tools/workspace/scaffold-project.js`](../../tools/workspace/scaffold-project.js) (template extraction target)
- [`tools/workspace/scaffold-workspace.js`](../../tools/workspace/scaffold-workspace.js) (template extraction target)
- [`tools/workspace/lib/workspace.js`](../../tools/workspace/lib/workspace.js) (template renderer addition)
- [`.claude/skills/manage-frameworks/workflows/audit-framework.md`](../../.claude/skills/manage-frameworks/workflows/audit-framework.md) (parallel subagent target)
- [`.claude/skills/manage-frameworks/workflows/replay-framework.md`](../../.claude/skills/manage-frameworks/workflows/replay-framework.md) (parallel subagent target)
- [`.claude/skills/extract-skill/SKILL.md`](../../.claude/skills/extract-skill/SKILL.md) (parallel artifact generation)

---

## Verified Preconditions

Treat these as assumptions to verify in the current branch before implementing this pack.

1. **`execute.md`** — framework-executor autonomy policy is already partially present.
   Verify by reading:
   - `.claude/skills/execute-framework/workflows/execute.md`

2. **`review.md`** — completion-audit autonomy policy is already partially present.
   Verify by reading:
   - `.claude/skills/execute-framework/workflows/review.md`

3. **`guardrails.md`** — subagent autonomy policy is already at least partially documented.
   Verify by reading:
   - `.claude/guardrails.md`

If any of the above are not true in the active branch:
- do not assume this pack starts from a partially-complete autonomy baseline
- add the missing baseline first or narrow the phase scope accordingly

---

## Recommended Placement In Master Flow

This is not a day-one correctness pack. It is an optimization pack.

Default placement:
- after semantic verification
- after project/runtime health alignment
- after semantic output audit hardening
- after candidate replay hardening
- before multi-turn retries and final framework registration

Reason:
- most items here improve speed, ergonomics, and token efficiency
- they should build on already-correct workflows instead of masking correctness gaps

## How To Use This Pack

Run this pack as four separate Claude tasks, in order:

1. Prompt 1: foundation templates
2. Prompt 2: read-only subagent expansion
3. Prompt 3: pipeline acceleration
4. Prompt 4: execution engine optimization

Then run:

5. Prompt 5: validation
6. Prompt 6: completion audit

Do not merge all four implementation prompts into one task unless the repo state is already very stable.

---

## Track A: Subagent Expansion (Reduce Friction)

### A1. Parallel Framework Audit

**Problem:** `/audit-framework` runs 9 sequential validation checks in one agent. Each check reads different files and is independent. The orchestrator blocks for the entire sequence.

**Current flow (sequential):**
```
manifest.json → prompt chain → schemas → output contract → guardrails → skills → commands → agents → cross-refs → report
```

**Proposed flow (parallel):**
```
manifest.json (read once by orchestrator)
    ├── Subagent 1: prompt chain + cross-refs (Read, Grep, Glob)
    ├── Subagent 2: schemas + output contract (Read, Grep, Glob)
    ├── Subagent 3: guardrails coverage (Read, Grep, Glob)
    └── Subagent 4: skills + commands + agents YAML validation (Read, Grep, Glob)
         ↓
    Orchestrator: merge results → generate report
```

**Implementation:**

File: `.claude/skills/manage-frameworks/workflows/audit-framework.md`

1. Rewrite steps 2-8 as four parallel subagent groups
2. Each group uses `framework-auditor` agent definition (read-only, haiku model)
3. Each spawned with `mode: "auto"` (zero write risk — Read/Grep/Glob only)
4. Orchestrator reads manifest first (step 1), passes relevant sections to each subagent
5. Step 9 (report) collates all subagent results into unified PASS/FAIL report

**Acceptance criteria:**
- [ ] 4 parallel subagents spawn simultaneously
- [ ] Each subagent receives only its relevant validation scope
- [ ] All subagents use `mode: "auto"`
- [ ] Report format unchanged from current output
- [ ] Wall-clock time reduced ~60-70% for frameworks with 10+ files

---

### A2. Multi-Framework Validation

**Problem:** No command exists to validate all frameworks at once. `npm run verify:all` runs outside Mythos agent system. Users must manually run `/audit-framework` 9+ times.

**Implementation:**

New command: `.claude/commands/validate-all-frameworks.md`

```yaml
---
description: Validate all registered frameworks in parallel
allowed-tools: [Read, Glob, Grep, Agent]
---
```

Process:
1. Read `instructions/canonical/system.yaml` → extract framework list
2. Spawn one `framework-auditor` subagent per framework with `mode: "auto"`
3. All run in parallel (up to 11 concurrent)
4. Collect results → present consolidated table:
   ```
   | Framework                    | Status | Blockers | Warnings |
   | wordpress/qa                 | PASS   | 0        | 1        |
   | wordpress/documentation      | FAIL   | 2        | 0        |
   | deliverables/presentation-review | PASS | 0      | 0        |
   ```
5. List specific blockers for any FAIL framework

**Acceptance criteria:**
- [ ] Command registered in manifest
- [ ] All frameworks audited in parallel
- [ ] Consolidated pass/fail table output
- [ ] Individual blocker details for failing frameworks

---

### A3. Batch Capture Normalization

**Problem:** Scaffolding a framework from 3 captures requires 6 sequential user interactions: capture → normalize → capture → normalize → capture → normalize → scaffold. Each normalization is independent.

**Implementation:**

File: `.claude/skills/manage-frameworks/workflows/scaffold-framework.md`

Enhance step 2 (validate captures) to auto-normalize:
1. For each capture ID provided, check if already normalized
2. For any un-normalized captures, spawn parallel normalizer subagents (one per capture)
3. Each runs `npm run workspace:capture:normalize -- --capture <id>`
4. Wait for all to complete
5. If any fail, report which captures failed normalization and why
6. If all pass, proceed to scaffold step

New lightweight agent: `.claude/agents/capture-normalizer.md`
```yaml
---
name: capture-normalizer
description: Normalizes a single capture bundle. Runs npm normalize script and reports readiness.
tools: [Read, Bash, Grep, Glob]
model: haiku
---
```

**Acceptance criteria:**
- [ ] Scaffold command accepts un-normalized captures
- [ ] Normalization runs in parallel (one subagent per capture)
- [ ] Normalization failures reported with specific missing fields
- [ ] User interaction reduced from 6 steps to 2 (provide captures → confirm scaffold)

---

### A4. Parallel Prompt Chain Execution

**Problem:** The execute workflow processes all prompts sequentially. But some workflows may contain groups that are safe to run in parallel. Today that safety is not explicit enough to implement engine-level parallelism safely.

**Implementation:**

File: `.claude/skills/execute-framework/workflows/execute.md`

Enhance step 3 (determine prompt chain) and step 4 (execute prompts):

1. Read manifest `prompt_chain` groups
2. For each group:
   - If group has 1 prompt → execute sequentially (current behavior)
   - If group is explicitly marked parallel-safe → spawn one `framework-executor` per prompt with `mode: "auto"`, all in parallel
   - If group is not explicitly marked parallel-safe → keep sequential
3. Wait for all prompts in group to complete before proceeding to next group
4. Log all results to run_state.json using an explicit merge strategy:
   - each subagent writes its own temp result
   - the orchestrator performs a single atomic merge

**Parallel-safety requirement:**
- Do not infer parallel safety from array length alone.
- A group must opt in explicitly via manifest or workflow metadata.
- Each parallel unit must have:
  - a disjoint write scope, or
  - an explicit orchestrator merge step for shared outputs
- If write scope is ambiguous, default to sequential execution.

**Example manifest pattern detection:**
```json
"prompt_chain": {
  "intake": ["01_INTAKE"],
  "parallel_run": {
    "parallel_safe": true,
    "prompts": ["02A_ENV_A", "02B_ENV_B", "02C_ENV_C"]
  },
  "synthesize": ["03_SYNTHESIZE"]
}
```

Groups with explicit `parallel_safe: true` are parallel. All other groups are sequential by default.

**Acceptance criteria:**
- [ ] Execute workflow detects only explicitly parallel-safe groups as parallel
- [ ] N subagents spawned simultaneously for N-prompt groups
- [ ] Sequential ordering preserved between groups
- [ ] run_state.json correctly records all parallel prompt results
- [ ] No change to single-prompt or non-parallel-safe group behavior

---

### A5. Scaffold + Replay Auto-Combo

**Problem:** After scaffolding a candidate, the user must manually run `/replay-framework` then `/candidate-status` then `/promote-framework`. Three separate commands with waiting between each.

**Implementation:**

File: `.claude/skills/manage-frameworks/workflows/scaffold-framework.md`

Add post-scaffold auto-validation (step 8-9):
```
Step 7: [AUTO] Seed replay cases (existing)
Step 8: [AUTO] Launch parallel validation:
   ├── Subagent 1: framework-auditor → audit proposed_framework/ structure
   └── Subagent 2: replay-candidate → run all seeded replay cases
Step 9: [AUTO] Present consolidated readiness report:
   - Structure audit: PASS/FAIL
   - Replay results: N/M cases passed
   - Promotion blockers: [list]
   - Ready to promote: YES/NO
Step 10: [GATE] If ready → ask user "Promote now?"
```

**Acceptance criteria:**
- [ ] Audit and replay run in parallel after scaffold
- [ ] Consolidated readiness report replaces manual status checks
- [ ] Single user decision point for promotion (instead of 3 commands)
- [ ] Can still run individual commands separately if needed

---

### A6. Parallel Artifact Generation in Extract-Skill

**Problem:** `/extract-skill` generates SKILL.md, command, agent, and verification script sequentially (steps 5-8). Each writes to a different file with no cross-dependencies.

**Implementation:**

File: `.claude/skills/extract-skill/SKILL.md`

After step 4 (overlap check), spawn 4 parallel subagents:
```
Step 5: [AUTO] Spawn parallel artifact generators with mode: "auto":
   ├── Subagent 1: Generate SKILL.md (read templates, write skill file)
   ├── Subagent 2: Generate command .md (read command template, write command)
   ├── Subagent 3: Generate agent .md (read agent template, write agent)
   └── Subagent 4: Generate verification script (read patterns, write script)
Step 6: [AUTO] Collect all artifacts, run verify-skill.cjs
Step 7: [AUTO] Update manifest (sequential — must be atomic)
```

**Acceptance criteria:**
- [ ] 4 artifacts generated in parallel
- [ ] Verification runs after all artifacts exist
- [ ] Manifest update is sequential (no race conditions)
- [ ] Total extraction time reduced ~50%

---

### A7. Bulk Project Status

**Problem:** `/project-status` checks one project. No way to scan all projects for a client or system-wide.

**Implementation:**

New command: `.claude/commands/projects-status.md`

```yaml
---
description: Check status of all projects for a client or system-wide
argument-hint: [--client CODE | --all]
allowed-tools: [Read, Glob, Grep, Agent]
---
```

Process:
1. Parse `--client CODE` or `--all` flag
2. Treat local clients under `clients/` as the default source of truth
3. Glob for all `project.json` files under `clients/` (or specific client)
3. Spawn one read-only status scanner per project with `mode: "auto"`
4. Each reads project.json, run_state.json (if exists), checks output artifacts
5. Return consolidated dashboard:
   ```
   | Client | Project                    | Phase     | Last Run   | Blockers |
   | CLIENTC    | wordpress__qa__homepage    | executing | 2026-03-25 | 0        |
   | CLIENTB    | wordpress__qa__landing     | intake    | —          | 1        |
   | CLIENTA   | deliverables__review__q1   | complete  | 2026-03-20 | 0        |
   ```

**Acceptance criteria:**
- [ ] Scans all projects in parallel
- [ ] Supports `--client` filter and `--all`
- [ ] Assumes local clients under `clients/` as the primary project inventory
- [ ] Dashboard table with phase, last run date, blocker count
- [ ] Registered in manifest

---

### A8. Parallel Blocker Resolution

**Problem:** When completion-auditor finds 3+ independent blockers, the reopen cycle fixes them one at a time: fix blocker 1 → reaudit → fix blocker 2 → reaudit. This wastes reopen cycles (max 2) and time.

**Implementation:**

File: `.claude/skills/execute-framework/workflows/review.md`

Enhance step 7 (reopen logic):
```
Step 7: [GATE: blockers found] Reopen
   a. Classify blockers as independent or dependent
   b. For independent blockers: spawn parallel fix-agents (one per blocker)
      - Each agent: mode "auto", PATCH_ALLOWED, scoped to specific blocker
      - Each writes only the files relevant to its blocker
      - Independence must be proven by disjoint write scope
   c. For dependent blockers: fix sequentially
   d. After all fixes complete: re-run completion audit once
   e. If blockers persist after 2 cycles → escalate to user
```

**Acceptance criteria:**
- [ ] Independent blockers identified by explicit disjoint write scope and fixed in parallel
- [ ] Dependent blockers still fixed sequentially
- [ ] Single reaudit after all parallel fixes complete
- [ ] Max 2 reopen cycles preserved
- [ ] Scope boundaries respected (no cross-contamination between fix agents)

---

## Track B: Coded Templates (Reduce Token Usage)

### B1. Template Renderer Utility

**Problem:** Claude generates ~15,000+ tokens of predictable boilerplate per framework creation cycle. Most content follows fixed structures with 2-5 variable slots.

**Implementation:**

New file: `tools/workspace/lib/template-render.js`

```javascript
const fs = require('fs');
const path = require('path');

/**
 * Render a template file with variable substitution.
 * Variables use {{VARIABLE_NAME}} syntax.
 * Unresolved variables are left as-is (for downstream rendering).
 */
function renderTemplate(templatePath, variables) {
  const template = fs.readFileSync(templatePath, 'utf8');
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key)
      ? variables[key]
      : match; // leave unresolved
  });
}

/**
 * Render a template and write to output path.
 */
function renderTemplateTo(templatePath, outputPath, variables) {
  const rendered = renderTemplate(templatePath, variables);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered, 'utf8');
  return outputPath;
}

module.exports = { renderTemplate, renderTemplateTo };
```

This is the foundation for all Track B work. Everything below uses this renderer.

**Acceptance criteria:**
- [ ] `renderTemplate()` handles all `{{VAR}}` patterns
- [ ] Unresolved variables preserved (not swallowed)
- [ ] `renderTemplateTo()` creates parent directories
- [ ] Exported from `tools/workspace/lib/template-render.js`

---

### B2. Extract scaffold-candidate.js Templates

**Problem:** `scaffold-candidate.js` (487 lines) has 8 hardcoded template strings generating prompts, guardrails, manifests, skills, commands, agents, and READMEs. The `makePromptBody()` function (lines 96-124) generates ~20-line markdown per prompt. All structure is fixed — only 3-5 values vary.

**Current token cost:** ~2,000-3,000 tokens per scaffold run (Claude reading/generating boilerplate)

**Implementation:**

New directory: `tools/workspace/templates/candidate/`

Extract these template files:

1. **`prompt.template.md`** — from `makePromptBody()` (lines 96-124)
   ```markdown
   # {{PROMPT_NUMBER}}: {{PROMPT_TITLE}}

   ## Objective
   {{OBJECTIVE}}

   ## Mode
   `{{EXECUTION_MODE}}`

   ## Inputs
   - Previous prompt outputs (if applicable)
   - Project configuration from `project.json`

   ## Steps
   {{STEPS}}

   ## Outputs
   {{OUTPUTS}}

   ## Success Criteria
   - [ ] All steps completed without error
   - [ ] Outputs written to project directory
   - [ ] Mode constraints respected

   ## Guardrails
   - Follow execution mode constraints exactly
   - Use observational reporting for all findings
   - Never write client data to framework files
   ```
   Variables: `PROMPT_NUMBER`, `PROMPT_TITLE`, `OBJECTIVE`, `EXECUTION_MODE`, `STEPS`, `OUTPUTS`

2. **`guardrails.template.md`** — from lines 187-199
   Variables: `FRAMEWORK_NAME`, `SERVICE_CATEGORY`

3. **`manifest.template.json`** — from lines 148-185
   Variables: `SERVICE_CATEGORY`, `FRAMEWORK_NAME`, `DESCRIPTION`, `PROMPT_CHAIN_JSON`, `EXECUTION_MODES_JSON`

4. **`skill.template.md`** — from lines 328-345
   Variables: `FRAMEWORK_NAME`, `DESCRIPTION`

5. **`command.template.md`** — from lines 348-357
   Variables: `FRAMEWORK_NAME`, `DESCRIPTION`

6. **`agent.template.md`** — from lines 360-367
   Variables: `FRAMEWORK_NAME`, `DESCRIPTION`

7. **`readme.template.md`** — from lines 467-481
   Variables: `FRAMEWORK_NAME`, `SERVICE_CATEGORY`, `DESCRIPTION`

**Refactor `scaffold-candidate.js`:**
- Replace `makePromptBody()` with: `renderTemplate('templates/candidate/prompt.template.md', { ... })`
- Replace all hardcoded strings (lines 187-367) with `renderTemplateTo()` calls
- Total code reduction: ~200 lines removed, replaced with ~30 lines of render calls

**Token savings:** ~2,000 tokens per scaffold run. Claude passes 3-5 arguments instead of generating 200+ lines of markdown.

**Acceptance criteria:**
- [ ] All 7 template files created in `tools/workspace/templates/candidate/`
- [ ] `makePromptBody()` replaced with template render
- [ ] All hardcoded strings replaced with `renderTemplateTo()` calls
- [ ] `npm run workspace:candidate:scaffold` produces identical output
- [ ] Scaffold-candidate.js reduced by ~200 lines

---

### B3. Extract scaffold-project.js Templates

**Problem:** `scaffold-project.js` (308 lines) has 5 hardcoded template strings for README, HOW_TO_RUN, RUNTIME_NOT_INSTALLED, project.json, and playwright runner package.json. All are 95-100% boilerplate.

**Current token cost:** ~800-2,000 tokens per project creation

**Implementation:**

New directory: `tools/workspace/templates/project/`

Extract:

1. **`readme.template.md`** — from lines 284-301
   Variables: `CLIENT_NAME`, `CLIENT_CODE`, `PROJECT_NAME`, `FRAMEWORK_ID`, `RUNTIME_LINES`

2. **`how-to-run.template.md`** — from lines 192-211
   Variables: `FRAMEWORK_ID`, `PROJECT_NAME`

3. **`runtime-not-installed.template.md`** — from lines 214-227
   Variables: `FRAMEWORK_ID`

4. **`project.template.json`** — from lines 244-254
   Variables: `FRAMEWORK_ID`, `PROJECT_SLUG`, `CLIENT_CODE`, `CLIENT_NAME`, `CREATED_DATE`

5. **`playwright-package.template.json`** — from lines 127-154
   Variables: none (100% static — just copy as-is)

**Refactor `scaffold-project.js`:**
- Replace hardcoded strings with `renderTemplateTo()` calls
- Keep the existing `{{VAR}}` regex for WORKFLOW_GUIDE (already template-driven)
- Total code reduction: ~120 lines

**Token savings:** ~1,000 tokens per project creation.

**Acceptance criteria:**
- [ ] All 5 template files created in `tools/workspace/templates/project/`
- [ ] Hardcoded strings replaced with render calls
- [ ] `npm run workspace:project` produces identical output
- [ ] scaffold-project.js reduced by ~120 lines

---

### B4. Extract scaffold-workspace.js Templates

**Problem:** `scaffold-workspace.js` (205 lines) has 5 static template strings for .gitignore, .env.example, secrets/README, and two README variants. Zero variable interpolation needed — all purely static.

**Current token cost:** ~600-1,500 tokens per workspace creation

**Implementation:**

New directory: `tools/workspace/templates/workspace/`

Extract:

1. **`gitignore.template`** — from lines 79-99 (static file, no variables)
2. **`env-example.template`** — from lines 102-115 (static)
3. **`secrets-readme.template.md`** — from lines 118-130 (static)
4. **`readme-internal.template.md`** — from lines 166-183
   Variables: `CLIENT_NAME`, `CLIENT_CODE`
5. **`readme-external.template.md`** — from lines 186-201
   Variables: `CLIENT_NAME`, `CLIENT_CODE`, `WORKSPACE_PATH`

**Refactor `scaffold-workspace.js`:**
- Static templates: `fs.copyFileSync()` (no rendering needed)
- Variable templates: `renderTemplateTo()` calls
- Total code reduction: ~80 lines

**Token savings:** ~800 tokens per workspace creation.

**Acceptance criteria:**
- [ ] All 5 template files created in `tools/workspace/templates/workspace/`
- [ ] Static templates copied directly (no render overhead)
- [ ] `npm run workspace:scaffold` produces identical output
- [ ] scaffold-workspace.js reduced by ~80 lines

---

### B5. CLI Tool for project.json Creation

**Problem:** Claude currently generates `project.json` by following workflow instructions — reading the structure from skill docs, filling in values, writing JSON. The structure is 100% fixed. Claude should pass 3 arguments, not generate a JSON file.

**Implementation:**

New script: `tools/workspace/create-project-json.js`

```
Usage: node tools/workspace/create-project-json.js \
  --framework wordpress/qa \
  --slug homepage-redesign \
  --client CLIENTC \
  --output clients/CLIENTC/projects/wordpress___qa___homepage-redesign/project.json
```

The script:
1. Reads `clients/{CODE}/client.json` for client name
2. Reads `frameworks/{service}/{framework}/manifest.json` for framework metadata
3. Renders `tools/workspace/templates/project/project.template.json` with variables
4. Writes to output path

Add npm script:
```json
"workspace:project:init": "node tools/workspace/create-project-json.js"
```

**Token savings:** ~300-500 tokens per project creation. Claude runs one command instead of constructing JSON.

**Acceptance criteria:**
- [ ] Script creates valid project.json from 3 arguments
- [ ] Reads client metadata from existing client.json
- [ ] Reads framework metadata from existing manifest.json
- [ ] npm script registered in package.json

---

### B6. Structured Data Output for Reports

**Problem:** Claude generates 500+ token markdown reports (audit reports, review reports, status tables) with fixed formatting. The structure never changes — only the data does. Claude could output 50 tokens of JSON and let a renderer handle formatting.

**Implementation:**

New file: `tools/workspace/lib/report-render.js`

Provides:
```javascript
function renderAuditReport(data)    // → formatted markdown from JSON
function renderReviewReport(data)   // → formatted markdown from JSON
function renderStatusTable(data)    // → formatted markdown table from JSON
```

New directory: `tools/workspace/templates/reports/`
- `audit-report.template.md` — completion audit report structure
- `review-report.template.md` — framework review report structure
- `status-table.template.md` — project/framework status table

**Usage by Claude:**
Instead of generating a full markdown report, Claude writes a JSON payload:
```json
{
  "status": "PASS",
  "blockers": 0,
  "warnings": 2,
  "criteria": [
    {"name": "Output files exist", "status": "MET", "evidence": "reports/review.md exists"},
    {"name": "No PII in outputs", "status": "MET", "evidence": "grep found 0 matches"}
  ]
}
```

Then runs:
```bash
node -e "const r = require('./tools/workspace/lib/report-render'); console.log(r.renderAuditReport(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))))" < payload.json > report.md
```

Or more practically, the completion-auditor and output-reviewer agents write JSON, and the orchestrator renders to markdown.

**Token savings:** ~500-1,000 tokens per report (multiplied by number of reports per framework run).

**Acceptance criteria:**
- [ ] Report renderer produces identical markdown to current hand-generated reports
- [ ] JSON schema documented for each report type
- [ ] Subagents can output JSON instead of formatted markdown
- [ ] Orchestrator renders final report from JSON data

---

## Implementation Order

### Phase 1: Foundation (Do First)
| # | Item | Track | Effort | Token Savings | Friction Reduction |
|---|------|-------|--------|---------------|-------------------|
| 1 | B1: Template renderer utility | B | Small | Enables all Track B | — |
| 2 | B2: Extract scaffold-candidate templates | B | Medium | ~2,000/run | Low |
| 3 | B3: Extract scaffold-project templates | B | Medium | ~1,000/run | Low |
| 4 | B4: Extract scaffold-workspace templates | B | Small | ~800/run | Low |

**Why first:** These are mechanical refactors with zero behavior change. Each can be verified by comparing output before/after. They establish the template infrastructure that B5 and B6 build on.

**Verification:** `npm run workspace:candidate:scaffold`, `npm run workspace:project`, `npm run workspace:scaffold` must produce byte-identical output.

### Phase 2: Quick-Win Subagents
| # | Item | Track | Effort | Token Savings | Friction Reduction |
|---|------|-------|--------|---------------|-------------------|
| 5 | A1: Parallel framework audit | A | Medium | ~500/audit | High |
| 6 | A2: Multi-framework validation | A | Small | — | Very High |
| 7 | A7: Bulk project status | A | Small | — | High |

**Why second:** These are read-only operations with zero write risk. All use existing `framework-auditor` agent (haiku model, Read/Grep/Glob only). Easiest subagent expansion with highest visibility improvement.

### Phase 3: Pipeline Acceleration
| # | Item | Track | Effort | Token Savings | Friction Reduction |
|---|------|-------|--------|---------------|-------------------|
| 8 | A3: Batch capture normalization | A | Medium | ~300/batch | Very High |
| 9 | A5: Scaffold + replay auto-combo | A | Medium | — | Very High |
| 10 | B5: CLI tool for project.json | B | Small | ~400/project | Medium |

**Why third:** These reduce the capture → scaffold → promote pipeline from 6+ manual steps to 2. Combined with the template work from Phase 1, framework creation becomes largely automated.

### Phase 4: Execution Optimization
| # | Item | Track | Effort | Token Savings | Friction Reduction |
|---|------|-------|--------|---------------|-------------------|
| 11 | A4: Parallel prompt chain execution | A | Large | — | High |
| 12 | A8: Parallel blocker resolution | A | Medium | — | Medium |
| 13 | B6: Structured data output for reports | B | Large | ~1,000/run | Medium |
| 14 | A6: Parallel artifact generation | A | Small | ~200/extraction | Low |

**Why last:** These touch the core execution engine and require more careful testing. A4 (parallel prompts) is the highest-complexity change. B6 (structured reports) changes the output contract between subagents and orchestrator.

---

## Estimated Total Impact

### Token Savings (Track B)
| Operation | Current Tokens | After Templates | Savings |
|---|---|---|---|
| Scaffold candidate | ~3,000 | ~800 | ~2,200 |
| Create project | ~2,000 | ~600 | ~1,400 |
| Create workspace | ~1,500 | ~400 | ~1,100 |
| project.json creation | ~500 | ~50 | ~450 |
| Report generation (per report) | ~600 | ~100 | ~500 |
| **Full framework lifecycle** | **~10,000** | **~3,000** | **~7,000 (70%)** |

### Friction Reduction (Track A)
| Operation | Current Steps | After Subagents | Reduction |
|---|---|---|---|
| Audit single framework | 9 sequential | 4 parallel + merge | ~65% faster |
| Audit all frameworks | 9 x N manual | N parallel | ~90% faster |
| Capture → scaffold | 6 user interactions | 2 user interactions | 67% fewer gates |
| Scaffold → promote | 3 manual commands | 1 decision point | 67% fewer gates |
| Multi-env prompt chain | N sequential | N parallel | ~(N-1)/N faster |
| Blocker resolution | Serial reopen cycles | Parallel fix + 1 reaudit | ~50% fewer cycles |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Template output differs from current | Byte-compare test before/after for all scaffold operations |
| Parallel subagents produce conflicting writes | Require explicit disjoint write scope or an orchestrator-owned merge step before enabling parallelism |
| run_state.json race conditions (A4) | Each parallel executor writes temp result; orchestrator merges atomically |
| Auto-mode classifier blocks legitimate actions | Classifier fallback to interactive after 3 blocks (built-in behavior) |
| Template renderer introduces path traversal | Variables are values only; file paths come from scaffold logic, not templates |
| Capture normalizer fails silently in parallel | Each subagent reports exit status; orchestrator checks all before proceeding |
| Local-clients-first assumptions drift from deployment model | Treat `clients/` as the default source of truth, and only add external workspace support deliberately if it returns as a real requirement |

---

## Dependencies Between Items

```
B1 (renderer) ─────┬── B2 (candidate templates)
                    ├── B3 (project templates)
                    ├── B4 (workspace templates)
                    ├── B5 (project.json CLI) ── depends on B3
                    └── B6 (report renderer)

A1 (parallel audit) ── A2 (multi-framework) reuses A1 pattern
A3 (batch normalize) ── A5 (scaffold+replay combo) depends on A3
A4 (parallel prompts) ── independent
A6 (parallel artifacts) ── independent
A7 (bulk status) ── independent
A8 (parallel blockers) ── independent
```

Items without dependencies can be implemented in any order within their phase.

---

## Prompt 1: Foundation — Template Renderer & Scaffold Extraction

Use this as the initial Claude prompt for Phase 1 of this pack.

```text
Implement the template renderer utility and extract all scaffold templates (Phase 1: items B1-B4).

Read these files first:
- `_dev/prompts/claude-prompt-pack-subagent-autonomy-and-template-efficiency.md` (this proposal — Track B sections)
- `tools/workspace/lib/workspace.js` (existing utilities)
- `tools/workspace/scaffold-candidate.js` (full file — note makePromptBody and all hardcoded strings)
- `tools/workspace/scaffold-project.js` (full file — note all hardcoded strings)
- `tools/workspace/scaffold-workspace.js` (full file — note all hardcoded strings)

Required execution pattern:
1. Create `tools/workspace/lib/template-render.js` with renderTemplate() and renderTemplateTo()
2. Create template directories: `tools/workspace/templates/candidate/`, `project/`, `workspace/`
3. Extract templates from scaffold-candidate.js (7 template files)
4. Extract templates from scaffold-project.js (5 template files)
5. Extract templates from scaffold-workspace.js (5 template files)
6. Refactor each scaffold script to use renderTemplateTo() instead of hardcoded strings
7. Verify: run each scaffold script and confirm output is identical to pre-refactor

Acceptance criteria:
- [ ] template-render.js exports renderTemplate and renderTemplateTo
- [ ] 17 template files created across 3 directories
- [ ] scaffold-candidate.js reduced by ~200 lines
- [ ] scaffold-project.js reduced by ~120 lines
- [ ] scaffold-workspace.js reduced by ~80 lines
- [ ] All npm workspace scripts produce identical output

Final response must include:
- changed files
- validations run
- whether output remained byte-identical
- any remaining scaffold boilerplate not yet templated
```

## Prompt 2: Read-Only Subagent Expansion

Use this as the initial Claude prompt for Phase 2 of this pack.

```text
Implement parallel framework audit, multi-framework validation, and bulk project status (Phase 2: items A1, A2, A7).

Read these files first:
- `_dev/prompts/claude-prompt-pack-subagent-autonomy-and-template-efficiency.md` (this proposal — A1, A2, A7 sections)
- `.claude/skills/manage-frameworks/workflows/audit-framework.md`
- `.claude/agents/framework-auditor.md`
- `.claude/guardrails.md` (subagent autonomy policy)
- `.claude/commands/audit-framework.md`
- `instructions/canonical/system.yaml`

Required execution pattern:
1. Rewrite audit-framework.md workflow to use 4 parallel subagent groups
2. Create `.claude/commands/validate-all-frameworks.md` command
3. Create `.claude/commands/projects-status.md` command
4. Register new commands via `npm run manifest:sync`
5. Verify: run `/audit-framework wordpress/qa` and confirm report matches current format
6. Verify: run `/validate-all-frameworks` and confirm all frameworks scanned

Acceptance criteria:
- [ ] Audit uses 4 parallel subagents (all mode: "auto")
- [ ] validate-all-frameworks command produces consolidated pass/fail table
- [ ] projects-status command supports --client and --all flags
- [ ] All new commands registered in manifest
- [ ] No write operations in any new subagent (read-only enforcement)

Final response must include:
- changed files
- validations run
- which workflows/commands now use parallel read-only subagents
- any remaining read-only status surfaces that still need parallelization
```

## Prompt 3: Pipeline Acceleration

Use this as the initial Claude prompt for Phase 3 of this pack.

```text
Implement batch capture normalization, scaffold+replay combo, and project.json CLI (Phase 3: items A3, A5, B5).

Read these files first:
- `_dev/prompts/claude-prompt-pack-subagent-autonomy-and-template-efficiency.md` (this proposal — A3, A5, B5 sections)
- `.claude/skills/manage-frameworks/workflows/scaffold-framework.md`
- `.claude/skills/manage-frameworks/workflows/replay-framework.md`
- `.claude/skills/manage-frameworks/workflows/normalize-capture.md`
- `tools/workspace/scaffold-project.js` (for project.json generation pattern)
- `tools/workspace/templates/project/project.template.json` (created in Prompt 1)

Required execution pattern:
1. Create `.claude/agents/capture-normalizer.md` (haiku model, Read/Bash/Grep/Glob)
2. Enhance scaffold-framework.md to auto-normalize un-normalized captures in parallel
3. Add post-scaffold auto-validation (parallel audit + replay) to scaffold-framework.md
4. Create `tools/workspace/create-project-json.js` CLI tool
5. Add `workspace:project:init` npm script to package.json
6. Register new agent and npm script via manifest sync
7. Verify: scaffold with 2 un-normalized captures → both normalize in parallel → scaffold proceeds

Acceptance criteria:
- [ ] capture-normalizer agent created and registered
- [ ] Scaffold auto-normalizes un-normalized captures in parallel
- [ ] Post-scaffold runs audit + replay in parallel, presents readiness report
- [ ] create-project-json.js produces valid project.json from 3 CLI arguments
- [ ] User interaction reduced from 6+ steps to 2 for full pipeline

Final response must include:
- changed files
- validations run
- how user interaction count was reduced
- any remaining sequential bottlenecks in capture→scaffold→promote flow
```

## Prompt 4: Execution Engine Optimization

Use this as the initial Claude prompt for Phase 4 of this pack.

```text
Implement parallel prompt chain execution, parallel blocker resolution, structured report output, and parallel artifact generation (Phase 4: items A4, A8, B6, A6).

Read these files first:
- `_dev/prompts/claude-prompt-pack-subagent-autonomy-and-template-efficiency.md` (this proposal — A4, A8, B6, A6 sections)
- `.claude/skills/execute-framework/workflows/execute.md`
- `.claude/skills/execute-framework/workflows/review.md`
- `.claude/skills/manage-frameworks/references/prompt-chain-patterns.md`
- `.claude/skills/extract-skill/SKILL.md`
- `frameworks/wordpress/qa/manifest.json` (example of parallel prompt groups)

Required execution pattern:
1. Enhance execute.md to detect multi-prompt groups and spawn parallel framework-executors
2. Enhance review.md reopen logic to classify independent blockers and fix in parallel
3. Create `tools/workspace/lib/report-render.js` with renderAuditReport, renderReviewReport, renderStatusTable
4. Create report templates in `tools/workspace/templates/reports/`
5. Enhance extract-skill SKILL.md to parallelize artifact generation (steps 5-8)
6. Verify: run framework with parallel prompt group → prompts execute simultaneously
7. Verify: report renderer produces identical markdown from JSON input

Acceptance criteria:
- [ ] Multi-prompt groups detected from manifest and executed in parallel
- [ ] Sequential ordering preserved between groups
- [ ] Independent blockers fixed in parallel, single reaudit
- [ ] Report renderer produces markdown from JSON payloads
- [ ] Extract-skill generates 4 artifacts in parallel
- [ ] run_state.json correctly records all parallel results

Final response must include:
- changed files
- validations run
- concurrency model used for prompt groups and blocker resolution
- any remaining execution-engine risks
```

## Prompt 5: Validation Prompt

Use this after completing the intended phase or after completing the whole pack.

```text
Validate the Subagent Autonomy & Template Efficiency work.

Acceptance criteria:
1. Template extraction reduces scaffold boilerplate without changing generated output unexpectedly.
2. Read-only parallel subagent expansion is implemented where proposed and remains safe.
3. Pipeline acceleration changes reduce user friction without hiding failures.
4. Execution engine optimizations preserve correctness boundaries while improving concurrency.
5. Any new commands, agents, or utilities are registered and discoverable.

Inspect:
- changed files
- relevant workflow files
- package.json / manifest changes
- validation outputs from the implemented phase

Return:
- criterion-by-criterion pass/fail
- command evidence
- any remaining high-risk items that should block further rollout
```

## Prompt 6: Completion Audit Prompt

Use this as the final read-only audit for the phase or for the full pack.

```text
Act as a completion auditor for the Subagent Autonomy & Template Efficiency pack.

Acceptance criteria:
1. The implemented phase matches the proposal scope and did not silently expand.
2. Parallel subagent usage preserves safety and write-scope boundaries.
3. Template extraction reduced boilerplate while preserving output integrity.
4. Validation evidence is concrete and sufficient.
5. Remaining risks are clearly identified before rollout to later phases.

Inputs to inspect:
- changed files
- validation output
- any before/after output comparisons
- manifest or command registration evidence

Return:
- PASS or FAIL
- blocker, warning, and info findings
- evidence for each finding
- recommendation: COMPLETE, REOPEN, or ESCALATE
```
