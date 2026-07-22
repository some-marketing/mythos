# Scaffold Framework from Example

## Steps

1. **[USER] Provide successful work** — User provides a real task they've done manually or with an LLM, either already in a capture bundle or still outside Mythos.
2. **[AUTO] Normalize first** — If the work is outside Mythos, use the capture and normalize workflows before scaffolding.
3. **[AUTO] Analyze task** — Break down the normalized capture into discrete steps.
4. **[AUTO] Identify patterns** — Map steps to prompt chain patterns (sequential, branching, parallel, iteration).
5. **[AUTO] Design chain** — Create a numbered prompt chain design.
6. **[AUTO] Extract variables** — Identify what changes between executions (inputs).
7. **[AUTO] Define outputs** — Identify what the task produces.
8. **[USER] Review design** — User validates the framework candidate design.
9. **[AUTO] Generate candidate** — Use the scaffold workflow to build a framework candidate under `framework_candidates/`.
