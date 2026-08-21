# Delta Specification Candidate Guardrails

## Candidate status

This is an Iron research candidate. It produces specification and review artifacts only. It does not authorize implementation, merging, archiving, repository mutation, or promotion.

## Core constraints

- Establish current behavior from authoritative evidence before describing a delta.
- Never turn absence of evidence into a removed or unsupported behavior claim.
- Separate added, modified, and removed requirements.
- Every modified requirement must name its baseline requirement or admit that the baseline is unresolved.
- Describe behavior and observable scenarios, not classes, libraries, commands, or implementation steps.
- Use dependency waves only when explicit dependencies justify them.
- Do not include client-specific, personal, credential, or private-source information.
- Preserve source provenance, conflicts, limitations, and falsifiers.

## Review boundary

Prompt 05 must be run by an actor distinct from the producer of Prompts 01–04. Its verdict is advisory until replay and operator feedback exist.
