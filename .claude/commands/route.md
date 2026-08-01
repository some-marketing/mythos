---
description: Advisory operator-intent router for common Mythos workflow wording
mode: REVIEW_ONLY
---

<objective>
Map normal operator language to the existing native Mythos command or script that should own the work, without executing it and without creating a parallel authority system.
</objective>

<process>
- Read the operator intent string.
- Return one recommended native route with rationale when a conservative rule matches.
- Validate the recommended target against the canonical command registry or alias resolver.
- Never execute the recommended route.
- If no conservative match exists, report no match and point the operator to /whats-next or /plan-task.
</process>

<success_criteria>
- Output is advisory and dry-run only
- Every route target resolves through existing canonical command or alias authority
- Memory intents point to canonical memory writer surfaces
- Closeout and mirror intents point to shutdown/private-remote sync surfaces
- Framework lifecycle intents point to native lifecycle commands rather than re-encoding lifecycle authority
</success_criteria>

<handoff>
matched: Operator may run the returned native command after reading the rationale
unmatched: /whats-next or /plan-task "<task>"
</handoff>
