---
name: extract-skill
description: >
  Analyzes the current conversation to identify a repeatable workflow, then produces
  the full Mythos artifact set: SKILL.md, commands, agent, verification script,
  and manifest updates. Use after completing successful work to capture it as a
  reusable skill.
version: 1.0.0
---

<skill>
<objective>
Extract a reusable skill from the current conversation's workflow. Reconstructs what
happened (steps, tools, inputs, outputs, decisions, verification), confirms with the
user, then generates all artifacts needed to make the workflow invocable as a registered
skill within Mythos.

Determines placement automatically:
- **System-level skill** (`.claude/skills/<name>/`) if the workflow is framework-agnostic
- **Framework-level skill** (`frameworks/{svc}/{fw}/.claude/skills/{fw}/<name>/`) if tied to a specific framework
</objective>

<prompt_type>Coordinator</prompt_type>

<execution_mode>
PATCH_ALLOWED — Creates new skill files, commands, agent definitions, verification
scripts, and updates framework manifests. Does not modify existing skills or the
conversation's original output artifacts.
</execution_mode>

<model_recommendation>
opus — Requires deep analysis of conversation context, understanding of Mythos
patterns across many files, and generation of multiple coordinated artifacts that
must be internally consistent.
</model_recommendation>

<quick_start>
1. [AUTO] Analyze conversation — identify steps, inputs, outputs, tools, decisions, verification patterns
2. [USER] Present extracted workflow summary — ask user to confirm, correct, or name the skill
3. [AUTO] Determine placement — system-level or framework-level based on scope
4. [AUTO] Check existing skills for overlap (scan `frameworks/*/manifest.json` + `.claude/skills/`)
5. [AUTO] Generate SKILL.md with workflow mapped from conversation
6. [AUTO] Generate command(s) (full-workflow + sub-commands for independent phases)
7. [AUTO] Generate agent definition with tools list derived from actual usage
8. [AUTO] Generate verification script if applicable (derive checks from conversation patterns)
9. [AUTO] Update manifest — framework `manifest.json` or `instructions/canonical/system.yaml`
10. [AUTO] Run verification: `node tools/verify/verify-skill.cjs <path>/SKILL.md`
11. [USER] Present all artifacts for final review
</quick_start>

<execution_rules>
  <rule id="user-protocol">[USER] — Present question, STOP, wait for response. Do not assume or infer.</rule>
  <rule id="auto-protocol">[AUTO] — Execute autonomously. Report progress. No confirmation needed.</rule>
  <rule id="no-modify-originals">Do not modify the conversation's original output artifacts. Only create new framework files.</rule>
  <rule id="template-matching">Use existing Mythos skills as structural templates. Read the most relevant example before generating.</rule>
  <rule id="overlap-check">Before generating, scan existing skills. If >50% overlap with an existing skill, ask user whether to extend or create new.</rule>
  <rule id="verification-from-conversation">Derive verification script checks from what the conversation actually used for validation (grep patterns, count checks, token scans).</rule>
  <rule id="naming-from-user">Always ask the user to name or confirm the skill name before generating files.</rule>
  <rule id="placement-logic">System-level if the workflow applies across frameworks. Framework-level if it only makes sense within a specific framework context.</rule>
</execution_rules>

<context>
Mythos structural references (read these to match conventions):
- `.claude/skills/manage-frameworks/SKILL.md` — System-level skill example
- `.claude/skills/execute-framework/SKILL.md` — System-level skill example
- `frameworks/wordpress/qa/.claude/skills/qa/compile-dev-bundle/SKILL.md` — Framework-level skill example
- `frameworks/wordpress/design-research/.claude/skills/design-research/site-audit/SKILL.md` — Framework-level skill example
- `.claude/commands/audit-framework.md` — Command pattern
- `.claude/agents/framework-auditor.md` — Agent pattern
- `instructions/canonical/system.yaml` — System registration format
- `instructions/canonical/guardrails.md` — Safety and reporting rules
- `tools/verify/verify-skill.cjs` — Skill validation script

Conversation analysis sources:
- Files created during the session (check git status or session file list)
- Tool patterns used (Playwright MCP calls, Write/Edit operations, Bash verifications)
- User decision points (messages that redirected or refined the workflow)
</context>

<automated_workflow>
  <step id="1" name="analyze-conversation" type="AUTO">
    [AUTO] Reconstruct the workflow from the conversation:

    1a. Identify distinct phases — group related operations into named steps
    1b. For each phase: note tools used, files read/written, duration, dependencies
    1c. Identify inputs — what did the user provide upfront vs what was discovered?
    1d. Identify outputs — what files were created? what format? what naming pattern?
    1e. Identify decision points — where did the user choose between options?
    1f. Identify verification patterns — what checks were run? grep patterns? script runs?
    1g. Identify the execution mode — was it FINDINGS_ONLY? PATCH_ALLOWED? Mixed?
  </step>

  <step id="2" name="confirm-workflow" type="USER">
    [USER] Present the extracted workflow to the user:

    "I've identified this workflow from our conversation:

    **Name:** [suggested name based on what was done]
    **Steps:** [numbered list of phases with brief descriptions]
    **Inputs:** [what's needed to run this again]
    **Outputs:** [what it produces]
    **Tools:** [Playwright MCP, Write, Grep, etc.]
    **Verification:** [how output was validated]

    Does this look right? Any steps to add, remove, or rename?
    What should the skill be called?"

    **STOP and wait for user response.**
  </step>

  <step id="3" name="determine-placement" type="AUTO">
    [AUTO] Determine where the skill belongs:

    - If the workflow is framework-agnostic (applies across multiple frameworks or to Mythos itself):
      Place at `.claude/skills/<name>/SKILL.md`
      Command at `.claude/commands/<name>.md`
      Agent at `.claude/agents/<name>-agent.md`

    - If the workflow is tied to a specific framework:
      Place at `frameworks/{svc}/{fw}/.claude/skills/{fw}/<name>/SKILL.md`
      Command at `frameworks/{svc}/{fw}/.claude/commands/{fw}/<name>.md`
      Agent at `frameworks/{svc}/{fw}/.claude/agents/{fw}/<name>-agent.md`

    Report the chosen placement and rationale.
  </step>

  <step id="4" name="check-overlap" type="AUTO">
    [AUTO] Scan for existing skill overlap:

    For system-level skills: read `.claude/skills/*/SKILL.md`
    For framework-level: read `frameworks/{svc}/{fw}/.claude/skills/{fw}/*/SKILL.md`

    For each registered skill:
    - Tool overlap: count shared tools / total tools
    - Output overlap: count shared output types / total outputs
    - Domain overlap: does the description cover the same area?

    If any skill has >50% combined overlap, report to user:
    "This overlaps with [skill-name] ([%] shared tools/outputs).
    Should I extend that skill or create a new one?"

    If no significant overlap, proceed.
  </step>

  <step id="5" name="generate-skill" type="AUTO">
    [AUTO] Generate SKILL.md at the determined path.

    Read the most relevant existing skill as a structural template.

    Required sections:
    - YAML frontmatter (name, description, version)
    - `<skill>` wrapper tag
    - objective, prompt_type, execution_mode, model_recommendation
    - quick_start (from confirmed workflow steps)
    - execution_rules (from conversation patterns)
    - context (data files and evidence structure)
    - automated_workflow (steps with types and detailed sub-steps)
    - inputs (required + optional)
    - outputs (named output artifacts)
    - success_criteria (derived from verification patterns)
    - `</skill>` closing tag
  </step>

  <step id="6" name="generate-commands" type="AUTO">
    [AUTO] Generate command file(s).

    Structure matches Mythos command pattern:
    - YAML frontmatter: description, argument-hint, allowed-tools
    - `<objective>` — what the command does
    - `<process>` — numbered steps referencing the skill with `@<path-to-SKILL.md>`
    - `<success_criteria>` — validation criteria

    Create sub-commands for independently-runnable phases if applicable.
  </step>

  <step id="7" name="generate-agent" type="AUTO">
    [AUTO] Generate agent definition.

    Structure matches Mythos agent pattern:
    - YAML frontmatter: name, description (with trigger keywords), tools list, model
    - `<role>` — agent identity
    - `<tasks>` — numbered task list
    - `<mode>` — execution mode
    - `<context>` — reference paths

    Tools list derived from actual tools used in the conversation.
  </step>

  <step id="8" name="generate-verification" type="AUTO">
    [AUTO] Generate verification script if the workflow has auditable outputs.

    Derive checks from conversation validation patterns:
    - If grep was used to count elements → add element count check
    - If file existence was verified → add file existence check
    - If a script was run → add script execution check
    - If JSON was validated → add schema check

    Use the `tools/verify/lib/signal.cjs` and `tools/verify/lib/checks.cjs` libraries.
    Script must output VerificationSignal/1.0 JSON.

    Skip this step if the workflow doesn't produce auditable file artifacts.
  </step>

  <step id="9" name="update-manifest" type="AUTO">
    [AUTO] Register the new skill:

    For system-level skills:
    - Add operation entry to `instructions/canonical/system.yaml` operations array
    - Add agent entry if a new agent was created

    For framework-level skills:
    - Update `frameworks/{svc}/{fw}/manifest.json` to reference new skill, command, agent
  </step>

  <step id="9a" name="sync-project-manifest" type="AUTO">
    [AUTO] Sync project manifest — Run `npm run manifest:sync` to update `.claude/project-claude.yml` with the new skill, command, and agent.
  </step>

  <step id="10" name="verify" type="AUTO">
    [AUTO] Run verification:

    10a. Check all generated file paths exist
    10b. Run `node tools/verify/verify-skill.cjs <path-to-SKILL.md>`
    10c. Run `npm run manifest:check` to confirm manifest is in sync
    10d. Validate no duplicate entries in manifests
    10e. If verification script was generated, run it (expect either PASS or expected failures if no test data exists yet)
  </step>

  <step id="11" name="present-results" type="USER">
    [USER] Present all generated artifacts:

    "Skill extraction complete. Created:
    - SKILL.md: [path]
    - Command: [path]
    - Agent: [path]
    - Verification: [path] (if generated)
    - Manifest: updated [path]

    Verification: [PASS/FAIL]

    You can now invoke this workflow with: /[skill-name]"

    **STOP and wait for user response.**
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="CONVERSATION_CONTEXT">The current conversation (implicit — no explicit path needed)</input>
  </required>
  <optional>
    <input name="SKILL_NAME">User-chosen name for the skill (prompted in Step 2 if not provided)</input>
    <input name="TARGET_FRAMEWORK">Framework path if the skill should be placed within a specific framework</input>
    <input name="SKIP_ANALYSIS">If true, skip conversation analysis and use a provided workflow description</input>
  </optional>
</inputs>

<outputs>
  <output name="skill-definition">SKILL.md at system or framework level</output>
  <output name="commands">Command .md file(s) at matching level</output>
  <output name="agent">Agent .md definition at matching level</output>
  <output name="verification-script">Verification .cjs script (if applicable)</output>
  <output name="manifest-update">Updated manifest (system.yaml or framework manifest.json)</output>
</outputs>

<success_criteria>
- All generated files exist at specified paths
- SKILL.md follows Mythos's XML structure (objective, quick_start, automated_workflow, etc.)
- Commands follow YAML frontmatter + XML body pattern
- Agent follows YAML frontmatter + XML body pattern
- `node tools/verify/verify-skill.cjs` passes on the generated SKILL.md
- Manifest has consistent entries (no duplicates, paths valid)
- The extracted workflow accurately represents what the conversation accomplished
- User confirmed the workflow summary before generation began
</success_criteria>

<safety_rules>
- Never modify the conversation's original output artifacts
- Never overwrite existing skills without explicit user confirmation
- Never expose credentials, API keys, or PII in generated artifacts
- Never register a skill in a framework manifest without verifying the framework exists
- Always confirm the skill name and workflow with the user before generating files
</safety_rules>
</skill>
