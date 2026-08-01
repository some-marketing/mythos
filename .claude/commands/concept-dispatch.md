---
description: Dispatch a concept bundle to an external model for review
mode: PATCH_ALLOWED
---

<objective>
Prepare and dispatch a concept for cross-model review. Creates the dispatch prompt, commits and pushes it, and optionally sets up polling for the response.
</objective>

<process>
- Parse arguments: <concept-slug> (required), --model (target model, default gpt), --watch (set up polling for PR response after dispatch).
- Validate the concept is a bundle: check _dev/concepts/<slug>/concept.md and _dev/concepts/<slug>/status.json exist. If flat file, suggest running /concept-promote <slug> --to-bundle first.
- Read the concept and any context/ material.
- Build the dispatch prompt at dispatch/<model>-prompt.md using the appropriate template for the target model. Include relevant system context and constraints (output format, no codebase assumption, propose don't implement).
- Before building the prompt, verify no credentials, API keys, .env values, or client-specific PII are in the concept or context files.
- Update status.json: add dispatch entry with model, sent date, prompt_file, status awaiting_response. Set stage to dispatched.
- Commit and push: git add _dev/concepts/<slug>/, commit, and push to the canonical branch recovery/clean-lineage-2026-05-18.
- If --watch: set up a CronCreate job polling every 5 minutes for PRs matching the concept.
- Report: prompt file path, what the user needs to do next, watch job ID if applicable.
</process>

<success_criteria>
- Concept is a valid bundle with status.json
- Dispatch prompt created at the correct path
- status.json updated with dispatch entry
- Changes committed and pushed to remote
- If --watch: polling job created and ID reported
</success_criteria>

<handoff>
response_received: /review-dispatch <slug>
concept_not_bundle: /concept-promote <slug> --to-bundle
</handoff>
