# 01 Scope and Intent

## Goal
Transform an initial user request or vague notion into a rigorously bounded product-intake definition. Do not assume the initially proposed solution is valid or optimal. (BMad Method: Agile Ai Driven Development).

## Execution Mode
RUN_ONLY

## Input Context
- The reported problem statement or change request
- Expected target users
- The goal or desired outcome
- Supplied evidence, context, or prior research
- Known constraints and alternatives

## Process
1. Translate the initial problem statement into objective, observational language.
2. Distinctly separate the underlying problem from the requested solution, the desired outcome, and the mechanism for signaling success.
3. Map out the intended users as well as any non-user stakeholders affected by the work.
4. Document all known constraints, non-goals, risks, and explicit decisions that have already been made.
5. For every material claim supplied in the input, preserve its source locator, revision, digest, or evidence identifier. If provenance is missing, explicitly flag it as an evidence gap.
6. Enumerate open questions and unknowns that could materially alter the product's definition or architecture.
7. Establish clear stop conditions for the product intake phase.

## Output Contract
- `scope-and-intent.json`
- A register of initial assumptions and open questions

## Required Guardrails
- The core problem is framed so it can be evaluated independently of any specific requested solution.
- Unsubstantiated claims are explicitly flagged.
- All material scope claims are traceable to provided evidence or definitively marked with an evidence gap.
- Scope boundaries, non-goals, and stop conditions are clearly and explicitly defined.
