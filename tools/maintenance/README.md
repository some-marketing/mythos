# Maintenance Playbook

## Purpose

This playbook governs rollout of the automated maintenance system added under `tools/maintenance/`.

The goal is to:
- apply deterministic repo hygiene safely
- avoid accidental churn in a dirty worktree
- keep autonomous actor dispatch disabled until the maintenance surface is trusted

This is a repo-operations playbook, not an application-runtime playbook.

## Commands

- `npm run maintenance:status`
  - Preview only. No repo mutation.
- `npm run maintenance:topology`
  - Read-only topology scout. Writes a maintenance ledger for stale signals,
    debrief follow-up gaps, and conservative evidence gaps.
- `npm run maintenance:spiders`
  - Read-only spider ledger. Runs bounded detector spiders and writes a
    deterministic ledger. Spiders report evidence and next commands only; they do not
    repair or mutate source.
- `node tools/maintenance/closeout-maintenance.js --scope <scope> --execute --no-dispatch`
  - Recommended first live run.
  - Applies low-risk deterministic cleanup only.
  - Does not emit actor-targeted follow-up signals.
- `npm run maintenance:closeout`
  - Full closeout maintenance run.
  - Applies deterministic cleanup and may emit a follow-up maintenance signal.
- `npm run maintenance:watch`
  - Continuous polling mode.
  - Do not enable during initial rollout.

## What The System May Change

Deterministic maintenance may:
- rewrite `.claude/project-claude.yml` via manifest sync
- regenerate managed instruction surfaces when instruction drift is detected
- close duplicate live signals on the signal surface
- move finished analysis artifacts from `_dev/reports/analysis/` into `_dev/archive/`
- write maintenance reports under `_dev/reports/analysis/`

It does not delete files in v1.

## Main Risks

### 1. Manifest normalization risk

`tools/verify/sync-manifest.cjs` rewrites `.claude/project-claude.yml` to match what exists on disk.

Risk:
- experimental or shadow framework surfaces can become reflected in the managed manifest
- in-progress manual edits to `.claude/project-claude.yml` can be overwritten

Mitigation:
- do not run maintenance execution until `.claude/project-claude.yml` is either committed or intentionally disposable
- quarantine experimental framework dirs that should not be scanned yet

### 2. Archive visibility risk

`tools/artifacts/archive-finished.js` moves old analysis files out of `_dev/reports/analysis/`.

Risk:
- active-but-old decision memos can disappear from the hot analysis surface

Mitigation:
- move active files into a protected `pinned/` path before rollout
- or expand `tools/artifacts/retention-policy.json` if your protection policy is broader than the current defaults

### 3. Scope ambiguity risk

The maintenance runner defaults to `latest`.

Risk:
- in a busy repo, the wrong workstream can be assessed as the current closeout target

Mitigation:
- always use `--scope <scope>` during rollout
- do not rely on `latest` until the repo has calmer closeout semantics

### 4. Autonomous dispatch risk

The full closeout runner can emit maintenance coordination signals for Codex, Claude, or OpenCode follow-up.

Risk:
- a watcher can consume the signal and begin non-trivial model work

Mitigation:
- initial rollout must use `--no-dispatch`
- keep watcher-based automation off until manual review passes repeatedly

### 5. Dirty worktree churn risk

Even safe mechanical fixes create diff noise.

Risk:
- mixed changes make review harder
- it becomes harder to distinguish maintenance churn from active project work

Mitigation:
- use a dedicated branch or worktree for first rollout
- review diff immediately after each maintenance run

## Rollout Procedure

### Phase 0: Prep

1. Create a rollback point.
   - Commit current intended work, or use a fresh branch/worktree.
2. Stop any background actor listeners.
   - Do not let maintenance signals be auto-consumed during initial rollout.
3. Protect active analysis documents.
   - Move them to a protected `pinned/` path or update retention policy first.
4. Identify the intended scope.
   - Do not use `latest` unless you are confident the latest closeout artifacts represent the correct target.

### Phase 1: Preview

Run:

```bash
npm run maintenance:status
```

Then inspect the generated maintenance report in `_dev/reports/analysis/`.

Review:
- unresolved conditions
- whether any archive candidates are actually safe to archive
- whether manifest drift reflects intended repo state

### Phase 2: Deterministic Execution Only

Run:

```bash
node tools/maintenance/closeout-maintenance.js --scope <scope> --execute --no-dispatch
```

This is the recommended first live run.

After it completes:
- inspect `git diff`
- inspect the maintenance report
- confirm the write set is acceptable

Expected write surfaces:
- `.claude/project-claude.yml`
- `_dev/archive/...`
- `_dev/reports/analysis/closeout-maintenance__*.{md,json}`
- `_dev/reports/signals/closed/` if duplicate live signal normalization was needed

### Phase 3: Verification

Run:

```bash
npm run verify:harness:all
npm run verify:maintenance
npm run test:lifecycle
```

Only proceed if:
- lifecycle remains green
- harness verification remains green
- maintenance report matches your expectations

### Phase 4: Controlled Dispatch

Only after one or more clean Phase 2 runs:

```bash
npm run maintenance:closeout
```

Use this only when you are comfortable allowing the maintenance router to emit follow-up coordination signals.

Do not enable watch mode yet unless:
- scoped execution behaves predictably
- emitted maintenance signals are correct
- your watchers are under control

### Phase 5: Watch Mode

Only after manual trust is established:

```bash
npm run maintenance:watch
```

This is the last rollout step, not the first.

## Stop Conditions

Stop rollout if any of the following happen:
- `.claude/project-claude.yml` changes in ways you did not expect
- active analysis docs are selected for archive unexpectedly
- maintenance reports repeatedly target the wrong scope
- a watcher consumes a maintenance signal before you intended it to
- lifecycle verification regresses after maintenance execution

If any stop condition fires:
- do not enable dispatch
- do not enable watch mode
- correct policy, scope selection, or repo layout first

## Recommended Default

For now, the safe operational default is:

```bash
node tools/maintenance/closeout-maintenance.js --scope <scope> --execute --no-dispatch
```

Use that until the maintenance surface proves stable in real repo conditions.
