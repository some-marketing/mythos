# 04 — Native Run Lifecycle

## Type
Atomic

## Execution Mode
PATCH_ALLOWED — implement the run container allocation module scoped to the target framework's runner directory. Do not modify Mythos system files or other frameworks.

## Purpose
Implement native allocation and management of run containers within the framework. A run container is an isolated workspace for one execution run: a directory structure with metadata, environment subfolders, and evidence collection points.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| `docs/ARTIFACT_CONTRACT.md` | Yes | Canonical source for run container naming rules, folder structure, and metadata schema |
| Existing lifecycle code | No | Current allocation code, if any, for comparison before implementation |
| `ENVIRONMENTS` binding | Yes | List of environment names the run container must support |
| `RUN_ID_FORMAT` binding | Yes | Pattern used to generate deterministic, auto-incrementing run identifiers |
| `METADATA_SCHEMA` binding | Yes | Fields required in the run metadata file written at container creation |
| `PROJECT_LAYOUT` binding | Yes | Root-relative paths where run containers are stored within the project |

## Process

### Step 1: Read ARTIFACT_CONTRACT.md [AUTO]
1. Open `docs/ARTIFACT_CONTRACT.md`
2. Extract the following from the contract:
   - Run container root path pattern
   - Required subdirectory names and their declared purposes
   - Metadata file name and location within the container
   - Naming convention for run IDs
3. If `docs/ARTIFACT_CONTRACT.md` does not exist, STOP and report that contract definition (Prompt 01) must be completed first

### Step 2: Read Existing Lifecycle Code [AUTO]
1. Inspect the target framework's runner directory for any existing allocation code
2. If code exists:
   - Record which allocation behaviors are already implemented
   - Record which behaviors diverge from the contract
   - Note any hardcoded values that should be driven by bindings
3. If no code exists, record that this is a greenfield implementation

### Step 3: Implement Run Container Allocation [AUTO]
Implement the following behaviors as code:

**Project layout detection:**
- Read the `PROJECT_LAYOUT` binding to locate the directory where run containers live
- If the directory does not exist, create it before proceeding
- Do not hardcode the path; always read it from the binding

**Run ID auto-increment:**
- Read the `RUN_ID_FORMAT` binding to determine the identifier pattern
- Inspect the existing run containers in the layout directory to determine the next available ID
- The next ID must be derived mechanically from the existing state — never use timestamps as primary IDs unless the binding specifies it

**Canonical folder structure creation:**
- For each environment declared in the `ENVIRONMENTS` binding, create a subdirectory within the run container
- Create all other subdirectories required by the contract
- If the contract declares optional directories, create them regardless — absence of content is acceptable, absence of structure is not

**Failure guard:**
- If a run container for the derived ID already exists, STOP and report a collision before writing any files

### Step 4: Write Run Metadata [AUTO]
1. Using the `METADATA_SCHEMA` binding, construct the run metadata record:
   - `run_id`: the allocated run identifier
   - `start_time`: ISO-8601 timestamp at container creation
   - `environments`: list of environment names from the `ENVIRONMENTS` binding
   - All other fields declared in `METADATA_SCHEMA`
2. Write the metadata file to the location declared in `docs/ARTIFACT_CONTRACT.md`
3. Verify the written file is valid against the schema before proceeding

### Step 5: Support Configurable Environments [AUTO]
1. Verify that each environment in the `ENVIRONMENTS` binding has a corresponding subdirectory in the created run container
2. If any environment subdirectory is missing, create it and log the discrepancy as an observation
3. Do not create subdirectories for environments not declared in the binding

### Step 6: Confirm Folder Structure [USER]
1. Present the created run container tree to the user
2. Ask the user to confirm that the structure matches project conventions
3. If the user identifies deviations, record them as open questions for implementation adjustment
4. Do not proceed to Step 7 until the user confirms or explicitly defers review

### Step 7: Write the Lifecycle Module [AUTO]
1. Assemble all allocation logic from Steps 3–5 into a single lifecycle module
2. Expose a creation entry point (function, CLI command, or equivalent — as appropriate for the target framework's execution environment)
3. The entry point must accept the `ENVIRONMENTS` binding as a runtime parameter so new environments can be added without code changes
4. Write the module to the path declared in `docs/ARTIFACT_CONTRACT.md` under the runner directory
5. Write a brief inline comment at the top of the module citing the ARTIFACT_CONTRACT.md section it implements

## Output
| Artifact | Path | Description |
|----------|------|-------------|
| Lifecycle module | Runner directory (per ARTIFACT_CONTRACT.md) | Code implementing run container allocation and metadata writing |
| CLI entry point or API | Runner directory | Callable interface for creating run containers |
| Sample run container | As created during implementation | Concrete evidence that allocation works correctly |

## Graduation Path
| Level | Indicator | Observable Condition |
|-------|-----------|---------------------|
| L0 | Manual | LLM creates the folder structure and writes metadata by hand for each run |
| L1 | Verified | A verification check confirms that run containers have the required subdirectories and metadata file |
| L2 | Coded | Lifecycle module exists as code; all allocation steps are deterministic and reproducible |
| L3 | Code-owned | Code owns all allocation; LLM is invoked only when the `ENVIRONMENTS` binding introduces a new environment shape |
| L4 | Mechanical | Fully mechanical allocation; LLM invoked only when `PROJECT_LAYOUT` changes require structural redesign |

## Binding Points
| Binding | Required | Purpose |
|---------|----------|---------|
| `ENVIRONMENTS` | Yes | Ordered list of environment names; one subdirectory is created per entry |
| `RUN_ID_FORMAT` | Yes | Pattern or algorithm for generating run identifiers (e.g., sequential integer, date-prefixed counter) |
| `METADATA_SCHEMA` | Yes | Field names, types, and required/optional flags for the run metadata file |
| `PROJECT_LAYOUT` | Yes | Root-relative path where run containers are allocated within the project |

## Failure Modes
| Condition | Action |
|-----------|--------|
| `docs/ARTIFACT_CONTRACT.md` does not exist | STOP; Prompt 01 must be completed first |
| `PROJECT_LAYOUT` binding is not supplied | STOP; cannot determine where to write run containers without this binding |
| `ENVIRONMENTS` binding is empty | STOP; at least one environment must be declared |
| Run container for derived ID already exists | STOP; report collision, do not overwrite |
| Metadata file fails schema validation after write | Report as a blocking observation; do not proceed to Step 6 |
| User identifies structure deviations in Step 6 | Record deviations as open questions; do not proceed to Step 7 until resolved or explicitly deferred |
