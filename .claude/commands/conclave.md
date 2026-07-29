---
description: Conclave — convene a council of independent reviewers in parallel and synthesize one voice
argument-hint: <task | question>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

> Authority: `convene-review` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Convene a conclave: fire one bounded question to two or three independent reviewers in parallel, collect their written responses, and synthesize across all voices into one unified output. The independent reviewers should be genuinely distinct minds — different models, or a human — so the council provides real cross-verification rather than one voice echoing itself. In plain terms: this is a parallel multi-reviewer step that ends in a single synthesized answer.
</objective>

<process>
1. Parse the task from arguments. If empty, ask what to convene on.
2. Gather the relevant context (plans, briefs, prior reasoning) to hand each reviewer.
3. Pick a short, kebab-case scope name for the run and choose the council — the default is a small panel of distinct reviewers; a narrower panel must not be presented as full consensus.
4. Dispatch the same bounded question to each council member in parallel and wait for their responses.
5. Collect each response into a dated run directory (one file per member) alongside a synthesis skeleton.
6. Write your own (origin) analysis into the synthesis inline — do not drop it.
7. Synthesize across all voices: state agreements, disagreements, and unresolved uncertainty explicitly. If the panel was narrow or two members were the same mind, name that reduced coverage rather than implying full consensus.
8. Present one unified synthesis to the operator, not three separate reports.
</process>

<success_criteria>
- Every council member returned a response or an explicitly recorded blocker
- The origin analysis was written inline, not dropped
- The synthesis captures cross-verification catches and net findings
- Output to the operator is one unified voice, not three separate reports
- Any reduction in distinct-reviewer coverage is named rather than implied away
</success_criteria>

<boundaries>
- Does not treat a narrow or same-mind panel as full multi-reviewer consensus
- Does not skip the synthesis step
- Does not burn reviewer effort on trivial questions
</boundaries>
