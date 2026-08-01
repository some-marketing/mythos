---
description: Human-friendly alias for /route
mode: REVIEW_ONLY
---

<objective>
Provide an obvious human phrase for the advisory operator-intent router without creating a second routing authority.
</objective>

<process>
- Resolve mechanically to /route with the same arguments.
- Preserve /route dry-run semantics.
- Do not execute the recommended route.
</process>

<success_criteria>
- Alias resolves to /route
- No duplicate routing contract is introduced
</success_criteria>

<handoff>
canonical_route: route <operator-intent>
</handoff>
