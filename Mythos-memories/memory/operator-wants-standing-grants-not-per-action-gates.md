---
name: operator-wants-standing-grants-not-per-action-gates
description: Operator ratified 2026-08-03 — reduce operator-dependence; convert repeated approval friction into standing scoped grants; batch unavoidable gates into single pastes
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 76d719cf-00b8-4111-b09a-c9cf141f2f16
  modified: 2026-08-03T14:45:56.665Z
---

Operator, 2026-08-03 (trunk-canonicity /owl session), on approval friction: "i'd like to
have less direct requirements of adding things where this is what i know i want to do and
it creates a lot of busywork."

**Why:** The session hit five distinct operator gates in an hour (auto-commit classifier
denial, TTY stamp, settings self-edit hard-block, dispatch --run-now denial, gh api
denial). Each was individually correct, but the operator experiences the aggregate as
busywork for decisions they've already made.

**How to apply:**
- When a gate recurs, propose a standing scoped grant (settings allow rule, standing
  1Password approval item, Dart identity-approval) instead of asking again per-action.
- Batch every unavoidable operator step into ONE fully-resolved paste (`!` command or
  single terminal line), never a sequence of small asks — see
  [[operator-commands-must-be-fully-resolved]].
- Known standing surfaces: scoped git/gh allow rules in .claude/settings.local.json
  (operator-pasted 2026-08-03, includes gh api + git add/commit/tag, excludes push);
  the Dart identity-verified plan-approval path (PRIMARY per
  tools/planning/stamp-plan.js header) is designed but unwired — wiring it removes the
  TTY-stamp dance; follow-on candidate.
- Boundaries that stay: agent never edits its own permission rules (classifier
  hard-block, correct), git push and origin/main writes stay gated, ConveneReceipt
  gates on canonical/governance paths stay.
