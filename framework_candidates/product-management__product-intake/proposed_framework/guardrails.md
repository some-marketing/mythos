# Product Intake Candidate Guardrails

## Candidate status

This is an Iron research candidate. It writes only the contracted reports under `outputs/product-intake/`. It does not authorize implementation, source or framework mutation, product launch, or promotion.

## Core constraints

- Separate direct observations, stakeholder claims, assumptions, interpretations, and open questions.
- Do not invent user research, market evidence, demand, frequency, urgency, or acceptance.
- Do not treat a requested feature as proof of the problem or the preferred solution.
- Keep the product brief implementation-neutral.
- Do not include client-specific, personal, credential, or private-source information.
- Preserve source provenance and limitations for every material claim.
- Scale ceremony to risk; report when the candidate adds more process than clarity.

## Review boundary

Prompt 04 must be run by a reviewer whose actor id, harness id, and model-provider family are all distinct from every producer of Prompts 01–03. A new context or same-provider subagent does not satisfy this boundary. The review artifact must record the compared provenance, and missing or non-distinct provenance forbids `PASS`. Its verdict is advisory until replay and operator feedback exist.
