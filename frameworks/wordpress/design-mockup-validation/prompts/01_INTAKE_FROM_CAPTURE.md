# 01 Intake From Capture

## Objective
Collect the normalized task inputs and produce a deterministic execution plan that the next prompt can consume directly.

## Mode
RUN_ONLY

## Inputs
- `intake.json` — element definitions, target page, iteration count
- `context.md` — project scope, client constraints, design spec references
- `reference_artifacts/` — living spec, design constraints, evidence bundle (optional)

## Steps
1. Read `intake.json` and validate against `schemas/intake.schema.json`.
2. Read `context.md` and extract: spec reference path, constraint reference path, target site URL.
3. Enumerate the elements to be mocked up from `intake.json`.
4. For each element, resolve evidence paths (scrape targets, existing screenshots, data sources).
5. Write `outputs/execution-plan.json` with the full element list, evidence paths, spec references, and iteration parameters.
6. If any required input is missing, write an input gap report to `outputs/input-gaps.md` and stop.

## Outputs
- `outputs/execution-plan.json` — consumed by Prompt 02
- `outputs/input-gaps.md` — only if missing inputs detected (blocks further execution)

## Success Criteria
- `execution-plan.json` validates against a deterministic structure (element list, paths, params)
- All spec and constraint references resolve to real files
- No client-specific data embedded in framework-level files

## Guardrails
- Follow guardrails.md RUN_ONLY constraints
- Pause if hidden operator judgment is still required
