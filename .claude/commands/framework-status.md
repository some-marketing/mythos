---
description: Check framework progress and remaining steps
mode: REVIEW_ONLY
---

<objective>
Scan the project's output directory to identify which framework phases have been completed and what the next authorized step is.
</objective>

<process>
- Read `manifest.json` to identify the `prompt_chain` and `output_contract`.
- Scan the `outputs/` directory (or manifest-declared output paths) for artifacts.
- Compare existing artifacts to the expected output per phase.
- Report which phases are: COMPLETE, IN_PROGRESS, or PENDING.
- Identify the next authorized command to run based on the prompt chain sequence.
</process>

<success_criteria>
- Status of all prompt chain phases reported
- Completed artifacts correctly identified
- Next step recommended based on actual disk state
</success_criteria>
