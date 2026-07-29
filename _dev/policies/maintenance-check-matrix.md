# Maintenance Check Matrix

Operational matrix for deciding which mechanical checks should run after common
commands, which checks should run when specific repo paths change, and which heavier
checks should run on a cadence.

This document is intended to be immediately usable by an AI actor and the operator.

It is a companion to:

- `_dev/policies/command-follow-through-policy.md`
- `_dev/policies/plan-contract.md`
- canonical command specs under `instructions/canonical/commands/`

It is not yet a machine-executed trigger engine. It is the source policy to codify
once the current maintenance backlog is under control.

## Purpose

A workshop this size accumulates enough commands, planners, verifiers, and generated
surfaces that maintenance cannot stay memory-driven.

This matrix answers three practical questions:

1. After a command runs, what mechanical checks should happen next?
2. When specific code or instruction paths change, what verification should run?
3. Which checks are too heavy for every change and should instead run on a cadence?

## Severity Model

Use these maintenance bands:

- **Band A — Immediate mechanical post-check**
  Run automatically after a command or change when the check is cheap and low-ambiguity.
- **Band B — End-of-slice verification**
  Run after a bounded work slice or before claiming a lane is clean.
- **Band C — Periodic health pass**
  Run on a cadence, before rank-up, or before merge of a broad maintenance batch.

## Command Trigger Matrix

### A. Instruction and manifest maintenance

| Triggering command | Band A immediate checks | Band B before closeout | Notes |
|---|---|---|---|
| `/attune-codex` (sync-manifest) | manifest-check | full-verify if the sync changed multiple surfaces | This is the cleanest immediate automation candidate. |
| instructions:generate | instructions:validate | full-verify if generated outputs changed canonical references or command surfaces | Generate should never be treated as done without validate. |
| `/author-prompt-system` | instructions:validate | targeted command verification, full-verify when prompt packs affect command behavior | Use targeted verification if the change is narrow. |
| `/assemble-prompt-system` | instructions:validate | targeted command verification, full-verify when assembly changed canonical outputs | If expectation failures remain, route to review, not automation. |

### B. Capture and candidate lifecycle

| Triggering command | Band A immediate checks | Band B before closeout | Notes |
|---|---|---|---|
| `/claim-spoils` (capture-task) | `/spoils-ledger` | none | Mechanical completeness check only. |
| `/refine-spoils` (normalize-capture) | `/spoils-ledger` | none | The status check is the acceptance proof. |
| `/scribe-grimoire` (scaffold-framework) | `/initiate-status` (candidate-status) | instructions:validate if scaffolding generated managed instruction assets | Candidate truth should refresh immediately. |
| `/rehearse-grimoire` (replay-framework) | `/initiate-status` | full-verify before any rank-up recommendation | Replay result should not directly trigger rank-up. |
| `/rank-up` (promote-framework) | instructions:generate, instructions:validate | full-verify, broad grimoire validation when the rank-up touches shared surfaces | Rank-up is human-gated even if checks pass. |

### C. Planning and routing truth

| Triggering command | Band A immediate checks | Band B before closeout | Notes |
|---|---|---|---|
| plan-active-workstreams | next-step refresh | review-active-workstreams if the new plan conflicts with current signals | Next-step refresh is the mechanical post-check. |
| plan-pipeline | none | next-step refresh if planning outputs changed current routing truth | Use when the planner rewrites the authoritative next-step surface. |
| review-active-workstreams | none | plan-active-workstreams only if the review explicitly says planning is stale | This is recommendation-only, not auto-run. |
| `/contract-ledger` (project-status) | none | next-step refresh only if project closure or lane completion changed planning truth | Project status is observational unless it triggers a real lane transition. |
| normalize-signals | next-step refresh when live routing truth changed | review-active-workstreams if ambiguity remains | Signal cleanup affects routing, so next-step refresh is justified. |

### D. Execution and closeout

| Triggering command | Band A immediate checks | Band B before closeout | Notes |
|---|---|---|---|
| `/embark` (run-plan) | command-defined verify step, adjudicator bridge artifacts, `/chronicle` artifacts | full-verify when the stage touched shared system surfaces | `/embark` already carries a strong closeout contract in its spec. |
| `/chronicle` (debrief-run) | none | reconcile-lessons only when reusable findings actually exist | This remains judgment-gated. |
| reconcile-lessons | none | instructions:validate and targeted verification if lessons were codified into prompts/specs | Do not auto-implement lessons without a separate work step. |
| review-progress | none | route to the appropriate planner when the review says planning is stale | Findings are not a mechanical trigger by themselves. |

## Path Trigger Matrix

Use this when code changes happen outside a formal command flow.

### A. Canonical instruction and command surfaces

| Changed paths | Band A immediate checks | Band B before closeout | Why |
|---|---|---|---|
| `instructions/canonical/**/*.yaml` | instructions:validate | targeted command verification, full-verify | Canonical command and grimoire specs feed multiple harness surfaces. |
| `instructions/adapters/**/*.yaml` | instructions:validate | instructions:generate if managed targets should be refreshed now | Adapter drift can silently stale generated instructions. |
| `instructions/generated/manifest.json` | instructions:validate | full-verify if the generated manifest changed unexpectedly | Treat unexpected generated-manifest changes as drift until explained. |
| `.claude/**`, root instruction files, `.cursor/**` | instructions:validate | manifest-check when managed assets changed alongside command/skill/agent files | Generated instruction surfaces should stay in sync. |

### B. Grimoire surfaces

| Changed paths | Band A immediate checks | Band B before closeout | Why |
|---|---|---|---|
| `frameworks/**/manifest.json` | bounded grimoire verify when scoped, otherwise full-verify | broad grimoire validation for wide batches | Manifest drift is structural and high-signal. |
| `frameworks/**/guardrails.md` | guardrails verify | bounded grimoire verify or full-verify | Guardrails changes need both narrow and sometimes broad checks. |
| `frameworks/**/prompts/**` | bounded grimoire verify | full-verify when prompt-chain behavior changed broadly | One existing autonomy profile already covers this family. |
| `frameworks/**/templates/**`, `frameworks/**/docs/**` | none by default | bounded grimoire verify when docs/templates are normative for execution | Not every doc edit needs immediate verification. |

### C. Verification and lifecycle tooling

| Changed paths | Band A immediate checks | Band B before closeout | Why |
|---|---|---|---|
| `tools/verify/**` | lifecycle tests, instruction tests when contracts changed | full-verify | Verification tooling changes can invalidate trust in the checks themselves. |
| `tools/signals/**` | lifecycle tests, next-step refresh if routing logic changed | full-verify | Signal logic affects truthful handoff and routing. |
| `tools/instructions/**` | instructions:validate, instruction tests | full-verify if rendering or manifest logic changed | Keep generation and validation coupled. |
| `tools/user/**` | targeted alias/resolver check when possible | full-verify before rank-up-flow claims | User-space tooling backs capture/candidate lifecycle. |
| inference-bridge tooling | targeted tests when they exist; otherwise lifecycle tests if routing/provider contracts changed | manual workflow validation for the specific lane being modified | Avoid claiming automation support that the routing/tooling does not yet prove. |

### D. Planning and `_dev` truth surfaces

| Changed paths | Band A immediate checks | Band B before closeout | Why |
|---|---|---|---|
| `_dev/reports/analysis/plan-*.md`, `_dev/reports/analysis/*.next-step.json` | next-step refresh | review-active-workstreams or plan-pipeline when outputs conflict | Planning truth should be mechanically re-derived. |
| `_dev/prompts/**` | none by default | instruction tests and any prompt-pack contract checks when those prompts are part of the active command system | Many prompt files are source material, not all are active contracts. |
| `_dev/policies/**` | none by default | targeted validation if the policy is referenced by active command execution | Policy docs are slower-moving unless codified. |

## Cadence Matrix

### Per change or per command run

Run these every time the relevant surface changes:

- manifest-check
- instructions:validate
- next-step refresh
- `/spoils-ledger` (capture-status)
- `/initiate-status` (candidate-status)

These are the core low-cost truth checks.

### End of bounded work slice

Run these after a coherent maintenance slice, before claiming the slice is clean:

- full-verify
- the test suite
- review-active-workstreams when planning truth may have changed
- `/contract-ledger` when a project lane may have closed or changed phase

Examples of a bounded slice:

- command/spec maintenance
- capture-to-candidate preparation
- planning truth cleanup
- signal/routing maintenance

### Periodic health pass

Run these on a regular cadence or before merge / rank-up:

- full-verify
- the test suite
- broad grimoire validation
- transient artifact cleanup review
- planning-surface truth review
- signal-surface hygiene review

Recommended cadence:

- after any broad maintenance session
- before rank-up-flow testing
- before a large commit batch
- before merging a branch that touched command, grimoire, or routing surfaces

## Low-Risk Automations Worth Implementing First

These are the first rules worth making mechanical in tooling:

1. `/attune-codex` -> manifest-check
2. instructions:generate -> instructions:validate
3. `/claim-spoils` -> `/spoils-ledger`
4. `/refine-spoils` -> `/spoils-ledger`
5. `/scribe-grimoire` -> `/initiate-status`
6. plan-active-workstreams -> next-step refresh

These are cheap, deterministic, and unlikely to trigger the wrong strategic move.

## Rules That Must Stay Human-Gated

Do not automate these transitions:

- review -> replan
- candidate ready -> rank-up
- chronicle complete -> reconcile lessons
- planning refresh -> execute next strategic command
- benchmark complete -> local-model routing adoption

The system may surface them prominently, but should not auto-run them.

## Success Condition

This matrix is working when:

- command aftermath is no longer memory-driven
- path-based drift is caught quickly by cheap checks
- heavy checks happen at slice boundaries instead of never
- rank-up and local-model adoption remain explicit decisions
