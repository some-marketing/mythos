---
name: skill-name
description: >
  One-line description of what this skill does. Use when [trigger condition].
  Example: "Executes testcase across A/B/C environments in parallel. Use when ready to run a validated testcase."
---

<objective>
Brief description (2-4 sentences) of what this skill accomplishes.

This skill wraps the detailed procedure defined in the source prompt. The executor MUST read
the source prompt file in full before proceeding.

Reports must be **observational, not diagnostic** per 09_SHARED_BLOCKS.md § E. (Include if skill produces reports)
</objective>

<source_prompt>
frameworks/wordpress/qa/prompts/XX_PROMPT_NAME.md
</source_prompt>

<prompt_type>Atomic | Playbook | Coordinator</prompt_type>

<shared_blocks_references>
- 09_SHARED_BLOCKS.md § A — Standard inputs (PROJECT_ROOT, TESTCASE_ID, etc.)
- 09_SHARED_BLOCKS.md § B — Operating rules ([EXECUTION_MODE] mode)
- 09_SHARED_BLOCKS.md § E — Observational Reporting Philosophy (if produces reports)
- 09_SHARED_BLOCKS.md § F — Stakeholder Interview Gate (if has gate)
- 09_SHARED_BLOCKS.md § G — Subagent delegation language (if orchestrates)
</shared_blocks_references>

<model_recommendation>
sonnet | opus — Brief justification for model choice.
</model_recommendation>

<execution_mode>
FINDINGS_ONLY | RUN_ONLY | REVIEW_ONLY | PATCH_ALLOWED | COORDINATOR — Description of what modifications are permitted.
</execution_mode>

<quick_start>
Invoke with [required args].
Guides you through [N] steps: [brief list of major phases].
Key deliverable: [what the user gets].

Full procedure: frameworks/wordpress/qa/prompts/XX_PROMPT_NAME.md
</quick_start>

<execution_rules>
  <rule id="sequential">Execute steps in strict order. Do not skip or parallelize.</rule>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="gate-protocol">[GATE: condition] — If condition TRUE, behave as [USER]. If FALSE, proceed as [AUTO].</rule>
  <rule id="no-speculation">Do not read files or prepare outputs for future steps.</rule>
</execution_rules>

<context>
Before starting, run these commands to understand the current state:
- `ls <PROJECT_ROOT>/playwright_phased_runner/testcases/` -- see available testcases
- Read `frameworks/wordpress/qa/prompts/XX_PROMPT_NAME.md` for full procedure
</context>

<inputs>
  <required>
    <input name="input_name">Description of required input</input>
    <input name="input_name2">Description of another required input</input>
  </required>
  <optional>
    <input name="optional_input">Description (default: value)</input>
  </optional>
</inputs>

<outputs>
- Path to output file 1 — Description
- Path to output file 2 — Description
</outputs>

<delegation_plan>
(Include for Playbook/Coordinator types only)

Per 09_SHARED_BLOCKS.md § G: If subagents are available, delegate in parallel;
otherwise run sequentially.

| Sub-task | Subagent Role | Inputs | Outputs |
|----------|---------------|--------|---------|
| Task 1 | Role | Input list | Output list |
| Task 2 | Role | Input list | Output list |
</delegation_plan>

<automated_workflow>
  <step number="1" name="step_name" type="USER">
    [USER] Description of what this step does.

    **STOP and wait for user response before proceeding.**
  </step>

  <step number="2" name="step_name" type="AUTO">
    [AUTO] Description of autonomous step.
    Commands or procedures to execute.
  </step>

  <step number="3" name="step_name" type="GATE" condition="condition description">
    [GATE: condition]

    If condition TRUE: describe USER behavior
    **STOP and wait for user response before proceeding.**

    If condition FALSE: proceed autonomously.
  </step>
</automated_workflow>

<failure_modes>
(Include for Playbook/Coordinator types, optional for Atomic)

| Condition | Action |
|-----------|--------|
| Failure condition 1 | How to handle |
| Failure condition 2 | How to handle |
</failure_modes>

<success_criteria>
- Criterion 1 — How to verify this step succeeded
- Criterion 2 — How to verify this step succeeded
- **Observational compliance verified:** (if produces reports) Zero instances of "Root Cause:", "Recommendation:", etc.
</success_criteria>
