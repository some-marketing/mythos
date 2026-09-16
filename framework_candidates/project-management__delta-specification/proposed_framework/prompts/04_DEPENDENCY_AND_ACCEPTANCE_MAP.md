# 04 Dependency and Acceptance Map

## Objective

Map reading prerequisites, dependencies, acceptance criteria, and optional execution waves without turning the specification into an implementation plan.

## Mode

RUN_ONLY

## Inputs

- Baseline inventory
- Change proposal
- Delta requirements

## Steps

1. Identify artifacts that downstream work must read first.
2. Add explicit `depends_on` relationships only where one requirement or acceptance check truly requires another.
3. Preserve the requirement or evidence identifier that supports each dependency and acceptance claim; mark an unavailable basis explicitly.
4. Define acceptance criteria for every material delta.
5. Group independent acceptance work into optional waves.
6. Identify cross-consumer sequencing and compatibility risks.
7. Leave execution mechanism and tool choice unresolved.

## Outputs

- `dependency-acceptance-map.json`

## Success criteria

- Dependency edges are evidence-backed and acyclic.
- Every material delta has an acceptance criterion.
- Every dependency and acceptance claim has an evidence basis or an explicit gap.
- Parallelism is optional and never inferred from convenience alone.
