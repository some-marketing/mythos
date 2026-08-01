---
name: dlx
description: >
  Role-divided /dl. Runs the deliberate→orchestrate pattern under a fixed division of
  labor: Gemini reads/searches/researches, Codex codes, and main-chain Claude ONLY
  plans, orchestrates, and synthesizes — never reading files. Adaptive (skips empty
  legs), minds operator-swappable. Ships ungated as a project skill, not a canonical alias.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
tags: [orchestration, role-division, alias, context-purity, deliberate]
---

<skill>
<objective>
Provide `/dlx <task>` — the "/dl with roles" wrapper. It runs the same deliberate →
convene → orchestrate-loop pattern as `/dl`, but under an explicit, enforced division
of labor that keeps the coordinator's context pure:

- **Reader / researcher (default: Gemini):** does ALL file-searching, file-reading, and
  external research (incl. the Perplexity fallback), and produces the context brief.
- **Coder (default: Claude worker subagents):** does the actual code/file authoring in
  bounded worker lanes under coordinator contracts, strictly bound to the reader's
  context brief (operator correction 2026-07-03; Codex moves to the distinct-review lane).
- **Planner / synthesizer (main-chain Claude):** plans up front, orchestrates the
  dispatches, and synthesizes returned outputs. NEVER reads files directly.

The roles are fixed; the minds bound to each role are operator-swappable (Gemini and
Codex are only the defaults). This is the durable form of the operator's session
protocol recorded in memory `feedback_dl-role-division-gemini-reads-codex-codes`.
</objective>

<activation>
- Operator types `/dlx <task-or-question | task-id | path>`
- Operator asks to run work "with the role-division" / "the /dlx way"
</activation>

<process>
<step name="plan" type="AUTO">
Main-chain Claude plans the work: state the bounded work-unit, decide which legs are
needed (see adaptive rule), and name the mind bound to each role at dispatch time
(disclose per dispatch — dispatch-routing-rule).
</step>

<step name="delegate-read" type="AUTO">
If the work-unit needs file context or research, dispatch the READER mind (default
Gemini) to read the relevant files / run the research and return a Codex-ready context
brief. Main-chain Claude must NOT open the target files itself. For external research
the reader uses the Perplexity fallback: prefer the logged-in Pro browser path
(`tools/ai-bridge/perplexity-browser.js`), API path as fallback
(`tools/ai-bridge/perplexity-api/query.js` via `run-with-op.sh`). See
`feedback_perplexity-research-fallback`.
</step>

<step name="delegate-code" type="AUTO">
If the work-unit needs code/file authoring, dispatch the CODER mind (default: bounded
Claude worker subagents) to implement, strictly bound to the reader's context brief.
Route distinct review of substantial code to Codex (managed-command actor: dispatch
against a real registered command such as `/review-progress`, not a freeform prompt).
</step>

<step name="synthesize" type="AUTO">
Main-chain Claude synthesizes the returned outputs into the result, verifies against the
work-unit, and routes onward through the canonical `/dl` machinery
(deliberate → convene when warranted → orchestrate-loop) for closeout.
</step>
</process>

<execution_rules>
<rule id="never-read">[INVARIANT] — Main-chain Claude NEVER reads files. If about to Read/Grep/open a target file, halt and delegate the read to the reader mind (Gemini). Zero exceptions. This invariant never relaxes.</rule>
<rule id="adaptive">[PROTOCOL] — Adaptive dispatch: skip the reader leg when there is nothing to read, and skip the coder leg when there is nothing to code. The planner/synthesizer role always runs.</rule>
<rule id="triviality-threshold">[PROTOCOL] — Write-delegation is proportional. For trivial, ungated, single-file work whose exact content is already specced, main-chain Claude may write it directly rather than manufacturing a bounded plan + `/run-plan`. Full Gemini→Codex delegation is for substantial coding. (The never-read invariant still holds regardless.)</rule>
<rule id="roles-fixed-minds-swappable">[PROTOCOL] — The roles (reader / coder / synthesizer) are fixed; the mind bound to each is operator-configurable. Defaults: reader=Gemini, coder=Claude workers (2026-07-03 correction; was Codex), synthesizer=main-chain Claude.</rule>
<rule id="disclose-per-dispatch">[PROTOCOL] — Disclose the mind bound to each role at dispatch time and tier it to the work altitude (dispatch-routing-rule).</rule>
<rule id="ungated-alias-surface">[PROTOCOL] — /dlx is a user/project-space wrapper. It does NOT require registration in the governance-gated canonical alias registry. Personal aliases must never need a ConveneReceipt (feedback_commands-aliasable-by-end-users).</rule>
</execution_rules>

<inputs>
<required>
A task, question, task-id, or path to run under the role-division.
</required>
<optional>
<input name="reader=<mind>">Override the reader mind (default gemini)</input>
<input name="coder=<mind>">Override the coder mind (default claude-workers)</input>
</optional>
</inputs>

<outputs>
<output name="synthesis">Coordinator-authored synthesis of the delegated outputs</output>
<output name="handoff">Onward routing through /dl → orchestrate-loop for closeout</output>
</outputs>

<success_criteria>
- Main-chain Claude read zero files; the reader mind supplied all context.
- Coder output was bound to the reader's brief.
- Empty legs were skipped (adaptive); trivial ungated writes were not over-ceremonied.
- Result was synthesized by the coordinator and routed to canonical closeout.
</success_criteria>

<boundaries>
- Does NOT replace `/dl`, convene, or orchestrate-loop — it wraps them with role discipline.
- Does NOT write to `instructions/canonical/**` (that path is ConveneReceipt-gated) — /dlx lives in ungated project space.
- Does NOT relax the never-read invariant for the coordinator under any condition.
</boundaries>
</skill>
