# 05 — Native Execution Engine

## Type
Atomic

## Execution Mode
PATCH_ALLOWED — implement the execution engine scoped to the target framework's runner directory. Do not modify Mythos system files, other frameworks, or the compiled plan input.

## Purpose
Implement an engine that reads normalized plans and executes them against the execution environment, collecting evidence per step. The engine dispatches each step type to the appropriate operation, resolves runtime variables, collects declared evidence, and writes per-step results to canonical output paths.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| `docs/NORMALIZED_EXECUTION_MODEL.md` | Yes | Canonical source for step types, parameters, evidence obligations, and step lifecycle |
| `docs/ARTIFACT_CONTRACT.md` | Yes | Output artifact paths, naming conventions, and result file schemas |
| Compiled plan | Yes | A plan produced by Prompt 03 (SOURCE_FORMAT_COMPILER) ready for execution |
| Run container | Yes | An allocated run container produced by Prompt 04 (NATIVE_RUN_LIFECYCLE) |
| `EXECUTION_ENV` binding | Yes | Descriptor for the execution environment the engine will dispatch operations to |
| `EVIDENCE_TYPES` binding | Yes | Enumeration of evidence types and the collection behavior expected for each |
| `CHECKPOINT_CONFIG` binding | Yes | Step boundaries at which the engine must persist a snapshot of execution state |
| `STEP_DISPATCH_MAP` binding | Yes | Mapping from step type names to the operations the execution environment provides |

## Process

### Step 1: Read NORMALIZED_EXECUTION_MODEL.md [AUTO]
1. Open `docs/NORMALIZED_EXECUTION_MODEL.md`
2. Extract:
   - All declared step types and their parameter schemas
   - Evidence obligations per step type
   - Step lifecycle states (pending, running, passed, failed, skipped)
   - Any pre-conditions or post-conditions declared for step types
3. If `docs/NORMALIZED_EXECUTION_MODEL.md` does not exist, STOP and report that Prompt 02 must be completed first

### Step 2: Read ARTIFACT_CONTRACT.md [AUTO]
1. Open `docs/ARTIFACT_CONTRACT.md`
2. Extract:
   - Path pattern for per-step result files
   - Path pattern for evidence artifacts
   - Path pattern for checkpoint snapshots
   - Required fields in each result record
3. If `docs/ARTIFACT_CONTRACT.md` does not exist, STOP and report that Prompt 01 must be completed first

### Step 3: Implement Step Executor [AUTO]
Implement a step executor that dispatches each step in the compiled plan to the appropriate execution environment operation:

**Dispatch:**
- Read the `STEP_DISPATCH_MAP` binding to map each step type to its corresponding operation
- For each step in the plan, look up the step type in the dispatch map
- If a step type is not present in the dispatch map, classify it as an unresolvable failure and write an error record — do not skip silently

**Parameter binding:**
- Each step declares parameters in the compiled plan
- Pass parameters to the dispatched operation exactly as declared — do not apply defaults or transformations unless the NORMALIZED_EXECUTION_MODEL explicitly specifies them

**Execution environment:**
- Use the `EXECUTION_ENV` binding to identify which execution environment to target
- Do not embed environment-specific logic; delegate to the binding

**Step lifecycle:**
- Before executing a step, record its state as `running`
- After execution completes, record the final state as `passed` or `failed`
- If a step raises an unhandled exception, record as `failed` with full error detail

### Step 4: Implement Variable Resolution [AUTO]
Implement a variable resolver that substitutes runtime values into plan parameters before dispatch:

**Resolution sources (in precedence order):**
1. Environment-specific values from the `EXECUTION_ENV` binding
2. Data extracted by previous steps in the current run (referenced by step ID)
3. Run metadata from the run container (run ID, start time, environment name)

**Resolution rules:**
- Variables are declared in the compiled plan using a placeholder syntax defined by `docs/NORMALIZED_EXECUTION_MODEL.md`
- If a variable cannot be resolved from any source, record the step as `failed` with a `VARIABLE_RESOLUTION_ERROR` and the variable name
- Do not substitute empty strings or nulls silently — unresolved variables are errors, not warnings

### Step 5: Implement Evidence Collection [AUTO]
Implement evidence collection that runs after each step dispatches and before the result is written:

**Per step type:**
- Read the `EVIDENCE_TYPES` binding to determine which evidence types apply to each step type
- For each applicable evidence type, invoke the collection behavior declared in the binding
- Write each collected evidence artifact to the path pattern declared in `docs/ARTIFACT_CONTRACT.md` under the run container

**Non-collection:**
- If a step type has no evidence obligation in the `EVIDENCE_TYPES` binding, record that no evidence was collected — do not invent evidence
- If evidence collection fails (the artifact cannot be produced), record the failure in the step result; do not fabricate a placeholder

### Step 6: Implement Checkpoint Snapshots [AUTO]
Implement checkpoint snapshot persistence at the boundaries declared in `CHECKPOINT_CONFIG`:

**Snapshot content:**
- Current step index within the plan
- State of all steps executed so far (step ID, lifecycle state, evidence paths, error details)
- Variable resolution context accumulated to this point

**Write location:**
- Checkpoints are written to the path pattern declared in `docs/ARTIFACT_CONTRACT.md` within the run container

**Recovery behavior:**
- If a run container already contains a checkpoint, the engine must be able to resume from it rather than re-executing completed steps
- Do not re-execute steps already recorded as `passed` in a checkpoint

### Step 7: Write Per-Step Results [AUTO]
After each step completes, write a result record to the canonical output path:

**Required fields in each result record (per ARTIFACT_CONTRACT.md):**
- `step_id`: identifier from the compiled plan
- `step_type`: type from the dispatch map
- `lifecycle_state`: final state (passed, failed, skipped)
- `evidence_paths`: list of absolute paths to collected evidence artifacts (empty list if none)
- `error_details`: structured error information if `lifecycle_state` is `failed`, otherwise null
- `execution_timestamp`: ISO-8601 time the step completed

**Provenance check:**
- Every `evidence_paths` entry must be a path to a file that exists in the run container
- If a declared evidence artifact does not exist at the recorded path, flag as a `MISSING_EVIDENCE` observation in the result record

### Step 8: Execute One Plan and Review Evidence [USER]
1. Execute a complete plan against a prepared run container using the implemented engine
2. Present to the user:
   - The per-step result records for each step
   - The evidence artifacts produced (paths and types)
   - Any steps that produced errors or missing evidence
3. Ask the user to confirm that the evidence output matches expectations
4. If the user identifies gaps in evidence or unexpected failures, record them as open questions before proceeding to Step 9

### Step 9: Write the Engine Module and CLI Entry Point [AUTO]
1. Assemble all execution logic from Steps 3–7 into a single engine module
2. Expose a CLI entry point (or equivalent interface) that accepts:
   - Path to a compiled plan
   - Path to an allocated run container
   - The `EXECUTION_ENV` binding value as a runtime parameter
3. Write the module to the path declared in `docs/ARTIFACT_CONTRACT.md` under the runner directory
4. Write a brief inline comment at the top of the module citing the NORMALIZED_EXECUTION_MODEL.md sections it implements

## Output
| Artifact | Path | Description |
|----------|------|-------------|
| Engine module | Runner directory (per ARTIFACT_CONTRACT.md) | Code implementing plan execution, variable resolution, evidence collection, checkpointing, and result writing |
| CLI entry point | Runner directory | Callable interface for executing a compiled plan against a run container |
| Per-run evidence artifacts | Run container (per ARTIFACT_CONTRACT.md) | Evidence files collected during Step 8 manual execution |
| Per-step result records | Run container (per ARTIFACT_CONTRACT.md) | Result files for each step executed during Step 8 |

## Graduation Path
| Level | Indicator | Observable Condition |
|-------|-----------|---------------------|
| L0 | Manual | LLM reads the plan and invokes the execution environment step by step; evidence is collected manually |
| L1 | Verified | A verification check confirms that all declared evidence types were collected for each step in a completed run |
| L2 | Coded | Engine is stable code; all step types declared in the dispatch map are implemented; evidence collection is deterministic |
| L3 | Code-owned | Code owns execution; LLM is invoked only to handle runtime exceptions (timeouts, unexpected environment states) |
| L4 | Mechanical | Engine runs autonomously; LLM receives only structured escalation packets for unresolvable failures |

## Binding Points
| Binding | Required | Purpose |
|---------|----------|---------|
| `EXECUTION_ENV` | Yes | Descriptor for the execution environment; used to route dispatched operations and resolve environment-specific variables |
| `EVIDENCE_TYPES` | Yes | Enumeration of evidence types and the collection behavior (what to capture, how to capture it) for each step type |
| `CHECKPOINT_CONFIG` | Yes | Step boundary intervals or conditions at which the engine persists an execution state snapshot |
| `STEP_DISPATCH_MAP` | Yes | Mapping from step type names declared in the execution model to the concrete operations provided by the execution environment |

## Failure Modes
| Condition | Action |
|-----------|--------|
| `docs/NORMALIZED_EXECUTION_MODEL.md` does not exist | STOP; Prompt 02 must be completed first |
| `docs/ARTIFACT_CONTRACT.md` does not exist | STOP; Prompt 01 must be completed first |
| Compiled plan references a step type not in `STEP_DISPATCH_MAP` | Record step as `failed` with `UNKNOWN_STEP_TYPE`; do not skip silently |
| Variable cannot be resolved from any source | Record step as `failed` with `VARIABLE_RESOLUTION_ERROR`; do not substitute null |
| Evidence collection fails to produce an artifact | Record `MISSING_EVIDENCE` in the step result; do not fabricate a placeholder |
| Run container not allocated (Prompt 04 not completed) | STOP; cannot write results without an allocated run container |
| User identifies evidence gaps in Step 8 | Record gaps as open questions; do not proceed to Step 9 until resolved or explicitly deferred |
