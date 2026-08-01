# Execution-shape / partitioning rubric

## The default is distribution, not single-threaded

Canonical Discipline #1 (Cross-Verification Law) is binding: every decision of consequence must route through a different intelligence than whoever produced it. Single-threaded execution does not satisfy that law on its own. Therefore the orchestrator's default shape is one that includes at least one distinct-intelligence verifier lane (typically shape #1 or #2). Shape #4 is the documented exception and requires an explicit justification that the work is below the consequence threshold (trivial isolated edits, throwaway scratch, mechanical formatting). The rubric below ranks shapes by distribution-first.

## The four shapes (distribution-first ordering)

1. **orchestrator + delegated workers + cross-intelligence bridge** — fully distributed: workers partition the surfaces, an external intelligence (Codex / Gemini / local Ollama) reviews the integrated result. **Default for non-trivial multi-surface work.**
2. **orchestrator + cross-intelligence bridge only** — orchestrator does the writes itself but routes verification or design-critique to a different intelligence via the bridge. **Default for non-trivial single-surface work that still needs a verifier.**
3. **orchestrator + bounded delegated workers** — orchestrator partitions work into worker packets but performs verification through native verify scripts only (no external bridge). Use only when the work is partitionable AND a script-level verify is sufficient cross-verification (e.g., the writes are mechanical and `tools/verify/*.cjs` can prove correctness).
4. **single-threaded** — orchestrator Claude does the work alone, no delegation, no bridge. **Exception, not default.** Requires an explicit one-line justification that the work is below the consequence threshold of the Cross-Verification Law. Examples: typo fix in a non-critical file, scratch-buffer edits, mechanical formatting, anything that would not appear in the next debrief as a decision.

(Numbering note: this rubric ranks by distribution-first leverage. The canonical numbering in `SKILL.md:<the_four_execution_shapes>` is preserved for backwards compatibility, but the rubric here orders them by which to reach for first.)

## The five questions

Answer in order. Do NOT skip ahead.

### Q1: Is there already a task plan for this work?
- **Yes** → honor its `risk_tier` and `review_lane`. The plan has already named the expected lane. Do not re-decide.
- **No** → proceed to Q2.

### Q2: Is this work below the consequence threshold of the Cross-Verification Law?
Below threshold means: the work would NOT appear in the next debrief as a decision, the work cannot break a launch-critical surface, the work touches no credentials/production/external accounts, and the work is not framework / skill / canonical / governance modification.

- **Yes — definitively below threshold** → shape #4 (single-threaded). Write the one-line justification before proceeding. Stop.
- **No, or unsure** → proceed to Q3. Single-threaded is no longer on the table.

### Q3: Is the work partitionable into bounded surfaces with clear ownership boundaries?
Partition boundaries are clear when:
- surfaces don't share state (e.g., different files, different clients, different services)
- each partition can be verified independently
- no partition blocks another mid-run

- **No, work is single-surface** → proceed with shape #2 (orchestrator + bridge). Skip Q4.
- **Yes, work is multi-surface** → proceed to Q4 to decide whether bridge is also needed.

### Q4: Does the integrated result need cross-intelligence review (not just per-partition verify scripts)?
- Launch-critical change (production, credentials, external accounts)?
- Cross-surface architectural decision that benefits from a different intelligence's perspective?
- Framework / skill / canonical / governance modification?
- Will the closeout `cite` cross-verification evidence in the closing signal?

- **Yes to any** → shape #1 (workers + bridge). Proceed to Q5.
- **No to all** → shape #3 (workers, script-verify only). Proceed to Q5. Note that shape #3 is rare — most non-trivial multi-surface work needs a bridge.

### Q5: Is parallel speed worth the coordination cost?
Coordination cost: writing packets, reading packets, reintegration, bridge prompts, signal normalization. Roughly 10–30 minutes of orchestrator overhead per delegated slice.

- **Yes** — total time saved > coordination cost → proceed with the chosen shape
- **No** — total time saved ≤ coordination cost → collapse from shape #1 to shape #2 (drop workers, keep bridge), or from shape #3 to single-threaded if Q2 also passes the threshold check

## Decision matrix (post-inversion)

Read as: Q2 = below consequence threshold, Q3 = partitionable into bounded surfaces, Q4 = needs cross-intelligence review, Q5 = parallel speed worth the coordination cost. Shape numbers refer to the distribution-first ordering at the top of this file (1 = workers + bridge, 2 = bridge only, 3 = workers only, 4 = single-threaded).

| Q2 (below threshold?) | Q3 (partitionable?) | Q4 (needs cross-intel review?) | Q5 (speed > coord cost?) | Shape |
|---|---|---|---|---|
| Yes | — | — | — | 4 — single-threaded (with explicit one-line justification) |
| No | No | — | — | 2 — orchestrator + bridge only |
| No | Yes | Yes | Yes | 1 — orchestrator + workers + bridge |
| No | Yes | Yes | No | 2 — orchestrator + bridge only (drop workers; coord cost too high) |
| No | Yes | No | Yes | 3 — orchestrator + workers (script-verify only; rare — most multi-surface needs a bridge) |
| No | Yes | No | No | 2 — orchestrator + bridge only (drop workers; collapse to bridge-only when coord cost too high) |

## Examples

**Shape 1 example:** Refactor the signal schema across producer and consumer surfaces. Two workers partition the code, the orchestrator reintegrates, and Codex reviews the integrated change at depth `review` before closeout.

**Shape 2 example:** Orchestrator ships a credential-bearing ads script. No partitioning is needed, but the result still requires a different-intelligence verifier before it can touch production.

**Shape 3 example:** Migrate three independent WordPress sites from Breakdance builder to native blocks where the writes are mechanical and the native verify surface is sufficient. Three workers each own one site, and the orchestrator closes through repo verification rather than a bridge lane.

**Shape 4 example:** Fix a typo in one prompt file. No partitions, no delegation, below the consequence threshold. The orchestrator edits directly, runs any relevant verify surface, records the one-line justification, and stops.

## Anti-patterns

- Choosing shape 1 or 3 just because parallelism is available, without asking Q5 about coordination cost
- Skipping Q1 and re-deciding shape when a plan already names the lane
- Choosing shape 2 when shape 4 would suffice (bridge is expensive — don't invoke casually)
- Choosing shape 1 without answering Q4 — "workers + bridge by default" is scope creep
- Partitioning along lines that still share state (e.g., two workers both editing the same file)
- Forgetting to state the chosen shape explicitly before delegation ("orchestrator + 2 workers" must be written down)

## Shape downgrade

If mid-run you discover the chosen shape is wrong:
- **1 → 3** if the bridge is not adding value and native verify is honestly sufficient; close the bridge lane and finish via workers
- **1 → 2** if worker coordination is not paying for itself; reabsorb the remaining scope and keep the bridge lane
- **2 → 1** if the scope widens and bounded workers now save more time than they cost
- **3 → 4** only if Q2 is re-answered honestly and the work is truly below the consequence threshold
- **4 → 2** if a supposedly trivial slice hits a real verification wall; pause, record the change in shape, and open the bridge lane

Downgrades are normal. Record them in the debrief. Do not silently change shape without noting the change.
