---
description: Review an incoming model response to a concept dispatch
mode: REVIEW_ONLY
---

<objective>
Review a response from an external model (PR or pasted file), assess its quality and fit against the original dispatch prompt and Mythos architecture, and prepare it for synthesis.
</objective>

<process>
- Parse arguments: <concept-slug> (required), --pr <number> (review a GitHub PR), --file <path> (review a pasted response file). If neither flag, check for open PRs on the repo matching the concept slug.
- Locate the concept bundle: read _dev/concepts/<slug>/concept.md, _dev/concepts/<slug>/status.json, and the original dispatch prompt from dispatch/.
- Retrieve the response: if --pr use gh pr view and gh pr diff, if --file read the file, if auto-detect use gh pr list to match by concept slug or branch name.
- Assess the response: does it address the dispatch prompt's task and constraints, does it conflict with existing Mythos architecture, does it propose changes that align with existing surfaces, are there citation artifacts to clean, are there concrete proposals vs. vague suggestions.
- Save the response: copy or summarize into dispatch/<model>-response.md. Clean ChatGPT citation artifacts if present and verify cleanup.
- Update status.json: update the dispatch entry status to reviewed, add response_file path and response_type.
- Report assessment to user: what is good, what needs attention, whether to merge if PR or proceed to synthesis. Recommend next step: /synthesize-concept <slug> or request changes.
</process>

<success_criteria>
- Response retrieved and saved to dispatch/ directory
- Assessment produced with specific findings, not generic approval
- status.json updated with response metadata
- Clear recommendation for next step
</success_criteria>

<handoff>
response_positive: /synthesize-concept <slug>
response_needs_changes: Request revisions from the model or operator
all_dispatches_reviewed: /synthesize-concept <slug>
</handoff>
