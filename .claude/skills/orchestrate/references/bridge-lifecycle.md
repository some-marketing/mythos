# Codex bridge lifecycle

The codex-bridge is a bounded subordinate lane for cross-intelligence review. It is invoked when the orchestrator wants a Codex-authored perspective on a plan, diff, or architectural decision.

**The bridge is a review lane, not the whole orchestration model.** Do not route primary execution through the bridge unless the chosen shape is #2 (bridge only) and the orchestrator explicitly delegated only verification.

## The bridge is a native surface

Relevant files:
- `tools/signals/lib/codex-bridge.js` — bridge orchestration logic
- `tools/signals/lib/bridge-prompt-body.js` — prompt body composer
- `tools/signals/run-codex-bridge.js` — runner (invokes Codex CLI)
- `tools/signals/watch-codex-bridge.js` — watcher (picks up Codex output)
- `instructions/adapters/codex.yaml` — adapter config

Do NOT invent a parallel bridge format. Use the existing composer and runner.

## Depth profiles

From `bridge-prompt-body.js`:

```
light  — 5 sections,  no review steps,      no lessons, no prompt stub, no schema check
review — 8 sections,  review steps,         no lessons, no prompt stub, no schema check
full   — 8 sections,  review steps,         lessons,    prompt stub,    schema check
```

**When to use each:**

- **light** — quick sanity check on a small isolated diff; Codex acts as a second pair of eyes on a single file. Low cost.
- **review** — standard review lane for a completed slice; most shape-1 closeouts use this. Codex checks the integrated result, suggests repair, authorizes or blocks close.
- **full** — architectural decision, framework-level change, or a slice that will harden a framework. Codex reads lessons history, reviews the schema, and returns a prompt stub for follow-up.

Default to `review`. Upgrade to `full` when the slice touches frameworks/, skills/, canonical instructions, or doctrine docs. Downgrade to `light` only for isolated single-file diffs.

## Bridge artifact locations

The runtime supports two bridge lanes. Both write the prompt body into `_dev/reports/analysis/` and the paired HandoffSignal into `_dev/reports/signals/`. The legacy `_dev/reports/signals/bridge-prompts/` directory still exists from earlier workflows but is NOT where the active runners write — do not target it for new prompts.

**Legacy codex-bridge lane** (writer: `tools/signals/lib/codex-bridge.js`):
- **Prompt artifact:** `_dev/reports/analysis/codex-bridge-prompt__{scope}.md`
- **Response signal:** `_dev/reports/signals/<...>.signal.json` with `source: codex`
- **Invocation:** `node tools/signals/run-codex-bridge.js --file <signal-file>` — the runner consumes a live signal it already authored, NOT a hand-written prompt path

**New dispatch-bridge lane** (writer: `tools/signals/lib/dispatch-bridge.js`):
- **Prompt artifact:** `_dev/reports/analysis/dispatch-bridge-prompt__{scope}.md`
- **Paired dispatch signal:** `_dev/reports/signals/dispatch-bridge__{stamp}__{scope}.signal.json` with `lifecycle_state: live`, `recommended_next_actor: <target>`, `recommended_next_command: </slash-command>`
- **Invocation:** `/dispatch-bridge --target <actor> --task "..." --command "/..."` (or the slash-command-equivalent `node tools/signals/dispatch-bridge.js`). Pass `--run-now` only if the target has a synchronous runner.

## Invocation flow

1. **Compose the prompt** via `tools/signals/lib/bridge-prompt-body.js` using the chosen depth profile. Do not hand-write the prompt body — the composer enforces the canonical sections. Both lanes use this composer internally.
2. **Pick the lane.** Use the legacy `codex-bridge` lane for Codex-only review of an existing live signal scope. Use the new `dispatch-bridge` lane for any other actor, or when you want to author the dispatch from scratch with explicit `--target` / `--command` arguments.
3. **Invoke the runner.** Legacy: `node tools/signals/run-codex-bridge.js --file <signal-file>`. New: `node tools/signals/dispatch-bridge.js --target <actor> --task "..." --command "/..."` (or `/dispatch-bridge` slash command).
4. **Wait for the returning signal.** Both runners write a return HandoffSignal/1.0 under `_dev/reports/signals/` with the actor's findings.
5. **Consume the signal** via `/follow-signal <signal-scope|--file path> --execute`. The returning signal must carry the downstream leaf command to run; it must not recurse back to `/follow-signal`. Do not read the runner's stdout and act on it without going through follow-signal — that is how you lose the authority trail.

## Reading a bridge response truthfully

When the Codex signal comes back:

1. Read the signal's cited artifacts directly, not the signal's summary text
2. Classify the response:
   - **Approve** → `signal_type: cycle-complete` or `ready-for-clear`
   - **Repair** → one or more findings that need fixing before close
   - **Block** → a hard stop requiring operator or different approach
3. **Do NOT collapse the Codex response into the orchestrator's own words.** When relaying to the operator or writing the closing signal, attribute: "Codex agent reported X" not "Findings are X."
4. If the response calls for auto-fix of only LOW / simple findings (see memory `feedback_autonomous_low_findings`), fix them and re-dispatch without asking. If any finding is non-trivial, escalate to the operator before acting.

## Running a new bridge after a repair

If Codex returned repair findings and the orchestrator fixed them:
1. Compose a new bridge prompt at the same or lower depth (review → light is common for a repair re-run)
2. Reference the original bridge prompt path in the new prompt's context
3. Invoke the runner again
4. Consume the new signal

Do not pretend the original bridge response is still valid after a repair. Each repair run needs its own bridge cycle.

## Anti-patterns

- Invoking the bridge for a trivial single-file diff (use shape 4, skip the bridge entirely)
- Using depth `full` by default — it is expensive
- Reading Codex output directly from the runner's stdout instead of the signal artifact
- Treating the Codex response as orchestrator-authored when relaying to the operator
- Writing a closing HandoffSignal before the bridge cycle completes
- Running multiple bridge cycles in parallel against the same plan id (race conditions in the watcher)
- Using the bridge as the primary writer when shape 1 or 2 would suffice

## Reminder: bridge is bounded

The bridge is one lane among many. The full orchestration model is:
- native commands first
- native skills second
- native signals and bridge machinery third
- native hooks always

The bridge inherits its authority from the native signal layer. Treat it as a bounded subordinate lane, never as the whole control plane.
