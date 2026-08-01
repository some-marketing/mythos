---
description: Pi self-reference command: inspect the local public Pi (pi-mono) source archive before answering Pi harness/tooling questions
mode: REVIEW_ONLY
---

<objective>
Give the operator and any consulting agent a canonical read-only route to inspect the operator-local public Pi source archive at ${HOME}/Documents/GitHub/reference_archives/pi-mono__earendil-works when Pi CLI behavior, slash commands, provider routing, session model, plugin/community-package structure, or harness integration details are in question. Pi is distributed as `@earendil-works/pi-coding-agent` on npm; the upstream source lives at github.com/earendil-works/pi-mono.
</objective>

<process>
- Verify that ${HOME}/Documents/GitHub/reference_archives/pi-mono__earendil-works exists and is readable.
- Run targeted read-only searches inside the archive using rg, git -C, and direct file reads. Do not use broad dumps when a precise search is possible.
- Answer only from observed local archive evidence, Mythos canonical instructions, or clearly labeled uncertainty.
- Separate source observations from Mythos policy: source archive behavior can explain Pi, but it does not override AGENTS.md, Mythos canonical commands, operator boundaries, or local secret handling rules.
- If the archive is missing, stale, or inconclusive, report that fact and name the exact follow-up command needed to refresh or inspect further. Do not fetch or pull without operator authorization.
- Do not execute code from the archive, install its dependencies, or run package scripts. Inspection is read-only.
</process>

<success_criteria>
- Pi archive path is verified before use
- Relevant files or search terms are named in the response
- No archive files or Mythos policy files are modified
- Uncertainty is preserved when the archive does not answer the question
- Mythos local rules remain primary over public-source observations
</success_criteria>

<handoff>
archive_missing: Ask the operator whether to clone https://github.com/earendil-works/pi-mono.git into ${HOME}/Documents/GitHub/reference_archives/pi-mono__earendil-works
archive_stale: Ask before running git -C ${HOME}/Documents/GitHub/reference_archives/pi-mono__earendil-works pull --ff-only
needs_cross_actor_comparison: Use /dispatch-bridge with target codex or another distinct actor when source-level comparison becomes a consequential judgment
</handoff>
