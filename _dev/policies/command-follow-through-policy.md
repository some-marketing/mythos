# Command Follow-Through Policy

Policy for deciding which commands should automatically trigger bounded follow-up
work, which should remain recommendation-only, and which must stop at a human gate.

This fills a gap between:

- canonical command specs that define each command in isolation
- handoff sections that suggest likely next steps
- operator judgment about whether a suggested next step is actually safe to auto-run

The goal is to keep command chains deterministic where the follow-up is mechanical,
while preventing the system from auto-reopening the wrong lane or auto-promoting work
that still needs judgment.

## Core Rule

Treat command aftermath as one of three classes:

1. **Required post-check**
   A mechanical verification or synchronization step that should run automatically
   after success.
2. **Recommended next command**
   A likely next command that should be surfaced, but not auto-run, because priority
   or scope still requires judgment.
3. **Human gate**
   A command transition that must not happen automatically because it changes
   priority, advances state irreversibly, or depends on real-world judgment.

## Decision Test

Auto-run a follow-up only when all of these are true:

- the follow-up is low-ambiguity
- success criteria are mechanical and checkable
- the follow-up does not reopen or re-route strategic work
- the follow-up does not create an irreversible state change
- the follow-up does not depend on unresolved operator intent

If any of those fail, surface the next command explicitly instead of auto-running it.

## Enforcement Model

Each command may declare four kinds of follow-through:

- `must_run_after_success`
- `must_run_if_files_changed`
- `must_not_auto_run`
- `requires_operator_confirmation`

This policy is a governance layer first. It should be codified into command specs and
tooling only after the trigger behavior is validated on real command chains.

## Trigger Classes

### 1. Synchronization triggers

Use for commands that mutate repo-declared assets and can leave metadata or generated
instruction files stale.

Typical follow-through:

- sync manifest or generated files
- run validation
- report drift if validation fails

### 2. Verification triggers

Use for commands that produce or mutate grimoire, command, skill, familiar, or
planning surfaces.

Typical follow-through:

- targeted verifier
- broader verifier when the surface is cross-cutting
- next-step or planning refresh if routing truth may have changed

### 3. Status refresh triggers

Use for commands that change the truthful state of a project, workstream, or queue.

Typical follow-through:

- status command
- next-step refresh
- active-workstream review when the old recommendation may now be stale

### 4. Human-gated transitions

Use for commands that can advance the repo into a new strategic phase.

Typical examples:

- rank-up (promotion)
- execution of a queued charter
- replanning after a major lane closes
- lessons reconciliation when the repo may already be routing elsewhere

## Recommended Trigger Matrix

### Repo maintenance and instruction surfaces

| Command | Must auto-run | Surface only | Human gate |
|---|---|---|---|
| `/attune-codex` (sync-manifest) | manifest-check | broad validation when the change is wide | none |
| instructions:generate | instructions:validate | none | none |
| `/author-prompt-system` | instructions:validate, targeted verification of changed assets | assembly if still needed | none |
| `/assemble-prompt-system` | instructions:validate | review-progress if expectation failures remain | none |

### Grimoire and candidate lifecycle

| Command | Must auto-run | Surface only | Human gate |
|---|---|---|---|
| `/claim-spoils` (capture-task) | `/spoils-ledger` (capture-status) | none | none |
| `/refine-spoils` (normalize-capture) | `/spoils-ledger` | `/scribe-grimoire` (scaffold-framework) | none |
| `/scribe-grimoire` | `/initiate-status` (candidate-status) | `/rehearse-grimoire` (replay-framework) | none |
| `/rehearse-grimoire` | `/initiate-status` | `/rank-up` (promote-framework) | yes |
| `/rank-up` | instructions:generate, instructions:validate, full-verify | broad validation when rank-up touched shared surfaces broadly | yes |

### Project and planning truth surfaces

| Command | Must auto-run | Surface only | Human gate |
|---|---|---|---|
| `/contract-ledger` (project-status) | none | review or grimoire-run depending on reported state | none |
| review-active-workstreams | none | plan-active-workstreams if review says planning is stale | none |
| plan-active-workstreams | next-step refresh | exact command from the resulting next-step artifact | yes for execution |
| plan-pipeline | none | plan-active-workstreams when the master pipeline is complete | none |
| `/embark` (run-plan) | command-defined verification, adjudicator bridge, `/chronicle` (debrief) artifacts, planning refresh when state changed | exact next command surfaced by resulting artifacts | yes for any new strategic branch |

### Review and closeout

| Command | Must auto-run | Surface only | Human gate |
|---|---|---|---|
| review-progress | none | plan-pipeline or plan-active-workstreams when the review says planning is stale | none |
| `/chronicle` (debrief-run) | none | reconcile-lessons when the run produced reusable process findings | none |
| reconcile-lessons | none | `/author-prompt-system` or `/assemble-prompt-system` if the lesson implies durable prompt or command changes | yes for implementation |
| normalize-signals | next-step refresh when signal cleanup changes routing truth | review-active-workstreams if ambiguity remains | none |

## Immediate Policy For A Given Workstream Freeze

When a workstream lane is frozen for review, the recommended chain is:

1. Freeze the workstream's validation lane into one operator review packet.
2. Operator decides whether the lane is now validation-complete proof work.
3. If yes, run status and planning truth refresh:
   - `/contract-ledger`
   - review-active-workstreams
   - refresh planning surfaces as needed
   - next-step refresh
4. Only after that, begin capture-to-candidate flow:
   - `/spoils-ledger`
   - `/refine-spoils`
   - `/initiate-status`

Do not auto-run rank-up from a single freeze packet alone.

Do not auto-run local-model integration from a single freeze packet alone.

Those are separate strategic decisions, not post-checks.

## Local-Model Policy Interaction

Local-model integration should follow this policy:

- benchmark and verifier-lane setup may run in parallel with rank-up-flow preparation
- routing changes in inference-bridge tooling must not auto-follow benchmark work
- any adoption of a local verifier lane requires explicit operator approval after benchmark review

In short:

- local benchmarking can be automated
- local routing adoption is human-gated

## What Should Be Codified Next

Once a given freeze and rank-up-flow test are complete, the first trigger rules worth
hardening into canonical specs or tooling are:

1. `/attune-codex` -> manifest-check
2. instructions:generate -> instructions:validate
3. `/claim-spoils` -> `/spoils-ledger`
4. `/refine-spoils` -> `/spoils-ledger`
5. `/scribe-grimoire` -> `/initiate-status`
6. plan-active-workstreams -> next-step refresh

These are low-ambiguity and low-risk.

## What Should Stay Recommendation-Only

Do not auto-run these transitions:

- review-active-workstreams -> plan-active-workstreams
- `/initiate-status` -> `/rank-up`
- `/chronicle` -> reconcile-lessons
- planning refresh -> execution command
- benchmark completion -> local routing adoption

Each of these still depends on judgment about priority, scope, or risk.

## Success Condition For This Policy

This policy is working when:

- mechanical post-checks happen consistently
- strategic lane changes are not auto-triggered by accident
- the repo's next-step surfaces stay truthful after maintenance work
- rank-up and local-model adoption remain explicit operator decisions
