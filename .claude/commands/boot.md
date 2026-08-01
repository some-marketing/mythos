---
description: Session boot — auto-commit dirty files then run daily briefing
mode: REPO_HYGIENE
---

<objective>
The single kernel entry point. Auto-commit dirty state, then surface system health + active work + a kernel-level read (what's load-bearing, what's blocked on the operator, what the single highest-leverage next move is). This is the only command the operator should need to open a session.
</objective>

<process>
- Step 1 — auto-commit hygiene: Run node tools/hygiene/auto-commit.js --auto --foreground. Exit 0/2 acceptable, exit 1 = failure — stop. After auto-commit, run git status --short | wc -l and git rev-list --count @{upstream}..HEAD. If dirty count > 0 or auto-commit skipped, surface DIRTY TREE warning as first line of briefing. In addition, run node tools/hygiene/disk-quota-guard.cjs --check to verify host available disk space remains above 15 GB, failing-safe to warning-only mode.
- Step 1b — repo-awareness refresh: Run npm run context:repo-awareness to rebuild the repo-awareness surface before any routing decision. If it reports stale plan visibility, run npm run plans:dashboard to refresh the plan-visibility cache. Never route on ghost data: this step is mandatory even when the session-start hook already ran it.
- Step 2 — system status: Run npm run status. Surface next recommended command, system health, maintenance conditions, live coordination signals, planning staleness warnings. Flag signals requiring operator action at the top.
- Step 3 — active work: Invoke the /whats-next process exactly as defined in that command. Do not reimplement.
- Step 4 — kernel read (synthesis, always last): Produce three sections in what/why/reasons format, 1-3 lines each. LOAD-BEARING RIGHT NOW, BLOCKED ON YOU (operator), HIGHEST-LEVERAGE NEXT MOVE. If any section is genuinely empty, say so in one line.
</process>

<success_criteria>
- Auto-commit runs before any status checks
- System status, active work, and kernel read all present in one output
- Every active task plan accounted for; no EXECUTABLE classification with unmet dependencies
- Blocked items clearly state what decision is needed and on whom
- Kernel read names exactly one load-bearing thing and exactly one next move (or says none)
- Operator should not need to run /whats-next, /mythos-status, or any sibling status command afterward
</success_criteria>
