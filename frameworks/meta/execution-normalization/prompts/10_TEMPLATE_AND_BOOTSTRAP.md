# 10 — Template and Bootstrap

## Type
Playbook

## Execution Mode
COORDINATOR — orchestrate template extraction and project bootstrap. Delegate implementation sub-steps to the patterns established in prior prompts. Do not directly modify source files of the origin framework during extraction; all writes target the template output directory or the new project directory.

## Purpose
Extract the framework into a portable, self-contained template, then guide the setup of a new project from that template. This is a two-phase orchestrator: Phase 1 produces the template; Phase 2 instantiates it for a new project and verifies end-to-end pipeline operation.

---

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `docs/ARTIFACT_CONTRACT.md` | Yes | Canonical artifact and directory structure; defines what belongs to the framework vs. the project |
| `docs/NORMALIZED_EXECUTION_MODEL.md` | Yes | Abstract execution model; defines what the framework does independent of any specific run |
| Framework manifest | Yes | `manifest.json` at the framework root; lists all prompts, modes, and declared bindings |
| All prior prompt outputs | Yes | Compiled source instances, runner code, parity reports, reporting pipelines, reconciliation artifacts, bundle assembler — the complete normalized pipeline |
| `PROJECT_NAME` | Yes | Phase 2 input; the name of the new project being bootstrapped |
| Domain-specific configuration | No | Phase 2 input; any project-specific binding values supplied by the user (including concrete values for `EXECUTION_TARGET`, `EXECUTION_ENVIRONMENTS`, and other Binding Points declared below) |

---

## Phase 1 — Template Extraction

### Step 1.1: Read Core Framework Documents [AUTO]
1. Open `docs/ARTIFACT_CONTRACT.md` and `docs/NORMALIZED_EXECUTION_MODEL.md`
2. Open the framework manifest
3. From these three sources, identify the complete set of framework-owned files:
   - All files declared in the ARTIFACT_CONTRACT as framework artifacts (schemas, runner code, prompt files, shared definitions)
   - All files listed in the manifest
   - All files under the framework's `prompts/`, `schemas/`, and runner directories
4. Identify the complete set of project-specific files:
   - Run containers and their contents
   - Compiled source format instances that contain project data
   - Configuration files that reference project-specific values (URLs, identifiers, credentials)
   - Reports and reconciliation outputs from specific runs

### Step 1.2: Identify Framework vs. Project-Specific Files [AUTO]
1. For each file in the framework directory, classify it as:
   - **Framework-owned**: part of the reusable template; should travel with the template
   - **Project-specific**: tied to a particular project instance; should not travel with the template
   - **Ambiguous**: cannot be classified without further inspection; flag for user review
2. Produce a classification inventory as an intermediate artifact: `template_extraction/file_classification.json`
3. For any file classified as ambiguous, record the reason for ambiguity and the information needed to resolve it

### Step 1.3: Create Template Structure [AUTO]
Using the classification inventory, construct the template directory:

**Framework copy** — copy all framework-owned files to the template directory, preserving the internal structure declared in the ARTIFACT_CONTRACT.

**Project scaffold** — create an empty project structure with:
- Placeholder directories for run containers, compiled instances, and reports
- A `project.json` configuration file template with all required fields present but unfilled (values replaced with `"<REQUIRED>"` or `"<OPTIONAL>"` annotations)
- An `environments.json` template listing the environment names as blank entries

**Configuration templates** — for each Binding Point declared across all prompts in this framework, create a corresponding entry in a `bindings.template.json` file. Each entry must include:
- The binding name
- Whether it is required or optional
- A one-line description of the expected value
- A placeholder value: `"<REQUIRED>"` or `"<OPTIONAL>"`

**Example instances** — copy one representative compiled source format instance (with any project-specific values redacted) into `template/examples/` so new users can see the format before authoring their own

### Step 1.4: Write Getting-Started Documentation [AUTO]
Write `template/GETTING_STARTED.md` with the following sections:
1. **What this template is** — one paragraph describing the normalized execution pipeline and what adopting it provides
2. **Prerequisites** — a checklist of what a new project must supply before running Phase 2 bootstrap
3. **Binding Points reference** — table of all bindings from `bindings.template.json` with their descriptions
4. **Bootstrap steps** — numbered steps that map directly to Phase 2 of this prompt
5. **First run checklist** — what to verify after the first run completes

### Step 1.5: Verify Template is Self-Contained [AUTO]
Perform a self-containment check on the template directory:

1. Scan all files in the template for references to project-specific values:
   - Hardcoded paths containing project names or identifiers
   - Absolute paths that are not parameterized
   - Binding values that were left at their project-specific concrete values instead of being replaced with placeholders
2. For each dangling reference found, record it as an extraction gap observation
3. If any extraction gaps exist, report them before proceeding to Step 1.6

### Step 1.6: Review Template Structure [USER]
1. Present the template directory structure to the user
2. Show:
   - The classification inventory summary (framework-owned vs. project-specific vs. ambiguous counts)
   - Any dangling references found in Step 1.5
   - Any files classified as ambiguous in Step 1.2
3. Ask the user to confirm that the template structure is correct before proceeding to Phase 2
4. STOP and wait for user response
5. If the user identifies misclassified files or missing content, record as open questions; resolve before continuing

---

## Phase 2 — Project Bootstrap

### Step 2.1: Collect New Project Context [USER]
Gather the following from the user before any files are written:

1. **PROJECT_NAME** — the name of the new project
2. **Domain-specific binding values** — concrete values for each `<REQUIRED>` binding in `bindings.template.json` (including `EXECUTION_TARGET` and `EXECUTION_ENVIRONMENTS` if applicable to this framework type)
3. **Optional binding values** — any `<OPTIONAL>` bindings the user wants to supply now

STOP and wait for user response. Do not proceed until all `<REQUIRED>` fields are supplied.

### Step 2.2: Initialize Project from Template [AUTO]
1. Copy the template scaffold to a new project directory
2. Populate `project.json` with the collected project context
3. Populate `environments.json` with the declared environment names
4. Write `bindings.json` with all supplied binding values
5. Verify that no `<REQUIRED>` placeholders remain in any configuration file

### Step 2.3: Guide Authoring of First Source Format Instance [AUTO]
Using the patterns established in Prompt 03:

1. Locate the example instance copied into `template/examples/` during Phase 1
2. Present the example to the user as a reference
3. Guide the user through authoring a first source format instance specific to the new project
4. Do not write the instance on the user's behalf — the instance contains domain knowledge only the user can supply
5. When the user provides the instance content, validate it against the source format schema (if a schema exists at L2 or above)
6. Write the validated instance to the appropriate location in the project directory

### Step 2.4: Execute First Run Through Native Engine [AUTO]
Using the patterns established in Prompt 05:

1. Invoke the native execution engine with the newly authored source format instance
2. Pass the project context values (including any `EXECUTION_TARGET` and `EXECUTION_ENVIRONMENTS` bindings) as runtime parameters
3. Monitor the run for completion
4. Collect the run evidence to the run container (structured per `RUN_CONTAINER_STRUCTURE` binding if declared)

### Step 2.5: Verify Evidence Collection Pipeline [AUTO]
1. Open the run container created during Step 2.4
2. Verify that:
   - The run metadata file is present and valid
   - Evidence subdirectories exist for each declared execution environment (if `EXECUTION_ENVIRONMENTS` binding was supplied)
   - At least one evidence artifact was written to each environment directory
   - No evidence collection errors were reported during the run
3. Record the verification result as an observation (evidence present / evidence missing)
4. Do not interpret the quality of the evidence — only confirm that the pipeline collected something

### Step 2.6: Present Summary and Next Steps [AUTO]
Write a `bootstrap_summary.md` in the project directory with:

1. **Extraction result** — confirmation that the template was extracted and is self-contained (or list of unresolved extraction gaps)
2. **Project configuration** — PROJECT_NAME, BASE_URL, ENVIRONMENTS, and binding inventory (values redacted for security)
3. **First run result** — run container path, execution environments covered (if applicable), evidence collection status
4. **Verification result** — pass/fail for each pipeline check in Step 2.5
5. **Open Questions for Review** — any items from Steps 1.2, 1.5, 1.6, or 2.3 that remain unresolved
6. **Suggested next steps** — which prompts in this chain are recommended for a full first run (07, 08, or 09 as appropriate for the project's maturity level)

---

## Output

| Artifact | Path | Description |
|----------|------|-------------|
| Template directory | `template/` (or path declared in `TEMPLATE_STRUCTURE` binding) | Self-contained portable framework copy with scaffold and configuration templates |
| `bindings.template.json` | `template/bindings.template.json` | All declared binding points with placeholder values and descriptions |
| `GETTING_STARTED.md` | `template/GETTING_STARTED.md` | Human-readable bootstrap guide for new project adopters |
| `file_classification.json` | `template_extraction/file_classification.json` | Intermediate extraction inventory |
| New project directory | Per `PROJECT_SCAFFOLD` binding | Initialized project with populated configuration and first source format instance |
| First run container | Per run lifecycle (Prompt 04 patterns) | Evidence from the first end-to-end run |
| `bootstrap_summary.md` | New project root | Summary of extraction, bootstrap, and first run results |

---

## Graduation Path

| Level | Indicator | Observable Condition |
|-------|-----------|---------------------|
| L0 | Manual | LLM walks through extraction and bootstrap interactively; no scripts; all steps are conversational |
| L1 | Verified | Template verification checks confirm that the structure is complete, self-contained, and has no dangling references |
| L2 | Coded | Template extraction is a coded script; bootstrap follows a structured, machine-driven checklist; both steps are reproducible |
| L3 | Code-owned | Extraction and scaffold initialization are fully automated; LLM handles only domain-specific configuration questions that require human judgment |
| L4 | Mechanical | End-to-end automated for all known project types; LLM is invoked only when a novel project configuration introduces a binding combination that has never been seen before |

---

## Binding Points

| Binding | Required | Purpose |
|---------|----------|---------|
| `TEMPLATE_STRUCTURE` | Yes | Root-relative path where the template directory should be written; defines the canonical template output location |
| `PROJECT_SCAFFOLD` | Yes | Directory structure expected in a new project initialized from the template; used to validate that bootstrap created the correct layout |
| `EXAMPLE_INSTANCES` | Yes | Paths to representative compiled source format instances (with project values redacted) to be included in the template as authoring references |
| `CONFIGURATION_SCHEMA` | Yes | Schema for `project.json`; used to validate that bootstrap populated all required configuration fields |
| `EXECUTION_TARGET` | No | Primary access point or endpoint for the project's execution target (e.g., a URL, API endpoint, file path, or service identifier). Not all framework types have one — omit for frameworks that operate on local artifacts only |
| `EXECUTION_ENVIRONMENTS` | No | List of named environments the project runs against (e.g., staging, production). Omit for frameworks that do not distinguish environments |
| `RUN_CONTAINER_STRUCTURE` | No | Directory layout within a run container for organizing evidence by environment or category. When omitted, the engine uses a flat evidence directory |

---

## Failure Modes

| Condition | Action |
|-----------|--------|
| Framework has no compiled source format instances | Cannot demonstrate bootstrap; STOP at Phase 2 Step 2.3 — report that at least one source format instance must exist before a project can be bootstrapped |
| First run fails | Delegate diagnosis to the patterns established in Prompt 06; do not attempt to auto-fix; surface the failure as an open question |
| Template contains project-specific references after extraction | Report as an extraction gap; fix dangling references before proceeding to Phase 2; do not bootstrap from an incomplete template |
| `docs/ARTIFACT_CONTRACT.md` does not exist | STOP; Prompt 01 must be completed first |
| `docs/NORMALIZED_EXECUTION_MODEL.md` does not exist | STOP; Prompt 02 must be completed first |
| User does not supply all `<REQUIRED>` binding values in Step 2.1 | STOP; re-present the missing fields and wait; do not substitute defaults for required values |
| New project directory already exists | STOP; report the conflict; do not overwrite an existing project without explicit confirmation |
| File classification produces more than 10% ambiguous files | Report as extraction readiness gap; recommend resolving ambiguities before proceeding to template construction |
