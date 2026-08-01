---
description: Execute the next incomplete stage from a compatible prompt plan
mode: COORDINATOR
---

<objective>
Resolve a compatible prompt plan, list available plans when asked, or execute the first incomplete stage from the chosen plan using the standard build-verify-gate pattern.
</objective>

<process>
- Read _dev/prompts/prompt-plan-registry.json and _dev/policies/plan-contract.md first.
- If the argument is empty or 'list', return the available compatible prompt plans with id, title, path, status, and short description. Do not execute anything.
- If the argument is 'master', resolve _dev/prompts/claude-master-run-order.md.
- If the argument matches a plan id in the registry, resolve that plan path.
- If the argument is a path, use that path directly.
- Before executing, verify the resolved plan satisfies the minimum plan contract: ordered stages, observable exit criteria, prompt or workflow references where applicable, and a status surface.
- Parse every stage and cross-cutting track from the resolved plan.
- For each stage in order, check whether completion criteria are already satisfied by inspecting actual repo state (file existence, script availability, test results, evidence artifacts).
- Minimize main-thread context. The main thread should read only the source-of-truth files needed to frame the stage, issue bounded instructions, synthesize findings, and make go/no-go decisions.
- For any substantial multi-file or multi-surface stage, delegate the implementation, research, and validation work to bounded subagents or workers with explicit scopes instead of doing all detailed work on the main thread.
- When subagents are used, require a split of responsibilities: the implementation worker owns only its declared write scope, read-only research subagents gather independent evidence, and an independent read-only validator verifies the result before gate check.
- Before launching any write-capable or credential-dependent subagent, run a preflight: prove the write scope with a tiny disposable write, prove required credential paths are readable, and fail fast if either check fails.
- Do not source broad .env files inside subagents when a targeted extraction is sufficient. Extract only the exact variable needed and pass it via a temp file or explicit argument.
- For browser-authenticated work, prefer the proven authenticated session unless a fresh subagent session has explicitly demonstrated equivalent access.
- Execute the first stage that is NOT complete using the seven-step orchestration pattern: Plan, Build, Verify, Fix if needed, Lessons Capture, Codex Review, Gate check and status update.
- The verify step is mandatory. Build self-reports are insufficient evidence of completion.
- The validator must not be the same subagent or worker that performed the implementation for the stage.
- If the executed stage claims lessons were captured, an improvement was made, or a follow-on hardening action is now implied, treat that as an evidence claim, not narrative. Verify the exact durable artifact or verification change exists before closing the stage.
- Strict lessons validation: do not accept 'lessons captured' unless the relevant same-day session-learnings__*.md or lessons-reconciliation__*.md and matching expectation-failures JSON exist when the stage scope requires them, and the claimed lesson or improvement is materially reflected there.
- Strict improvement validation: do not accept 'improved' or 'hardened' unless the changed command/spec/code/guardrail/test files exist on disk and the exact validation command or test that proves the improvement was run and recorded in the stage report.
- Rolling lessons capture: every ~3 substantive orchestration steps (subagent launches, major file writes, validation runs), and on blocker, stage transition, explicit operator correction, or surprising success, append an observation to the session learnings artifact. Use the existing session-learnings__*.md pattern. Each entry should include: timestamp, observation, category (spec_gap, prompt_gap, review_gap, process_gap, validation_gap, operator_friction, useful_pattern, contradiction, world_feedback), evidence refs, and likely_reusable (yes/no/unknown). This is append-only logging, not evaluation.
- If the verify step finds failures, attempt a fix cycle. If the stage fails after 2 fix cycles, stop and report the blocker with expectation-failure artifacts.
- ALWAYS write BOTH verification artifacts for every executed stage, even when all acceptance criteria pass.
- ALWAYS publish a live HandoffSignal/1.0 targeting Codex for final review after every executed stage. Generate the bridge prompt via npm run signals:codex-bridge. Start the managed Codex listener via npm run signals:watch:codex:start. This is mandatory, not conditional.
- If a Codex auto-feedback loop is intended, start the managed 5-minute listener at the beginning of that handoff via npm run signals:watch:codex:start before reporting auto-run active. Record or reference the listener status artifact.
- If Codex is unavailable or the next step cannot actually be handed to Codex, do not leave an implied Codex dependency. Surface the decision as an operator or claude handoff with the exact next command and artifacts, or stop at a human gate.
- Any signal emitted from execute-plan must satisfy strict dispatch requirements: non-empty recommended_next_actor, non-empty recommended_next_command, and a non-empty artifacts array of real on-disk paths.
- Codex handoff truthfulness is evidence-based. Claude may report only one of these states: handoff prepared (live codex-targeted HandoffSignal/1.0 plus codex-bridge prompt artifact exist), auto-run active (there is explicit evidence that npm run signals:watch:codex or equivalent was launched and is still intended to be relied on), or feedback received (a codex-authored follow-up signal plus codex-cli-run completion artifacts exist).
- Do not claim the Codex listener loop is live merely because a signal was published and a prompt was written. If only the handoff is prepared, tell the operator the exact next command to launch Codex manually or start the watcher.
- Do not stop at handoff_prepared when the managed bridge runner is available. Dispatch automatically or report explicit blocked state with exact blocker and retry path.
- Before lessons reconciliation or other closeout tasks that end the Codex-dependent slice, stop the managed listener via npm run signals:watch:codex:stop unless another still-live codex-targeted scope explicitly requires it to remain active.
- Before emitting ready_for_clear or declaring the stage complete, invoke the debrief step: the main thread produces a short run-debrief assessment consuming the accumulated session learnings and run artifacts. The debrief must output an improve-plan (0-3 items: specific changes to prompts, specs, processes) and a replicate-plan (0-3 items: patterns worth spreading to other frameworks/clients). 'No lesson' is a valid output — do not invent findings. Block ready_for_clear until debrief artifacts exist for meaningful runs.
- Remote cadence is slice-based, not session-based. When an executed stage or bounded slice changes repo truth materially and validation is complete, prepare a clean commit and push it to the active remote branch before starting the next substantial slice. Do not wait for an entire multi-slice campaign to finish before pushing.
- Do not push every micro-edit. Push at the end of each validated slice: coherent change, evidence/tests complete when applicable, planning/truth surfaces refreshed when they changed, and a commit message that describes one clear outcome.
- If the resolved plan is the canonical master workflow and the completed stage changes planning state, refresh _dev/reports/analysis/plan-pipeline.md and _dev/reports/analysis/plan-pipeline.next-step.json before treating the cycle as closed.
</process>

<success_criteria>
- Compatible prompt plans can be listed on demand
- Target plan resolved before any execution
- Each executed stage follows the seven-step orchestration pattern
- Substantial stages use bounded subagents or workers so the main thread remains a coordinator and synthesis surface
- Write-capable subagent launches are preflighted before deep work begins
- Independent verification confirms every acceptance criterion
- Both markdown report and expectation-failure JSON written for every stage
- Lessons or improvement claims are backed by durable artifacts and explicit validation evidence
- Any cross-actor next step is represented by a truthful HandoffSignal/1.0 and Codex bridge prompt when applicable
- No stage leaves behind an implied Codex-only dependency when the actual available next actor is operator or claude
- Codex listener lifecycle is truthful: started before claiming auto-run active, stopped before final closeout when no longer needed
- Human gates and deferrals surfaced when reached
- Codex auto-run launched for every executed stage (mandatory, not conditional)
- Rolling session learnings captured during execution
- Debrief artifacts (improve-plan, replicate-plan) written before ready_for_clear for meaningful runs
</success_criteria>

<orchestration_rules>
- Execute ONE stage at a time. Do not parallelize stages.
- Within a stage, parallelize independent work items where possible.
- Each worker reads its own files, not pre-digested content.
- Keep the main thread thin: coordinator only, not the primary deep-work surface when the stage can be partitioned safely.
- Subagents should do the detailed research, implementation, and validation work for each stage before the main thread advances.
- Write-capable subagents must pass a write-scope and credential-path preflight before they receive full deep-work context.
- NEVER skip verification. The verify step exists because build steps can self-report success on incomplete work.
- The main thread makes all go/no-go decisions.
- The main thread synthesizes what to communicate to the operator and to Codex. Workers and validators provide evidence, not final workflow decisions.
- Never skip a human gate. Never fake completion evidence.
- Never close a stage on a lessons or improvement claim without durable artifacts and verification evidence.
- Never let the implementation worker validate its own work as the only evidence. Independent validation is required before moving to the next stage.
- Never imply a direct Codex loop from Claude. Cross-actor feedback must flow through HandoffSignal/1.0 plus the Codex bridge prompt when Codex is the target actor.
- Never make stage completion depend on an unavailable Codex conversation. If Codex is not the actual next actor, route the decision truthfully to operator or claude.
- Never report watcher, cron, or listener status without explicit evidence from the current run or a durable artifact.
- If Claude starts a managed Codex listener for a slice, Claude must shut it down truthfully before final closeout unless another active Codex handoff still depends on it.
- If a stage fails after 2 fix cycles, stop and report the blocker.
- Run npm run verify:all after every stage to confirm no regressions when relevant.
- Never leave unmet output expectations uncaptured.
- Never present mechanically determined and safe bridge dispatch as an operator choice. Auto-dispatch when available; otherwise block truthfully.
</orchestration_rules>

<handoff>
operator_wants_to_run_a_plan: run-plan (the primary operator execution router — handles both task plans and prompt plans)
list_only: review available plans and choose one
blocker_or_suspicious_success: review-progress pipeline
stale_prompt_references: assemble-prompt-system all
human_gate_and_planning_may_have_changed: plan-pipeline
cross_actor_review_or_feedback_needed: publish HandoffSignal/1.0, run npm run signals:codex-bridge, and optionally start npm run signals:watch:codex:start
</handoff>
