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
3. Define acceptance criteria for every material delta.
4. Group independent acceptance work into optional waves.
5. Identify cross-consumer sequencing and compatibility risks.
6. Leave execution mechanism and tool choice unresolved.

## Outputs

- `dependency-acceptance-map.json`

## Success criteria

- Dependency edges are evidence-backed and acyclic.
- Every material delta has an acceptance criterion.
- Parallelism is optional and never inferred from convenience alone.
