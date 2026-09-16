# 04 Dependency and Acceptance Map

## Goal
Construct a map of reading prerequisites, logical dependencies, acceptance criteria, and optional execution waves for the delta specifications, strictly avoiding the creation of a technical implementation plan.

## Execution Mode
RUN_ONLY

## Input Context
- The baseline inventory
- The change proposal
- The delta requirements

## Process
1. Detail the specific artifacts and files that downstream consumers or subagents must read prior to execution.
2. Define explicit `depends_on` relationships strictly in cases where one requirement or acceptance check fundamentally relies on another.
3. Retain the evidence identifier or requirement ID that validates each dependency and acceptance assertion; explicitly mark any claim that lacks an evidence basis.
4. Establish clear, testable acceptance criteria for every material delta requirement.
5. Group discrete, independent acceptance checks into optional parallel execution waves.
6. Call out potential cross-consumer compatibility issues and sequencing risks.
7. Deliberately leave the exact execution mechanics and tool selections completely unresolved.

## Output Contract
- `dependency-acceptance-map.json`

## Required Guardrails
- The generated dependency graph must be strictly acyclic and backed by evidence.
- Every material change (delta) must be paired with at least one verifiable acceptance criterion.
- All dependency relationships and acceptance claims must trace to an evidence basis or carry an explicit gap marker.
- Parallel execution waves are framed as optional and must be driven by logical independence, not mere convenience.
