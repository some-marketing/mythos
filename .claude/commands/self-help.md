---
description: Consult local public-reference archives for AI harness/tooling questions
mode: REVIEW_ONLY
---

<objective>
Inspect public implementation references for the AI tooling layer in the operator-local archive directory.
</objective>

<process>
- Parse target from arguments (claude, codex, gemini, etc.).
- Verify selected archive path exists at ${HOME}/Documents/GitHub/reference_archives/.
- Use read-only inspection (rg, find, git log, file reads) to answer questions.
- Distinguish archive observations ('Archive shows...') from Mythos policy ('Mythos requires...').
- Report results with citations to inspected files.
</process>

<success_criteria>
- Selected archive path is named explicitly
- Answer cites inspected local files
- Public reference observations separated from Mythos policy
- No archive files are modified
</success_criteria>
