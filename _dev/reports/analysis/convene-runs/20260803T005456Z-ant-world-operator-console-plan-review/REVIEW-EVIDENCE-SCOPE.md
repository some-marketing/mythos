# Review evidence scope — read this before citing this run

**Scope:** ant-world-operator-console-plan-review · **Run:** 2026-08-03T00:54:56Z
**Profile:** code-review, dispatched with `--only codex` · **Reviewers convened: ONE**

## This is single-reviewer evidence, not triadic consensus

The convene tooling's profile metadata marks this profile "consequence-grade," but this run
was deliberately dispatched to a **single distinct-family reviewer** (codex; producer family
is claude). No synthesis file is present because synthesis exists to reconcile independent
voices — with one reviewer there is nothing to reconcile, and writing one would dress a
single opinion as consensus.

**The authority for this run is `truth__codex.md`:** verdict **CHANGES-REQUIRED**, eight
findings.

## The reviewer's own stated scope limit

> "This code-review profile is sufficient to reject the plan as executable, but too narrow
> for consequence-grade consensus on whether recurrence is a defensible research construct."

That limitation is carried forward as correction **C7** in
`_dev/reports/analysis/task-plans/ant-world-operator-console__plan.md`: before any label
criterion is adopted, the question must go to a consequence-grade convene, not to another
code review.

## Related runs in this PR (both full kernel triads, claude/codex/gemini)

- `20260803T002158Z-pheromone-carriage-confound-fix/` — has `synthesis.md`.
- `20260803T003126Z-growing-dashboard-mind-legibility/` — the fold-back synthesis for this
  run lives in `_dev/reports/analysis/evidence-loop__20260803__growing-dashboard-mind-legibility.md`
  (the return leg of a `123|perplexity|321` loop), not in the run directory.

## Note on the state marker

The plan cites `_dev/state/plan-task-review-state/ant-world-operator-console.json` as the
verdict record. That path is **untracked on `main` by policy** (`.gitignore:31`,
`_dev/state/**`), so it is intentionally absent from this PR. The verdict it holds is
reproduced in the plan's own header banner and in `truth__codex.md` here.
