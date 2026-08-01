---
description: Report framework candidate maturity and blockers
mode: REVIEW_ONLY
---

<objective>
Show the current replay summary, sanitization blockers, and promotion readiness for a framework candidate without modifying any files.
</objective>

<process>
- Parse arguments for <candidate-root>. If missing, prompt the user.
- Read candidate metadata: load candidate.json from the candidate root.
- Summarize replay runs: count pass, fail, and partial replay results from replay_runs/ directory entries.
- Check promotion blockers: inspect proposed_framework/ for missing required files (manifest.json, guardrails.md, prompt chain files, schemas) and check for likely client-data contamination.
- Report readiness to the user: show candidate status, replay summary (pass/fail/partial counts), promotion blockers if any, and whether promotion is currently allowed.
</process>

<success_criteria>
- Candidate metadata read without modification
- Replay run results summarized with accurate counts
- Promotion blockers identified and listed
- Clear promotion-readiness verdict reported to user
</success_criteria>

<handoff>
ready_to_promote: promote-framework <candidate-root>
replay_needed: replay-framework <candidate-root>
blockers_found: Fix blockers in proposed_framework/ and re-check
contamination_detected: Sanitize proposed_framework/ and re-check
</handoff>
