# 00 — Shared Definitions

> **Type**: Reference
> **Mode**: N/A — not directly executable; imported by other prompts in this framework
> **Purpose**: Define the abstract vocabulary used across all execution-normalization prompts. Any term used in prompts 01–03 is defined here. Concrete values for these abstractions are supplied by the framework author via Binding Points.

---

## How to Use This File

This file is a vocabulary reference, not a runnable prompt. When executing prompts 01–03:

1. Read this file first.
2. Treat every term in the Glossary as a defined constant — do not reinterpret these terms.
3. Resolve all abstract references by consulting the Binding Points declared in the executing prompt.
4. When a Binding Point has not been supplied, STOP and request it from the framework author before proceeding.

---

## Glossary

### Artifact

Any file produced or consumed by the framework during a run. Artifacts are the unit of handoff between pipeline stages. An artifact has an identity (name or path pattern), a lifecycle stage (input, intermediate, derived, archived), and an owner (framework or project).

### Source Format

An authored input format that describes what should happen during execution. A Source Format is human-readable and domain-meaningful — it expresses intent in terms a practitioner understands. Examples of abstract Source Format categories include: step-by-step definitions, journey specifications, declarative test cases, interaction scripts. The specific format names for a given framework are declared in the `SOURCE_FORMATS` Binding Point.

### Normalized Plan

The intermediate representation that all Source Formats compile into before execution. A Normalized Plan is a flat, ordered sequence of typed steps. It is format-neutral: it carries no knowledge of which Source Format produced it, and no knowledge of which Execution Environment will consume it. The Normalized Plan is the adapter layer between authoring tools and runtime tools.

### Execution Environment

The runtime system that reads a Normalized Plan and carries out its steps. An Execution Environment receives a Normalized Plan and any runtime variable bindings, executes each step, and emits Evidence. The framework defines the adapter boundary — which responsibilities belong to the framework and which belong to the environment. The concrete environment is declared in the `EXECUTION_ENV` Binding Point.

### Evidence

Data collected during execution that records what happened. Evidence is produced by the Execution Environment as it works through a Normalized Plan. Evidence types vary by domain and are declared in the `EVIDENCE_TYPES` Binding Point. Common abstract categories include: state captures, interaction logs, network traces, assertion results, and timing records.

### Run Container

An allocated workspace created for a single execution run. A Run Container is isolated from other runs: it receives a copy of the inputs it needs, writes Evidence to its own output directory, and does not share mutable state with concurrent runs. Run Containers are created by the framework's run-allocation logic, not by the Execution Environment.

### Binding Point

A placeholder in a framework prompt that the framework author must supply a concrete value for before the prompt can execute. Binding Points are the mechanism by which abstract, reusable prompts become specific to a particular framework and domain. A Binding Point is declared with an ALL_CAPS name and a brief description of the expected value. Binding Points are listed in a dedicated section at the end of each prompt.

Binding Point names follow this convention:
- Scalar values: `FRAMEWORK_ID`, `EXECUTION_ENV`
- Discovered lists: `ARTIFACT_TYPES (discovered)`, `STEP_TYPES (discovered)` — parenthetical note indicates the value is derived by running the prompt, not supplied up front

### Graduation Path

The L0–L4 progression that describes how much of a pipeline stage is driven by an LLM versus by deterministic code. Every prompt in this framework declares a Graduation Path for its output. Graduation is incremental: a framework can ship at L0 and advance to higher levels as it matures.

---

## Graduation Path Levels

| Level | Label | Description |
|-------|-------|-------------|
| L0 | Experimental | LLM performs the entire step by reading inputs and writing outputs. No schema enforcement, no code generation, no automated validation. |
| L1 | Verified | Outputs from L0 are now checked by a verification script. The LLM still produces the artifact; a script confirms it exists and has required sections. |
| L2 | Structured | Schemas exist for all artifact types. Verification validates instances against schemas. At least one real-world instance has been compiled and validated. |
| L3 | Deterministic | Code generates the primary content of the artifact (e.g., step libraries, inventories, compiled plans). The LLM handles only ambiguous or novel cases. |
| L4 | Exception-Only | The entire stage runs mechanically. The LLM is invoked only when a new element appears that no existing schema or rule can handle. |

Graduation level is a property of a specific pipeline stage, not the entire framework. A framework can have prompt 01 at L2 and prompt 03 at L0.

---

## Standard Input Variables

These variables are used across all prompts in this framework. They are resolved from the project context when the framework is invoked.

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `FRAMEWORK_ID` | string | Yes | The unique identifier of the target framework being analyzed or normalized (e.g., `wordpress/qa`). Used to locate the framework's manifest and prompt files. |
| `PROJECT_ROOT` | path | Yes | Absolute path to the root of the workspace where framework outputs will be written. All relative output paths in these prompts are resolved from this root. |
| `SOURCE_FORMATS` | list of strings | Yes | The named Source Format types used by the target framework. Supplied by the framework author. Resolved from the `SOURCE_FORMATS` Binding Point. |
| `EXECUTION_ENV` | string | Yes | The abstract name of the Execution Environment that will consume Normalized Plans. Supplied by the framework author. Resolved from the `EXECUTION_ENV` Binding Point. |
| `EVIDENCE_TYPES` | list of strings | Yes | The Evidence types the target framework's Execution Environment can produce. Supplied by the framework author. Resolved from the `EVIDENCE_TYPES` Binding Point. |

---

## Standard Output Locations

All output paths in this framework are relative to `PROJECT_ROOT`.

| Artifact | Default Path | Producing Prompt |
|----------|-------------|-----------------|
| Artifact Contract | `docs/ARTIFACT_CONTRACT.md` | 01 |
| Artifact Contract Gap Report | `docs/ARTIFACT_CONTRACT_GAP_REPORT.md` | 01 (conditional) |
| Normalized Execution Model | `docs/NORMALIZED_EXECUTION_MODEL.md` | 02 |
| Execution Plan Schema | `schemas/execution-plan.schema.json` | 02 (conditional) |
| Compiler Module | path determined by `COMPILER_OUTPUT_PATH` Binding Point | 03 |
| Compiled Plan Instances | path determined by `COMPILER_OUTPUT_PATH` Binding Point | 03 |

---

## Observational Reporting Reminder

All findings produced by prompts in this framework must follow the observational reporting standard defined in `guardrails.md`:

- State observations, not diagnoses.
- Label interpretations with `HYPOTHESIS:`.
- Cite evidence for every claim using file path and line number where applicable.
- Use `Open Questions for Review:` instead of `Recommendation:` or `Action Required:`.
