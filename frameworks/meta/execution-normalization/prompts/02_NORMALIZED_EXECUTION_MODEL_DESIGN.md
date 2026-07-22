# 02 — Normalized Execution Model Design

> **Type**: Atomic
> **Mode**: REVIEW_ONLY — reads artifact contract and source format documentation, writes design artifacts to `docs/` and optionally `schemas/`. Never modifies source files, prompt files, or framework definitions.
> **Purpose**: Design the Normalized Plan — the intermediate representation that all Source Formats compile into before execution. The output is a step library, a variable resolution specification, and a documented adapter boundary. All Source Format compilers (prompt 03) depend on this model.

---

## Prerequisites

Read `00_SHARED_DEFINITIONS.md` before executing this prompt. All capitalized terms are defined there.

Prompt 01 (`01_ARTIFACT_CONTRACT_DEFINITION.md`) must have completed successfully and `docs/ARTIFACT_CONTRACT.md` must exist at `PROJECT_ROOT` before this prompt runs.

---

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `FRAMEWORK_ID` | Yes | Identifier of the target framework |
| `PROJECT_ROOT` | Yes | Absolute path to the workspace root |
| `SOURCE_FORMATS` | Yes | List of Source Format names for the target framework (from `SOURCE_FORMATS` Binding Point) |
| `EXECUTION_ENV` | Yes | Abstract name of the Execution Environment that will consume Normalized Plans (from `EXECUTION_ENV` Binding Point) |
| `docs/ARTIFACT_CONTRACT.md` | Yes | Written by prompt 01; defines the artifact types this model must account for |
| Source format documentation | Yes | Specification or documentation files for each named Source Format |
| Existing execution code | No | Any existing runner, executor, or adapter code in the framework |

---

## Process

### Step 1: Read the Artifact Contract and Source Format Documentation [AUTO]

1. Read `docs/ARTIFACT_CONTRACT.md` at `PROJECT_ROOT`. Record: all artifact types, their lifecycle stages, and any references to execution-related artifacts.
2. For each name in `SOURCE_FORMATS`, locate the corresponding documentation:
   - Look for a schema file, specification document, or example files under `frameworks/{FRAMEWORK_ID}/`.
   - If no documentation is found for a named Source Format, record it as `undocumented` and flag for Step 6.
3. If existing execution code is present (runners, adapters, step handlers), read it. Note any implicit step types or behaviors it already implements.
4. If `ARTIFACT_CONTRACT.md` does not exist, STOP and report that prompt 01 must complete before this prompt can run.

### Step 2: Identify the Union of All Operations [AUTO]

Across all documented Source Formats, identify every distinct operation that a Normalized Plan must be able to express. An operation is a discrete action or assertion that a practitioner can specify in a Source Format.

For each discovered operation, record:
- A candidate name (to be refined in Step 3)
- The Source Format(s) it appears in
- Whether it is an action (does something to the environment), an assertion (checks a condition), a control flow instruction, or an evidence capture directive

Group operations into these abstract categories:

| Category | Description |
|----------|-------------|
| Navigation | Moving to a new context, location, or state within the execution environment |
| Data entry | Providing input values to the execution environment |
| Interaction | Triggering actions (submit, select, toggle, activate) |
| Assertion | Verifying that a condition holds in the current state |
| Evidence capture | Directing the environment to record a state snapshot |
| Conditional logic | Branching or looping based on runtime conditions |
| Variable injection | Inserting a resolved runtime value into the plan |
| Wait / synchronization | Pausing execution until a condition is met |
| Teardown | Cleanup actions at the end of a run or on failure |

If an operation from a Source Format does not fit any category, record it as `uncategorized` and flag for Step 6.

### Step 3: Design the Step Library [AUTO]

For each operation identified in Step 2, define a corresponding step type in the step library.

Each step type definition must include:

| Field | Description |
|-------|-------------|
| `step_type` | Stable, unique name for this step type (snake_case) |
| `category` | One of the operation categories from Step 2 |
| `description` | One-sentence description of what this step instructs the environment to do |
| `required_parameters` | Parameters that must be present for the step to be valid; for each: name, type, description |
| `optional_parameters` | Parameters that may be present; for each: name, type, description, default behavior when absent |
| `evidence_obligations` | What Evidence the Execution Environment must emit when executing this step type: none, on-failure, always, or a named Evidence type |
| `source_format_origins` | Which Source Format(s) map to this step type |

Design rules for the step library:

1. Every step type must have at least one `required_parameter` unless the step's meaning is entirely self-contained.
2. Step types must not encode Execution Environment implementation details (selectors, API calls, SDK methods). Those belong on the environment side of the adapter boundary.
3. A single Source Format construct may map to multiple step types (e.g., a compound source format action may decompose into a navigation step followed by an interaction step).
4. The inverse is also permitted: multiple Source Format constructs that differ only in surface syntax may map to a single step type with different parameter values.
5. Control flow step types (conditionals, loops) must define how they reference or inline other steps.

### Step 4: Define Variable Resolution Semantics [AUTO]

A Normalized Plan may contain variable references — placeholders that are resolved to concrete values at runtime. Define the complete semantics of variable resolution:

1. **Syntax**: How variable references are written in a plan step's parameter values (e.g., a delimited placeholder syntax). Choose a syntax that does not conflict with literal parameter values in any known Source Format.
2. **Resolution order**: The precedence chain for resolving a variable reference. Define at minimum: run-level bindings, project-level bindings, framework defaults. If a variable is unresolvable at plan execution time, the step must not silently use a null or empty value — it must raise a resolution error.
3. **Scope**: Whether variable bindings are step-scoped, plan-scoped, or run-scoped. Document which scope applies by default and how a step can override it.
4. **Immutability**: Once a variable is bound at plan execution time, whether it can be rebound mid-run. The default must be immutable unless there is a documented reason to allow rebinding.
5. **Error behavior**: What happens when a required variable cannot be resolved. The framework must define this; the Execution Environment must not invent its own fallback behavior.

### Step 5: Define the Adapter Boundary [AUTO]

The adapter boundary separates what the framework owns from what the Execution Environment owns. Document the boundary as two explicit lists:

**Framework responsibilities (the Normalized Plan layer):**
- Defining step types and their parameter contracts
- Compiling Source Formats into sequences of typed steps
- Resolving variable references before or during plan execution
- Declaring Evidence obligations per step type
- Allocating and managing Run Containers

**Execution Environment responsibilities (beyond the boundary):**
- Translating each typed step into concrete environment-specific operations
- Emitting Evidence of the declared types at the declared obligations
- Reporting step-level execution status back to the framework
- Managing environment-level state (sessions, credentials, timeouts) that the framework does not specify

Document any responsibilities that are ambiguous — things that could reasonably belong on either side. Flag these as `boundary_ambiguities` for Step 6 review.

### Step 6: Review Step Library and Adapter Boundary [USER]

Present the following for framework author review:

1. The complete step library (all step types with their fields)
2. The adapter boundary definition (framework vs environment responsibilities)
3. A list of any flagged items:
   - Undocumented Source Formats from Step 1
   - Uncategorized operations from Step 2
   - Boundary ambiguities from Step 5

Ask the framework author:

1. Are any domain operations missing from the step library? Consider edge cases: error handling paths, multi-step compound operations, domain-specific idioms.
2. Are any step type names ambiguous or likely to collide with terms used in Source Format documentation?
3. Are the boundary ambiguities correctly characterized? Which side should own each?
4. Are the variable resolution semantics complete? Are there Source Format constructs that inject values in ways not covered?

**STOP and wait for user response. Do not proceed until the review is complete.**

Apply all corrections before writing outputs in Step 7.

### Step 7: Write NORMALIZED_EXECUTION_MODEL.md [AUTO]

Write `docs/NORMALIZED_EXECUTION_MODEL.md` at `PROJECT_ROOT`. The document must contain these sections in order:

```markdown
# Normalized Execution Model — {FRAMEWORK_ID}

## Overview
- Framework: {FRAMEWORK_ID}
- Source formats covered: {list from SOURCE_FORMATS}
- Execution environment: {EXECUTION_ENV}
- Model version: 1.0
- Generated: {ISO-8601 date}
- Total step types: {exact integer}

## Step Library

### Step Type: {step_type}
- Category: {category}
- Description: {one sentence}
- Required parameters: {table: name, type, description}
- Optional parameters: {table: name, type, description, default}
- Evidence obligations: {none | on-failure | always | named type}
- Source format origins: {list}

[Repeat for each step type]

## Variable Resolution Semantics
- Placeholder syntax: {definition}
- Resolution order: {precedence chain}
- Scope rules: {step | plan | run}
- Immutability: {immutable | rebound under conditions}
- Error behavior: {what happens on unresolvable reference}

## Adapter Boundary

### Framework Responsibilities
[Bulleted list]

### Execution Environment Responsibilities
[Bulleted list]

### Boundary Ambiguities (if any)
[Items flagged as ambiguous with resolution]

## Open Questions for Review
[Any items not resolved during the Step 6 review]
```

### Step 8: Optionally Produce Execution Plan Schema [AUTO]

If the framework is at Graduation Level L1 or higher (i.e., a verification script exists or is planned), produce a schema file at `schemas/execution-plan.schema.json`.

The schema must:
- Define the top-level plan structure: a named sequence of steps
- Define each step as a typed object with a `step_type` discriminator field
- Include all required and optional parameter fields for each step type
- Allow additional fields on each step for Execution Environment metadata (using an open schema extension pattern)

If the framework is at L0, do not write the schema file. Record in `NORMALIZED_EXECUTION_MODEL.md` that schema generation is deferred to L1.

---

## Outputs

| Artifact | Path | Condition |
|----------|------|-----------|
| `NORMALIZED_EXECUTION_MODEL.md` | `docs/NORMALIZED_EXECUTION_MODEL.md` | Always written |
| `execution-plan.schema.json` | `schemas/execution-plan.schema.json` | Written if framework is at Graduation L1 or higher |

---

## Success Criteria

- `ARTIFACT_CONTRACT.md` read without error; all artifact types noted
- All Source Formats in `SOURCE_FORMATS` located and read (or flagged if undocumented)
- Full operation union identified across all Source Formats
- Every operation assigned to a category or flagged as uncategorized
- Step library defines a step type for every operation
- Every step type has required parameters, optional parameters, and evidence obligations
- Variable resolution semantics are complete (syntax, order, scope, immutability, error behavior)
- Adapter boundary is fully specified with no undocumented ambiguities
- Framework author review completed and all corrections applied
- `NORMALIZED_EXECUTION_MODEL.md` written with all required sections
- Schema file written if and only if framework is at L1 or higher
- No forbidden labels per `guardrails.md` in any written document

---

## Failure Modes

| Condition | Action |
|-----------|--------|
| `ARTIFACT_CONTRACT.md` does not exist | STOP; report that prompt 01 must complete first |
| A named Source Format has no documentation | Flag as `undocumented`; surface in Step 6 user review; do not proceed to step library for that format until documentation is provided or the format is explicitly excluded by the framework author |
| Two Source Formats use the same construct name with different semantics | Record both semantics; design separate step types with distinct names; flag in Step 6 as a naming conflict for author resolution |
| An operation cannot be expressed in any step category | Record as `uncategorized`; present in Step 6 with a proposed new category for author approval before adding it |
| Variable resolution semantics contain a cycle (variable references another variable which references the first) | Flag as a CRITICAL design error; do not define cycle-resolution behavior; require framework author to eliminate the cycle |
| Framework author does not respond to Step 6 review | Do not proceed; leave the process paused at Step 6 |

---

## Graduation Path

| Level | What changes |
|-------|-------------|
| L0 | LLM designs the full model by reading Source Format documentation. Step library, variable resolution semantics, and adapter boundary are all produced as prose. No schema file. |
| L1 | Schema file `schemas/execution-plan.schema.json` exists. Verification script checks that normalized plan instances produced by any compiler validate against it. LLM still designs the model content. |
| L2 | Every Source Format has at least one real instance that has been compiled into a Normalized Plan and validated against the schema. Step library is considered frozen at this point — changes require a version increment. |
| L3 | Code generates the step library from Source Format schemas. LLM resolves only ambiguous operations that the code cannot unambiguously classify. Human reviews the generated step library before the model document is written. |
| L4 | Step library is fully code-derived. Schema is auto-generated from the step type registry. LLM is invoked only when a new operation type appears in a Source Format that no existing step type covers. |

---

## Binding Points

| Name | Description |
|------|-------------|
| `SOURCE_FORMATS` | The named Source Format types in the target framework. Each name must have a corresponding documentation file or schema file discoverable under `frameworks/{FRAMEWORK_ID}/`. |
| `EXECUTION_ENV` | The abstract name of the Execution Environment. Used when documenting the adapter boundary and when naming the environment's responsibilities. Does not reference a specific tool or product. |
| `STEP_TYPES (discovered)` | The list of step type names produced by Step 3 of this prompt. Not supplied up front — derived by running this prompt. Becomes the input to prompt 03 when building compilers for each Source Format. |
