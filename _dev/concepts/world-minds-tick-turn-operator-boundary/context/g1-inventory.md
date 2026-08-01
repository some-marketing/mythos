# G1 — Inventory of existing checkpoint/authority mechanisms

**Plan:** world-minds-tick-turn-operator-boundary
**Step:** G1 (REVIEW_ONLY)
**Date:** 2026-08-01

Each surface below is classified by authority type: **canonical rule** (instructions/canonical/**, governs behavior by declared policy), **executable gate** (a hook/script that mechanically blocks or permits an action), **advisory hook** (injected framing that shapes behavior but carries no independent authority — the alias-authority law's `resolves_to` pattern applies), or **historical evidence** (an observed instance of the mechanism firing, cited as precedent).

## 1. Execution modes — canonical rule
`instructions/canonical/system.yaml:111-134`. Defines FINDINGS_ONLY, RUN_ONLY, REVIEW_ONLY, PATCH_ALLOWED, COORDINATOR, REPO_HYGIENE with explicit `can_write`/`can_execute` per mode. This is the closest thing the repo has to a per-action authority tier today — every quest charter step in this very plan is labeled with one of these.

## 2. TRIVIAL/BOUNDED/NOVEL altitude classification — advisory hook, NOT canonical
`tools/kernel/hooks/userprompt-owl-altitude.cjs:45-56`. Injected into session context every turn (visible in this session's own transcript) as "advisory framing, not a new authority" — its own text says so. It classifies *work shape* (one safe step / known scoped job / open-ended), not operator-authority boundary. Must not be cited as canonical orchestrate-loop authority — that lives at (3) below.

## 3. Orchestrate-loop bubble-up criteria — canonical rule
`instructions/canonical/commands/orchestrate-loop.yaml:21`: "Resolve questions at the lowest possible level. Bubble up only questions that require the human operator's judgment, explicit approval, budget/scope/timeline commitment, client-facing risk acceptance, destructive or irreversible action, credential access, or resolution of same-rank authority conflict." This is the actual canonical checkpoint criteria — the closest existing analogue to a "turn" trigger.

## 4. bp-r's research-resolve operator-only triage list — instructional/skill surface, NOT canonical
`.claude/skills/bp-r/SKILL.md:22-28,50-60`. Corrected per G6 review: canonical rules are strictly `instructions/canonical/**` per this document's own opening definition; `.claude/skills/**` is a project-space skill surface with no independent canonical authority. Nearly identical list to (3): money, live/irreversible, scope & priority, secrets/PII, brand judgment. Confirms (3)'s canonical criteria is echoed at the skill layer — a candidate for the unification G2 tests, but the skill-layer copy carries no authority of its own; if it ever diverged from (3), (3) would be correct per the alias-authority law.

## 5. HarnessCapabilityPolicy/1.0 — canonical rule
`instructions/canonical/harness-capability-policy.yaml:2-37`. Correction per G6 review: `auto_apply:false` is set on every propagation class, but `review_required:true` is NOT universal — `command_surfaces` (`:14-18`) carries only `auto_apply:false` with no `review_required` field (it routes to a named mechanical repair script instead). The other four classes (`adapter_capabilities`, `package_scripts`, `tool_entrypoints`, `semantic_behavior`, `:19-38`) do carry both. Already reviewed in depth during the harness-propagation-doctrine convene — this is a checkpoint on cross-harness *propagation*, not operator communication.

## 6. ConveneReceipt gate on canonical writes — executable gate
`tools/verify/hooks/pre-write-convene-required.cjs:7-34,271-275`. Fail-closed hook: any write to `instructions/canonical/**` is mechanically blocked without a live ConveneReceipt/1.0 covering the path. Observed firing twice in this very session (attempted `sed`/sample writes near `harness-capability-policy.yaml` and `orchestrate-loop.yaml`) — direct historical evidence, not just policy text.

## 7. Custody-grant release-entry-point firewall — executable gate
`tools/kernel/hooks/lib/custody-grant-txn.cjs:28-31`; `tools/custody/README.md:102-106`. Quarantine release for orphaned reservations is a separate entry point from issuance: targeted-only, never AI-executable, never allowlisted. Correction per G6 review: the cited `README.md:102-106` range supports human-only, targeted-only, and never-allowlisted directly; the "immutable receipt" requirement was stated in this document without a supporting citation at that line range and should be treated as unverified until a specific citation is found, not asserted as fact. This remains the sharpest existing example of "the actor cannot self-authorize its own most-dangerous action" — directly analogous to the relay-integrity rule the world-minds chain proposed — independent of the unverified receipt detail.

## 8. Membrane law — canonical rule (invariant, not a checkpoint)
`instructions/canonical/kernel/doctrine.md:42-51` (CLAUDE.md "The repository/export membrane"). "The boundary does not move... The only approved place Mirror content is allowed to surface is a clearly labeled, advisory context payload handed to a session at its start — nowhere else, ever." Structurally different from (3)/(4)/(6)/(7): those are checkpoints (a gate that fires at a decision point); this is a standing prohibition with no fire/no-fire state. G2 must not treat it as a fifth checkpoint example.

## 9. Session/boundary-crossing machinery — executable + advisory mix
`/new-session`, `/shutdown`, `node tools/sessions/consume-boundary.cjs <scope>` (referenced in this session's own `/new-session` invocation earlier). Pending-boundary-scope consumption is explicitly scoped (loads only the selected scope's handoff, "does not consume or inject other pending scopes") — a bounded, single-purpose turn-boundary mechanism already in production use, observed firing in this session.

## Scope note (bounded, not exhaustive)

This inventory covers the 9 named surfaces above, identified from this session's own accumulated context and Codex's charter-level review citations (all verified real). It does not claim to be a complete repo sweep — other candidate mechanisms (e.g., the orchestrator-worker PreTool gate referenced in orchestrate-loop.yaml:25, review-iteration-ceiling routing at orchestrate-loop.yaml:26) exist and were noted but not fully classified here; a future pass could extend this list. No claim of completeness is made.
