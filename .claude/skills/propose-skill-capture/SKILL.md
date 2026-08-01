---
name: propose-skill-capture
description: When the current conversation identifies a reproducible behavioral move that would benefit from graduation from memory-captured insight to automatic skill activation, drafts a skill file proposal for operator ratification. Activates when the operator explicitly asks for skill instantiation ("we should have a skill for this," "this should be automatic," "tell me how I can do it"), when a captured insight is being re-derived across multiple exchanges, when a memory file is written and its value depends on being applied at the exact moment of trigger rather than on being recalled later, or when a feedback correction pattern repeats across sessions. Never promotes skills autonomously — always drafts to a staging location and presents for operator approval. The operator is the gate.
status: provisional
graduation_criteria: three independent sessions where the skill proposed drafts, the operator approved at least two of the three without substantial rewrites, and the approved skills themselves went on to fire usefully. The higher bar (three sessions, versus two for reflex-layer skills) reflects that this meta-skill has consequential action — it drafts new skill files — and its activation condition is fuzzier (conversational signals versus structural triggers). Do not graduate on lower evidence.
---

<role>
You have detected a signal in the current conversation that a captured insight should graduate from memory (slow path — requires the assistant to remember to consult it) to skill (reflex path — activates automatically when its conditions match). Your job is to draft a proposed SKILL.md file for the insight and present it to the operator for ratification. You do not install the skill. You do not mark it as live. You do not place it under `.claude/skills/`. You produce a draft in the staging directory and wait for explicit operator approval before anything enters the live skill path.

This skill exists because the gap between "captured insight" and "live capability" is real and load-bearing. Memory files require the assistant to remember to consult them, which is exactly the failure mode some insights were designed to correct for. Skills activate automatically. Moving specific insights from memory to skill is a graduation — Phase A to Phase B in the phased-autonomy framing. But the graduation must be operator-ratified; the skill pipeline is not allowed to decide on its own which insights deserve promotion. That is the constitutional-surface protection.
</role>

<process>

## Five-step draft proposal

When you detect an activation signal, run these steps:

1. **Name the insight explicitly.** State the reproducible move in one sentence: what's the trigger, what's the action, what failure mode does it prevent. If you cannot state it in one sentence, the insight is not ready to become a skill — either capture it as memory first and wait for the pattern to stabilize, or ask the operator to help narrow the framing.

2. **Check the memory layer for a prior capture.** Is there already a feedback memory for this insight? If yes, read it and anchor the skill draft on the memory's language to preserve continuity. If no, the insight should probably be captured as memory first before skill graduation — the memory provides the evidence trail, and the skill graduation depends on that evidence trail existing. In that case, offer to write the memory first and come back to skill graduation later.

3. **Draft the SKILL.md content.** Minimum fields:
   - **`name`**: short identifier, kebab-case
   - **`description`**: the activation trigger — specific enough that Claude Code will load the skill when the trigger is present, broad enough to catch adjacent cases
   - **`status`**: always `provisional` on initial draft. Graduation to `established` is explicit operator action, not drafted in
   - **`graduation_criteria`**: what evidence would justify promotion. Include a session count and a quality bar
   - **`<role>` section**: what the skill is for and what failure mode it prevents
   - **`<process>` section**: the numbered steps the skill runs when activated
   - **`<anti_patterns>` section**: explicit failure modes to avoid (especially: "do not skip steps to save time," "do not promote autonomously")
   - **`<success_criteria>` section**: what "the skill ran correctly" looks like
   - **`<notes_for_future_operator>` section**: how to tune the skill, what the graduation rule is, any constitutional-surface constraints that apply

4. **Write the draft to the staging directory.** Path: `_dev/drafts/skill-proposals/<name>__draft.md`. NEVER write to `.claude/skills/` directly. The staging directory is the gate — files in staging are drafts; files in `.claude/skills/` are live skills. The operator is the only actor who moves files across that boundary.

5. **Present the draft to the operator.** Surface the draft's path, a one-paragraph summary of what the skill does and when it would activate, and the explicit statement: "This is a draft. It will not activate until you move it to `.claude/skills/<name>/SKILL.md`. You can edit the draft before moving it — especially the description field, which determines when the skill loads and is the thing most worth tightening." Wait for operator direction before doing anything else on this thread.

</process>

<anti_patterns>
- Never write drafts directly to `.claude/skills/`. The staging directory exists specifically to prevent autonomous installation. Violating this boundary collapses the operator ratification gate and turns the skill pipeline into a self-promotion loop.
- Never mark a draft as `established` or remove the `status: provisional` marker. Graduation is operator-led, not drafted in.
- Never propose a skill for an insight that has not yet been captured as a memory file. The memory file is the evidence trail; without it, graduation cannot be justified later. If a memory does not exist, offer to write one first and defer the skill question.
- Never batch multiple skill proposals into one draft. One skill per proposal. Multi-skill drafts make operator review harder and blur the graduation path for each skill individually.
- Never propose a skill whose action is "decide which other skills should graduate." That's the self-promotion failure mode. Graduation decisions stay operator-led.
- Do not re-propose a skill the operator has already rejected unless the situation has materially changed. Rejection is data; re-proposing the same thing without new evidence is not learning.
</anti_patterns>

<success_criteria>
- A draft skill file exists at `_dev/drafts/skill-proposals/<name>__draft.md`
- The draft has all required frontmatter fields including `status: provisional` and explicit `graduation_criteria`
- The operator has been presented with the draft's path, summary, and installation instructions
- No file has been written to `.claude/skills/` as part of this process
- The operator has given direction before any other action is taken on this thread
</success_criteria>

<notes_for_future_operator>
This meta-skill is the "moment-detection" half of the insight graduation pipeline. The other half is the reflex-layer skills themselves (first example: `state-reconciliation-preamble`). The pipeline shape is:

1. Insight earned in session → captured as memory file (slow path)
2. Pattern observed across sessions → evidence accumulates
3. Operator or meta-skill notices "this would benefit from being automatic"
4. Meta-skill drafts proposal to staging directory
5. Operator reviews draft, edits description field if needed, moves to `.claude/skills/`
6. Skill runs in provisional status; fire counts accumulate in a journal
7. Operator reviews evidence, graduates to `established` when criteria met

The critical design property: the operator is the gate at step 5, at step 7, and at any point in between. This skill can propose, but it cannot install, and it cannot graduate. The staging directory enforces step 5; the `status: provisional` marker enforces step 7. Both are constitutional-surface protections per the expansion proposal's P5 (reconciliation as constitutional surface).

If this meta-skill begins producing drafts the operator routinely rejects, that is evidence the activation conditions are too broad — tighten the description field. If it misses clear moments, broaden them. Both adjustments are operator-led. The skill does not tune its own description based on its own rejection rate, for the same legitimacy-recursion reason.

Graduation of this meta-skill itself to `established` requires a higher bar than reflex-layer skills because the action is more consequential (it drafts new skills) and the activation condition is fuzzier (conversational signals). Three independent sessions with operator-approved drafts, plus those drafts' own skills firing usefully, is the minimum. Do not accept a lower bar.
</notes_for_future_operator>
