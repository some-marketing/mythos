---
name: bridge-dispatch-on-acceptance-claims
description: Detects when the current session has produced acceptance-grade claims (structural framings, isomorphisms, constitutional proposals, concept lifts, architecture claims) without dispatching any of them to distinct intelligence via bridge for cross-verification. Activates when the session has written 2+ concept docs, philosophy proposals, memory files encoding structural rules, or skill drafts without a corresponding bridge dispatch or /convene. Fires as an advisory naming the uncross-verified claims and proposing specific dispatch targets. Does not block work — surfaces the gap so the operator or orchestrator can decide whether to dispatch now or defer.
status: provisional
graduation_criteria: two independent sessions where the skill fired, the advisory was accurate (the named claims were genuinely uncross-verified), and the operator confirmed the advisory was useful rather than noisy. If the skill fires on sessions that are doing purely mechanical work (no acceptance-grade claims), tighten the activation conditions. If it misses sessions that produced unverified structural claims, broaden them.
---

<role>
You have detected that this session has produced acceptance-grade claims — structural framings, concept lifts, philosophy proposals, constitutional-surface changes, or architectural claims — without dispatching any of them to distinct intelligence via bridge for independent cross-verification.

This skill exists because the producing session on 2026-04-15 demonstrated that memory-only rules for bridge-first dispatch are insufficient. The bridge-first rule was captured as a memory file, referenced repeatedly, and still not followed for any of the session's acceptance-grade claims. The operator caught the failure with the question "have we asked the rest?" — by which point hours of uncross-verified claims had accumulated. The rule needs structural enforcement at the moment of need, not just a memory entry that depends on the assistant remembering to consult it.

Your job is to surface the gap, name the specific uncross-verified claims, and propose dispatch targets. You do not block work. You do not dispatch automatically. You surface the advisory and wait for direction.
</role>

<process>

## Four-step advisory

1. **Inventory the session's acceptance-grade claims.** Scan the current session's outputs for:
   - Concept docs written to `_dev/concepts/`
   - Philosophy or framework expansion proposals
   - Memory files that encode structural rules (not simple user preferences or project state)
   - Skill drafts written to `_dev/drafts/skill-proposals/`
   - Constitutional-surface changes or proposals
   - Architecture claims about how the system works or should work
   - Isomorphisms, cross-domain mappings, or "X is structurally identical to Y" claims

   List each claim with a one-line summary and the artifact it produced. Note: memory-file writes land outside the repo root (`${HOME}/.claude/projects/**/memory/`) and are not observed by the companion PostToolUse hook — this skill is the primary surface for that claim class.

2. **Check whether any bridge dispatch has occurred.** Look for:
   - Signal files at `_dev/reports/signals/dispatch-bridge__*` created during this session
   - `/convene` invocations that sent work to external models
   - Codex `exec` commands that sent review prompts
   - Any other evidence of distinct-intelligence review of the specific claims identified in step 1

   A bridge dispatch that reviewed *different* claims does not count as cross-verification of *these* claims. The dispatch must address the specific claim-set.

3. **Produce the advisory.** Format:

   ```
   BRIDGE-DISPATCH ADVISORY

   This session has produced N acceptance-grade claims without dispatching
   any to distinct intelligence for cross-verification:

   1. [claim summary] — artifact: [path]
   2. [claim summary] — artifact: [path]
   ...

   Suggested dispatch targets:
   - Codex (depth review): [specific question to ask]
   - Gemini (breadth/lateral): [specific question to ask]
   - Uncontaminated external (if available): [raw question without Mythos framing]

   This is an advisory, not a gate. The operator or orchestrator decides
   whether to dispatch now, defer, or proceed without cross-verification.
   Proceeding without cross-verification means these claims remain
   provisional and operator-dependent for integrity.
   ```

4. **Wait for direction.** Do not dispatch automatically. Do not proceed to other work until the operator or orchestrator has acknowledged the advisory. The acknowledgment can be "dispatch now," "defer," or "proceed without" — all three are valid responses.

</process>

<anti_patterns>
- Do not fire on sessions that are doing purely mechanical work (bug fixes, test runs, configuration changes, client-scoped edits). These do not produce acceptance-grade claims. If you find yourself wanting to fire on a session that wrote only code, you are pattern-matching on "files were written" rather than on "structural claims were made." Tighten your detection.
- Do not fire on claims that have already been dispatched. Check for existing dispatch signals before firing.
- Do not fire on claims that the operator has explicitly marked as "provisional, not for cross-verification yet" — sometimes ideas need to marinate before they're ready for external review.
- Do not dispatch automatically. The skill produces an advisory; the operator decides. Automatic dispatch would collapse the operator's judgment about timing, priority, and which claims are ready for review.
- Do not treat the advisory as a gate that blocks execution. Work can continue while the advisory is pending. The advisory surfaces a gap; it does not enforce a halt.
- Do not count the number of claims as a quality signal. One deeply structural claim that restructures how the system works is more important to cross-verify than ten incremental observations. The advisory should emphasize the load-bearing claims, not the count.
</anti_patterns>

<success_criteria>
- The advisory correctly identifies acceptance-grade claims produced in this session
- The advisory correctly identifies whether any bridge dispatch has addressed those specific claims
- The suggested dispatch targets are specific to the claims (not generic "send it to Codex")
- The advisory is surfaced to the operator or orchestrator before the session closes
- No automatic dispatch was performed
- The operator or orchestrator acknowledged the advisory with a direction
</success_criteria>

<notes_for_future_operator>
This skill is the third moment-detection skill, alongside state-reconciliation-preamble (session-open detection) and propose-skill-capture (graduation-moment detection). Together they cover three failure modes the 2026-04-15 session demonstrated:

1. State-reconciliation-preamble: executing against assumed state that has drifted
2. Bridge-dispatch-on-acceptance-claims: producing structural claims without cross-verification
3. Propose-skill-capture: capturing insights as memory when they should graduate to skills

The three skills compose but do not depend on each other. Each can fire independently.

Companion surface: `tools/planning/hooks/post-write-acceptance-claim.cjs` emits a lighter early advisory on repo-relative concept/skill-draft writes. The hook covers only paths under PROJECT_ROOT; this skill remains the primary surface for memory-file claims and claims that never produce a file write (chat-only isomorphisms, verbal architecture claims).

If this skill fires too often (noisy), tighten the "acceptance-grade" detection — mechanical work should not trigger it. If it fires too rarely (misses real claims), broaden the detection — look for any session that wrote to `_dev/concepts/`, `_dev/drafts/`, or structural memory files.

Graduation requires the operator's judgment that the advisory was useful rather than annoying in at least two independent sessions. The bar is "this caught something I would have missed or would have caught too late" — not "this fired correctly." Correct firing is necessary but not sufficient; the advisory must add value.

The concept of uncontaminated external perspective (see `_dev/concepts/uncontaminated-external-perspective.md`) extends this skill's dispatch suggestions: alongside bridge targets (Codex, Gemini) that review within the Mythos frame, the advisory should also suggest uncontaminated dispatch targets that receive only the raw question. This extension is queued for after the containment dispatch infrastructure is built.
</notes_for_future_operator>
