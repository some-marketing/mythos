---
description: Render the current cadence slice across active Mythos domains
mode: REVIEW_ONLY
---

<objective>
Show the per-slice cadence grid for active Mythos domains: the current leaf, state, blockers, and last artifact for each domain. This is a read-only operator check-in surface; dispatch remains native to owl/orchestrate-loop.
</objective>

<process>
- Run `npm run cadence` for the table view, or `npm run cadence -- --json` for structured output.
- Read domain registry state from `_dev/state/cadence/domain-registry.json` when present.
- Read current leaf state from `_dev/state/cadence/current-leaf.json` when present.
- Report unavailable cadence state explicitly if either file is missing or unreadable.
- Use the output to choose the next bounded domain leaf, then route execution through the appropriate native command rather than dispatching from cadence itself.
</process>

<success_criteria>
- The cadence grid renders or missing cadence state is reported clearly
- Each registered domain row shows scope, state, leaf, blocker, and last artifact fields
- The slice summary counts rows by state
- No agent dispatch or file mutation occurs
</success_criteria>

<handoff>
human_readable: npm run cadence
structured: npm run cadence -- --json
execute_selected_leaf: /owl <selected-domain-or-leaf>
</handoff>
