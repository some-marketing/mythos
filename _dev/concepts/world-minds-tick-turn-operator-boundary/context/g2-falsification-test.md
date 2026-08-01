# G2 — Falsification test: does tick/turn/checkpoint vocabulary hold?

**Plan:** world-minds-tick-turn-operator-boundary
**Step:** G2 (REVIEW_ONLY)
**Date:** 2026-08-01 (revised after G6 blocking review — see Revision note at bottom)

**Working definitions (from the concept):**
- **Tick** — a unit of autonomous progression, no operator input by design.
- **Turn** — an operator-facing interaction boundary, by design waiting on or presenting to the operator.
- **Checkpoint** — the named condition set where a tick *in progress* must escalate to a turn.

## Test 1 — ConveneReceipt gate firing (observed this session, contemporaneous)

Direct transcript evidence, this session: a Bash command touching `instructions/canonical/harness-capability-policy.yaml` was mechanically blocked with `PreToolUse:Bash hook error: ... BLOCKED: governance write to instructions/canonical/harness-capability-policy.yaml requires a live ConveneReceipt/1.0 covering this path.` The same block fired again on `instructions/canonical/commands/orchestrate-loop.yaml`. **Fits cleanly as a conditional checkpoint** with genuine historical (in-session) evidence: an ordinary read/write is a tick; a canonical-path write attempt is the condition that forces escalation to a turn (a human-authorized receipt-minting process).

## Test 2 — Destructive-git-command confirmation gate

Session-level instruction: run `git status` before any command that could discard uncommitted work, and default to confirming before proceeding. **Revision note:** the original version of this test asserted "fits cleanly" without attaching an observed firing — that was policy-text evidence, not historical-moment evidence, and the charter requires the latter. Correction: this test is retained as a **policy-documented conditional checkpoint**, explicitly labeled as *not yet observed firing in this session's transcript* — no destructive git command was attempted here to test it. It should not be counted as equivalent-strength evidence to Test 1.

## Test 3 — HarnessCapabilityPolicy `review_required` classes

**Revision note:** originally cited as a general checkpoint without a specific firing. Per G6's correction, `command_surfaces` does NOT carry `review_required:true` (only `auto_apply:false`, routing to a named mechanical repair script instead) — the other four classes do. Retained as a **policy-documented conditional checkpoint** for the four classes that carry `review_required:true`, again *not observed firing in this session* — no cross-harness capability propagation was attempted here.

## Test 4 (autonomous, non-human-gated example) — auto-commit + disk-quota-guard at session start

Direct transcript evidence, this session's `/new-session` invocation: `node tools/hygiene/auto-commit.js --auto --foreground` returned `[auto-commit] DISABLED by operator kill switch (_dev/state/kill-switches/auto-commit.off), skipping` with exit 0, and the disk-quota-guard check ran and reported available space — both with **no operator turn**. **Fits cleanly as a tick**, with genuine in-session evidence (quoted above, not merely asserted). Informative because it touches git (normally checkpoint-adjacent per Test 2) yet does not escalate — the kill-switch design is what keeps this a tick rather than a checkpoint trigger.

## Test 5 — Custody-grant release-entry-point firewall: does NOT fit as defined

**Revision note (this is the substantive correction from G6's review, not a minor wording fix):** the working definition of "checkpoint" requires "a tick *in progress* must escalate to a turn" — an autonomous action that hits a condition and stops. The custody-grant quarantine-release entry point is different in kind: it is never AI-executable, full stop — there is no autonomous starting state for it to escalate from. Calling this a "permanent checkpoint" in the original draft silently redefined "checkpoint" to mean "operator-only action" in order to force the fit, which is exactly the confirmation-shaped reasoning the charter's acceptance criteria warn against.

**Corrected finding:** this is a **third category, not a checkpoint at all — an operator-exclusive action class.** Some actions in this repo are never on the tick side of the boundary in the first place; they have no autonomous path to gate. The vocabulary needs three categories, not two: tick, turn-via-checkpoint-escalation, and operator-exclusive (no tick form exists). This is a more accurate and more useful finding than the original "permanent checkpoint" framing, and it must be carried into G3's vocabulary document as a correction, not a footnote.

## Negative control — the membrane law

`instructions/canonical/kernel/doctrine.md:42-51`: an invariant with one pre-authorized channel, no fire/no-fire state. **Confirmed sound by G6's independent review.** Correctly falls outside all three categories above (tick, checkpoint-escalation, operator-exclusive-action) — it is not an action class at all, it is a standing constraint on what content may move where.

## Verdict (revised)

The vocabulary holds, but with a real correction, not just cosmetic fixes: **three categories are needed (tick / checkpoint-escalation / operator-exclusive-action), not two (tick / checkpoint)**, and evidence strength must be stated honestly per test — Tests 1 and 4 have genuine in-session historical evidence; Tests 2 and 3 are policy-documented but unobserved in this session, and are labeled as such rather than claimed as equally strong. The membrane negative control remains sound. **G4 disposition unchanged: unification holds (with the three-category correction folded in). No new mechanism is required.**
