---
name: state-reconciliation-preamble
description: Runs a state-reconciliation preamble before executing any handoff prompt, multi-step plan reference, session resumption, or instruction that assumes specific prior state. Confirms the current branch matches what the prompt assumes; verifies that cited commits are ancestors of HEAD; checks whether plan steps claimed pending are already shipped on disk; investigates any dirty working tree; produces a pending-work ledger before any execution begins. Activates when a session opens with language like "execute this plan," "resume," "continue from," "here's a handoff," "run /plan X," or any prompt that references prior commits, prior sessions, plan IDs, or claims about what has already been done.
status: provisional
graduation_criteria: two independent sessions where the skill fired on a handoff or resumption, the preamble caught at least one real divergence (branch mismatch, already-shipped work, unreachable commit, or significant dirty-tree drift) or produced a clean ledger that the operator confirmed was accurate, and the operator's explicit verdict is "this prevented wasted work" or "this caught something I would have missed"
---

<role>
You are running a state-reconciliation preamble before any prescribed execution. The session has just received a prompt that assumes specific prior state — a handoff, a plan reference, a resumption, a list of steps to run. Your job is to verify that the assumed state still matches current reality BEFORE any of the prescribed actions run. You do not execute the prescribed actions until the ledger is produced and the operator has seen it.

This skill exists because handoffs and plans are ledgers of claimed state at authoring time. Authoring time is not execution time. The delta between the two is the actual starting point for this session. Running the prescribed actions without checking the delta produces one of two failure modes: re-executing work that has already shipped (wasted cost, muddied git history), or executing against assumed state that no longer exists (cascading errors downstream).
</role>

<process>

## Six-step reconciliation

Run each step. Do not skip. If any step cannot be completed, surface the obstacle to the operator before continuing.

1. **Identify the claimed state in the prompt.** Read the prompt through once specifically looking for: branch names, commit SHAs, plan IDs, file paths, "already done" claims, "pending" claims, cited dependencies, assumed working-tree state. Make a short internal list of the load-bearing claims.

2. **Check the branch.** Run `git branch --show-current`. Compare against any branch named in the prompt. If the prompt names a branch explicitly and the current branch differs, this is an outstanding item — investigate whether the current branch is a safeguard checkout, an archive, or a wrong-branch mistake before proceeding.

3. **Check commit reachability.** For each commit SHA named in the prompt as a base or dependency, run `git merge-base --is-ancestor <sha> HEAD`. If any cited commit is not an ancestor of HEAD, that's a load-bearing divergence — the prompt's assumed lineage does not match current lineage.

4. **Check claimed plan-step completion.** For each plan step the prompt claims is pending, check whether the step's target artifacts already exist on disk. If they exist and look shipped (files present, tests passing per existing debriefs, commits in history), the step may already be done. This is the most common drift: the prompt was authored assuming work was pending, the work shipped between authoring and execution, and nobody updated the prompt.

5. **Check the dirty working tree.** Run `git status --short`. Categorize each modified file into one of: (a) stale drift from a prior session (leave alone, surface to operator but do not touch), (b) in-flight work from another active session (investigate before touching), (c) work from the current session that needs committing before proceeding, (d) something unexpected that requires investigation.

6. **Produce the pending-work ledger.** Output a short structured ledger with three categories:
   - **Already done**: plan steps, claims, or assumptions from the prompt that are confirmed shipped or true
   - **Actually pending**: plan steps that remain to be done, narrowed to reality
   - **Outstanding items**: divergences that need resolution before any execution (branch mismatch, unreachable commit, dirty tree that needs categorization, unclear claims)

Surface the ledger to the operator. Do not execute any of the prescribed prompt actions until the operator has seen the ledger and either confirmed the ledger is accurate, resolved outstanding items, or explicitly told you to proceed anyway.

</process>

<anti_patterns>
- Do not skip the reconciliation "to save time." The cost of the reconciliation is a small fraction of the cost of re-executing shipped work or cascading errors from assumed-state mismatches.
- Do not silently narrow scope based on your own reconciliation findings without surfacing the findings first. Scope narrowing is an operator decision, even when the narrowing feels obvious.
- Do not delete or alter dirty working-tree files during the reconciliation. Observation only. The operator decides what to do with each.
- Do not treat a passing reconciliation as a green light for autonomous execution. The reconciliation confirms the starting state; it does not authorize the prescribed actions.
- Do not truncate the ledger for brevity. The outstanding-items section in particular is load-bearing — incomplete outstanding-items lists are the failure mode this skill exists to prevent.
</anti_patterns>

<success_criteria>
- The six reconciliation steps have all been run
- A pending-work ledger has been produced and surfaced to the operator
- Any outstanding items have been explicitly named (not hidden under assumed-resolution)
- The operator has seen the ledger and given direction
- No prescribed prompt actions have been executed before operator direction arrived
</success_criteria>

<notes_for_future_operator>
This skill is the reflex-layer form of the feedback memory at `feedback_state_reconciliation_preamble.md`. The memory captured the rule; the skill makes it automatic. The goal is that the operator never has to ask the assistant "did you check the state first?" — the check runs by default.

If the skill fires on prompts it shouldn't (false positives — the prompt doesn't actually assume prior state), tighten the description's activation signal words. If the skill misses prompts it should catch (false negatives — a handoff came through without triggering), broaden the description's activation signal words. Both adjustments are operator-led; the skill does not tune its own description.

Graduation from `provisional` to `established` is a constitutional-surface decision. Do not let the skill propose its own graduation based on fire counts. Fire counts are evidence; the promotion is the operator's call. This rule applies to every skill that graduates via this pipeline, not just this one.
</notes_for_future_operator>
