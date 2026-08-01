---
name: orchestrate
description: >
  Native-first orchestration process skill. Teaches Claude how to choose an
  execution shape (single-threaded, delegated Claude workers, Codex bridge
  lane, or combination), how to route through Mythos native commands and
  skills rather than replacing them, and how to coordinate through durable
  artifacts while preserving native hooks. Invoked before starting any task
  that might need more than one actor, parallelization, independent
  verification, or that touches multiple surfaces.
version: 1.0.0
execution_mode: REVIEW_ONLY
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Mythos native commands, native skills, native systems, and native hooks are the primary control plane. Everything else is subordinate substrate.
</prime_directive>

<objective>
Teach Claude how to orchestrate work in this repo: pick an execution shape, route first through native Mythos commands and skills, open bounded delegated workers only when native routing cannot cover the shape, use the codex bridge as a bounded cross-intelligence lane when warranted, and close every loop through durable artifacts while preserving native hooks. This is a process skill, not a domain skill.
</objective>

<quick_start>
When invoked for a non-trivial task, execute these four setup actions in order BEFORE committing to an execution shape, opening any worker terminal, or shipping any bridge prompt. The full orchestration loop continues in `<process>` below:

1. **Answer the five-question execution-shape rubric** ([references/execution-shape-rubric.md](references/execution-shape-rubric.md)) and state the shape explicitly in plain text: *"Execution shape: orchestrator + 2 Claude workers + Codex bridge."*
2. **Identify which native commands own each stage** of the chosen shape ([references/native-command-rubric.md](references/native-command-rubric.md)) — plan to invoke them rather than duplicate their logic.
3. **Write the actor identity list**: orchestrator Claude, any worker Claude terminals (numbered, with model), Codex agent if in the loop, human operator decision points.
4. **Choose where durable coordination will live** — prefer (a) native commands, then (b) task plan, then (c) HandoffSignal/1.0, then (d) worker packet, then (e) bridge prompt. Never chat memory.

Only after these four are done should any worker terminal open or any bridge prompt ship.
</quick_start>

<arc_state_check>
At turn boundaries, check arc state before inventing continuation:
- `/arc-status` is the first read when the current workstream already has actor-arc tracking.
- `/arc-rest`, `/arc-blocked`, and `/arc-complete` are explicit transition surfaces. Do not silently mutate lifecycle state in chat.
- If no arc exists yet, route through the owning plan, signal, or operator authorization surface first rather than pretending the current thread is self-authorizing.
</arc_state_check>

<activation>
Use BEFORE starting any task that:
- might need more than one actor
- could be parallelized across files, surfaces, or clients
- has unclear scope, risk, or verification needs
- touches a launch-critical, credential-bearing, or production-facing surface
- would benefit from independent cross-intelligence review

If the task is a single small edit with clear scope and low risk, skip this skill and just do the work.
</activation>

<native_first_principle>
Before inventing any orchestration behavior, route through existing native surfaces in this order:

1. **Native commands** — if a native command already owns the action, invoke it. Do not hand-roll what `/plan-task`, `/run-plan`, `/execute-plan`, `/follow-signal`, `/review-progress`, `/amend-plan`, `/debrief-run`, or `/normalize-signals` already do. See [references/native-command-rubric.md](references/native-command-rubric.md).

2. **Native skills** — if an existing skill owns the lane (`plan-task`, `execute-framework`, `clean-house`, `extract-skill`, `manage-frameworks`), defer to it or compose with it. Do not replace it. See [references/native-skill-composition.md](references/native-skill-composition.md).

3. **Native signal and bridge machinery** — HandoffSignal/1.0, the codex-bridge, watch-landing-pad, watch-codex-bridge, and the launchd runners are the repo's truth surface for cross-actor handoff. Route through them, do not parallel them.
   Recursive child-routing policy lives in [references/recursive-actor-routing.md](references/recursive-actor-routing.md).

4. **Native hooks and lifecycle surfaces** — `.claude/settings.json` hooks, `tools/verify/*.cjs`, `tools/framework-lifecycle/hook-runner.js`, and visual-review-gate enforce the governance model. See [references/hook-preservation.md](references/hook-preservation.md).

Only after these four layers are exhausted should the orchestrator reach for worker packets, ad-hoc bridge prompts, or direct tool calls.
</native_first_principle>

<the_four_execution_shapes>
1. **orchestrator + delegated workers + Codex bridge** — workers partition the surfaces, and a Codex review/audit lane verifies the integrated result through the native bridge.
2. **orchestrator + Codex bridge only** — orchestrator does the writes itself but routes verification or design-critique to Codex via the bridge.
3. **orchestrator + bounded delegated workers** — orchestrator partitions work into bounded packets and opens delegated Claude worker terminals. Orchestrator reintegrates through native verify + review surfaces without a bridge lane.
4. **single-threaded** — orchestrator Claude does all the work alone, routed through native commands where applicable. No delegation, no bridge. This is the documented exception, not the default.

Decision rubric and examples: [references/execution-shape-rubric.md](references/execution-shape-rubric.md). The numbering here matches the distribution-first rubric ordering in that file. State the chosen shape explicitly before any delegation: *"Execution shape: orchestrator + 2 Claude workers + Codex bridge."*
</the_four_execution_shapes>

<actor_identity>
**Mandatory.** Every coordination artifact names the actor explicitly:
- **orchestrator Claude** — this Claude agent, this session
- **worker Claude (terminal N)** — a delegated Claude agent in another terminal/session
- **Codex agent** — Codex CLI invoked via the codex-bridge
- **human operator** — {OPERATOR_NAME}, the only non-AI actor

Never collapse identities. A delegated worker's output is not the human operator's word. A bridge response is not the orchestrator's own conclusion. Per `instructions/canonical/` actor-naming rule, ambiguous role terms must be replaced with explicit named actors before any artifact is written.
</actor_identity>

<dispatch_model_routing>
Per `instructions/canonical/dispatch-routing-rule.yaml` (advisory; operator-ratified 2026-06-10):
- **Disclose the mind at every dispatch** — name model + role at dispatch time ("haiku — mechanical", "codex GPT-5.5 — distinct review"). Same-model Claude subagents are parallel contexts, NOT distinct intelligence; never present one as cross-verification.
- **Tier by work altitude**: mechanical/extraction/recon → Haiku; bounded light judgment → Sonnet; genuine reasoning/creative/synthesis/live-mutation → frontier. Lower the tier when output is artifact-verifiable; raise it when the lane's judgment IS the deliverable.
- **Route across harnesses, not just Claude subagents**: registered actor set per `tools/signals/lib/target-command-policy.cjs` (codex GPT-5.5, gemini, openrouter, opencode, opencode-local = Ollama-backed local: qwen2.5-coder:14b, deepseek-r1:14b, qwen3:4b, gemma4:31b). Mechanical lanes should consider local coding agents; credential-adjacent work prefers opencode-local. At every dispatch ask: cheapest mind this lane's verification can hold accountable?
</dispatch_model_routing>

<durable_coordination>
Coordination state lives in artifacts on disk, never in chat memory. In priority order:

1. **Native commands** — the preferred durable coordination surface. `/run-plan` and `/execute-plan` write signals. `/follow-signal` consumes them. `/amend-plan` records divergence. `/debrief-run` produces closeout evidence. Use them.
2. **Task plan** — JSON in `_dev/reports/analysis/task-plans/`, schema at `tools/planning/task-intake.schema.json`. Defines scope, gates, `risk_tier`, `review_lane`.
3. **HandoffSignal/1.0** — authority artifact that authorizes exactly one next actor and one exact next command. Schema in `tools/verify/lib/signal.cjs`. Written under `_dev/reports/signals/`.
4. **Worker packet** — bounded delegation contract, ONLY when command-level routing is insufficient. See [references/worker-packet-contract.md](references/worker-packet-contract.md). Lives at `_dev/reports/analysis/worker-packets/`.
5. **Bridge prompt** — Codex (or other distinct-intelligence) review artifact built via `tools/signals/lib/bridge-prompt-body.js` (depth profiles: light/review/full) or via the `/dispatch-bridge` runner. Prompt body lands at `_dev/reports/analysis/codex-bridge-prompt__{scope}.md` (legacy codex-bridge path) or `_dev/reports/analysis/dispatch-bridge-prompt__{scope}.md` (new dispatch-bridge path). The paired HandoffSignal lands under `_dev/reports/signals/`. See [references/bridge-lifecycle.md](references/bridge-lifecycle.md).

If a coordination decision exists only in chat, it does not exist. Write the artifact, through a native command when one fits.
</durable_coordination>

<reintegration_and_verification>
Worker self-reports are NEVER sole completion evidence.

Every delegated worker output requires, in order:
1. **Reintegration** — orchestrator reads the worker's actual artifacts (files written, diffs, output paths), not its summary message.
2. **Independent verification** — run a native verify entry point (`tools/verify/verify-system.cjs`, `verify-framework.cjs`, `verify-skill.cjs`, `verify-run-evidence.cjs`, as applicable), or dispatch an Explore subagent, or invoke the codex-bridge. The verifier must be a different actor than the worker.
3. **Native review** — for system-level closeouts, route through `/review-progress` before declaring complete.
4. **Native closeout** — `/debrief-run` is mandatory closeout evidence before declaring a run complete. Memory: `feedback_mandatory_verification`, `feedback_verification_before_confidence`.

Never skip the native verify/review/debrief surfaces in the name of speed.
</reintegration_and_verification>

<truthful_closeout>
Every orchestration loop ends with a `HandoffSignal/1.0` written to disk. The schema at `tools/verify/lib/signal.cjs` allows only:

- **`signal_type`** ∈ `{ cycle-complete, ready-for-review, blocked, ready-for-clear }`
- **`lifecycle_state`** ∈ `{ live, closed }`

Map the English-language outcome of a cycle to the schema as follows:

- **Work shipped, independently verified, debrief produced** → `signal_type: cycle-complete`, `lifecycle_state: closed`. Cite the verification artifact and the debrief path in `decision_context_artifacts[]`.
- **Work ready for a different intelligence to review** → `signal_type: ready-for-review`, `lifecycle_state: live`. Name the review lane and the expected reviewer. The signal stays live until the review is consumed.
- **External impediment blocks the loop** (credential, human decision, third-party) → `signal_type: blocked`, `lifecycle_state: live`. Name the blocker in `blocked_by[]`. Set `recommended_next_actor` to whoever can unblock.
- **Loop requires explicit human acceptance to clear** → `signal_type: ready-for-clear`, `lifecycle_state: live`. After acknowledgment, flip `lifecycle_state` to `closed`.

**Supersession and repair are NOT signal types.** They are repair actions that operate on existing signals, defined in `instructions/canonical/contracts/repair-semantics.yaml`:

- **Supersede** — close the prior signal (`lifecycle_state: closed` with reason), write a new signal for the superseding approach.
- **Reopen** — write a new signal referencing a previously closed one, stating the reopen rationale.
- **Correct / repair-note** — add a correction to an existing live signal without closing it.

Never silently drop a loop. Never claim `cycle-complete` without citing the verification artifact and the debrief. Never use "superseded" or "repair needed" as a `signal_type` — those strings are not in the enum and writing them will fail `signal.cjs` validation.
</truthful_closeout>

<hook_preservation>
Native hooks exist because they enforce the governance model. The orchestrator must not bypass them for speed, convenience, or to route around a failing check.

Active hook surfaces (full list in [references/hook-preservation.md](references/hook-preservation.md)):
- **SessionStart** — credential verification before the session proceeds
- **PreToolUse Agent** — subagent guardrail reminder (no recursive spawning)
- **PreToolUse Bash** — dangerous command detector + git-commit debrief reminder
- **PreToolUse EnterPlanMode** — routing-document policy reminder
- **PostToolUse Write|Edit** — framework manifest sync + task-plan / delegation advisory hooks
- **PostToolUse Write** — visual-review-gate
- **Stop** — debrief suggestion when planning work has no matching closeout
- **UserPromptSubmit** — `/run-plan` vs `/execute-plan` verb guard

Doctrine: *"hooks may validate, refresh, and report — hooks must not silently promote."* This skill is the portable authority for that rule. The inverse is also binding: **orchestrators must not silently bypass**. If a hook blocks an action, diagnose the underlying cause rather than routing around it.
</hook_preservation>

<health_and_audit>
Canonical health/quality entry points — use the selector matrix below rather than running every auditor or guessing.

| If the closeout touched... | Run this |
|---|---|
| A skill file (`.claude/skills/*/SKILL.md` or references) | `taches-cc-resources:skill-auditor` |
| A slash command file | `taches-cc-resources:slash-command-auditor` |
| A subagent definition | `taches-cc-resources:subagent-auditor` |
| A framework (`frameworks/*/`) | `framework-auditor` subagent |
| `.claude/` setup, CLAUDE.md, or guardrails | `/audit-project-config` |
| Nothing structural, just work artifacts | `completion-auditor` subagent (acceptance-criteria check) |
| Code integrity at any layer | `tools/verify/*.cjs` (system / framework / skill / kernel / run-evidence) |

Run the relevant auditor BEFORE promoting a worker output and BEFORE closing a loop as `complete`. The verify scripts can always run — they are cheap and their `VerificationSignal/1.0` output belongs in the closing HandoffSignal.
</health_and_audit>

<process>
<step name="assess-task-shape">
Answer the rubric in [references/execution-shape-rubric.md](references/execution-shape-rubric.md):
1. Is there already a task plan? If yes, honor its `risk_tier` and `review_lane`.
2. Is the work partitionable into bounded surfaces with clear ownership boundaries?
3. Does any partition need a different actor's perspective (Codex review, verify lane)?
4. Is independent verification required (launch-critical, production, credential)?
5. Is parallel speed worth the coordination cost?

State the chosen shape in plain text before writing any artifacts.
</step>

<step name="route-through-native-commands-first">
For the chosen shape, identify which native commands already own pieces of the flow (see [references/native-command-rubric.md](references/native-command-rubric.md)):
- Planning → `/plan-task`
- Starting execution → `/run-plan` (routes to `/execute-plan` or direct runner)
- Advancing a multi-stage plan → `/execute-plan`
- Mid-run evidence check → `/review-progress`
- Scope divergence → `/amend-plan`
- Authority handoff → `/follow-signal`
- Run closeout → `/debrief-run`
- Signal surface hygiene → `/normalize-signals`

Invoke the native command rather than duplicating its logic. If you are about to hand-roll behavior that a native command already owns, stop and route through the command instead.
</step>

<step name="ground-in-actor-identity">
Before writing any packet, signal, or bridge prompt, write down:
- who the orchestrator is (this Claude agent)
- who each worker is (terminal id, model, scope owner)
- whether Codex is in the loop and on which lane
- where the human operator's decision points are

This list goes into the task plan or the top of the orchestration scratch artifact. It prevents identity collapse downstream.
</step>

<step name="write-worker-packets-only-when-needed">
Worker packets are not the default. Write a packet only when:
- the chosen shape is #1 or #3 AND
- no native command can cover the delegated scope AND
- the delegation is durable enough to need a disk artifact

For each packet, use [references/worker-packet-contract.md](references/worker-packet-contract.md). Packets live at `_dev/reports/analysis/worker-packets/{plan-id}__{worker-id}.md`. The delegated worker reads its packet first on startup. The orchestrator reads the packet again on reintegration.
</step>

<step name="open-bridge-lane-if-needed">
For shapes 1 and 2: follow [references/bridge-lifecycle.md](references/bridge-lifecycle.md) to construct the bridge prompt at the right depth profile (light/review/full). Two runner lanes are available:

- **Legacy codex-bridge lane** — invoked via `node tools/signals/run-codex-bridge.js --file <signal-file>`. The prompt body is written to `_dev/reports/analysis/codex-bridge-prompt__{scope}.md`; the paired HandoffSignal is written under `_dev/reports/signals/`.
- **New dispatch-bridge lane** — invoked via the `/dispatch-bridge` slash command (or `node tools/signals/dispatch-bridge.js --target <actor> --task "..." --command "/..."`). Writes the prompt body to `_dev/reports/analysis/dispatch-bridge-prompt__{scope}.md` and a `dispatch-bridge__{stamp}__{scope}.signal.json` under `_dev/reports/signals/`. Pass `--run-now` only when the target has a synchronous runner.

In both lanes, consume the returning HandoffSignal through `/follow-signal <signal-scope|--file path> --execute` rather than reading the runner's stdout. The returned signal itself must carry the downstream leaf command to run; it must not point back to `/follow-signal`. The bridge is a bounded subordinate lane, not the whole orchestration model. It reviews or critiques; it does not own the writes unless the chosen shape is #2 and the orchestrator explicitly delegated only verification.
</step>

<step name="reintegrate-and-verify">
When workers or bridge return:
1. Read each actor's artifacts directly. Do not paraphrase summaries into `complete` claims.
2. Run the relevant native verify script (`tools/verify/*.cjs`) and record the VerificationSignal output.
3. Run `/review-progress` if the work is mid-run or the scope is non-trivial.
4. Spawn an independent Explore subagent verifier if the verify scripts cannot cover the claim.

If verification fails, do NOT close the loop as `cycle-complete`. Instead, either (a) keep the existing signal `live` and add a repair-note via the supersession/repair-note semantics described in `<truthful_closeout>` above, (b) close the existing signal with `lifecycle_state: closed` and a reason, then write a new `signal_type: ready-for-review` (or `blocked`) signal pointing at the repair work, or (c) `/amend-plan` if scope diverged. The string `repair needed` is NOT a valid `signal_type` and writing it will fail `signal.cjs` validation. Write a follow-up worker packet or re-route through the native command chain.
</step>

<step name="check-yoself">
**Mandatory.** Every cycle, before closeout, route the integrated result through a different intelligence than whoever produced it. This step satisfies canonical Discipline #1 (Cross-Verification Law). Self-review by the orchestrator does NOT satisfy this step — re-reading own output is the failure mode the law was written to prevent.

Routing:
1. **Identify the producer lane** — was the work produced by orchestrator Claude alone, by delegated workers, by Codex through the bridge, or by a mix? The verifier must be a DIFFERENT lane.
2. **Pick the verifier** using [references/check-yoself-routing.md](references/check-yoself-routing.md). Default order: try Tier 1 (local Ollama — Qwen / Gemma 4) first for mechanical/syntax checks; escalate to Tier 2.5 (Codex CLI bridge) for architectural/decision-grade checks; escalate to Tier 2/3 (browser/API frontier models) only when the cheaper lanes cannot honestly cover the check.
3. **Invoke the verifier** through the native lane: `/dispatch-bridge` for cross-actor handoff, `tools/signals/run-codex-bridge.js` for the legacy Codex review path, `tools/ai-bridge/adapters/ollama.js` for local model checks, or an Explore subagent ONLY as a structural-audit complement to a real cross-intelligence check (subagents of the same provider do NOT satisfy the law on their own).
4. **Wait for the return signal** and consume it via `/follow-signal <signal-scope|--file path> --execute`. Do not paraphrase the verifier's findings into the orchestrator's own words — attribute explicitly: "Codex agent reported X" not "Findings are X".
5. **If no different-intelligence lane is available**, inspect `_dev/reports/analysis/operator-continuity-state.json` when it exists before writing the blocked state. Then write a `HandoffSignal/1.0` with `signal_type: blocked`, `lifecycle_state: live`, `blocked_by: "no available cross-verification lane for check-yoself"`, and `recommended_next_actor: operator`. If the continuity artifact says the operator is unavailable or overloaded, cite that artifact in `decision_context_artifacts[]` and pause at the gate rather than silently looping or falling back to self-review.
6. **Auto-fix only LOW / simple findings** without asking; for any non-trivial finding, escalate to the operator before fixing (memory: `feedback_autonomous_low_findings`).

This step is structural, not optional. Skipping it converts the entire cycle into theatre — the closeout signal would claim cross-verification on a self-review, which is a truthfulness breach. If the cycle is too small to warrant cross-verification, it is also too small to require the orchestrate skill — exit through shape #4 (single-threaded) with the explicit one-line justification per [references/execution-shape-rubric.md](references/execution-shape-rubric.md).
</step>

<step name="close-the-loop-through-native-surfaces">
Run `/debrief-run` to produce mandatory closeout evidence.

Write a HandoffSignal/1.0 to `_dev/reports/signals/` with:
- `signal_type`: one of `cycle-complete | ready-for-review | blocked | ready-for-clear` (enum source: `tools/verify/lib/signal.cjs`)
- `lifecycle_state`: `closed` if the loop is terminal for this run (`cycle-complete` or resolved `ready-for-clear`); `live` if another actor still needs to act (`ready-for-review`, `blocked`, unresolved `ready-for-clear`)
- `artifacts[]` listing actual work outputs
- `decision_context_artifacts[]` listing verification evidence AND the debrief path
- `validation.ran` true/false with summary
- `recommended_next_actor` / `recommended_next_command` if not terminal

Run `/normalize-signals` periodically to keep the live signal surface clean.

Run the relevant auditor from `<health_and_audit>` if the closeout touches a skill/command/subagent/framework artifact.
</step>
</process>

<output_artifacts>
Native-command-produced (preferred):
- Task plan: `_dev/reports/analysis/task-plans/{plan-id}__plan.json` (via `/plan-task`)
- Debrief: `_dev/reports/analysis/run-debrief__{slice}.*` (via `/debrief-run`)
- Plan amendment: `_dev/reports/analysis/amendments/` (via `/amend-plan`)
- Closing signal: `_dev/reports/signals/{plan-id}__{closeout}.signal.json` (via execution chain)

Orchestration-produced (only when native routing is insufficient):
- Worker packet: `_dev/reports/analysis/worker-packets/{plan-id}__{worker-id}.md`
- Bridge prompt (legacy codex-bridge lane): `_dev/reports/analysis/codex-bridge-prompt__{scope}.md`
- Bridge prompt (new dispatch-bridge lane): `_dev/reports/analysis/dispatch-bridge-prompt__{scope}.md` paired with `_dev/reports/signals/dispatch-bridge__{stamp}__{scope}.signal.json`
</output_artifacts>

<success_criteria>
- Execution shape was named explicitly before any delegation
- Native-command routing was attempted for every stage before hand-rolling
- Actor identity list was written before any worker terminal opened
- Every delegated worker had a packet on disk before launch (when shape required packets)
- Worker outputs were reintegrated by reading actual artifacts, not summaries
- Native verify scripts ran and their output is cited in the closing signal
- A `check-yoself` cycle was performed by a different intelligence than the producer (Cross-Verification Law) and is cited in the closing signal — orchestrator self-review does NOT satisfy this criterion
- `/debrief-run` produced closeout evidence before declaring `complete`
- Closeout state is one of the four truthful states, recorded in a HandoffSignal/1.0
- Relevant auditor (skill / slash-command / subagent / framework / completion / project-config) was run when the closeout touched its surface
- No native hook was bypassed
</success_criteria>

<boundaries>
- Does NOT define what work to do — `/plan-task` and frameworks own that
- Does NOT execute writes itself beyond orchestration artifacts (packets, signals, bridge prompts) and signals written via native commands
- Does NOT trust worker self-reports as completion evidence
- Does NOT collapse actor identity; ambiguous role terms must be replaced with named actors
- Does NOT widen scope silently — if reintegration reveals new scope, route through `/amend-plan` or write a new task plan

(Native-command routing, native-skill composition, and hook preservation are covered in `<native_first_principle>` and `<hook_preservation>` above — not restated here.)
</boundaries>
</skill>
