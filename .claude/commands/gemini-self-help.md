---
description: Gemini self-reference command: inspect the local public Gemini CLI archive before answering Gemini CLI/tooling questions
mode: REVIEW_ONLY
---

<objective>
Give the Gemini actor a canonical read-only route to inspect the operator-local public Gemini CLI source archive at ${HOME}/Documents/GitHub/reference_archives/gemini-cli__google-gemini when Gemini CLI behavior, auth, command routing, or bridge integration details are in question.
</objective>

<process>
- Verify that ${HOME}/Documents/GitHub/reference_archives/gemini-cli__google-gemini exists and is readable.
- Run targeted read-only searches inside the archive using rg, git -C, and direct file reads. Do not use broad dumps when a precise search is possible.
- Answer only from observed local archive evidence, Mythos canonical instructions, or clearly labeled uncertainty.
- Separate source observations from Mythos policy: source archive behavior can explain Gemini CLI, but it does not override Mythos bridge policy, dispatch-bridge constraints, operator boundaries, or local secret handling rules.
- If the archive is missing, stale, or inconclusive, report that fact and name the exact follow-up command needed to refresh or inspect further. Do not fetch or pull without operator authorization.
</process>

<success_criteria>
- Gemini archive path is verified before use
- Relevant files or search terms are named in the response
- No archive files or Mythos policy files are modified
- Uncertainty is preserved when the archive does not answer the question
- Mythos local rules remain primary over public-source observations
</success_criteria>

<handoff>
archive_missing: Ask the operator whether to clone https://github.com/google-gemini/gemini-cli.git into ${HOME}/Documents/GitHub/reference_archives/gemini-cli__google-gemini
archive_stale: Ask before running git -C ${HOME}/Documents/GitHub/reference_archives/gemini-cli__google-gemini pull --ff-only
needs_cross_actor_comparison: Use /dispatch-bridge with target codex or another distinct actor when source-level comparison becomes a consequential judgment
</handoff>
