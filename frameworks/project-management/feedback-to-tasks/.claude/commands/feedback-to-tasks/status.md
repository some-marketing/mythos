---
name: status
description: Check framework progress and remaining steps
skill: feedback-to-tasks
mode: REVIEW_ONLY
---

Scan the project's output directory to identify which framework phases have been completed and what the next authorized step is.

1. Read `manifest.json` to identify the `prompt_chain` and `output_contract`.
2. Scan the `outputs/` directory (or manifest-declared output paths) for artifacts.
3. Compare existing artifacts to the expected output per phase.
4. Report which phases are: COMPLETE, IN_PROGRESS, or PENDING.
5. Identify the next authorized command to run based on the prompt chain sequence.
