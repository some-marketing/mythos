# 03 — Source Format Compiler

> **Type**: Atomic
> **Mode**: PATCH_ALLOWED — reads model documents and source format instances, writes compiler module and compiled plan instances. Does not modify prompt files, framework definitions, or schema files.
> **Purpose**: Build a compiler that transforms one named Source Format into the Normalized Plan representation defined in prompt 02. This prompt is parameterized — it runs once per Source Format. The `SOURCE_FORMAT_NAME` Binding Point identifies which format is being compiled in a given run.

---

## Prerequisites

Read `00_SHARED_DEFINITIONS.md` before executing this prompt. All capitalized terms are defined there.

Both prompt 01 (`01_ARTIFACT_CONTRACT_DEFINITION.md`) and prompt 02 (`02_NORMALIZED_EXECUTION_MODEL_DESIGN.md`) must have completed successfully before this prompt runs:

- `docs/ARTIFACT_CONTRACT.md` must exist at `PROJECT_ROOT`
- `docs/NORMALIZED_EXECUTION_MODEL.md` must exist at `PROJECT_ROOT`

If `schemas/execution-plan.schema.json` exists (Graduation L1 or higher), it will be used to validate compiler output. If it does not exist (L0), validation is performed by the LLM against the step library in `NORMALIZED_EXECUTION_MODEL.md`.

---

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `FRAMEWORK_ID` | Yes | Identifier of the target framework |
| `PROJECT_ROOT` | Yes | Absolute path to the workspace root |
| `SOURCE_FORMAT_NAME` | Yes | The specific Source Format being compiled in this run. Must be one of the names in `SOURCE_FORMATS` (from `00_SHARED_DEFINITIONS.md`). Resolved from the `SOURCE_FORMAT_NAME` Binding Point. |
| `docs/NORMALIZED_EXECUTION_MODEL.md` | Yes | Written by prompt 02; defines the step library and variable resolution semantics |
| `schemas/execution-plan.schema.json` | No | Written by prompt 02 if at L1 or higher; used to validate compiler output |
| Source format schema or specification | Yes | The schema or specification document for the Source Format named by `SOURCE_FORMAT_NAME` |
| Source format instances | Yes (preferred) | One or more real examples of the Source Format to compile and validate |
| `COMPILER_OUTPUT_PATH` | Yes | Path where the compiler module and compiled instances will be written. Resolved from the `COMPILER_OUTPUT_PATH` Binding Point. |

---

## Process

### Step 1: Read the Execution Model and Source Format Documentation [AUTO]

1. Read `docs/NORMALIZED_EXECUTION_MODEL.md`. Extract:
   - The complete step library (all step types with required/optional parameters and evidence obligations)
   - The variable resolution semantics (placeholder syntax, resolution order, scope rules)
   - The adapter boundary definition
2. Read the source format specification or schema for `SOURCE_FORMAT_NAME`. If the specification does not exist, STOP and report the missing documentation path. Do not proceed without it.
3. If `schemas/execution-plan.schema.json` exists, read it. It will be used to validate all compiled plan instances in Step 6.
4. If source format instances are available (from the `SOURCE_INSTANCES` Binding Point), read them and note their structure. Identify the range of constructs they exercise.

### Step 2: Map Source Format Constructs to Step Types [AUTO]

For each distinct construct in the Source Format specification, determine its corresponding step type in the step library.

A construct is a unit of the Source Format that has executable meaning — a directive, instruction, assertion, or control flow expression.

For each construct, record:

| Field | Description |
|-------|-------------|
| `construct_name` | The name of this construct in the Source Format |
| `construct_description` | What this construct directs the execution environment to do |
| `mapped_step_type` | The step type from the step library it maps to |
| `parameter_mapping` | For each source format field: which step type parameter it populates |
| `decomposition` | If the construct maps to multiple steps: the ordered sequence of step types it decompiles into |
| `notes` | Edge cases, special handling, or ambiguities in the mapping |

If a construct has no corresponding step type in the step library, do not invent a new step type. STOP and report the gap per the Failure Modes table. The gap must be resolved in prompt 02 before compilation can proceed for that construct.

### Step 3: Implement the Compiler [AUTO]

Implement the compiler as a pure function:

**Signature**: `compile(source_instance) → normalized_plan`

Implementation requirements:

1. **Pure function**: Given the same source format instance, the compiler must always produce the same normalized plan. No randomness, no side effects, no external reads during compilation.
2. **Completeness**: Every construct in a valid source format instance must be handled. The compiler must not silently drop constructs it does not recognize — it must raise an error.
3. **Variable reference preservation**: When a source format construct contains a variable reference, the compiler must preserve it in the corresponding step's parameter value using the placeholder syntax defined in `NORMALIZED_EXECUTION_MODEL.md`. The compiler must not attempt to resolve variables — resolution happens at plan execution time.
4. **Conditional logic**: When the source format contains branching or looping constructs, compile them into the corresponding control flow step types. Preserve all branch conditions as expressions, not resolved booleans.
5. **Format-specific idioms**: Document any source format idioms that require special handling — constructs whose surface syntax is misleading, abbreviations that expand to multiple steps, or optional fields that affect step type selection.
6. **Error reporting**: When the compiler encounters an invalid or unrecognized construct, it must produce a structured error that identifies: the construct, its location in the source instance, and the reason it could not be compiled.

Implement the compiler at the path specified by `COMPILER_OUTPUT_PATH`. The implementation language and module format are determined by the framework author (not declared in this prompt).

### Step 4: Handle Conditional Logic and Variable References [AUTO]

This step refines the implementation of two areas where compilers commonly make errors.

**Conditional logic:**
- Each branch condition in the source format must be preserved as a condition expression in the corresponding conditional step type's parameters.
- Do not evaluate conditions at compile time. A compiler that resolves `if user_role == "admin"` to a hardcoded `true` or `false` is incorrect — the condition must survive into the Normalized Plan.
- Nested conditionals must be represented as nested control flow steps, not flattened.
- If the source format uses a loop construct, compile it into the corresponding loop step type. Preserve the iteration target and condition.

**Variable references:**
- Identify every location in the source format where a value is injected at runtime (as opposed to authored at design time).
- Translate each such location to the variable placeholder syntax from `NORMALIZED_EXECUTION_MODEL.md`.
- If a source format construct uses a different variable syntax than the Normalized Plan, the compiler is responsible for the translation. Do not propagate source-format variable syntax into the compiled plan.
- If a variable reference in the source format refers to a binding name that is not declared in the framework's variable registry, record it as an `undeclared_variable` in the compiler error output and flag for framework author review.

### Step 5: Validate Compiler Output Against Schema [AUTO]

Compile at least one source format instance. If real instances are available (from `SOURCE_INSTANCES`), use a real instance. If no real instances are available, construct a synthetic instance that exercises as many step types as possible, and flag it as synthetic.

For each compiled plan instance:

1. If `schemas/execution-plan.schema.json` exists:
   - Validate the compiled plan against the schema.
   - If validation fails, record the validation errors. The compiler has a bug — fix the compiler. Do not modify the schema to accommodate bad output.
   - Repeat until the compiled plan passes validation.

2. If no schema file exists (L0):
   - Check each step in the compiled plan against the step library in `NORMALIZED_EXECUTION_MODEL.md`.
   - For each step: confirm the `step_type` is a known step type; confirm all required parameters are present; confirm no required parameter has a null or empty value (unless the source format instance intentionally left it unspecified, in which case flag for review).
   - Record any deviations as compiler errors.

3. Record the validation result for each instance:
   - `passed`: compiled plan is valid
   - `failed_with_errors`: compiler errors found (list each error)
   - `synthetic_instance`: real instances were not available; this result flags for later validation

### Step 6: Compile at Least One Real Instance [AUTO]

If real source format instances are available (from `SOURCE_INSTANCES`), select one representative instance and compile it completely. Verify:

1. The compiled plan captures all the semantic intent of the source format instance.
2. No constructs were dropped or silently defaulted.
3. All variable references are preserved in placeholder syntax.
4. All conditional logic branches are present.
5. The compiled plan validates per Step 5.

If no real instances are available, record a `WARN` in the compiler output: `No real instances available. Synthetic example compiled. Validation against real instances deferred.`

### Step 7: Review Compiled Plan for Semantic Fidelity [USER]

Present the following for framework author review:

1. The construct-to-step-type mapping table from Step 2
2. One compiled plan instance (real or synthetic) formatted for readability
3. The validation result
4. Any flagged items:
   - Constructs with no step type mapping (should be resolved before reaching this step, but surface if any remain)
   - Undeclared variable references
   - Synthetic instance warning (if no real instances were available)
   - Edge cases or ambiguities noted in Step 2

Ask the framework author:

1. Does the compiled plan accurately represent the intent of the source format instance? Are any actions missing, reordered, or semantically altered?
2. Are there source format idioms that the compiler handles incorrectly or incompletely?
3. Are the flagged undeclared variable references expected, or do they indicate a naming mismatch between the source format and the framework's variable registry?

**STOP and wait for user response. Apply all corrections before writing the final compiler module in Step 8.**

### Step 8: Write the Compiler Module [AUTO]

Write the final compiler module at the path specified by `COMPILER_OUTPUT_PATH`.

The compiler module must include:

1. The `compile` function (pure, deterministic)
2. Inline documentation of the construct-to-step-type mapping for each construct
3. Inline documentation of any source format idioms that require special handling
4. Error type definitions for the structured error output from Step 3
5. At minimum one compiled plan instance file written alongside the compiler as a reference example (real instance preferred, synthetic acceptable with a clear annotation)

If the framework uses a structured package or module system, place the compiler module within that system's conventions. The path is determined by `COMPILER_OUTPUT_PATH`, not by this prompt.

---

## Outputs

| Artifact | Path | Condition |
|----------|------|-----------|
| Compiler module | `{COMPILER_OUTPUT_PATH}` | Always written |
| Compiled plan instances | Adjacent to compiler module or as declared in `ARTIFACT_CONTRACT.md` | At least one always written |

---

## Success Criteria

- `NORMALIZED_EXECUTION_MODEL.md` read; step library and variable semantics extracted
- Source format specification located and read
- Every source format construct mapped to a step type (no unmapped constructs without a documented gap)
- Compiler implemented as a pure function
- Variable references preserved in placeholder syntax; no runtime resolution at compile time
- Conditional logic preserved; no compile-time branch evaluation
- At least one plan instance compiled
- Compiled plan instance validates against schema (if schema exists) or passes LLM step-library check (if at L0)
- Framework author review completed; all corrections applied
- Compiler module written at `COMPILER_OUTPUT_PATH` with required documentation
- At least one compiled plan instance written alongside the compiler
- No forbidden labels per `guardrails.md` in any written artifact

---

## Failure Modes

| Condition | Action |
|-----------|--------|
| Source format has constructs with no normalized plan step type equivalent | STOP; report the unmapped construct(s) as a gap in the execution model; do not proceed until prompt 02 is re-run to add the missing step type(s) |
| Compiled plan fails schema validation | Fix the compiler; do not modify the schema to accommodate bad output; recompile and revalidate |
| No real instances available to test | WARN; proceed with synthetic example; annotate the compiled instance as synthetic; flag the compiler as requiring real-instance validation before the framework reaches Graduation L2 |
| Compiler produces different output for the same input on repeated runs | The compiler is not pure; diagnose and fix the non-determinism before writing the final module |
| Variable reference in source format uses syntax not covered by the translation rule | Record as `undeclared_variable`; surface in Step 7 user review; do not silently discard the reference |
| Conditional logic in source format cannot be cleanly mapped to any control flow step type | STOP; report the construct; treat as a gap in the execution model (same as unmapped construct failure) |
| Source format specification is ambiguous about a construct's semantics | Present both interpretations in Step 7 user review; do not pick one unilaterally |

---

## Graduation Path

| Level | What changes |
|-------|-------------|
| L0 | LLM writes the full compiler from reading the source format specification and `NORMALIZED_EXECUTION_MODEL.md`. Compiler is expressed as annotated logic (pseudocode, structured prose, or a target-language implementation). Validation is performed by the LLM checking the compiled output against the step library. |
| L1 | Compiled plan instances are validated against `schemas/execution-plan.schema.json`. A verification script gates any commit of a new compiler on this validation passing. LLM still writes the compiler implementation. |
| L2 | Compiler has unit tests covering each construct-to-step-type mapping. All known real source format instances compile successfully and pass validation. Step library is frozen at this point. |
| L3 | Compiler is stable, tested code. LLM handles only new source format constructs that appear after the step library was frozen — it maps them to new step types (which require prompt 02 to be updated) or to existing step types with new parameter configurations. |
| L4 | Compiler is fully deterministic and mechanically maintained. LLM is invoked only when the source format schema itself changes in a way that introduces constructs the existing step library cannot cover. |

---

## Binding Points

| Name | Description |
|------|-------------|
| `SOURCE_FORMAT_NAME` | The name of the specific Source Format being compiled in this run. Must match one of the names in the `SOURCE_FORMATS` variable. This prompt runs once per Source Format — invoke it separately for each format that needs a compiler. |
| `SOURCE_FORMAT_SCHEMA` | Path to the schema or specification file for the Source Format named by `SOURCE_FORMAT_NAME`. Used in Step 1 to read the format's structure. If no schema file exists and the format is documented only in prose, provide the path to the prose specification. |
| `SOURCE_INSTANCES` | Path or glob pattern to real source format instances for `SOURCE_FORMAT_NAME`. Used in Steps 5 and 6 to compile and validate. If no real instances exist yet, set this to `none` and the compiler will use a synthetic example with a WARN annotation. |
| `COMPILER_OUTPUT_PATH` | The path where the compiler module and compiled plan instances will be written. Determined by the framework author based on the framework's module structure. Example: `runtime/compilers/{SOURCE_FORMAT_NAME}/index.js` or `src/compilers/{source_format_name}.py`. |
