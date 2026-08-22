# OPENCODE.md

> AUTO-GENERATED FILE. Edit canonical source in `instructions/canonical/*` and regenerate.

OpenCode runtime guidance for Mythos.

## Project
Mythos: LLM operating system for reusable client-work frameworks

## Routing
- Load framework manifest: `frameworks/{service}/{framework}/manifest.json`
- Load framework guardrails: `frameworks/{service}/{framework}/guardrails.md`
- Load project context when applicable: `clients/{client_code}/{project_name}/project.json`

## Safety Rules
- Never expose PII, credentials, API keys, or .env values
- Never treat private local substrates as default frontier-model context; route private surface access through substrate-specific allowance, query bounds, redaction, and receipt rules in instructions/canonical/private-surface-introspection-rule.yaml
- Disclose the model/mind for every subagent and bridge dispatch at dispatch time, and tier the dispatched mind to the work altitude per instructions/canonical/dispatch-routing-rule.yaml; same-model Claude subagents are parallel contexts, not distinct intelligence
- Never write client-specific data into frameworks
- Never skip declared execution mode constraints
- Never run destructive operations without explicit confirmation
- Use observational reporting: observations and hypotheses, not diagnoses
- When a role term such as operator, user, agent, or reviewer could refer to more than one actor, name the actor explicitly (for example: human, Codex agent, Claude agent). If the intended actor is ambiguous, ask instead of assuming.

## The Core (doctrine)

# The Core

`safety.yaml`, alongside this file, is immutable and enforced — the generator hard-fails
if a change would weaken it. This file is different: it is the guild's philosophy, not
enforcement machinery. It is read, not run. Where it and a mechanism disagree, the
mechanism wins — a doctrine describes what good behavior looks like, it doesn't grant
itself authority over the code that actually executes.

## Alias-authority law

A mythic name is a lens, never a mechanism. `cast-grimoire` and `run-framework` are the
same command wearing two names, and the plain one — the `resolves_to` target — is the
one with authority. If a mythic name and its target ever disagree about behavior, the
target is right and the alias is a bug. Immersion is free; correctness is not negotiable
for it.

This is why the guild ships `resolves_to` in the alias registry instead of renaming files:
a name is presentation, and presentation should never be load-bearing.

## Rank honesty: evidence, not intention

A grimoire's rank — Iron, Bronze, Silver, Gold — is a record of what has actually
happened to it, never a record of how good anyone expects it to be. A freshly scribed
grimoire is Iron even if you're certain it's brilliant; it stays Iron until it has
actually run. A grimoire that has run once is Bronze, not Silver, no matter how clean
that one run looked. Rank moves up only when the evidence for the next tier exists —
never in advance of it, never on the strength of confidence alone.

The corollary: it is never a failure for a grimoire to sit at Iron or Bronze. It is only
a failure to claim a rank the evidence doesn't support.

## A producer never validates its own trial

The mind that did the work is never the mind that judges whether the work is good. A
trial (review) always sits with a distinct mind from whoever produced the thing under
review — not as etiquette, but because a mind checking its own output tends to see what
it meant to write, not what it actually wrote. If a producer's own claim of success were
sufficient, trials would have no reason to exist. This applies at every scale: a single
familiar reviewing its own patch, and a guild reviewing its own doctrine, fail the same
way for the same reason.

## The repository/export membrane

What a session knows about you — your Mirror — and what the repository tracks, stages,
generates, or exports are two different surfaces, and the boundary between them does not
move. The Mirror can inform how a session talks to you; it can never leave a trace in
anything that gets committed, staged, built, or shipped. A repository that behaves
differently depending on whether a Mirror is present has already broken this law, even
if the difference looks harmless. The only approved place Mirror content is allowed to
surface is a clearly labeled, advisory context payload handed to a session at its start —
nowhere else, ever.

## Do no harm

Every rule above exists to keep the guild trustworthy to the people who rely on it: don't
claim rank you haven't earned, don't let a producer grade its own work, don't let personal
context leak into shared surfaces, and don't let a pretty name quietly change what a
command actually does. None of these are abstract virtues — each one is a specific way
Mythos could otherwise quietly stop deserving the trust it asks for.

## Execution Modes
| Mode | Can Write | Can Execute | Description |
|---|---|---|---|
| FINDINGS_ONLY | false | false | Observe and report only |
| RUN_ONLY | reports_only | true | Execute runs without applying fixes |
| REVIEW_ONLY | analysis_only | false | Analyze existing outputs |
| PATCH_ALLOWED | scoped | true | Apply minimal targeted changes |
| COORDINATOR | delegated | delegated | Orchestrate sub-workflows |
| REPO_HYGIENE | docs_cleanup | false | Navigation and cleanup only |

## Operations
- `advance-pipeline` (COORDINATOR): Legacy alias for execute-plan master
- `execute-plan` (COORDINATOR): Execute the next incomplete stage from a compatible prompt plan
- `review-progress` (REVIEW_ONLY): Run a findings-first review of progress or pipeline output
- `author-prompt-system` (PATCH_ALLOWED): Author or update prompt packs and the master run order from _dev research and proposed flows
- `assemble-prompt-system` (PATCH_ALLOWED): Reconcile prompt packs, run prompts, manifest, and the master run order
- `plan-pipeline` (REVIEW_ONLY): Choose the next eligible stage or infrastructure track before execution
- `plan-active-workstreams` (REVIEW_ONLY): Plan the current bounded follow-on queues after the master pipeline is complete
- `create-plan` (REVIEW_ONLY): Operator-friendly alias for plan-task
- `amend-plan` (REVIEW_ONLY): Amend an existing task plan when execution reality diverges materially from plan assumptions
- `review-active-workstreams` (REVIEW_ONLY): Review the current bounded active workstreams after master-pipeline completion
- `capture-task` (PATCH_ALLOWED): Import successful work into a normalized capture bundle
- `normalize-capture` (PATCH_ALLOWED): Validate and normalize a capture bundle
- `capture-status` (REVIEW_ONLY): Report capture readiness and missing fields
- `scaffold-framework` (PATCH_ALLOWED): Scaffold a framework candidate from captures
- `generate-harness` (PATCH_ALLOWED): Generate .claude/ harness trees for unharnessed frameworks
- `candidate-status` (REVIEW_ONLY): Report framework candidate maturity and blockers
- `replay-framework` (PATCH_ALLOWED): Run replay-readiness checks for a framework candidate
- `promote-framework` (PATCH_ALLOWED): Promote a validated framework candidate into Mythos
- `new-framework` (PATCH_ALLOWED): Create framework from intake or example
- `audit-framework` (REVIEW_ONLY): Validate framework structure and references
- `improve-framework` (PATCH_ALLOWED): Improve framework based on run outputs
- `list-frameworks` (REVIEW_ONLY): List registered frameworks
- `new-client` (PATCH_ALLOWED): Create new client entry
- `new-project` (PATCH_ALLOWED): Create project linked to framework
- `project-status` (REVIEW_ONLY): Report project progression
- `triage-client-board` (REVIEW_ONLY): Triage client-board intake into pickup-ready work, planning work, and clarification work
- `run-framework` (COORDINATOR): Execute framework prompt chain
- `mythos-status` (REVIEW_ONLY): Global inventory and health summary
- `next-step` (REVIEW_ONLY): Resolve the deterministic next recommended Mythos command from current repo state
- `cadence` (REVIEW_ONLY): Render the current cadence slice across active Mythos domains
- `follow-signal` (COORDINATOR): Follow the exact next action authorized by a live signal or approved task plan
- `extract-skill` (PATCH_ALLOWED): Extract reusable skill from conversation workflow
- `sync-manifest` (PATCH_ALLOWED): Sync project-claude.yml with assets on disk
- `validate-all-frameworks` (REVIEW_ONLY): Validate all registered frameworks in parallel
- `review-source-material` (REVIEW_ONLY): Evaluate a source document against the source-status ladder and minimum source-document contract
- `reconcile-lessons` (REVIEW_ONLY): Reconcile session learnings and review findings into a durable lessons artifact
- `debrief-run` (REVIEW_ONLY): Run end-of-session debrief producing improve and replicate plans
- `normalize-signals` (COORDINATOR): Normalize the live signal surface by closing stale, consumed, or duplicate signals
- `ad-copy-dev` (COORDINATOR): Build ad copy through the reusable ad-copy development workflow
- `plan-task` (REVIEW_ONLY): Create a bounded task plan with explicit gates, review lane, and expected outcomes
- `systemize-behavior` (REVIEW_ONLY): Advisory detector for repeated corrections and repeat-task descriptions
- `claim-intake` (REVIEW_ONLY): Claim a client-board intake item for planning or execution
- `clean-house` (REPO_HYGIENE): Repo-hygiene cleanup for navigation, grouping, and stale analysis surfaces
- `concept-dispatch` (PATCH_ALLOWED): Dispatch a concept for bounded synthesis or review work
- `concept-init` (PATCH_ALLOWED): Initialize a concept artifact with the canonical metadata contract
- `concept-promote` (PATCH_ALLOWED): Promote a concept artifact into its next durable system surface
- `next-session` (PATCH_ALLOWED): Write a canonical next-session handoff artifact capturing outcomes, blockers, and the exact pickup command
- `orchestrate` (COORDINATOR): Fresh-session handoff wrapper that resolves a plan and routes it through the orchestrate skill
- `orchestrate-loop` (COORDINATOR): Run a general review-driven orchestration loop with actor boundaries, Codex finding classification, and debrief closeout
- `owl` (COORDINATOR): Human-friendly alias for orchestrate-loop: Observe, Weigh, Loop
- `oa` (COORDINATOR): Shortest operator alias for Owl Audit: review-first orchestration through orchestrate-loop
- `council-of-owls` (COORDINATOR): Human-friendly shorthand for consult-then-route work: convene the council when warranted, then loop through owl/orchestrate-loop
- `oc` (COORDINATOR): Shortest operator alias for council-of-owls: Owl Council
- `dispatch-bridge` (COORDINATOR): Dispatch a task to a distinct actor for cross-verification or specialized analysis
- `dispatch-trifecta` (COORDINATOR): Orchestrate a parallel consultation with Codex, Claude, and Gemini to produce a synthetic community consensus
- `review-dispatch` (REVIEW_ONLY): Review dispatch outputs and handoff integrity before proceeding
- `review-task-plan` (REVIEW_ONLY): Review a generated task plan before execution
- `run-plan` (COORDINATOR): Route a plan-like artifact to the correct execution workflow
- `synthesize-concept` (PATCH_ALLOWED): Synthesize durable concept output from bounded concept inputs
- `whats-next` (REVIEW_ONLY): Daily boot sequence — surface what is done, blocked, and executable across all clients
- `write-handoff` (PATCH_ALLOWED): [DEPRECATED — use next-session] Write a next-session handoff artifact for a client or system workstream
- `convene` (COORDINATOR): Convene the three-lobe kernel on a task
- `convene-gate-status` (REVIEW_ONLY): Report whether the convene gate is enabled and what it protects
- `bridge-speakers` (RUN_ONLY): Bridge multiple audio output devices
- `aside` (PATCH_ALLOWED): Route a side-thought from in-flight conversation into the right Mythos surface
- `fw-deliverables-presentation-review` (COORDINATOR): Run Presentation Review — Cross-reference audit of client presentations against project plan documents, screenshots, and errata
- `fw-deliverables-scope-verification` (COORDINATOR): Run Scope Verification — Verifies scope/proposal documents against source data by exact categorization, counting, and discrepancy detection
- `fw-deliverables-version-reconciliation` (COORDINATOR): Run Version Reconciliation — Structured diff and contradiction detection between two versions of a deliverable, supporting cross-format comparison
- `fw-meta-execution-normalization` (COORDINATOR): Run Execution Normalization — Tool-agnostic pipeline for normalizing framework execution models with progressive code offloading
- `fw-paid-media-ad-creative` (COORDINATOR): Run Ad Creative — Generate, iterate, and scale ad creative across paid advertising platforms with structured testing plans
- `fw-paid-media-campaign-management` (COORDINATOR): Run Campaign Management — End-to-end paid advertising campaign management
- `fw-project-management-dart-collaboration` (COORDINATOR): Run Dart Collaboration — Abstract task creation and collaboration framework using Dart as human frontend and git workspace repos as backend
- `fw-project-management-feedback-to-tasks` (COORDINATOR): Run Feedback To Tasks — Compiles stakeholder feedback from PM tools into provenance-cited task lists
- `fw-wordpress-analytics-tracking` (COORDINATOR): Run Analytics Tracking — Analytics implementation framework for WordPress sites
- `fw-wordpress-content-editing` (COORDINATOR): Run Content Editing — Scoped WordPress admin content editing with visual and functional verification
- `fw-wordpress-design-mockup-validation` (COORDINATOR): Run Design Mockup Validation — Cross-AI design mockup validation with iterative generation and review
- `fw-wordpress-design-research` (COORDINATOR): Run Design Research — Pre-build design research and competitive site analysis
- `fw-wordpress-documentation` (COORDINATOR): Run Documentation — Client-facing WordPress admin documentation via MCP browser walkthroughs with Notion output
- `fw-wordpress-page-cro` (COORDINATOR): Run Page Cro — Multi-phase conversion rate optimization audit for marketing pages
- `fw-wordpress-qa` (COORDINATOR): Run Qa — Playwright-based site functionality testing with CRM integration validation
- `fw-wordpress-seo-audit` (COORDINATOR): Run Seo Audit — Multi-phase SEO audit for WordPress sites
- `fw-wordpress-seo-validation` (COORDINATOR): Run Seo Validation — Playwright-based pre-launch SEO validation crawl for WordPress sites
- `fw-media-video-editing` (COORDINATOR): Run Video Editing — Conversation-driven video editing: transcribe, cut, color grade, burn subtitles, self-evaluate

## Agents
- `framework-auditor`: Read-only structure and policy validation
- `framework-executor`: Prompt execution with mode enforcement
- `output-reviewer`: Output quality validation
- `completion-auditor`: Evidence-based completion verification against acceptance criteria
- `extract-skill-agent`: Conversation workflow analysis and skill artifact generation
- `lifecycle-auditor`: Lifecycle hook execution verification and drift detection
- `capture-normalizer`: Lightweight capture bundle normalization for parallel batch processing
- `signal-normalizer`: Bounded signal-surface maintenance: closing stale, consumed, or duplicate coordination signals

## Orchestration Policy
- Completion auditing: required_for_substantial_changes
- Max reopen cycles: 2
- Audit exemptions: FINDINGS_ONLY, REVIEW_ONLY, REPO_HYGIENE
- Evidence required: changed_files, test_results, acceptance_criteria

## Registered Frameworks
| Framework | Prompt Count | Modes | MCP Requirements |
|---|---:|---|---|
| deliverables/presentation-review | 8 | FINDINGS_ONLY, REVIEW_ONLY | none |
| deliverables/scope-verification | 2 | FINDINGS_ONLY, PATCH_ALLOWED | playwright |
| deliverables/version-reconciliation | 2 | FINDINGS_ONLY, PATCH_ALLOWED | none |
| meta/execution-normalization | 11 | REVIEW_ONLY, RUN_ONLY, PATCH_ALLOWED, COORDINATOR | none |
| project-management/dart-collaboration | 2 | REVIEW_ONLY, PATCH_ALLOWED | none |
| project-management/feedback-to-tasks | 5 | FINDINGS_ONLY, RUN_ONLY, PATCH_ALLOWED | dart, notion |
| wordpress/design-mockup-validation | 3 | RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED | playwright |
| wordpress/design-research | 3 | FINDINGS_ONLY, PATCH_ALLOWED | playwright |
| wordpress/documentation | 4 | FINDINGS_ONLY, PATCH_ALLOWED, REVIEW_ONLY | playwright, notion |
| wordpress/qa | 16 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED, COORDINATOR, REPO_HYGIENE | playwright |
| wordpress/seo-validation | 6 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY | none |
| wordpress/analytics-tracking | 4 | FINDINGS_ONLY, RUN_ONLY, PATCH_ALLOWED | playwright |
| paid-media/ad-creative | 5 | FINDINGS_ONLY, REVIEW_ONLY | none |
| paid-media/campaign-management | 4 | FINDINGS_ONLY, REVIEW_ONLY, PATCH_ALLOWED | none |
| wordpress/content-editing | 6 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED, COORDINATOR | playwright |
| wordpress/page-cro | 4 | FINDINGS_ONLY, REVIEW_ONLY | playwright |
| wordpress/seo-audit | 5 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY | playwright |
| paid-media/google-ads-search-campaign-build | 6 | FINDINGS_ONLY, REVIEW_ONLY, PATCH_ALLOWED, RUN_ONLY | google-ads |
| paid-media/meta-creative-iteration | 9 | FINDINGS_ONLY, REVIEW_ONLY, PATCH_ALLOWED | meta-ads, delesign, claude-in-chrome |
| wordpress/livecanvas-rebuild | 5 | FINDINGS_ONLY, PATCH_ALLOWED | playwright |
| media/video-editing | 6 | FINDINGS_ONLY, PATCH_ALLOWED, REVIEW_ONLY | none |
| meta/dreaming-system | 7 | FINDINGS_ONLY, REVIEW_ONLY, PATCH_ALLOWED, RUN_ONLY | none |

## Command Aliases

Command names are mechanical aliases. The typed alias is provenance; authority, state, errors, evidence, and closeout belong to the resolved generic command.

- `/oil` (`/outward-inward`) [primary]; authority: `/outward-inward`
- `/chi` (`/outward-inward`) [primary]; authority: `/outward-inward`
- `/owl` -> `/orchestrate-loop` [compatibility]; authority: `/orchestrate-loop`
- `/oa` -> `/orchestrate-loop` [compatibility]; authority: `/orchestrate-loop`
- `/council-of-owls` -> `/orchestrate-loop` [compatibility]; authority: `/orchestrate-loop`
- `/deliberate` -> `/orchestrate-loop` [compatibility]; authority: `/orchestrate-loop`
- `/dl` -> `/deliberate` [compatibility]; executes: `/orchestrate-loop`; authority: `/orchestrate-loop`
- `/oc` -> `/council-of-owls` [compatibility]; executes: `/orchestrate-loop`; authority: `/orchestrate-loop`
- `/help-me-route` -> `/route` [compatibility]; authority: `/route`
- `/blueprint` -> `/blueprint` [compatibility]; authority: `/blueprint`
- `/el` -> `/evidence-loop` [compatibility]; authority: `/evidence-loop`

## OpenCode Notes
- Adapter targets are configurable via `instructions/adapters/targets.local.yaml`.
- Keep strict parity with canonical safety and mode rules.
