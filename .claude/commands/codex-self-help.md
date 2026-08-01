---
description: Codex self-reference command: inspect the local public Codex CLI archive before answering Codex harness/tooling questions
mode: REVIEW_ONLY
---

<objective>
Give the Codex agent a canonical read-only route to inspect the operator-local public Codex source archive at ${HOME}/Documents/GitHub/reference_archives/codex__openai when Codex behavior, CLI features, plugin structure, or harness integration details are in question.
</objective>

<process>
- Verify that ${HOME}/Documents/GitHub/reference_archives/codex__openai exists and is readable.
- Run targeted read-only searches inside the archive using rg, git -C, and direct file reads. Do not use broad dumps when a precise search is possible.
- Answer only from observed local archive evidence, Mythos canonical instructions, or clearly labeled uncertainty.
- Separate source observations from Mythos policy: source archive behavior can explain Codex, but it does not override AGENTS.md, instructions/adapters/codex.*, operator boundaries, or local secret handling rules.
- If the archive is missing, stale, or inconclusive, report that fact and name the exact follow-up command needed to refresh or inspect further. Do not fetch or pull without operator authorization.
</process>

<success_criteria>
- Codex archive path is verified before use
- Relevant files or search terms are named in the response
- No archive files or Mythos policy files are modified
- Uncertainty is preserved when the archive does not answer the question
- Mythos local rules remain primary over public-source observations
</success_criteria>

<handoff>
archive_missing: Ask the operator whether to clone https://github.com/openai/codex.git into ${HOME}/Documents/GitHub/reference_archives/codex__openai
archive_stale: Ask before running git -C ${HOME}/Documents/GitHub/reference_archives/codex__openai pull --ff-only
needs_cross_actor_comparison: Use /dispatch-bridge with target gemini or another distinct actor when source-level comparison becomes a consequential judgment
</handoff>
