# INSTRUCTIONS

> AUTO-GENERATED FILE. Edit canonical source in `instructions/canonical/*` and regenerate.

## Project
Mythos: An adventurer's guild for AI coding agents — reusable, guardrailed grimoires (workflow frameworks) for real work

## Routing
- Load framework manifest: `frameworks/{service}/{framework}/manifest.json`
- Load framework guardrails: `frameworks/{service}/{framework}/guardrails.md`
- Load project context when applicable: `clients/{client_code}/{project_name}/project.json`

## Safety Rules
- Never expose PII, credentials, API keys, or .env values
- Never write client-specific data into frameworks
- Never skip declared execution mode constraints
- Never run destructive operations without explicit confirmation
- Use observational reporting: observations and hypotheses, not diagnoses
- Contribution workflow: always work on a feature branch and open a pull request — never commit or push directly to `main`

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
- `capture-task` (PATCH_ALLOWED): claim-spoils — Import successful ad-hoc work into a normalized spoils bundle
- `normalize-capture` (PATCH_ALLOWED): refine-spoils — Validate and normalize a spoils bundle
- `capture-status` (REVIEW_ONLY): spoils-ledger — Report spoils readiness and missing fields
- `scaffold-framework` (PATCH_ALLOWED): scribe-grimoire — Scaffold a grimoire candidate from spoils
- `candidate-status` (REVIEW_ONLY): initiate-status — Report grimoire candidate maturity and blockers
- `replay-framework` (PATCH_ALLOWED): rehearse-grimoire — Run replay-readiness checks for a grimoire candidate
- `promote-framework` (PATCH_ALLOWED): rank-up — Promote a validated grimoire candidate into the guild
- `publish-framework` (PATCH_ALLOWED): enshrine-grimoire — Scan, sanitize, and export a grimoire to the public repo in one guided motion
- `new-framework` (PATCH_ALLOWED): forge-grimoire — Forge a new grimoire from intake or example
- `audit-framework` (REVIEW_ONLY): appraise-grimoire — Validate a grimoire's structure and references
- `improve-framework` (PATCH_ALLOWED): empower-grimoire — Empower a grimoire based on run outputs
- `list-frameworks` (REVIEW_ONLY): bookshelf — List registered grimoires
- `new-client` (PATCH_ALLOWED): enroll-patron — Register a new patron entry
- `new-project` (PATCH_ALLOWED): open-contract — Open a contract linking a patron to a grimoire
- `project-status` (REVIEW_ONLY): contract-ledger — Report contract progression
- `run-framework` (COORDINATOR): cast-grimoire — Cast a grimoire's prompt chain against a patron contract
- `system-status` (REVIEW_ONLY): guild-ledger — Global guild inventory and health summary
- `extract-skill` (PATCH_ALLOWED): awaken-essence — Awaken a reusable essence from a conversation workflow
- `sync-manifest` (PATCH_ALLOWED): attune-codex — Attune the project-claude.yml codex with assets on disk
- `orchestrate-loop` (COORDINATOR): guildmaster-loop — Drive the general review-driven orchestration loop: resolve targets, route work, preserve coordinator/worker/reviewer boundaries, and close through evidence and debrief
- `deliberate` (COORDINATOR): commune — Reason solo, gather multi-familiar counsel, synthesize, then route through the orchestration loop
- `convene-review` (COORDINATOR): conclave — Convene multiple distinct minds for adversarial review when a single trial isn't enough
- `blueprint` (COORDINATOR): charter-quest — Take a rough request from intent to a bounded, review-gated quest charter: deliberate, initialize a durable concept artifact, then route to plan-quest
- `concept-init` (PATCH_ALLOWED): inscribe-lore — Create a new concept artifact, sized to scope
- `plan-task` (REVIEW_ONLY): plan-quest — Draft a bounded quest charter for a task, grounded against existing grimoires
- `review-task-plan` (REVIEW_ONLY): trial-quest — Put a generated quest charter through independent review before it runs
- `run-plan` (COORDINATOR): embark — Resolve an approved quest charter and route it to the correct execution pathway
- `evidence-loop` (COORDINATOR): gauntlet — Run the high-rigor review profile: adversarial review by a distinct mind, a third-mind context check, and a research disposition for every finding
- `route` (REVIEW_ONLY): site — Resolve and recommend the correct command for a stated goal
- `debrief-run` (REVIEW_ONLY): chronicle — Run end-of-session debrief producing improve and replicate notes

## Agents
- `framework-auditor`: Read-only structure and policy validation
- `framework-executor`: Prompt execution with mode enforcement
- `output-reviewer`: Output quality validation
- `completion-auditor`: Evidence-based completion verification against acceptance criteria
- `extract-skill-agent`: Conversation workflow analysis and skill artifact generation

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
| media/video-editing | 6 | FINDINGS_ONLY, PATCH_ALLOWED, REVIEW_ONLY | none |
| meta/dreaming-system | 7 | FINDINGS_ONLY, REVIEW_ONLY, PATCH_ALLOWED, RUN_ONLY | none |
| meta/execution-normalization | 11 | REVIEW_ONLY, RUN_ONLY, PATCH_ALLOWED, COORDINATOR | none |
| project-management/dart-collaboration | 2 | REVIEW_ONLY, PATCH_ALLOWED | none |
| project-management/feedback-to-tasks | 5 | FINDINGS_ONLY, RUN_ONLY, PATCH_ALLOWED | dart, notion |
| wordpress/analytics-tracking | 4 | FINDINGS_ONLY, RUN_ONLY, PATCH_ALLOWED | playwright |
| wordpress/content-editing | 6 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED, COORDINATOR | playwright |
| wordpress/design-mockup-validation | 3 | RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED | playwright |
| wordpress/design-research | 3 | FINDINGS_ONLY, PATCH_ALLOWED | playwright |
| wordpress/documentation | 4 | FINDINGS_ONLY, PATCH_ALLOWED, REVIEW_ONLY | playwright, notion |
| wordpress/page-cro | 4 | FINDINGS_ONLY, REVIEW_ONLY | playwright |
| wordpress/qa | 16 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED, COORDINATOR, REPO_HYGIENE | playwright |
| wordpress/seo-audit | 5 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY | playwright |
| wordpress/seo-validation | 6 | FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY | none |

## Command Aliases

Command names are mechanical aliases. The typed alias is provenance; authority, state, errors, evidence, and closeout belong to the resolved generic command.

- `/guild-ledger` (`/system-status`) [primary]; authority: `/system-status`
- `/guildmaster-loop` (`/orchestrate-loop`) [primary]; authority: `/orchestrate-loop`
- `/commune` (`/deliberate`) [primary]; authority: `/deliberate`
- `/conclave` (`/convene-review`) [primary]; authority: `/convene-review`
- `/charter-quest` (`/blueprint`) [primary]; authority: `/blueprint`
- `/inscribe-lore` (`/concept-init`) [primary]; authority: `/concept-init`
- `/plan-quest` (`/plan-task`) [primary]; authority: `/plan-task`
- `/trial-quest` (`/review-task-plan`) [primary]; authority: `/review-task-plan`
- `/embark` (`/run-plan`) [primary]; authority: `/run-plan`
- `/gauntlet` (`/evidence-loop`) [primary]; authority: `/evidence-loop`
- `/site` (`/route`) [primary]; authority: `/route`
- `/chronicle` (`/debrief-run`) [primary]; authority: `/debrief-run`
- `/cast-grimoire` (`/run-framework`) [primary]; authority: `/run-framework`
- `/bookshelf` (`/list-frameworks`) [primary]; authority: `/list-frameworks`
- `/forge-grimoire` (`/new-framework`) [primary]; authority: `/new-framework`
- `/scribe-grimoire` (`/scaffold-framework`) [primary]; authority: `/scaffold-framework`
- `/appraise-grimoire` (`/audit-framework`) [primary]; authority: `/audit-framework`
- `/empower-grimoire` (`/improve-framework`) [primary]; authority: `/improve-framework`
- `/rank-up` (`/promote-framework`) [primary]; authority: `/promote-framework`
- `/enshrine-grimoire` (`/publish-framework`) [primary]; authority: `/publish-framework`
- `/rehearse-grimoire` (`/replay-framework`) [primary]; authority: `/replay-framework`
- `/initiate-status` (`/candidate-status`) [primary]; authority: `/candidate-status`
- `/attune-codex` (`/sync-manifest`) [primary]; authority: `/sync-manifest`
- `/claim-spoils` (`/capture-task`) [primary]; authority: `/capture-task`
- `/refine-spoils` (`/normalize-capture`) [primary]; authority: `/normalize-capture`
- `/spoils-ledger` (`/capture-status`) [primary]; authority: `/capture-status`
- `/awaken-essence` (`/extract-skill`) [primary]; authority: `/extract-skill`
- `/enroll-patron` (`/new-client`) [primary]; authority: `/new-client`
- `/open-contract` (`/new-project`) [primary]; authority: `/new-project`
- `/contract-ledger` (`/project-status`) [primary]; authority: `/project-status`
- `/scry` (`/system-status`) [primary]; authority: `/system-status`
- `/gm` (`/orchestrate-loop`) [primary]; authority: `/orchestrate-loop`
- `/cast` (`/run-framework`) [primary]; authority: `/run-framework`
- `/chron` (`/debrief-run`) [primary]; authority: `/debrief-run`
- `/attune` (`/sync-manifest`) [primary]; authority: `/sync-manifest`
- `/aura` -> `/system-status` [cross-alias]; authority: `/system-status`
- `/post-contract` -> `/blueprint` [cross-alias]; authority: `/blueprint`
- `/draft-contract` -> `/plan-task` [cross-alias]; authority: `/plan-task`
- `/save-throw` -> `/review-task-plan` [cross-alias]; authority: `/review-task-plan`
- `/accept-contract` -> `/run-plan` [cross-alias]; authority: `/run-plan`
- `/augur` -> `/route` [cross-alias]; authority: `/route`
- `/consult-oracle` -> `/route` [cross-alias]; authority: `/route`
- `/invoke` -> `/run-framework` [cross-alias]; authority: `/run-framework`
- `/spellbook` -> `/list-frameworks` [cross-alias]; authority: `/list-frameworks`
- `/identify` -> `/audit-framework` [cross-alias]; authority: `/audit-framework`
- `/cultivate` -> `/improve-framework` [cross-alias]; authority: `/improve-framework`
- `/level-up` -> `/promote-framework` [cross-alias]; authority: `/promote-framework`
- `/loot` -> `/capture-task` [cross-alias]; authority: `/capture-task`
- `/feat` -> `/extract-skill` [cross-alias]; authority: `/extract-skill`
- `/campaign` -> `/new-project` [cross-alias]; authority: `/new-project`
- `/owl` -> `/orchestrate-loop` [compatibility]; authority: `/orchestrate-loop`
- `/oa` -> `/orchestrate-loop` [compatibility]; authority: `/orchestrate-loop`
- `/dl` -> `/deliberate` [compatibility]; authority: `/deliberate`
- `/oc` -> `/convene-review` [compatibility]; authority: `/convene-review`
- `/council` -> `/convene-review` [compatibility]; authority: `/convene-review`

### Framework aliases

- `presentation-review` (`deliverables/presentation-review`) [primary]; authority: `deliverables/presentation-review`
- `scope-verification` (`deliverables/scope-verification`) [primary]; authority: `deliverables/scope-verification`
- `version-reconciliation` (`deliverables/version-reconciliation`) [primary]; authority: `deliverables/version-reconciliation`
- `video-editing` (`media/video-editing`) [primary]; authority: `media/video-editing`
- `dreaming-system` (`meta/dreaming-system`) [primary]; authority: `meta/dreaming-system`
- `execution-normalization` (`meta/execution-normalization`) [primary]; authority: `meta/execution-normalization`
- `dart-collaboration` (`project-management/dart-collaboration`) [primary]; authority: `project-management/dart-collaboration`
- `feedback-to-tasks` (`project-management/feedback-to-tasks`) [primary]; authority: `project-management/feedback-to-tasks`
- `analytics-tracking` (`wordpress/analytics-tracking`) [primary]; authority: `wordpress/analytics-tracking`
- `content-editing` (`wordpress/content-editing`) [primary]; authority: `wordpress/content-editing`
- `design-mockup-validation` (`wordpress/design-mockup-validation`) [primary]; authority: `wordpress/design-mockup-validation`
- `design-research` (`wordpress/design-research`) [primary]; authority: `wordpress/design-research`
- `documentation` (`wordpress/documentation`) [primary]; authority: `wordpress/documentation`
- `page-cro` (`wordpress/page-cro`) [primary]; authority: `wordpress/page-cro`
- `qa` (`wordpress/qa`) [primary]; authority: `wordpress/qa`
- `seo-audit` (`wordpress/seo-audit`) [primary]; authority: `wordpress/seo-audit`
- `seo-validation` (`wordpress/seo-validation`) [primary]; authority: `wordpress/seo-validation`

### Skill aliases

- `manage-grimoires` (`manage-frameworks`) [primary]; authority: `manage-frameworks`
- `manage-patrons` (`manage-clients`) [primary]; authority: `manage-clients`
- `execute-grimoire` (`execute-framework`) [primary]; authority: `execute-framework`
- `extract-essence` (`extract-skill`) [primary]; authority: `extract-skill`

### Tool aliases

- `generate` (`instructions:generate`) [primary]; authority: `instructions:generate`
- `generate-preview` (`instructions:generate:preview`) [primary]; authority: `instructions:generate:preview`
- `validate` (`instructions:validate`) [primary]; authority: `instructions:validate`
- `validate-skip-claude` (`instructions:validate:skip-claude`) [primary]; authority: `instructions:validate:skip-claude`
- `check` (`instructions:check`) [primary]; authority: `instructions:check`
- `scaffold-workspace` (`workspace:scaffold`) [primary]; authority: `workspace:scaffold`
- `scaffold-project` (`workspace:project`) [primary]; authority: `workspace:project`
- `validate-workspace` (`workspace:validate`) [primary]; authority: `workspace:validate`
- `capture` (`workspace:capture`) [primary]; authority: `workspace:capture`
- `normalize-capture` (`workspace:capture:normalize`) [primary]; authority: `workspace:capture:normalize`
- `capture-status` (`workspace:capture:status`) [primary]; authority: `workspace:capture:status`
- `scaffold-candidate` (`workspace:candidate:scaffold`) [primary]; authority: `workspace:candidate:scaffold`
- `candidate-status` (`workspace:candidate:status`) [primary]; authority: `workspace:candidate:status`
- `replay-candidate` (`workspace:candidate:replay`) [primary]; authority: `workspace:candidate:replay`
- `promote-candidate` (`workspace:candidate:promote`) [primary]; authority: `workspace:candidate:promote`
- `validate-output` (`workspace:output:validate`) [primary]; authority: `workspace:output:validate`
- `init-run` (`workspace:run:init`) [primary]; authority: `workspace:run:init`
- `finalize-run` (`workspace:run:finalize`) [primary]; authority: `workspace:run:finalize`
- `validate-manifest` (`manifest:validate`) [primary]; authority: `manifest:validate`
- `verify-system` (`verify`) [primary]; authority: `verify`
- `verify-framework` (`verify:framework`) [primary]; authority: `verify:framework`
- `verify-skill` (`verify:skill`) [primary]; authority: `verify:skill`
- `verify-guardrails` (`verify:guardrails`) [primary]; authority: `verify:guardrails`
- `verify-run-evidence` (`verify:run-evidence`) [primary]; authority: `verify:run-evidence`
- `verify-site-audit` (`verify:site-audit`) [primary]; authority: `verify:site-audit`
- `verify-report-claims` (`verify:report-claims`) [primary]; authority: `verify:report-claims`
- `sync-manifest` (`manifest:sync`) [primary]; authority: `manifest:sync`
- `check-manifest` (`manifest:check`) [primary]; authority: `manifest:check`
- `research` (`research:perplexity`) [primary]; authority: `research:perplexity`
- `first-run` (`setup`) [primary]; authority: `setup`
