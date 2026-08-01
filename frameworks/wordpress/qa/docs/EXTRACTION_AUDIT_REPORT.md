# Framework Extraction Audit Report

**Date:** 2026-01-30
**Purpose:** Identify changes needed to extract a generic, reusable "conversational runtime" framework from a reference (project-specific) implementation.

---

## Executive Summary

The framework is **70% generic** already, but has significant coupling to:
1. **Hardcoded developer name** - occurrences across prompts/skills
2. **WPForms/CRM pipeline** - 190+ occurrences assuming forms→CRM workflow
3. **Project-specific field names** - `{crm_field_prefix}*` CRM fields used as examples

The core architecture (phased runner, evidence collection, MCP integration, Claude Code skills) is reusable. The prompts follow good design principles ("framework-generic" is stated goal in README). However, the **analysis/reporting prompts (10-14)** are deeply coupled to the WPForms→Dynamics CRM pipeline.

---

## Audit by Component

### 1. PROMPTS: `framework/prompts/`

#### Files: 17 prompts + README

| File | Status | Issues | Priority |
|------|--------|--------|----------|
| `README.md` | GENERIC | 1 developer-name reference in example | LOW |
| `01_INTAKE_AND_SCAFFOLD.md` | GENERIC | Good! References generic "forms" | LOW |
| `02_LOCATORS_AND_CORRECTION.md` | NEEDS_CLEANUP | 6 WPForms refs as examples | MEDIUM |
| `03_REPORT_AND_DEV_HANDOFF.md` | NEEDS_CLEANUP | 6 CRM refs | MEDIUM |
| `04_PARALLEL_RUN_MANAGER.md` | GENERIC | 3 CRM refs (recommendation section) | LOW |
| `05_MCP_WALKTHROUGH_FINDINGS_ONLY.md` | GENERIC | 1 WPForms ref (example) | LOW |
| `06_ITERATE_UNTIL_PASS.md` | NEEDS_CLEANUP | CRM/WPForms in examples | MEDIUM |
| `07_IMPLEMENT_FIXES.md` | GENERIC | 2 "form" refs (appropriate) | LOW |
| `08_RERUN_VERIFY.md` | GENERIC | 1 "form" ref | LOW |
| `09_SHARED_BLOCKS.md` | **NEEDS_CLEANUP** | **15 CRM refs, 7 WPForms refs, 1 project-specific field example** | **HIGH** |
| `10_DEEP_PIPELINE_ANALYSIS.md` | **PROJECT_SPECIFIC** | **Entirely WPForms→CRM pipeline** | **HIGH** |
| `11_CROSS_RUN_ANOMALY_INDEX.md` | GENERIC | 1 CRM ref (can generalize) | MEDIUM |
| `12_DEV_PACKET_GENERATOR.md` | GENERIC | 1 "form" ref | LOW |
| `13_PAYLOAD_DEEP_ANALYSIS...` | **PROJECT_SPECIFIC** | **Developer-name refs + WPForms/CRM throughout** | **HIGH** |
| `14_APPEND_PAYLOAD_REPORTING...` | **PROJECT_SPECIFIC** | **Developer-name refs + WPForms/CRM throughout** | **HIGH** |
| `15_NAVIGATION_CLEANUP...` | GENERIC | 1 developer-name ref, 1 WPForms ref | LOW |
| `16_CHANGELOG_CAPTURE...` | NEEDS_CLEANUP | 4 CRM refs, 7 "form" refs | MEDIUM |

#### Specific Changes Needed:

**HIGH PRIORITY:**

1. **`09_SHARED_BLOCKS.md`** — Replace `{crm_field_prefix}attributionpath` example with generic `{FIELD_NAME}` placeholder
   - Section E example: use `your_custom_field` instead of CRM-specific name
   - Section H: Generalize "Form behavior" → "Interaction behavior"
   - Section I: This entire section is WPForms/CRM-specific — needs abstraction layer

2. **Prompts 10, 13, 14** — These are fundamentally WPForms→CRM pipeline prompts
   - **Option A:** Keep as-is in a reference implementation, exclude from generic framework
   - **Option B:** Abstract to "Backend Validation Pipeline" with pluggable integrations
   - **Recommended:** Option A for now, with hooks for project-specific validation

3. **Developer-name hardcoding:**
   - Replace all developer names → `{DEVELOPER_NAME}` (or `{BACKEND_DEV}`)
   - Replace `For_*.md` filenames → `For_Developer.md` (or `DEVELOPER_HANDOFF.md`)
   - Replace any `__for_<name>.md` suffixes → `__for_dev.md`

---

### 2. SKILLS: `.claude/skills/framework/`

#### Files: 17 skills

| Skill | Status | Issues | Priority |
|-------|--------|--------|----------|
| `intake-scaffold` | GENERIC | 1 WPForms ref | LOW |
| `locator-correction` | GENERIC | Good | - |
| `mcp-walkthrough` | GENERIC | Good | - |
| `parallel-run` | NEEDS_CLEANUP | 5 CRM refs (recommendations) | MEDIUM |
| `report-handoff` | NEEDS_CLEANUP | 6 CRM refs | MEDIUM |
| `implement-fixes` | GENERIC | Good | - |
| `rerun-verify` | GENERIC | Good | - |
| `iterate-until-pass` | GENERIC | 1 CRM ref | LOW |
| `deep-pipeline-analysis` | **PROJECT_SPECIFIC** | **12 WPForms/CRM refs** | **HIGH** |
| `cross-run-anomaly` | NEEDS_CLEANUP | 2 CRM refs | MEDIUM |
| `dev-packet` | GENERIC | 2 CRM refs | LOW |
| `compile-dev-bundle` | **PROJECT_SPECIFIC** | **40 WPForms/CRM/developer-name refs** | **HIGH** |
| `append-to-dev-bundle` | **PROJECT_SPECIFIC** | **9 WPForms/CRM/developer-name refs** | **HIGH** |
| `changelog-capture` | NEEDS_CLEANUP | 3 CRM refs | MEDIUM |
| `expectation-updater` | GENERIC | 1 CRM ref | LOW |
| `navigation-cleanup` | GENERIC | 1 WPForms ref | LOW |
| `update-framework-artifacts` | GENERIC | Good | - |

---

### 3. COMMANDS: `.claude/commands/framework/`

#### Files: 17 commands

**Status: GENERIC** — Commands are thin wrappers that invoke skills. They inherit issues from underlying skills but don't add new hardcoding.

**No immediate changes needed** — Fix the underlying skills and prompts.

---

### 4. AGENTS: `.claude/agents/framework/`

#### Files: 17 agents

**Status: GENERIC** — Agents are thin wrappers that configure Task tool invocations.

**No immediate changes needed** — Same as commands.

---

### 5. DOCUMENTATION: `framework/docs/`

#### Files: 13 docs

| File | Status | Issues | Priority |
|------|--------|--------|----------|
| `TEMPLATE_REPO_SPEC.md` | **GENERIC** | Excellent future vision! Journey-based, generic | - |
| `LOCAL_SETUP.md` | GENERIC | Good | - |
| `RUNNER_SPEC.md` | NEEDS_CLEANUP | 2 WPForms refs | LOW |
| `BROWSER_LAUNCH.md` | GENERIC | Good | - |
| `BROWSERSTACK_AUTOMATION_GUIDE.md` | GENERIC | Good | - |
| `CHANGELOG.md` | PROJECT_SPECIFIC | Historical, keep in reference repo | - |
| `FRAMEWORK_BOUNDARIES.md` | GENERIC | Good | - |
| `FUTURE_ITERATION_FLOW.md` | NEEDS_CLEANUP | 7 WPForms/developer-name refs | MEDIUM |
| `NAVIGATION_CLEANUP_PLAN...` | NEEDS_CLEANUP | 2 refs | LOW |
| `PROCESS_ASSESSMENT...` | NEEDS_CLEANUP | 5 refs | MEDIUM |
| `REPO_CONVENTIONS.md` | GENERIC | Good | - |
| `REPORTING_PIPELINE.md` | NEEDS_CLEANUP | 1 developer-name ref | LOW |
| `TESTCASE_EXECUTION...` | NEEDS_CLEANUP | 6 WPForms/CRM refs | MEDIUM |

---

### 6. RUNNER CODE: `framework/runner/`

#### Files: 12 JS files

| File | Status | Issues | Priority |
|------|--------|--------|----------|
| `cli.js` | NEEDS_CLEANUP | 5 CRM/WPForms refs in help text | MEDIUM |
| `lib/project-layout.js` | NEEDS_CLEANUP | 4 refs (wpforms/crm folder names) | MEDIUM |
| `lib/args.js` | GENERIC | Good | - |
| `lib/fs.js` | GENERIC | Good | - |
| `commands/run.js` | GENERIC | Good | - |
| `commands/new-runset.js` | NEEDS_CLEANUP | 2 refs | LOW |
| `commands/report.js` | GENERIC | Good | - |
| `commands/validate.js` | GENERIC | Good | - |
| `commands/handoff.js` | NEEDS_CLEANUP | CRM/WPForms refs | MEDIUM |
| `commands/compare-exports.js` | **PROJECT_SPECIFIC** | **11 WPForms/CRM refs** | **HIGH** |
| `engine/run.js` | GENERIC | Good | - |
| `adapters/legacy-phased.js` | NEEDS_CLEANUP | 1 CRM ref | LOW |

---

### 7. PLAYBOOKS: `framework/prompts/playbooks/`

#### `DUAL_WPFORMS_VSN_SETUP/` — 8 files

**Status: PROJECT_SPECIFIC** — This is a reference implementation playbook.

**Action:** Keep in a reference project repo as an example. Create a sanitized `EXAMPLE_PLAYBOOK/` template for the generic framework.

---

## Missing Pieces for "Conversational Runtime" Vision

| Gap | Description | Priority |
|-----|-------------|----------|
| **Onboarding Flow** | No conversational intake prompt that asks "What are you testing?" | HIGH |
| **Use Case Adapters** | No abstraction for different test types (forms, tracking, user flows, e-commerce) | HIGH |
| **Backend Validation Plugins** | CRM/WPForms logic hardcoded; needs plugin architecture | MEDIUM |
| **Project Config Schema** | No `project.yaml` for project-specific settings (developer name, backend type) | MEDIUM |
| **Interactive Capture Mode** | MCP walkthrough exists but no "record my flow" mode | MEDIUM |
| **Session→Testcase Conversion** | Implied but not explicitly documented | MEDIUM |

---

## Extraction Boundaries

### GENERIC FRAMEWORK REPO (extract)

```
framework/
├── prompts/
│   ├── 01_INTAKE_AND_SCAFFOLD.md
│   ├── 02_LOCATORS_AND_CORRECTION.md
│   ├── 03_REPORT_AND_DEV_HANDOFF.md (cleaned)
│   ├── 04_PARALLEL_RUN_MANAGER.md
│   ├── 05_MCP_WALKTHROUGH_FINDINGS_ONLY.md
│   ├── 06_ITERATE_UNTIL_PASS.md (cleaned)
│   ├── 07_IMPLEMENT_FIXES.md
│   ├── 08_RERUN_VERIFY.md
│   ├── 09_SHARED_BLOCKS.md (cleaned, abstracted)
│   ├── 11_CROSS_RUN_ANOMALY_INDEX.md (cleaned)
│   ├── 12_DEV_PACKET_GENERATOR.md
│   ├── 15_NAVIGATION_CLEANUP_AND_DEPRECATION.md
│   ├── 16_CHANGELOG_CAPTURE_FROM_DEV.md (cleaned)
│   └── README.md
├── docs/
│   ├── TEMPLATE_REPO_SPEC.md
│   ├── LOCAL_SETUP.md
│   ├── RUNNER_SPEC.md (cleaned)
│   ├── BROWSER_LAUNCH.md
│   ├── BROWSERSTACK_AUTOMATION_GUIDE.md
│   ├── FRAMEWORK_BOUNDARIES.md
│   └── REPO_CONVENTIONS.md
├── runner/ (cleaned of CRM/WPForms hardcoding)
│   ├── cli.js
│   ├── engine/
│   ├── lib/
│   └── commands/ (exclude compare-exports)
└── .claude/
    ├── skills/framework/ (cleaned subset)
    ├── commands/framework/
    └── agents/framework/
```

### REFERENCE IMPLEMENTATION (keep)

```
playwright_phased_runner/
├── testcases/
├── runs/
├── reports/
├── dev_handoff/
├── changelogs/
└── runner/ (legacy)

framework/
├── prompts/
│   ├── 10_DEEP_PIPELINE_ANALYSIS.md
│   ├── 13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md
│   ├── 14_APPEND_PAYLOAD_REPORTING_TO_EXISTING_HANDOFF.md
│   └── playbooks/DUAL_WPFORMS_VSN_SETUP/
├── runner/commands/compare-exports.js
└── docs/
    ├── CHANGELOG.md
    ├── FUTURE_ITERATION_FLOW.md
    ├── PROCESS_ASSESSMENT_AND_REPLICATION.md
    └── TESTCASE_EXECUTION_AND_STORAGE_SPEC.md

.claude/
└── skills/framework/
    ├── deep-pipeline-analysis/
    ├── compile-dev-bundle/
    └── append-to-dev-bundle/
```

### NEEDS DUPLICATION (template in generic, concrete in reference repo)

- `09_SHARED_BLOCKS.md` — Generic version with placeholders, reference version with integration-specific examples
- `project-layout.js` — Generic folder names, reference repo can add CRM/WPForms paths
- Onboarding interview — Generic template + integration-specific "forms testing" variant

---

## Recommended Action Plan

### Phase 1: Quick Wins (1-2 hours)
1. Replace any hardcoded developer names → `{DEVELOPER_NAME}` in prompts 13, 14, 15
2. Rename `For_*.md` → `For_Developer.md` in bundle structure
3. Rename `__recipient.md` → `__for_dev.md` suffix

### Phase 2: Abstraction (4-6 hours)
1. Create `09_SHARED_BLOCKS.md` generic version with `{FIELD_NAME}` placeholders
2. Abstract Section H (Reporting Requirements Interview) to be use-case agnostic
3. Create `project.yaml` schema for project-specific configuration:
   ```yaml
   project:
     name: My Project
     developer_name: "{DEVELOPER_NAME}"
     backend_type: wpforms_crm  # or: custom, api_only, none
     use_cases:
       - forms
       - tracking
   ```

### Phase 3: Plugin Architecture (8-16 hours)
1. Extract WPForms/CRM logic to `integrations/wpforms-crm/`
2. Create integration interface for backend validation
3. Make prompts 10, 13, 14 use integration hooks instead of hardcoded CRM logic

### Phase 4: Onboarding Flow (4-8 hours)
1. Create `00_ONBOARDING_INTERVIEW.md` prompt
2. Add conversational intake to ask:
   - What are you testing? (forms, tracking, user flows, e-commerce)
   - What backend validation do you need? (CRM, database, API, none)
   - Who is the developer contact?
3. Generate project config from answers

---

## Verification Checklist

After extraction, the generic framework should:

- [ ] Have ZERO references to specific clients or developers
- [ ] Have ZERO references to specific form IDs (88839, 88652)
- [ ] Have ZERO references to project-specific field prefixes
- [ ] Use `{PLACEHOLDER}` syntax for all project-specific values
- [ ] Include a `project.yaml` template with documented fields
- [ ] Include an onboarding prompt that configures the project
- [ ] Work for non-forms use cases (tracking verification, user flow testing)
- [ ] Have optional integration points for backend validation

---

## Appendix: Search Commands Used

```bash
# Find hardcoded names
grep -r "{DEVELOPER_NAME}" framework/prompts/ --include="*.md" | wc -l
grep -r "{crm_field_prefix}" framework/prompts/ --include="*.md" | wc -l
grep -r "WPForms\|wpforms\|88839\|88652" framework/prompts/ --include="*.md" | wc -l  # 104
grep -r "REFERENCE_CLIENT" framework/prompts/ --include="*.md" | wc -l
grep -r "form\|Form\|submission" framework/prompts/ --include="*.md" | wc -l  # 267
```
