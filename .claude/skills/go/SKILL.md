---
name: go
description: >
  "Just go" — execute a plan that has already been fully blueprinted by
  /plan-task and cleared distinct review. The addressed mind becomes the
  orchestrator, fans out one subagent per plan scope, tiers each dispatch down
  the dispatch-routing-rule altitude ladder — recursing into sub-scopes until
  the leaf work is deterministic — and as results fold back up, extracts any
  mechanical solution into a reusable tool before reporting the scope done.
  Ships ungated as a project skill wrapping /run-plan; adds no new gate.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
tags: [orchestration, execution, alias, dispatch-routing, tool-hardening]
---

<skill>
<objective>
Provide `/go [<plan-id-or-task-id>]` — the one-word trigger for "the blueprint is
done, now execute it." `/go` does not reimplement plan resolution, the distinct-review
gate, or closeout lanes: it rides the existing `/run-plan` machinery
(instructions/canonical/commands/run-plan.yaml) for all of that. What `/go` adds is a
specific execution *shape* for task-plan runs:

1. **Orchestrator claim** — whichever mind the operator addressed ("Claude, go" /
   "Codex, go" / a bare `/go`) becomes the orchestrator for this execution. The
   orchestrator resolves, delegates, verifies, integrates, and reports — it is not the
   default worker (orchestrate-loop's coordinator/worker boundary applies unchanged).
2. **Scope fan-out** — one subagent dispatch per plan scope (a `steps[]` entry from the
   resolved task plan, or a step's sub-scope when a step bundles more than one
   independent unit of work).
3. **Recursive tiering down to mechanical, across mind families** — each dispatch is
   tiered per `instructions/canonical/dispatch-routing-rule.yaml`'s altitude table AND
   routed across the full registered harness set
   (`tools/signals/lib/target-command-policy.cjs`: codex, claude, opencode,
   opencode-local, codewhale managed; gemini, openrouter, remote-ssh freeform) — not
   defaulted to same-family Claude subagents. Mechanical/recon lanes tier down to
   haiku-class; scopes touching PII or credentials route to local models
   (opencode-local — bytes stay on-device), which is the ONLY lane local models serve
   for now; the routing question at every dispatch is the canonical one: cheapest mind
   this lane's verification can hold accountable? If a scope's worker finds the work still contains in-flight judgment,
   it may recurse into its own sub-dispatches, tiering further down each time, until a
   leaf unit is small enough to be handled by a plain, pre-staged,
   mechanically-verifiable step — ideally a script invocation with no LLM in the loop
   at all (the dispatch-routing-rule's "hardening gradient").
4. **Continuous cross-checking, cascade-down / bubble-up** — this is the point of the
   shape, not an add-on: minds constantly check and recheck each other's work AS the
   build progresses. Work cascades DOWN (decomposing until leaves are mechanical) and
   results bubble UP only through review, at every level — nothing skips a level, and
   nothing is consumed by a sibling or parent without its receipt. At each fold the
   division is fixed: **the parent does the contract check and the integration; the
   trial of any acceptance-grade judgment lands on a distinct family — not the
   parent.** (Acceptance-grade judgment = any output whose correctness requires
   interpretive evaluation — a diagnosis, design choice, review, synthesis, or
   root-cause claim; contrast artifact-verifiable outputs — files, hashes, diffs,
   test results — which mechanical read-back covers.) Checks tier like everything else: artifact-verifiable leaves get a
   mechanical read-back (script/diff/hash — no LLM). A refuted result cascades back
   down as a new bounded dispatch; check → fix → recheck until clean, then it bubbles
   up one level and folds again at that altitude.
5. **Build tools on the way back up** — as a leaf scope's result returns to its parent,
   if the solution that worked was mechanical and repeatable (not a one-off judgment
   call), the dispatched worker writes it as a small script under the matching
   `tools/<domain>/` directory (or `tools/scoped/<plan-id>/` if no existing domain
   fits) before folding the result upward. The parent scope's report names any tool
   built underneath it. This means a plan that gets re-run, or a sibling scope that
   hits the same mechanical shape, increasingly needs no LLM at all — the recursion
   leaves the codebase a little more automated on every pass, not just the plan done.
6. **Synthesize and close out** — the orchestrator collects all scope results, verifies
   them against the plan's expected outcomes and gates, lists every tool built during
   the run, and routes through `/run-plan`'s existing closeout lanes (verify-local /
   codex-bridge / operator-gate). No new gate is introduced.
</objective>

<activation>
- Operator types `/go` or `/go <plan-id-or-task-id-or-path>` after a `/plan-task` plan
  exists.
- Operator addresses a specific mind and says "go" ("Claude, go" / "Codex, go") — that
  addressed mind is the orchestrator for this invocation.
- No plan-id given: resolve the most recently blueprinted plan from this session first;
  if ambiguous, list candidates and ask rather than guessing (same rule as
  `/run-plan`).
</activation>

<process>
<step name="resolve-and-gate-check" type="AUTO">
Resolve the target plan using the same shared resolver `/run-plan` uses
(`tools/planning/lib/resolve-task-plan.js`). Do not bypass the distinct-review gate
(`tools/kernel/hooks/userprompt-plan-review-gate.cjs`): if the plan has not cleared it,
stop and name the missing artifact (`/review-task-plan` or `/convene` for BIG plans) —
`/go` is for plans that have already finished blueprinting, not a shortcut around
review.
</step>

<step name="claim-orchestrator" type="AUTO">
Disclose which mind is acting as orchestrator for this run (dispatch-routing-rule's
disclose-per-dispatch rule applies to the orchestrator claim itself, not just
sub-dispatches). The orchestrator does not do scope-level implementation work directly
except genuinely trivial glue between subagent outputs.
</step>

<step name="fan-out-by-scope" type="AUTO">
Read the resolved plan's `steps[]`. For each step (or each independent sub-unit inside
a step that bundles more than one concern), dispatch one worker scoped to exactly that
unit of work. Route each dispatch by BOTH axes:

**Altitude tier** (dispatch-routing-rule altitude table; API minds by default):
- mechanical/extraction/recon -> haiku-class
- bounded light judgment -> sonnet-class
- genuine reasoning/synthesis/in-flight-judgment mutation -> frontier-class
- **PII/credential exception (operator policy 2026-08-04):** any scope whose payload
  touches PII, credentials, or secret values routes to a local model
  (opencode-local, Ollama-backed) so bytes stay on-device, regardless of altitude.
  This is currently the ONLY lane local models serve — they are not a general
  cost-tier substitute for API minds yet.

**Mind family** (harness registry, `tools/signals/lib/target-command-policy.cjs`):
- Do not default every lane to same-family Claude subagents — those are parallel
  contexts, not distinct intelligence. Spread scopes across the registered API
  harnesses where the lane's verification can hold that mind accountable.
- **No mind is pigeonholed to a role (operator ruling 2026-08-04).** Any registered
  mind — codex, gemini, Claude tiers, codewhale, hermes, pi — may fill any role
  (reader, coder, reviewer, recon, synthesis) when it is the best fit for that
  specific job. Touch all minds; use all harnesses (operator 2026-08-04) — a run
  that routes every lane to the same two harnesses out of habit is leaving
  registered intelligence idle. Assign
  by fit per dispatch, not by standing role-to-mind bindings. Known strengths are
  hints, not assignments (codex is strong on code, gemini on search/long-context
  reads), and standing constraints still bind: codewhale is PRC-hosted so
  non-sensitive payloads only; opencode-local for PII/credential-touching scopes per
  the exception above.
- Any scope whose output will be treated as review/verification of another scope's
  work MUST land on a distinct family from the producer (producer-never-validates-own-
  trial; same-model subagents do not satisfy it).

Disclose the mind, family, and tier at dispatch time for every scope. When a
non-Claude harness is the right lane, dispatch it via the managed bridge
(`/dispatch-bridge` against a registered command — never `codex exec --full-auto` or
an improvised freeform path); if the managed path is unavailable, report the lane
blocked rather than silently substituting a same-family Claude subagent at the same
tier — substitution is allowed but must be disclosed as a family downgrade in the
scope's report.
</step>

<step name="recurse-to-mechanical" type="AUTO">
A dispatched worker that discovers its scope is not actually a single unit of judgment
— it bundles further-decomposable sub-scopes — may itself become a mini-orchestrator
and recurse: fan out its own sub-dispatches, tiering further down each time. The
recursion terminates when a leaf scope is small enough to execute as a pre-staged,
mechanically-verifiable step (tested script + pinned inputs + read-back verification),
per the dispatch-routing-rule hardening gradient. Do not force recursion where a scope
is already a clean single unit — recursion is for genuinely bundled scopes only.
</step>

<step name="check-before-fold-up" type="AUTO">
The run's shape is a strict cascade-down / bubble-up: scopes decompose downward until
leaves are mechanical, and results only travel upward through review. At each fold the
division of labor is fixed: **the parent does the contract check and the integration;
the trial of any acceptance-grade judgment lands on a distinct family — not the
parent.** This holds at every level of the recursion — the orchestrator folds its
scope results, a mini-orchestrator folds its sub-dispatches, nothing skips a level.
Tier the check:
- **Artifact-verifiable output** (a file changed, a hash, a test run, a diff): a
  mechanical read-back verifies it — script, grep, hash comparison, re-run — no LLM.
  The orchestrator may perform mechanical read-backs itself ONLY within this bound:
  the expected observation is stated before the check runs, and the check is a
  non-branching read (a grep/diff/hash/single command) against it. Anything that
  requires interpreting what came back, choosing between explanations, or more than
  a read — that is scope work or judgment, and it dispatches. Reclassifying scope
  work as "verification glue" is the boundary violation this bound exists to block.
- **Judgment output** (a diagnosis, a design choice, a review, a synthesis): the
  division at each fold is fixed — **the parent does the contract check and the
  integration; the trial of any acceptance-grade judgment lands on a distinct
  family — not the parent.** The parent verifies the child met its dispatch contract
  (scope honored, artifacts present, claims backed) and integrates the result into
  its own scope; it never serves as the trial of judgment it commissioned, because
  its framing shaped that work. Same-model parallel contexts do not satisfy
  distinctness.
The review happens AT the fold-up, per scope, as the build progresses — not batched
into one review at the end. A scope result without its review receipt is "written,
not verified" and must not bubble further up or be built upon by a sibling. When a
review refutes a result, the refuting finding cascades back DOWN to the producing
scope (or a fresh producer) as a new bounded dispatch — check → fix → recheck until
the receipt is clean, then the result bubbles up one level and the scope above
reviews again at its own altitude.
</step>

<step name="build-tools-on-return" type="AUTO">
A leaf solution earns a tool when it meets ALL THREE observable criteria: (a) fully
mechanical — no LLM judgment anywhere in the solution path; (b) parametrizable — its
inputs abstract cleanly to arguments; (c) demanded again — another scope in the
CURRENT plan (or an already-registered follow-on) has an identical or structurally
similar step. When all three hold, the worker that solved it writes the
solution as a small, runnable script under the matching `tools/<domain>/` directory
(or `tools/scoped/<plan-id>/` when no existing domain fits) before returning its result
to the parent. This is scoped to the single plan/step at hand — it is NOT the
`reusable-template-extractor`'s (.claude/agents/reusable-template-extractor.md)
POST-RUN, >=3-verified-runs template-hardening pass, and does not claim that rank. Record the tool's path and what it replaces (a future
identical scope calling this script instead of a fresh LLM dispatch) in the scope's
returned report. If nothing about the solution is repeatable, return the result with no
tool artifact — do not manufacture a script for a genuinely one-off judgment call.
</step>

<step name="synthesize-and-closeout" type="AUTO">
The orchestrator collects every scope's result (including any tools built underneath
it), verifies the aggregate against the plan's expected outcomes and gates, and routes
the run through the existing `/run-plan` closeout lanes: verify-local, codex-bridge, or
operator-gate, per the plan's `review_lane` and actual observed execution risk —
observed risk means what the run actually touched: surfaces mutated
(repo-local vs staging/production/VM), credentials exercised, browser-admin or
external accounts involved, and whether any mutation required in-flight judgment
(trust actual risk over stated metadata if they diverge, per run-plan's routing
rules). Report
the closeout route taken, all scope results, and the full list of tools built.
</step>
</process>

<execution_rules>
<rule id="rides-run-plan-gate">[INVARIANT] — `/go` never bypasses the distinct-review gate or the closeout-lane routing that `/run-plan` already enforces. It is a specific execution shape layered on top, not a replacement.</rule>
<rule id="orchestrator-not-default-worker">[PROTOCOL] — The orchestrator resolves, delegates, verifies, integrates, reports. It does not silently become a scope-implementing worker after delegation was selected (orchestrate-loop coordinator/worker boundary applies unchanged).</rule>
<rule id="disclose-per-dispatch">[PROTOCOL] — Every dispatch (orchestrator claim, each scope fan-out, each recursive sub-dispatch) discloses the mind, tier, and recursion depth (e.g. "depth 2 under scope S1") at dispatch time, so the fold-up chain stays traceable.</rule>
<rule id="recurse-only-when-bundled">[PROTOCOL] — Recursion into sub-dispatches is for scopes that genuinely bundle multiple units of judgment. A clean single-unit scope executes directly at its assigned tier; forcing recursion on it is waste, not rigor.</rule>
<rule id="review-at-every-fold-up">[INVARIANT] — Cascade down, bubble up. At each fold: the parent does the contract check and the integration; the trial of any acceptance-grade judgment lands on a distinct family — not the parent. Artifact-verifiable results get mechanical read-back; nothing bubbles further or is consumed by a sibling without its receipt, at every recursion level. No batched end-of-run review substitutes for per-fold-up review; a result without its receipt is "written, not verified".</rule>
<rule id="tools-only-when-repeatable">[PROTOCOL] — A tool is built on the way back only when the solved leaf is mechanical and repeatable. One-off judgment calls return a result with no tool artifact; manufacturing scripts for non-repeatable work is scope creep.</rule>
<rule id="scoped-not-graduated">[PROTOCOL] — Tools built during a `/go` run are scoped hardening for the single plan/step at hand. They do not carry the `reusable-template-extractor`'s POST-RUN, evidence-gated template rank; that graduation still requires >=3 verified successful full-cycle runs and its own explicit pass.</rule>
<rule id="ungated-surface">[PROTOCOL] — `/go` is a user/project-space wrapper. It does not require registration in the governance-gated canonical alias registry and never writes to `instructions/canonical/**`.</rule>
<rule id="no-new-gate">[PROTOCOL] — `/go` introduces no new blocking hook; it rides `/run-plan`'s existing distinct-review and closeout-lane gates exactly as they already exist.</rule>
</execution_rules>

<inputs>
<required>
None — with no argument, `/go` resolves the most recently blueprinted plan from this
session.
</required>
<optional>
<input name="<plan-id-or-task-id-or-path>">Explicit plan to execute, resolved via the shared task-plan resolver.</input>
<input name="orchestrator=<mind>">Override which mind claims the orchestrator role (default: whichever mind was addressed).</input>
</optional>
</inputs>

<outputs>
<output name="scope-results">Per-scope results from the fan-out, including any recursive sub-dispatch results folded upward.</output>
<output name="tools-built">List of tool paths built during the run, each naming what future-repeat work it replaces.</output>
<output name="closeout">The `/run-plan` closeout lane taken (verify-local / codex-bridge / operator-gate) with its evidence artifact.</output>
</outputs>

<success_criteria>
- The plan was resolved and its distinct-review gate was already satisfied (or `/go`
  stopped and named the missing artifact rather than bypassing it).
- The orchestrator was disclosed and did not silently absorb worker-level scope work.
- Every scope dispatch, at every recursion depth, disclosed its mind and altitude tier.
- Recursion happened only where a scope genuinely bundled multiple judgment units.
- Tools were built only for repeatable mechanical leaves, each named with what it
  replaces; no tools were manufactured for one-off judgment calls.
- The run closed out through an existing `/run-plan` lane with real evidence, and the
  full list of tools built was reported alongside the scope results.
</success_criteria>

<boundaries>
- Does NOT replace `/plan-task`, `/review-task-plan`, or `/run-plan` — it wraps
  `/run-plan`'s task-plan execution path with a specific fan-out/recursion/tool-build
  shape.
- Does NOT skip the distinct-review gate or invent a closeout lane outside
  verify-local/codex-bridge/operator-gate.
- Does NOT perform the `reusable-template-extractor`'s POST-RUN template-graduation
  pass — tool-building here is single-run scoped hardening, not framework promotion.
- Does NOT write to `instructions/canonical/**` — `/go` lives in ungated project space.
</boundaries>
</skill>
